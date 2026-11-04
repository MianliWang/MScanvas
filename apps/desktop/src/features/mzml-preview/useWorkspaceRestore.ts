import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { UNGROUPED, reconcileOrganization, type OrganizationState } from "../workbench/organization";
import { usePreviewApi } from "./api";
import {
  toPreviewError,
  type PreviewError,
  type RestoredGroup,
  type RestoredRow,
  type RestoredRowState,
  type WorkspaceArrangement,
  type WorkspaceRestoreRead,
  type WorkspaceRestoreWrite,
} from "./contracts";
import type { RosterState } from "./rosterSelection";

export type RestoreReading =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "failed"; readonly error: PreviewError }
  | { readonly status: "ready"; readonly read: WorkspaceRestoreRead };

/** Why the last save, clear or switch did not do what was asked. */
export type RestoreProblem =
  | { readonly kind: "write"; readonly problem: string; readonly retryable: boolean; readonly temporaryLeftBehind: boolean; readonly action?: boolean }
  | { readonly kind: "turnedOff"; readonly problem: string }
  | { readonly kind: "error"; readonly error: PreviewError; readonly action?: boolean };

export type RestoreWork = "restoring" | "dismissing" | "startingFresh" | "switching" | "reading";

/**
 * A clear, a switch or a dismiss that did not do what was asked. Apart from a
 * save's `problem`, because the user still wants what was asked: a later save
 * going through says nothing about it.
 */
export interface RestoreFailure {
  readonly problem: RestoreProblem;
  /** The same action, asked again. */
  readonly again: () => void;
  readonly putAway: () => void;
  /** The row a failed dismiss was for, where the keyboard returns if asking again takes it. */
  readonly row?: string;
}

export interface WorkspaceRestoreSession {
  readonly reading: RestoreReading;
  readonly work: RestoreWork | null;
  /** The first read, or the action in `work`, has lasted long enough to be worth saying. */
  readonly slowRead: boolean;
  readonly slowWork: boolean;
  /** The user has acted on the record, so "nothing is waiting" is news rather than a first run. */
  readonly acted: boolean;
  /** The last workspace change was a put-back, so a workspace error is its answer to say. */
  readonly putBackAsked: boolean;
  /** Why the last save did not record the session; the next save that does ends it. */
  readonly problem: RestoreProblem | null;
  /** Why this session records nothing more (question 6). */
  readonly stopped: RestoreProblem | null;
  readonly failed: readonly RestoreFailure[];
  /** Whether the `expired` line was put away for this session. */
  readonly expiredDismissed: boolean;
  readonly restore: () => void;
  readonly dismissRow: (handle: string) => void;
  readonly startFresh: () => void;
  readonly setEnabled: (enabled: boolean) => void;
  readonly retry: () => void;
  readonly retryRead: () => void;
  readonly dismissExpired: () => void;
}

/** The waiting rows a read found still as recorded: what Restore workspace takes. */
export function offeredRows(groups: readonly RestoredGroup[]): readonly RestoredRow[] {
  return groups.flatMap(group => group.rows.filter(row => row.state === "matching"));
}

/** The waiting rows a read marked, with the name of the group each waits in. */
export function markedRows(groups: readonly RestoredGroup[]): readonly (RestoredRow & { readonly state: Exclude<RestoredRowState, "matching">; readonly group: string | null })[] {
  return groups.flatMap(group => group.rows.flatMap(row => row.state === "matching" ? [] : [{ ...row, state: row.state, group: group.name }]));
}

/**
 * The session as Rust must be told it: this window's groups with the rows still
 * waiting in the group of their stored name, and every checked handle.
 */
export function buildArrangement(organization: OrganizationState, membership: ReadonlySet<string>, waiting: readonly RestoredGroup[]): WorkspaceArrangement {
  const groups = organization.groups.map(group => ({ name: group.id === UNGROUPED ? null : group.name, handles: [...group.handles] }));
  const checked = organization.groups.flatMap(group => group.handles.filter(handle => membership.has(handle)));
  // The last stored group walked, as in `placeRestored`: a group made here goes
  // after it, so a partial put-back leaves the stored order alone (decision 1).
  let after = 0;
  waiting.forEach((stored, at) => {
    // The group of its name at the same count, as `placeRestored` chose it: the
    // Workbench allows two groups of one name.
    const count = waiting.slice(0, at).filter(other => other.name === stored.name).length;
    let target = groups.filter(group => group.name === stored.name)[count];
    if (target === undefined) {
      // A name with nothing waiting under it is not kept: the user may have
      // dissolved or renamed that group, and the document holds no history of
      // what has gone (decision 10).
      if (stored.rows.length === 0) return;
      target = { name: stored.name, handles: [] };
      groups.splice(after + 1, 0, target);
    }
    after = Math.max(after, groups.indexOf(target));
    for (const row of stored.rows) {
      target.handles.push(row.handle);
      if (row.checked) checked.push(row.handle);
    }
  });
  return { groups, checked };
}

const nothingToKeep = (arrangement: WorkspaceArrangement) =>
  arrangement.groups.every(group => group.name === null && group.handles.length === 0);

/**
 * Whether `active` has lasted long enough to be worth a line. The usual answer
 * is back before anything could be painted, and then nothing moves under a key
 * pressed again; a drive that does not answer can hold one for an OS timeout.
 */
function useSlowly(active: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useLayoutEffect(() => {
    if (!active) { setSlow(false); return; }
    const timer = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(timer);
  }, [active]);
  return slow;
}

/**
 * The session's one restore conversation with Rust (ADR 0061).
 *
 * Reads once the roster is known, then records every later change of the
 * arrangement: one save at a time, the newest arrangement next, and nothing
 * while a roster change is unanswered, whose arrangement would be stale. What
 * the first read found is the baseline, so a session that changes nothing
 * writes nothing and declines no offer (decision 10).
 */
export function useWorkspaceRestore({ roster, rosterReady, rosterSettlementToken, mutationBusy, putBack, reloadRoster }: {
  readonly roster: RosterState;
  readonly rosterReady: boolean;
  readonly rosterSettlementToken: number;
  /** A roster change is unanswered somewhere: this window's list is about to move. */
  readonly mutationBusy: boolean;
  /** Restore workspace itself, a workspace change on the hook that owns those. */
  readonly putBack: (groups: readonly (string | null)[]) => Promise<boolean>;
  readonly reloadRoster: () => void;
}): WorkspaceRestoreSession {
  const api = usePreviewApi();
  const [reading, setReading] = useState<RestoreReading>({ status: "idle" });
  const [work, setWork] = useState<RestoreWork | null>(null);
  const [problem, setProblem] = useState<RestoreProblem | null>(null);
  const [stopped, setStopped] = useState<RestoreProblem | null>(null);
  const [writeFailed, setWriteFailed] = useState<RestoreFailure | null>(null);
  const [dismissFailed, setDismissFailed] = useState<RestoreFailure | null>(null);
  const [expiredDismissed, setExpiredDismissed] = useState(false);
  const [acted, setActed] = useState(false);
  const [putBackAsked, setPutBackAsked] = useState(false);
  const slowRead = useSlowly(reading.status === "loading");
  const slowWork = useSlowly(work !== null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  /** What was last recorded: `undefined` before a read's baseline, `null` when a save is owed. */
  const recorded = useRef<string | null | undefined>(undefined);
  const latest = useRef<{ readonly key: string; readonly arrangement: WorkspaceArrangement } | null>(null);
  const saving = useRef(false);
  /** Another window wrote the record: this session records nothing more (question 6). */
  const latched = useRef(false);

  const read = useCallback(() => {
    return api.readWorkspaceRestore().then((answer) => {
      if (mounted.current) setReading({ status: "ready", read: answer });
    }).catch((cause: unknown) => {
      if (mounted.current) setReading({ status: "failed", error: toPreviewError(cause) });
    });
  }, [api]);

  /** The roster answer the first read was asked after; a later one is a change to record. */
  const firstRead = useRef<number | null>(null);
  useEffect(() => {
    if (!rosterReady || firstRead.current !== null) return;
    firstRead.current = rosterSettlementToken;
    setReading({ status: "loading" });
    void read();
  }, [read, rosterReady, rosterSettlementToken]);

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (latest.current !== null && latest.current.key !== recorded.current && !latched.current) {
        const { key, arrangement } = latest.current;
        recorded.current = key;
        let write: WorkspaceRestoreWrite;
        try {
          write = await api.saveWorkspaceRestore(arrangement);
        } catch (cause) {
          if (mounted.current) setProblem({ kind: "error", error: toPreviewError(cause) });
          break;
        }
        if (!mounted.current) break;
        if (write.outcome === "saved" || write.outcome === "off") {
          setProblem(null);
        } else if (write.outcome === "refused" && write.problem === "staleArrangement" && latest.current?.key !== key) {
          // A later roster answer already moved on; the next round records it.
        } else if (write.outcome === "refused" && write.problem === "changedElsewhere") {
          // Held apart from `problem`, which a later save or retry replaces:
          // nothing here can end this but Off or a clear, and it stays said.
          latched.current = true;
          setProblem(null);
          setStopped(writeProblem(write));
        } else {
          setProblem(writeProblem(write));
        }
      }
    } finally {
      saving.current = false;
    }
  }, [api]);

  const offerable = reading.status === "ready" && reading.read.outcome === "restored" ? reading.read : null;
  const arrangement = useMemo(() => {
    if (offerable === null) return null;
    const handles = roster.datasets.map(row => row.handle);
    return buildArrangement(reconcileOrganization(roster.organization, handles), roster.conversionMembership, offerable.groups);
  }, [offerable, roster.conversionMembership, roster.datasets, roster.organization]);

  useEffect(() => {
    if (arrangement === null || !rosterReady || mutationBusy || work !== null) {
      latest.current = null;
      return;
    }
    // Rust records each row's label from its own registry, so a row that gained
    // one without moving is a change to record too (owner decision P201-RESTORE).
    const key = JSON.stringify([arrangement, roster.datasets.map(row => row.notVerifiedByMscanvas ?? null)]);
    latest.current = { key, arrangement };
    // The first read's baseline, unless the roster has moved since it was asked.
    if (recorded.current === undefined && rosterSettlementToken !== firstRead.current) recorded.current = null;
    if (recorded.current === undefined || (recorded.current === null && nothingToKeep(arrangement))) {
      recorded.current = key;
      return;
    }
    void flush();
    // The settlement token: a retry waits for the roster it asked for.
  }, [arrangement, flush, mutationBusy, roster.datasets, rosterReady, rosterSettlementToken, work]);

  /** Runs one action, then reads again: every action changes what Rust holds. */
  const acting = useRef(false);
  const act = useCallback((kind: RestoreWork, run: () => Promise<unknown>) => {
    if (acting.current) return;
    acting.current = true;
    setWork(kind);
    if (kind !== "reading") setActed(true);
    setPutBackAsked(kind === "restoring");
    void run().then(read).finally(() => {
      acting.current = false;
      if (mounted.current) setWork(null);
    });
  }, [read]);

  // A later workspace change is the last action now: its failure is its own to say.
  useEffect(() => {
    if (mutationBusy && !acting.current) setPutBackAsked(false);
  }, [mutationBusy]);

  const restore = useCallback(() => {
    if (offerable === null) return;
    const groups = offerable.groups.map(group => group.name);
    act("restoring", () => putBack(groups));
  }, [act, offerable, putBack]);

  const dismissRow = useCallback((handle: string) => {
    act("dismissing", () => api.dismissRestoredRow(handle).then(() => setDismissFailed(null), (cause: unknown) => {
      if (mounted.current) setDismissFailed({ problem: { kind: "error", error: toPreviewError(cause), action: true }, again: () => dismissRow(handle), putAway: () => setDismissFailed(null), row: handle });
    }));
  }, [act, api]);

  /** A clear or a switch: a write that did what was asked owes a save of what is live now. */
  const writing = useCallback((kind: RestoreWork, write: () => Promise<WorkspaceRestoreWrite>) => {
    const answered = (problem: RestoreProblem | null) => setWriteFailed(problem === null ? null : { problem, again: () => writing(kind, write), putAway: () => setWriteFailed(null) });
    act(kind, () => write().then((answer) => {
      if (!mounted.current) return;
      // The record is empty or off after either, so what a save or a dismiss said
      // about it is no longer news.
      if (answer.outcome === "saved" || answer.outcome === "turnedOff") {
        setStopped(null);
        setProblem(null);
        setDismissFailed(null);
      }
      if (answer.outcome === "saved") recorded.current = null;
      answered(actionProblem(answer));
    }, (cause: unknown) => {
      if (mounted.current) answered({ kind: "error", error: toPreviewError(cause), action: true });
    }));
  }, [act]);

  const startFresh = useCallback(() => writing("startingFresh", () => api.clearWorkspaceRestore()), [api, writing]);
  const setEnabled = useCallback((enabled: boolean) => writing("switching", () => api.setWorkspaceRestoreEnabled(enabled)), [api, writing]);

  const retry = useCallback(() => {
    setProblem(null);
    recorded.current = null;
    // A stale refusal said this window's list is behind; the save waits for the
    // answer. Any other refusal is simply asked again.
    if (problem?.kind === "write" && problem.problem === "staleArrangement") reloadRoster();
    else void flush();
  }, [flush, problem, reloadRoster]);

  const retryRead = useCallback(() => act("reading", () => Promise.resolve()), [act]);
  const dismissExpired = useCallback(() => setExpiredDismissed(true), []);

  const failed = [writeFailed, dismissFailed].filter(failure => failure !== null);
  return { reading, work, slowRead, slowWork, acted, putBackAsked, problem, stopped, failed, expiredDismissed, restore, dismissRow, startFresh, setEnabled, retry, retryRead, dismissExpired };
}

/** The same problem, as the answer to a clear or a switch rather than to a save. */
function actionProblem(write: WorkspaceRestoreWrite): RestoreProblem | null {
  const problem = writeProblem(write);
  return problem?.kind === "write" ? { ...problem, action: true } : problem;
}

function writeProblem(write: WorkspaceRestoreWrite): RestoreProblem | null {
  switch (write.outcome) {
    case "saved":
    case "off":
      return null;
    case "turnedOff":
      return { kind: "turnedOff", problem: write.problem };
    case "failed":
      return { kind: "write", problem: write.problem, retryable: write.retryable, temporaryLeftBehind: write.temporaryLeftBehind };
    case "refused":
      // `identityUnknown` latches nothing and `staleArrangement` asks the list
      // again; the rest do not change by asking again.
      return { kind: "write", problem: write.problem, retryable: write.problem === "identityUnknown" || write.problem === "staleArrangement", temporaryLeftBehind: false };
    case "unavailable":
      return { kind: "write", problem: write.problem, retryable: false, temporaryLeftBehind: false };
  }
}
