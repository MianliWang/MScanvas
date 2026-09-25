/**
 * A deterministic project store for browser tests.
 *
 * A fake, and it is labelled one. It proves what the interface does with each
 * answer the real boundary can give -- which outcomes are distinguishable, what
 * an explicit relink costs in presses, what a refusal leaves on screen. It
 * proves nothing about the filesystem: whether bytes really survive a refused
 * save, whether a digest really detects an edit at the same length, and whether
 * a stale save really refuses are proved against real files in
 * `apps/desktop/src-tauri/src/project/tests.rs`.
 */

import { vi } from "vitest";

import type { FigureSettings, WorkspaceAddResult } from "../features/mzml-preview/contracts";
import {
  NO_PROJECT,
  type AnalysisRun,
  type BatchMemberProgress,
  type BatchResolution,
  type CancelOutcome,
  type PayloadRow,
  type PlanResolution,
  type ProjectApi,
  type ProjectArtifact,
  type ProjectInput,
  type ProjectLayer,
  type ProjectRun,
  type ProjectState,
  type TargetEvidence,
  type TargetedMs1Plan,
  type TargetedNewRuns,
} from "../features/project/projectApi";

export interface FakeProjectApi extends ProjectApi {
  /** Replaces what the next answer will be. */
  readonly set: (next: ProjectState) => void;
  /** Makes the next call to one operation refuse with this identifier. */
  readonly refuseOnce: (operation: keyof ProjectApi, code: string) => void;
  /** Makes the next dialog operation answer as cancelled. */
  readonly cancelOnce: (operation: keyof ProjectApi) => void;
  /**
   * Withholds the next answer to one operation until the returned function is
   * called.
   *
   * A claim about what the interface says *while* an operation runs cannot be
   * made against a boundary that answers in the same microtask: the state never
   * exists on screen. This is how a check in flight can be looked at.
   */
  readonly holdOnce: (operation: keyof ProjectApi) => () => void;
  /** Every operation identifier a cancel named, in order. */
  readonly cancelled: string[];
  /**
   * Replaces the workspace half of the next reattachment answer.
   *
   * A fake, like the rest of this file: it proves what the interface does
   * with an added row, an existing row and a refused file. Whether the real
   * boundary produces those is proved against real files in
   * `apps/desktop/src-tauri/src/reattachment/tests.rs`.
   */
  readonly setAdmission: (result: WorkspaceAddResult) => void;
  /** What the next cancels answer. `cancelled` unless a test says otherwise. */
  readonly setCancelOutcome: (outcome: CancelOutcome) => void;
  /**
   * What the targeted-MS1 reads answer: a review, the stored rows, each
   * target's evidence, and the phase a progress poll reports.
   */
  readonly setTargeted: (next: Partial<FakeTargeted>) => void;
  readonly calls: string[];
}

export interface FakeTargeted {
  readonly resolution: PlanResolution;
  readonly rows: readonly PayloadRow[];
  readonly evidence: Readonly<Record<string, TargetEvidence>>;
  readonly progress: AnalysisRun | null;
  /** What the runtime read answers: whether a new run could start. */
  readonly newRuns: TargetedNewRuns;
  /** What a batch review answers. */
  readonly batchResolution: BatchResolution;
  /** Every member a finished batch answers with, in order. */
  readonly batchMembers: readonly BatchMemberProgress[];
}

/**
 * A figure the fake draws: a fixed, inert SVG naming the target and size.
 *
 * Not the renderer's output. That the stored evidence is drawn exactly, and
 * that a preview and an export of the same settings are the same document, is
 * proved in `apps/desktop/src-tauri/src/targeted_ms1/tests.rs`.
 */
export function fakeTargetedSvg(targetId: string, width: number, height: number, theme: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" data-target="${targetId}" data-theme="${theme}"><rect width="${width}" height="${height}" fill="${theme === "dark" ? "#111" : "#fff"}"/></svg>`;
}

/**
 * Resolves in the MutationObserver delivery that first shows `selector`.
 *
 * `findBy*` returns only after Testing Library's zero-delay timer, which
 * usually, but not always, lets React run the effects of the commit that showed
 * the element first. Nothing runs between this delivery and the caller, so a
 * press made here is a press the instant the element appears, before those
 * effects -- deterministically, whatever the host's timing.
 */
export function appears(selector: string): Promise<void> {
  if (document.querySelector(selector) !== null) {
    return Promise.reject(new Error(`${selector} was already on screen; this case needs its arrival`));
  }
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector) === null) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function projectInput(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    label: "sample.mzML",
    locatorKind: "outsideProject",
    members: [{ role: "primary", name: "", recordedByteLength: 1024 }],
    verification: "notChecked",
    unavailableReason: null,
    relinkProposed: false,
    relinkCandidateMatches: false,
    consumedByRunIds: [],
    workbenchDatasetHandle: null,
    ...overrides,
  };
}

export function projectRun(overrides: Partial<ProjectRun> = {}): ProjectRun {
  return {
    id: "ffffffff-1111-4111-8111-111111111111",
    operation: "captureFileFactsV1",
    outcome: "completed",
    inputIds: [],
    layerIds: [],
    outputArtifactIds: [],
    applicationVersion: "0.1.0",
    startedAt: "2026-09-22T10:00:00Z",
    finishedAt: "2026-09-22T10:00:01Z",
    ...overrides,
  };
}

export function projectArtifact(overrides: Partial<ProjectArtifact> = {}): ProjectArtifact {
  return {
    id: "eeeeeeee-1111-4111-8111-111111111111",
    label: "File facts: sample.mzML",
    kind: "fileFactsV1",
    observedInputCount: 1,
    observedMemberCount: 1,
    qcSnapshot: null,
    producedByRunId: null,
    sourceInputIds: [],
    ...overrides,
  };
}

/** One layer, sourced from the default reference unless a test says otherwise. */
export function projectLayer(overrides: Partial<ProjectLayer> = {}): ProjectLayer {
  return {
    id: "dddddddd-1111-4111-8111-111111111111",
    sourceInputId: projectInput().id,
    consumedByRunIds: [],
    ...overrides,
  };
}

const DIGEST = "A".repeat(64);

/** The engine identity every fake review answers with. */
export const FAKE_ENGINE = {
  package: "pyOpenMS",
  version: "3.5.0",
  algorithm: "FeatureFinderMetaboIdent",
  revision: "c1370fb",
  maturity: "experimental",
  fixedProfile: "{}",
} as const;

/** One reviewed plan over the default layer, with two targets. */
export function targetedPlan(overrides: Partial<TargetedMs1Plan> = {}): TargetedMs1Plan {
  return {
    planSha256: "B".repeat(64),
    recipe: {
      recipe: "targetedMs1",
      recipeVersion: 1,
      adapterSha256: DIGEST,
      engineProfileSha256: DIGEST,
      runtimeManifestSha256: DIGEST,
    },
    layerId: projectLayer().id,
    inputId: projectInput().id,
    expectedContent: [
      { role: "primary", relativeName: "", byteLength: 1024, sha256: DIGEST },
    ],
    parameters: { mzHalfWidthPpm: "5", expectedPeakWidthS: "6" },
    targetListSha256: "C".repeat(64),
    targets: [
      {
        targetId: "77777777-0000-4111-8111-000000000001",
        label: "Caffeine",
        formula: "C8H10N4O2",
        neutralMass: null,
        rtS: "120",
        rtHalfWidthS: "30",
      },
      {
        targetId: "77777777-0000-4111-8111-000000000002",
        label: "Absent",
        formula: "C9H9NO4",
        neutralMass: null,
        rtS: "300",
        rtHalfWidthS: "30",
      },
    ],
    ...overrides,
  };
}

/** A detected row for the plan's first target. */
export function detectedRow(overrides: Partial<PayloadRow> = {}): PayloadRow {
  return {
    targetId: targetedPlan().targets[0].targetId,
    outcome: "DETECTED",
    failureReason: null,
    edgeTraceCount: 0,
    ion: {
      adduct: "[M+H]+",
      charge: 1,
      mzTheoretical: [195.0877, 196.0911],
      isotopeProbability: [0.9, 0.1],
    },
    windows: {
      rtClosedS: [90, 150],
      mzOpen: [
        [195.0867, 195.0887],
        [196.0901, 196.0921],
      ],
    },
    signal: { points: 3, sum: [3000, 300], max: [2000, 200], anyNonzeroPoint: true },
    feature: {
      apexRtS: 120,
      leftS: 114,
      rightS: 126,
      rawArea: 21000,
      modelStatus: "0 (converged)",
      modelArea: 20500,
      modelFwhmS: 5.9,
      engineIntensity: 20500,
      engineIntensitySource: "modelArea",
    },
    candidates: [{ apexRtS: 120, leftS: 114, rightS: 126, rawArea: 21000 }],
    overlapWinner: false,
    relations: { sharedWith: [], suppressedBy: null, overlapRemoved: [] },
    recoveredFromEmptySelection: false,
    ...overrides,
  };
}

/** An absent row for the plan's second target. */
export function absentRow(overrides: Partial<PayloadRow> = {}): PayloadRow {
  return detectedRow({
    targetId: targetedPlan().targets[1].targetId,
    outcome: "NOT_DETECTED",
    ion: {
      adduct: "[M+H]+",
      charge: 1,
      mzTheoretical: [196.0604, 197.0638],
      isotopeProbability: [0.9, 0.1],
    },
    windows: {
      rtClosedS: [270, 330],
      mzOpen: [
        [196.0594, 196.0614],
        [197.0628, 197.0648],
      ],
    },
    signal: { points: 3, sum: [0, 0], max: [0, 0], anyNonzeroPoint: false },
    feature: null,
    candidates: [],
    ...overrides,
  });
}

/** The evidence a detected row's two traces carry. */
export function detectedEvidence(): TargetEvidence {
  const targetId = targetedPlan().targets[0].targetId;
  return {
    targetId,
    traces: [
      {
        targetId,
        trace: 0,
        mzTheoretical: 195.0877,
        points: [
          [10, 114, 500],
          [11, 120, 2000],
          [12, 126, 500],
        ],
      },
      {
        targetId,
        trace: 1,
        mzTheoretical: 196.0911,
        points: [
          [10, 114, 50],
          [11, 120, 200],
          [12, 126, 50],
        ],
      },
    ],
  };
}

/**
 * A saved project with one layer, one completed targeted run over it and the
 * result it produced, wired the way Rust wires them.
 */
export function targetedProject(
  availability: "available" | "payloadMissing" | "payloadCorrupt" = "available",
): ProjectState {
  const plan = targetedPlan();
  const runId = "ffffffff-7777-4111-8111-111111111111";
  const artifactId = "eeeeeeee-7777-4111-8111-111111111111";
  const layer = projectLayer({ consumedByRunIds: [runId] });
  const input = projectInput({ verification: "matchingRecordedContent" });
  return openProject({
    published: true,
    inputs: [input],
    layers: [layer],
    plans: [plan],
    runs: [
      projectRun({
        id: runId,
        operation: "targetedMs1V1",
        layerIds: [layer.id],
        outputArtifactIds: [artifactId],
        targetedMs1: {
          planSha256: plan.planSha256,
          consumedContent: plan.expectedContent,
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
      }),
    ],
    artifacts: [
      projectArtifact({
        id: artifactId,
        label: "Targeted MS1 result",
        kind: "targetedMs1ResultV1",
        observedInputCount: 0,
        observedMemberCount: 0,
        producedByRunId: runId,
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
      }),
    ],
    resultStore: { storeFound: availability !== "payloadMissing", unreferencedResults: 0 },
  });
}

/**
 * One reference, the run that consumed it and the artifact it produced, wired
 * to each other the way Rust wires them.
 *
 * Built in one helper so a test asks for a lineage rather than assembling five
 * identifiers by hand and risking an edge that points nowhere.
 */
export function capturedProject(
  overrides: { readonly input?: Partial<ProjectInput> } = {},
): ProjectState {
  const input = projectInput({
    id: "11111111-2222-4111-8111-111111111111",
    label: "QC_pool_01.mzML",
    consumedByRunIds: ["ffffffff-2222-4111-8111-111111111111"],
    ...overrides.input,
  });
  const artifact = projectArtifact({
    id: "eeeeeeee-2222-4111-8111-111111111111",
    producedByRunId: "ffffffff-2222-4111-8111-111111111111",
    sourceInputIds: [input.id],
  });
  const run = projectRun({
    id: "ffffffff-2222-4111-8111-111111111111",
    inputIds: [input.id],
    outputArtifactIds: [artifact.id],
  });
  return openProject({ inputs: [input], runs: [run], artifacts: [artifact] });
}

export function openProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    open: true,
    projectId: "aaaaaaaa-0000-4111-8111-000000000001",
    name: "Test project",
    dirty: false,
    published: false,
    inputs: [projectInput()],
    artifacts: [],
    runs: [],
    layers: [],
    ...overrides,
  };
}

export function createFakeProjectApi(initial: ProjectState = NO_PROJECT): FakeProjectApi {
  let state = initial;
  const refusals = new Map<string, string>();
  const cancellations = new Set<string>();
  const held = new Map<string, () => void>();
  /** How a held call is let go, once it has actually been made. */
  const release = new Map<string, () => void>();
  const calls: string[] = [];
  /** Identifiers are minted in order, as the store mints them. */
  let accepted = 0;
  let cancelOutcome: CancelOutcome = "cancelled";
  const cancelled: string[] = [];
  /** What the next reattachment answers with on the workspace half. */
  let admission: WorkspaceAddResult = { roster: { datasets: [], capacity: 24 }, outcomes: [] };
  let targeted: FakeTargeted = {
    resolution: { plan: targetedPlan(), problems: [], blocked: null, engine: FAKE_ENGINE },
    rows: [detectedRow(), absentRow()],
    evidence: { [detectedEvidence().targetId]: detectedEvidence() },
    progress: null,
    newRuns: "available",
    batchResolution: { problems: [], common: null, members: [], engine: FAKE_ENGINE },
    batchMembers: [],
  };

  /** A dialog output's answer: cancelled when staged so, otherwise what was saved. */
  function dialog<T>(operation: keyof ProjectApi, saved: () => T): Promise<T | { readonly status: "cancelled" }> {
    if (cancellations.has(operation)) {
      calls.push(operation);
      cancellations.delete(operation);
      return Promise.resolve({ status: "cancelled" });
    }
    return read(operation, saved);
  }

  /** A read's answer, after recording the call and honouring a staged refusal. */
  function read<T>(operation: keyof ProjectApi, value: () => T): Promise<T> {
    calls.push(operation);
    const refusal = refusals.get(operation);
    if (refusal !== undefined) {
      refusals.delete(operation);
      return Promise.reject({ kind: refusal, summary: refusal, detail: null, retryable: false });
    }
    const gate = held.get(operation);
    if (gate !== undefined) {
      held.delete(operation);
      return new Promise((resolve) => {
        release.set(operation, () => resolve(value()));
        gate();
      });
    }
    return Promise.resolve(value());
  }

  /** One answer, after recording the call and honouring any staged outcome. */
  function answer(operation: keyof ProjectApi): Promise<ProjectState | null> {
    calls.push(operation);
    const refusal = refusals.get(operation);
    if (refusal !== undefined) {
      refusals.delete(operation);
      // The shape Tauri actually rejects with, field for field: the owned
      // error the boundary serializes, whose stable identifier is `kind`.
      return Promise.reject({ kind: refusal, summary: refusal, detail: null, retryable: false });
    }
    if (cancellations.has(operation)) {
      cancellations.delete(operation);
      return Promise.resolve(null);
    }
    const gate = held.get(operation);
    if (gate !== undefined) {
      held.delete(operation);
      return new Promise((resolve) => {
        release.set(operation, () => resolve(state));
        gate();
      });
    }
    return Promise.resolve(state);
  }

  const api: FakeProjectApi = {
    set: (next) => {
      state = next;
    },
    refuseOnce: (operation, code) => refusals.set(operation, code),
    cancelOnce: (operation) => cancellations.add(operation),
    holdOnce: (operation) => {
      held.set(operation, () => undefined);
      return () => {
        release.get(operation)?.();
        release.delete(operation);
      };
    },
    cancelled,
    setCancelOutcome: (outcome) => {
      cancelOutcome = outcome;
    },
    setAdmission: (result) => {
      admission = result;
    },
    setTargeted: (next) => {
      targeted = { ...targeted, ...next };
    },
    calls,
    getProjectState: vi.fn(() => answer("getProjectState") as Promise<ProjectState>),
    createProject: vi.fn(() => answer("createProject") as Promise<ProjectState>),
    closeProject: vi.fn(() => answer("closeProject") as Promise<ProjectState>),
    openProject: vi.fn(() => answer("openProject")),
    saveProject: vi.fn(() => answer("saveProject") as Promise<ProjectState>),
    saveProjectAs: vi.fn(() => answer("saveProjectAs")),
    addProjectInput: vi.fn(() => answer("addProjectInput")),
    removeProjectInput: vi.fn(() => answer("removeProjectInput") as Promise<ProjectState>),
    beginProjectJob: vi.fn(() => {
      calls.push("beginProjectJob");
      const refusal = refusals.get("beginProjectJob");
      if (refusal !== undefined) {
        refusals.delete("beginProjectJob");
        return Promise.reject({ kind: refusal, summary: refusal, detail: null, retryable: false });
      }
      accepted += 1;
      return Promise.resolve({ operationId: `project-job-${accepted}` });
    }),
    checkProjectLinks: vi.fn(
      (_operationId: string) => answer("checkProjectLinks") as Promise<ProjectState>,
    ),
    cancelProjectJob: vi.fn((operationId: string) => {
      calls.push("cancelProjectJob");
      cancelled.push(operationId);
      return Promise.resolve({ outcome: cancelOutcome });
    }),
    captureProjectFileFacts: vi.fn(
      (_operationId: string, _inputIds: readonly string[]) =>
        answer("captureProjectFileFacts") as Promise<ProjectState>,
    ),
    addProjectInputToWorkspace: vi.fn(async (_operationId: string, _inputId: string) => {
      const project = (await answer("addProjectInputToWorkspace")) as ProjectState;
      return { project, workspace: admission };
    }),
    proposeProjectRelink: vi.fn(() => answer("proposeProjectRelink")),
    commitProjectRelink: vi.fn(() => answer("commitProjectRelink") as Promise<ProjectState>),
    abandonProjectRelink: vi.fn(() => answer("abandonProjectRelink") as Promise<ProjectState>),
    createProjectLayer: vi.fn(
      (_inputId: string) => answer("createProjectLayer") as Promise<ProjectState>,
    ),
    removeProjectLayer: vi.fn(
      (_layerId: string) => answer("removeProjectLayer") as Promise<ProjectState>,
    ),
    captureProjectQcSummary: vi.fn(async (_layerId: string, _previewToken: string) => {
      const project = (await answer("captureProjectQcSummary")) as ProjectState;
      // The newest snapshot the staged answer holds, which is the one a real
      // capture would have just appended.
      const recorded = project.artifacts.filter(
        (artifact) => artifact.kind === "acquisitionQcSnapshotV1",
      );
      return { project, artifactId: recorded.at(-1)?.id ?? "" };
    }),
    resolveTargetedMs1Plan: vi.fn(() =>
      read("resolveTargetedMs1Plan", () => targeted.resolution),
    ),
    runTargetedMs1: vi.fn(async (_operationId: string, _planSha256: string) => {
      const project = (await answer("runTargetedMs1")) as ProjectState;
      // The newest targeted run the staged answer holds, which is the one a
      // real run would have just recorded.
      const run = project.runs.filter((each) => each.operation === "targetedMs1V1").at(-1);
      return {
        project,
        runId: run?.id ?? "",
        outcome: run?.outcome ?? "failed",
        artifactId: run?.outputArtifactIds[0] ?? null,
      };
    }),
    resolveTargetedMs1Batch: vi.fn(() =>
      read("resolveTargetedMs1Batch", () => targeted.batchResolution),
    ),
    runTargetedMs1Batch: vi.fn(async (_operationId: string, _planSha256s: readonly string[]) => {
      const project = (await answer("runTargetedMs1Batch")) as ProjectState;
      return { project, members: targeted.batchMembers };
    }),
    // Not recorded in `calls`: it is polled while a run is out, and a test's
    // list of what the user caused would otherwise depend on timing.
    getTargetedMs1Progress: vi.fn(() => Promise.resolve(targeted.progress)),
    readTargetedMs1Rows: vi.fn((_artifactId: string, offset: number) =>
      read("readTargetedMs1Rows", () => ({
        total: targeted.rows.length,
        offset,
        rows: targeted.rows.slice(offset),
      })),
    ),
    readTargetedMs1Evidence: vi.fn((_artifactId: string, targetId: string) =>
      read("readTargetedMs1Evidence", () => targeted.evidence[targetId] ?? { targetId, traces: [] }),
    ),
    previewTargetedMs1Figure: vi.fn((_artifactId: string, targetId: string, settings: FigureSettings) =>
      read("previewTargetedMs1Figure", () => ({
        svg: fakeTargetedSvg(targetId, settings.widthPx, settings.heightPx, settings.theme),
        specId: `spec-${targetId}-${settings.widthPx}x${settings.heightPx}-${settings.theme}`,
        width: settings.widthPx,
        height: settings.heightPx,
      })),
    ),
    exportTargetedMs1Figure: vi.fn(
      (artifactId: string, _targetId: string, format: "svg" | "png", settings: FigureSettings) =>
        dialog("exportTargetedMs1Figure", () => ({
          status: "saved" as const,
          format,
          fileName: `mscanvas-targeted-ms1-${artifactId.slice(0, 8)}-target-1.${format}`,
          figure: {
            width: settings.widthPx,
            height: settings.heightPx,
            dpi: format === "png" ? settings.pngDpi : null,
            theme: settings.theme,
          },
        })),
    ),
    exportTargetedMs1Table: vi.fn((artifactId: string, format: "csv" | "tsv") =>
      dialog("exportTargetedMs1Table", () => ({
        status: "saved" as const,
        format,
        fileName: `mscanvas-targeted-ms1-${artifactId.slice(0, 8)}-results.${format}`,
        rowCount: targeted.rows.length,
      })),
    ),
    // Not recorded in `calls`, like the progress poll: every report asks it
    // once on mount, and it is about new runs, not about anything the user did.
    getTargetedMs1Runtime: vi.fn(() => Promise.resolve({ newRuns: targeted.newRuns })),
  };
  return api;
}
