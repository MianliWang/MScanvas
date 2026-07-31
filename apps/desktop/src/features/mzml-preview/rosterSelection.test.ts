import { describe, expect, it } from "vitest";

import type {
  SelectedFile,
  WorkspaceAddOutcome,
  WorkspaceAddResult,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "./contracts";
import {
  MAX_NOTICE_DETAILS,
  rosterProjection,
  describeAddResult,
  describeClear,
  describeRemoveResult,
  initialRosterState,
  rosterReducer,
  rowPresentation,
  rowStateForError,
  type RosterState,
  type SelectionModifiers,
} from "./rosterSelection";

const CAPACITY = 1_024;

function dataset(handle: string): SelectedFile {
  return { handle, fileName: `${handle}.mzML`, byteLength: 4_096 };
}

function roster(...handles: string[]): WorkspaceRoster {
  return { datasets: handles.map(dataset), capacity: CAPACITY };
}

function loaded(...handles: string[]): RosterState {
  return rosterReducer(initialRosterState, {
    type: "rosterLoaded",
    roster: roster(...handles),
  });
}

function added(handle: string): WorkspaceAddOutcome {
  return { outcome: "added", dataset: dataset(handle) };
}

function duplicate(handle: string): WorkspaceAddOutcome {
  return { outcome: "duplicate", existing: dataset(handle) };
}

function rejected(name: string, kind = "unsupported_extension"): WorkspaceAddOutcome {
  return {
    outcome: "rejected",
    candidateName: name,
    error: { kind, summary: `${name} could not be read.`, detail: null, retryable: false },
  };
}

function addResult(
  outcomes: readonly WorkspaceAddOutcome[],
  ...handles: string[]
): WorkspaceAddResult {
  return { roster: roster(...handles), outcomes };
}

function removeResult(
  removedHandles: readonly string[],
  unknownHandles: readonly string[],
  ...handles: string[]
): WorkspaceRemoveResult {
  return { roster: roster(...handles), removedHandles, unknownHandles };
}

function selection(state: RosterState): string[] {
  return [...state.selected].sort();
}

describe("adopting what Rust holds", () => {
  it("takes the roster's order and gives it a tab stop without selecting anything", () => {
    const state = loaded("file-0", "file-1", "file-2");

    expect(state.datasets.map((entry) => entry.handle)).toEqual(["file-0", "file-1", "file-2"]);
    expect(state.capacity).toBe(CAPACITY);
    // A roving tab stop has to exist for the list to be reachable at all, but
    // nothing is selected and nothing is being shown: reading a file is an
    // action the user takes.
    expect(state.focused).toBe("file-0");
    expect(state.anchor).toBe("file-0");
    expect(selection(state)).toEqual([]);
    expect(state.active).toBeNull();
  });

  it("has nothing to focus when the session holds nothing", () => {
    const state = loaded();

    expect(state.focused).toBeNull();
    expect(state.anchor).toBeNull();
    expect(state.datasets).toEqual([]);
  });

  it("keeps the row being shown, and what rows said, across a re-read", () => {
    // Reading the list is not a reason to forget which row is being shown.
    // Dropping it would take the marker off the row whose preview is up, leave
    // its "read this again" action with nothing to act on, and — because a
    // removal answers for the row the viewer belongs to — let a table stay on
    // screen for a dataset the workspace no longer holds.
    const shown = rosterReducer(
      rosterReducer(loaded("file-0", "file-1"), { type: "activated", handle: "file-1" }),
      { type: "rowStateChanged", handle: "file-0", state: "failed" },
    );
    expect(shown.active).toBe("file-1");

    const reread = rosterReducer(shown, { type: "rosterLoaded", roster: roster("file-0", "file-1") });

    expect(reread.active).toBe("file-1");
    expect(rowPresentation(reread, "file-0")).toBe("failed");
  });

  it("keeps a selection built while a removal was unresolved", () => {
    // The list stays interactive while a removal is in flight, so the next
    // batch can already be picked by the time the reply lands. Collapsing to
    // the row beside the gap would disable `Remove selected` on rows the user
    // had just chosen.
    const picked = rosterReducer(loaded("file-0", "file-1", "file-2", "file-3"), {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: false, shift: false },
    });
    const batch = rosterReducer(picked, {
      type: "rowPressed",
      handle: "file-3",
      modifiers: { ctrl: true, shift: false },
    });

    const answered = rosterReducer(batch, {
      type: "datasetsRemoved",
      result: removeResult(["file-0"], [], "file-1", "file-2", "file-3"),
    });

    expect(selection(answered)).toEqual(["file-2", "file-3"]);
  });

  it("keeps the end a range extends from", () => {
    // The anchor is not the row the keyboard is on. Moving it to the focused
    // survivor would make the next Shift+Arrow grow the selection from the
    // wrong end of a range the user built while the removal was unresolved.
    const anchored = rosterReducer(loaded("file-0", "file-1", "file-2", "file-3"), {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });
    const ranged = rosterReducer(anchored, {
      type: "rowPressed",
      handle: "file-3",
      modifiers: { ctrl: false, shift: true },
    });
    expect(ranged.anchor).toBe("file-1");

    const answered = rosterReducer(ranged, {
      type: "datasetsRemoved",
      result: removeResult(["file-0"], [], "file-1", "file-2", "file-3"),
    });

    expect(answered.anchor).toBe("file-1");
    // And the next extension grows from that end rather than from the survivor.
    const extended = rosterReducer(answered, {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: false, shift: true },
    });
    expect(selection(extended)).toEqual(["file-1", "file-2"]);
  });

  it("falls back to the row beside the gap when the rows picked are the rows that went", () => {
    const picked = rosterReducer(loaded("file-0", "file-1", "file-2"), {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });

    const answered = rosterReducer(picked, {
      type: "datasetsRemoved",
      result: removeResult(["file-1"], [], "file-0", "file-2"),
    });

    expect(selection(answered)).toEqual(["file-2"]);
    expect(answered.focused).toBe("file-2");
  });

  it("keeps where the user was and what they had picked", () => {
    // Reading the list back is not a reason to move the keyboard to the top of
    // it or to empty a selection the user built -- which would also disable
    // `Remove selected` under them.
    const working = rosterReducer(loaded("file-0", "file-1", "file-2"), {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });
    const extended = rosterReducer(working, {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: true, shift: false },
    });

    const reread = rosterReducer(extended, {
      type: "rosterLoaded",
      roster: roster("file-0", "file-1", "file-2"),
    });

    expect(reread.focused).toBe("file-2");
    expect(reread.anchor).toBe("file-2");
    expect(selection(reread)).toEqual(["file-1", "file-2"]);
  });

  it("keeps none of it for a row the re-read says has gone", () => {
    const shown = rosterReducer(
      rosterReducer(loaded("file-0", "file-1"), {
        type: "rowPressed",
        handle: "file-1",
        modifiers: { ctrl: false, shift: false },
      }),
      { type: "activated", handle: "file-1" },
    );
    expect(shown.focused).toBe("file-1");

    const reread = rosterReducer(shown, { type: "rosterLoaded", roster: roster("file-0") });

    expect(reread.active).toBeNull();
    expect(selection(reread)).toEqual([]);
    // Still reachable by keyboard: a list with rows in it always has a tab stop.
    expect(reread.focused).toBe("file-0");
    expect(reread.anchor).toBe("file-0");
    expect(reread.datasets.map((entry) => entry.handle)).toEqual(["file-0"]);
  });
});

describe("adding files", () => {
  it("selects every new row and focuses the first, and shows none of them", () => {
    const state = rosterReducer(loaded(), {
      type: "filesAdded",
      result: addResult([added("file-0"), added("file-1")], "file-0", "file-1"),
    });

    expect(selection(state)).toEqual(["file-0", "file-1"]);
    expect(state.focused).toBe("file-0");
    expect(state.anchor).toBe("file-0");
    // Which row is being read is decided by a read starting, which depends on
    // things this reducer cannot see -- whether a backend is usable, whether
    // one is already running. Claiming it here said "Showing" beside a file
    // nothing had opened.
    expect(state.active).toBeNull();
  });

  it("leaves the row on screen alone when adding to a session that has one", () => {
    const before = rosterReducer(
      rosterReducer(
        rosterReducer(loaded(), {
          type: "filesAdded",
          result: addResult([added("file-0")], "file-0"),
        }),
        { type: "activated", handle: "file-0" },
      ),
      { type: "rowStateChanged", handle: "file-0", state: "loaded" },
    );

    const state = rosterReducer(before, {
      type: "filesAdded",
      result: addResult([added("file-1"), added("file-2")], "file-0", "file-1", "file-2"),
    });

    // Adding files is not a request to replace what is being read.
    expect(state.active).toBe("file-0");
    expect(rowPresentation(state, "file-0")).toBe("loaded");
    expect(selection(state)).toEqual(["file-1", "file-2"]);
    expect(state.focused).toBe("file-1");
  });

  it("points at the row a duplicate already has, and changes nothing else", () => {
    const before = rosterReducer(loaded("file-0", "file-1"), {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });
    const active = rosterReducer(before, { type: "activated", handle: "file-1" });

    const state = rosterReducer(active, {
      type: "filesAdded",
      result: addResult([duplicate("file-0")], "file-0", "file-1"),
    });

    // Focus moves, which costs nothing: it starts no read and is the only way
    // to say "this is the row you already have".
    expect(state.focused).toBe("file-0");
    expect(state.anchor).toBe("file-0");
    // The selection and what is being shown are untouched.
    expect(selection(state)).toEqual(["file-1"]);
    expect(state.active).toBe("file-1");
  });

  it("moves nothing when every candidate was refused", () => {
    const before = rosterReducer(loaded("file-0"), { type: "activated", handle: "file-0" });

    const state = rosterReducer(before, {
      type: "filesAdded",
      result: addResult([rejected("other.mzXML"), rejected("full.mzML", "workspace_full")], "file-0"),
    });

    expect(state.focused).toBe("file-0");
    expect(state.active).toBe("file-0");
    expect(selection(state)).toEqual([]);
  });
});

describe("removing rows", () => {
  it("lands focus on the row that took the removed one's place", () => {
    const before = rosterReducer(loaded("file-0", "file-1", "file-2", "file-3"), {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });

    const state = rosterReducer(before, {
      type: "datasetsRemoved",
      result: removeResult(["file-1"], [], "file-0", "file-2", "file-3"),
    });

    expect(state.focused).toBe("file-2");
    expect(state.anchor).toBe("file-2");
    expect(selection(state)).toEqual(["file-2"]);
  });

  it("falls back to the row before when the end of the list goes", () => {
    const before = rosterReducer(loaded("file-0", "file-1", "file-2"), {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: false, shift: false },
    });

    const state = rosterReducer(before, {
      type: "datasetsRemoved",
      result: removeResult(["file-1", "file-2"], [], "file-0"),
    });

    expect(state.focused).toBe("file-0");
  });

  it("has nothing to focus when nothing survived", () => {
    const state = rosterReducer(loaded("file-0", "file-1"), {
      type: "datasetsRemoved",
      result: removeResult(["file-0", "file-1"], []),
    });

    expect(state.focused).toBeNull();
    expect(state.anchor).toBeNull();
    expect(selection(state)).toEqual([]);
    expect(state.active).toBeNull();
  });

  it("takes the shown row away only when its own row goes", () => {
    const shown = rosterReducer(loaded("file-0", "file-1"), {
      type: "activated",
      handle: "file-0",
    });

    const kept = rosterReducer(shown, {
      type: "datasetsRemoved",
      result: removeResult(["file-1"], [], "file-0"),
    });
    expect(kept.active).toBe("file-0");

    const gone = rosterReducer(shown, {
      type: "datasetsRemoved",
      result: removeResult(["file-0"], [], "file-1"),
    });
    expect(gone.active).toBeNull();
  });

  it("forgets what it knew about rows that are no longer there", () => {
    const before = rosterReducer(loaded("file-0", "file-1"), {
      type: "rowStateChanged",
      handle: "file-0",
      state: "missing",
    });

    const state = rosterReducer(before, {
      type: "datasetsRemoved",
      result: removeResult(["file-0"], [], "file-1"),
    });

    expect(state.rowState.has("file-0")).toBe(false);
  });

  it("empties everything when the list is cleared", () => {
    const before = rosterReducer(loaded("file-0", "file-1"), {
      type: "activated",
      handle: "file-1",
    });

    const state = rosterReducer(before, { type: "workspaceCleared", roster: roster() });

    expect(state.datasets).toEqual([]);
    expect(state.focused).toBeNull();
    expect(state.anchor).toBeNull();
    expect(state.active).toBeNull();
    expect(selection(state)).toEqual([]);
    expect(state.rowState.size).toBe(0);
    expect(state.capacity).toBe(CAPACITY);
  });
});

describe("pointer selection", () => {
  const four = loaded("file-0", "file-1", "file-2", "file-3");

  it("selects only what was clicked and anchors there", () => {
    const state = rosterReducer(four, {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: false, shift: false },
    });

    expect(selection(state)).toEqual(["file-2"]);
    expect(state.focused).toBe("file-2");
    expect(state.anchor).toBe("file-2");
  });

  it("toggles one row with Ctrl and keeps the rest", () => {
    const first = rosterReducer(four, {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });
    const both = rosterReducer(first, {
      type: "rowPressed",
      handle: "file-3",
      modifiers: { ctrl: true, shift: false },
    });

    expect(selection(both)).toEqual(["file-1", "file-3"]);
    expect(both.focused).toBe("file-3");

    const untoggled = rosterReducer(both, {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: true, shift: false },
    });

    expect(selection(untoggled)).toEqual(["file-3"]);
    // Focus follows the row that was pressed even when the press deselected it.
    expect(untoggled.focused).toBe("file-1");
  });

  it("selects the insertion-order range from the anchor, in either direction", () => {
    const anchored = rosterReducer(four, {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: false, shift: false },
    });

    const downwards = rosterReducer(anchored, {
      type: "rowPressed",
      handle: "file-3",
      modifiers: { ctrl: false, shift: true },
    });
    expect(selection(downwards)).toEqual(["file-2", "file-3"]);

    // The anchor does not move with a Shift press, so extending the other way
    // measures from the same place rather than from the last row touched.
    const upwards = rosterReducer(downwards, {
      type: "rowPressed",
      handle: "file-0",
      modifiers: { ctrl: false, shift: true },
    });
    expect(selection(upwards)).toEqual(["file-0", "file-1", "file-2"]);
    expect(upwards.anchor).toBe("file-2");
    expect(upwards.focused).toBe("file-0");
  });

  it("adds a range to the selection when Ctrl and Shift are held together", () => {
    // Ctrl moves the anchor to the row it toggled, as a file list does, so the
    // range this extends is measured from file-3 and added to what was there
    // rather than replacing it.
    const anchored = rosterReducer(four, {
      type: "rowPressed",
      handle: "file-0",
      modifiers: { ctrl: false, shift: false },
    });
    const spread = rosterReducer(anchored, {
      type: "rowPressed",
      handle: "file-3",
      modifiers: { ctrl: true, shift: false },
    });
    expect(spread.anchor).toBe("file-3");

    const state = rosterReducer(spread, {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: true, shift: true },
    });

    expect(selection(state)).toEqual(["file-0", "file-2", "file-3"]);
    // Without the Ctrl the same press would replace the selection outright.
    const replaced = rosterReducer(spread, {
      type: "rowPressed",
      handle: "file-2",
      modifiers: { ctrl: false, shift: true },
    });
    expect(selection(replaced)).toEqual(["file-2", "file-3"]);
  });

  it("ignores a press on a row the roster does not have", () => {
    const state = rosterReducer(four, {
      type: "rowPressed",
      handle: "file-9",
      modifiers: { ctrl: false, shift: false },
    });

    expect(state).toBe(four);
  });
});

describe("keyboard navigation", () => {
  const three = loaded("file-0", "file-1", "file-2");

  it("moves focus without touching the selection", () => {
    const selected = rosterReducer(three, {
      type: "rowPressed",
      handle: "file-0",
      modifiers: { ctrl: false, shift: false },
    });

    const state = rosterReducer(selected, { type: "focusStepped", delta: 1, extend: false });

    expect(state.focused).toBe("file-1");
    expect(state.anchor).toBe("file-1");
    // Unchanged: focus is not selection, and neither is a read.
    expect(selection(state)).toEqual(["file-0"]);
  });

  it("stops at both ends rather than wrapping", () => {
    const top = rosterReducer(three, { type: "focusStepped", delta: -1, extend: false });
    expect(top.focused).toBe("file-0");

    const bottom = rosterReducer(
      rosterReducer(three, { type: "focusJumped", to: "last", extend: false }),
      { type: "focusStepped", delta: 1, extend: false },
    );
    expect(bottom.focused).toBe("file-2");
  });

  it("extends the anchored range with Shift and an arrow", () => {
    const anchored = rosterReducer(three, {
      type: "rowPressed",
      handle: "file-1",
      modifiers: { ctrl: false, shift: false },
    });

    const down = rosterReducer(anchored, { type: "focusStepped", delta: 1, extend: true });
    expect(selection(down)).toEqual(["file-1", "file-2"]);
    expect(down.anchor).toBe("file-1");

    const back = rosterReducer(down, { type: "focusStepped", delta: -1, extend: true });
    expect(selection(back)).toEqual(["file-1"]);
  });

  it("jumps to the first and last rows, and can extend to them", () => {
    const last = rosterReducer(three, { type: "focusJumped", to: "last", extend: false });
    expect(last.focused).toBe("file-2");
    expect(selection(last)).toEqual([]);

    const toTop = rosterReducer(last, { type: "focusJumped", to: "first", extend: true });
    expect(toTop.focused).toBe("file-0");
    expect(selection(toTop)).toEqual(["file-0", "file-1", "file-2"]);
  });

  it("toggles the focused row and selects everything", () => {
    const toggled = rosterReducer(three, { type: "focusedToggled" });
    expect(selection(toggled)).toEqual(["file-0"]);
    expect(selection(rosterReducer(toggled, { type: "focusedToggled" }))).toEqual([]);

    const all = rosterReducer(three, { type: "allSelected" });
    expect(selection(all)).toEqual(["file-0", "file-1", "file-2"]);
    expect(all.focused).toBe("file-0");
  });

  it("has nothing to select in an empty roster", () => {
    const empty = loaded();
    expect(rosterReducer(empty, { type: "allSelected" })).toBe(empty);
    expect(rosterReducer(empty, { type: "focusedToggled" })).toBe(empty);
    expect(rosterReducer(empty, { type: "focusStepped", delta: 1, extend: false })).toBe(empty);
  });
});

describe("which row is being shown", () => {
  it("is set by an explicit activation and leaves the selection alone", () => {
    const selected = rosterReducer(loaded("file-0", "file-1"), {
      type: "rowPressed",
      handle: "file-0",
      modifiers: { ctrl: false, shift: false },
    });

    const state = rosterReducer(selected, { type: "activated", handle: "file-1" });

    expect(state.active).toBe("file-1");
    expect(state.focused).toBe("file-1");
    // Reading one row says nothing about which rows `Remove selected` takes.
    expect(selection(state)).toEqual(["file-0"]);
  });

  it("keeps its row through a backend change and forgets only the readings", () => {
    const shown = rosterReducer(
      rosterReducer(loaded("file-0", "file-1"), { type: "activated", handle: "file-0" }),
      { type: "rowStateChanged", handle: "file-0", state: "loaded" },
    );

    const state = rosterReducer(shown, { type: "previewDiscarded" });

    // The roster and which row the user was reading are theirs, and no backend
    // decided either. What a backend produced is what goes.
    expect(state.datasets).toBe(shown.datasets);
    expect(state.active).toBe("file-0");
    expect(rowPresentation(state, "file-0")).toBe("ready");
  });

  it("can be cleared without disturbing the roster", () => {
    const shown = rosterReducer(loaded("file-0"), { type: "activated", handle: "file-0" });

    const state = rosterReducer(shown, { type: "activeCleared" });

    expect(state.active).toBeNull();
    expect(state.datasets).toBe(shown.datasets);
  });

  it("ignores an activation for a row the roster does not have", () => {
    const three = loaded("file-0");
    expect(rosterReducer(three, { type: "activated", handle: "file-9" })).toBe(three);
    expect(
      rosterReducer(three, { type: "rowStateChanged", handle: "file-9", state: "failed" }),
    ).toBe(three);
  });
});

describe("what a failed read says about a row", () => {
  it("distinguishes a replaced file and a missing one from a failed attempt", () => {
    // Traced to the exact kinds Rust emits: `revalidate` finding the name now
    // resolves to another object, and acceptance failing to open it at all.
    expect(rowStateForError("file_identity_changed")).toBe("replaced");
    expect(rowStateForError("file_not_resolvable")).toBe("missing");
    // Everything else is about this attempt rather than about the row.
    expect(rowStateForError("not_a_regular_file")).toBe("failed");
    expect(rowStateForError("backend_launch_failed")).toBe("failed");
    expect(rowStateForError("selection_superseded")).toBe("failed");
  });
});

describe("saying what a workspace action did", () => {
  it("counts every kind of outcome and never lists more than a few", () => {
    const notice = describeAddResult(
      addResult(
        [
          added("file-0"),
          duplicate("file-1"),
          duplicate("file-2"),
          rejected("a.mzXML"),
          rejected("b.mzXML"),
          rejected("c.mzML", "workspace_full"),
        ],
        "file-0",
      ),
    );

    expect(notice.tone).toBe("warning");
    expect(notice.message).toContain("Added 1 file.");
    expect(notice.message).toContain("2 files already in the workspace.");
    expect(notice.message).toContain("2 files could not be added.");
    expect(notice.message).toContain("1 file did not fit");
    // The counts are exact and the examples are a prefix, which is said rather
    // than implied: one picker operation can carry a thousand files.
    expect(notice.details).toHaveLength(MAX_NOTICE_DETAILS);
    expect(notice.more).toBe(2);
    expect(notice.details[0]).toBe("file-1.mzML is already in the workspace.");
  });

  it("says plainly when a batch added nothing", () => {
    const notice = describeAddResult(addResult([duplicate("file-0")], "file-0"));

    expect(notice.message).toContain("No files were added.");
    expect(notice.tone).toBe("warning");
  });

  it("is quiet when everything arrived", () => {
    const notice = describeAddResult(addResult([added("file-0"), added("file-1")], "file-0", "file-1"));

    expect(notice.tone).toBe("info");
    expect(notice.message).toBe("Added 2 files.");
    expect(notice.details).toEqual([]);
  });

  it("says that removing and clearing left the files alone", () => {
    const removed = describeRemoveResult(removeResult(["file-0", "file-1"], ["file-9"], "file-2"));
    expect(removed.message).toContain("Removed 2 files from the list.");
    expect(removed.message).toContain("The files on disk were not changed.");
    expect(removed.message).toContain("1 row had already gone.");
    expect(removed.tone).toBe("warning");

    const cleared = describeClear(3);
    expect(cleared.message).toContain("Cleared 3 files from the list.");
    expect(cleared.message).toContain("The files on disk were not changed.");
  });
});

describe("looking at the roster through a search and a sort", () => {
  function sized(handle: string, fileName: string, byteLength: number): SelectedFile {
    return { handle, fileName, byteLength };
  }

  /** Four rows whose added, name and size orders are all different. */
  const ROWS = [
    sized("file-0", "sample-10.mzML", 3_000),
    sized("file-1", "QC_pool.mzML", 1_000),
    sized("file-2", "sample-2.mzML", 4_000),
    sized("file-3", "blank.mzML", 2_000),
  ];

  function view(...datasets: SelectedFile[]): RosterState {
    return rosterReducer(initialRosterState, {
      type: "rosterLoaded",
      roster: { datasets, capacity: CAPACITY },
    });
  }

  function visible(state: RosterState): string[] {
    return rosterProjection(state).datasets.map((entry) => entry.handle);
  }

  function search(state: RosterState, query: string): RosterState {
    return rosterReducer(state, { type: "searchChanged", query });
  }

  function press(
    state: RosterState,
    handle: string,
    modifiers: Partial<SelectionModifiers> = {},
  ): RosterState {
    return rosterReducer(state, {
      type: "rowPressed",
      handle,
      modifiers: { ctrl: false, shift: false, ...modifiers },
    });
  }

  it("starts on the whole roster in the order Rust holds it", () => {
    const state = view(...ROWS);

    expect(state.query).toBe("");
    expect(state.sort).toBe("added");
    expect(visible(state)).toEqual(["file-0", "file-1", "file-2", "file-3"]);
  });

  it("keeps the selection and the shown row when the query changes", () => {
    const shown = rosterReducer(press(view(...ROWS), "file-2", { ctrl: true }), {
      type: "activated",
      handle: "file-0",
    });

    const searched = search(shown, "blank");

    expect(selection(searched)).toEqual(["file-2"]);
    expect(searched.active).toBe("file-0");
  });

  it("keeps the selection, the shown row and the focused row when the sort changes", () => {
    const working = rosterReducer(press(view(...ROWS), "file-2"), {
      type: "activated",
      handle: "file-2",
    });

    const sorted = rosterReducer(working, { type: "sortChanged", sort: "name-asc" });

    expect(sorted.focused).toBe("file-2");
    expect(selection(sorted)).toEqual(["file-2"]);
    expect(sorted.active).toBe("file-2");
    expect(visible(sorted)).toEqual(["file-3", "file-1", "file-2", "file-0"]);
  });

  it("moves a hidden focused row to the first visible one", () => {
    // Narrowing the view is a move the user made deliberately, so the top of
    // the list they asked for is where they are now looking. Focused without
    // being selected, which is what adopting a roster leaves behind.
    const state = view(...ROWS);
    expect(state.focused).toBe("file-0");
    expect(selection(state)).toEqual([]);

    const searched = search(state, "blank");

    expect(visible(searched)).toEqual(["file-3"]);
    expect(searched.focused).toBe("file-3");
    expect(searched.anchor).toBe("file-3");
  });

  it("leaves a visible focused row exactly where it was", () => {
    // End moves the keyboard without selecting anything, so the row is
    // focused and nothing is keeping it on screen but the query itself.
    const focused = rosterReducer(view(...ROWS), {
      type: "focusJumped",
      to: "last",
      extend: false,
    });
    expect(focused.focused).toBe("file-3");
    expect(selection(focused)).toEqual([]);

    expect(search(focused, "blank").focused).toBe("file-3");
  });

  it("has no focused row when nothing is visible at all", () => {
    const searched = search(view(...ROWS), "zzz");

    expect(visible(searched)).toEqual([]);
    expect(searched.focused).toBeNull();
    expect(searched.anchor).toBeNull();
  });

  it("replaces a hidden range anchor and keeps a visible one", () => {
    // Kept, a hidden anchor would make the next Shift action measure a range
    // from a row that is not on screen.
    const anchored = view(...ROWS);
    expect(anchored.anchor).toBe("file-0");

    const searched = search(anchored, "sample");
    expect(searched.anchor).toBe("file-0");

    expect(search(searched, "blank").anchor).toBe("file-3");
  });

  it("ranges over the visible order rather than the order Rust holds", () => {
    // Sorted by name the rows read blank, QC_pool, sample-2, sample-10. A
    // range from the first to the third is those three, which in Rust's own
    // order is not a contiguous run at all.
    const sorted = rosterReducer(view(...ROWS), { type: "sortChanged", sort: "name-asc" });
    const anchored = press(sorted, "file-3");

    const ranged = press(anchored, "file-2", { shift: true });

    expect(selection(ranged)).toEqual(["file-1", "file-2", "file-3"]);
  });

  it("steps the keyboard through the visible order", () => {
    const sorted = rosterReducer(view(...ROWS), { type: "sortChanged", sort: "name-asc" });
    const stepped = rosterReducer(press(sorted, "file-3"), {
      type: "focusStepped",
      delta: 1,
      extend: false,
    });

    expect(stepped.focused).toBe("file-1");
    expect(
      rosterReducer(stepped, { type: "focusJumped", to: "last", extend: false }).focused,
    ).toBe("file-0");
  });

  it("extends with Shift and an arrow over the visible order", () => {
    const focused = press(search(view(...ROWS), "sample"), "file-0");

    const extended = rosterReducer(focused, { type: "focusStepped", delta: 1, extend: true });

    // file-1 and file-3 are hidden and are not swept up on the way.
    expect(selection(extended)).toEqual(["file-0", "file-2"]);
  });

  it("selects only what is on screen with Ctrl+A", () => {
    const all = rosterReducer(search(view(...ROWS), "sample"), { type: "allSelected" });

    expect(selection(all)).toEqual(["file-0", "file-2"]);
  });

  it("ignores a press on a row the search is hiding", () => {
    const searched = search(view(...ROWS), "sample");

    expect(press(searched, "file-1")).toBe(searched);
  });

  it("keeps a nonmatching row the user selected, and lets go when they deselect it", () => {
    // Picked first, searched second, which is the order this happens in: the
    // search is what turns an ordinary selected row into a kept one.
    const kept = search(press(view(...ROWS), "file-3"), "sample");

    expect(visible(kept)).toEqual(["file-0", "file-2", "file-3"]);
    expect(kept.focused).toBe("file-3");

    // Toggling it off takes away the only reason it was on screen, so the
    // keyboard has to go somewhere that can still be seen -- and to the
    // nearest row in the order they were just looking at, not the top.
    const released = press(kept, "file-3", { ctrl: true });

    expect(visible(released)).toEqual(["file-0", "file-2"]);
    expect(released.focused).toBe("file-2");
    expect(released.anchor).toBe("file-2");
  });

  it("does the same when Space is what takes the row away", () => {
    const kept = search(press(view(...ROWS), "file-3"), "sample");

    const released = rosterReducer(kept, { type: "focusedToggled" });

    expect(visible(released)).toEqual(["file-0", "file-2"]);
    expect(released.focused).toBe("file-2");
  });

  it("keeps the shown row visible outside the search, and after the selection moves", () => {
    const shown = rosterReducer(
      rosterReducer(view(...ROWS), { type: "activated", handle: "file-3" }),
      { type: "rowStateChanged", handle: "file-3", state: "loaded" },
    );
    const searched = search(shown, "sample");
    expect(visible(searched)).toContain("file-3");

    const moved = press(searched, "file-0");

    expect(selection(moved)).toEqual(["file-0"]);
    expect(visible(moved)).toContain("file-3");
  });

  it("restores the whole roster when the search is cleared", () => {
    const cleared = rosterReducer(search(view(...ROWS), "blank"), { type: "searchCleared" });

    expect(cleared.query).toBe("");
    expect(visible(cleared)).toEqual(["file-0", "file-1", "file-2", "file-3"]);
  });

  it("has a focused row again once rows come back", () => {
    // A search that matches nothing leaves nothing to focus. Clearing it brings
    // the rows back, and the list draws the first of them with the tab stop --
    // but until the state says so too, everything the focused row is for is
    // dead: `Preview focused` stays disabled, Enter reads nothing and Space
    // toggles nothing, until the user presses an arrow or clicks a row.
    const nothing = search(view(...ROWS), "zzz");
    expect(nothing.focused).toBeNull();

    const back = rosterReducer(nothing, { type: "searchCleared" });

    expect(back.focused).toBe("file-0");
    expect(back.anchor).toBe("file-0");
    // And it is a row the keyboard can act on, not just a row that is drawn.
    const toggled = rosterReducer(back, { type: "focusedToggled" });
    expect(selection(toggled)).toEqual(["file-0"]);
  });

  it("finds a focused row again the moment one becomes visible", () => {
    // The same hole reached one character at a time rather than by clearing.
    const nothing = search(view(...ROWS), "blankx");
    expect(nothing.focused).toBeNull();

    const narrower = search(nothing, "blank");

    expect(visible(narrower)).toEqual(["file-3"]);
    expect(narrower.focused).toBe("file-3");
  });

  it("keeps the query and the sort while the workspace stays non-empty", () => {
    const working = rosterReducer(search(view(...ROWS), "sample"), {
      type: "sortChanged",
      sort: "size-desc",
    });
    const arrival = sized("file-4", "extra.mzML", 500);

    const refreshed = rosterReducer(working, {
      type: "rosterLoaded",
      roster: { datasets: ROWS, capacity: CAPACITY },
    });
    expect([refreshed.query, refreshed.sort]).toEqual(["sample", "size-desc"]);

    const addedTo = rosterReducer(working, {
      type: "filesAdded",
      result: {
        roster: { datasets: [...ROWS, arrival], capacity: CAPACITY },
        outcomes: [{ outcome: "added", dataset: arrival }],
      },
    });
    expect([addedTo.query, addedTo.sort]).toEqual(["sample", "size-desc"]);

    const removedFrom = rosterReducer(working, {
      type: "datasetsRemoved",
      result: {
        roster: { datasets: ROWS.slice(1), capacity: CAPACITY },
        removedHandles: ["file-0"],
        unknownHandles: [],
      },
    });
    expect([removedFrom.query, removedFrom.sort]).toEqual(["sample", "size-desc"]);
  });

  it("keeps a newly added nonmatching row visible, because it is selected", () => {
    // M1.2 selects what just arrived, and the pinning rule is what stops a
    // search hiding rows the user asked for in the same breath.
    const searched = search(view(...ROWS), "sample");
    const arrival = sized("file-4", "extra.mzML", 500);

    const added = rosterReducer(searched, {
      type: "filesAdded",
      result: {
        roster: { datasets: [...ROWS, arrival], capacity: CAPACITY },
        outcomes: [{ outcome: "added", dataset: arrival }],
      },
    });

    expect(added.focused).toBe("file-4");
    expect(visible(added)).toEqual(["file-0", "file-2", "file-4"]);
    expect(rosterProjection(added).pinned.get("file-4")).toBe("selected");
  });

  it("invents no selection under a search when everything picked was removed", () => {
    // The row beside the gap is a "keep going" affordance for a list the user
    // can see all of. Under a search it is the nearest survivor in Rust's
    // order, which is very often a row the query excludes -- and selecting it
    // would pin a row into the view that the user never picked.
    const searched = search(view(...ROWS), "sample");
    const picked = rosterReducer(searched, { type: "allSelected" });
    expect(selection(picked)).toEqual(["file-0", "file-2"]);

    const answered = rosterReducer(picked, {
      type: "datasetsRemoved",
      result: {
        roster: { datasets: [ROWS[1] as SelectedFile, ROWS[3] as SelectedFile], capacity: CAPACITY },
        removedHandles: ["file-0", "file-2"],
        unknownHandles: [],
      },
    });

    expect(selection(answered)).toEqual([]);
    expect(visible(answered)).toEqual([]);
  });

  it("still offers the row beside the gap when no search is narrowing the view", () => {
    // The affordance M1.2 shipped, unchanged where it makes sense.
    const picked = press(view(...ROWS), "file-0");

    const answered = rosterReducer(picked, {
      type: "datasetsRemoved",
      result: {
        roster: { datasets: ROWS.slice(1), capacity: CAPACITY },
        removedHandles: ["file-0"],
        unknownHandles: [],
      },
    });

    expect(selection(answered)).toEqual(["file-1"]);
  });

  it("forgets the query and the sort when the last row goes", () => {
    // A filter over an empty workspace is a filter the next batch of files
    // would silently arrive behind.
    const working = rosterReducer(search(view(...ROWS), "sample"), {
      type: "sortChanged",
      sort: "name-desc",
    });

    const emptied = rosterReducer(working, {
      type: "datasetsRemoved",
      result: {
        roster: { datasets: [], capacity: CAPACITY },
        removedHandles: ROWS.map((row) => row.handle),
        unknownHandles: [],
      },
    });
    expect([emptied.query, emptied.sort]).toEqual(["", "added"]);

    const cleared = rosterReducer(working, {
      type: "workspaceCleared",
      roster: { datasets: [], capacity: CAPACITY },
    });
    expect([cleared.query, cleared.sort]).toEqual(["", "added"]);
  });

  it("keeps the query and the sort when a backend change discards the readings", () => {
    const working = rosterReducer(search(view(...ROWS), "sample"), {
      type: "sortChanged",
      sort: "name-asc",
    });

    const discarded = rosterReducer(working, { type: "previewDiscarded" });

    expect([discarded.query, discarded.sort]).toEqual(["sample", "name-asc"]);
    expect(visible(discarded)).toEqual(["file-2", "file-0"]);
  });
});
