/**
 * M9.1 -- the targeted MS1 recipe: a plan reviewed from typed text, a run in
 * progress and its cancellation, and a stored result read as a report with one
 * target's evidence, rendered.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. So this is
 * React, CSS, layout and interaction evidence: what the setup sends, what a
 * review, a run and a cancel leave on screen, where the report and the plot
 * appear, and whether anything scrolls sideways at 1920x1080, 1366x768 and a
 * narrow window, in English and in Simplified Chinese.
 *
 * It is **not** engine, filesystem or persistence evidence. The plan, the run's
 * phase and ending, the stored rows and the evidence points are a controlled
 * answer table written in this file; no worker ran, no source was read and no
 * result was stored. That a real run pins and links its source, supervises the
 * fixed runtime, fails closed and stores a validated result beside the project
 * is proved against the pinned runtime in
 * `apps/desktop/src-tauri/src/targeted_ms1/tests.rs`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  focusedTreatment,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeResult,
} from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

const INPUT = "11111111-9191-4111-8111-111111111111";
const LAYER = "dddddddd-9191-4111-8111-111111111111";
const RUN = "ffffffff-9191-4111-8111-111111111111";
const ARTIFACT = "eeeeeeee-9191-4111-8111-111111111111";
const CAFFEINE = "77777777-9191-4111-8111-000000000001";
const ABSENT = "77777777-9191-4111-8111-000000000002";
const OPERATION = "project-job-1";
/** Controlled fixture digests: nothing here was measured. */
const DIGEST = "A1".repeat(32);
const PLAN_SHA = "B2".repeat(32);

const PLAN = {
  planSha256: PLAN_SHA,
  recipe: {
    recipe: "targetedMs1",
    recipeVersion: 1,
    adapterSha256: DIGEST,
    engineProfileSha256: DIGEST,
    runtimeManifestSha256: DIGEST,
  },
  layerId: LAYER,
  inputId: INPUT,
  expectedContent: [{ role: "primary", relativeName: "", byteLength: 2048, sha256: DIGEST }],
  parameters: { mzHalfWidthPpm: "5", expectedPeakWidthS: "6" },
  targetListSha256: DIGEST,
  targets: [
    { targetId: CAFFEINE, label: "Caffeine", formula: "C8H10N4O2", neutralMass: null, rtS: "120", rtHalfWidthS: "30" },
    { targetId: ABSENT, label: "Absent", formula: "C9H9NO4", neutralMass: null, rtS: "300", rtHalfWidthS: "30" },
  ],
};

const ENGINE = {
  package: "pyOpenMS",
  version: "3.5.0",
  algorithm: "FeatureFinderMetaboIdent",
  revision: "c1370fb",
  maturity: "experimental",
  fixedProfile: "{}",
};

// Comma-separated: WebDriver types a tab as the Tab key, which moves focus.
// Tab-separated lines are covered by the unit suite's parser tests.
const TYPED = "Caffeine, C8H10N4O2, 120, 30\nAbsent, C9H9NO4, 300, 30";

/** A saved project with one layer, before and after one targeted run. */
function project(options: {
  readonly run?: "completed" | "cancelled";
  readonly availability?: "available" | "payloadMissing";
  readonly label?: string;
}) {
  const ran = options.run !== undefined;
  const completed = options.run === "completed";
  return {
    open: true,
    projectId: "aaaaaaaa-9191-4111-8111-000000000001",
    name: "Plasma batch 9",
    dirty: false,
    published: true,
    inputs: [
      {
        id: INPUT,
        label: options.label ?? MZML_ROW.fileName,
        locatorKind: "insideProject",
        members: [{ role: "primary", name: "", recordedByteLength: 2048 }],
        verification: "matchingRecordedContent",
        unavailableReason: null,
        relinkProposed: false,
        relinkCandidateMatches: false,
        consumedByRunIds: [],
        workbenchDatasetHandle: null,
      },
    ],
    layers: [{ id: LAYER, sourceInputId: INPUT, consumedByRunIds: ran ? [RUN] : [] }],
    plans: ran ? [PLAN] : [],
    runs: ran
      ? [
          {
            id: RUN,
            operation: "targetedMs1V1",
            outcome: options.run,
            inputIds: [],
            layerIds: [LAYER],
            outputArtifactIds: completed ? [ARTIFACT] : [],
            applicationVersion: "0.1.0",
            startedAt: "2026-09-23T10:00:00Z",
            finishedAt: "2026-09-23T10:00:09Z",
            targetedMs1: {
              planSha256: PLAN_SHA,
              consumedContent: completed ? PLAN.expectedContent : [],
              attempt: completed
                ? {
                    adapterSha256: DIGEST,
                    runtimeManifestSha256: DIGEST,
                    interpreterSha256: DIGEST,
                    sourceView: "hardLinkInWorkArea",
                    engineReport: {
                      python: "3.13.15",
                      pyopenms: "3.5.0",
                      openms: "3.5.0",
                      openmsRevision: "c1370fb",
                      openmsBuildTime: "fixture build time",
                    },
                    loadedModules: [{ name: "pyopenms/_pyopenms_1.pyd", sha256: DIGEST }],
                  }
                : null,
              failure: null,
              stop: completed
                ? null
                : { reason: "cancelRequested", workerTerminated: true, exitObserved: true },
            },
          },
        ]
      : [],
    artifacts: completed
      ? [
          {
            id: ARTIFACT,
            label: "Targeted MS1 result",
            kind: "targetedMs1ResultV1",
            observedInputCount: 0,
            observedMemberCount: 0,
            qcSnapshot: null,
            producedByRunId: RUN,
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
              availability: options.availability ?? "available",
            },
          },
        ]
      : [],
    analysisRun: null,
    resultStore: { storeFound: true, unreferencedResults: 0 },
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

/** Controlled fixture points: nine scans across the window, typed here. */
const RT = [96, 102, 108, 114, 120, 126, 132, 138, 144];
const M0 = [0, 40, 600, 2400, 4000, 1900, 250, 10, 0];
const EVIDENCE = {
  targetId: CAFFEINE,
  traces: [
    { targetId: CAFFEINE, trace: 0, mzTheoretical: 195.0877, points: RT.map((rt, i) => [i, rt, M0[i]]) },
    {
      targetId: CAFFEINE,
      trace: 1,
      mzTheoretical: 196.0911,
      points: RT.map((rt, i) => [i, rt, Math.round(M0[i]! / 10)]),
    },
  ],
};

function table(state: unknown, locale: "en" | "zh-CN" = "en") {
  const answers: Record<string, unknown> = ipcTable();
  answers.get_project_state = state;
  answers.begin_project_job = { operationId: OPERATION };
  answers.cancel_project_job = { outcome: "cancelled" };
  answers.resolve_targeted_ms1_plan = { plan: PLAN, problems: [], blocked: null, engine: ENGINE };
  answers.get_targeted_ms1_progress = { operationId: OPERATION, phase: "runningEngine" };
  answers.run_targeted_ms1 = {
    project: project({ run: "completed" }),
    runId: RUN,
    outcome: "completed",
    artifactId: ARTIFACT,
  };
  answers.read_targeted_ms1_rows = ROWS;
  answers.read_targeted_ms1_evidence = EVIDENCE;
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
  await browser.$(`[data-project-targeted="${LAYER}"]`).waitForDisplayed();
}

/**
 * One frame, with the geometry and state that frame is evidence for.
 *
 * Nothing scrolls sideways -- not the page, not the project surface, not
 * Details, not the row table -- no absolute path and no layer identifier is on
 * screen, the page reached for nothing off-origin, and the plot sits inside the
 * surface.
 */
async function capture(label: string) {
  const measured = await browser.execute((layerId: string) => {
    const rect = (element: Element | null) => {
      if (element === null) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const project = document.querySelector<HTMLElement>("#workbench-project");
    const inspector = document.querySelector<HTMLElement>("#workbench-inspector");
    const setup = document.querySelector("[data-targeted-setup]");
    const report = document.querySelector("[data-targeted-report]");
    const rows = document.querySelector<HTMLElement>(".targeted-rows");
    const plot = document.querySelector("[data-targeted-plot] svg");
    const active = document.activeElement;
    return {
      css: { width: innerWidth, height: innerHeight },
      lang: document.documentElement.lang,
      projectOverflow:
        project === null || project.hidden ? 0 : project.scrollWidth - project.clientWidth,
      setup: setup === null ? null : { text: (setup as HTMLElement).innerText, ...rect(setup) },
      busy: document.querySelector("[data-project-busy]")?.textContent ?? null,
      cancel: document.querySelector("[data-project-cancel]")?.getAttribute("data-project-cancel") ?? null,
      report:
        report === null
          ? null
          : {
              availability: report.getAttribute("data-availability"),
              text: (report as HTMLElement).innerText,
              rows: [...report.querySelectorAll("[data-targeted-row]")].map((row) => [
                row.getAttribute("data-outcome"),
                (row as HTMLElement).innerText,
              ]),
              ...rect(report),
            },
      rowsOverflow: rows === null ? 0 : rows.scrollWidth - rows.clientWidth,
      plot: plot === null ? null : rect(plot),
      traces: document.querySelectorAll("[data-targeted-trace]").length,
      details:
        inspector === null || inspector.hidden
          ? null
          : {
              describing: inspector.querySelector("[data-provenance]")?.getAttribute("data-provenance") ?? null,
              text: inspector.innerText,
              overflow: inspector.scrollWidth - inspector.clientWidth,
              ...rect(inspector),
            },
      focus:
        active === null || active === document.body
          ? null
          : {
              text: active.textContent,
              visible: (() => {
                const box = active.getBoundingClientRect();
                const bounds =
                  project !== null && !project.hidden && project.contains(active)
                    ? project.getBoundingClientRect()
                    : { top: 0, bottom: innerHeight };
                return box.top >= bounds.top - 1 && box.bottom <= Math.min(bounds.bottom, innerHeight) + 1;
              })(),
            },
      layerIdOnScreen: document.body.innerText.includes(layerId),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      pathsOnScreen: (document.body.innerText.match(/[A-Za-z]:\\[^\s]+/gu) ?? []).length,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  }, LAYER);
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
      "React/mock-IPC layout and interaction evidence. The plan, the run's phase and ending, " +
      "the stored rows and the evidence points are a controlled answer table; no worker ran, " +
      "no source was read and no result was stored.",
    ...measured,
  });

  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.projectOverflow).toBeLessThanOrEqual(1);
  expect(measured.rowsOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(measured.pathsOnScreen).toBe(0);
  expect(measured.layerIdOnScreen).toBe(false);
  if (measured.details !== null) expect(measured.details.overflow).toBeLessThanOrEqual(1);
  if (measured.plot !== null) {
    expect(measured.plot.x).toBeGreaterThanOrEqual(0);
    expect(measured.plot.x + measured.plot.width).toBeLessThanOrEqual(measured.css.width + 1);
  }
  return measured;
}

/** Reviews the typed plan from the layer row, by keyboard. */
async function review() {
  await browser.execute((layer: string) => {
    document.querySelector<HTMLElement>(`[data-project-targeted="${layer}"]`)?.focus();
  }, LAYER);
  await browser.keys("Enter");
  await browser.$("[data-targeted-setup]").waitForDisplayed();
  await browser.$("[data-targeted-text]").setValue(TYPED);
  await browser.$("[data-targeted-review]").click();
  await browser.$(`[data-targeted-plan="${PLAN_SHA}"]`).waitForDisplayed();
}

describe("M9.1 targeted MS1 setup, run and report, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_M91_OUTPUT_ROOT"] ?? resolve("test-results/m9.1");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M9.1 browser evidence: ${output}`);
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

  it("reviews typed targets, runs the plan with its phase on screen, and opens the stored result", async () => {
    await metrics(1920, 1080);
    await installIpcBoundary(table(project({})));
    await browser.url("/");
    await toProject();

    const beforeReview = await ipcCalls();
    await review();
    const ring = await focusedTreatment();
    evidence.push({ label: "m91-01-focus-treatment", ...ring });
    // The layer and the typed text; Rust decides what every value means.
    expect((await ipcCalls()).slice(beforeReview.length)).toEqual([
      {
        command: "resolve_targeted_ms1_plan",
        args: {
          request: {
            layerId: LAYER,
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
    const reviewed = await capture("m91-01-reviewed");
    expect(reviewed.setup?.text).toContain(en.targetedExperimental);
    expect(reviewed.setup?.text).toContain("pyOpenMS 3.5.0 · FeatureFinderMetaboIdent · c1370fb");

    // Run, held, so the run in progress can be looked at.
    await holdInvoke("run_targeted_ms1");
    const beforeRun = await ipcCalls();
    await browser.$("[data-targeted-run]").click();
    await browser.$("[data-project-busy-phase]").waitForDisplayed();
    const running = await capture("m91-02-running");
    expect(running.busy).toContain(en.projectBusyAnalysing);
    expect(running.busy).toContain(en.targetedPhaseRunningEngine);
    expect(running.cancel).toBe(OPERATION);
    const commands = (await ipcCalls()).slice(beforeRun.length).map((call) => call.command);
    // The accepted operation, then the run under its name. Everything else is a
    // progress read -- polled from the moment the run is pressed, and never a
    // project read that could replace what is on screen.
    const progress = "get_targeted_ms1_progress";
    expect(commands.filter((command) => command !== progress)).toEqual([
      "begin_project_job",
      "run_targeted_ms1",
    ]);
    expect(commands.filter((command) => command === progress).length).toBeGreaterThan(0);

    await releaseInvokeHold("run_targeted_ms1");
    await browser.$(`[data-targeted-report="${ARTIFACT}"] [data-targeted-row]`).waitForDisplayed();
    await browser.$(`[data-targeted-choose="${CAFFEINE}"]`).click();
    await browser.$("[data-targeted-plot] svg").waitForDisplayed();
    const reported = await capture("m91-03-report");
    expect(reported.report?.availability).toBe("available");
    expect(reported.report?.rows.map(([outcome]) => outcome)).toEqual(["DETECTED", "NOT_DETECTED"]);
    expect(reported.traces).toBe(2);
    expect(reported.details?.describing).toBe("artifact");
    expect(reported.details?.text).toContain(en.provenanceTargetedStored);
    expect(reported.details?.text).toContain(PLAN_SHA);
    // Bounded reads of this result only: its first page, and the chosen
    // target's evidence. The dev server runs under StrictMode, which mounts
    // the report's effect twice, so the page may be asked for twice here; the
    // unit suite, without StrictMode, proves exactly one read.
    const calls = await ipcCalls();
    const rows = calls.filter((call) => call.command === "read_targeted_ms1_rows");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(2);
    for (const call of rows) expect(call.args).toEqual({ artifactId: ARTIFACT, offset: 0 });
    expect(calls.filter((call) => call.command === "read_targeted_ms1_evidence")).toEqual([
      { command: "read_targeted_ms1_evidence", args: { artifactId: ARTIFACT, targetId: CAFFEINE } },
    ]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("cancels the run it started, by name, and records the stop without a result", async () => {
    await metrics(1366, 768);
    await installIpcBoundary(table(project({})));
    await browser.url("/");
    await toProject();
    await review();

    await holdInvoke("run_targeted_ms1");
    await browser.$("[data-targeted-run]").click();
    await browser.$(`[data-project-cancel="${OPERATION}"]`).waitForDisplayed();
    await browser.$(`[data-project-cancel="${OPERATION}"]`).click();
    await browser.waitUntil(async () =>
      (await ipcCalls()).some((call) => call.command === "cancel_project_job"),
    );
    expect((await ipcCalls()).find((call) => call.command === "cancel_project_job")?.args).toEqual({
      operationId: OPERATION,
    });
    await setInvokeResult("run_targeted_ms1", {
      project: project({ run: "cancelled" }),
      runId: RUN,
      outcome: "cancelled",
      artifactId: null,
    });
    await releaseInvokeHold("run_targeted_ms1");
    await browser.$('[data-targeted-last="cancelled"]').waitForDisplayed();
    // Below the roomy breakpoint Details waits to be asked for.
    const hint = browser.$("[data-project-inspect-hint] button");
    if (await hint.isExisting()) await hint.click();
    await browser.$('[data-provenance="run"]').waitForDisplayed();
    const cancelled = await capture("m91-04-cancelled-1366");
    expect(cancelled.report).toBeNull();
    expect(cancelled.details?.describing).toBe("run");
    expect(cancelled.details?.text).toContain(en.targetedStopCancel);
    expect(cancelled.details?.text).toContain(en.targetedSourceNotRead);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps the report, the plot and Details inside a 1366x768 and a narrow window", async () => {
    const long = `${"Plasma_QC_batch_09_".repeat(6)}replicate_04.mzML`;
    await installIpcBoundary(table(project({ run: "completed", label: long })));
    for (const [width, height, label] of [
      [1366, 768, "m91-05-report-1366"],
      [960, 640, "m91-06-report-960"],
    ] as const) {
      await metrics(width, height);
      await browser.url("/");
      await toProject();
      await browser.$(`[data-project-inspect-artifact="${ARTIFACT}"]`).click();
      await browser.$("[data-targeted-row]").waitForDisplayed();
      await browser.$(`[data-targeted-choose="${CAFFEINE}"]`).click();
      await browser.$("[data-targeted-plot] svg").waitForDisplayed();
      const shown = await capture(label);
      expect(shown.report?.text).toContain(long);
      expect(shown.report?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((shown.report?.x ?? 0) + (shown.report?.width ?? Infinity)).toBeLessThanOrEqual(width + 1);
      const hint = browser.$("[data-project-inspect-hint] button");
      if (await hint.isExisting()) await hint.click();
      await browser.$('[data-provenance="artifact"]').waitForDisplayed();
      await capture(`${label}-details`);
      expect(await unexpectedConsole()).toEqual([]);
    }
  });

  it("says a missing stored result is missing and reads nothing", async () => {
    await metrics(1366, 768);
    await installIpcBoundary(table(project({ run: "completed", availability: "payloadMissing" })));
    await browser.url("/");
    await toProject();
    await browser.$(`[data-project-inspect-artifact="${ARTIFACT}"]`).click();
    await browser.$('[data-targeted-unavailable="payloadMissing"]').waitForDisplayed();
    const missing = await capture("m91-07-payload-missing");
    expect(missing.report?.availability).toBe("payloadMissing");
    expect(missing.report?.text).toContain(en.targetedPayloadMissing);
    expect((await ipcCalls()).some((call) => call.command === "read_targeted_ms1_rows")).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("renders the setup, the report and Details in Simplified Chinese", async () => {
    await metrics(1366, 768);
    await installIpcBoundary(table(project({ run: "completed" }), "zh-CN"));
    await browser.url("/");
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
    await toProject();
    await browser.$(`[data-project-inspect-artifact="${ARTIFACT}"]`).click();
    await browser.$("[data-targeted-row]").waitForDisplayed();
    await browser.$(`[data-targeted-choose="${CAFFEINE}"]`).click();
    await browser.$("[data-targeted-plot] svg").waitForDisplayed();
    await browser.$(`[data-project-targeted="${LAYER}"]`).click();
    await browser.$("[data-targeted-setup]").waitForDisplayed();
    const chinese = await capture("m91-08-zh-CN");
    expect(chinese.lang).toBe("zh-CN");
    const shown = `${chinese.setup?.text ?? ""}
${chinese.report?.text ?? ""}
${chinese.details?.text ?? ""}`;
    for (const key of [
      "targetedSetupTitle",
      "targetedReportTitle",
      "targetedMeaning",
      "targetedDomain",
      "provenanceTargetedStored",
    ] as const) {
      expect(shown).not.toContain(en[key]);
    }
    expect(chinese.setup?.text).toContain(zh.targetedSetupTitle);
    expect(chinese.report?.text).toContain(zh.targetedMeaning);
    expect(chinese.details?.text).toContain(zh.provenanceTargetedStored);
    expect(await unexpectedConsole()).toEqual([]);
  });
});
