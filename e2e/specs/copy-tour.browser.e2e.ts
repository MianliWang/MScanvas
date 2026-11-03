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
import { CONVERT, answerPlans as answerPlansFor, checkMembers, waitUntilOffered } from "../support/conversion";
import { IPC_TABLE_KEY, installIpcBoundary, revealInDetails, setInvokeResult } from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import { CAPTURED_INPUT, CAPTURED_RUN, EMPTY_ROSTER, NO_PROJECT, RESULT, capturedProject, scenario, type Locale } from "../support/pm9Scenarios";
import { ENDED, ENDED_ITEMS, INTERRUPTED, INTERRUPTED_ITEMS, LABELLED, LABELLED_ITEMS, MANY_ITEMS, MANY_RUNS, OMITTED, REFUSED_END, REFUSED_END_ITEMS, REQUEST_REFUSED, RUNNING, RUNNING_ITEMS, SET_ITEM, STOPPED, STOPPED_ITEMS, STOP_FAILED, STOP_FAILED_ITEMS, WHOLE_SET_ITEM, found, listed } from "../support/runHistory";
import { PLOT, TABLE, readBackSavedPreferences, revealRosterRow, revealTheSpectrum, selectTheSpectrum } from "../support/viewer";
import {
  admittedIntents,
  availableBackend,
  chosenBackend,
  chosenFolderWithoutTools,
  completeCatalog,
  finalizedAttemptFacts,
  outputSetReport,
  quarantinedBackend,
  queueItem,
  queueOf,
  sciexQueueItem,
  settledAt,
  shippedIntent,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";

const OUTPUT = resolve(
  process.env["MSCANVAS_COPY_TOUR_OUTPUT"] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp", "copy-tour"),
);
/** `MSCANVAS_COPY_TOUR_ONLY=a,b` re-shoots only the stops named, into the same folder. */
const ONLY = process.env["MSCANVAS_COPY_TOUR_ONLY"]?.split(",") ?? null;
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
/** A family Thermo's picker refuses (ADR 0059), for the stop that shows it. */
const LCD: SelectedFile = { handle: "lcd", fileName: "Shimadzu_run_01.lcd", byteLength: 8_388_608, sourceKind: "shimadzu_lcd", relativeContext: null };

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

/** A queue at its full size (ADR 0057): 1,024 items, 300 converted, the 301st converting. */
const LONG_RUN = {
  status: "running",
  operationId: OPERATION,
  queue: queueOf(Array.from({ length: 1_024 }, (_, index) => {
    const name = `Plasma_S${String(index + 1).padStart(4, "0")}.raw`;
    return queueItem(`long-${String(index)}`, name, index < 300
      ? { state: "finalized", attempts: 1, finalizedOutputs: [{ outputId: `long-output-${String(index)}`, fileName: name.replace(/\.raw$/u, ".mzML") }], ...finalizedAttemptFacts() }
      : index === 300 ? { state: "running", attempts: 1 } : {});
  })),
};

/** The workspace at the queue's full size (ADR 0057): 1,024 rows. */
const MANY: readonly SelectedFile[] = Array.from({ length: 1_024 }, (_, index) => raw(index + 1, `Plasma_S${String(index + 1).padStart(4, "0")}.raw`));

/** A ProteoWizard release with no measured row: everything it converts is labelled (ADR 0055). */
const UNMEASURED = "3.0.26204";
const LABEL = { unverifiedSettings: true, unverifiedBuildRelease: UNMEASURED };
/** A world on that build, so the status bar and plan rail name the release its labels name. */
const onUnmeasured = (table: Record<string, unknown>) => ({ ...table, inspect_backend: { ...(table.inspect_backend as object), release: UNMEASURED } });

/** FINISHED on the unmeasured build: both rows labelled, and Add says how many it adds. */
const FINISHED_LABELLED = {
  ...FINISHED,
  queue: queueOf(FINISHED.queue.items.map((item) => ({ ...item, notVerifiedByMscanvas: LABEL }))),
};

/** A finished queue at its full size, every row labelled: results and Add, windowed (ADR 0057). */
const LONG_FINISHED = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf(MANY.map((row, index) => queueItem(row.handle, row.fileName, index % 3 === 2
    ? { state: "failed", attempts: 1, notVerifiedByMscanvas: LABEL }
    : { state: "finalized", attempts: 1, finalizedOutputs: [{ outputId: `long-output-${String(index)}`, fileName: row.fileName.replace(/\.raw$/u, ".mzML") }], ...finalizedAttemptFacts(), notVerifiedByMscanvas: LABEL }))),
};

/** Every output name of MANY, as a collision refusal lists them. */
const COLLIDING = MANY.map((row) => row.fileName.replace(/\.raw$/u, ".mzML"));
const COLLISION = {
  kind: "queue_output_name_collision",
  summary: "Two or more selected acquisitions would produce the same converted filename, so nothing was queued.",
  detail: COLLIDING.join(", ").slice(0, 400),
  retryable: false,
  context: { kind: "outputNameCollision" as const, names: COLLIDING },
};

/** A full queue refused before it ran, every output name colliding: the names, windowed. */
const COLLIDED = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf(MANY.map((row) => queueItem(row.handle, row.fileName, { state: "notRun" })), COLLISION),
};

/**
 * That a colliding-name list is outside every live region and that Convert,
 * where it is on screen, is described without a single one of the names: a
 * windowed list mounts rows as it scrolls, and neither an announcement nor a
 * description should read them.
 */
async function expectNamesBesideTheSentence() {
  const facts = await browser.execute((convert: string, names: readonly string[]) => {
    const live = [...document.querySelectorAll(".conversion-name-list")].filter((list) => list.closest("[role='status'],[aria-live]") !== null).length;
    const ids = document.querySelector(convert)?.getAttribute("aria-describedby")?.split(/\s+/u) ?? [];
    const description = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    return { live, described: names.filter((name) => description.includes(name)).length };
  }, CONVERT, COLLIDING);
  if (facts.live !== 0 || facts.described !== 0) throw new Error(`colliding names read aloud: ${JSON.stringify(facts)}`);
}

/** STARTED on the unmeasured build: the waiting and the running row say it before any report. */
const STARTED_LABELLED = {
  ...STARTED,
  queue: queueOf(STARTED.queue.items.map((item) => ({ ...item, notVerifiedByMscanvas: LABEL }))),
};

/** Thermo's picker wrote no record of the scope asked for: the second row's own sentence. */
const PICKER_REFUSED = {
  ...FINISHED,
  queue: queueOf([
    FINISHED.queue.items[0]!,
    queueItem(SECOND.handle, SECOND.fileName, {
      state: "failed",
      attempts: 1,
      result: {
        kind: "single",
        report: {
          datasetHandle: SECOND.handle, sourceKind: "thermo_raw", outcome: "output_rejected", detailedOutcome: "picker_scope_record_mismatch",
          outputFileName: null, output: null, validationMode: "output_only", validation: null, backend: null, stagingResidue: null, receipt: 1,
          unverifiedSettings: false, unverifiedBuildRelease: null,
        },
      },
    }),
  ]),
};

/** 1,024 mzML rows: every one excluded from conversion, and listed. */
const MANY_MZML: readonly SelectedFile[] = MANY.map((row) => ({ ...row, fileName: row.fileName.replace(/\.raw$/u, ".mzML"), sourceKind: "mzml" }));

/** Add over LONG_FINISHED, refused for a full workspace: every output it did not add, listed. */
const ADOPTION_REFUSED = {
  operationId: OPERATION,
  retryRound: 0,
  roster: { datasets: MANY, capacity: 1024 },
  outcomes: LONG_FINISHED.queue.items.flatMap((item, index) => item.state !== "finalized" ? [] : [{
    kind: "refused", itemIndex: index, memberIndex: 0, sourceHandle: item.datasetHandle,
    outputFileName: item.fileName.replace(/\.raw$/u, ".mzML"), reason: "workspace_full",
  }]),
};

/** The roster after an adoption from the unmeasured build: the adopted row keeps the label. */
const ADOPTED: SelectedFile = { handle: "adopted", fileName: "QC_pool_01.mzML", byteLength: 2_097_152, sourceKind: "mzml", relativeContext: null, notVerifiedByMscanvas: LABEL };

/** A beta-1 (schema 4) project with a change, and one reference from a labelled conversion. */
function beta1Project(locale: Locale) {
  const table = scenario("populated", locale);
  const project = capturedProject({ name: "Plasma QC batch 08", dirty: true });
  table.get_project_state = {
    ...project,
    published: true,
    savingUpgradesSchema: true,
    inputs: project.inputs.map((input, index) => index === 0 ? { ...input, notVerifiedByMscanvas: LABEL } : input),
  };
  return onUnmeasured(table);
}

/** A saved project whose one reference is from a labelled conversion, with nothing unsaved. */
function labelledProject(locale: Locale) {
  const table = scenario("populated", locale);
  const project = capturedProject({ name: "Plasma QC batch 08", published: true });
  table.get_project_state = { ...project, inputs: project.inputs.map((input) => ({ ...input, notVerifiedByMscanvas: LABEL })) };
  return onUnmeasured(table);
}

/** That row under a long name, for the viewer's title, where the name gives way to the label. */
function labelledLongMzmlRow(locale: Locale): Record<string, unknown> {
  const table: Record<string, unknown> = labelledMzmlRow(locale);
  const roster = table.get_workspace_roster as { datasets: SelectedFile[]; capacity: number };
  table.get_workspace_roster = { ...roster, datasets: roster.datasets.map((row) => row.handle === MZML_ROW.handle
    ? { ...row, fileName: "Plasma_QC_batch_08_replicate_04_long_acquisition_converted.mzML" } : row) };
  return table;
}

/** A complete SCIEX set at its largest (ADR 0027), each member with its own Add (ADR 0052). */
const SET_ROW: SelectedFile = { handle: "wiff-1", fileName: "Plasma_QC_batch_08_sciex_set.wiff", byteLength: 1_048_576, sourceKind: "sciex_wiff", relativeContext: null };
const SET_NAMES = Array.from({ length: 24 }, (_, index) => `Plasma_QC_batch_08_sciex_set-${String(index + 1).padStart(2, "0")}.mzML`);
const SET_FINISHED = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([sciexQueueItem(SET_ROW.handle, SET_ROW.fileName, {
    state: "finalized",
    attempts: 1,
    finalizedOutputs: SET_NAMES.map((fileName, index) => ({ outputId: `set-output-${String(index)}`, fileName })),
    result: { kind: "outputSet", report: outputSetReport(SET_ROW.handle, SET_NAMES) },
    ...finalizedAttemptFacts(),
  })]),
};

/** What the per-output command answers for an output `name` of the first item. */
function outputAnswer(rows: readonly SelectedFile[], sourceHandle: string, name: string, outcome: "added" | "alreadyInWorkspace" | "refused") {
  const dataset: SelectedFile = { handle: "added-output", fileName: name, byteLength: 1_048_576, sourceKind: "mzml", relativeContext: null, notVerifiedByMscanvas: LABEL };
  return {
    operationId: OPERATION,
    retryRound: 0,
    roster: { datasets: outcome === "refused" ? rows : [...rows, dataset], capacity: 1024 },
    outcomes: [outcome === "refused"
      ? { kind: "refused", itemIndex: 0, memberIndex: 0, sourceHandle, outputFileName: name, reason: "workspace_full" }
      : { kind: outcome, itemIndex: 0, memberIndex: 0, sourceHandle, outputFileName: name, dataset }],
  };
}

/** An output's Add: the third button of its group, after Open file and Open folder. */
const OUTPUT_ADD = ".output-open-actions button:nth-of-type(3)";

/** The conversion surface, then the first output's Add pressed. */
async function addTheFirstOutput() {
  await go(2);
  await browser.$(OUTPUT_ADD).waitForExist({ timeout: 30_000 });
  await browser.$(OUTPUT_ADD).scrollIntoView({ block: "center" });
  await browser.$(OUTPUT_ADD).click();
  await frames();
}

/** The conversion surface, then the Add of member 20 of 24, with the list's head scrolled away. */
async function addMemberTwenty() {
  const add = `.output-open-actions[aria-label*="${SET_NAMES[19]!}"] button:nth-of-type(3)`;
  await go(2);
  await browser.$(add).waitForExist({ timeout: 30_000 });
  await browser.$(add).scrollIntoView({ block: "center" });
  await browser.$(add).click();
  await frames();
}

/** A finished queue whose one labelled output has a name near the filesystem's limit. */
const LONG_OUTPUT_NAME = `${"Plasma_QC_batch_08_replicate_04_".repeat(5)}.mzML`;
const FINISHED_LONG_NAME = {
  ...FINISHED_LABELLED,
  queue: queueOf(FINISHED_LABELLED.queue.items.map((item) => ({ ...item, finalizedOutputs: [{ outputId: "long-name-output", fileName: LONG_OUTPUT_NAME }] }))),
};

/** The project's Details on that reference. */
async function inspectLabelledReference() {
  await go(3);
  await browser.$(`[data-project-inspect="${CAPTURED_INPUT}"]`).click();
  await revealInDetails('#workbench-inspector [data-provenance="input"]');
}

/** The populated world with its mzML row adopted from a labelled conversion. */
function labelledMzmlRow(locale: Locale) {
  const table = scenario("populated", locale);
  const roster = table.get_workspace_roster as { datasets: SelectedFile[]; capacity: number };
  table.get_workspace_roster = { ...roster, datasets: roster.datasets.map((row) => row.handle === MZML_ROW.handle ? { ...row, notVerifiedByMscanvas: LABEL } : row) };
  return onUnmeasured(table);
}

/** Chooses one processing value by its radio, never by its words. */
async function chooseProcessing(value: string) {
  await browser.execute((css: string) => document.querySelector<HTMLInputElement>(css)?.click(), `.conversion-setting[data-axis="processing"] input[value="${value}"]`);
  await frames();
}

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
function conversionWorld(locale: Locale, state: { status: string }, rows: readonly SelectedFile[] = ROWS): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: rows, capacity: 1024 };
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

/** Answers each plan question for the rows it names, as Rust's describe does. */
const answerPlans = (rows: readonly SelectedFile[] = ROWS) => answerPlansFor(rows);

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

/** A spectrum open, then the file's tab at `position` (1 Chromatogram and spectrum, 2 Scans, 3 Metadata). */
async function openViewerTab(position: 2 | 3) {
  await openSpectrum();
  await browser.$(`.viewer-tabs [role="tab"]:nth-child(${String(position)})`).click();
  await frames();
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
  /** Only where the window is short enough for the state to differ from another stop's. */
  readonly narrowOnly?: boolean;
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

// ---------------------------------------------------------- workspace restore

function restored(rows: readonly unknown[], expired = 0, leftoverCopies = 0, name: string | null = null) {
  return { outcome: "restored", groups: [{ name, rows }], expired, leftoverCopies };
}

const restoredRow = (index: number, displayName: string, state: string, context: string | null = null) =>
  ({ handle: `restored-${String(index)}`, sourceKind: "thermo_raw", displayName, context, checked: true, state });

const RESTORE_OFFER = restored(Array.from({ length: 12 }, (_, index) => restoredRow(index, `QC_${String(index + 1).padStart(2, "0")}.raw`, "matching")), 2);

const RESTORE_MARKED = {
  outcome: "restored",
  expired: 0,
  leftoverCopies: 0,
  groups: [
    { name: null, rows: [restoredRow(0, "QC_01.raw", "matching"), restoredRow(1, "QC_02.raw", "matching")] },
    {
      name: "Plasma batch 08",
      rows: [
        restoredRow(2, "QC_03.raw", "changed", "batch-1"),
        restoredRow(3, "QC_03.raw", "missing", "batch-2"),
        restoredRow(4, "blank_01.raw", "unreachable"),
        restoredRow(5, "blank_02.raw", "unreadable"),
        restoredRow(6, "blank_03.raw", "unsafe"),
      ],
    },
  ],
};

const RESTORE_ANSWER = {
  workspace: { roster: { datasets: [MZML_ROW], capacity: 1024 }, outcomes: [{ outcome: "added", dataset: MZML_ROW }] },
  placed: [{ handle: MZML_ROW.handle, group: null, checked: true, added: true }],
};

/** A first run whose start-up read answers `read`. */
function restoreTable(read: unknown) {
  return (locale: Locale) => ({ ...emptyTable(locale), read_workspace_restore: read });
}

/** A change after the start-up read, which is what the first save is. */
async function toggleTheFirstRow() {
  await revealRosterRow(MZML_ROW.handle);
  await frames();
  await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"] input[type="checkbox"]`).click();
  await foldNarrowRoster();
}

async function openRestoreSettings(section: string) {
  await browser.$("[data-settings-entry]").click();
  await browser.$("[data-settings-dialog]").waitForDisplayed();
  await browser.$(section).waitForExist();
  // Nearest, as focus scrolls: centring also scrolls the dialog's own clipped box.
  await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "nearest" }), section);
}

const DECLARED_UNITS = { mzUnit: { state: "declared", accession: "MS:1000040" }, intensityUnit: { state: "declared", accession: "MS:1000131" } };

/** The populated world, its selected spectrum declaring `declared` (ADR 0056). */
function declaredSpectrum(declared: Record<string, unknown>) {
  return (locale: Locale) => {
    const table = scenario("populated", locale);
    const answer = table.load_selected_spectrum as { authority: unknown; outcome: { spectrum: Record<string, unknown> } };
    return { ...table, load_selected_spectrum: { ...answer, outcome: { outcome: "spectrum", spectrum: { ...answer.outcome.spectrum, ...declared } } } };
  };
}

/** The populated world, its run's scans alternating minutes and seconds. */
function mixedUnits(locale: Locale) {
  const table = scenario("populated", locale);
  const preview = table.open_mzml_preview as { spectrumTable: { rows: { retentionTime: unknown }[] } };
  return { ...table, open_mzml_preview: { ...preview, chromatogramExportToken: null,
    runSummary: { ...(table.open_mzml_preview as { runSummary: object }).runSummary, retentionTimeRange: { state: "mixedUnits" } },
    spectrumTable: { ...preview.spectrumTable, rows: preview.spectrumTable.rows.map((row, index) => ({ ...row,
      retentionTime: { value: index, unit: index % 2 === 0 ? "minute" : "second" } })) } } };
}

/**
 * The populated world, every scan declaring `unit` (ADR 0056): the common
 * native file. Its selected spectrum is profile, so the line is drawn too.
 */
function declaredRun(unit: "minute" | "second") {
  return (locale: Locale) => {
    const table = scenario("populated", locale);
    const preview = table.open_mzml_preview as { runSummary: object; spectrumTable: { rows: object[] } };
    const rows = preview.spectrumTable.rows.map((row, index) => ({ ...row, retentionTime: { value: index * 7.5, unit } }));
    const answer = table.load_selected_spectrum as { authority: unknown; outcome: { spectrum: Record<string, unknown> } };
    return { ...table,
      open_mzml_preview: { ...preview,
        runSummary: { ...preview.runSummary, retentionTimeRange: { state: "reported", minimum: 0, maximum: (rows.length - 1) * 7.5, unit } },
        spectrumTable: { ...preview.spectrumTable, rows } },
      load_selected_spectrum: { ...answer, outcome: { outcome: "spectrum", spectrum: { ...answer.outcome.spectrum,
        retentionTime: { value: 0, unit }, representation: "profile", ...DECLARED_UNITS } } } };
  };
}

/** The axis states the run's own unit, in either locale's brackets; nothing converts it. */
async function expectRtAxis(symbol: string) {
  await browser.waitUntil(async () => {
    const title = await browser.$(".plot-axis-title-x").getText();
    return title.includes(`(${symbol})`) || title.includes(`（${symbol}）`);
  }, { timeout: 10_000, timeoutMsg: `the retention-time axis never said ${symbol}` });
}

/** The populated world, the spectrum read refused by the reader as `kind`. */
function refusedSpectrum(kind: string, detail: string | null) {
  return (locale: Locale) => ({ ...scenario("populated", locale), load_selected_spectrum: { __reject: { kind,
    summary: "Controlled refusal", detail, retryable: false } } });
}

/** Clicks the first scan row by script, which reads its spectrum. */
async function clickTheFirstScan() {
  await browser.execute(() => {
    document.querySelector('div.spectrum-table-row[data-row-position="0"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The first scan clicked, and the panel's refusal on screen. */
async function refuseTheSpectrum() {
  await openPreview();
  await clickTheFirstScan();
  await browser.$(".spectrum-panel .empty-state").waitForExist({ timeout: 30_000 });
  await browser.execute(() => document.querySelector(".spectrum-panel")?.scrollIntoView({ block: "end" }));
}

/** A declared-profile spectrum whose projection answers with `projection` merged in. */
function profileProjection(projection: Record<string, unknown>) {
  return (locale: Locale) => {
    const table: Record<string, unknown> = declaredSpectrum({ representation: "profile", ...DECLARED_UNITS })(locale);
    return { ...table, project_selected_spectrum: { ...(table.project_selected_spectrum as object), ...projection } };
  };
}

/** The chromatogram's ⋯ menu, then its first item, Set range…. */
async function openChromatogramRangeEditor() {
  await browser.$('.chromatogram-panel .figure-quick-actions button[aria-haspopup="menu"]').click();
  await browser.$('[role="menuitem"]').waitForDisplayed({ timeout: 30_000 });
  await (await browser.$$('[role="menuitem"]'))[0]!.click();
  await browser.$(".chromatogram-panel .plot-range-form").waitForDisplayed();
}

async function openDetails() {
  await browser.$('.workbench-header [aria-controls="workbench-inspector"]').click();
  await frames();
}

async function showTheSpectrum() {
  await openSpectrum();
  await revealTheSpectrum();
}

/** Opens the mzML row and leaves whatever the read answered on screen. */
async function readTheRow() {
  await revealRosterRow(MZML_ROW.handle);
  await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
  await foldNarrowRoster();
}

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
      // The frames fade in after 300 ms, so a quick read never flashes them.
      await browser.waitUntil(() => browser.execute(() => {
        const frame = document.querySelector(".viewer-skeleton-plot");
        return frame !== null && getComputedStyle(frame).opacity === "1";
      }), { timeout: 30_000, timeoutMsg: "the reading frames never showed" });
    },
    anchor: ".viewer-skeleton",
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
  // What the file declares (ADR 0056 slice 2): a profile spectrum is a joined
  // line (P175), a centroid one sticks, both with their units by accession; a
  // truncated spectrum states its prefix and its total.
  { name: "spectrum-profile-line", table: declaredSpectrum({ representation: "profile", ...DECLARED_UNITS }),
    drive: showTheSpectrum, anchor: 'svg.spectrum-plot[data-drawn-as="line"]' },
  { name: "spectrum-centroid-sticks", table: declaredSpectrum({ representation: "centroid", ...DECLARED_UNITS }),
    drive: showTheSpectrum, anchor: 'svg.spectrum-plot[data-drawn-as="sticks"]' },
  { name: "spectrum-truncated", table: declaredSpectrum({ truncated: true, pointCount: 900_000 }),
    drive: showTheSpectrum, anchor: ".spectrum-panel .notice-warning" },
  // Scans in seconds and minutes: no chromatogram, the reason in its place.
  { name: "chromatogram-mixed-units", table: mixedUnits, drive: readTheRow, anchor: ".chromatogram-panel .empty-state" },
  // Scans all in minutes, or all in seconds: the unit on the axis, the range,
  // the cursor, the table and Metadata. The last scan puts the cursor label at
  // the right edge.
  { name: "chromatogram-minutes", table: declaredRun("minute"), drive: async () => { await showTheSpectrum(); await expectRtAxis("min"); },
    anchor: "svg.spectrum-plot" },
  { name: "chromatogram-seconds", table: declaredRun("second"), drive: async () => { await showTheSpectrum(); await expectRtAxis("s"); },
    anchor: "svg.spectrum-plot" },
  { name: "chromatogram-minutes-last", table: declaredRun("minute"), drive: async () => {
    await openPreview(); await selectTheSpectrum(5); await revealTheSpectrum();
  }, anchor: "svg.spectrum-plot" },
  { name: "viewer-metadata-minutes", table: declaredRun("minute"), drive: () => openViewerTab(3), anchor: ".preview-metadata" },
  // The range editor's fields in the run's unit, and the figure dialog's run
  // window once a range is committed.
  { name: "chromatogram-minutes-range-editor", table: declaredRun("minute"), keepFocus: true, drive: async () => {
    await openPreview();
    await openChromatogramRangeEditor();
  }, anchor: ".chromatogram-panel .plot-range-form" },
  { name: "export-figure-minutes-range", table: declaredRun("minute"), drive: async () => {
    await answerFigurePreviews();
    await openPreview();
    await openChromatogramRangeEditor();
    await browser.$("#plot-range-rt-low").setValue("7.5");
    await browser.$("#plot-range-rt-high").setValue("30");
    await browser.$(".chromatogram-panel .plot-range-form button[type=submit]").click();
    await browser.$(".chromatogram-panel .plot-range-form").waitForExist({ reverse: true });
    await openFigureDialog(".chromatogram-panel");
    await waitForFigurePreview();
  }, anchor: ".figure-export-dialog" },
  // The reader refused the spectrum: its reason, the reader's stable id, and
  // where the preview is gone, opening the file again.
  { name: "spectrum-preview-not-open", table: refusedSpectrum("preview_not_open", null), drive: refuseTheSpectrum,
    anchor: ".spectrum-panel .empty-state button" },
  { name: "spectrum-encoding-unsupported", table: refusedSpectrum("spectrum_encoding_unsupported", "mz:numpress"), drive: refuseTheSpectrum,
    anchor: ".spectrum-panel .empty-state" },
  // A profile spectrum's Details while its window is being drawn (no sticks
  // reason), and once Rust reduced it (the line's own rule).
  { name: "spectrum-profile-pending-details", table: declaredSpectrum({ representation: "profile", ...DECLARED_UNITS }),
    hold: ["project_selected_spectrum"], drive: async () => {
      await openPreview();
      await clickTheFirstScan();
      await browser.$("svg.spectrum-plot").waitForExist({ timeout: 30_000 });
      await openDetails();
    }, anchor: "#workbench-inspector .inspector-panel" },
  { name: "spectrum-profile-reduced-details", table: profileProjection({ reduced: true, sourcePoints: 4_000 }),
    drive: async () => { await openSpectrum(); await openDetails(); }, anchor: 'svg.spectrum-plot[data-drawn-as="line"]' },
  // An open Rust answered as superseded: its reason, beside reading it again.
  {
    name: "workbench-open-superseded",
    table: (locale) => ({ ...scenario("populated", locale), open_mzml_preview: { __reject: { kind: "selection_superseded",
      summary: "A newer request for that file arrived before this one finished, so its result was not used.", detail: null, retryable: false } } }),
    drive: readTheRow,
    anchor: '#workbench-evidence[data-evidence="failed"] button',
  },
  // Rows listed and none opened: the evidence says where to pick, and where
  // the list is a folded drawer it offers the button that opens it.
  { name: "workbench-select", table: populated, anchor: '#workbench-evidence[data-evidence="idle"]' },
  // The file's Scans and Metadata tabs (direction A), by position in the tab list.
  { name: "viewer-scans", table: populated, drive: () => openViewerTab(2), anchor: '.spectrum-table-panel[data-layout="full"]' },
  { name: "viewer-metadata", table: populated, drive: () => openViewerTab(3), anchor: ".preview-metadata" },
  {
    // Details beside the plots: a column at 1366, a drawer at 960.
    name: "workbench-details",
    table: populated,
    drive: async () => {
      await openSpectrum();
      await browser.$('.workbench-header [aria-controls="workbench-inspector"]').click();
      await frames();
    },
    anchor: "#workbench-inspector .inspector-panel",
  },
  {
    // Details of an adopted output: its label beside the file's name.
    name: "workbench-details-not-verified",
    table: labelledMzmlRow,
    drive: async () => {
      await openSpectrum();
      await browser.$('.workbench-header [aria-controls="workbench-inspector"]').click();
      await frames();
    },
    anchor: "#workbench-inspector .inspector-panel [data-not-verified]",
  },
  // The viewer's title, the Metadata tab's File row and the figure dialog's
  // source line of a labelled output (owner decision A0055 (a), 2026-10-31).
  { name: "viewer-title-not-verified", table: labelledMzmlRow, drive: openPreview, anchor: ".viewer-file-title [data-not-verified]" },
  { name: "viewer-title-not-verified-long", table: labelledLongMzmlRow, drive: openPreview, anchor: ".viewer-file-title [data-not-verified]" },
  { name: "viewer-metadata-not-verified", table: labelledMzmlRow, drive: () => openViewerTab(3), anchor: ".preview-metadata [data-not-verified]" },
  {
    name: "export-figure-not-verified",
    table: labelledMzmlRow,
    drive: async () => {
      await answerFigurePreviews();
      await openSpectrum();
      await openFigureDialog(".spectrum-panel");
      await waitForFigurePreview();
    },
    anchor: ".figure-export-heading [data-not-verified]",
  },
  {
    // Under a name far too long for its line: the head stays where it is.
    name: "export-figure-not-verified-long",
    table: (locale) => {
      const table: Record<string, unknown> = labelledMzmlRow(locale);
      const roster = table.get_workspace_roster as { datasets: SelectedFile[]; capacity: number };
      table.get_workspace_roster = { ...roster, datasets: roster.datasets.map((row) => row.handle === MZML_ROW.handle ? { ...row, fileName: LONG_OUTPUT_NAME } : row) };
      return table;
    },
    drive: async () => {
      await answerFigurePreviews();
      await openSpectrum();
      await openFigureDialog(".spectrum-panel");
      await waitForFigurePreview();
    },
    anchor: ".figure-export-heading [data-not-verified]",
  },
  {
    // A chromatogram export's result, over the plot's corner: the plot keeps
    // its height (compare the layout facts with workbench-spectrum's).
    name: "chromatogram-export-result",
    table: populated,
    drive: async () => {
      await openSpectrum();
      await browser.$(".chromatogram-panel .figure-quick-actions button[aria-haspopup=\"menu\"]").click();
      await browser.$('[role="menuitem"]').waitForDisplayed({ timeout: 30_000 });
      // The ⋯ order: Set range…, Quick PNG, Copy plot, then CSV.
      await (await browser.$$('[role="menuitem"]'))[3]!.click();
    },
    anchor: ".chromatogram-panel .plot-status .spectrum-export-message",
  },
  {
    // Sorted by RT, descending: a state the spectrum stop does not show.
    name: "scan-table-sorted",
    table: populated,
    drive: async () => {
      await openSpectrum();
      const rt = browser.$(`${TABLE} [role="columnheader"]:nth-child(2) .scan-sort-button`);
      await rt.click();
      await rt.click();
      await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "start" }), TABLE);
    },
    anchor: `${TABLE} [aria-sort="descending"]`,
  },
  {
    // Zoomed in once: Fit all offered, and the head says which range shows.
    name: "chromatogram-zoomed",
    table: populated,
    drive: async () => {
      await openSpectrum();
      await browser.$(".chromatogram-panel .plot-tools .ui-icon-button:nth-of-type(2)").click();
    },
    anchor: ".chromatogram-panel .plot-range",
  },
  {
    // A read the backend refused: what broke, once, beside its retry (S4).
    name: "workbench-read-failed",
    table: (locale) => ({ ...scenario("populated", locale),
      open_mzml_preview: { __reject: { kind: "backend_failed", summary: "Controlled provider refusal", detail: null, retryable: true } } }),
    drive: async () => {
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await foldNarrowRoster();
    },
    anchor: '#workbench-evidence[data-evidence="failed"]',
  },
  {
    // The workspace list could not be read: the roster says it with its retry.
    name: "workbench-roster-failed",
    table: (locale) => ({ ...scenario("populated", locale),
      get_workspace_roster: { __reject: { kind: "backend_failed", summary: "Controlled roster failure", detail: null, retryable: true } } }),
    anchor: '#workbench-evidence[data-evidence="roster-failed"]',
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
  {
    // A spectrum with no points: Current range is refused, its reason beside it.
    name: "export-figure-no-peaks",
    table: (locale) => {
      const empty = ipcTable({ emptySpectrum: true });
      return { ...scenario("populated", locale), load_selected_spectrum: empty.load_selected_spectrum,
        project_selected_spectrum: empty.project_selected_spectrum };
    },
    drive: async () => {
      await answerFigurePreviews();
      await openPreview();
      // Not selectTheSpectrum: it waits for a drawn plot, and none is drawn.
      await browser.execute(() => document.querySelector('div.spectrum-table-row[data-row-position="0"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      await openFigureDialog(".spectrum-panel");
      await waitForFigurePreview();
    },
    anchor: ".figure-export-dialog .figure-export-note",
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
      // The setup help lives in the details the status bar opens (S7).
      await expandBackend();
      await browser.$(`${POPOVER} [data-backend-help]`).waitForDisplayed({ timeout: 30_000 });
      await browser.$(`${POPOVER} [data-backend-help]`).click();
    },
    anchor: '[data-backend-help][aria-expanded="true"]',
  },
  {
    // A preview read, then a check that finds no usable backend: the one-line
    // notice above plots that stay on screen (rendered review, issue 1).
    name: "backend-unusable-preview",
    table: populated,
    drive: async () => {
      await openPreview();
      await setInvokeResult("inspect_backend", unavailableBackend);
      await expandBackend();
      await browser.$(`${POPOVER} [data-backend-action="recheck"]`).click();
      await browser.keys("Escape");
      await browser.$('#backend-status[data-backend-mode="notice"]').waitForDisplayed({ timeout: 30_000 });
    },
    anchor: '#backend-status[data-backend-mode="notice"]',
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
    // Acquisitions by keyboard: its icon alone where the roster is a column,
    // labelled where it is a drawer.
    name: "header-roster-focus",
    table: populated,
    keepFocus: true,
    drive: () => tabFrom(".workbench-home", 4),
    anchor: '.workbench-header [aria-controls="workbench-roster"]:focus-visible',
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
    // Advanced open under Basic, with its changed count in the head (C7).
    name: "conversion-advanced",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    drive: async () => {
      await answerPlans();
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
      await browser.$(".conversion-advanced > .ui-button").click();
      await browser.execute(() => document.querySelector(".conversion-advanced")?.scrollIntoView({ block: "center" }));
    },
    anchor: '.conversion-settings[data-settings-view="advanced"]',
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
    // At 1366 the plan fits without scrolling, so this is conversion-ready again.
    narrowOnly: true,
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
  {
    // The plan scrolled to its end: in a short window the page scrolls as one
    // and Convert stays pinned to the window's foot (review issue 11).
    name: "conversion-ready-end",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    drive: async () => {
      await answerPlans();
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
      await browser.execute(() => {
        for (const node of document.querySelectorAll<HTMLElement>("#workbench-conversion, .conversion-main, .conversion-side")) node.scrollTop = node.scrollHeight;
      });
    },
    anchor: CONVERT,
    narrowOnly: true,
  },
  {
    // The plan at the queue's full size: every one of 1,024 rows, reviewed,
    // the list windowed (ADR 0057).
    name: "conversion-plan-long",
    table: (locale) => conversionWorld(locale, { status: "idle" }, MANY),
    drive: async () => {
      await answerPlans(MANY);
      await go(2);
      // The scope is a segmented row over visually hidden radios.
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await waitUntilOffered(CONVERT);
    },
    anchor: '.conversion-plan-list[data-windowed="true"]',
  },
  {
    // A running queue at its full size: the list is windowed (ADR 0057).
    name: "conversion-running-long",
    table: (locale) => conversionWorld(locale, LONG_RUN),
    drive: () => go(2),
    // Followed to the running item: the list is its own scroll box, moved off its top.
    anchor: '.conversion-run-list[data-windowed="true"] li[data-item-state="running"]',
  },
  {
    // Thermo's own picker from MS1 on two Thermo rows: planned, its loss and
    // family on the tile, and the one change in the rail (ADR 0059).
    name: "conversion-vendor-thermo",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    drive: async () => {
      await answerPlans();
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
      await chooseProcessing("vendor_centroiding_from_ms1");
      await waitUntilOffered(CONVERT);
    },
    anchor: '[data-plan-changed="processing"]',
  },
  {
    // The same picker from MS2 on a Thermo and a Shimadzu row: refused, with
    // the reason in place of the plan and Convert refused beside it.
    name: "conversion-vendor-refused",
    table: (locale) => conversionWorld(locale, { status: "idle" }, [...ROWS, LCD]),
    drive: async () => {
      await answerPlans([...ROWS, LCD]);
      await checkMembers([FIRST.handle, LCD.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
      await chooseProcessing("vendor_centroiding_from_ms2");
    },
    anchor: ".conversion-plan-pending",
  },
  {
    // The keyboard in the processing choices: two ArrowDowns from the shipped
    // value land on Thermo's MS1 row, its note read with it.
    name: "conversion-vendor-keyboard",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    keepFocus: true,
    drive: async () => {
      await answerPlans();
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
      await browser.execute(() => document.querySelector<HTMLElement>('.conversion-setting[data-axis="processing"] input:checked')?.focus());
      await browser.keys("ArrowDown");
      await browser.keys("ArrowDown");
      await frames();
    },
    anchor: '.conversion-setting[data-axis="processing"] input[value="vendor_centroiding_from_ms1"]:focus',
  },
  {
    // Every plan row on an unmeasured build labelled, and counted before Run.
    name: "conversion-plan-not-verified",
    table: (locale) => onUnmeasured(conversionWorld(locale, { status: "idle" })),
    drive: async () => {
      await answerPlansFor(ROWS, UNMEASURED);
      await checkMembers([FIRST.handle, SECOND.handle]);
      await go(2);
      await waitUntilOffered(CONVERT);
    },
    anchor: "[data-plan-not-verified]",
  },
  {
    // A labelled queue under way: the running and the waiting row say it
    // before either has a report (the label BEGIN binds).
    name: "conversion-running-not-verified",
    table: (locale) => onUnmeasured(conversionWorld(locale, STARTED_LABELLED)),
    drive: () => go(2),
    anchor: '.conversion-run-list li[data-item-state="pending"] [data-not-verified]',
  },
  {
    // Thermo's picker wrote no record of the scope asked for: its own sentence.
    name: "conversion-picker-scope-refused",
    table: (locale) => conversionWorld(locale, PICKER_REFUSED),
    drive: () => go(2),
    anchor: 'li[data-item-state="failed"] .conversion-queue-reason',
  },
  {
    // 1,024 mzML rows over the whole workspace: every excluded name, windowed.
    name: "conversion-excluded-long",
    table: (locale) => conversionWorld(locale, { status: "idle" }, MANY_MZML),
    drive: async () => {
      await go(2);
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await browser.$(".conversion-excluded-group > button").waitForExist({ timeout: 30_000 });
      await browser.$(".conversion-excluded-group > button").click();
    },
    anchor: '.conversion-excluded .conversion-name-list[data-windowed="true"]',
  },
  {
    // Add over 1,024 results, refused for a full workspace: every output it
    // did not add, and why, windowed.
    name: "conversion-adoption-refused-long",
    table: (locale) => onUnmeasured({ ...conversionWorld(locale, LONG_FINISHED, MANY), adopt_workspace_conversion_outputs: ADOPTION_REFUSED }),
    drive: async () => {
      await go(2);
      await browser.$(".conversion-adoption .conversion-actions button").waitForExist({ timeout: 30_000 });
      await browser.$(".conversion-adoption .conversion-actions button").click();
    },
    anchor: '.conversion-adoption .conversion-name-list[data-windowed="true"]',
  },
  {
    // A finished labelled queue: its rows and Add say it.
    name: "conversion-finished-not-verified",
    table: (locale) => onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)),
    drive: () => go(2),
    anchor: "#conversion-adopt-not-verified",
  },
  {
    // One output's Add under the keyboard, after Open folder (ADR 0052).
    name: "conversion-output-add-keyboard",
    table: (locale) => onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)),
    keepFocus: true,
    drive: async () => {
      await go(2);
      await browser.$(".output-open-actions button:nth-of-type(2)").waitForExist({ timeout: 30_000 });
      await browser.execute(() => document.querySelector<HTMLElement>(".output-open-actions button:nth-of-type(2)")?.focus());
      await browser.keys("Tab");
      await frames();
    },
    anchor: `${OUTPUT_ADD}:focus-visible`,
  },
  {
    // While one Add is out every Add is refused, and says why.
    name: "conversion-output-adding",
    table: (locale) => onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)),
    hold: ["adopt_workspace_conversion_output"],
    keepFocus: true,
    drive: addTheFirstOutput,
    anchor: `${OUTPUT_ADD}[aria-disabled="true"]`,
  },
  {
    // Added: its own line, the named Show in Workbench, no queue summary.
    name: "conversion-output-added",
    table: (locale) => ({ ...onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)), adopt_workspace_conversion_output: outputAnswer(ROWS, FIRST.handle, "QC_pool_01.mzML", "added") }),
    drive: addTheFirstOutput,
    anchor: ".output-open-actions button:nth-of-type(4)",
  },
  {
    // A full workspace: the output's own "not added" sentence.
    name: "conversion-output-refused-full",
    table: (locale) => ({ ...onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)), adopt_workspace_conversion_output: outputAnswer(ROWS, FIRST.handle, "QC_pool_01.mzML", "refused") }),
    drive: addTheFirstOutput,
    anchor: '.output-open-actions [role="status"]:not(:empty)',
  },
  {
    // An output the queue no longer offers: the same sentence, not the queue's.
    name: "conversion-output-refused-not-adoptable",
    table: (locale) => ({ ...onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)),
      adopt_workspace_conversion_output: { __reject: { kind: "outputs_not_adoptable", summary: "This queue has no complete finalized output eligible to add.", detail: null, retryable: false } } }),
    drive: addTheFirstOutput,
    anchor: '.output-open-actions [role="status"]:not(:empty)',
  },
  {
    // Already a row: its own line and Show in Workbench, nothing else said.
    name: "conversion-output-already",
    table: (locale) => ({ ...onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)), adopt_workspace_conversion_output: outputAnswer(ROWS, FIRST.handle, "QC_pool_01.mzML", "alreadyInWorkspace") }),
    drive: addTheFirstOutput,
    anchor: ".output-open-actions button:nth-of-type(4)",
  },
  {
    // That row removed: the line says nothing of it, no Show, Add offered again.
    name: "conversion-output-row-left",
    table: (locale) => ({ ...onUnmeasured(conversionWorld(locale, FINISHED_LABELLED)),
      adopt_workspace_conversion_output: outputAnswer(ROWS, FIRST.handle, "QC_pool_01.mzML", "alreadyInWorkspace"),
      remove_workspace_datasets: { roster: { datasets: ROWS, capacity: 1024 }, removedHandles: ["added-output"], unknownHandles: [] } }),
    drive: async () => {
      await addTheFirstOutput();
      await browser.$(".output-open-actions button:nth-of-type(4)").waitForExist({ timeout: 30_000 });
      await revealRosterRow("added-output");
      await browser.$('.grouped-roster [data-handle="added-output"] .dataset-row-name').click();
      await revealRosterRow("added-output");
      await browser.$("[data-roster-list-menu]").click();
      await browser.$("[data-roster-remove]").click();
      await browser.$('.grouped-roster [data-handle="added-output"]').waitForExist({ reverse: true, timeout: 30_000 });
      await go(2);
      await browser.$(OUTPUT_ADD).scrollIntoView({ block: "center" });
      await frames();
    },
    anchor: `${OUTPUT_ADD}:not([aria-disabled="true"])`,
  },
  {
    // A refusal naming a long output: its line wraps inside the results.
    name: "conversion-output-refused-long-name",
    table: (locale) => ({ ...onUnmeasured(conversionWorld(locale, FINISHED_LONG_NAME)), adopt_workspace_conversion_output: outputAnswer(ROWS, FIRST.handle, LONG_OUTPUT_NAME, "refused") }),
    drive: addTheFirstOutput,
    anchor: '.output-open-actions [role="status"]:not(:empty)',
  },
  {
    // Member 20 of 24 pressed: its line says so, and the status bar for the rest.
    name: "conversion-set-member-adding",
    table: (locale) => conversionWorld(locale, SET_FINISHED, [SET_ROW]),
    hold: ["adopt_workspace_conversion_output"],
    keepFocus: true,
    drive: addMemberTwenty,
    anchor: '.output-open-actions [role="status"]:not(:empty)',
  },
  {
    // Member 20 of 24 refused: on its line, where the press was, and not above.
    name: "conversion-set-member-failed",
    table: (locale) => ({ ...conversionWorld(locale, SET_FINISHED, [SET_ROW]),
      adopt_workspace_conversion_output: { __reject: { kind: "adoption_superseded", summary: "The workspace changed.", detail: null, retryable: true } } }),
    drive: addMemberTwenty,
    anchor: '.output-open-actions [role="status"]:not(:empty)',
  },
  {
    // ADR 0052's rendered check: a large SCIEX set, one Add per member.
    name: "conversion-set-finished",
    table: (locale) => conversionWorld(locale, SET_FINISHED, [SET_ROW]),
    drive: () => go(2),
    anchor: 'li[data-item-state="finalized"] .output-open-actions',
  },
  {
    // One member added, and the item's record of that (ADR 0052 decision 5).
    name: "conversion-set-member-added",
    table: (locale) => ({ ...conversionWorld(locale, SET_FINISHED, [SET_ROW]),
      adopt_workspace_conversion_output: outputAnswer([SET_ROW], SET_ROW.handle, SET_NAMES[0]!, "added") }),
    drive: addTheFirstOutput,
    anchor: ".output-open-actions button:nth-of-type(4)",
  },
  {
    // A refusal Rust calls final: its sentence, and no Describe again.
    name: "conversion-plan-refused-final",
    table: (locale) => ({ ...conversionWorld(locale, { status: "idle" }), describe_workspace_conversion_queue: { __reject: { kind: "dataset_not_convertible", summary: "That row is already mzML, so there is nothing to convert.", detail: null, retryable: false } } }),
    drive: async () => {
      await go(2);
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await browser.$(".conversion-plan-pending").waitForExist({ timeout: 30_000 });
      await frames();
      const offered = await browser.execute(() => document.querySelectorAll(".conversion-start-actions button").length);
      if (offered !== 1) throw new Error(`Describe again offered after a final refusal: ${String(offered)} buttons`);
    },
    anchor: ".conversion-plan-pending",
  },
  {
    // A failure that may pass: Describe again stays.
    name: "conversion-plan-failed-retryable",
    table: (locale) => ({ ...conversionWorld(locale, { status: "idle" }), describe_workspace_conversion_queue: { __reject: { kind: "plan_unreadable", summary: "The plan was not read.", detail: null, retryable: true } } }),
    drive: async () => {
      await go(2);
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await browser.$(".conversion-start-actions button:nth-of-type(2)").waitForExist({ timeout: 30_000 });
    },
    anchor: ".conversion-start-actions button:nth-of-type(2)",
  },
  {
    // Describe again answered with a final refusal: the keyboard is on Convert.
    name: "conversion-plan-refused-after-describe-again",
    table: (locale) => ({ ...conversionWorld(locale, { status: "idle" }), describe_workspace_conversion_queue: { __reject: { kind: "plan_unreadable", summary: "The plan was not read.", detail: null, retryable: true } } }),
    keepFocus: true,
    drive: async () => {
      await go(2);
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await browser.$("[data-describe-again]").waitForExist({ timeout: 30_000 });
      await setInvokeResult("describe_workspace_conversion_queue", { __reject: { kind: "dataset_not_convertible", summary: "That row is already mzML, so there is nothing to convert.", detail: null, retryable: false } });
      await browser.execute(() => document.querySelector<HTMLElement>("[data-describe-again]")?.focus());
      await browser.keys("Enter");
      await browser.$("[data-describe-again]").waitForExist({ reverse: true, timeout: 15_000 });
      await frames();
    },
    anchor: ".conversion-start:focus",
  },
  {
    // Its results at the queue's full size: windowed, every row labelled.
    name: "conversion-finished-long",
    table: (locale) => onUnmeasured(conversionWorld(locale, LONG_FINISHED, MANY)),
    drive: () => go(2),
    anchor: '.conversion-run-list[data-windowed="true"] [data-not-verified]',
  },
  {
    // A full queue refused for colliding names: every name, windowed.
    name: "conversion-collision-long",
    table: (locale) => conversionWorld(locale, COLLIDED, MANY),
    drive: async () => {
      await go(2);
      await expectNamesBesideTheSentence();
    },
    anchor: '.conversion-name-list[data-windowed="true"]',
  },
  {
    // The same refusal where it first shows, from describe: the names under
    // the plan's sentence, and Convert described by the sentence alone.
    name: "conversion-plan-collision-long",
    table: (locale) => ({ ...conversionWorld(locale, { status: "idle" }, MANY), describe_workspace_conversion_queue: { __reject: COLLISION } }),
    drive: async () => {
      await go(2);
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await browser.$('.conversion-name-list[data-windowed="true"]').waitForExist({ timeout: 30_000 });
      await expectNamesBesideTheSentence();
    },
    anchor: '.conversion-plan-pending ~ .conversion-name-list[data-windowed="true"]',
  },
  {
    // And from BEGIN, after a plan: the request-failure banner lists them.
    name: "conversion-begin-collision-long",
    table: (locale) => ({ ...conversionWorld(locale, { status: "idle" }, MANY), begin_workspace_conversion_queue: { __reject: COLLISION } }),
    drive: async () => {
      await answerPlans(MANY);
      await go(2);
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await waitUntilOffered(CONVERT);
      await browser.$(CONVERT).click();
      await browser.$('.conversion-notice .conversion-name-list[data-windowed="true"]').waitForExist({ timeout: 30_000 });
      await expectNamesBesideTheSentence();
    },
    anchor: '.conversion-notice .conversion-name-list[data-windowed="true"]',
  },
  {
    // An adopted output keeps its label on the roster row.
    name: "workbench-roster-not-verified",
    table: (locale) => onUnmeasured(conversionWorld(locale, { status: "idle" }, [...ROWS, ADOPTED])),
    drive: () => revealRosterRow(ADOPTED.handle),
    anchor: `.grouped-roster [data-handle="${ADOPTED.handle}"] [data-not-verified]`,
  },
  {
    // The roster's footer at its fullest (direction A 2.1): two rows checked,
    // one highlighted, and a group made so Undo shows beside the list menu
    // and Convert….
    name: "workbench-roster-footer",
    table: (locale) => conversionWorld(locale, { status: "idle" }),
    drive: async () => {
      await checkMembers([FIRST.handle, SECOND.handle]);
      await browser.$(`.grouped-roster [data-handle="${FIRST.handle}"] .dataset-row-name`).click();
      await revealRosterRow(FIRST.handle);
      await browser.$("[data-roster-list-menu]").click();
      await browser.$("[data-roster-new-group]").waitForDisplayed({ timeout: 30_000 });
      await browser.$("[data-roster-new-group]").click();
      await browser.$("#organization-group-name").setValue("QC");
      await browser.$(".group-name-dialog button[type='submit']").click();
      await browser.$(".group-name-dialog").waitForExist({ reverse: true });
      await revealRosterRow(FIRST.handle);
    },
    anchor: ".roster-foot .ui-icon-button:not([data-roster-list-menu])",
  },
  { name: "project-empty", table: emptyTable, drive: () => go(3), anchor: "[data-project-surface]" },
  { name: "project-records", table: populated, drive: () => go(3), anchor: "[data-project-surface]" },
  {
    // Save on a beta-1 project with a change: asked first, the keyboard on
    // Cancel, and the labelled reference in the list below.
    name: "project-upgrade-warning",
    table: beta1Project,
    keepFocus: true,
    drive: async () => {
      await go(3);
      await browser.$(".project-actions > button:nth-child(3)").click();
    },
    anchor: "[data-project-upgrade-cancel]:focus",
  },
  {
    // The project's Details on a labelled reference: the label under its name.
    name: "project-details-not-verified",
    table: labelledProject,
    drive: inspectLabelledReference,
    anchor: '#workbench-inspector [data-provenance="input"] [data-not-verified]',
  },
  {
    // The run that used it: the label on the link back, after its current state.
    name: "project-details-run-not-verified",
    table: labelledProject,
    drive: async () => {
      await inspectLabelledReference();
      await browser.$(`#workbench-inspector [data-provenance-link="${CAPTURED_RUN}"]`).click();
    },
    anchor: '#workbench-inspector [data-provenance="run"] [data-not-verified]',
  },
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
    // Open project… refused by Rust: the refusal in words, with the head's buttons to try again.
    name: "project-open-failed",
    table: (locale) => ({ ...emptyTable(locale), open_project: { __reject: { kind: "unreadable" } } }),
    drive: async () => {
      await go(3);
      await browser.$(".project-actions > button:nth-child(2)").click();
    },
    anchor: "[data-project-problem]",
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
  // The conversion history (ADR 0065): the rail's entry, every state of the list
  // and of one run, and the off switch in Settings.
  { name: "run-history-entry", table: (locale) => conversionWorld(locale, { status: "idle" }), drive: () => go(2), anchor: "[data-run-history-entry]" },
  { name: "run-history-loading", table: populated, hold: ["list_conversion_runs"], drive: openRunHistory, anchor: "[data-run-history-loading]" },
  { name: "run-history-empty", table: populated, drive: openRunHistory, anchor: "[data-run-history] .run-history-empty" },
  { name: "run-history-off-empty", table: runHistoryWorld(listed([], { recording: false })), drive: openRunHistory, anchor: "[data-run-history] .run-history-empty" },
  {
    name: "run-history-list",
    table: runHistoryWorld(listed([ENDED, LABELLED, INTERRUPTED, STOPPED]), found(ENDED, ENDED_ITEMS)),
    drive: openRunHistory,
    anchor: `[data-run-detail="${ENDED.runId}"] [data-run-item]`,
  },
  {
    name: "run-history-reading-run",
    table: runHistoryWorld(listed([ENDED])),
    hold: ["read_conversion_run"],
    drive: openRunHistory,
    anchor: '[data-run-read="reading"]',
  },
  {
    // Labelled on both counts, retried, and one file's failure with its code.
    name: "run-history-labelled",
    table: runHistoryWorld(listed([LABELLED]), found(LABELLED, LABELLED_ITEMS)),
    drive: openRunHistory,
    anchor: `[data-run-detail="${LABELLED.runId}"] [data-not-verified]`,
  },
  {
    // Found cut short: no end time, the running file unknown, the next one not run.
    name: "run-history-interrupted",
    table: runHistoryWorld(listed([INTERRUPTED]), found(INTERRUPTED, INTERRUPTED_ITEMS)),
    drive: openRunHistory,
    anchor: `[data-run-detail="${INTERRUPTED.runId}"] [data-run-interrupted-at]`,
  },
  {
    // What ended the whole queue, in words and by its code.
    name: "run-history-stopped",
    table: runHistoryWorld(listed([STOPPED]), found(STOPPED, STOPPED_ITEMS)),
    drive: openRunHistory,
    anchor: "[data-run-failure]",
  },
  {
    // A refusal that ended a queue which had run, as the record says it later.
    name: "run-history-ended-by-refusal",
    table: runHistoryWorld(listed([REFUSED_END]), found(REFUSED_END, REFUSED_END_ITEMS)),
    drive: openRunHistory,
    anchor: "[data-run-failure]",
  },
  {
    // A set open on its members, its finding and why it could not be added.
    name: "run-history-set",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, [SET_ITEM])),
    drive: async () => {
      await openRunHistory();
      await browser.$("[data-run-item] .conversion-item-toggle").click();
      await browser.$("[data-run-item] .conversion-item-manifest").waitForDisplayed();
    },
    anchor: "[data-run-item] .conversion-item-manifest",
  },
  {
    name: "run-history-many",
    table: runHistoryWorld(listed(MANY_RUNS), found(MANY_RUNS[0]!, MANY_ITEMS)),
    drive: openRunHistory,
    anchor: '.run-history-list[data-windowed="true"]',
  },
  {
    name: "run-history-omitted",
    table: runHistoryWorld(listed([OMITTED]), found(OMITTED, [])),
    drive: openRunHistory,
    anchor: "[data-run-items-omitted]",
  },
  {
    // Everything the list can say at once: off, a write this session owes,
    // runs it could not read and runs from a later build.
    name: "run-history-problems",
    table: runHistoryWorld(listed([ENDED], { recording: false, problem: "notWritten", unreadable: 2, newer: 1 }), found(ENDED, ENDED_ITEMS)),
    drive: openRunHistory,
    anchor: '[data-run-history-note="newer"]',
  },
  {
    name: "run-history-unavailable",
    table: runHistoryWorld({ outcome: "unavailable", problem: "unsafeDirectory" }),
    drive: openRunHistory,
    anchor: '[data-run-history-problem="unsafeDirectory"]',
  },
  {
    name: "run-history-list-refused",
    table: runHistoryWorld(REQUEST_REFUSED),
    drive: openRunHistory,
    anchor: '[data-run-history-problem="error"]',
  },
  {
    name: "run-history-not-listed",
    table: runHistoryWorld({ outcome: "unavailable", problem: "notListed" }),
    drive: openRunHistory,
    anchor: '[data-run-history-problem="notListed"]',
  },
  {
    // A later read refused with the question open: the runs stay, Clear and its
    // answer are refused with the reason beside them, and Keep still works.
    name: "run-history-clear-after-refused-read",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, ENDED_ITEMS)),
    drive: async () => {
      await openRunHistory();
      await browser.$("[data-run-item]").waitForDisplayed();
      await browser.$("[data-run-history-clear]").click();
      await setInvokeResult("list_conversion_runs", REQUEST_REFUSED);
      await browser.$("[data-run-history-refresh]").click();
    },
    anchor: '[data-run-history-problem="error"]',
  },
  {
    name: "run-history-read-rejected",
    table: runHistoryWorld(listed([ENDED]), REQUEST_REFUSED),
    drive: openRunHistory,
    anchor: '[data-run-read="error"]',
  },
  {
    name: "run-history-in-progress",
    table: runHistoryWorld(listed([RUNNING, ENDED]), found(RUNNING, RUNNING_ITEMS)),
    drive: openRunHistory,
    anchor: `[data-run-detail="${RUNNING.runId}"] [data-run-item]`,
  },
  {
    // A stop nobody could confirm: no code, because neither the queue nor its file keeps one.
    name: "run-history-stop-failed",
    table: runHistoryWorld(listed([STOP_FAILED]), found(STOP_FAILED, STOP_FAILED_ITEMS)),
    drive: openRunHistory,
    anchor: `[data-run-detail="${STOP_FAILED.runId}"] [data-run-item]`,
  },
  {
    // Every member published, and still not one set that could be added whole.
    name: "run-history-set-whole",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, [WHOLE_SET_ITEM])),
    drive: async () => {
      await openRunHistory();
      await browser.$("[data-run-item] .conversion-item-toggle").click();
      await browser.$("[data-run-item] .conversion-item-manifest").waitForDisplayed();
    },
    anchor: "[data-run-item] .conversion-item-manifest",
  },
  {
    // Too few runs to be windowed, and the page scrolls as one: the rail holds
    // its height, and the run chosen low in it is what the main column shows.
    name: "run-history-band",
    table: runHistoryWorld(listed(MANY_RUNS.slice(0, 20)), found(MANY_RUNS[15]!, ENDED_ITEMS)),
    narrowOnly: true,
    keepFocus: true,
    drive: async () => {
      await openRunHistory();
      await browser.$(`[data-run-row="${MANY_RUNS[15]!.runId}"]`).click();
      // The keyboard's ring on the row chosen, whole inside the rail's box.
      await tabFrom("[data-run-history-refresh]", 16);
    },
    anchor: `[data-run-detail="${MANY_RUNS[15]!.runId}"] [data-run-item]`,
  },
  {
    name: "run-history-read-newer",
    table: runHistoryWorld(listed([ENDED]), { outcome: "refused", problem: "newerVersion" }),
    drive: openRunHistory,
    anchor: '[data-run-read="newerVersion"]',
  },
  {
    name: "run-history-read-gone",
    table: runHistoryWorld(listed([ENDED]), { outcome: "notFound" }),
    drive: openRunHistory,
    anchor: '[data-run-read="notFound"]',
  },
  {
    // The question before Clear, the keyboard on the safe answer.
    name: "run-history-clear-ask",
    table: runHistoryWorld(listed([ENDED, RUNNING]), found(ENDED, ENDED_ITEMS)),
    drive: async () => {
      await openRunHistory();
      await browser.$("[data-run-history-clear]").click();
      await browser.$('[data-run-history-keep]:focus').waitForExist();
    },
    anchor: "[data-run-history-confirm]",
    keepFocus: true,
  },
  {
    name: "run-history-cleared-kept",
    table: runHistoryWorld(listed([RUNNING]), found(RUNNING, []), { outcome: "done", keptInProgress: 1 }),
    drive: clearRunHistory,
    anchor: "[data-run-history-clear-status]:not(:empty)",
  },
  {
    // Everything forgotten: what happened, beside why Clear is now refused.
    name: "run-history-cleared",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, ENDED_ITEMS)),
    drive: async () => {
      await clearRunHistory();
      await setInvokeResult("list_conversion_runs", listed([]));
      await browser.$("[data-run-history-refresh]").click();
      await browser.$(".run-history-empty").waitForDisplayed();
    },
    anchor: "[data-run-history-clear-status]:not(:empty)",
  },
  {
    name: "run-history-clear-failed",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, ENDED_ITEMS), { outcome: "failed", problem: "notRemoved", notRemoved: 3 }),
    drive: clearRunHistory,
    anchor: "[data-run-history-clear-problem]",
  },
  {
    name: "run-history-clearing",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, ENDED_ITEMS)),
    hold: ["clear_conversion_runs"],
    drive: clearRunHistory,
    anchor: "[data-run-history-clear-status]:not(:empty)",
  },
  {
    name: "run-history-clear-rejected",
    table: runHistoryWorld(listed([ENDED]), found(ENDED, ENDED_ITEMS), REQUEST_REFUSED),
    drive: clearRunHistory,
    anchor: "[data-run-history-clear-problem]",
  },
  { name: "settings-run-history-checking", table: populated, hold: ["list_conversion_runs"], drive: openSettings, anchor: '[data-settings-dialog] [data-run-history-setting]' },
  {
    name: "settings-run-history-ask",
    table: populated,
    drive: async () => {
      await openSettings();
      await browser.$('[data-run-history-toggle="on"]').click();
      await browser.$('[data-run-history-off-keep]:focus').waitForExist();
    },
    anchor: "[data-run-history-off-confirm]",
    keepFocus: true,
  },
  { name: "settings-run-history-off", table: runHistoryWorld(listed([], { recording: false })), drive: openSettings, anchor: '[data-run-history-toggle="off"]' },
  {
    name: "settings-run-history-failed",
    table: (locale) => ({ ...runHistoryWorld(listed([]))(locale), set_conversion_run_history_enabled: { outcome: "failed", problem: "notTurnedOff", notRemoved: 0 } }),
    drive: async () => {
      await openSettings();
      await browser.$('[data-run-history-toggle="on"]').click();
      await browser.$("[data-run-history-off-forget]").click();
    },
    anchor: "[data-run-history-setting-problem]",
  },
  {
    name: "settings-run-history-saving",
    table: populated,
    hold: ["set_conversion_run_history_enabled"],
    drive: async () => {
      await openSettings();
      await browser.$('[data-run-history-toggle="on"]').click();
      await browser.$("[data-run-history-off-forget]").click();
    },
    anchor: '[data-settings-dialog] [data-run-history-setting][aria-disabled="true"]',
  },
  {
    name: "settings-run-history-unavailable",
    table: runHistoryWorld({ outcome: "unavailable", problem: "directoryUnusable" }),
    drive: openSettings,
    anchor: '[data-settings-dialog] [data-run-history-setting][aria-disabled="true"]',
  },
  {
    name: "settings-run-history-refused",
    table: runHistoryWorld(REQUEST_REFUSED),
    drive: () => openSettings("[data-run-history-setting-retry]"),
    anchor: "[data-run-history-setting-retry]",
  },
  // Workspace restore (ADR 0061): what the start-up read found, over a first run.
  { name: "restore-loading", table: emptyTable, hold: ["read_workspace_restore"], anchor: '[data-restore="loading"]' },
  { name: "restore-offer", table: restoreTable(RESTORE_OFFER), anchor: "[data-restore-action]" },
  { name: "restore-marked", table: restoreTable(RESTORE_MARKED), anchor: "[data-restored-row]" },
  { name: "restore-expired", table: restoreTable(restored([], 3)), anchor: "[data-restore-expired]" },
  {
    // Refused like Add files, and for the same visible reason.
    name: "restore-refused-busy",
    table: restoreTable(RESTORE_OFFER),
    hold: ["inspect_backend"],
    anchor: '[data-restore-action][aria-disabled="true"]',
  },
  {
    name: "restore-put-back",
    table: (locale) => ({ ...restoreTable(RESTORE_OFFER)(locale), restore_workspace: RESTORE_ANSWER }),
    drive: async () => {
      await browser.$("[data-restore-action]").waitForClickable();
      await setInvokeResult("read_workspace_restore", restored([]));
      await browser.$("[data-restore-action]").click();
      await browser.$(`[data-handle="${MZML_ROW.handle}"]`).waitForExist();
    },
    anchor: ".shell-notices .workspace-notice-details, .shell-notices > .notice-neutral",
  },
  {
    name: "restore-read-failed",
    table: restoreTable({ __reject: { kind: "unexpected_error", summary: "The record could not be read.", detail: null, retryable: true } }),
    anchor: '[data-restore="read-failed"]',
  },
  { name: "restore-document-refused", table: restoreTable({ outcome: "refused", problem: "newerVersion", leftoverCopies: 1 }), anchor: '[data-restore="refused"]' },
  {
    name: "restore-later-writer",
    table: (locale) => ({ ...populated(locale), save_workspace_restore: { outcome: "refused", problem: "changedElsewhere" } }),
    drive: toggleTheFirstRow,
    anchor: '[data-restore="problem"]',
  },
  {
    name: "restore-too-many",
    table: (locale) => ({ ...populated(locale), read_workspace_restore: RESTORE_MARKED, save_workspace_restore: { outcome: "refused", problem: "tooManyRows" } }),
    drive: toggleTheFirstRow,
    anchor: '[data-restore="problem"]',
  },
  {
    name: "settings-restore",
    table: restoreTable(restored([], 0, 2)),
    drive: () => openRestoreSettings('[data-restore-settings="leftovers"]'),
    anchor: '[data-restore-settings="leftovers"]',
  },
  {
    name: "settings-restore-document-refused",
    table: restoreTable({ outcome: "refused", problem: "malformed", leftoverCopies: 1 }),
    drive: () => openRestoreSettings('[data-restore-settings="refused"]'),
    anchor: '[data-restore-settings="refused"]',
  },
  {
    name: "settings-restore-kept",
    table: restoreTable({ outcome: "refused", problem: "unreadable", leftoverCopies: 0 }),
    drive: () => openRestoreSettings('[data-restore-settings="refused"]'),
    anchor: '[data-restore-settings="refused"]',
  },
  {
    name: "settings-restore-unavailable",
    table: restoreTable({ outcome: "unavailable", problem: "rootUnresolved" }),
    drive: () => openRestoreSettings('[data-restore-settings="unavailable"]'),
    anchor: '[data-restore-settings="unavailable"]',
  },
];

/** The populated world, its history answering `list`, `read` and `clear`. */
function runHistoryWorld(list: unknown, read: unknown = { outcome: "notFound" }, clear: unknown = { outcome: "done", keptInProgress: 0 }) {
  return (locale: Locale) => ({ ...scenario("populated", locale), list_conversion_runs: list, read_conversion_run: read, clear_conversion_runs: clear });
}

async function openRunHistory() {
  await go(2);
  await browser.$("[data-run-history-entry]").click();
  await browser.$("[data-run-history]").waitForDisplayed();
}

async function clearRunHistory() {
  await openRunHistory();
  await browser.$("[data-run-history-clear]").click();
  await browser.$("[data-run-history-forget]").click();
}

/** Settings, at the history's switch: workspace restore sits above it, and the dialog scrolls in a short window. */
function openSettings(section = "[data-run-history-setting]") {
  return openRestoreSettings(section);
}

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
      // The centre and four points between it and the corners: an overlay in
      // a corner of the data covers it as surely as one in the middle.
      const unobstructed = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].every(([x, y]) => {
        const at = document.elementFromPoint(box.left + box.width * x!, box.top + box.height * y!);
        return at !== null && element.contains(at);
      });
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        height: Math.round(box.height),
        onScreen: box.top >= 0 && box.bottom <= innerHeight,
        unobstructed,
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
      // A windowed list holds its box and mounts a window of rows, not all of them.
      windowedLists: [...document.querySelectorAll<HTMLElement>('[data-windowed="true"]')].map((list) => ({
        list: String(list.className).split(" ").at(-1),
        height: Math.round(list.getBoundingClientRect().height),
        scrollTop: Math.round(list.scrollTop),
        mounted: list.children.length,
      })),
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
      // Beyond buttons: any visible text cut by an ellipsis or overflow
      // (headers, heads, names), and any placeholder wider than its field.
      // A middle ellipsis's head is listed too: it is a deliberate cut.
      clippedText: [...document.querySelectorAll<HTMLElement>("h1, h2, h3, th, [role='columnheader'] span, .plot-head span, .plot-head p, .ui-middle-ellipsis__head, .viewer-file-name, .roster-selection-context")]
        // A name hidden by clipping (a rail's title while its status titles it) is not cut text.
        .filter((node) => node.offsetParent !== null && !node.closest(".visually-hidden") && getComputedStyle(node).clipPath === "none" && node.scrollWidth > node.clientWidth + 1)
        .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0] ?? ""}: ${(node.textContent ?? "").trim().slice(0, 60)}`),
      // A spectrum fact that wrapped onto a line the head's height hides,
      // which a width check cannot see (FE-2 review).
      droppedFacts: [...document.querySelectorAll<HTMLElement>(".spectrum-head-facts > span")]
        .filter((node) => {
          if (node.offsetParent === null) return false;
          const box = node.parentElement!.getBoundingClientRect();
          const fact = node.getBoundingClientRect();
          return fact.bottom > box.bottom + 0.5 || fact.right > box.right + 0.5;
        })
        .map((node) => (node.textContent ?? "").trim()),
      clippedPlaceholders: [...document.querySelectorAll<HTMLInputElement>("input[placeholder]")]
        .filter((input) => {
          if (input.offsetParent === null || input.value !== "") return false;
          const style = getComputedStyle(input);
          const context = document.createElement("canvas").getContext("2d");
          if (context === null) return false;
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return context.measureText(input.placeholder).width > room + 1;
        })
        .map((input) => input.placeholder),
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
        if (stop.narrowOnly === true && width > 1050) continue;
        if (ONLY !== null && !ONLY.includes(stop.name)) continue;
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
