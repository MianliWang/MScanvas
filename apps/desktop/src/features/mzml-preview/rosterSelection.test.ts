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
  describeAddResult,
  describeClear,
  describeRemoveResult,
  initialRosterState,
  rosterReducer,
  rowPresentation,
  rowStateForError,
  type RosterState,
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
