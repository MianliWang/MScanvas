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

import {
  NO_PROJECT,
  type CancelOutcome,
  type ProjectApi,
  type ProjectInput,
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
    ...overrides,
  };
}

export function openProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    open: true,
    name: "Test project",
    dirty: false,
    published: false,
    inputs: [projectInput()],
    artifacts: [],
    runs: [],
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

  /** One answer, after recording the call and honouring any staged outcome. */
  function answer(operation: keyof ProjectApi): Promise<ProjectState | null> {
    calls.push(operation);
    const refusal = refusals.get(operation);
    if (refusal !== undefined) {
      refusals.delete(operation);
      // The shape Tauri rejects with: the boundary's own stable identifier.
      return Promise.reject({ code: refusal, message: refusal, retryable: false });
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
        return Promise.reject({ code: refusal, message: refusal, retryable: false });
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
    proposeProjectRelink: vi.fn(() => answer("proposeProjectRelink")),
    commitProjectRelink: vi.fn(() => answer("commitProjectRelink") as Promise<ProjectState>),
    abandonProjectRelink: vi.fn(() => answer("abandonProjectRelink") as Promise<ProjectState>),
  };
  return api;
}
