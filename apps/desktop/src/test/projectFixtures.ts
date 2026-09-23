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

import type { WorkspaceAddResult } from "../features/mzml-preview/contracts";
import {
  NO_PROJECT,
  type CancelOutcome,
  type ProjectApi,
  type ProjectArtifact,
  type ProjectInput,
  type ProjectLayer,
  type ProjectRun,
  type ProjectState,
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
  readonly calls: string[];
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
  };
  return api;
}
