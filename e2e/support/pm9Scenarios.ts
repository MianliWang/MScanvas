/**
 * The PM9 controlled scenarios as the browser answers them: one answer table
 * per state, built from the repository's own fixtures.
 *
 * Shared by the PM9.1 baseline spec and the manual review harness
 * (`e2e/manual/`), so a scenario a human inspects is the one the automated
 * contract asserts. Moved here unchanged from `pm9.1-baseline.browser.e2e.ts`.
 */

import { MZML_ROW, SETTLED_AUTHORITY, VENDOR_ROW, ipcTable } from "./fixtures";
import {
  FAKE_WORKSPACE_CAPACITY,
  collidingFile,
  finalizedAttemptFacts,
  otherCollidingFile,
  queueItem,
  queueOf,
  secondFile,
  thirdFile,
} from "../../apps/desktop/src/test/previewFixtures";

export type Locale = "en" | "zh-CN";

/**
 * `pm9Scenarios.tsx`'s populated roster, as Rust answers it: where two rows
 * share a filename, Rust names the folder each was found in, and the fake
 * derives the same words from the folders the scenario gives them.
 */
export const POPULATED_ROSTER = {
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

export const EMPTY_ROSTER = { datasets: [], capacity: FAKE_WORKSPACE_CAPACITY };

/** One read of the conversion slot, in the shape every answer of it has. */
export function conversionSlot(sequence: number, state: unknown) {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: SETTLED_AUTHORITY,
  };
}

/** `pm9Scenarios.tsx`'s `converting`: the vendor row under way. */
export const RUNNING = {
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
export const SETTLED = {
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

export const NO_PROJECT = {
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
export const CAPTURED_INPUT = "11111111-2222-4111-8111-111111111111";
export const CAPTURED_RUN = "ffffffff-2222-4111-8111-111111111111";
export const CAPTURED_ARTIFACT = "eeeeeeee-2222-4111-8111-111111111111";

export function capturedProject(overrides: Record<string, unknown> = {}) {
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
export const DIGEST = "A".repeat(64);
export const PLAN_SHA = "B".repeat(64);
export const TARGETED_INPUT = "11111111-1111-4111-8111-111111111111";
export const TARGETED_LAYER = "dddddddd-1111-4111-8111-111111111111";
export const TARGETED_RUN = "ffffffff-7777-4111-8111-111111111111";
export const RESULT = "eeeeeeee-7777-4111-8111-111111111111";
export const CAFFEINE = "77777777-0000-4111-8111-000000000001";
export const ABSENT = "77777777-0000-4111-8111-000000000002";

export type Availability = "available" | "payloadMissing" | "payloadCorrupt";

export function targetedProject(
  availability: Availability,
  options: {
    readonly sourceMissing?: boolean;
    readonly name?: string;
    readonly label?: string;
    // e2e only: projectFixtures.ts has no counterpart, and no Vitest fixture changes.
    readonly modules?: readonly string[];
  } = {},
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
            loadedModules: (options.modules ?? ["pyopenms/_pyopenms_1.pyd"]).map((name) => ({ name, sha256: DIGEST })),
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
export function storedRow(targetId: string, detected: boolean) {
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
export const STAND_IN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640">' +
  '<rect width="1200" height="640" fill="#ffffff"/>' +
  '<text x="40" y="60" font-family="sans-serif" font-size="28" fill="#1f2328">' +
  "Fixture figure (PM9 browser stand-in, not the renderer&apos;s output)</text></svg>";

/** Browser-only variant: M8.5's QC capture over the populated roster's viewed row. */
export const QC_INPUT = "11111111-9901-4111-8111-111111111111";
export const QC_LAYER = "dddddddd-9901-4111-8111-111111111111";
export const QC_RUN = "ffffffff-9901-4111-8111-111111111111";
export const QC_ARTIFACT = "eeeeeeee-9901-4111-8111-111111111111";

/** M8.5's controlled snapshot; no build and no acquisition produced it. */
export const QC_SNAPSHOT = {
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

export function qcProject(captured: boolean) {
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

export function preferences(locale: Locale) {
  return {
    schemaVersion: 1,
    appearance: { locale, density: "comfortable" },
    layout: { roster: "automatic", details: "automatic" },
  };
}

/** Every controlled state, in the order baseline.md §4 and §6 name them. */
export const SCENARIOS = [
  "populated",
  "converting",
  "projectWithResult",
  "resultPayloadMissing",
  "resultPayloadCorrupt",
  "resultSourceAndRuntimeUnavailable",
  "qcCapture",
  "busyInspected",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

/**
 * One answer table per state. The first five mirror `pm9Scenarios.tsx` by
 * name; the last three are browser-only variants named in baseline.md §6.
 */
export function scenario(name: Scenario, locale: Locale = "en"): Record<string, unknown> {
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
        // A real run's module paths (adapter_v1.py), wider than any fact label in Details.
        modules: ["python313.dll", "site-packages/pyopenms/_pyopenms_1.cp313-win_amd64.pyd"],
      });
      return table;
  }
}
