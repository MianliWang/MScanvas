/**
 * PM9.1's journeys J1–J6, measured on PM9.7's frozen candidate: the after side
 * of U1's and U10's comparison (`docs/phases/pm9/slice-07.md` §5, by the rules
 * of `docs/phases/pm9/baseline.md` §17.1). Run only through
 * `e2e/wdio.baseline.conf.ts`, against the frontend
 * `baseline/prepare-baseline-app.ps1` extracts from that candidate.
 *
 * Derived from the before side's driver (`pm9.1-journeys.d56b17b.e2e.ts`),
 * which stays as it ran. The two differ only where the candidate does: J2's
 * start control and the queue state Rust answers once it starts (as the PM9.4
 * spec answers it), and J4's Open result, which PM9.5 made the way from a
 * finished run to its report. The regions and the counting are
 * `journeys.ts`'s, unchanged. Every answer is a controlled fixture at the IPC boundary, at the DTO
 * level (no IPC or DTO changed in PM9): nothing was read from a file, no
 * dialog opened, no converter or engine ran. The browser stands in for every
 * native dialog with its answer.
 *
 * This file measures; it asserts only that each journey reached its end state.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { metrics } from "../support/cdp";
import { MZML_ROW } from "../support/fixtures";
import { IPC_TABLE_KEY, installIpcBoundary, setInvokeResult } from "../support/harness";
import {
  CAFFEINE,
  NO_PROJECT,
  QC_ARTIFACT,
  RESULT,
  capturedProject,
  qcProject,
  scenario,
  targetedProject,
} from "../support/pm9Scenarios";
import { ARTIFACTS, LAYERS, TYPED, project as targetedTaskProject, targetedTable } from "../support/targeted";
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
} from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { Journey, type Driver } from "./journeys";

const CANDIDATE = process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled";
let output = "";
const records: unknown[] = [];

// ---------------------------------------------------------------- the candidate's selectors

const NAV = (position: 1 | 2 | 3) => `.workbench-navigation > button:nth-child(${String(position)})`;
const ROW = (handle: string) => `.grouped-roster [data-handle="${handle}"]`;
const ROSTER_TOGGLE = '[aria-controls="workbench-roster"]';
const DETAILS_TOGGLE = '[aria-controls="workbench-inspector"]';

/** The words of the candidate's English bundle for the few controls named only by text. */
const WORDS = {
  projectOpen: "Open project…",
  projectSave: "Save",
} as const;

const driver: Driver = {
  candidate: CANDIDATE,
  regions: {
    viewer: ".viewer-column",
    chromatogram: "section.chromatogram-panel",
    spectrum: "section.spectrum-panel",
    scanTable: "section.spectrum-table-panel",
    detailsPanel: "#workbench-inspector .inspector-panel",
    detailsObject: "#workbench-inspector [data-provenance]",
    projectSurface: "[data-project-surface]",
    targetedSetup: "[data-targeted-setup]",
    targetedReport: "[data-targeted-report]",
    qcReport: "[data-qc-report]",
    conversionPanel: "section.conversion-panel",
    conversionPlan: ".conversion-plan",
    settingsDialog: "[data-settings-dialog]",
  },
  async context() {
    return browser.execute(() => {
      const shell = document.querySelector(".workbench-shell");
      const surface = shell?.getAttribute("data-surface") ?? null;
      const section =
        surface === "conversion" ? "#workbench-conversion" : surface === "project" ? "#workbench-project" : "#workbench-evidence";
      const main = document.querySelector(section);
      const markers: [string, string][] = [
        [".viewer-column", "viewer"],
        [".empty-state", "empty"],
        [".conversion-plan", "plan"],
        [".conversion-running", "queue"],
        ["[data-targeted-setup]", "targeted-setup"],
        ["[data-targeted-report]", "targeted-report"],
        ["[data-qc-report]", "qc-report"],
        ["[data-project-pending]", "unsaved-question"],
        ["[data-project-proposal]", "relink-proposal"],
        [".project-surface > .project-empty", "no-project"],
        ["[data-project-input]", "project-records"],
      ];
      const present = markers.filter(([css]) => main?.querySelector(css) !== null && main?.querySelector(css) !== undefined);
      // Below 1050 px an open panel takes the main area's place: the region
      // the reader then sees is the panel, whatever the section holds.
      const covered = main instanceof HTMLElement && main.offsetParent === null;
      const inspector = document.querySelector("#workbench-inspector");
      const described = inspector?.querySelector("[data-provenance]") ?? null;
      const viewed = document.querySelector(".dataset-row.is-active")?.getAttribute("data-handle") ?? null;
      return {
        surface,
        inspected:
          described !== null
            ? `${described.getAttribute("data-provenance") ?? ""}:${(inspector?.querySelector(".provenance-name")?.textContent ?? "").trim()}`
            : viewed === null
              ? null
              : `acquisition:${viewed}`,
        roster: shell?.getAttribute("data-roster-open") ?? null,
        details: shell?.getAttribute("data-details-open") ?? null,
        dialog: document.querySelector("[data-settings-dialog]") !== null ? "settings" : null,
        main: covered ? "covered" : present.length === 0 ? null : present.map(([, name]) => name).join("+"),
      };
    });
  },
};

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Waits until a control is present and may be pressed by either mechanism. */
async function offered(selector: string) {
  await browser.$(selector).waitForExist({ timeout: 30_000 });
  await browser.waitUntil(
    () =>
      browser.execute((css: string) => {
        const node = document.querySelector<HTMLButtonElement>(css);
        return node !== null && !node.disabled && node.getAttribute("aria-disabled") !== "true";
      }, selector),
    { timeout: 30_000, timeoutMsg: `${selector} was never offered` },
  );
}

async function press(selector: string) {
  await offered(selector);
  await browser.$(selector).click();
  await frames();
}

/** Presses the button inside `scope` whose text is `label`. */
async function pressNamed(scope: string, label: string) {
  const selector = await browser.execute(
    (css: string, name: string) => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)];
      const index = buttons.findIndex((button) => (button.textContent ?? "").trim() === name);
      if (index < 0) return null;
      buttons[index]!.setAttribute("data-pm91-target", "");
      return "[data-pm91-target]";
    },
    scope,
    label,
  );
  if (selector === null) throw new Error(`no "${label}" in ${scope}`);
  await press(selector);
  await browser.execute(() => document.querySelector("[data-pm91-target]")?.removeAttribute("data-pm91-target"));
}

/** Sets a field's text the way React hears typing: the native setter, then `input`. */
async function typeInto(selector: string, value: string) {
  await browser.$(selector).waitForExist({ timeout: 30_000 });
  await browser.execute(
    (css: string, text: string) => {
      const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(css)!;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
  await frames();
}

async function until(selector: string) {
  await browser.$(selector).waitForExist({ timeout: 30_000, timeoutMsg: `${selector} never appeared` });
}

/** Opens the page on `table` and waits for the shell to settle: preferences read, roster answered. */
async function open(table: Record<string, unknown>, width: number, height: number, after?: () => Promise<void>) {
  await metrics(width, height);
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  await readBackSavedPreferences();
  if (after !== undefined) await after();
  await offered(ROSTER_TOGGLE);
}

async function journey(name: string, viewport: string) {
  const walked = new Journey(name, viewport, driver, output);
  await walked.start();
  return walked;
}

// ---------------------------------------------------------------- J2's answers
// Copied, at the DTO level, from the PM9.4 spec's `world()` and `answerPlans()`
// (`e2e/specs/pm9.4-conversion.browser.e2e.ts`); a spec file cannot be imported.

/** The next conversion's start control (`e2e/support/conversion.ts`). */
const CONVERT = ".conversion-plan button.primary-button, .conversion-plan .conversion-start";

const AUTHORITY = settledAt(1, 1);
const OPERATION = "pm91-queue";

function vendor(index: number, fileName: string): SelectedFile {
  return { handle: `raw-${String(index)}`, fileName, byteLength: index * 52_428_800, sourceKind: "thermo_raw", relativeContext: null };
}
const RAWS = [vendor(1, "QC_pool_01.raw"), vendor(2, "Plasma_QC_batch_08_replicate_04.raw"), vendor(3, "Blank_03.raw")] as const;
const OPEN_ROW: SelectedFile = { handle: "open", fileName: "reference_run.mzML", byteLength: 4_194_304, sourceKind: "mzml", relativeContext: null };
const ROWS: readonly SelectedFile[] = [...RAWS, OPEN_ROW];

function slot(sequence: number, state: unknown) {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: AUTHORITY,
  };
}

const STARTED = {
  status: "running",
  operationId: OPERATION,
  queue: queueOf([queueItem(RAWS[0].handle, RAWS[0].fileName, { state: "running", attempts: 1 }), queueItem(RAWS[1].handle, RAWS[1].fileName)]),
};
const DONE = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf(
    [RAWS[0], RAWS[1]].map((row, index) =>
      queueItem(row.handle, row.fileName, {
        state: "finalized",
        attempts: 1,
        finalizedOutputs: [{ outputId: `pm91-output-${String(index + 1)}`, fileName: row.fileName.replace(/\.raw$/u, ".mzML") }],
        ...finalizedAttemptFacts(),
      }),
    ),
  ),
};

function conversionWorld(): Record<string, unknown> {
  const table = scenario("populated", "en");
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: ROWS, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = slot(0, { status: "idle" });
  table.begin_workspace_conversion_queue = { authority: AUTHORITY, outcome: { outcome: "reserved", reservation: { reservationId: "pm91-reservation" } } };
  table.choose_workspace_conversion_destination = slot(1, STARTED);
  return table;
}

/** Answers each plan question for what it names, as Rust's describe does. Test boundary only. */
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

// ---------------------------------------------------------------- J3's and J5's projects

const INPUT = capturedProject().inputs[0]!;
function reopenedProject(input: Record<string, unknown>, dirty = false) {
  return capturedProject({ published: true, dirty, inputs: [{ ...INPUT, ...input }] });
}

/** A saved project holding a targeted result and a QC snapshot, each with its own run and layer. */
function resultsProject() {
  const targeted = targetedProject("available");
  const qc = qcProject(true);
  return {
    ...targeted,
    inputs: [...targeted.inputs, ...qc.inputs],
    layers: [...targeted.layers, ...qc.layers],
    runs: [...targeted.runs, ...qc.runs],
    artifacts: [...targeted.artifacts, ...qc.artifacts],
  };
}

// ---------------------------------------------------------------- the journeys

describe("PM9.1 journeys J1–J6 on the candidate the baseline config serves", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.1-journeys");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "journeys-"));
    console.log(`PM9.1 journey evidence: ${output}`);
  });

  after(() => {
    writeFileSync(join(output, "journeys.json"), JSON.stringify({ candidate: CANDIDATE, records }, null, 2));
  });

  /** J1's path; `zoom` adds J1b's committed Zoom in m/z before it leaves (§17.1's amendment). */
  async function curateAndInspect(name: "J1" | "J1b", zoom: boolean) {
    const row = ROW(MZML_ROW.handle);
    await open(scenario("populated", "en"), 1366, 768);
    await until(row);
    const walked = await journey(name, "1366x768");
    await walked.step("search the list for the acquisition", "step", async () => {
      await typeInto("#dataset-roster-search", MZML_ROW.fileName.replace(/\.mzML$/u, ""));
      await browser.waitUntil(
        () =>
          browser.execute(
            (handle: string) =>
              [...document.querySelectorAll(".grouped-roster [data-handle]")].map((each) => each.getAttribute("data-handle")).join() === handle,
            MZML_ROW.handle,
          ),
        { timeoutMsg: "the search did not narrow the list to the one acquisition" },
      );
    });
    await walked.step("make it a conversion member", "step", async () => {
      await press(`${row} input[type="checkbox"]`);
      await browser.waitUntil(async () => browser.$(`${row} input[type="checkbox"]`).isSelected());
    });
    await walked.step("view it", "step", async () => {
      await press(row);
      await until("svg.chromatogram-svg");
      await until('.spectrum-table-panel [data-row-position="0"]');
    });
    const scans = await browser.execute(() => document.querySelectorAll(".spectrum-table-panel [data-source-index]").length);
    await walked.step("choose a spectrum", "decision", async () => {
      await press('.spectrum-table-panel [data-source-index="0"]');
      await until("svg.spectrum-plot");
      await browser.waitUntil(() => browser.execute(() => (document.querySelector("#spectrum-viewport-range")?.textContent ?? "").trim() !== ""));
    }, { options: scans });
    if (zoom) {
      await walked.step("zoom the spectrum in once", "step", async () => {
        await pressNamed(".spectrum-viewport-actions", "Zoom in m/z");
        await browser.waitUntil(
          () => browser.execute(() => !(document.querySelector("#spectrum-viewport-range")?.textContent ?? "").includes("full range")),
          { timeoutMsg: "Zoom in m/z did not narrow the range" },
        );
      });
    }
    await walked.step("show its summary in Details", "step", async () => {
      await press(DETAILS_TOGGLE);
      await until("#workbench-inspector .inspector-panel");
    });
    const snapshot = () =>
      browser.execute((css: string) => ({
        search: document.querySelector<HTMLInputElement>("#dataset-roster-search")?.value ?? null,
        member: document.querySelector<HTMLInputElement>(`${css} input[type="checkbox"]`)?.checked ?? null,
        viewed: document.querySelector(".dataset-row.is-active")?.getAttribute("data-handle") ?? null,
        spectrum: document.querySelector(".spectrum-table-panel .spectrum-table-row.is-selected")?.getAttribute("data-source-index") ?? null,
        range: (document.querySelector("#spectrum-viewport-range")?.textContent ?? "").trim(),
        details: document.querySelector(".workbench-shell")?.getAttribute("data-details-open") ?? null,
        rows: [...document.querySelectorAll(".grouped-roster [data-handle]")].map((each) => each.getAttribute("data-handle")),
      }), row);
    const before = await snapshot();
    await walked.step("go to Conversion & results", "step", async () => {
      await press(NAV(2));
      await until('.workbench-shell[data-surface="conversion"]');
    });
    await walked.step("come back to the Workbench", "step", async () => {
      await press(NAV(1));
      await until('.workbench-shell[data-surface="workbench"]');
      await until("svg.chromatogram-svg");
    });
    const after = await snapshot();
    for (const key of Object.keys(before) as (keyof typeof before)[]) walked.keep(key, before[key], after[key]);
    records.push(await walked.finish(after));
    expect(after.viewed).toBe(MZML_ROW.handle);
    if (zoom) expect(before.range).not.toContain("full range");
  }

  it("J1 curate and inspect, 1366x768 en", () => curateAndInspect("J1", false));

  it("J1b supplement: J1 with a committed m/z zoom, 1366x768 en", () => curateAndInspect("J1b", true));

  it("J4b supplement: a targeted draft across navigation, 1366x768 en", async () => {
    await open(targetedTable("en", targetedTaskProject()), 1366, 768);
    const walked = await journey("J4b", "1366x768");
    await walked.step("go to the Project", "step", async () => {
      await press(NAV(3));
      await until(`[data-project-targeted="${LAYERS[0]}"]`);
    });
    await walked.step("open the targeted setup on one acquisition", "decision", async () => {
      await press(`[data-project-targeted="${LAYERS[0]}"]`);
      await until("[data-targeted-setup]");
    }, { options: LAYERS.length });
    await walked.step("type the two targets", "step", async () => {
      await typeInto("[data-targeted-text]", TYPED);
    });
    const draft = () =>
      browser.execute(() => ({
        setup: document.querySelector("[data-targeted-setup]") !== null,
        text: document.querySelector<HTMLTextAreaElement>("[data-targeted-text]")?.value ?? null,
        ppm: document.querySelector<HTMLInputElement>("[data-targeted-ppm]")?.value ?? null,
        width: document.querySelector<HTMLInputElement>("[data-targeted-width]")?.value ?? null,
      }));
    const before = await draft();
    await walked.step("return Home", "step", async () => {
      await press(".workbench-home");
      await until('.workbench-shell[data-surface="workbench"]');
    });
    await walked.step("come back to the Project", "step", async () => {
      await press(NAV(3));
      await until('.workbench-shell[data-surface="project"]');
    });
    const after = await draft();
    for (const key of Object.keys(before) as (keyof typeof before)[]) walked.keep(key, before[key], after[key]);
    records.push(await walked.finish(after));
    expect(before.text).toBe(TYPED);
  });

  it("J2 convert, 1366x768 en", async () => {
    await open(conversionWorld(), 1366, 768, answerPlans);
    await until(ROW(RAWS[0].handle));
    const walked = await journey("J2", "1366x768");
    for (const raw of [RAWS[0], RAWS[1]]) {
      await walked.step(`tick ${raw.handle} for conversion`, "decision", async () => {
        await press(`${ROW(raw.handle)} input[type="checkbox"]`);
        await browser.waitUntil(async () => browser.$(`${ROW(raw.handle)} input[type="checkbox"]`).isSelected());
      }, { options: ROWS.length });
    }
    await walked.step("go to Conversion & results", "step", async () => {
      await press(NAV(2));
      await until(".conversion-plan .conversion-queue-list");
      await offered(CONVERT);
    });
    // Rust's queue state once the start is answered, as the PM9.4 spec sets it;
    // the destination's own answer already says the same.
    await setInvokeResult("get_workspace_conversion_state", slot(1, STARTED));
    await walked.step("convert, choosing the destination folder", "step", async () => {
      await press(CONVERT);
      await until('.conversion-running li[data-item-state="running"]');
    }, { dialog: true });
    // The converter finishing is not a step; its answer is the next slot read.
    await setInvokeResult("get_workspace_conversion_state", slot(2, DONE));
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll('.conversion-running li[data-item-state="finalized"]').length === 2),
      { timeout: 30_000, timeoutMsg: "the queue never showed its end" },
    );
    const end = await browser.execute(() =>
      [...document.querySelectorAll(".conversion-running li[data-item-state]")].map((item) => item.getAttribute("data-item-state")),
    );
    records.push(await walked.finish({ items: end }));
  });

  it("J3 reopen and check a project, 1366x768 en", async () => {
    const table = scenario("populated", "en");
    table.get_project_state = NO_PROJECT;
    table.open_project = reopenedProject({});
    table.check_project_links = reopenedProject({ verification: "unavailable", unavailableReason: "missingAtCheckedLocation" });
    table.propose_project_relink = reopenedProject({ verification: "unavailable", unavailableReason: "missingAtCheckedLocation", relinkProposed: true, relinkCandidateMatches: true });
    table.commit_project_relink = reopenedProject({ verification: "matchingRecordedContent" }, true);
    table.save_project = reopenedProject({ verification: "matchingRecordedContent" });
    await open(table, 1366, 768);
    const walked = await journey("J3", "1366x768");
    const input = `[data-project-input="${INPUT.id}"]`;
    await walked.step("go to the Project", "step", async () => {
      await press(NAV(3));
      await until("[data-project-surface]");
    });
    await walked.step("open the saved project", "step", async () => {
      await pressNamed(".project-header", WORDS.projectOpen);
      await until(input);
    }, { dialog: true });
    await walked.step("check its linked files", "step", async () => {
      await press("[data-project-check]");
      await until(`${input}[data-verification="unavailable"]`);
    });
    await walked.step("locate the moved file", "step", async () => {
      await press(`[data-project-relink="${INPUT.id}"]`);
      await until(`[data-project-proposal="${INPUT.id}"]`);
    }, { dialog: true });
    await walked.step("use the located file", "confirmation", async () => {
      await press(`[data-project-relink-commit="${INPUT.id}"]`);
      await until(`${input}[data-verification="matchingRecordedContent"]`);
    });
    await walked.step("save the project", "step", async () => {
      await pressNamed(".project-header", WORDS.projectSave);
      await browser.$("[data-project-unsaved]").waitForExist({ reverse: true, timeout: 30_000 });
    });
    const end = await browser.execute((css: string) => document.querySelector(css)?.getAttribute("data-verification") ?? null, input);
    records.push(await walked.finish({ verification: end, unsaved: false }));
    expect(end).toBe("matchingRecordedContent");
  });

  it("J4 targeted setup, review and run, 1366x768 en", async () => {
    await open(targetedTable("en", targetedTaskProject()), 1366, 768);
    const walked = await journey("J4", "1366x768");
    await walked.step("go to the Project", "step", async () => {
      await press(NAV(3));
      await until(`[data-project-targeted="${LAYERS[0]}"]`);
    });
    await walked.step("open the targeted setup on one acquisition", "decision", async () => {
      await press(`[data-project-targeted="${LAYERS[0]}"]`);
      await until("[data-targeted-setup]");
    }, { options: LAYERS.length });
    await walked.step("type the two targets", "step", async () => {
      await typeInto("[data-targeted-text]", TYPED);
    });
    await walked.step("review the plan", "step", async () => {
      await press("[data-targeted-review]");
      await until("[data-targeted-plan]");
    });
    await walked.step("run it", "step", async () => {
      await press("[data-targeted-run]");
      await until('[data-targeted-run-block="completed"]');
    });
    // PM9.5: a finished run offers its result; the report opens on that press.
    await walked.step("open its result", "step", async () => {
      await press(`[data-targeted-open-result="${ARTIFACTS[0]}"]`);
      await until(`[data-targeted-report="${ARTIFACTS[0]}"] [data-targeted-row]`);
    });
    records.push(await walked.finish({ report: ARTIFACTS[0] }));
  });

  it("J5 read QC and targeted results and export, 1366x768 en", async () => {
    const table = scenario("projectWithResult", "en");
    table.get_project_state = resultsProject();
    table.export_targeted_ms1_table = { status: "saved", format: "csv", fileName: "result.csv", rowCount: 2 };
    table.export_targeted_ms1_figure = { status: "saved", format: "svg", fileName: "caffeine.svg", figure: { width: 1200, height: 640, dpi: null, theme: "light" } };
    await open(table, 1366, 768);
    const walked = await journey("J5", "1366x768");
    await walked.step("go to the Project", "step", async () => {
      await press(NAV(3));
      await until(`[data-project-inspect-artifact="${RESULT}"]`);
    });
    await walked.step("open the targeted result", "step", async () => {
      await press(`[data-project-inspect-artifact="${RESULT}"]`);
      await until(`[data-targeted-report="${RESULT}"] [data-targeted-row]`);
    });
    await walked.step("draw one target", "decision", async () => {
      await press(`[data-targeted-choose="${CAFFEINE}"]`);
      await until("[data-targeted-plot] img");
    }, { options: 2 });
    await walked.step("open the table's export", "step", async () => {
      await press("[data-targeted-table-export] summary");
      await until("[data-targeted-table-export][open]");
    });
    await walked.step("export the table as CSV", "decision", async () => {
      await press('[data-targeted-table-export] [data-targeted-export="csv"]');
      await until('[data-targeted-table-export] [data-targeted-output="savedTable"]');
    }, { options: 2, dialog: true });
    await walked.step("open the figure's export", "step", async () => {
      await press("[data-targeted-figure-export] summary");
      await until("[data-targeted-figure-export][open]");
    });
    await walked.step("export the figure as SVG", "decision", async () => {
      await press('[data-targeted-figure-export] [data-targeted-export="svg"]');
      await until('[data-targeted-figure-export] [data-targeted-output="savedFigure"]');
    }, { options: 2, dialog: true });
    await walked.step("open the QC snapshot", "step", async () => {
      await press(`[data-project-inspect-artifact="${QC_ARTIFACT}"]`);
      await until(`[data-qc-report="${QC_ARTIFACT}"]`);
    });
    records.push(await walked.finish({ table: "savedTable", figure: "savedFigure", qc: QC_ARTIFACT }));
  });

  for (const [width, height] of [
    [1366, 768],
    [960, 640],
  ] as const) {
    it(`J6 Home, Settings and folding, ${String(width)}x${String(height)} en`, async () => {
      await open(scenario("populated", "en"), width, height);
      const walked = await journey("J6", `${String(width)}x${String(height)}`);
      await walked.step("go to the Project", "step", async () => {
        await press(NAV(3));
        await until('.workbench-shell[data-surface="project"]');
      });
      await walked.step("return Home", "step", async () => {
        await press(".workbench-home");
        await until('.workbench-shell[data-surface="workbench"]');
      });
      for (const [locale, label] of [
        ["zh-CN", "change the language to Chinese"],
        ["en", "change the language back to English"],
      ] as const) {
        await walked.step(`open Settings to ${label}`, "step", async () => {
          await press("[data-settings-entry]");
          await until("[data-settings-dialog]");
        });
        await walked.step(label, "decision", async () => {
          await press(`[data-settings-dialog] input[value="${locale}"]`);
        }, { options: 2 });
        await walked.step("apply", "confirmation", async () => {
          await press("[data-settings-dialog] .settings-dialog-actions .primary-button");
          await browser.$("[data-settings-dialog]").waitForExist({ reverse: true, timeout: 30_000 });
          await browser.waitUntil(() => browser.execute((lang: string) => document.documentElement.lang === lang, locale));
        });
      }
      const rosterOpen = () => browser.execute(() => document.querySelector(".workbench-shell")?.getAttribute("data-roster-open") ?? null);
      const initial = await rosterOpen();
      for (const label of ["fold or unfold the acquisitions panel", "and back"]) {
        await walked.step(label, "step", async () => {
          const was = await rosterOpen();
          await press(ROSTER_TOGGLE);
          await browser.waitUntil(async () => (await rosterOpen()) !== was);
        });
      }
      const end = {
        language: await browser.execute(() => document.documentElement.lang),
        surface: await browser.execute(() => document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null),
        roster: await rosterOpen(),
      };
      walked.keep("roster", initial, end.roster);
      records.push(await walked.finish(end));
      expect(end.language).toBe("en");
    });
  }
});
