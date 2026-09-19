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
  const calls: string[] = [];

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
    return Promise.resolve(state);
  }

  const api: FakeProjectApi = {
    set: (next) => {
      state = next;
    },
    refuseOnce: (operation, code) => refusals.set(operation, code),
    cancelOnce: (operation) => cancellations.add(operation),
    calls,
    getProjectState: vi.fn(() => Promise.resolve(state)),
    createProject: vi.fn(() => answer("createProject") as Promise<ProjectState>),
    closeProject: vi.fn(() => answer("closeProject") as Promise<ProjectState>),
    openProject: vi.fn(() => answer("openProject")),
    saveProject: vi.fn(() => answer("saveProject") as Promise<ProjectState>),
    saveProjectAs: vi.fn(() => answer("saveProjectAs")),
    addProjectInput: vi.fn(() => answer("addProjectInput")),
    removeProjectInput: vi.fn(() => answer("removeProjectInput") as Promise<ProjectState>),
    checkProjectLinks: vi.fn(() => answer("checkProjectLinks") as Promise<ProjectState>),
    cancelProjectJob: vi.fn(() => {
      calls.push("cancelProjectJob");
      return Promise.resolve();
    }),
    captureProjectFileFacts: vi.fn(
      () => answer("captureProjectFileFacts") as Promise<ProjectState>,
    ),
    proposeProjectRelink: vi.fn(() => answer("proposeProjectRelink")),
    commitProjectRelink: vi.fn(() => answer("commitProjectRelink") as Promise<ProjectState>),
    abandonProjectRelink: vi.fn(() => answer("abandonProjectRelink") as Promise<ProjectState>),
  };
  return api;
}
