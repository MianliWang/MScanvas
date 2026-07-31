/**
 * The workspace roster's own state, kept pure.
 *
 * Seven ideas that are easy to collapse into one and must not be:
 *
 * - the **roster** is Rust's order and Rust's contents, adopted rather than
 *   derived;
 * - the **query** and the **sort** are how the user is looking at that roster,
 *   which changes what is on screen and never what the session holds;
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
 * read happens only where the hook explicitly asks for one. Searching and
 * sorting are the same kind of decision, which is why they live here rather
 * than behind a command.
 *
 * The query and the sort live in this state rather than beside it for one
 * concrete reason: every keyboard range, every `Ctrl+A` and every rule about
 * where focus lands is a question about the *visible* order, and answering it
 * in the same transition that changed the view is what keeps reconciliation to
 * one path and out of an effect that would have to dispatch to fix itself.
 */

import type {
  FolderIngestionResult,
  SelectedFile,
  WorkspaceAddResult,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";
import {
  matchesQuery,
  projectRoster,
  type RosterProjection,
  type SortMode,
} from "./rosterView";

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

/**
 * `3 files`, `1 file`. Exported so the folder account counts the same way this
 * one does: two spellings of the same sentence are free to drift apart.
 */
export function plural(count: number, noun: string): string {
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
  /** What the user is looking for, exactly as they typed it. */
  readonly query: string;
  readonly sort: SortMode;
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
  | { readonly type: "folderImported"; readonly result: FolderIngestionResult }
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
  | { readonly type: "activeCleared" }
  | { readonly type: "searchChanged"; readonly query: string }
  | { readonly type: "searchCleared" }
  | { readonly type: "sortChanged"; readonly sort: SortMode };

export const initialRosterState: RosterState = {
  datasets: [],
  capacity: 0,
  query: "",
  sort: "added",
  focused: null,
  selected: new Set(),
  anchor: null,
  active: null,
  rowState: new Map(),
};

export function rowPresentation(state: RosterState, handle: string): RowPresentation {
  return state.rowState.get(handle) ?? "ready";
}

/**
 * What this state puts on screen.
 *
 * The one place the projection is asked for, so the rows the keyboard ranges
 * over and the rows the component renders can never be two different lists.
 * Pure and cheap enough to call twice; storing it would mean a second copy of
 * an order that is already derivable, and a second thing to keep correct.
 */
export function rosterProjection(state: RosterState): RosterProjection {
  return projectRoster({
    datasets: state.datasets,
    query: state.query,
    sort: state.sort,
    selected: state.selected,
    active: state.active,
    rowState: state.rowState,
  });
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
  visible: readonly SelectedFile[],
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
    // Over what is on screen. A range that quietly swept up the rows a search
    // is hiding would be a selection the user cannot see and cannot check
    // before pressing `Remove selected`.
    selected: new Set(rangeBetween(visible, from, handle)),
  };
}

function steppedTo(
  state: RosterState,
  visible: readonly SelectedFile[],
  index: number,
  extend: boolean,
): RosterState {
  const bounded = Math.min(visible.length - 1, Math.max(0, index));
  const handle = visible[bounded]?.handle;
  if (handle === undefined) {
    return state;
  }
  return withFocus(state, visible, handle, extend);
}

/**
 * Puts focus and the range anchor back on rows the user can actually see.
 *
 * The single reconciliation path, run at the end of every transition. Most of
 * the time it changes nothing: with no query every row is visible, so a focused
 * row can only disappear by being removed, which the lifecycle cases have
 * already answered for. It earns its keep in the three cases a projection
 * creates — the view narrowing under the focused row, a pinned row losing the
 * selection that was keeping it on screen, and a read ending on a row the
 * search does not match.
 *
 * `prefer` is the difference between those. Narrowing the view is a move the
 * user made deliberately and the top of the new list is where they are looking;
 * a row vanishing from under them is not, and the nearest surviving row in the
 * order they were just looking at is where they were.
 */
function reconciled(
  next: RosterState,
  previous: RosterState,
  prefer: "first" | "nearest",
): RosterState {
  const visible = rosterProjection(next);
  const live = visible.handles;
  const first = visible.datasets[0]?.handle ?? null;
  const anchorSurvives = next.anchor !== null && live.has(next.anchor);
  if (next.focused === null && first !== null) {
    // Nothing is focused and there are rows to focus. The list already draws
    // the first of them with the tab stop, so this is only the state agreeing
    // with what is on screen -- and without it, everything the focused row is
    // for is dead: `Preview focused` stays disabled, Enter reads nothing and
    // Space toggles nothing, until the user presses an arrow or clicks a row.
    // Reachable by clearing a search that matched nothing, which is exactly
    // when a user is most likely to reach for the keyboard.
    //
    // The anchor goes with it, as it does on every focus move that is not an
    // extension: with no focused row there is no range in progress for an
    // anchor to be the far end of.
    return { ...next, focused: first, anchor: first };
  }
  if (next.focused === null || live.has(next.focused)) {
    // Nothing was lost. A hidden anchor still has to go: kept, the next Shift
    // action would measure a range from a row that is not on screen.
    return anchorSurvives || next.anchor === null
      ? next
      : { ...next, anchor: next.focused };
  }
  const focused =
    prefer === "first"
      ? first
      : (nearestSurvivor(rosterProjection(previous).datasets, live, next.focused) ?? first);
  return {
    ...next,
    focused,
    anchor: anchorSurvives ? next.anchor : focused,
  };
}

/**
 * Which rule the reconciliation should follow for each transition.
 *
 * Only the three view actions are a deliberate narrowing by the user; every
 * other way a focused row can leave the projection happens under them.
 */
function preferenceFor(action: RosterAction): "first" | "nearest" {
  return action.type === "searchChanged" ||
    action.type === "searchCleared" ||
    action.type === "sortChanged"
    ? "first"
    : "nearest";
}

export function rosterReducer(state: RosterState, action: RosterAction): RosterState {
  const next = transition(state, action);
  return next === state ? state : reconciled(next, state, preferenceFor(action));
}

function transition(state: RosterState, action: RosterAction): RosterState {
  switch (action.type) {
    case "searchChanged":
      return action.query === state.query ? state : { ...state, query: action.query };

    case "searchCleared":
      return state.query === "" ? state : { ...state, query: "" };

    case "sortChanged":
      return action.sort === state.sort ? state : { ...state, sort: action.sort };

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
        // How the user is looking at the roster is theirs, not the read's.
        // A refresh or a mutation that reset it would drop them back into the
        // whole session mid-search.
        query: state.query,
        sort: state.sort,
        focused,
        selected: keptIn(state.selected, live),
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
        // How the user is looking at the roster is theirs, not the read's.
        // A refresh or a mutation that reset it would drop them back into the
        // whole session mid-search.
        query: state.query,
        sort: state.sort,
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

    case "folderImported": {
      // The transition `filesAdded` cannot be, and the difference is time. A
      // file picker is modal: the user cannot touch the roster while it is
      // open, so replacing the selection with the batch is a safe answer to a
      // question nothing else could have changed. A folder scan is not modal --
      // searching, sorting and selecting all stay live for its whole length --
      // so the selection this reply meets is one the user may have built while
      // it ran, and it is theirs.
      //
      // Read from the state this transition is given rather than from anything
      // captured when the scan began, which is the whole of what makes that
      // true.
      const { roster, outcomes } = action.result;
      const live = handlesOf(roster.datasets);
      const added = outcomes.flatMap((outcome) =>
        outcome.outcome === "added" ? [outcome.dataset.handle] : [],
      );
      const base = {
        datasets: roster.datasets,
        capacity: roster.capacity,
        // How the user is looking at the roster is theirs, not the scan's.
        query: state.query,
        sort: state.sort,
        // Surviving rows keep what they were known to be. New rows have no
        // entry, which `rowPresentation` already reads as `ready`: a row that
        // has just arrived has had nothing said about it.
        rowState: prunedRowState(state.rowState, live),
        // Reading one row is not something a scan decides. A preview already on
        // screen belongs to whichever row it was opened for, and that row
        // surviving is the only thing that keeps it.
        active: survivingHandle(state.active, live),
      };
      // Pruned against the authoritative roster: a row the user selected while
      // the scan ran can have been removed by something else in the same
      // window, and carrying a handle Rust no longer holds would arm
      // `Remove selected` with a row that is not there.
      const kept = keptIn(state.selected, live);
      const first = added[0];
      if (first === undefined) {
        // A folder that added nothing changes nothing about where the user is.
        const focused = survivingHandle(state.focused, live);
        return {
          ...base,
          focused,
          anchor: survivingHandle(state.anchor, live) ?? focused,
          selected: kept,
        };
      }
      return {
        ...base,
        focused: first,
        // With focus, as on every focus move that is not a range extension:
        // the next Shift action measures from where the keyboard now is.
        anchor: first,
        // Both, and in this order. What the user picked while waiting is still
        // picked, and what arrived is picked too -- so the batch can be acted
        // on as a batch without discarding the work they did meanwhile.
        selected: new Set([...kept, ...added]),
      };
    }

    case "datasetsRemoved": {
      if (action.result.roster.datasets.length === 0) {
        // Nothing left to look for or to order, and a query still in the box
        // over an empty workspace would be a filter on nothing that the next
        // batch of files would silently arrive behind.
        return { ...initialRosterState, capacity: action.result.roster.capacity };
      }
      const live = handlesOf(action.result.roster.datasets);
      // In the order they were just looking at, which under a sort or a query
      // is not the order Rust holds. Sorted by name, `blank, QC_pool, sample-2,
      // sample-10` shares no adjacency with the insertion order at all: asking
      // Rust's list which row took the gone row's place sent the keyboard to
      // the far end of what was on screen, and a run of removals jumped about
      // instead of walking down the list.
      const survivor = nearestSurvivor(rosterProjection(state).datasets, live, state.focused);
      // The list stays interactive while a removal is unresolved, so the user
      // can have built the next batch already. Anything of theirs that survives
      // is theirs to keep; the row beside the gap is only what to fall back to
      // when the rows they had picked are the rows that went.
      const kept = keptIn(state.selected, live);
      // The row beside the gap is a "keep going" affordance for pruning a run
      // of files, and it arms the next `Remove selected` without the user
      // pressing anything. That is only safe for a row the search itself
      // found. `survivor` now comes from the projection, so it is always on
      // screen; the rows this refuses are the ones on screen for another
      // reason -- the one being read, or the one whose preview is up. Arming a
      // removal on the acquisition the user is looking at, in a view that
      // excludes it, is the one thing a convenience must not do, and stopping
      // the run at that boundary costs one keystroke.
      //
      // The test is whether the query finds the row, not whether a query was
      // typed: a whitespace-only one, or one like `.mzML` that every file
      // matches, hides nothing and must behave exactly as no query does.
      const survivorName = action.result.roster.datasets.find(
        (dataset) => dataset.handle === survivor,
      )?.fileName;
      const fallback =
        survivor !== null && survivorName !== undefined && matchesQuery(survivorName, state.query)
          ? new Set([survivor])
          : new Set<string>();
      return {
        datasets: action.result.roster.datasets,
        capacity: action.result.roster.capacity,
        // How the user is looking at the roster is theirs, not the read's.
        // A refresh or a mutation that reset it would drop them back into the
        // whole session mid-search.
        query: state.query,
        sort: state.sort,
        // `nearestSurvivor` starts from the focused row, so this is where the
        // user already was whenever that row is still there.
        focused: survivor,
        // The end a Shift range extends from, which is not the end the keyboard
        // is on. Moving it to the focused row would make the next Shift+click
        // or Shift+Arrow grow the selection from the wrong end of a range the
        // user built while the removal was unresolved.
        anchor: survivingHandle(state.anchor, live) ?? survivor,
        selected: kept.size > 0 ? kept : fallback,
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
      // Against what is on screen. A row the projection is not showing cannot
      // have been pressed, and a range must not reach one either.
      const visible = rosterProjection(state).datasets;
      if (indexOf(visible, handle) < 0) {
        return state;
      }
      if (modifiers.shift) {
        const from = state.anchor ?? state.focused ?? handle;
        const range = rangeBetween(visible, from, handle);
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

    case "focusStepped": {
      const visible = rosterProjection(state).datasets;
      return steppedTo(
        state,
        visible,
        state.focused === null ? 0 : indexOf(visible, state.focused) + action.delta,
        action.extend,
      );
    }

    case "focusJumped": {
      const visible = rosterProjection(state).datasets;
      return steppedTo(
        state,
        visible,
        action.to === "first" ? 0 : visible.length - 1,
        action.extend,
      );
    }

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
      // Everything on screen, which under a search is not everything the
      // session holds. Selecting rows the user cannot see would hand
      // `Remove selected` a batch they never looked at.
      const visible = rosterProjection(state).datasets;
      if (visible.length === 0) {
        return state;
      }
      const focused = state.focused ?? (visible[0]?.handle ?? null);
      return {
        ...state,
        focused,
        anchor: focused,
        selected: handlesOf(visible),
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
