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
import { CONVERT, checkMembers, waitUntilOffered } from "../support/conversion";
import { IPC_TABLE_KEY, installIpcBoundary, revealInDetails } from "../support/harness";
import { MZML_ROW } from "../support/fixtures";
import { EMPTY_ROSTER, NO_PROJECT, RESULT, scenario, type Locale } from "../support/pm9Scenarios";
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

/** A labelled synthetic preview for the Export figure dialog (m7.4's boundary); never the renderer's output. */
async function answerFigurePreviews() {
  await browser.execute((tableKey: string) => {
    const table = Reflect.get(window, tableKey) as Record<string, unknown>;
    const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
      invoke: (name: string, args: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
    };
    const invoke = internals.invoke;
    internals.invoke = (name, args, ...rest) => {
      if (name === "preview_figure") {
        const request = args["request"] as { requestId: string; settings: { widthPx: number; heightPx: number } };
        const { widthPx: width, heightPx: height } = request.settings;
        table[name] = {
          status: "rendered",
          requestId: request.requestId,
          specId: JSON.stringify(request),
          empty: false,
          width,
          height,
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 1200 640"><rect width="1200" height="640" fill="white"/><text x="70" y="55" fill="#1b2532" font-size="24">MOCK IPC FIGURE</text><path d="M80 90V550H1150" fill="none" stroke="#485666" stroke-width="2"/><path d="M150 550V430M330 550V250M600 550V125M850 550V375M1050 550V480" stroke="#267fbb" stroke-width="3"/></svg>`,
        };
      }
      return invoke(name, args, ...rest);
    };
  }, IPC_TABLE_KEY);
}

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Shows a surface: 1 Workbench and 2 Conversion are the header's tabs, 3 Project is the Project menu's first item. */
async function go(position: 1 | 2 | 3) {
  if (position === 3) {
    await browser.$("[data-project-menu]").click();
    await browser.$('[data-project-menu-item="surface"]').waitForDisplayed({ timeout: 30_000 });
    await browser.$('[data-project-menu-item="surface"]').click();
  } else {
    await browser.$(`.workbench-navigation > button:nth-child(${String(position)})`).click();
  }
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
      const entry = browser.$(".spectrum-panel .figure-quick-actions button:first-child");
      await entry.scrollIntoView({ block: "center" });
      await entry.click();
      await browser.$(".figure-preview img").waitForDisplayed({ timeout: 30_000 });
    },
    anchor: ".figure-export-dialog",
  },
  { name: "backend-checking", table: populated, hold: ["inspect_backend"], anchor: "#backend-status" },
  {
    name: "backend-available",
    table: populated,
    drive: async () => {
      const toggle = browser.$("[data-backend-toggle]");
      await toggle.waitForExist({ timeout: 30_000 });
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    },
    anchor: "#backend-status:not([data-backend-collapsed])",
  },
  { name: "backend-chosen", table: withBackend(chosenBackend), drive: expandBackend, anchor: "#backend-status:not([data-backend-collapsed])" },
  { name: "backend-unavailable", table: withBackend(unavailableBackend), anchor: '#backend-status[data-backend-status]:not([data-backend-collapsed])' },
  {
    name: "backend-unavailable-help",
    table: withBackend(unavailableBackend),
    drive: async () => {
      await browser.$("[data-backend-help]").waitForDisplayed({ timeout: 30_000 });
      await browser.$("[data-backend-help]").click();
    },
    anchor: '[data-backend-help][aria-expanded="true"]',
  },
  { name: "backend-quarantined", table: withBackend(quarantinedBackend), anchor: "#backend-status:not([data-backend-collapsed])" },
  { name: "backend-folder-without-tools", table: withBackend(chosenFolderWithoutTools), anchor: "#backend-status:not([data-backend-collapsed])" },
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
];

async function expandBackend() {
  const toggle = browser.$("[data-backend-toggle]");
  await toggle.waitForExist({ timeout: 30_000 });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
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
async function capture(file: string) {
  await browser.execute(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[role="dialog"]') === null) active.blur();
  });
  await frames();
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof shot.data !== "string") throw Error(`no screenshot for ${file}`);
  writeFileSync(join(OUTPUT, file), Buffer.from(shot.data, "base64"));
}

// ---------------------------------------------------------------- tour

describe("Copy tour, rendered", () => {
  const captured: { file: string; state: string; locale: Locale; viewport: string; text: string }[] = [];

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
          await capture(file);
          const text = await browser.execute(() => document.body.innerText);
          captured.push({ file, state: stop.name, locale, viewport: `${String(width)}x${String(height)}`, text });
          // Judged after the shot, so a failure still leaves its picture.
          expect(await browser.execute(() => [innerWidth, innerHeight])).toEqual([width, height]);
          expect(text.match(/\{\{\w+\}\}|\$t\(\w+\)/gu)).toBeNull();
        });
      }
    }
  }
});
