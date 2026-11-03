import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  | { readonly kind: "write"; readonly problem: string; readonly retryable: boolean; readonly temporaryLeftBehind: boolean }
  | { readonly kind: "turnedOff"; readonly problem: string }
  | { readonly kind: "error"; readonly error: PreviewError };

export type RestoreWork = "restoring" | "dismissing" | "startingFresh" | "switching" | "reading";

export interface WorkspaceRestoreSession {
  readonly reading: RestoreReading;
  readonly work: RestoreWork | null;
  readonly problem: RestoreProblem | null;
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
  for (const stored of waiting) {
    let target = groups.find(group => group.name === stored.name);
    if (target === undefined) {
      target = { name: stored.name, handles: [] };
      groups.push(target);
    }
    for (const row of stored.rows) {
      target.handles.push(row.handle);
      if (row.checked) checked.push(row.handle);
    }
  }
  return { groups, checked };
}

const nothingToKeep = (arrangement: WorkspaceArrangement) =>
  arrangement.groups.every(group => group.name === null && group.handles.length === 0);

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
  const [expiredDismissed, setExpiredDismissed] = useState(false);
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
        } else {
          if (write.outcome === "refused" && write.problem === "changedElsewhere") latched.current = true;
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
    const key = JSON.stringify(arrangement);
    latest.current = { key, arrangement };
    // The first read's baseline, unless the roster has moved since it was asked.
    if (recorded.current === undefined && rosterSettlementToken !== firstRead.current) recorded.current = null;
    if (recorded.current === undefined || (recorded.current === null && nothingToKeep(arrangement))) {
      recorded.current = key;
      return;
    }
    void flush();
    // The settlement token: a retry waits for the roster it asked for.
  }, [arrangement, flush, mutationBusy, rosterReady, rosterSettlementToken, work]);

  /** Runs one action, then reads again: every action changes what Rust holds. */
  const acting = useRef(false);
  const act = useCallback((kind: RestoreWork, run: () => Promise<unknown>) => {
    if (acting.current) return;
    acting.current = true;
    setWork(kind);
    void run().then(read).finally(() => {
      acting.current = false;
      if (mounted.current) setWork(null);
    });
  }, [read]);

  const restore = useCallback(() => {
    if (offerable === null) return;
    const groups = offerable.groups.map(group => group.name);
    act("restoring", () => putBack(groups));
  }, [act, offerable, putBack]);

  const dismissRow = useCallback((handle: string) => {
    act("dismissing", () => api.dismissRestoredRow(handle).then(() => setProblem(null), (cause: unknown) => {
      if (mounted.current) setProblem({ kind: "error", error: toPreviewError(cause) });
    }));
  }, [act, api]);

  /** The clear or switch a failure answered, which its Try again asks again. */
  const failedWrite = useRef<(() => void) | null>(null);
  /** A clear or a switch: a write that did what was asked owes a save of what is live now. */
  const writing = useCallback((kind: RestoreWork, write: () => Promise<WorkspaceRestoreWrite>) => {
    const again = () => writing(kind, write);
    failedWrite.current = null;
    act(kind, () => write().then((answer) => {
      if (!mounted.current) return;
      if (answer.outcome === "saved") {
        recorded.current = null;
        setProblem(null);
        setExpiredDismissed(false);
      } else {
        failedWrite.current = again;
        setProblem(writeProblem(answer));
      }
    }, (cause: unknown) => {
      failedWrite.current = again;
      if (mounted.current) setProblem({ kind: "error", error: toPreviewError(cause) });
    }));
  }, [act]);

  const startFresh = useCallback(() => writing("startingFresh", () => api.clearWorkspaceRestore()), [api, writing]);
  const setEnabled = useCallback((enabled: boolean) => writing("switching", () => api.setWorkspaceRestoreEnabled(enabled)), [api, writing]);

  const retry = useCallback(() => {
    setProblem(null);
    if (failedWrite.current !== null) {
      failedWrite.current();
      return;
    }
    recorded.current = null;
    // A stale refusal said this window's list is behind; the save waits for the
    // answer. Any other refusal is simply asked again.
    if (problem?.kind === "write" && problem.problem === "staleArrangement") reloadRoster();
    else void flush();
  }, [flush, problem, reloadRoster]);

  const retryRead = useCallback(() => act("reading", () => Promise.resolve()), [act]);
  const dismissExpired = useCallback(() => setExpiredDismissed(true), []);

  return { reading, work, problem, expiredDismissed, restore, dismissRow, startFresh, setEnabled, retry, retryRead, dismissExpired };
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
