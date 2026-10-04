/**
 * The targeted MS1 task as the browser answers it: one saved project with three
 * acquisitions, and the plan reviews, runs and batch endings a reader drives
 * through it.
 *
 * Shared by the PM9.5 spec and the manual review harness's `targetedTask`
 * scenario (`pm9Scenarios.ts`), so a state a person inspects is the one the
 * automated contract asserts. Every digest, plan, problem, phase, member state
 * and ending is a controlled answer written here: no worker ran, no source was
 * read and nothing was recorded. The answers do not depend on what is asked,
 * so a review answers this file's plan whatever was typed.
 */

import { ipcTable } from "./fixtures";

export type Locale = "en" | "zh-CN";

export const OPERATION = "project-job-1";
/** Controlled fixture digests: nothing here was measured. */
const DIGEST = "A1".repeat(32);
export const LIST_SHA = "C3".repeat(32);
/** A short name, a long one and a Chinese one, in the project's order. */
export const LABELS = [
  "QC_pool_01.mzML",
  `${"Plasma_QC_batch_08_".repeat(4)}replicate_04.mzML`,
  "血浆 样品 12.mzML",
] as const;
/** The `n`th identifier of one kind, counted from one. */
const id = (prefix: string, n: number) => `${prefix}-9595-4111-8111-${String(n).padStart(12, "0")}`;
export const INPUTS = LABELS.map((_, index) => id("11111111", index + 1));
export const LAYERS = LABELS.map((_, index) => id("dddddddd", index + 1));
export const SHAS = ["B2".repeat(32), "D4".repeat(32), "E5".repeat(32)];
export const RUNS = LABELS.map((_, index) => id("ffffffff", index + 1));
export const ARTIFACTS = LABELS.map((_, index) => id("eeeeeeee", index + 1));
export const CAFFEINE = id("77777777", 1);
export const ABSENT = id("77777777", 2);

const RECIPE = {
  recipe: "targetedMs1",
  recipeVersion: 1,
  adapterSha256: DIGEST,
  engineProfileSha256: DIGEST,
  runtimeManifestSha256: DIGEST,
};
const PARAMETERS = { mzHalfWidthPpm: "5", expectedPeakWidthS: "6" };
export const TARGETS = [
  { targetId: CAFFEINE, label: "Caffeine", formula: "C8H10N4O2", neutralMass: null, rtS: "120", rtHalfWidthS: "30" },
  { targetId: ABSENT, label: "Absent", formula: "C9H9NO4", neutralMass: null, rtS: "300", rtHalfWidthS: "30" },
];
export const ENGINE = {
  package: "pyOpenMS",
  version: "3.5.0",
  algorithm: "FeatureFinderMetaboIdent",
  revision: "c1370fb",
  maturity: "experimental",
  fixedProfile: "{}",
};

/**
 * The two targets as typed, comma-separated: WebDriver types a tab as the Tab
 * key, which moves focus.
 */
export const TYPED = "Caffeine, C8H10N4O2, 120, 30\nAbsent, C9H9NO4, 300, 30";

/** What the setup sends for {@link TYPED}. */
export const SENT_TARGETS = [
  { label: "Caffeine", formula: "C8H10N4O2", rtS: "120", rtHalfWidthS: "30", neutralMass: null },
  { label: "Absent", formula: "C9H9NO4", rtS: "300", rtHalfWidthS: "30", neutralMass: null },
];

export function plan(index: number) {
  return {
    planSha256: SHAS[index],
    recipe: RECIPE,
    layerId: LAYERS[index],
    inputId: INPUTS[index],
    expectedContent: [{ role: "primary", relativeName: "", byteLength: 2048 + index, sha256: SHAS[index] }],
    parameters: PARAMETERS,
    targetListSha256: LIST_SHA,
    targets: TARGETS,
  };
}

/** A single review of one acquisition: its plan, ready unless `blocked` names a refusal. */
export function planReview(index = 0, blocked: string | null = null) {
  return { plan: plan(index), problems: [], blocked, engine: ENGINE };
}

/** A single review that found problems, and so has no plan. */
export function problemsReview(problems: readonly { row: number | null; field: string; problem: string }[]) {
  return { plan: null, problems, blocked: null, engine: ENGINE };
}

/** A batch review of all three, each member as `members` says. */
export function batchReview(members: Record<number, Record<string, unknown>> = {}) {
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

/**
 * How one acquisition's run ended: completed with targets found, completed
 * with every target not detected, failed or cancelled; `null` for none.
 */
export type Ending = "completed" | "negative" | "failed" | "cancelled" | null;

const SUMMARIES = {
  completed: { targets: 2, detected: 1, detectedAmbiguous: 0, shared: 0, suppressedByOverlap: 0, notDetected: 1, failed: 0 },
  negative: { targets: 2, detected: 0, detectedAmbiguous: 0, shared: 0, suppressedByOverlap: 0, notDetected: 2, failed: 0 },
};

/** A saved project with the three layers and, per layer, the run a request left. */
export function project(endings: readonly Ending[] = [null, null, null]) {
  const run = (index: number, ending: Exclude<Ending, null>) => {
    const completed = ending === "completed" || ending === "negative";
    return {
      id: RUNS[index],
      operation: "targetedMs1V1",
      outcome: completed ? "completed" : ending,
      inputIds: [],
      layerIds: [LAYERS[index]],
      outputArtifactIds: completed ? [ARTIFACTS[index]] : [],
      applicationVersion: "0.1.0",
      startedAt: `2026-10-04T10:0${index}:00Z`,
      finishedAt: `2026-10-04T10:0${index}:09Z`,
      targetedMs1: {
        planSha256: SHAS[index],
        consumedContent: ending === "failed" ? [] : plan(index).expectedContent,
        attempt:
          ending === "failed"
            ? null
            : {
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
                loadedModules: [],
              },
        failure: ending === "failed" ? { code: "sourceChanged", stage: "source" } : null,
        stop: ending === "cancelled" ? { reason: "cancelRequested", workerTerminated: true, exitObserved: true } : null,
      },
    };
  };
  const ran = endings.flatMap((ending, index) => (ending === null ? [] : [{ ending, index }]));
  return {
    open: true,
    projectId: "aaaaaaaa-9595-4111-8111-000000000001",
    name: "Plasma batch 9",
    dirty: ran.length > 0,
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
    plans: ran.map(({ index }) => plan(index)),
    runs: ran.map(({ ending, index }) => run(index, ending)),
    artifacts: ran.flatMap(({ ending, index }) =>
      ending === "completed" || ending === "negative"
        ? [
            {
              id: ARTIFACTS[index],
              label: "Targeted MS1 result",
              kind: "targetedMs1ResultV1",
              observedInputCount: 0,
              observedMemberCount: 0,
              qcSnapshot: null,
              producedByRunId: RUNS[index],
              sourceInputIds: [],
              targetedMs1: {
                result: {
                  summary: SUMMARIES[ending],
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
    ),
    analysisRun: null,
    resultStore: { storeFound: true, unreferencedResults: 0 },
  };
}

/** How one single run over acquisition `index` ends, with the project as it then is. */
export function singleEnd(index: number, ending: Exclude<Ending, null>) {
  const endings: Ending[] = [null, null, null];
  endings[index] = ending;
  const completed = ending === "completed" || ending === "negative";
  return {
    project: project(endings),
    runId: RUNS[index],
    outcome: completed ? "completed" : ending,
    artifactId: completed ? ARTIFACTS[index] : null,
  };
}

/** One batch member as Rust reports it. */
export function member(index: number, state: string, extra: Record<string, unknown> = {}) {
  return { layerId: LAYERS[index], planSha256: SHAS[index], state, runId: null, artifactId: null, reason: null, ...extra };
}

/** A member that ran, with the run (and result, where it completed) its ending recorded. */
export function ranMember(index: number, ending: Exclude<Ending, null>) {
  const completed = ending === "completed" || ending === "negative";
  return member(index, completed ? "completed" : ending, {
    runId: RUNS[index],
    artifactId: completed ? ARTIFACTS[index] : null,
  });
}

/**
 * The mixed ending: the first acquisition completed with a target found, the
 * second failed, the third completed with every target not detected.
 */
export function mixedBatchEnd() {
  return {
    project: project(["completed", "failed", "negative"]),
    members: [ranMember(0, "completed"), ranMember(1, "failed"), ranMember(2, "negative")],
  };
}

/** A batch stopped while its second member ran: the third never started and has no run. */
export function stoppedBatchEnd() {
  return {
    project: project(["completed", "cancelled", null]),
    members: [ranMember(0, "completed"), ranMember(1, "cancelled"), member(2, "notStarted")],
  };
}

/** The batch in progress: the first member done, the second running, the third queued. */
export function batchProgress() {
  return {
    operationId: OPERATION,
    phase: "runningEngine",
    batch: [ranMember(0, "completed"), member(1, "running"), member(2, "queued")],
  };
}

function row(targetId: string, detected: boolean) {
  return {
    targetId,
    outcome: detected ? "DETECTED" : "NOT_DETECTED",
    failureReason: null,
    edgeTraceCount: 0,
    ion: {
      adduct: "[M+H]+",
      charge: 1,
      mzTheoretical: targetId === CAFFEINE ? [195.0877, 196.0911] : [196.0604, 197.0638],
      isotopeProbability: [0.9, 0.1],
    },
    windows:
      targetId === CAFFEINE
        ? { rtClosedS: [90, 150], mzOpen: [[195.0867, 195.0887], [196.0901, 196.0921]] }
        : { rtClosedS: [270, 330], mzOpen: [[196.0594, 196.0614], [197.0628, 197.0648]] },
    signal: detected
      ? { points: 9, sum: [9200, 920], max: [4000, 400], anyNonzeroPoint: true }
      : { points: 9, sum: [0, 0], max: [0, 0], anyNonzeroPoint: false },
    feature: detected
      ? {
          apexRtS: 120,
          leftS: 111,
          rightS: 129,
          rawArea: 21000,
          modelStatus: "0 (converged)",
          modelArea: 20500,
          modelFwhmS: 5.9,
          engineIntensity: 20500,
          engineIntensitySource: "modelArea",
        }
      : null,
    candidates: detected ? [{ apexRtS: 120, leftS: 111, rightS: 129, rawArea: 21000 }] : [],
    overlapWinner: false,
    relations: { sharedWith: [], suppressedBy: null, overlapRemoved: [] },
    recoveredFromEmptySelection: false,
  };
}

/** The stored rows of a result with Caffeine detected and the other target not. */
export const DETECTED_ROWS = { total: 2, offset: 0, rows: [row(CAFFEINE, true), row(ABSENT, false)] };
/** The stored rows of a completed result whose every target was not detected. */
export const NEGATIVE_ROWS = { total: 2, offset: 0, rows: [row(CAFFEINE, false), row(ABSENT, false)] };

/** A labelled stand-in for the renderer's SVG; never the renderer's output. */
const STAND_IN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640">' +
  '<rect width="1200" height="640" fill="#ffffff"/>' +
  '<text x="40" y="60" font-family="sans-serif" font-size="28" fill="#1f2328">' +
  "Fixture figure (PM9.5 browser stand-in, not the renderer&apos;s output)</text></svg>";

/**
 * The whole table: the project with nothing run yet, a ready single and batch
 * review, a single run that completes and a batch that ends mixed. Specs
 * replace one answer at a time for the state they drive.
 */
export function targetedTable(locale: Locale = "en", state: unknown = project()): Record<string, unknown> {
  const answers: Record<string, unknown> = ipcTable();
  answers.get_project_state = state;
  answers.begin_project_job = { operationId: OPERATION };
  answers.cancel_project_job = { outcome: "cancelled" };
  answers.resolve_targeted_ms1_plan = planReview(0);
  answers.resolve_targeted_ms1_batch = batchReview();
  answers.get_targeted_ms1_progress = { operationId: OPERATION, phase: "runningEngine" };
  answers.run_targeted_ms1 = singleEnd(0, "completed");
  answers.run_targeted_ms1_batch = mixedBatchEnd();
  answers.read_targeted_ms1_rows = DETECTED_ROWS;
  answers.read_targeted_ms1_evidence = { targetId: CAFFEINE, traces: [] };
  answers.preview_targeted_ms1_figure = { svg: STAND_IN_SVG, specId: "pm95-stand-in", width: 1200, height: 640 };
  answers.get_targeted_ms1_runtime = { newRuns: "available" };
  // A working native drop subscription, as the PM9 scenarios answer it.
  answers.subscribe_workspace_drop_updates = { reservationId: "pm95-browser-reservation" };
  const preferences = {
    schemaVersion: 1,
    appearance: { locale, density: "comfortable" },
    layout: { roster: "automatic", details: "automatic" },
  };
  // Saved preferences are read back, so a Chinese session stays Chinese.
  if (locale !== "en") answers.load_ui_preferences = { outcome: "loaded", revision: 1, preferences };
  answers.save_ui_preferences = { outcome: "saved", revision: 2, preferences };
  return answers;
}

// ------------------------------------------------------------ the bounds

/** The most targets one plan holds (M9 closure §3.1). */
export const MAX_TARGETS = 200;

/** `count` targets, in order, as Rust would answer them. */
export function manyTargets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    targetId: id("77777777", index + 1),
    label: `Target_${String(index + 1).padStart(3, "0")}`,
    formula: "C8H10N4O2",
    neutralMass: null,
    rtS: String(60 + index),
    rtHalfWidthS: "30",
  }));
}

/** The same `count` targets as typed, one per line. */
export function manyTyped(count: number) {
  return manyTargets(count)
    .map((target) => `${target.label}, ${target.formula}, ${target.rtS}, ${target.rtHalfWidthS}`)
    .join("\n");
}

/** A ready single review of the first acquisition holding `count` targets. */
export function manyPlanReview(count: number) {
  return { plan: { ...plan(0), targets: manyTargets(count) }, problems: [], blocked: null, engine: ENGINE };
}

/** The most acquisitions one batch names (M9 closure §3.6). */
export const MAX_MEMBERS = 16;

/** A saved project with `count` acquisitions, the third with a Chinese name. */
export function wideProject(count: number) {
  const labels = Array.from({ length: count }, (_, index) =>
    index === 2 ? "血浆 样品 12.mzML" : `Plasma_QC_batch_08_replicate_${String(index + 1).padStart(2, "0")}.mzML`,
  );
  return {
    ...project(),
    inputs: labels.map((label, index) => ({
      id: id("11111111", index + 1),
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
    layers: labels.map((_, index) => ({ id: id("dddddddd", index + 1), sourceInputId: id("11111111", index + 1), consumedByRunIds: [] })),
  };
}

/** A ready batch review of every acquisition of {@link wideProject}. */
export function wideBatchReview(count: number) {
  return {
    problems: [],
    common: { recipe: RECIPE, parameters: PARAMETERS, targetListSha256: LIST_SHA, targets: TARGETS },
    members: Array.from({ length: count }, (_, index) => ({
      layerId: id("dddddddd", index + 1),
      inputId: id("11111111", index + 1),
      planSha256: `${String(index + 1).padStart(2, "0")}`.repeat(32),
      expectedContent: [{ role: "primary", relativeName: "", byteLength: 2048 + index, sha256: DIGEST }],
      refused: null,
      blocked: null,
    })),
    engine: ENGINE,
  };
}

/** The layer identifiers of {@link wideProject}. */
export function wideLayers(count: number) {
  return Array.from({ length: count }, (_, index) => id("dddddddd", index + 1));
}
