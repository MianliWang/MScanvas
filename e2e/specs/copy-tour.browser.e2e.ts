/**
 * The copy tour: one viewport screenshot of every main state, in en and zh-CN,
 * at 1366x768 and 960x640.
 *
 * A rendered check for copy and visibility changes. It drives the shipped
 * frontend over the controlled IPC fixtures the other browser specs use, and
 * finds every control by structure (classes, data attributes, positions) and
 * never by its words, so the same file runs against two revisions whose copy
 * differs and leaves comparable pairs. What it asserts is only that each state
 * was reached and that no interpolation or nested key leaked into the page; the
 * screenshots are for a person to read.
 *
 * Screenshots go to `MSCANVAS_COPY_TOUR_OUTPUT`, or `.tmp/copy-tour/` when it
 * is unset, as `<state>-<locale>-<width>x<height>.png`, with a `manifest.json`
 * of what was captured and the page text each shot shows. Evidence boundary:
 * production React in Chrome at DPR 1 with reduced motion; no file read, no
 * provider or engine run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cdp, metrics } from "../support/cdp";
import { answerFigurePreviews, openFigureDialog, waitForFigurePreview } from "../support/figure";
import { CONVERT, checkMembers, waitUntilOffered } from "../support/conversion";
import { IPC_TABLE_KEY, installIpcBoundary, revealInDetails } from "../support/harness";
import { MZML_ROW } from "../support/fixtures";
import { EMPTY_ROSTER, NO_PROJECT, RESULT, capturedProject, scenario, type Locale } from "../support/pm9Scenarios";
import { PLOT, TABLE, readBackSavedPreferences, revealRosterRow, revealTheSpectrum, selectTheSpectrum } from "../support/viewer";
import {
  admittedIntents,
  availableBackend,
  chosenBackend,
  chosenFolderWithoutTools,
  completeCatalog,
  finalizedAttemptFacts,
  quarantinedBackend,
  queueItem,
  queueOf,
  settledAt,
  shippedIntent,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";

const OUTPUT = resolve(
  process.env["MSCANVAS_COPY_TOUR_OUTPUT"] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp", "copy-tour"),
);
const LOCALES: readonly Locale[] = ["en", "zh-CN"];
const VIEWPORTS = [
  [1366, 768],
  [960, 640],
] as const;

// ---------------------------------------------------------------- the world

const AUTHORITY = settledAt(1, 1);
const OPERATION = "copy-tour-queue";
/** ProteoWizard's details, open over the status bar. */
const POPOVER = '#backend-status[data-backend-mode="popover"]';
const raw = (index: number, fileName: string): SelectedFile => ({
  handle: `raw-${String(index)}`,
  fileName,
  byteLength: index * 52_428_800,
  sourceKind: "thermo_raw",
  relativeContext: null,
});
const FIRST = raw(1, "QC_pool_01.raw");
const SECOND = raw(2, "Plasma_QC_batch_08_replicate_04_long_acquisition.raw");
const OPEN: SelectedFile = { handle: "open", fileName: "reference_run.mzML", byteLength: 4_194_304, sourceKind: "mzml", relativeContext: null };
const ROWS: readonly SelectedFile[] = [FIRST, SECOND, OPEN];

/** The first row converting, the second waiting. */
const STARTED = {
  status: "running",
  operationId: OPERATION,
  queue: queueOf([queueItem(FIRST.handle, FIRST.fileName, { state: "running", attempts: 1 }), queueItem(SECOND.handle, SECOND.fileName)]),
};

/** Finished: one output to add, one failure whose owned staging can be cleaned. */
const FINISHED = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([
    queueItem(FIRST.handle, FIRST.fileName, {
      state: "finalized",
      attempts: 1,
      finalizedOutputs: [{ outputId: "copy-tour-output-1", fileName: "QC_pool_01.mzML" }],
      ...finalizedAttemptFacts(),
    }),
    queueItem(SECOND.handle, SECOND.fileName, {
      state: "failed",
      attempts: 1,
      stagingRecovery: { recoveryId: "copy-tour-staging-2", attempt: 1, status: "recoverable" },
    }),
  ]),
};

function slot(sequence: number, state: unknown) {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: AUTHORITY,
  };
}

/** The conversion surface over three rows, with a ready configuration and the queue `state`. */
function conversionWorld(locale: Locale, state: { status: string }): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: ROWS, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = slot(state.status === "idle" ? 0 : 1, state);
  table.begin_workspace_conversion_queue = { authority: AUTHORITY, outcome: { outcome: "reserved", reservation: { reservationId: "copy-tour-reservation" } } };
  table.choose_workspace_conversion_destination = slot(1, STARTED);
  return table;
}

/** Answers each plan question for the rows it names, as Rust's describe does (beta1-ux's boundary). */
async function answerPlans() {
  await browser.execute(
    (tableKey: string, known: readonly SelectedFile[], intents: readonly { id: string }[]) => {
      const table = Reflect.get(window, tableKey) as Record<string, unknown>;
      const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
        invoke: (name: string, args: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
      };
      const invoke = internals.invoke;
      internals.invoke = (name, args, ...rest) => {
        if (name === "describe_workspace_conversion_queue") {
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
    ROWS,
    admittedIntents,
  );
}

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Shows a surface: the header's tabs are 1 Workbench, 2 Conversion and 3 Project. */
async function go(position: 1 | 2 | 3) {
  await browser.$(`.workbench-navigation > button:nth-child(${String(position)})`).click();
  await frames();
}

/** Folds the roster where the window is too narrow for it beside the evidence. */
async function foldNarrowRoster() {
  const toggle = browser.$('[aria-controls="workbench-roster"]');
  const narrow = await browser.execute(() => innerWidth < 1050);
  if (narrow && (await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
    await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === "false");
  }
}

/** The first mzML row opened: chromatogram and scan table on screen. */
async function openPreview() {
  await revealRosterRow(MZML_ROW.handle);
  await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForExist({ timeout: 60_000 });
  await foldNarrowRoster();
  await browser.$(PLOT).waitForDisplayed({ timeout: 60_000 });
}

async function openSpectrum() {
  await openPreview();
  await selectTheSpectrum(0);
}

interface Stop {
  readonly name: string;
  readonly table: (locale: Locale) => Record<string, unknown>;
  readonly hold?: readonly string[];
  readonly drive?: () => Promise<void>;
  /** What must be on screen before the shot. */
  readonly anchor: string;
  /** Leaves the keyboard where the state put it, so its focus ring is in the shot. */
  readonly keepFocus?: boolean;
}

/** A crowded status bar: a conversion under way, a long unsaved project name, drop that stopped working. */
function crowdedTable(locale: Locale) {
  const table = scenario("converting", locale);
  table.get_project_state = capturedProject({ name: "Plasma QC batch 08 replicate 04 long acquisition review", dirty: true });
  table.subscribe_workspace_drop_updates = null;
  return table;
}

/** Focuses `css` by script, then presses Tab `tabs` times, so the ring is a keyboard one. */
async function tabFrom(css: string, tabs: number) {
  await browser.execute((selector: string) => document.querySelector<HTMLElement>(selector)?.focus(), css);
  for (let press = 0; press < tabs; press += 1) await browser.keys("Tab");
  await frames();
}

function emptyTable(locale: Locale) {
  const table = scenario("populated", locale);
  table.get_workspace_roster = EMPTY_ROSTER;
  table.get_project_state = NO_PROJECT;
  return table;
}

function withBackend(verdict: unknown) {
  return (locale: Locale) => ({ ...scenario("populated", locale), inspect_backend: verdict });
}

const populated = (locale: Locale) => scenario("populated", locale);

const STOPS: readonly Stop[] = [
  { name: "workbench-empty", table: emptyTable, anchor: ".workbench-shell" },
  { name: "workbench-roster-loading", table: populated, hold: ["get_workspace_roster"], anchor: ".workbench-shell" },
  {
    name: "workbench-reading",
    table: populated,
    hold: ["open_mzml_preview"],
    drive: async () => {
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await foldNarrowRoster();
    },
    anchor: ".workbench-shell",
  },
  { name: "workbench-preview", table: populated, drive: openPreview, anchor: PLOT },
  {
    name: "workbench-spectrum",
    table: populated,
    drive: async () => {
      await openSpectrum();
      await revealTheSpectrum();
    },
    anchor: "svg.spectrum-plot",
  },
  {
    name: "scan-table",
    table: populated,
    drive: async () => {
      await openSpectrum();
      await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "start" }), TABLE);
    },
    anchor: TABLE,
  },
  {
    name: "export-figure",
    table: populated,
    drive: async () => {
      await answerFigurePreviews();
      await openSpectrum();
      await openFigureDialog(".spectrum-panel");
      await waitForFigurePreview();
    },
    anchor: ".figure-export-dialog",
  },
  // ProteoWizard: an item in the status bar; a one-line notice while no usable
  // backend stands; its details open over the bar from the item.
  { name: "backend-checking", table: populated, hold: ["inspect_backend"], anchor: '[data-backend-item] [data-tone="pending"]' },
  { name: "backend-available", table: populated, anchor: '#backend-status[data-backend-mode="hidden"][data-backend-status="available"]' },
  { name: "backend-available-open", table: populated, drive: expandBackend, anchor: POPOVER },
  { name: "backend-chosen-open", table: withBackend(chosenBackend), drive: expandBackend, anchor: POPOVER },
  { name: "backend-unavailable", table: withBackend(unavailableBackend), anchor: '#backend-status[data-backend-mode="notice"]' },
  { name: "backend-unavailable-open", table: withBackend(unavailableBackend), drive: expandBackend, anchor: POPOVER },
  {
    name: "backend-unavailable-help",
    table: withBackend(unavailableBackend),
    drive: async () => {
      await browser.$('#backend-status[data-backend-mode="notice"] [data-backend-help]').waitForDisplayed({ timeout: 30_000 });
      await browser.$('#backend-status[data-backend-mode="notice"] [data-backend-help]').click();
    },
    anchor: '[data-backend-help][aria-expanded="true"]',
  },
  { name: "backend-quarantined", table: withBackend(quarantinedBackend), anchor: '#backend-status[data-backend-mode="notice"][data-backend-status="quarantined"]' },
  { name: "backend-quarantined-open", table: withBackend(quarantinedBackend), drive: expandBackend, anchor: POPOVER },
  { name: "backend-folder-without-tools", table: withBackend(chosenFolderWithoutTools), anchor: '#backend-status[data-backend-mode="notice"]' },
  { name: "backend-folder-without-tools-open", table: withBackend(chosenFolderWithoutTools), drive: expandBackend, anchor: POPOVER },
  {
    // Opened from the keyboard: Enter on the item, then Tab to the first action.
    name: "backend-open-keyboard",
    table: withBackend(unavailableBackend),
    keepFocus: true,
    drive: async () => {
      await browser.$('#backend-status[data-backend-mode="notice"]').waitForExist({ timeout: 30_000 });
      await browser.execute(() => document.querySelector<HTMLElement>("[data-backend-item]")?.focus());
      await browser.keys("Enter");
      await browser.$(POPOVER).waitForDisplayed();
      await browser.keys("Tab");
      await frames();
    },
    anchor: `${POPOVER} [data-backend-action]:focus-visible`,
  },
  {
    // The header by keyboard: the ring on the Conversion tab.
    name: "header-focus",
    table: populated,
    keepFocus: true,
    drive: () => tabFrom(".workbench-home", 2),
    anchor: '.workbench-navigation > [data-surface-tab="conversion"]:focus-visible',
  },
  {
    // Every status-bar item at once, in a window that has to cut something.
    name: "status-crowded",
    table: crowdedTable,
    keepFocus: true,
    drive: () => tabFrom("[data-backend-item]", 1),
    anchor: '[data-shell-context="conversionActivity"]:focus-visible',
  },
  {
    name: "conversion-ready",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    drive: async () => {
      await answerPlans();
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
    },
    anchor: "#workbench-conversion",
  },
  {
    name: "conversion-ready-plan",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    drive: async () => {
      await answerPlans();
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
      await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "center" }), CONVERT);
    },
    anchor: CONVERT,
  },
  {
    name: "conversion-running",
    table: (locale) => conversionWorld(locale, STARTED),
    drive: () => go(2),
    anchor: ".conversion-running",
  },
  {
    name: "conversion-finished",
    table: (locale) => conversionWorld(locale, FINISHED),
    drive: () => go(2),
    anchor: 'li[data-item-state="finalized"]',
  },
  { name: "project-empty", table: emptyTable, drive: () => go(3), anchor: "[data-project-surface]" },
  { name: "project-records", table: populated, drive: () => go(3), anchor: "[data-project-surface]" },
  { name: "project-result", table: (locale) => scenario("projectWithResult", locale), drive: () => go(3), anchor: `[data-project-inspect-artifact="${RESULT}"]` },
  {
    name: "project-result-inspected",
    table: (locale) => scenario("projectWithResult", locale),
    drive: async () => {
      await go(3);
      await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
      await revealInDetails("#workbench-inspector [data-provenance]");
    },
    anchor: "#workbench-inspector [data-provenance]",
  },
  {
    name: "settings",
    table: populated,
    drive: async () => {
      await browser.$("[data-settings-entry]").click();
      await browser.$("[data-settings-dialog]").waitForDisplayed();
    },
    anchor: "[data-settings-dialog]",
  },
  {
    // The refused Reset layout holding the ring, beside a Reset defaults that
    // is not refused: the two must not look alike (rendered review, issue 1).
    name: "settings-refused-focus",
    table: populated,
    drive: async () => {
      await browser.$("[data-settings-entry]").click();
      await browser.$("[data-settings-dialog]").waitForDisplayed();
      await browser.keys("Tab");
      await browser.keys("Tab");
      await frames();
    },
    anchor: '[data-layout-reset][aria-disabled="true"]:focus-visible',
  },
];

async function expandBackend() {
  const item = browser.$("[data-backend-item]");
  await item.waitForExist({ timeout: 30_000 });
  if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
  await browser.$(POPOVER).waitForDisplayed();
}

async function open(stop: Stop, locale: Locale, width: number, height: number) {
  await metrics(width, height);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await installIpcBoundary(stop.table(locale), { hold: stop.hold ?? [] });
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  await browser.waitUntil(() => browser.execute((lang: string) => document.documentElement.lang === lang, locale), {
    timeoutMsg: `the page never became ${locale}`,
  });
  await readBackSavedPreferences();
}

/** The viewport, as it is, with nothing focused that the state did not focus itself. */
async function capture(file: string, keepFocus = false) {
  if (!keepFocus) await browser.execute(() => {
    const active = document.activeElement;
    // A dialog or an open menu keeps its focus: blurring it would close a menu.
    if (active instanceof HTMLElement && active.closest('[role="dialog"], [role="menu"]') === null) active.blur();
  });
  await frames();
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof shot.data !== "string") throw Error(`no screenshot for ${file}`);
  writeFileSync(join(OUTPUT, file), Buffer.from(shot.data, "base64"));
}

/**
 * The rebuild's rendered-QA facts for the shot (spec 12), recorded beside it
 * and not judged here: whether the header is one row, where each plot is and
 * whether a pointer at its centre reaches it, how far the evidence is
 * scrolled, what scrolls sideways, and whether a link-button or a details
 * element is left.
 */
async function layoutFacts() {
  return browser.execute(() => {
    const header = document.querySelector(".workbench-header");
    const headerBox = header?.getBoundingClientRect();
    // Every visible control in the header, by the row its centre sits on.
    const rows = new Set(
      [...(header?.querySelectorAll("button") ?? [])]
        .map((child) => child.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => Math.round(box.top + box.height / 2)),
    );
    const plot = (css: string) => {
      const element = document.querySelector(css);
      const box = element?.getBoundingClientRect();
      if (element === null || box === undefined || box.width === 0) return null;
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        height: Math.round(box.height),
        onScreen: box.top >= 0 && box.bottom <= innerHeight,
        unobstructed: at !== null && element.contains(at),
      };
    };
    const sideways = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((node) => {
        const overflowX = getComputedStyle(node).overflowX;
        return (overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1;
      })
      .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0] ?? ""}`);
    return {
      header: { height: headerBox === undefined ? null : Math.round(headerBox.height), rowCenters: [...rows] },
      chromatogram: plot("svg.chromatogram-svg"),
      spectrum: plot("svg.spectrum-plot"),
      evidenceScrollTop: document.querySelector("#workbench-evidence")?.scrollTop ?? null,
      documentOverflowX: document.documentElement.scrollWidth - innerWidth,
      sideways,
      linkButtonsOrDetails: document.querySelectorAll("details, .link-button").length,
      // The shell's own facts: where each tab starts (a dot must not move
      // one), the bar's height, the ProteoWizard details' box, and every
      // visible button whose label is cut.
      tabs: [...document.querySelectorAll(".workbench-navigation > button")].map((tab) => Math.round(tab.getBoundingClientRect().left)),
      statusBar: Math.round(document.querySelector(".workbench-status")?.getBoundingClientRect().height ?? 0),
      backend: (() => {
        const details = document.getElementById("backend-status");
        const box = details?.getBoundingClientRect();
        return details === null || box === undefined ? null : {
          mode: details.getAttribute("data-backend-mode"),
          top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height),
          onScreen: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth,
        };
      })(),
      clippedButtons: [...document.querySelectorAll<HTMLElement>("button")]
        .filter((button) => button.offsetParent !== null && !button.closest(".visually-hidden") && button.scrollWidth > button.clientWidth + 1)
        .map((button) => (button.textContent ?? "").trim() || button.getAttribute("aria-label") || "?"),
    };
  });
}

// ---------------------------------------------------------------- tour

describe("Copy tour, rendered", () => {
  const captured: { file: string; state: string; locale: Locale; viewport: string; text: string; layout: unknown }[] = [];

  before(() => {
    mkdirSync(OUTPUT, { recursive: true });
    console.log(`Copy tour screenshots: ${OUTPUT}`);
  });

  after(() => {
    writeFileSync(join(OUTPUT, "manifest.json"), `${JSON.stringify(captured, null, 2)}\n`);
  });

  for (const [width, height] of VIEWPORTS) {
    for (const locale of LOCALES) {
      for (const stop of STOPS) {
        const file = `${stop.name}-${locale}-${String(width)}x${String(height)}.png`;
        it(`${stop.name} ${locale} ${String(width)}x${String(height)}`, async () => {
          await open(stop, locale, width, height);
          await stop.drive?.();
          await browser.$(stop.anchor).waitForExist({ timeout: 30_000, timeoutMsg: `${stop.name}: ${stop.anchor} never appeared` });
          await capture(file, stop.keepFocus);
          const text = await browser.execute(() => document.body.innerText);
          captured.push({ file, state: stop.name, locale, viewport: `${String(width)}x${String(height)}`, text, layout: await layoutFacts() });
          // Judged after the shot, so a failure still leaves its picture.
          expect(await browser.execute(() => [innerWidth, innerHeight])).toEqual([width, height]);
          expect(text.match(/\{\{\w+\}\}|\$t\(\w+\)/gu)).toBeNull();
        });
      }
    }
  }
});
