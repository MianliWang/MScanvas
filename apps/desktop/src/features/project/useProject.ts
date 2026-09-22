/**
 * The session's project, as the interface holds it.
 *
 * Rust is authoritative. Every operation here sends a request and replaces the
 * whole local copy with what came back, so there is no place for the page to
 * hold an opinion about a project that Rust does not share.
 *
 * Two things this has to get right, because getting them wrong is invisible:
 *
 * Ordering. Every answer carries the sequence number of the request that asked
 * for it, and an answer older than what has already been applied is dropped.
 * Without that, an initial read that was slow can land *after* a New project
 * and put the interface back to "no project open" while Rust holds one.
 *
 * Which refusals are refusals. A cancellation is something the user asked for,
 * not a failure, and an unsaved-changes refusal is a question rather than an
 * error -- so neither is reported as one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { NO_PROJECT, useProjectApi, type ProjectState } from "./projectApi";
import { provenanceOf, type Provenance, type ProjectSelection } from "./lineage";

/** What the surface is doing, so it can say so rather than only dim. */
export type ProjectBusy =
  | "idle"
  | "opening"
  | "saving"
  | "checking"
  | "capturing"
  | "linking";

/**
 * An action that was refused because the project has unsaved changes.
 *
 * Held so the user can answer the question the refusal is really asking. Rust
 * takes `discardUnsaved` on each of these and refuses without it, which is what
 * makes discarding an answer the user gives rather than something the page
 * decides for them.
 */
export type PendingIntent =
  | { readonly kind: "create"; readonly name: string }
  | { readonly kind: "open" }
  | { readonly kind: "close" };

export interface ProjectSession {
  readonly state: ProjectState;
  readonly busy: ProjectBusy;
  /**
   * The check or capture this session accepted and is still waiting on, or
   * `null`. The only thing a cancel can name; with `null` there is nothing to
   * cancel and nothing is sent.
   */
  readonly activeOperation: string | null;
  /** The stable identifier of the last refusal, or `null`. */
  readonly problem: string | null;
  /** Set when the last operation was cancelled rather than refused. */
  readonly cancelled: boolean;
  /** The action waiting on an answer about unsaved changes, or `null`. */
  readonly pending: PendingIntent | null;
  /** Which references the next capture will cover. */
  readonly selected: readonly string[];
  /**
   * The project object being inspected, or `null`.
   *
   * Deliberately separate from `selected`: ticking a reference chooses what the
   * next capture covers, and inspecting one chooses what the Details region
   * describes. They are different questions and a user answers them
   * independently.
   */
  readonly inspecting: ProjectSelection | null;
  /**
   * What the Details region shows, resolved against the current project.
   *
   * Computed from state the page already has, so choosing a related object
   * sends nothing, reads no file and touches no document.
   */
  readonly provenance: Provenance | null;
  readonly inspect: (selection: ProjectSelection | null) => void;
  readonly toggleSelected: (inputId: string) => void;
  readonly dismissProblem: () => void;
  readonly createProject: (name: string) => Promise<void>;
  readonly openProject: () => Promise<void>;
  readonly closeProject: () => Promise<void>;
  /** Answers the unsaved-changes question by throwing the changes away. */
  readonly discardAndContinue: () => Promise<void>;
  /** Answers it by keeping them; the pending action is abandoned. */
  readonly keepEditing: () => void;
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
  const [cancelled, setCancelled] = useState(false);
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [inspecting, setInspecting] = useState<ProjectSelection | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** The request being issued, and the newest one whose answer was applied. */
  const issued = useRef(0);
  const applied = useRef(0);

  /**
   * Applies an answer only if nothing newer has already been applied.
   *
   * The whole ordering guarantee, in one place. `sequence` is the number the
   * request was issued under.
   */
  const settle = useCallback((sequence: number, answer: ProjectState) => {
    if (!mounted.current || sequence < applied.current) return;
    applied.current = sequence;
    setState(answer);
  }, []);

  useEffect(() => {
    issued.current += 1;
    const sequence = issued.current;
    void api
      .getProjectState()
      .then((answer) => settle(sequence, answer))
      // A first read that cannot be made leaves the honest empty state. It is
      // not a refusal to report: nothing was asked for by the user.
      .catch(() => undefined);
  }, [api, settle]);

  const run = useCallback(
    async (
      kind: ProjectBusy,
      operation: () => Promise<ProjectState | null>,
      intent?: PendingIntent,
    ) => {
      issued.current += 1;
      const sequence = issued.current;
      setBusy(kind);
      setProblem(null);
      setCancelled(false);
      try {
        const answer = await operation();
        // `null` is a cancelled dialog: nothing was chosen, so nothing changed.
        if (answer !== null) settle(sequence, answer);
        if (mounted.current) setPending(null);
      } catch (error) {
        const code = refusalId(error);
        if (mounted.current) {
          if (code === "unsavedChanges" && intent !== undefined) {
            // Not a failure. The user is being asked a question, and the action
            // waits for their answer rather than being thrown away.
            setPending(intent);
          } else if (code === "cancelled") {
            // The user asked for this. Reporting it as a refusal would tell
            // them something went wrong with their own decision -- and would
            // sit beside the cancelled run the capture just recorded.
            setCancelled(true);
          } else {
            setProblem(code);
          }
        }
        // A refused capture still recorded its run, and a refused anything else
        // left the project as it was. Re-reading is how the surface shows the
        // first without guessing at the second.
        issued.current += 1;
        const reread = issued.current;
        try {
          settle(reread, await api.getProjectState());
        } catch {
          /* The refusal above is what there is to report. */
        }
      } finally {
        if (mounted.current) setBusy("idle");
      }
    },
    [api, settle],
  );

  /** The operation this session accepted and has not yet seen finish. */
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const active = useRef<string | null>(null);

  /**
   * Accepts an operation, then runs it under the identifier it was accepted
   * with.
   *
   * Acceptance is a separate request on purpose. The identifier is what a
   * cancel names, and it has to exist before the work does: invokes are
   * independent fetches, so a cancel pressed the instant after the button could
   * otherwise reach Rust before the run request and find nothing to cancel --
   * and the read would run to completion. The identifier is held only for as
   * long as this session is waiting on the answer. Once it is in, a late press
   * has nothing to send, and a request that did go out late names an operation
   * Rust no longer has, which changes nothing there either.
   */
  const runAccepted = useCallback(
    (kind: ProjectBusy, work: (operationId: string) => Promise<ProjectState>) =>
      run(kind, async () => {
        const { operationId } = await api.beginProjectJob();
        active.current = operationId;
        setActiveOperation(operationId);
        try {
          return await work(operationId);
        } finally {
          if (active.current === operationId) {
            active.current = null;
            if (mounted.current) setActiveOperation(null);
          }
        }
      }),
    [api, run],
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

  /**
   * Forgets what was being inspected when the project itself is replaced.
   *
   * Keyed on the project that is actually open, not on the operation that was
   * attempted: an Open whose dialog the user cancelled changes nothing, and
   * clearing on the attempt would have collapsed the contextual region for an
   * operation that did not happen.
   *
   * A *removal* deliberately does not clear it. The identity is unchanged, so
   * the selection survives and is reported as gone -- which is the true thing
   * to say, rather than silently moving the reader to some other object.
   */
  const identity = state.open ? state.projectId : null;
  useEffect(() => {
    setInspecting(null);
  }, [identity]);

  const createProject = useCallback(
    (name: string, discardUnsaved = false) =>
      run("saving", () => api.createProject(name, discardUnsaved), {
        kind: "create",
        name,
      }),
    [api, run],
  );
  const openProject = useCallback(
    (discardUnsaved = false) =>
      run("opening", () => api.openProject(discardUnsaved), { kind: "open" }),
    [api, run],
  );
  const closeProject = useCallback(
    (discardUnsaved = false) =>
      run("saving", () => api.closeProject(discardUnsaved), { kind: "close" }),
    [api, run],
  );

  return {
    state,
    busy,
    activeOperation,
    problem,
    cancelled,
    pending,
    selected,
    inspecting,
    provenance: provenanceOf(state, inspecting),
    inspect: setInspecting,
    toggleSelected,
    dismissProblem: useCallback(() => {
      setProblem(null);
      setCancelled(false);
    }, []),
    createProject: useCallback((name: string) => createProject(name), [createProject]),
    openProject: useCallback(() => openProject(), [openProject]),
    closeProject: useCallback(() => closeProject(), [closeProject]),
    discardAndContinue: useCallback(async () => {
      if (pending === null) return;
      setPending(null);
      if (pending.kind === "create") await createProject(pending.name, true);
      else if (pending.kind === "open") await openProject(true);
      else await closeProject(true);
    }, [pending, createProject, openProject, closeProject]),
    keepEditing: useCallback(() => setPending(null), []),
    saveProject: useCallback(() => run("saving", () => api.saveProject()), [api, run]),
    saveProjectAs: useCallback(() => run("saving", () => api.saveProjectAs()), [api, run]),
    addInput: useCallback(() => run("opening", () => api.addProjectInput()), [api, run]),
    removeInput: useCallback(
      (inputId: string) => run("saving", () => api.removeProjectInput(inputId)),
      [api, run],
    ),
    checkLinks: useCallback(
      () => runAccepted("checking", (operationId) => api.checkProjectLinks(operationId)),
      [api, runAccepted],
    ),
    cancelJob: useCallback(async () => {
      // Only the operation this session accepted and is still waiting on. With
      // none there is nothing to name, so nothing is sent -- a cancel is a
      // request about one operation, never a standing preference. The answer
      // is deliberately not read: "stale" and "nothing to cancel" are the
      // boundary saying it did nothing, which is what a late press deserves.
      const operationId = active.current;
      if (operationId === null) return;
      await api.cancelProjectJob(operationId).catch(() => undefined);
    }, [api]),
    capture: useCallback(
      () =>
        runAccepted("capturing", (operationId) =>
          api.captureProjectFileFacts(operationId, selected),
        ),
      [api, runAccepted, selected],
    ),
    proposeRelink: useCallback(
      (inputId: string) => run("linking", () => api.proposeProjectRelink(inputId)),
      [api, run],
    ),
    commitRelink: useCallback(
      (inputId: string) => run("linking", () => api.commitProjectRelink(inputId)),
      [api, run],
    ),
    abandonRelink: useCallback(
      () => run("linking", () => api.abandonProjectRelink()),
      [api, run],
    ),
  };
}
