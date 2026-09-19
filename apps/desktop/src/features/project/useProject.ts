/**
 * The session's project, as the interface holds it.
 *
 * Rust is authoritative. Every operation here sends a request and replaces the
 * whole local copy with what came back, so there is no place for the page to
 * hold an opinion about a project that Rust does not share. A refusal leaves
 * the previous state exactly as it was and puts the refusal's own identifier in
 * `problem`, which the surface turns into a sentence.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { NO_PROJECT, useProjectApi, type ProjectState } from "./projectApi";

/** What the last operation is doing, so the surface can say so. */
export type ProjectBusy = "idle" | "opening" | "saving" | "checking" | "capturing" | "linking";

export interface ProjectSession {
  readonly state: ProjectState;
  readonly busy: ProjectBusy;
  /** The stable identifier of the last refusal, or `null`. */
  readonly problem: string | null;
  /** Which references the next capture will cover. */
  readonly selected: readonly string[];
  readonly toggleSelected: (inputId: string) => void;
  readonly dismissProblem: () => void;
  readonly createProject: (name: string, discardUnsaved: boolean) => Promise<void>;
  readonly openProject: (discardUnsaved: boolean) => Promise<void>;
  readonly closeProject: (discardUnsaved: boolean) => Promise<void>;
  readonly saveProject: () => Promise<void>;
  readonly saveProjectAs: () => Promise<void>;
  readonly addInput: () => Promise<void>;
  readonly removeInput: (inputId: string) => Promise<void>;
  readonly checkLinks: () => Promise<void>;
  readonly cancelJob: () => Promise<void>;
  readonly capture: () => Promise<void>;
  readonly proposeRelink: (inputId: string) => Promise<void>;
  readonly commitRelink: (inputId: string) => Promise<void>;
  readonly abandonRelink: () => Promise<void>;
}

/**
 * Reads a refusal's stable identifier out of whatever the boundary threw.
 *
 * Tauri rejects with the serialized error object, so the identifier is on it.
 * Anything else -- a transport failure, a thrown `Error` -- has none, and is
 * reported as one unnamed refusal rather than as a message the page invented.
 */
function refusalId(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "projectOperationFailed";
}

export function useProject(): ProjectSession {
  const api = useProjectApi();
  const [state, setState] = useState<ProjectState>(NO_PROJECT);
  const [busy, setBusy] = useState<ProjectBusy>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  // Nothing is applied after the component is gone, and nothing from an
  // operation the user has already moved on from replaces newer state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void api
      .getProjectState()
      .then((answer) => {
        if (mounted.current) setState(answer);
      })
      // A first read that cannot be made leaves the honest empty state. It is
      // not a refusal to report: nothing was asked for by the user.
      .catch(() => undefined);
  }, [api]);

  const run = useCallback(
    async (kind: ProjectBusy, operation: () => Promise<ProjectState | null>) => {
      setBusy(kind);
      setProblem(null);
      try {
        const answer = await operation();
        // `null` is a cancelled dialog: nothing was chosen, so nothing changed.
        if (answer !== null && mounted.current) setState(answer);
      } catch (error) {
        if (mounted.current) setProblem(refusalId(error));
        // A refused capture still recorded its run, and a refused anything else
        // left the project as it was. Re-reading is how the surface shows the
        // first without guessing at the second.
        try {
          const current = await api.getProjectState();
          if (mounted.current) setState(current);
        } catch {
          /* The refusal above is what there is to report. */
        }
      } finally {
        if (mounted.current) setBusy("idle");
      }
    },
    [api],
  );

  const toggleSelected = useCallback((inputId: string) => {
    setSelected((current) =>
      current.includes(inputId)
        ? current.filter((id) => id !== inputId)
        : [...current, inputId],
    );
  }, []);

  // A selection that names a reference the project no longer has would send an
  // identifier Rust refuses, so it is pruned as the project changes.
  useEffect(() => {
    setSelected((current) => {
      const live = current.filter((id) => state.inputs.some((input) => input.id === id));
      return live.length === current.length ? current : live;
    });
  }, [state.inputs]);

  return {
    state,
    busy,
    problem,
    selected,
    toggleSelected,
    dismissProblem: useCallback(() => setProblem(null), []),
    createProject: useCallback(
      (name, discardUnsaved) => run("saving", () => api.createProject(name, discardUnsaved)),
      [api, run],
    ),
    openProject: useCallback(
      (discardUnsaved) => run("opening", () => api.openProject(discardUnsaved)),
      [api, run],
    ),
    closeProject: useCallback(
      (discardUnsaved) => run("saving", () => api.closeProject(discardUnsaved)),
      [api, run],
    ),
    saveProject: useCallback(() => run("saving", () => api.saveProject()), [api, run]),
    saveProjectAs: useCallback(() => run("saving", () => api.saveProjectAs()), [api, run]),
    addInput: useCallback(() => run("opening", () => api.addProjectInput()), [api, run]),
    removeInput: useCallback(
      (inputId) => run("saving", () => api.removeProjectInput(inputId)),
      [api, run],
    ),
    checkLinks: useCallback(() => run("checking", () => api.checkProjectLinks()), [api, run]),
    cancelJob: useCallback(async () => {
      await api.cancelProjectJob().catch(() => undefined);
    }, [api]),
    capture: useCallback(
      () => run("capturing", () => api.captureProjectFileFacts(selected)),
      [api, run, selected],
    ),
    proposeRelink: useCallback(
      (inputId) => run("linking", () => api.proposeProjectRelink(inputId)),
      [api, run],
    ),
    commitRelink: useCallback(
      (inputId) => run("linking", () => api.commitProjectRelink(inputId)),
      [api, run],
    ),
    abandonRelink: useCallback(
      () => run("linking", () => api.abandonProjectRelink()),
      [api, run],
    ),
  };
}
