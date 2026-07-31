/**
 * The workspace roster's own state, kept pure.
 *
 * Five ideas that are easy to collapse into one and must not be:
 *
 * - the **roster** is Rust's order and Rust's contents, adopted rather than
 *   derived;
 * - the **focused** row is the single row the keyboard acts on;
 * - the **selection** is the set `Remove selected` operates on, which may be
 *   none, one or many rows;
 * - the **anchor** is where a Shift range is measured from;
 * - the **active** row is the one whose preview is on screen or was explicitly
 *   asked for, which is not the same as being selected and not the same as
 *   being focused.
 *
 * Nothing here starts work. Every transition is a decision about what the user
 * is looking at, which is what makes moving around the roster free: a backend
 * read happens only where the hook explicitly asks for one.
 */

import type {
  SelectedFile,
  WorkspaceAddResult,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";

/**
 * What a row is currently known to be.
 *
 * `replaced` and `missing` are the two typed things a failed open can say about
 * the file behind a row rather than about the read: the name now points at a
 * different acquisition, or at nothing. Every other failure is `failed`,
 * because it says something about this attempt and not about the row.
 */
export type RowPresentation = "ready" | "opening" | "loaded" | "replaced" | "missing" | "failed";

/**
 * The exact Rust error kinds those two states are traced to.
 *
 * `file_identity_changed` is `revalidate` finding that the remembered path now
 * resolves to another object; `file_not_resolvable` is acceptance failing to
 * open it at all. Nothing else is mapped: `not_a_regular_file`, for instance,
 * says the name now points at something this boundary never accepts, which is a
 * failure of this attempt rather than a claim that the acquisition was replaced.
 */
export function rowStateForError(kind: string): RowPresentation {
  if (kind === "file_identity_changed") {
    return "replaced";
  }
  if (kind === "file_not_resolvable") {
    return "missing";
  }
  return "failed";
}

/**
 * A bounded, path-free account of what a workspace action did.
 *
 * Bounded on purpose: one picker operation can carry a thousand files, and a
 * list of a thousand outcomes is not feedback. The counts are always exact and
 * the examples are always a prefix, which is said rather than implied.
 */
export interface WorkspaceNotice {
  readonly tone: "info" | "warning";
  readonly message: string;
  readonly details: readonly string[];
  /** How many more items there were than the details name. */
  readonly more: number;
  /**
   * Which account this is, counted from the first.
   *
   * Two actions of the same shape say the same sentence, and a live region
   * whose text does not change is a region with nothing to announce. This is
   * what lets the spoken half differ when the words do not. Zero until the hook
   * stamps it, because only the hook knows how many there have been.
   */
  readonly sequence: number;
}

/** The most per-item details any one notice spells out. */
export const MAX_NOTICE_DETAILS = 3;

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function describeAddResult(result: WorkspaceAddResult): WorkspaceNotice {
  const added = result.outcomes.filter((outcome) => outcome.outcome === "added").length;
  const duplicates = result.outcomes.filter((outcome) => outcome.outcome === "duplicate");
  const rejected = result.outcomes.flatMap((outcome) =>
    outcome.outcome === "rejected" ? [outcome] : [],
  );
  const full = rejected.filter((outcome) => outcome.error.kind === "workspace_full").length;
  const unreadable = rejected.length - full;

  const parts: string[] = [];
  parts.push(added === 0 ? "No files were added." : `Added ${plural(added, "file")}.`);
  if (duplicates.length > 0) {
    parts.push(`${plural(duplicates.length, "file")} already in the workspace.`);
  }
  if (unreadable > 0) {
    parts.push(`${plural(unreadable, "file")} could not be added.`);
  }
  if (full > 0) {
    parts.push(
      `${plural(full, "file")} did not fit: the workspace already holds as many as MSCanvas keeps.`,
    );
  }

  const details = [
    ...duplicates.map((outcome) =>
      outcome.outcome === "duplicate"
        ? `${outcome.existing.fileName} is already in the workspace.`
        : "",
    ),
    ...rejected.map((outcome) => `${outcome.candidateName}: ${outcome.error.summary}`),
  ];
  return {
    tone: duplicates.length + rejected.length > 0 ? "warning" : "info",
    message: parts.join(" "),
    details: details.slice(0, MAX_NOTICE_DETAILS),
    more: Math.max(0, details.length - MAX_NOTICE_DETAILS),
    sequence: 0,
  };
}

export function describeRemoveResult(result: WorkspaceRemoveResult): WorkspaceNotice {
  const removed = result.removedHandles.length;
  const parts = [
    removed === 0
      ? "No rows were removed."
      : `Removed ${plural(removed, "file")} from the list. The files on disk were not changed.`,
  ];
  if (result.unknownHandles.length > 0) {
    parts.push(`${plural(result.unknownHandles.length, "row")} had already gone.`);
  }
  return {
    tone: result.unknownHandles.length > 0 ? "warning" : "info",
    message: parts.join(" "),
    details: [],
    more: 0,
    sequence: 0,
  };
}

export function describeClear(removed: number): WorkspaceNotice {
  return {
    tone: "info",
    message: `Cleared ${plural(removed, "file")} from the list. The files on disk were not changed.`,
    details: [],
    more: 0,
    sequence: 0,
  };
}

export interface RosterState {
  readonly datasets: readonly SelectedFile[];
  /** The session limit Rust enforces. Zero until the first roster read. */
  readonly capacity: number;
  readonly focused: string | null;
  readonly selected: ReadonlySet<string>;
  readonly anchor: string | null;
  readonly active: string | null;
  readonly rowState: ReadonlyMap<string, RowPresentation>;
}

export interface SelectionModifiers {
  readonly ctrl: boolean;
  readonly shift: boolean;
}

export type RosterAction =
  | { readonly type: "rosterLoaded"; readonly roster: WorkspaceRoster }
  | { readonly type: "filesAdded"; readonly result: WorkspaceAddResult }
  | { readonly type: "datasetsRemoved"; readonly result: WorkspaceRemoveResult }
  | { readonly type: "workspaceCleared"; readonly roster: WorkspaceRoster }
  | {
      readonly type: "rowPressed";
      readonly handle: string;
      readonly modifiers: SelectionModifiers;
    }
  | { readonly type: "focusStepped"; readonly delta: number; readonly extend: boolean }
  | { readonly type: "focusJumped"; readonly to: "first" | "last"; readonly extend: boolean }
  | { readonly type: "focusedToggled" }
  | { readonly type: "allSelected" }
  | { readonly type: "activated"; readonly handle: string }
  | {
      readonly type: "rowStateChanged";
      readonly handle: string;
      readonly state: RowPresentation;
    }
  | { readonly type: "previewDiscarded" }
  | { readonly type: "activeCleared" };

export const initialRosterState: RosterState = {
  datasets: [],
  capacity: 0,
  focused: null,
  selected: new Set(),
  anchor: null,
  active: null,
  rowState: new Map(),
};

export function rowPresentation(state: RosterState, handle: string): RowPresentation {
  return state.rowState.get(handle) ?? "ready";
}

function handlesOf(datasets: readonly SelectedFile[]): Set<string> {
  return new Set(datasets.map((dataset) => dataset.handle));
}

function indexOf(datasets: readonly SelectedFile[], handle: string | null): number {
  return handle === null ? -1 : datasets.findIndex((dataset) => dataset.handle === handle);
}

/** The inclusive insertion-order range between two rows, in roster order. */
function rangeBetween(
  datasets: readonly SelectedFile[],
  from: string,
  to: string,
): string[] {
  const start = indexOf(datasets, from);
  const end = indexOf(datasets, to);
  if (start < 0 || end < 0) {
    return end < 0 ? [] : [to];
  }
  const [low, high] = start <= end ? [start, end] : [end, start];
  return datasets.slice(low, high + 1).map((dataset) => dataset.handle);
}

function keptIn<T>(values: Iterable<string>, live: ReadonlySet<string>): Set<string> {
  const kept = new Set<string>();
  for (const value of values) {
    if (live.has(value)) {
      kept.add(value);
    }
  }
  return kept;
}

function survivingHandle(handle: string | null, live: ReadonlySet<string>): string | null {
  return handle !== null && live.has(handle) ? handle : null;
}

/** The selection, keeping only the rows the roster still holds. */
function prunedSelection(
  selected: ReadonlySet<string>,
  live: ReadonlySet<string>,
): Set<string> {
  const kept = new Set<string>();
  for (const handle of selected) {
    if (live.has(handle)) {
      kept.add(handle);
    }
  }
  return kept;
}

function prunedRowState(
  rowState: ReadonlyMap<string, RowPresentation>,
  live: ReadonlySet<string>,
): Map<string, RowPresentation> {
  const kept = new Map<string, RowPresentation>();
  for (const [handle, presentation] of rowState) {
    if (live.has(handle)) {
      kept.set(handle, presentation);
    }
  }
  return kept;
}

/**
 * The row focus should land on once some rows are gone.
 *
 * The nearest survivor by insertion position, looking forward first: after
 * removing a run of rows the user's place in the list is where those rows were,
 * and the row that took their position is the one they were heading towards.
 * Looking backwards is the fallback for a removal at the end, and `null` means
 * nothing survived at all.
 */
function nearestSurvivor(
  previous: readonly SelectedFile[],
  live: ReadonlySet<string>,
  focused: string | null,
): string | null {
  const from = Math.max(0, indexOf(previous, focused));
  for (let index = from; index < previous.length; index += 1) {
    const handle = previous[index]?.handle;
    if (handle !== undefined && live.has(handle)) {
      return handle;
    }
  }
  for (let index = from - 1; index >= 0; index -= 1) {
    const handle = previous[index]?.handle;
    if (handle !== undefined && live.has(handle)) {
      return handle;
    }
  }
  return null;
}

function withFocus(
  state: RosterState,
  handle: string,
  extend: boolean,
): RosterState {
  if (!extend) {
    return { ...state, focused: handle, anchor: handle };
  }
  const from = state.anchor ?? state.focused ?? handle;
  return {
    ...state,
    focused: handle,
    anchor: from,
    selected: new Set(rangeBetween(state.datasets, from, handle)),
  };
}

function steppedTo(state: RosterState, index: number, extend: boolean): RosterState {
  const bounded = Math.min(state.datasets.length - 1, Math.max(0, index));
  const handle = state.datasets[bounded]?.handle;
  if (handle === undefined) {
    return state;
  }
  return withFocus(state, handle, extend);
}

export function rosterReducer(state: RosterState, action: RosterAction): RosterState {
  switch (action.type) {
    case "rosterLoaded": {
      // An authoritative replacement, used when the session's contents are read
      // rather than changed: the first mount, and a retry after that failed.
      //
      // Reading the list is not a reason to forget which row is being shown.
      // A retry is reachable with a preview on screen — the first read can fail
      // while adding and reading files still work — and dropping `active` there
      // would take the marker off the row whose preview is up and leave its
      // "read this again" action with nothing to act on. Both survive only for
      // as long as the row does, which on a first mount is not at all.
      // Where the user was and what they had picked are this side's to keep as
      // well. Reading the list back is not a reason to move the keyboard to the
      // top of it or to empty a selection the user built, so all of it is pruned
      // against what Rust says is there rather than reset. The list still needs
      // a tab stop to be reachable at all, which is what `first` is for -- and
      // on a first mount, where nothing has survived because nothing existed,
      // it is the whole of the answer.
      const live = handlesOf(action.roster.datasets);
      const first = action.roster.datasets[0]?.handle ?? null;
      const focused = survivingHandle(state.focused, live) ?? first;
      return {
        datasets: action.roster.datasets,
        capacity: action.roster.capacity,
        focused,
        selected: prunedSelection(state.selected, live),
        anchor: survivingHandle(state.anchor, live) ?? focused,
        active: survivingHandle(state.active, live),
        rowState: prunedRowState(state.rowState, live),
      };
    }

    case "filesAdded": {
      const { roster, outcomes } = action.result;
      const live = handlesOf(roster.datasets);
      const added = outcomes.flatMap((outcome) =>
        outcome.outcome === "added" ? [outcome.dataset.handle] : [],
      );
      const base = {
        datasets: roster.datasets,
        capacity: roster.capacity,
        rowState: prunedRowState(state.rowState, live),
      };
      if (added.length > 0) {
        const first = added[0] as string;
        return {
          ...base,
          focused: first,
          anchor: first,
          selected: new Set(added),
          // Not set here, even when the workspace was empty. Which row is being
          // read is decided by a read actually starting, and whether one starts
          // depends on things this reducer cannot see -- whether a backend is
          // usable, whether one is already running. Claiming it here made the
          // roster say "Showing" beside a file nothing had opened.
          active: survivingHandle(state.active, live),
        };
      }
      const duplicate = outcomes.find((outcome) => outcome.outcome === "duplicate");
      if (duplicate?.outcome === "duplicate" && live.has(duplicate.existing.handle)) {
        // Nothing arrived, so nothing is selected or activated. Pointing the
        // keyboard at the row they already have is the whole response, and
        // moving focus starts no read.
        return {
          ...base,
          focused: duplicate.existing.handle,
          anchor: duplicate.existing.handle,
          selected: keptIn(state.selected, live),
          active: survivingHandle(state.active, live),
        };
      }
      return {
        ...base,
        focused: survivingHandle(state.focused, live),
        anchor: survivingHandle(state.anchor, live),
        selected: keptIn(state.selected, live),
        active: survivingHandle(state.active, live),
      };
    }

    case "datasetsRemoved": {
      const live = handlesOf(action.result.roster.datasets);
      const survivor = nearestSurvivor(state.datasets, live, state.focused);
      return {
        datasets: action.result.roster.datasets,
        capacity: action.result.roster.capacity,
        focused: survivor,
        anchor: survivor,
        selected: survivor === null ? new Set() : new Set([survivor]),
        // Removing the row a preview belongs to takes the preview with it, and
        // nothing else is opened in its place: reading another acquisition is
        // an action the user takes.
        active: survivingHandle(state.active, live),
        rowState: prunedRowState(state.rowState, live),
      };
    }

    case "workspaceCleared":
      return {
        ...initialRosterState,
        capacity: action.roster.capacity,
        datasets: action.roster.datasets,
      };

    case "rowPressed": {
      const { handle, modifiers } = action;
      if (indexOf(state.datasets, handle) < 0) {
        return state;
      }
      if (modifiers.shift) {
        const from = state.anchor ?? state.focused ?? handle;
        const range = rangeBetween(state.datasets, from, handle);
        return {
          ...state,
          focused: handle,
          anchor: from,
          selected: modifiers.ctrl
            ? new Set([...state.selected, ...range])
            : new Set(range),
        };
      }
      if (modifiers.ctrl) {
        const selected = new Set(state.selected);
        if (!selected.delete(handle)) {
          selected.add(handle);
        }
        return { ...state, focused: handle, anchor: handle, selected };
      }
      return {
        ...state,
        focused: handle,
        anchor: handle,
        selected: new Set([handle]),
      };
    }

    case "focusStepped":
      return steppedTo(
        state,
        state.focused === null ? 0 : indexOf(state.datasets, state.focused) + action.delta,
        action.extend,
      );

    case "focusJumped":
      return steppedTo(
        state,
        action.to === "first" ? 0 : state.datasets.length - 1,
        action.extend,
      );

    case "focusedToggled": {
      if (state.focused === null) {
        return state;
      }
      const selected = new Set(state.selected);
      if (!selected.delete(state.focused)) {
        selected.add(state.focused);
      }
      return { ...state, anchor: state.focused, selected };
    }

    case "allSelected": {
      if (state.datasets.length === 0) {
        return state;
      }
      const focused = state.focused ?? (state.datasets[0]?.handle ?? null);
      return {
        ...state,
        focused,
        anchor: focused,
        selected: handlesOf(state.datasets),
      };
    }

    case "activated": {
      if (indexOf(state.datasets, action.handle) < 0) {
        return state;
      }
      // Selection is deliberately left alone. Previewing one row is not a
      // statement about which rows `Remove selected` would take.
      return { ...state, focused: action.handle, active: action.handle };
    }

    case "rowStateChanged": {
      if (indexOf(state.datasets, action.handle) < 0) {
        return state;
      }
      const rowState = new Map(state.rowState);
      rowState.set(action.handle, action.state);
      return { ...state, rowState };
    }

    case "previewDiscarded":
      // The readings are gone but the rows are not, and neither is which row the
      // user was looking at: it is still the one an explicit preview would read
      // again. Every row goes back to saying nothing about a backend that is no
      // longer the one that read it.
      return { ...state, rowState: new Map() };

    case "activeCleared":
      return { ...state, active: null };
  }
}
