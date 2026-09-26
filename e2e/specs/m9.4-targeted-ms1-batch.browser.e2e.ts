/**
 * M9.4 -- a batch of independent targeted MS1 analyses: several acquisitions
 * chosen explicitly, reviewed as one ordered batch, run one member at a time
 * with one Stop, and each member's end followed to its own result, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. So this is
 * React, CSS, layout and interaction evidence: what the setup sends, what a
 * review, a batch in progress, a Stop and a mixed ending leave on screen, and
 * whether anything scrolls sideways at 1920x1080, 1366x768 and a narrow
 * window, in English and in Simplified Chinese.
 *
 * It is **not** engine, filesystem, scheduling or persistence evidence. Every
 * plan digest, member state, phase and ending is a controlled answer table
 * written in this file; no worker ran and nothing was recorded. That a real
 * batch binds one plan per acquisition, runs one worker at a time, isolates
 * each member's failure, records only members that started and keeps every
 * result through Save, reopen and Save As is proved in
 * `apps/desktop/src-tauri/src/targeted_ms1/tests/batch.rs`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
  revealInDetails,
} from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

const OPERATION = "project-job-1";
/** Controlled fixture digests: nothing here was measured. */
const DIGEST = "A1".repeat(32);
const LIST_SHA = "C3".repeat(32);
const LABELS = ["QC_pool_01.mzML", "Plasma_patient_07.mzML", "血浆 样品 12.mzML"] as const;
const INPUTS = LABELS.map((_, index) => `11111111-9494-4111-8111-00000000000${index + 1}`);
const LAYERS = LABELS.map((_, index) => `dddddddd-9494-4111-8111-00000000000${index + 1}`);
const SHAS = ["B2".repeat(32), "D4".repeat(32), "E5".repeat(32)];
const RUNS = LABELS.map((_, index) => `ffffffff-9494-4111-8111-00000000000${index + 1}`);
const ARTIFACT = "eeeeeeee-9494-4111-8111-000000000001";
const CAFFEINE = "77777777-9494-4111-8111-000000000001";
const ABSENT = "77777777-9494-4111-8111-000000000002";

const RECIPE = {
  recipe: "targetedMs1",
  recipeVersion: 1,
  adapterSha256: DIGEST,
  engineProfileSha256: DIGEST,
  runtimeManifestSha256: DIGEST,
};
const PARAMETERS = { mzHalfWidthPpm: "5", expectedPeakWidthS: "6" };
const TARGETS = [
  { targetId: CAFFEINE, label: "Caffeine", formula: "C8H10N4O2", neutralMass: null, rtS: "120", rtHalfWidthS: "30" },
  { targetId: ABSENT, label: "Absent", formula: "C9H9NO4", neutralMass: null, rtS: "300", rtHalfWidthS: "30" },
];
const ENGINE = {
  package: "pyOpenMS",
  version: "3.5.0",
  algorithm: "FeatureFinderMetaboIdent",
  revision: "c1370fb",
  maturity: "experimental",
  fixedProfile: "{}",
};
const TYPED = "Caffeine, C8H10N4O2, 120, 30\nAbsent, C9H9NO4, 300, 30";

function plan(index: number) {
  return {
    planSha256: SHAS[index],
    recipe: RECIPE,
    layerId: LAYERS[index],
    inputId: INPUTS[index],
    expectedContent: [
      { role: "primary", relativeName: "", byteLength: 2048 + index, sha256: SHAS[index] },
    ],
    parameters: PARAMETERS,
    targetListSha256: LIST_SHA,
    targets: TARGETS,
  };
}

/** A batch review of all three, each member as `members` says. */
function review(members: Record<number, Record<string, unknown>> = {}) {
  return {
    problems: [],
    common: { recipe: RECIPE, parameters: PARAMETERS, targetListSha256: LIST_SHA, targets: TARGETS },
    members: LAYERS.map((layerId, index) => ({
      layerId,
      inputId: INPUTS[index],
      planSha256: SHAS[index],
      expectedContent: plan(index).expectedContent,
      refused: null,
      blocked: null,
      ...members[index],
    })),
    engine: ENGINE,
  };
}

type Ending = "completed" | "failed" | "cancelled" | null;

/**
 * A saved project with three layers and, per layer, the run a batch left: a
 * completed run with its result, a failed or cancelled run without one, or
 * none.
 */
function project(endings: readonly Ending[] = [null, null, null]) {
  const run = (index: number, outcome: Exclude<Ending, null>) => ({
    id: RUNS[index],
    operation: "targetedMs1V1",
    outcome,
    inputIds: [],
    layerIds: [LAYERS[index]],
    outputArtifactIds: outcome === "completed" ? [ARTIFACT] : [],
    applicationVersion: "0.1.0",
    startedAt: `2026-09-24T10:0${index}:00Z`,
    finishedAt: `2026-09-24T10:0${index}:09Z`,
    targetedMs1: {
      planSha256: SHAS[index],
      consumedContent: outcome === "failed" ? [] : plan(index).expectedContent,
      attempt:
        outcome === "failed"
          ? null
          : {
              adapterSha256: DIGEST,
              runtimeManifestSha256: DIGEST,
              interpreterSha256: DIGEST,
              sourceView: index === 1 ? "verifiedSnapshotInWorkArea" : "hardLinkInWorkArea",
              engineReport: {
                python: "3.13.15",
                pyopenms: "3.5.0",
                openms: "3.5.0",
                openmsRevision: "c1370fb",
                openmsBuildTime: "fixture build time",
              },
              loadedModules: [],
            },
      failure: outcome === "failed" ? { code: "sourceChanged", stage: "source" } : null,
      stop:
        outcome === "cancelled"
          ? { reason: "cancelRequested", workerTerminated: true, exitObserved: true }
          : null,
    },
  });
  const runs = endings.flatMap((ending, index) => (ending === null ? [] : [run(index, ending)]));
  return {
    open: true,
    projectId: "aaaaaaaa-9494-4111-8111-000000000001",
    name: "Plasma batch 9",
    dirty: runs.length > 0,
    published: true,
    inputs: LABELS.map((label, index) => ({
      id: INPUTS[index],
      label,
      locatorKind: "outsideProject",
      members: [{ role: "primary", name: "", recordedByteLength: 2048 + index }],
      verification: "matchingRecordedContent",
      unavailableReason: null,
      relinkProposed: false,
      relinkCandidateMatches: false,
      consumedByRunIds: [],
      workbenchDatasetHandle: null,
    })),
    layers: LAYERS.map((id, index) => ({
      id,
      sourceInputId: INPUTS[index],
      consumedByRunIds: endings[index] === null ? [] : [RUNS[index]],
    })),
    plans: endings.flatMap((ending, index) => (ending === null ? [] : [plan(index)])),
    runs,
    artifacts: endings.includes("completed")
      ? [
          {
            id: ARTIFACT,
            label: "Targeted MS1 result",
            kind: "targetedMs1ResultV1",
            observedInputCount: 0,
            observedMemberCount: 0,
            qcSnapshot: null,
            producedByRunId: RUNS[endings.indexOf("completed")],
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
              availability: "available",
            },
          },
        ]
      : [],
    analysisRun: null,
    resultStore: { storeFound: true, unreferencedResults: 0 },
  };
}

function member(index: number, state: string, extra: Record<string, unknown> = {}) {
  return {
    layerId: LAYERS[index],
    planSha256: SHAS[index],
    state,
    runId: null,
    artifactId: null,
    reason: null,
    ...extra,
  };
}

const ROWS = {
  total: 2,
  offset: 0,
  rows: [
    {
      targetId: CAFFEINE,
      outcome: "DETECTED",
      failureReason: null,
      edgeTraceCount: 0,
      ion: { adduct: "[M+H]+", charge: 1, mzTheoretical: [195.0877, 196.0911], isotopeProbability: [0.9, 0.1] },
      windows: { rtClosedS: [90, 150], mzOpen: [[195.0867, 195.0887], [196.0901, 196.0921]] },
      signal: { points: 9, sum: [9200, 920], max: [4000, 400], anyNonzeroPoint: true },
      feature: {
        apexRtS: 120,
        leftS: 111,
        rightS: 129,
        rawArea: 21000,
        modelStatus: "0 (converged)",
        modelArea: 20500,
        modelFwhmS: 5.9,
        engineIntensity: 20500,
        engineIntensitySource: "modelArea",
      },
      candidates: [{ apexRtS: 120, leftS: 111, rightS: 129, rawArea: 21000 }],
      overlapWinner: false,
      relations: { sharedWith: [], suppressedBy: null, overlapRemoved: [] },
      recoveredFromEmptySelection: false,
    },
    {
      targetId: ABSENT,
      outcome: "NOT_DETECTED",
      failureReason: null,
      edgeTraceCount: 0,
      ion: { adduct: "[M+H]+", charge: 1, mzTheoretical: [196.0604, 197.0638], isotopeProbability: [0.9, 0.1] },
      windows: { rtClosedS: [270, 330], mzOpen: [[196.0594, 196.0614], [197.0628, 197.0648]] },
      signal: { points: 9, sum: [0, 0], max: [0, 0], anyNonzeroPoint: false },
      feature: null,
      candidates: [],
      overlapWinner: false,
      relations: { sharedWith: [], suppressedBy: null, overlapRemoved: [] },
      recoveredFromEmptySelection: false,
    },
  ],
};

function table(state: unknown, locale: "en" | "zh-CN" = "en") {
  const answers: Record<string, unknown> = ipcTable();
  answers.get_project_state = state;
  answers.begin_project_job = { operationId: OPERATION };
  answers.cancel_project_job = { outcome: "cancelled" };
  answers.resolve_targeted_ms1_batch = review();
  answers.get_targeted_ms1_progress = {
    operationId: OPERATION,
    phase: "runningEngine",
    batch: [
      member(0, "completed", { runId: RUNS[0], artifactId: ARTIFACT }),
      member(1, "running"),
      member(2, "queued"),
    ],
  };
  answers.run_targeted_ms1_batch = {
    project: project(["completed", "cancelled", null]),
    members: [
      member(0, "completed", { runId: RUNS[0], artifactId: ARTIFACT }),
      member(1, "cancelled", { runId: RUNS[1] }),
      member(2, "notStarted"),
    ],
  };
  answers.read_targeted_ms1_rows = ROWS;
  answers.read_targeted_ms1_evidence = { targetId: CAFFEINE, traces: [] };
  answers.get_targeted_ms1_runtime = { newRuns: "available" };
  const preferences = {
    schemaVersion: 1,
    appearance: { locale, density: "comfortable" },
    layout: { roster: "automatic", details: "shown" },
  };
  if (locale !== "en") {
    answers.load_ui_preferences = { outcome: "loaded", revision: 1, preferences };
  }
  answers.save_ui_preferences = { outcome: "saved", revision: 2, preferences };
  return answers;
}

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

async function metrics(width: number, height: number) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.waitUntil(() =>
    browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
  );
}

/** Goes to the Project surface, by the header's third destination. */
async function toProject() {
  await browser.$(".workbench-header").waitForDisplayed();
  await browser.execute(
    (names: readonly string[]) => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".workbench-header button")];
      buttons.find((button) => names.includes(button.textContent ?? ""))?.click();
    },
    [en.projectSurface, zh.projectSurface],
  );
  await browser.$(`[data-project-targeted="${LAYERS[0]}"]`).waitForDisplayed();
}

/**
 * One frame, with the geometry and state it is evidence for. Nothing scrolls
 * sideways -- not the page, not the project surface, not a batch table -- no
 * absolute path and no identifier is on screen, and the page reached for
 * nothing off-origin.
 */
async function capture(label: string) {
  const measured = await browser.execute((identifiers: readonly string[]) => {
    const rect = (element: Element | null) => {
      if (element === null) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const project = document.querySelector<HTMLElement>("#workbench-project");
    const setup = document.querySelector("[data-targeted-setup]");
    const batch = document.querySelector("[data-targeted-batch]");
    const report = document.querySelector("[data-targeted-report]");
    const tables = [...document.querySelectorAll<HTMLElement>(".targeted-setup table, .targeted-batch-scroll")];
    const text = document.body.innerText;
    return {
      css: { width: innerWidth, height: innerHeight },
      lang: document.documentElement.lang,
      projectOverflow:
        project === null || project.hidden ? 0 : project.scrollWidth - project.clientWidth,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      tableOverflow: Math.max(0, ...tables.map((element) => element.scrollWidth - element.clientWidth)),
      setup: setup === null ? null : { text: (setup as HTMLElement).innerText, ...rect(setup) },
      batch:
        batch === null
          ? null
          : {
              state: batch.getAttribute("data-targeted-batch"),
              text: (batch as HTMLElement).innerText,
              members: [...batch.querySelectorAll("[data-targeted-batch-member]")].map((row) =>
                row.getAttribute("data-state"),
              ),
              box: rect(batch) ?? { x: 0, y: 0, width: 0, height: 0 },
            },
      report: report === null ? null : { id: report.getAttribute("data-targeted-report"), ...rect(report) },
      busy: document.querySelector("[data-project-busy]")?.textContent ?? null,
      cancel: document.querySelector("[data-project-cancel]")?.textContent ?? null,
      live: document.querySelector("[data-live-region='project']")?.textContent ?? "",
      identifiersOnScreen: identifiers.filter((identifier) => text.includes(identifier)),
      pathsOnScreen: (text.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  }, [...LAYERS, ...INPUTS, ...RUNS]);
  const screenshot = await cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({
    label,
    kind:
      "React/mock-IPC layout and interaction evidence. Every review, member state, phase and " +
      "ending is a controlled answer table; no worker ran, no source was read and nothing was " +
      "recorded.",
    ...measured,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.projectOverflow).toBeLessThanOrEqual(1);
  expect(measured.tableOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  expect(measured.identifiersOnScreen).toEqual([]);
  if (measured.batch !== null) {
    const { x, width } = measured.batch.box;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(measured.css.width + 1);
  }
  return measured;
}

/**
 * Opens the setup from the first layer by keyboard, chooses the third and
 * then the second acquisition, types the targets and reviews.
 */
async function reviewAll() {
  await browser.execute((layer: string) => {
    document.querySelector<HTMLElement>(`[data-project-targeted="${layer}"]`)?.focus();
  }, LAYERS[0]);
  await browser.keys("Enter");
  await browser.$("[data-targeted-setup]").waitForDisplayed();
  await browser.$(`[data-targeted-member="${LAYERS[2]}"]`).click();
  await browser.$(`[data-targeted-member="${LAYERS[1]}"]`).click();
  await browser.$("[data-targeted-text]").setValue(TYPED);
  await browser.$("[data-targeted-review]").click();
  await browser.$("[data-targeted-batch-members]").waitForDisplayed();
  // The review appears below the actions, as a single plan's does; the frame
  // is taken where a reader would look at it.
  // Only the project surface scrolls, as the application's own scrolling does.
  await browser.execute(() => {
    const members = document.querySelector("[data-targeted-batch-members]");
    const surface = members?.closest<HTMLElement>(".workbench-project") ?? null;
    if (members === null || surface === null) return;
    surface.scrollTop +=
      members.getBoundingClientRect().top - surface.getBoundingClientRect().top - 160;
  });
}

describe("M9.4 targeted MS1 batch: choose, review, run, stop and follow, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M94_OUTPUT_ROOT"] ?? resolve("test-results/m9.4");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M9.4 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
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

  it("reviews three chosen acquisitions as one ordered batch, runs it, stops it and opens a member's result", async () => {
    await metrics(1920, 1080);
    await installIpcBoundary(table(project()));
    await browser.url("/");
    await toProject();

    const before = await ipcCalls();
    await reviewAll();
    // The layers in the project's order, whatever order they were ticked in,
    // and the typed text once.
    expect((await ipcCalls()).slice(before.length)).toEqual([
      {
        command: "resolve_targeted_ms1_batch",
        args: {
          request: {
            layerIds: LAYERS,
            mzHalfWidthPpm: "5",
            expectedPeakWidthS: "6",
            targets: [
              { label: "Caffeine", formula: "C8H10N4O2", rtS: "120", rtHalfWidthS: "30", neutralMass: null },
              { label: "Absent", formula: "C9H9NO4", rtS: "300", rtHalfWidthS: "30", neutralMass: null },
            ],
          },
        },
      },
    ]);
    const reviewed = await capture("m94-01-reviewed-1920");
    expect(reviewed.setup?.text).toContain(en.targetedBatchIndependent.replace("{{count}}", "3"));
    for (const label of LABELS) expect(reviewed.setup?.text).toContain(label);
    expect(reviewed.setup?.text).toContain(en.targetedRunBatch.replace("{{count}}", "3"));

    // Run, held, so the batch in progress can be looked at.
    await holdInvoke("run_targeted_ms1_batch");
    const beforeRun = await ipcCalls();
    await browser.$("[data-targeted-run]").click();
    await browser.$('[data-targeted-batch="running"] [data-state="running"]').waitForDisplayed();
    // The panel was brought into view, and the keyboard followed from Run.
    expect(
      await browser.execute(() => document.activeElement?.closest("[data-targeted-batch]") !== null),
    ).toBe(true);
    const running = await capture("m94-02-running-1920");
    expect(running.batch?.members).toEqual(["completed", "running", "queued"]);
    expect(running.batch?.text).toContain(en.targetedPhaseRunningEngine);
    expect(running.busy).toContain(
      en.projectBusyBatch.replace("{{position}}", "2").replace("{{total}}", "3"),
    );
    expect(running.cancel).toBe(en.targetedBatchStop);
    // No member's result or run is offered until the batch has ended.
    expect(await browser.$("[data-targeted-batch-open]").isExisting()).toBe(false);
    expect(await browser.$("[data-targeted-batch-run]").isExisting()).toBe(false);
    const commands = (await ipcCalls())
      .slice(beforeRun.length)
      .filter((call) => call.command !== "get_targeted_ms1_progress");
    expect(commands).toEqual([
      { command: "begin_project_job", args: {} },
      { command: "run_targeted_ms1_batch", args: { operationId: OPERATION, planSha256s: SHAS } },
    ]);

    // Stop, by keyboard: one operation, named by its identifier.
    await browser.execute(() => {
      document.querySelector<HTMLElement>("[data-targeted-batch-stop]")?.focus();
    });
    await browser.keys("Enter");
    await browser.waitUntil(async () =>
      (await ipcCalls()).some((call) => call.command === "cancel_project_job"),
    );
    expect((await ipcCalls()).filter((call) => call.command === "cancel_project_job")).toEqual([
      { command: "cancel_project_job", args: { operationId: OPERATION } },
    ]);
    const stopping = await capture("m94-03-stopping-1920");
    expect(stopping.batch?.text).toContain(en.targetedBatchStopping);

    await releaseInvokeHold("run_targeted_ms1_batch");
    await browser.$('[data-targeted-batch="ended"]').waitForDisplayed();
    const ended = await capture("m94-04-ended-1920");
    expect(ended.batch?.members).toEqual(["completed", "cancelled", "notStarted"]);
    expect(ended.batch?.text).toContain(en.targetedBatchStoppedBefore);
    expect(ended.batch?.text).toContain(en.targetedBatchOperationalNote);
    expect(ended.live).toContain(
      en.targetedBatchEndedAnnouncement.split("{{summary}}")[0] ?? "",
    );
    // Nothing is opened on arrival.
    expect(ended.report).toBeNull();

    await browser.$(`[data-targeted-batch-open="${ARTIFACT}"]`).click();
    await browser.$(`[data-targeted-report="${ARTIFACT}"] [data-targeted-row]`).waitForDisplayed();
    const opened = await capture("m94-05-member-result-1920");
    expect(opened.report?.id).toBe(ARTIFACT);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says each member's own ending in a mixed batch, at 1366x768", async () => {
    await metrics(1366, 768);
    await installIpcBoundary(table(project()));
    await browser.url("/");
    await toProject();
    await reviewAll();
    await setInvokeResult("run_targeted_ms1_batch", {
      project: project(["completed", "failed", null]),
      members: [
        member(0, "completed", { runId: RUNS[0], artifactId: ARTIFACT }),
        member(1, "failed", { runId: RUNS[1] }),
        member(2, "refused", { reason: "insufficientWorkAreaSpace" }),
      ],
    });
    await browser.$("[data-targeted-run]").click();
    await browser.$('[data-targeted-batch="ended"]').waitForDisplayed();
    const mixed = await capture("m94-06-mixed-1366");
    expect(mixed.batch?.members).toEqual(["completed", "failed", "refused"]);
    expect(mixed.batch?.text).toContain(en.targetedFailureSourceChanged);
    expect(mixed.batch?.text).toContain(en.projectRefusedInsufficientWorkAreaSpace);
    // Operational counts only; no member's target outcomes are on the panel.
    expect(mixed.batch?.text).not.toContain(en.targetedOutcomeDetected);
    await browser.$(`[data-targeted-batch-run="${RUNS[1]}"]`).click();
    await revealInDetails('[data-provenance="run"]');
    await capture("m94-07-failed-member-details-1366");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("holds a batch back while a member is not ready, in a narrow window", async () => {
    await metrics(960, 640);
    const blocked = table(project());
    blocked.resolve_targeted_ms1_batch = review({
      1: { blocked: "insufficientWorkAreaSpace" },
      2: { planSha256: null, expectedContent: [], refused: "recipeSourceUnsupported" },
    });
    await installIpcBoundary(blocked);
    await browser.url("/");
    await toProject();
    await reviewAll();
    const notReady = await capture("m94-08-not-ready-960");
    expect(notReady.setup?.text).toContain(en.projectRefusedInsufficientWorkAreaSpace);
    expect(notReady.setup?.text).toContain(en.projectRefusedRecipeSourceUnsupported);
    expect(await browser.$("[data-targeted-run]").getAttribute("aria-disabled")).toBe("true");
    await browser.$("[data-targeted-run]").click();
    expect((await ipcCalls()).some((call) => call.command === "run_targeted_ms1_batch")).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("names a refused batch request in its own words", async () => {
    await metrics(1366, 768);
    await installIpcBoundary(table(project()));
    await browser.url("/");
    await toProject();
    await setInvokeRejection("resolve_targeted_ms1_batch", {
      kind: "batchSizeOutOfRange",
      summary: "batchSizeOutOfRange",
      detail: null,
      retryable: false,
    });
    await browser.$(`[data-project-targeted="${LAYERS[0]}"]`).click();
    await browser.$(`[data-targeted-member="${LAYERS[1]}"]`).click();
    await browser.$("[data-targeted-text]").setValue(TYPED);
    await browser.$("[data-targeted-review]").click();
    await browser.$('[data-project-problem="batchSizeOutOfRange"]').waitForDisplayed();
    const refused = await capture("m94-09-refused-1366");
    expect(refused.live).toContain(en.projectRefusedBatchSize);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("reviews, runs and reports a batch in Simplified Chinese", async () => {
    await metrics(1366, 768);
    await installIpcBoundary(table(project(), "zh-CN"));
    await browser.url("/");
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
    await toProject();
    await reviewAll();
    const reviewed = await capture("m94-10-reviewed-zh-CN");
    expect(reviewed.lang).toBe("zh-CN");
    expect(reviewed.setup?.text).toContain(zh.targetedBatchIndependent.replace("{{count}}", "3"));
    expect(reviewed.setup?.text).toContain(zh.targetedRunBatch.replace("{{count}}", "3"));
    await browser.$("[data-targeted-run]").click();
    await browser.$('[data-targeted-batch="ended"]').waitForDisplayed();
    const ended = await capture("m94-11-ended-zh-CN");
    expect(ended.batch?.text).toContain(zh.targetedBatchEndedTitle);
    expect(ended.batch?.text).toContain(zh.targetedBatchStoppedBefore);
    expect(ended.batch?.text).toContain(zh.targetedBatchStateCancelled);
    expect(await unexpectedConsole()).toEqual([]);
  });
});
