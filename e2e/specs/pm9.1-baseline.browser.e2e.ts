/**
 * PM9.1 -- the populated-state browser baseline, with the PM9.2 context-line
 * draft on top of it, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced, exactly as the
 * M8/M9 specs run. So this is React, CSS, layout and interaction evidence about
 * the shell: what the context line says in a populated state, where each item
 * takes the reader, what survives a trip away and back, and what a settled task
 * or a replaced project leaves behind.
 *
 * It is **not** provider, engine, filesystem or persistence evidence. Every
 * answer is a controlled table written here from the repository's own fixture
 * builders: no file is read, no converter or runtime runs and no result is
 * computed. Synthetic states stay synthetic.
 *
 * The states mirror `apps/desktop/src/test/pm9Scenarios.tsx`, which cannot be
 * imported here (it mounts `App` through Testing Library, and the project
 * builders it uses import Vitest). Identifiers, names and labels are copied
 * from those builders. Where this table differs, `docs/phases/pm9/baseline.md`
 * §6 names the difference.
 *
 * Two parts, kept apart:
 * - the functional cases assert behaviour the owners already define;
 * - the observation block records geometry and keyboard samples at the PM9
 *   viewports and languages. It asserts the limits other specs already hold
 *   and, since PM9.2, the convergence limits for L10, L14–L16, L20 and L22,
 *   each named where it is asserted. Beyond those, a rectangle it records is
 *   not a verdict that the layout is acceptable, and no overflow is not
 *   acceptance.
 *
 * Status when written: authored, NOT RUN. Nothing here has compiled, been
 * discovered or passed. The PM9.2 additions are authored and NOT RUN too.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  focusedTreatment,
  heldCallers,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeResult,
  type IpcCall,
} from "../support/harness";
import { showBackendBanner } from "../support/backendBanner";
import { MZML_ROW, SETTLED_AUTHORITY, VENDOR_ROW, ipcTable } from "../support/fixtures";
import {
  SPECTRUM_PLOT,
  selectTheSpectrum,
  selectedRowPosition,
  spectrumRangeCaption,
} from "../support/viewer";
import {
  FAKE_WORKSPACE_CAPACITY,
  chosenBackend,
  collidingFile,
  finalizedAttemptFacts,
  otherCollidingFile,
  queueItem,
  queueOf,
  secondFile,
  thirdFile,
} from "../../apps/desktop/src/test/previewFixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

/** motion's development-build notice when the page asks for reduced motion. */
const REDUCED_MOTION_NOTICE = "You have Reduced Motion enabled on your device";

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** The words before a resource's first parameter: what every item of that kind starts with. */
function prefix(template: string): string {
  return template.split("{{")[0]!;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_, key: string) => values[key] ?? "");
}

// ---------------------------------------------------------------- answers

type Locale = "en" | "zh-CN";

/**
 * `pm9Scenarios.tsx`'s populated roster, as Rust answers it: where two rows
 * share a filename, Rust names the folder each was found in, and the fake
 * derives the same words from the folders the scenario gives them.
 */
const POPULATED_ROSTER = {
  datasets: [
    MZML_ROW,
    secondFile,
    thirdFile,
    { ...collidingFile, relativeContext: "batch-1" },
    { ...otherCollidingFile, relativeContext: "batch-2" },
    VENDOR_ROW,
  ],
  capacity: FAKE_WORKSPACE_CAPACITY,
};

const EMPTY_ROSTER = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };

/** One read of the conversion slot, in the shape every answer of it has. */
function conversionSlot(sequence: number, state: unknown) {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: SETTLED_AUTHORITY,
  };
}

/** `pm9Scenarios.tsx`'s `converting`: the vendor row under way. */
const RUNNING = {
  status: "running",
  operationId: "pm9-running",
  queue: queueOf([
    queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, {
      sourceKind: VENDOR_ROW.sourceKind,
      state: "running",
      attempts: 1,
    }),
  ]),
};

/**
 * The same queue, settled. The running-to-completed pair the Vitest suite
 * already drives (`backendReadingRecovery.test.tsx`), on the same operation.
 */
const SETTLED = {
  status: "terminal",
  reason: "completed",
  operationId: "pm9-running",
  queue: queueOf([
    queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName, {
      sourceKind: VENDOR_ROW.sourceKind,
      state: "finalized",
      attempts: 1,
      ...finalizedAttemptFacts(),
    }),
  ]),
};

const NO_PROJECT = {
  open: false,
  projectId: null,
  name: "",
  dirty: false,
  published: false,
  inputs: [],
  artifacts: [],
  runs: [],
  layers: [],
};

/** `projectFixtures.ts` `capturedProject()`: one reference, its file-facts run and record. */
const CAPTURED_INPUT = "11111111-2222-4111-8111-111111111111";
const CAPTURED_RUN = "ffffffff-2222-4111-8111-111111111111";
const CAPTURED_ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";

function capturedProject(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    projectId: "aaaaaaaa-0000-4111-8111-000000000001",
    name: "Test project",
    dirty: false,
    published: false,
    inputs: [
      {
        id: CAPTURED_INPUT,
        label: "QC_pool_01.mzML",
        locatorKind: "outsideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 1024 }],
        verification: "notChecked",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [CAPTURED_RUN],
        workbenchDatasetHandle: null,
      },
    ],
    artifacts: [
      {
        id: CAPTURED_ARTIFACT,
        label: "File facts: sample.mzML",
        kind: "fileFactsV1",
        observedInputCount: 1,
        observedMemberCount: 1,
        qcSnapshot: null,
        producedByRunId: CAPTURED_RUN,
        sourceInputIds: [CAPTURED_INPUT],
      },
    ],
    runs: [
      {
        id: CAPTURED_RUN,
        operation: "captureFileFactsV1",
        outcome: "completed",
        inputIds: [CAPTURED_INPUT],
        layerIds: [],
        outputArtifactIds: [CAPTURED_ARTIFACT],
        applicationVersion: "0.1.0",
        startedAt: "2026-09-22T10:00:00Z",
        finishedAt: "2026-09-22T10:00:01Z",
      },
    ],
    layers: [],
    ...overrides,
  };
}

/** `projectFixtures.ts` `targetedProject(availability)`: one layer, one completed run, its stored result. */
const DIGEST = "A".repeat(64);
const PLAN_SHA = "B".repeat(64);
const TARGETED_INPUT = "11111111-1111-4111-8111-111111111111";
const TARGETED_LAYER = "dddddddd-1111-4111-8111-111111111111";
const TARGETED_RUN = "ffffffff-7777-4111-8111-111111111111";
const RESULT = "eeeeeeee-7777-4111-8111-111111111111";
const CAFFEINE = "77777777-0000-4111-8111-000000000001";
const ABSENT = "77777777-0000-4111-8111-000000000002";

type Availability = "available" | "payloadMissing" | "payloadCorrupt";

function targetedProject(
  availability: Availability,
  options: { readonly sourceMissing?: boolean; readonly name?: string; readonly label?: string } = {},
) {
  const expectedContent = [{ role: "primary", relativeName: "", byteLength: 1024, sha256: DIGEST }];
  return {
    open: true,
    projectId: "aaaaaaaa-0000-4111-8111-000000000001",
    name: options.name ?? "Test project",
    dirty: false,
    published: true,
    inputs: [
      {
        id: TARGETED_INPUT,
        label: options.label ?? "sample.mzML",
        locatorKind: "outsideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 1024 }],
        // Browser-only variant: a check found the source gone from where it was recorded.
        verification: options.sourceMissing === true ? "unavailable" : "matchingRecordedContent",
        unavailableReason: options.sourceMissing === true ? "missingAtCheckedLocation" : null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [],
        workbenchDatasetHandle: null,
      },
    ],
    layers: [{ id: TARGETED_LAYER, sourceInputId: TARGETED_INPUT, consumedByRunIds: [TARGETED_RUN] }],
    plans: [
      {
        planSha256: PLAN_SHA,
        recipe: {
          recipe: "targetedMs1",
          recipeVersion: 1,
          adapterSha256: DIGEST,
          engineProfileSha256: DIGEST,
          runtimeManifestSha256: DIGEST,
        },
        layerId: TARGETED_LAYER,
        inputId: TARGETED_INPUT,
        expectedContent,
        parameters: { mzHalfWidthPpm: "5", expectedPeakWidthS: "6" },
        targetListSha256: "C".repeat(64),
        targets: [
          { targetId: CAFFEINE, label: "Caffeine", formula: "C8H10N4O2", neutralMass: null, rtS: "120", rtHalfWidthS: "30" },
          { targetId: ABSENT, label: "Absent", formula: "C9H9NO4", neutralMass: null, rtS: "300", rtHalfWidthS: "30" },
        ],
      },
    ],
    runs: [
      {
        id: TARGETED_RUN,
        operation: "targetedMs1V1",
        outcome: "completed",
        inputIds: [],
        layerIds: [TARGETED_LAYER],
        outputArtifactIds: [RESULT],
        applicationVersion: "0.1.0",
        startedAt: "2026-09-22T10:00:00Z",
        finishedAt: "2026-09-22T10:00:01Z",
        targetedMs1: {
          planSha256: PLAN_SHA,
          consumedContent: expectedContent,
          attempt: {
            adapterSha256: DIGEST,
            runtimeManifestSha256: DIGEST,
            interpreterSha256: DIGEST,
            sourceView: "hardLinkInWorkArea",
            engineReport: {
              python: "3.13.15",
              pyopenms: "3.5.0",
              openms: "3.5.0",
              openmsRevision: "c1370fb",
              openmsBuildTime: "2025-01-01",
            },
            loadedModules: [{ name: "pyopenms/_pyopenms_1.pyd", sha256: DIGEST }],
          },
          failure: null,
          stop: null,
        },
      },
    ],
    artifacts: [
      {
        id: RESULT,
        label: "Targeted MS1 result",
        kind: "targetedMs1ResultV1",
        observedInputCount: 0,
        observedMemberCount: 0,
        qcSnapshot: null,
        producedByRunId: TARGETED_RUN,
        sourceInputIds: [],
        targetedMs1: {
          result: {
            summary: {
              targets: 2,
              detected: 1,
              detectedAmbiguous: 0,
              shared: 0,
              suppressedByOverlap: 0,
              notDetected: 1,
              failed: 0,
            },
            noCandidateRecovery: false,
            payload: {
              manifestSha256: DIGEST,
              files: [
                { name: "rows.jsonl", byteLength: 2048, sha256: DIGEST },
                { name: "evidence.jsonl", byteLength: 4096, sha256: DIGEST },
                { name: "evidence.index.json", byteLength: 512, sha256: DIGEST },
              ],
            },
          },
          availability,
        },
      },
    ],
    resultStore: { storeFound: availability !== "payloadMissing", unreferencedResults: 0 },
  };
}

/** `detectedRow()` and `absentRow()`: the stored rows the available result pages. */
function storedRow(targetId: string, detected: boolean) {
  return {
    targetId,
    outcome: detected ? "DETECTED" : "NOT_DETECTED",
    failureReason: null,
    edgeTraceCount: 0,
    ion: {
      adduct: "[M+H]+",
      charge: 1,
      mzTheoretical: detected ? [195.0877, 196.0911] : [196.0604, 197.0638],
      isotopeProbability: [0.9, 0.1],
    },
    windows: detected
      ? { rtClosedS: [90, 150], mzOpen: [[195.0867, 195.0887], [196.0901, 196.0921]] }
      : { rtClosedS: [270, 330], mzOpen: [[196.0594, 196.0614], [197.0628, 197.0648]] },
    signal: detected
      ? { points: 3, sum: [3000, 300], max: [2000, 200], anyNonzeroPoint: true }
      : { points: 3, sum: [0, 0], max: [0, 0], anyNonzeroPoint: false },
    feature: detected
      ? {
          apexRtS: 120,
          leftS: 114,
          rightS: 126,
          rawArea: 21000,
          modelStatus: "0 (converged)",
          modelArea: 20500,
          modelFwhmS: 5.9,
          engineIntensity: 20500,
          engineIntensitySource: "modelArea",
        }
      : null,
    candidates: detected ? [{ apexRtS: 120, leftS: 114, rightS: 126, rawArea: 21000 }] : [],
    overlapWinner: false,
    relations: { sharedWith: [], suppressedBy: null, overlapRemoved: [] },
    recoveredFromEmptySelection: false,
  };
}

/** A labelled stand-in for the renderer's SVG, as in the M9.1 spec; never the renderer's output. */
const STAND_IN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640">' +
  '<rect width="1200" height="640" fill="#ffffff"/>' +
  '<text x="40" y="60" font-family="sans-serif" font-size="28" fill="#1f2328">' +
  "Fixture figure (PM9 browser stand-in, not the renderer&apos;s output)</text></svg>";

/** Browser-only variant: M8.5's QC capture over the populated roster's viewed row. */
const QC_INPUT = "11111111-9901-4111-8111-111111111111";
const QC_LAYER = "dddddddd-9901-4111-8111-111111111111";
const QC_RUN = "ffffffff-9901-4111-8111-111111111111";
const QC_ARTIFACT = "eeeeeeee-9901-4111-8111-111111111111";

/** M8.5's controlled snapshot; no build and no acquisition produced it. */
const QC_SNAPSHOT = {
  totalSpectrumCount: 12_345,
  msLevelCounts: [
    { kind: "level", msLevel: 2, spectrumCount: 4_000 },
    { kind: "other", spectrumCount: 345 },
    { kind: "level", msLevel: 1, spectrumCount: 8_000 },
  ],
  chromatogramCount: { kind: "notReported" },
  retentionTime: {
    kind: "reported",
    minimum: { value: "0.1", unit: "notEmitted" },
    at25PercentBasePeakIntensity: { value: "12.345678901234567", unit: "notEmitted" },
    at50PercentBasePeakIntensity: { value: "0.30000000000000004", unit: "notEmitted" },
    at75PercentBasePeakIntensity: { value: "7.7", unit: "notEmitted" },
    maximum: { value: "123.456", unit: "notEmitted" },
  },
  producer: {
    tool: "msaccess",
    executableSha256: "A1".repeat(32),
    release: "3.0.26204",
    buildDate: null,
    sourceRevision: "a09eea9",
  },
};

function qcProject(captured: boolean) {
  return {
    open: true,
    projectId: "aaaaaaaa-0000-4111-8111-000000000001",
    name: "Test project",
    dirty: captured,
    published: true,
    inputs: [
      {
        id: QC_INPUT,
        label: MZML_ROW.fileName,
        locatorKind: "insideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
        verification: "matchingRecordedContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [],
        workbenchDatasetHandle: MZML_ROW.handle,
      },
    ],
    artifacts: captured
      ? [
          {
            id: QC_ARTIFACT,
            label: `QC summary: ${MZML_ROW.fileName}`,
            kind: "acquisitionQcSnapshotV1",
            observedInputCount: 0,
            observedMemberCount: 0,
            qcSnapshot: QC_SNAPSHOT,
            producedByRunId: QC_RUN,
            sourceInputIds: [],
          },
        ]
      : [],
    runs: captured
      ? [
          {
            id: QC_RUN,
            operation: "captureAcquisitionQcSnapshotV1",
            outcome: "completed",
            inputIds: [],
            layerIds: [QC_LAYER],
            outputArtifactIds: [QC_ARTIFACT],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-22T11:00:00Z",
            finishedAt: "2026-09-22T11:00:00Z",
          },
        ]
      : [],
    layers: [{ id: QC_LAYER, sourceInputId: QC_INPUT, consumedByRunIds: captured ? [QC_RUN] : [] }],
  };
}

function preferences(locale: Locale) {
  return {
    schemaVersion: 1,
    appearance: { locale, density: "comfortable" },
    layout: { roster: "automatic", details: "automatic" },
  };
}

type Scenario =
  | "populated"
  | "converting"
  | "projectWithResult"
  | "resultPayloadMissing"
  | "resultPayloadCorrupt"
  | "resultSourceAndRuntimeUnavailable"
  | "qcCapture"
  | "busyInspected";

/**
 * One answer table per state. The first five mirror `pm9Scenarios.tsx` by
 * name; the last three are browser-only variants named in baseline.md §6.
 */
function scenario(name: Scenario, locale: Locale = "en"): Record<string, unknown> {
  const table: Record<string, unknown> = ipcTable();
  table.begin_project_job = { operationId: "project-job-1" };
  table.cancel_project_job = { outcome: "cancelled" };
  table.get_targeted_ms1_runtime = { newRuns: "available" };
  // A working native drop subscription, as M7.2 answers it. The shared
  // table's `null` makes the shell report drop as unavailable, which is true
  // of that answer but not of the state these scenarios describe, and its
  // notice would take height from every geometry reading.
  table.subscribe_workspace_drop_updates = { reservationId: "pm9-browser-reservation" };
  table.read_targeted_ms1_rows = { total: 2, offset: 0, rows: [storedRow(CAFFEINE, true), storedRow(ABSENT, false)] };
  table.read_targeted_ms1_evidence = { targetId: CAFFEINE, traces: [] };
  table.preview_targeted_ms1_figure = { svg: STAND_IN_SVG, specId: "pm9-stand-in", width: 1200, height: 640 };
  if (locale !== "en") {
    table.load_ui_preferences = { outcome: "loaded", revision: 1, preferences: preferences(locale) };
    table.save_ui_preferences = { outcome: "saved", revision: 2, preferences: preferences(locale) };
  }
  switch (name) {
    case "populated":
      table.get_workspace_roster = POPULATED_ROSTER;
      table.get_project_state = capturedProject();
      return table;
    case "converting":
      table.get_workspace_roster = POPULATED_ROSTER;
      table.get_project_state = capturedProject();
      table.get_workspace_conversion_state = conversionSlot(1, RUNNING);
      return table;
    case "projectWithResult":
    case "resultPayloadMissing":
    case "resultPayloadCorrupt": {
      const availability: Availability =
        name === "projectWithResult" ? "available" : name === "resultPayloadMissing" ? "payloadMissing" : "payloadCorrupt";
      table.get_workspace_roster = EMPTY_ROSTER;
      table.get_project_state = targetedProject(availability);
      return table;
    }
    case "resultSourceAndRuntimeUnavailable":
      table.get_workspace_roster = EMPTY_ROSTER;
      table.get_project_state = targetedProject("available", { sourceMissing: true });
      table.get_targeted_ms1_runtime = { newRuns: "runtimeUnavailable" };
      return table;
    case "qcCapture":
      table.get_workspace_roster = POPULATED_ROSTER;
      table.get_project_state = qcProject(false);
      table.capture_project_qc_summary = { project: qcProject(true), artifactId: QC_ARTIFACT };
      return table;
    case "busyInspected":
      // A synthetic composite a reader can reach: a conversion under way while
      // a stored result is inspected, with long user-written names.
      table.get_workspace_roster = POPULATED_ROSTER;
      table.get_workspace_conversion_state = conversionSlot(1, RUNNING);
      table.get_project_state = targetedProject("available", {
        name: `${"Plasma_QC_batch_08_".repeat(4)}study`,
        label: `${"Plasma_QC_batch_08_".repeat(7)}replicate_04.mzML`,
      });
      return table;
  }
}

// ---------------------------------------------------------------- driving

async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw Error("Owned ChromeDriver port missing");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, params }),
  });
  const data = (await response.json()) as { value?: Record<string, unknown> };
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data));
  return data.value ?? {};
}

/** The M8.2/M9.1 viewport helper: DPR fixed at 1, waiting on the CSS size only. */
async function metrics(width: number, height: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await browser.waitUntil(() =>
    browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
  );
}

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function open(name: Scenario, locale: Locale = "en") {
  await installIpcBoundary(scenario(name, locale));
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
}

function surface(): Promise<string | null> {
  return browser.execute(
    () => document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null,
  ) as Promise<string | null>;
}

function contextText(id: string): Promise<string | null> {
  return browser.execute(
    (item: string) => document.querySelector(`[data-shell-context="${item}"]`)?.textContent ?? null,
    id,
  ) as Promise<string | null>;
}

async function waitForContext(id: string, expected: (text: string | null) => boolean, what: string) {
  await browser.waitUntil(async () => expected(await contextText(id)), {
    timeout: 15_000,
    timeoutMsg: `context item ${id}: ${what}`,
  });
}

/** Activates one context item with a real pointer click. */
async function activate(id: string) {
  await browser.$(`[data-shell-context="${id}"]`).click();
}

/** A header destination, found by its visible name as M9.1 finds it. */
async function navigate(names: readonly string[]) {
  await browser.execute((labels: readonly string[]) => {
    [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => labels.includes(button.textContent ?? ""))
      ?.click();
  }, names);
}

async function home() {
  await browser.$(`button[aria-label="${en.home}"]`).click();
}

/**
 * The scope as the Conversion surface resolves it, in the context line's words:
 * the checked scope and the eligible count from its own summary. `null` where
 * the surface states no scope.
 */
function ownedScope(): Promise<string | null> {
  return browser.execute(
    (selected: string, all: string, template: string) => {
      const checked = document.querySelector<HTMLInputElement>('input[name="conversion-scope"]:checked');
      const eligible = /(\d+) eligible/u.exec(document.querySelector("#conversion-scope-summary")?.textContent ?? "")?.[1];
      if (checked === null || eligible === undefined) return null;
      return template.replace("{{scope}}", checked.value === "all" ? all : selected).replace("{{eligible}}", eligible);
    },
    en.m74CnvSelected,
    en.m74CnvAll,
    en.shellContextScope,
  ) as Promise<string | null>;
}

/**
 * What the processing scope is made of: each roster row's conversion
 * membership, the chosen scope and the Conversion surface's own counts. Read
 * from every mounted surface, whichever is shown.
 */
function membership(): Promise<unknown> {
  return browser.execute(() => ({
    rows: [...document.querySelectorAll<HTMLInputElement>('.grouped-roster input[type="checkbox"]')].map((box) => [
      box.getAttribute("aria-label"),
      box.checked,
      box.indeterminate,
    ]),
    scope: document.querySelector<HTMLInputElement>('input[name="conversion-scope"]:checked')?.value ?? null,
    counts: document.querySelector("#conversion-scope-summary")?.textContent ?? null,
    selection: document.querySelector(".roster-selection-context")?.textContent ?? null,
  }));
}

/** Which destination the navigation marks as the current page. */
function currentDestination(): Promise<string | null> {
  return browser.execute(
    () => document.querySelector(".workbench-navigation > button[aria-current='page']")?.textContent ?? null,
  ) as Promise<string | null>;
}

/**
 * Reads an owner may make without the reader asking for anything, each stated
 * read-only in its `lib.rs` doc comment: the conversion slot ("launches nothing
 * and changes nothing"), targeted progress and runtime ("read-only"), the queue
 * description ("no gate, no picker, no reservation, no process") and the
 * spectrum's screen projection ("launches no process, re-reads no
 * acquisition"). No owner promises a trip between surfaces issues none of
 * them, so they are recorded rather than failed.
 *
 * Not here, on purpose: `read_conversion_configuration` may run an
 * `msconvert --help` probe; `inspect_backend` checks an installation;
 * `preview_figure` carries no read-only statement; `get_project_state` would
 * replace what the Project surface shows; and a source read
 * (`open_mzml_preview`, `load_selected_spectrum`) or a stored-result read
 * repeated on return is a duplicate, not a projection.
 */
const READ_ONLY = [
  "get_workspace_conversion_state",
  "get_targeted_ms1_progress",
  "get_targeted_ms1_runtime",
  "describe_workspace_conversion_queue",
  "project_selected_spectrum",
] as const;

/**
 * What was asked since `before` that is not one of those reads: a task, a
 * mutation, a source read or a repeated stored-result read. Every command is
 * recorded in the evidence, read-only ones included.
 */
async function unexpectedSince(label: string, before: readonly IpcCall[]): Promise<string[]> {
  const commands = (await ipcCalls()).slice(before.length).map((call) => call.command);
  evidence.push({ label: `${label}-requests`, commands });
  return commands.filter((command) => !(READ_ONLY as readonly string[]).includes(command));
}

/** Views the populated roster's mzML row by the Workbench's own action, as M8.5 does. */
async function viewTheRow() {
  const row = `.grouped-roster [data-handle="${MZML_ROW.handle}"]`;
  if (!(await browser.$(row).isDisplayed())) {
    await browser.$('[aria-controls="workbench-roster"]').click();
  }
  await browser.$(row).click();
  await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
}

/** Each roster row as the reader's state leaves it: order, highlight, viewed, membership. */
function rosterState() {
  return browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".grouped-roster [data-handle]")].map((row) => {
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      return [
        row.getAttribute("data-handle"),
        row.getAttribute("aria-selected"),
        row.classList.contains("is-active"),
        box === null ? null : box.checked,
      ];
    }),
  );
}

/**
 * Puts focus on the header's first control, where a Tab walk starts.
 *
 * Blurring is not enough: Chrome continues a Tab walk from the last node that
 * was clicked, which after a press in the main region is past the header.
 */
async function startAtHome() {
  await browser.execute(() => document.querySelector<HTMLElement>(".workbench-home")?.focus());
}

/**
 * Tabs from Home until a context item has focus.
 *
 * Bounded: an item never reached in `limit` presses is a keyboard-access
 * finding, not something to wait out.
 */
async function tabTo(id: string, limit = 40): Promise<boolean> {
  await startAtHome();
  for (let step = 0; step < limit; step += 1) {
    await browser.keys("Tab");
    const at = await browser.execute(
      () => document.activeElement?.getAttribute("data-shell-context") ?? null,
    );
    if (at === id) return true;
  }
  return false;
}

// ---------------------------------------------------------------- observation

/**
 * Waits until the shell fills the emulated viewport, and records how long.
 *
 * `metrics()` waits on `innerWidth`/`innerHeight`, yet a read taken right after
 * can still see the previous height: baseline §7.4 recorded one such reading at
 * `a0783bb`, and PM9.2's acceptance run another (the main region 964 px tall at
 * a 768 px viewport, while the screenshot taken just after showed the settled
 * layout). The shell is `100vh`, so its height matching the viewport's is the
 * settle. One that never comes is a failure, not something to wait out.
 */
async function settled(label: string) {
  const started = Date.now();
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const shell = document.querySelector(".workbench-shell");
        return shell !== null && Math.abs(shell.getBoundingClientRect().height - innerHeight) <= 1;
      }),
    { timeout: 10_000, interval: 50, timeoutMsg: `${label}: the shell never filled the resized viewport` },
  );
  evidence.push({ label: `${label}-settle`, waitedMs: Date.now() - started });
}

/**
 * What one frame is evidence for. Recorded, and judged here only against the
 * limits other specs already hold and the PM9.2 limits named below.
 */
async function observe(label: string) {
  await settled(label);
  const measured = await browser.execute(() => {
    const rect = (element: Element | null) => {
      if (element === null || (element as HTMLElement).hidden) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const shell = document.querySelector(".workbench-shell");
    const header = document.querySelector(".workbench-header");
    const main = ["#workbench-evidence", "#workbench-conversion", "#workbench-project"]
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find((element) => element !== null && !element.hidden) ?? null;
    const items = [...document.querySelectorAll<HTMLElement>("[data-shell-context]")];
    // Whether an item shows an ellipsis at all. `scrollWidth` is a whole
    // number, and a sub-pixel shrink is still an ellipsis on screen, so the
    // item's text is measured against its content box. Measured on an
    // unconstrained copy beside the item, so the copy has the item's own
    // cascade -- font, language, density -- and nothing is re-derived.
    const shape = (item: HTMLElement) => {
      const style = getComputedStyle(item);
      const content =
        item.getBoundingClientRect().width -
        ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
          .map((key) => parseFloat(style[key as "paddingLeft"]) || 0)
          .reduce((sum, value) => sum + value, 0);
      const copy = item.cloneNode(true) as HTMLElement;
      copy.removeAttribute("data-shell-context");
      copy.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;width:max-content;min-width:0;max-width:none";
      item.after(copy);
      const range = document.createRange();
      range.selectNodeContents(copy);
      const natural = range.getBoundingClientRect().width;
      const ellipsized = natural > content + 0.01;
      // What stays readable in front of the ellipsis: the longest prefix that
      // fits beside one, in the item's own font.
      const full = item.textContent ?? "";
      let visible = full;
      if (ellipsized) {
        copy.textContent = "…";
        range.selectNodeContents(copy);
        const mark = range.getBoundingClientRect().width;
        copy.textContent = full;
        const text = copy.firstChild;
        visible = "";
        for (let end = 1; text !== null && end <= full.length; end += 1) {
          range.setStart(text, 0);
          range.setEnd(text, end);
          if (range.getBoundingClientRect().width + mark > content + 0.01) break;
          visible = full.slice(0, end);
        }
      }
      copy.remove();
      return { natural, content, ellipsized, visible, floor: parseFloat(style.minWidth) || 0 };
    };
    const shapes = items.map(shape);
    // What the header leaves for the work: the band below it, the main region's
    // share of that band, and how much of each evidence panel is on screen
    // without scrolling. The second header line costs height here, most of all
    // at 960x640, so this is recorded beside the header's own size.
    const headerBottom = header === null ? 0 : header.getBoundingClientRect().bottom;
    const mainBox = main === null ? null : main.getBoundingClientRect();
    const onScreen = (box: DOMRect) => {
      const top = Math.max(box.top, mainBox?.top ?? 0, 0);
      const bottom = Math.min(box.bottom, mainBox?.bottom ?? innerHeight, innerHeight);
      return Math.max(0, bottom - top);
    };
    const panels = [
      ".chromatogram-panel",
      ".spectrum-panel",
      ".spectrum-table-panel",
      "[data-targeted-report]",
      "[data-qc-report]",
      ".conversion-running",
    ]
      .map((selector) => ({ selector, element: document.querySelector<HTMLElement>(selector) }))
      .filter(({ element }) => element !== null && main !== null && main.contains(element));
    return {
      css: { width: innerWidth, height: innerHeight },
      workArea: {
        top: headerBottom,
        height: innerHeight - headerBottom,
        notices: rect(document.querySelector(".shell-notices")),
        mainOnScreen: mainBox === null ? 0 : onScreen(mainBox),
      },
      evidencePanels: panels.map(({ selector, element }) => {
        const box = element!.getBoundingClientRect();
        return { selector, top: box.top, height: box.height, onScreen: onScreen(box) };
      }),
      lang: document.documentElement.lang,
      surface: shell?.getAttribute("data-surface") ?? null,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      contextLine: items.length > 0,
      header: rect(header),
      contextBar: rect(document.querySelector(".workbench-context-bar")),
      shellContext: rect(document.querySelector(".shell-context")),
      contextItems: items.map((item, index) => ({
        id: item.getAttribute("data-shell-context"),
        priority: item.getAttribute("data-priority"),
        text: item.textContent,
        truncated: item.scrollWidth > item.clientWidth,
        ...shapes[index]!,
        ...rect(item),
      })),
      contextRows: new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size,
      dropHint: rect(document.querySelector(".workbench-header .workspace-drop-hint")),
      backendToggle: rect(document.querySelector("[data-backend-toggle]")),
      regions: {
        roster: rect(document.querySelector("#workbench-roster")),
        main:
          main === null
            ? null
            : { id: main.id, ...rect(main), clientHeight: main.clientHeight, scrollHeight: main.scrollHeight },
        inspector: rect(document.querySelector("#workbench-inspector")),
      },
      // Who owns the vertical overflow (L22): each scroll region's own
      // overflow and its scroll extent, the roster list included.
      scrollOwners: [
        "#workbench-roster",
        ".dataset-roster-list",
        "#workbench-evidence",
        "#workbench-conversion",
        "#workbench-project",
        "#workbench-inspector",
      ].map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element === null || element.hidden || element.getClientRects().length === 0
          ? { selector, shown: false }
          : {
              selector,
              shown: true,
              overflowY: getComputedStyle(element).overflowY,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            };
      }),
      outerScroll: {
        vertical: document.documentElement.scrollHeight - innerHeight,
        horizontal: document.documentElement.scrollWidth - innerWidth,
      },
      headerControls: [...(header?.querySelectorAll<HTMLElement>("button") ?? [])].map((button) => ({
        name: button.getAttribute("aria-label") ?? (button.textContent ?? "").trim(),
        context: button.getAttribute("data-shell-context"),
        ...rect(button),
      })),
      pathsOnScreen: (document.body.innerText.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({
    label,
    kind: "Observation only. React/mock-IPC layout evidence over synthetic answers; not a golden and not an acceptance.",
    candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled",
    ...measured,
  });

  // Limits other specs already hold. No sideways scroll is recorded as a
  // floor, not as acceptance.
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  expect(measured.outerScroll.horizontal).toBeLessThanOrEqual(1);
  for (const control of measured.headerControls) {
    if (control.x === undefined || control.width === undefined) continue;
    expect(control.x).toBeGreaterThanOrEqual(0);
    expect(control.x + control.width).toBeLessThanOrEqual(measured.css.width + 1);
  }
  const line = measured.shellContext;
  for (const item of measured.contextItems) {
    // The design system's compact control minimum, which the draft claims.
    expect(item.height ?? 0).toBeGreaterThanOrEqual(31.5);
    // An operation's status is never cut behind a long name (PM9.2 L14–L16):
    // not ellipsized itself, and not pushed past the line, which clips.
    if (item.priority === "1" && line !== null) {
      expect(item.truncated).toBe(false);
      expect(item.ellipsized).toBe(false);
      expect(item.x ?? 0).toBeGreaterThanOrEqual(line.x - 1);
      expect((item.x ?? 0) + (item.width ?? 0)).toBeLessThanOrEqual(line.x + line.width + 1);
    }
  }
  // Rank decides who gives way first (L14–L16): an item shows an ellipsis
  // only once every lower-ranked item is down to its floor. Reported as the
  // pairs that break it, so a failure names them.
  const outOfOrder = measured.contextItems.flatMap((higher) =>
    higher.priority === "1" || !higher.ellipsized
      ? []
      : measured.contextItems
          .filter((lower) => Number(lower.priority) > Number(higher.priority) && (lower.width ?? 0) > lower.floor + 1)
          .map((lower) => `${label}: ${higher.id} ellipsized while ${lower.id} is ${String(lower.width)} px over a ${String(lower.floor)} px floor`),
  );
  expect(outOfOrder).toEqual([]);
  // The drop hint gives way before the context does (L14–L16): no item shows
  // an ellipsis while the hint still has width to give.
  if (measured.contextItems.some((item) => item.priority !== "1" && item.ellipsized)) {
    expect(measured.dropHint?.width ?? 0).toBeLessThanOrEqual(1);
  }
  // The header's second line stays one row (L14–L16): the context, the folded
  // backend reading and the drop hint all fit the bar's height, so nothing
  // has wrapped below them.
  if (measured.contextBar !== null) {
    const tallest = Math.max(
      ...[measured.dropHint, measured.backendToggle, ...measured.contextItems].map((box) => box?.height ?? 0),
    );
    expect(measured.contextBar.height).toBeLessThanOrEqual(tallest + 1);
  }
  // The document keeps no height of its own that the body cannot scroll: every
  // region owns its content's overflow (L22).
  expect(measured.outerScroll.vertical).toBeLessThanOrEqual(1);
  // Both observed states have a usable installation and nothing else to say,
  // so the notices track reserves no band (L10).
  expect(measured.workArea.notices?.height ?? 0).toBeLessThanOrEqual(1);
  expect(measured.backendToggle).not.toBe(null);
  return measured;
}

/**
 * A frame for a surface-level judgement (L1): its screenshot, the shown
 * surface's title and region name, and the primary actions on screen in it.
 * Recorded; the case decides what it asserts.
 */
async function surfaceFrame(label: string) {
  await settled(label);
  const measured = await browser.execute(() => {
    const main =
      ["#workbench-evidence", "#workbench-conversion", "#workbench-project"]
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find((element) => element !== null && !element.hidden) ?? null;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const title = main?.querySelector("h1.surface-title") ?? null;
    return {
      css: { width: innerWidth, height: innerHeight },
      surface: document.querySelector(".workbench-shell")?.getAttribute("data-surface") ?? null,
      region: main?.id ?? null,
      regionName:
        main === null ? null : (document.getElementById(main.getAttribute("aria-labelledby") ?? "")?.textContent ?? null),
      title: title === null ? null : { text: title.textContent, ...box(title) },
      primaries: [...(main?.querySelectorAll<HTMLButtonElement>(".primary-button") ?? [])]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => ({ text: button.textContent, disabled: button.disabled, ...box(button) })),
      // The surface owns its own vertical overflow (L22).
      regionScroll:
        main === null
          ? null
          : { overflowY: getComputedStyle(main).overflowY, clientHeight: main.clientHeight, scrollHeight: main.scrollHeight },
      outerScroll: {
        vertical: document.documentElement.scrollHeight - innerHeight,
        horizontal: document.documentElement.scrollWidth - innerWidth,
      },
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({ label, kind: "Observation only.", candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled", ...measured });
  // The document keeps no height or width of its own; what does not fit the
  // surface is reached through the surface's own scroll (L22).
  expect(measured.outerScroll.vertical).toBeLessThanOrEqual(1);
  expect(measured.outerScroll.horizontal).toBeLessThanOrEqual(1);
  if (measured.regionScroll !== null && measured.regionScroll.scrollHeight > measured.regionScroll.clientHeight + 1) {
    expect(["auto", "scroll"]).toContain(measured.regionScroll.overflowY);
  }
  return measured;
}

/**
 * Tabs through the header once, from Home, and records what each stop looked
 * like. Home itself was focused by script, so its treatment is not sampled.
 */
async function keyboardSample(label: string, limit = 40) {
  await startAtHome();
  const stops: unknown[] = [];
  let entered = false;
  for (let step = 0; step < limit; step += 1) {
    await browser.keys("Tab");
    const at = await browser.execute(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active === null || active === document.body) return null;
      const box = active.getBoundingClientRect();
      return {
        inHeader: active.closest(".workbench-header") !== null,
        context: active.getAttribute("data-shell-context"),
        name: active.getAttribute("aria-label") ?? (active.textContent ?? "").trim(),
        refused: active.getAttribute("aria-disabled") === "true",
        inViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      };
    });
    if (at === null) continue;
    if (!at.inHeader) {
      if (entered) break;
      continue;
    }
    entered = true;
    stops.push({ ...at, treatment: await focusedTreatment() });
  }
  evidence.push({ label: `${label}-keyboard`, kind: "Observation only.", stops });
  return stops as { context: string | null; name: string; refused: boolean; treatment: { visible: boolean } }[];
}

// ---------------------------------------------------------------- cases

describe("PM9.1 browser baseline and the PM9.2 context line, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.1");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.1 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
    // CDP overrides outlive a test; the next one starts from no emulated media.
    await cdp("Emulation.setEmulatedMedia", { features: [] });
    evidence.push({
      test: this.currentTest?.title,
      state: this.currentTest?.state,
      console: await consoleEntries(),
    });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${evidence.length}.png`));
      evidence.push({
        failedDocument: await browser.execute(() => document.body.innerText.slice(0, 8000)),
      });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  describe("functional (mock-backed)", () => {
    it("PM9-B1 names each fact from its owner, and every item only changes the surface", async () => {
      await metrics(1920, 1080);
      await open("populated");
      await viewTheRow();
      await selectTheSpectrum(0);
      await navigate([en.projectSurface]);
      await browser.$(`button[aria-label="${fill(en.provenanceInspectInput, { name: "QC_pool_01.mzML" })}"]`).click();
      await waitForContext("inspecting", (text) => text === fill(en.shellContextInspecting, { name: "QC_pool_01.mzML" }), "names the inspected reference");

      // Each item reads its owner: the project session, the viewer, the scope
      // the Conversion surface resolves, and what Details describes.
      expect(await contextText("project")).toBe(fill(en.shellContextProject, { name: "Test project" }));
      expect(await contextText("viewing")).toMatch(new RegExp(`^${prefix(en.shellContextViewing)}QC_pool_01\\.mzML`, "u"));
      // The scope bears on a conversion being set up, so the Project surface
      // leaves it out (PM9.2 L14–L16); the route below reaches it from the
      // Workbench, where it is shown.
      expect(await contextText("conversionScope")).toBe(null);
      expect(await contextText("conversionActivity")).toBe(null);
      expect(await contextText("projectActivity")).toBe(null);

      const before = await ipcCalls();
      const scopeBefore = await membership();
      const routes = [
        ["viewing", "workbench", en.workbench],
        ["conversionScope", "conversion", en.conversionTask],
        ["project", "project", en.projectSurface],
        ["viewing", "workbench", en.workbench],
        ["inspecting", "project", en.projectSurface],
      ] as const;
      for (const [id, target, destination] of routes) {
        await activate(id);
        expect(await surface()).toBe(target);
        expect(await currentDestination()).toBe(destination);
        // Page-sensitive, not owner-sensitive: where the scope bears on the
        // task, the line states the one the Conversion surface resolves; on
        // the Project surface it is absent. Either way, hiding it changes
        // nothing it is made of.
        if (target === "project") {
          expect(await contextText("conversionScope")).toBe(null);
        } else {
          const owned = await ownedScope();
          expect(owned).not.toBe(null);
          expect(await contextText("conversionScope")).toBe(owned);
        }
        expect(await membership()).toEqual(scopeBefore);
      }
      // Still the same inspected record, where Details describes it.
      expect(await browser.$('#workbench-inspector [data-provenance="input"]').isDisplayed()).toBe(true);

      // Home, then an item by keyboard: real focus, a real Enter.
      await home();
      expect(await surface()).toBe("workbench");
      expect(await tabTo("project")).toBe(true);
      await browser.keys("Enter");
      expect(await surface()).toBe("project");
      const ring = await focusedTreatment();
      evidence.push({ label: "pm9-b1-context-focus", ...ring });
      expect(ring.visible).toBe(true);

      // Nothing was imported, run, captured, saved, exported, retried or
      // cancelled, and no source or stored result was read again. Documented
      // read-only reads are recorded, not failed.
      expect(await unexpectedSince("pm9-b1", before)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B2 keeps the roster, the viewed scan and the committed m/z view across surfaces", async () => {
      await metrics(1920, 1080);
      await open("populated");
      await viewTheRow();
      // A session-only change of the reader's own: one more row for conversion.
      await browser.$(`.grouped-roster [data-handle="${secondFile.handle}"] input[type="checkbox"]`).click();
      await selectTheSpectrum(0);
      await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
      await browser.$(`button=${en.viewerMzZoomIn}`).click();
      await browser.waitUntil(async () => !(await spectrumRangeCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "Zoom in m/z did not commit a narrower view",
      });
      await frames();

      const held = async () => ({
        roster: await rosterState(),
        scan: await selectedRowPosition(),
        view: await spectrumRangeCaption(),
        viewing: await contextText("viewing"),
        scope: await contextText("conversionScope"),
      });
      const before = await held();
      const calls = await ipcCalls();

      await activate("conversionScope");
      expect(await surface()).toBe("conversion");
      await navigate([en.projectSurface]);
      expect(await surface()).toBe("project");
      await activate("viewing");
      expect(await surface()).toBe("workbench");

      // Navigation changed what is shown, not what is held.
      expect(await held()).toEqual(before);
      expect(await unexpectedSince("pm9-b2", calls)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B3 keeps a targeted setup draft through a trip to the Workbench", async () => {
      await metrics(1920, 1080);
      await open("projectWithResult");
      await navigate([en.projectSurface]);
      await browser.execute((layer: string) => {
        document.querySelector<HTMLElement>(`[data-project-targeted="${layer}"]`)?.focus();
      }, TARGETED_LAYER);
      await browser.keys("Enter");
      await browser.$("[data-targeted-text]").waitForDisplayed();
      // Comma-separated, as M9.1 types it: WebDriver sends a tab as the Tab key.
      const typed = "Caffeine, C8H10N4O2, 120, 30";
      await browser.$("[data-targeted-text]").setValue(typed);
      await frames();
      const calls = await ipcCalls();

      await home();
      expect(await surface()).toBe("workbench");
      await activate("project");
      expect(await surface()).toBe("project");

      expect(await browser.$("[data-targeted-text]").getValue()).toBe(typed);
      // A draft is text on the page: no review was asked for and nothing ran.
      expect(await unexpectedSince("pm9-b3", calls)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    /**
     * Each stored-result state and the words the report's state block (M9.1's
     * `[data-targeted-state]`) says for it: the payload, whether the source was
     * found where recorded, and, where the case is about it, whether new runs
     * are possible. Kept apart so a missing source or runtime never reads as a
     * damaged payload, or the other way round.
     */
    const STORED: readonly {
      readonly name: Scenario;
      readonly availability: Availability;
      readonly payload: string;
      readonly sourceMissing: boolean;
      readonly runtime: string | null;
    }[] = [
      { name: "projectWithResult", availability: "available", payload: en.targetedStatePayloadWhole, sourceMissing: false, runtime: en.targetedNewRunsAvailable },
      { name: "resultPayloadMissing", availability: "payloadMissing", payload: en.targetedStatePayloadMissing, sourceMissing: false, runtime: null },
      { name: "resultPayloadCorrupt", availability: "payloadCorrupt", payload: en.targetedStatePayloadCorrupt, sourceMissing: false, runtime: null },
      { name: "resultSourceAndRuntimeUnavailable", availability: "available", payload: en.targetedStatePayloadWhole, sourceMissing: true, runtime: en.targetedNewRunsRuntimeUnavailable },
    ];
    const stateText = () =>
      browser.execute(
        () => (document.querySelector("[data-targeted-state]") as HTMLElement | null)?.innerText ?? "",
      ) as Promise<string>;
    for (const { name, availability, payload, sourceMissing, runtime } of STORED) {
      it(`PM9-B4 reads the stored result in ${name} from its own record, and routes back to it`, async () => {
        await metrics(1920, 1080);
        await open(name);
        await navigate([en.projectSurface]);
        await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
        await browser.$(`[data-targeted-report="${RESULT}"]`).waitForDisplayed();
        expect(await browser.$(`[data-targeted-report="${RESULT}"]`).getAttribute("data-availability")).toBe(availability);
        if (availability === "available") await browser.$("[data-targeted-row]").waitForDisplayed();
        await frames();

        // The report states each fact separately, as the owners hold it.
        await browser.waitUntil(async () => (await stateText()).includes(payload), {
          timeout: 15_000,
          timeoutMsg: `the state block never said "${payload}"`,
        });
        if (runtime !== null) {
          await browser.waitUntil(async () => (await stateText()).includes(runtime), {
            timeout: 15_000,
            timeoutMsg: `the state block never said "${runtime}"`,
          });
        }
        expect((await stateText()).includes(en.projectStateMissing)).toBe(sourceMissing);
        // A payload that is missing or damaged is not read (M9.1).
        if (availability !== "available") {
          expect((await ipcCalls()).some((call) => call.command === "read_targeted_ms1_rows")).toBe(false);
        }

        // The line names the record; how available its payload is stays the
        // report's to say, so the sentence is the same in every state.
        await waitForContext(
          "inspecting",
          (text) => text === fill(en.shellContextInspecting, { name: en.projectArtifactTargetedMs1 }),
          "names the stored result",
        );
        // Lineage stays the record's own: its producing run and its plan.
        expect(await browser.$(`#workbench-inspector [data-provenance-link="${TARGETED_RUN}"]`).isExisting()).toBe(true);
        expect(await browser.$("#workbench-inspector").getText()).toContain(PLAN_SHA);

        const calls = await ipcCalls();
        await home();
        expect(await surface()).toBe("workbench");
        await activate("inspecting");
        expect(await surface()).toBe("project");
        expect(await browser.$(`[data-targeted-report="${RESULT}"]`).getAttribute("data-availability")).toBe(availability);

        // No run, review, check, admission or re-read of the stored rows.
        expect(await unexpectedSince(`pm9-b4-${name}`, calls)).toEqual([]);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("PM9-B5 shows a QC capture while it runs, clears it when it settles, and routes to the report", async () => {
      await metrics(1920, 1080);
      await open("qcCapture");
      await viewTheRow();
      await navigate([en.projectSurface]);
      const control = `[data-project-capture-qc="${QC_LAYER}"]`;
      await browser.$(`${control}:not([aria-disabled])`).waitForDisplayed();

      await holdInvoke("capture_project_qc_summary");
      await browser.execute((selector: string) => {
        document.querySelector<HTMLElement>(selector)?.focus();
      }, control);
      await browser.keys("Enter");
      const recording = fill(en.shellContextActivity, { activity: en.projectBusyRecordingQc });
      await waitForContext("projectActivity", (text) => text === recording, "says the capture is under way");
      expect(await browser.$("[data-project-work-dot]").isExisting()).toBe(true);

      // Away and back while it runs: the same words, and nothing new asked.
      const calls = await ipcCalls();
      await home();
      expect(await contextText("projectActivity")).toBe(recording);
      await activate("projectActivity");
      expect(await surface()).toBe("project");
      expect(await unexpectedSince("pm9-b5-while-held", calls)).toEqual([]);

      await releaseInvokeHold("capture_project_qc_summary");
      await waitForContext("projectActivity", (text) => text === null, "leaves no busy label once settled");
      expect(await browser.$("[data-project-work-dot]").isExisting()).toBe(false);
      // The capture moved what is inspected to the record it made, as
      // `useProject` `captureQc` does when nothing else was chosen meanwhile.
      await waitForContext(
        "inspecting",
        (text) => text === fill(en.shellContextInspecting, { name: en.projectArtifactQcSummary }),
        "names the new QC record",
      );

      await home();
      await activate("inspecting");
      expect(await surface()).toBe("project");
      await browser.$(`[data-qc-report="${QC_ARTIFACT}"]`).waitForDisplayed();
      expect(await browser.$('#workbench-inspector [data-provenance="artifact"]').isDisplayed()).toBe(true);
      // A description, not a verdict (M8.5).
      expect((await browser.$(`[data-qc-report="${QC_ARTIFACT}"]`).getText()).toLowerCase()).not.toMatch(
        /\b(pass|fail|good|poor|grade|score)\b/u,
      );
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B6 follows a running conversion to its end without a stale busy label", async () => {
      await metrics(1920, 1080);
      await open("converting");
      const running = fill(en.shellContextActivity, { activity: en.shellConversionRunning });
      await waitForContext("conversionActivity", (text) => text === running, "says the conversion runs");
      expect(
        await browser.$(".workbench-navigation .work-status-dot").getAttribute("aria-label"),
      ).toBe(en.workActive);

      // Away and back while it runs: the lane keeps polling its slot, and that
      // read is the only request.
      const poll = "get_workspace_conversion_state";
      const calls = await ipcCalls();
      await activate("conversionActivity");
      expect(await surface()).toBe("conversion");
      expect(await browser.$(".conversion-running").isExisting()).toBe(true);
      await navigate([en.projectSurface]);
      await activate("conversionActivity");
      expect(await surface()).toBe("conversion");
      expect(await unexpectedSince("pm9-b6-while-running", calls)).toEqual([]);

      // Rust settles the queue, and the transition is the fixture's to give:
      // the lane's next slot read is parked, the answer changed, then released.
      // The wait is for that read to arrive, not for a length of time.
      await holdInvoke(poll);
      await setInvokeResult(poll, conversionSlot(2, SETTLED));
      await browser.waitUntil(async () => (await heldCallers(poll)) > 0, {
        timeout: 15_000,
        timeoutMsg: "the lane never read its slot again while the queue ran",
      });
      // Nothing has been answered yet, so nothing may have moved.
      expect(await contextText("conversionActivity")).toBe(running);
      await releaseInvokeHold(poll);
      await waitForContext("conversionActivity", (text) => text === en.shellConversionRetained, "reports the settled queue");
      expect(await browser.$(".workbench-navigation .work-status-dot").getAttribute("aria-label")).toBe(en.workRetained);
      expect(
        await browser.execute(
          (busy: string) =>
            [...document.querySelectorAll("[data-shell-context]")].some((item) =>
              (item.textContent ?? "").startsWith(busy),
            ),
          prefix(en.shellContextActivity),
        ),
      ).toBe(false);
      // Recorded: what settling asked for. The lane's own reads may follow.
      await unexpectedSince("pm9-b6-settled", calls);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9-B7 settles a check without a stale label, and a replaced project leaves nothing inspected", async () => {
      await metrics(1920, 1080);
      await open("populated");
      await viewTheRow();
      const viewing = await contextText("viewing");
      await navigate([en.projectSurface]);
      await browser.$(`button[aria-label="${fill(en.provenanceInspectInput, { name: "QC_pool_01.mzML" })}"]`).click();
      const inspected = fill(en.shellContextInspecting, { name: "QC_pool_01.mzML" });
      await waitForContext("inspecting", (text) => text === inspected, "names the inspected reference");

      // A check, held, so its running state can be looked at from elsewhere.
      await holdInvoke("check_project_links");
      await browser.$("[data-project-check]").click();
      const checking = fill(en.shellContextActivity, { activity: en.projectBusyChecking });
      await waitForContext("projectActivity", (text) => text === checking, "says the check runs");
      expect(await browser.$("[data-project-cancel]").getAttribute("data-project-cancel")).toBe("project-job-1");

      const calls = await ipcCalls();
      await home();
      expect(await contextText("projectActivity")).toBe(checking);
      await activate("projectActivity");
      expect(await surface()).toBe("project");
      // The live operation is the one that was accepted, not a new one.
      expect(await browser.$("[data-project-cancel]").getAttribute("data-project-cancel")).toBe("project-job-1");
      expect(await unexpectedSince("pm9-b7-while-held", calls)).toEqual([]);

      await setInvokeResult(
        "check_project_links",
        capturedProject({
          inputs: [{ ...(capturedProject().inputs[0] as object), verification: "matchingRecordedContent" }],
        }),
      );
      await releaseInvokeHold("check_project_links");
      await waitForContext("projectActivity", (text) => text === null, "leaves no busy label once settled");
      expect(await browser.$("[data-project-work-dot]").isExisting()).toBe(false);
      expect(await contextText("inspecting")).toBe(inspected);

      // Replaced through the real buttons: Close, then Open.
      await setInvokeResult("close_project", NO_PROJECT);
      await setInvokeResult(
        "open_project",
        capturedProject({ projectId: "aaaaaaaa-0000-4111-8111-000000000002", name: "Pooled QC study" }),
      );
      const beforeReplace = await ipcCalls();
      await browser.$(`button=${en.projectClose}`).click();
      await waitForContext("project", (text) => text === en.shellContextProjectNone, "says no project is open");
      expect(await contextText("inspecting")).toBe(null);
      await browser.$(`button=${en.projectOpen}`).click();
      await waitForContext(
        "project",
        (text) => text === fill(en.shellContextProject, { name: "Pooled QC study" }),
        "names the project that replaced it",
      );
      // What was inspected belonged to the project before; the new one starts
      // with nothing inspected, even with the same identifiers inside it.
      expect(await contextText("inspecting")).toBe(null);
      // The viewer is its own owner: a project change leaves the viewed row alone.
      expect(await contextText("viewing")).toBe(viewing);
      // The two explicit replacements, and nothing else that starts or re-reads.
      expect(await unexpectedSince("pm9-b7-replace", beforeReplace)).toEqual(["close_project", "open_project"]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("observation (geometry recorded; PM9.2 limits asserted, the rest not accepted)", () => {
    const VIEWPORTS = [
      [1920, 1080],
      [1366, 768],
      [960, 640],
    ] as const;
    const STATES = [
      ["idle", "en"],
      ["idle", "zh-CN"],
      ["busyInspected", "en"],
      ["busyInspected", "zh-CN"],
    ] as const;

    for (const [state, locale] of STATES) {
      it(`PM9-G ${state} in ${locale} at 1920x1080, 1366x768 and 960x640`, async () => {
        await metrics(1920, 1080);
        // Reduced motion is sampled in the Chinese runs only; the rest keep the default.
        if (locale === "zh-CN") {
          await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        }
        if (state === "idle") {
          await open("populated", locale);
          await viewTheRow();
          await selectTheSpectrum(0);
        } else {
          await open("busyInspected", locale);
          await navigate([en.projectSurface, zh.projectSurface]);
          await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
          await browser.$("[data-targeted-row]").waitForDisplayed();
        }
        const expectedLang = locale;

        // One setup, then the window narrows: the owners hold their state and
        // the panels fold for space as they would for a reader resizing.
        for (const [width, height] of VIEWPORTS) {
          await metrics(width, height);
          await frames();
          const label = `pm9-g-${state}-${locale}-${String(width)}x${String(height)}`;
          const measured = await observe(label);
          expect(measured.lang).toBe(expectedLang);
          const stops = await keyboardSample(label);
          // Keyboard access where the line exists: every item is a Tab stop
          // and shows where focus is.
          for (const item of measured.contextItems) {
            const stop = stops.find((candidate) => candidate.context === item.id);
            expect(stop).toBeDefined();
            expect(stop?.treatment.visible).toBe(true);
          }
          // The Details entry is a stop, with a visible ring, at every width
          // and whether or not there is anything to show (PM9.2 L20).
          const details = stops.find((candidate) => candidate.name === (locale === "en" ? en : zh).inspectorToggle);
          expect(details).toBeDefined();
          expect(details?.treatment.visible).toBe(true);
        }
        // motion's development build warns once per animation that reduced
        // motion is on. This test turned it on, so that one notice is expected
        // in the zh-CN runs and nothing else is.
        expect(
          (await unexpectedConsole()).filter(
            (entry) => !(locale === "zh-CN" && entry.includes(REDUCED_MOTION_NOTICE)),
          ),
        ).toEqual([]);
      });
    }

    it("PM9.2 L20: the Details entry at 1366x768 while there is nothing to show", async () => {
      // Both G states have something to show. This is the state L20 is about:
      // closed by default at this width, refused, and still a stop that shows
      // where focus is.
      await metrics(1366, 768);
      await open("populated", "en");
      // The usable reading folds the banner; observe() expects it folded.
      await browser.$("[data-backend-toggle]").waitForExist();
      await frames();
      const label = "pm9-2-details-refused-en-1366x768";
      await observe(label);
      const stops = await keyboardSample(label);
      const details = stops.find((candidate) => candidate.name === en.inspectorToggle);
      expect(details).toBeDefined();
      expect(details?.refused).toBe(true);
      expect(details?.treatment.visible).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.2 L14–L16: the Workbench line with long names while a conversion runs, in ${locale}`, async () => {
        // PM9-G's busy state is observed on the Project surface. Here the same
        // long names are on the Workbench, where the inspected result ranks
        // last and gives way first.
        await metrics(1920, 1080);
        await open("busyInspected", locale);
        await navigate([en.projectSurface, zh.projectSurface]);
        await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).click();
        await browser.$("[data-targeted-row]").waitForDisplayed();
        await navigate([en.workbench, zh.workbench]);
        await browser.waitUntil(async () => (await surface()) === "workbench");
        for (const [width, height] of [
          [1920, 1080],
          [1366, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const measured = await observe(`pm9-2-workbench-long-${locale}-${String(width)}x${String(height)}`);
          expect(measured.surface).toBe("workbench");
          expect(measured.contextItems.map((item) => item.id)).toContain("inspecting");
          // Given way, the scope still says what it is (PM9.2 L14–L16 (e)):
          // its distinctive word leads, so what survives the ellipsis is it.
          const scope = measured.contextItems.find((item) => item.id === "conversionScope");
          expect(scope?.visible.startsWith(locale === "en" ? "Conv" : "待转")).toBe(true);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.2 L1: each surface's title, and a primary action only where one is owned, in ${locale}`, async () => {
        const words = locale === "en" ? en : zh;
        await metrics(1366, 768);
        await open("populated", locale);
        await browser.$("[data-backend-toggle]").waitForExist();
        for (const [target, name] of [
          ["workbench", words.workbench],
          ["conversion", words.conversionTask],
          ["project", words.projectSurface],
        ] as const) {
          await navigate([name]);
          await browser.waitUntil(async () => (await surface()) === target);
          await frames();
          const seen = await surfaceFrame(`pm9-2-l1-${target}-${locale}-1366x768`);
          // The surface says what it is, in the navigation's words, on screen.
          expect(seen.title?.text).toBe(name);
          expect(seen.regionName).toBe(name);
          expect(seen.title?.y ?? -1).toBeGreaterThanOrEqual(0);
          expect((seen.title?.y ?? 0) + (seen.title?.height ?? 0)).toBeLessThanOrEqual(seen.css.height);
          // Nothing read and nothing retained: the evidence surface invents none.
          if (target === "workbench") expect(seen.primaries).toEqual([]);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.2 L1: the retained acquisition's reopen is the evidence surface's one primary action, in ${locale}`, async () => {
        const words = locale === "en" ? en : zh;
        await metrics(1366, 768);
        await open("populated", locale);
        await viewTheRow();
        // A different installation, chosen: its readings replace the old one's,
        // and the acquisition stays one press from being read again (WF-001).
        await setInvokeResult("choose_backend_installation", chosenBackend);
        await showBackendBanner();
        await browser.$('[data-backend-action="choose"]').click();
        const reopen = browser.$("#workbench-evidence .primary-button");
        await reopen.waitForDisplayed({ timeoutMsg: "no reopen action after the installation changed" });
        await frames();
        const seen = await surfaceFrame(`pm9-2-l1-retained-${locale}-1366x768`);
        expect(seen.primaries.map((primary) => primary.text)).toEqual([
          expect.stringMatching(new RegExp(`^${prefix(words.previewRetained)}QC_pool_01\\.mzML`, "u")),
        ]);
        expect(seen.primaries[0]?.disabled).toBe(false);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("PM9.2 L10: the folded reading's toggle hands the keyboard to the banner when it has something to say", async () => {
      await metrics(1366, 768);
      await open("populated", "en");
      // Queried afresh each time: the toggle leaves, and a new one returns.
      const toggle = () => browser.$("[data-backend-toggle]");
      await toggle().waitForExist();
      // Opened by a real press, which leaves the keyboard on the toggle.
      await toggle().click();
      expect(await browser.execute(() => document.activeElement?.hasAttribute("data-backend-toggle") ?? false)).toBe(true);
      // A check the reader did not start from the toggle: pressed by script,
      // so the keyboard stays where it was, and held so the state can be read.
      await holdInvoke("inspect_backend");
      await browser.execute(() => document.querySelector<HTMLButtonElement>('[data-backend-action="recheck"]')?.click());
      await browser.waitUntil(async () => !(await toggle().isExisting()), { timeoutMsg: "the toggle stayed while checking" });
      expect(await browser.execute(() => document.activeElement?.id ?? null)).toBe("backend-status");
      await releaseInvokeHold("inspect_backend");
      await browser.waitUntil(async () => await toggle().isExisting(), { timeoutMsg: "no quiet verdict" });
      // Engaged: the banner stays open under the reader, and so does the keyboard.
      expect(await browser.execute(() => document.activeElement?.id ?? null)).toBe("backend-status");
      expect(await toggle().getAttribute("aria-expanded")).toBe("true");
      expect(await browser.$("#backend-status").getAttribute("data-backend-collapsed")).toBe(null);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });
});
