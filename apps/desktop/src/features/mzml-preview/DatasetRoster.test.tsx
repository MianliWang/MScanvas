import { fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";

import { blurAsABrowserWould as blurTheWayABrowserWould } from "../../test/browserFocus";
import type { SelectedFile } from "./contracts";
import { DatasetRoster } from "./DatasetRoster";
import {
  initialRosterState,
  rosterProjection,
  rosterReducer,
  type RosterState,
} from "./rosterSelection";
import type { RosterLoadState } from "./usePreviewWorkspace";

const NAMES = ["QC_pool_01.mzML", "QC_pool_02.mzML", "Blank_03.mzML", "QC_pool_04.mzML"];

function dataset(index: number, relativeContext: string | null = null): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: NAMES[index] ?? `file-${String(index)}.mzML`,
    byteLength: 4_096 * (index + 1),
    relativeContext,
  };
}

function seeded(count: number): RosterState {
  return rosterReducer(initialRosterState, {
    type: "rosterLoaded",
    roster: { datasets: Array.from({ length: count }, (_, index) => dataset(index)), capacity: 1_024 },
  });
}

interface HarnessProps {
  readonly rows?: number;
  readonly onActivate?: (handle: string) => void;
  readonly onAddFiles?: () => void;
  readonly onAddFolder?: () => void;
  readonly onRemoveSelected?: () => void;
  readonly onClearList?: () => void;
  readonly canPreview?: boolean;
  readonly canAddFiles?: boolean;
  readonly canAddFolder?: boolean;
  readonly canReloadRoster?: boolean;
  readonly folderBusy?: boolean;
  readonly canMutate?: boolean;
  readonly load?: RosterLoadState;
  readonly focusAddFilesToken?: number;
  readonly restoreAddFolderFocusToken?: number;
}

/** Blurs the way a browser does when a focused control is disabled. */
function blurAsABrowserWould(control: HTMLElement): void {
  blurTheWayABrowserWould(control);
  expect(document.body).toHaveFocus();
}

/** The real component over the real reducer, so a keystroke does what it does. */
function Harness({
  rows = 4,
  onActivate = () => undefined,
  onAddFiles = () => undefined,
  onAddFolder = () => undefined,
  onRemoveSelected = () => undefined,
  onClearList = () => undefined,
  canPreview = true,
  canAddFiles = true,
  canAddFolder = true,
  canReloadRoster = true,
  folderBusy = false,
  canMutate = true,
  load = { status: "ready" },
  focusAddFilesToken = 0,
  restoreAddFolderFocusToken = 0,
}: HarnessProps) {
  const [state, dispatch] = useReducer(rosterReducer, seeded(rows));
  return (
    <DatasetRoster
      canAddFiles={canAddFiles}
      canAddFolder={canAddFolder}
      canMutate={canMutate}
      canPreview={canPreview}
      canReloadRoster={canReloadRoster}
      dispatch={dispatch}
      focusAddFilesToken={focusAddFilesToken}
      folderBusy={folderBusy}
      load={load}
      onActivate={onActivate}
      onAddFiles={onAddFiles}
      onAddFolder={onAddFolder}
      onClearList={onClearList}
      onReloadRoster={() => undefined}
      onRemoveSelected={onRemoveSelected}
      projection={rosterProjection(state)}
      restoreAddFolderFocusToken={restoreAddFolderFocusToken}
      state={state}
    />
  );
}

/** The real component over a state built by hand, for the cases a keystroke cannot reach. */
function Fixed({
  state,
  canAddFiles = true,
}: {
  readonly state: RosterState;
  readonly canAddFiles?: boolean;
}) {
  return (
    <DatasetRoster
      canAddFiles={canAddFiles}
      canAddFolder
      canMutate
      canPreview
      canReloadRoster
      dispatch={() => undefined}
      focusAddFilesToken={0}
      folderBusy={false}
      load={{ status: "ready" }}
      onActivate={() => undefined}
      onAddFiles={() => undefined}
      onAddFolder={() => undefined}
      onClearList={() => undefined}
      onReloadRoster={() => undefined}
      onRemoveSelected={() => undefined}
      projection={rosterProjection(state)}
      restoreAddFolderFocusToken={0}
      state={state}
    />
  );
}

function rows(): HTMLElement[] {
  // Scoped to the workspace listbox: the sort control is a native select, and
  // its options carry the same role.
  const list = screen.queryByRole("listbox", { name: "Workspace" });
  return list === null ? [] : within(list).getAllByRole("option");
}

function selectedNames(): string[] {
  return rows()
    .filter((row) => row.getAttribute("aria-selected") === "true")
    .map((row) => within(row).getByTitle(/\.mzML$/).textContent ?? "");
}

function tabStops(): HTMLElement[] {
  return rows().filter((row) => row.getAttribute("tabindex") === "0");
}

function press(key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...modifiers });
}

function searchBox(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Search files" });
}

function type(query: string): void {
  fireEvent.change(searchBox(), { target: { value: query } });
}

function rowNames(): string[] {
  return rows().map((row) => within(row).getByTitle(/\.mzML$/).textContent ?? "");
}

describe("looking at the roster through a search and a sort", () => {
  it("labels both controls visibly and offers exactly the five sort modes", () => {
    render(<Harness />);

    // Named by a real label rather than by placeholder text, which is gone the
    // moment anything is typed into it.
    expect(searchBox()).toHaveAttribute("type", "search");
    // A real label associated by `for`, not a wrapper and not a placeholder:
    // a label that wraps more than one control names all of them.
    const label = screen.getByText("Search files");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", searchBox().id);
    const sort = screen.getByRole("combobox", { name: "Sort files" });
    expect(within(sort).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Added order",
      "Name A–Z",
      "Name Z–A",
      "Size: smallest first",
      "Size: largest first",
    ]);
  });

  it("offers neither control over a workspace with nothing in it", () => {
    // Two controls that cannot do anything, taking the height the empty state
    // needs to explain itself.
    render(<Harness rows={0} />);

    expect(screen.queryByRole("searchbox", { name: "Search files" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Sort files" })).toBeNull();
  });

  it("shows only the matching rows, and says how many of how many", () => {
    render(<Harness />);

    type("qc_pool");

    expect(rowNames()).toEqual(["QC_pool_01.mzML", "QC_pool_02.mzML", "QC_pool_04.mzML"]);
    // In the header line the panel already had, which already truncates and
    // already carries the whole sentence in its `title`.
    expect(screen.getByText(/3 matches of 4 files./)).toBeVisible();
  });

  it("says nothing about counts when the search narrows nothing", () => {
    render(<Harness />);

    type("mzML");

    expect(rows()).toHaveLength(4);
    expect(screen.queryByText(/shown$/)).toBeNull();
  });

  it("offers Clear search only once there is a search to clear", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    type("blank");
    expect(screen.getByRole("button", { name: "Clear search" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(rows()).toHaveLength(4);
    // Back where they were typing: clearing a search is a step in the search.
    expect(document.activeElement).toBe(searchBox());
  });

  it("clears the search on Escape", () => {
    render(<Harness />);
    type("blank");
    expect(rows()).toHaveLength(1);

    fireEvent.keyDown(searchBox(), { key: "Escape" });

    expect(rows()).toHaveLength(4);
    expect(searchBox()).toHaveValue("");
  });

  it("reorders the rendered rows to follow the chosen sort", () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "name-asc" },
    });
    expect(rowNames()).toEqual([
      "Blank_03.mzML",
      "QC_pool_01.mzML",
      "QC_pool_02.mzML",
      "QC_pool_04.mzML",
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "size-desc" },
    });
    expect(rowNames()).toEqual([
      "QC_pool_04.mzML",
      "Blank_03.mzML",
      "QC_pool_02.mzML",
      "QC_pool_01.mzML",
    ]);

    // And back to exactly the order the session holds.
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files" }), {
      target: { value: "added" },
    });
    expect(rowNames()).toEqual([
      "QC_pool_01.mzML",
      "QC_pool_02.mzML",
      "Blank_03.mzML",
      "QC_pool_04.mzML",
    ]);
  });

  it("keeps a selected row visible outside the search, and says why in words", () => {
    render(<Harness />);
    fireEvent.click(rows()[2] as HTMLElement);

    type("qc_pool");

    const kept = screen.getByRole("option", { name: /Blank_03\.mzML/ });
    // Not a shade and not a marker: the reason is text, so it survives
    // greyscale and reaches a screen reader through the row's own name.
    expect(within(kept).getByText("Selected — outside search")).toBeVisible();
    expect(kept).toHaveAccessibleName(/Selected — outside search/);
    // Four rows on screen, three of them matches: the count says so rather
    // than letting the visible length speak for the search.
    expect(rows()).toHaveLength(4);
    expect(
      screen.getByText(/3 matches of 4 files; 1 selected or active file kept visible./),
    ).toBeVisible();
  });

  it("says a kept row is showing only when something is on screen for it", () => {
    const shown = rosterReducer(
      rosterReducer(seeded(4), { type: "activated", handle: "file-2" }),
      { type: "rowStateChanged", handle: "file-2", state: "loaded" },
    );
    const searched = rosterReducer(shown, { type: "searchChanged", query: "qc_pool" });
    const { rerender } = render(<Fixed state={searched} />);

    expect(
      within(screen.getByRole("option", { name: /Blank_03\.mzML/ })).getByText(
        "Showing — outside search",
      ),
    ).toBeVisible();

    // A backend change discards what it read. The row stays -- it is still the
    // one an explicit re-read acts on -- and stops claiming to be showing.
    rerender(<Fixed state={rosterReducer(searched, { type: "previewDiscarded" })} />);

    const kept = screen.getByRole("option", { name: /Blank_03\.mzML/ });
    expect(within(kept).queryByText("Showing — outside search")).toBeNull();
    expect(within(kept).getByText("Kept for the viewer — outside search")).toBeVisible();
  });

  it("says a row being read is being read", () => {
    const reading = rosterReducer(
      rosterReducer(seeded(4), { type: "searchChanged", query: "qc_pool" }),
      { type: "rowStateChanged", handle: "file-2", state: "opening" },
    );
    render(<Fixed state={reading} />);

    expect(
      within(screen.getByRole("option", { name: /Blank_03\.mzML/ })).getByText(
        "Reading — outside search",
      ),
    ).toBeVisible();
  });

  it("distinguishes a search that found nothing from a session that holds nothing", () => {
    render(<Harness />);

    type("zzz");

    expect(screen.getByText("No files match this search")).toBeVisible();
    expect(screen.getByText(/4 files are in this session/)).toBeVisible();
    // The one thing it must not say: the workspace still holds every file.
    expect(screen.queryByText("No files in this session yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(rows()).toHaveLength(4);
  });

  it("ranges and selects over what is on screen rather than what is held", () => {
    render(<Harness />);
    type("qc_pool");

    fireEvent.click(rows()[0] as HTMLElement);
    fireEvent.click(rows()[2] as HTMLElement, { shiftKey: true });
    expect(selectedNames()).toEqual([
      "QC_pool_01.mzML",
      "QC_pool_02.mzML",
      "QC_pool_04.mzML",
    ]);

    press("a", { ctrlKey: true });
    // Blank_03 is hidden and is not swept into either.
    expect(selectedNames()).toEqual([
      "QC_pool_01.mzML",
      "QC_pool_02.mzML",
      "QC_pool_04.mzML",
    ]);
  });

  it("keeps one tab stop over the visible rows", () => {
    render(<Harness />);

    type("qc_pool");

    expect(rows()).toHaveLength(3);
    expect(tabStops()).toHaveLength(1);
  });

  it("moves the keyboard to a visible row when the one it was on disappears", () => {
    render(<Harness />);
    fireEvent.click(rows()[2] as HTMLElement);
    type("qc_pool");
    const kept = screen.getByRole("option", { name: /Blank_03\.mzML/ });
    kept.focus();
    expect(document.activeElement).toBe(kept);

    // Deselecting it takes away the only reason it was on screen.
    fireEvent.click(kept, { ctrlKey: true });

    expect(rows()).toHaveLength(3);
    expect(document.activeElement).not.toBe(document.body);
    expect(rows()).toContain(document.activeElement);
  });

  it("leaves the keyboard alone when a blur has nothing to do with the list", () => {
    // `Add files…` is disabled for the picker's whole lifetime, and disabling
    // the focused button blurs it to the body. Recovering on "the keyboard was
    // in the list at some point" would fire then and pull it into the roster,
    // taking the restoration away from the button that is waiting for it --
    // which is the defect issue #25 fixed. The row that had the keyboard is
    // still on screen, so nothing here has anything to recover.
    const { rerender } = render(<Harness canAddFiles rows={4} />);
    const row = rows()[1] as HTMLElement;
    row.focus();
    expect(document.activeElement).toBe(row);

    const add = screen.getByRole("button", { name: "Add files…" });
    add.focus();
    fireEvent.click(add);
    rerender(<Harness canAddFiles={false} rows={4} />);
    blurAsABrowserWould(add);
    rerender(<Harness canAddFiles={false} rows={4} />);

    expect(document.activeElement).toBe(document.body);
    expect(rows()).not.toContain(document.activeElement);
  });

  it("forgets the row it was watching once the keyboard has gone somewhere else", () => {
    // The same defect one step further on. Adding files replaces the selection,
    // so a kept row the user tabbed away from can leave the projection during
    // the very picker request whose restoration must not be taken -- and then
    // the recovery would be looking at a row that really has gone, for a user
    // who really has left.
    // A kept row: selected, and outside the search that is keeping it visible.
    const kept = rosterReducer(
      rosterReducer(seeded(4), {
        type: "rowPressed",
        handle: "file-2",
        modifiers: { ctrl: false, shift: false },
      }),
      { type: "searchChanged", query: "qc_pool" },
    );
    const { rerender } = render(<Fixed state={kept} />);
    screen.getByRole("option", { name: /Blank_03\.mzML/ }).focus();

    const add = screen.getByRole("button", { name: "Add files…" });
    add.focus();
    fireEvent.click(add);
    rerender(<Fixed canAddFiles={false} state={kept} />);
    blurAsABrowserWould(add);

    // The addition replaces the selection, so the row the user tabbed away from
    // leaves the projection during the very request whose restoration must not
    // be taken.
    const added = rosterReducer(kept, {
      type: "filesAdded",
      result: {
        roster: {
          datasets: [...kept.datasets, { handle: "file-9", fileName: "QC_pool_09.mzML", byteLength: 1, relativeContext: null }],
          capacity: 1_024,
        },
        outcomes: [
          { outcome: "added", dataset: { handle: "file-9", fileName: "QC_pool_09.mzML", byteLength: 1, relativeContext: null } },
        ],
      },
    });
    rerender(<Fixed canAddFiles={false} state={added} />);

    expect(screen.queryByRole("option", { name: /Blank_03\.mzML/ })).toBeNull();
    expect(document.activeElement).toBe(document.body);

    rerender(<Fixed state={added} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add files…" }));
  });

  it("still reports a row's own state while a search is keeping it visible", () => {
    // Two different things. That a file was replaced, is missing or could not
    // be read is not a fact a search may suppress, and it was suppressed while
    // both shared one slot.
    const failed = rosterReducer(
      rosterReducer(seeded(4), { type: "rowPressed", handle: "file-2", modifiers: { ctrl: false, shift: false } }),
      { type: "rowStateChanged", handle: "file-2", state: "replaced" },
    );
    render(<Fixed state={rosterReducer(failed, { type: "searchChanged", query: "qc_pool" })} />);

    const kept = screen.getByRole("option", { name: /Blank_03\.mzML/ });
    expect(within(kept).getByText("Replaced")).toBeVisible();
    expect(within(kept).getByText("Selected — outside search")).toBeVisible();
    expect(kept).toHaveAccessibleName(/Replaced/);
  });

  it("moves the keyboard to the search box when no visible row survives", () => {
    render(<Harness />);
    fireEvent.click(rows()[2] as HTMLElement);
    type("zzz");
    const kept = screen.getByRole("option", { name: /Blank_03\.mzML/ });
    kept.focus();

    fireEvent.click(kept, { ctrlKey: true });

    expect(screen.getByText("No files match this search")).toBeVisible();
    expect(document.activeElement).toBe(searchBox());
  });
});

describe("the workspace roster as an accessible list", () => {
  it("is one multi-selectable listbox with one roving tab stop", () => {
    render(<Harness />);

    const list = screen.getByRole("listbox", { name: "Workspace" });
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    expect(within(list).getAllByRole("option")).toHaveLength(4);
    // One tab stop, whatever the selection: a list of a thousand rows must not
    // be a thousand stops in the tab order.
    expect(tabStops()).toHaveLength(1);
    expect(rows().every((row) => row.hasAttribute("aria-selected"))).toBe(true);
  });

  it("says which row is being shown without relying on colour", () => {
    const state = rosterReducer(
      rosterReducer(seeded(3), { type: "activated", handle: "file-1" }),
      { type: "rowStateChanged", handle: "file-1", state: "loaded" },
    );
    render(
      <DatasetRoster
        canAddFiles
        canAddFolder
        canMutate
        canPreview
        canReloadRoster
        dispatch={() => undefined}
        focusAddFilesToken={0}
        folderBusy={false}
        load={{ status: "ready" }}
        onActivate={() => undefined}
        onAddFiles={() => undefined}
        onAddFolder={() => undefined}
        onClearList={() => undefined}
        onReloadRoster={() => undefined}
        onRemoveSelected={() => undefined}
        projection={rosterProjection(state)}
        restoreAddFolderFocusToken={0}
        state={state}
      />,
    );

    const shown = screen.getByRole("option", { name: /QC_pool_02\.mzML/ });
    // A glyph and a word, not a shade: the marker survives greyscale and high
    // contrast, and the hidden text is what a screen reader hears.
    expect(shown).toHaveTextContent("▸");
    expect(within(shown).getByText("Showing,")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /QC_pool_01\.mzML/ })).not.toHaveTextContent("▸");
  });

  it("says nothing is being shown for a row whose reading was discarded", () => {
    // A row keeps its place as the one a read belongs to after a backend change
    // empties the preview -- that is what makes reading it again one action --
    // but nothing is on screen for it, and the hidden text is the whole of what
    // a screen reader is told.
    const shown = rosterReducer(
      rosterReducer(seeded(3), { type: "activated", handle: "file-1" }),
      { type: "rowStateChanged", handle: "file-1", state: "loaded" },
    );
    const discarded = rosterReducer(shown, { type: "previewDiscarded" });
    render(
      <DatasetRoster
        canAddFiles
        canAddFolder
        canMutate
        canPreview
        canReloadRoster
        dispatch={() => undefined}
        focusAddFilesToken={0}
        folderBusy={false}
        load={{ status: "ready" }}
        onActivate={() => undefined}
        onAddFiles={() => undefined}
        onAddFolder={() => undefined}
        onClearList={() => undefined}
        onReloadRoster={() => undefined}
        onRemoveSelected={() => undefined}
        projection={rosterProjection(discarded)}
        restoreAddFolderFocusToken={0}
        state={discarded}
      />,
    );

    const row = screen.getByRole("option", { name: /QC_pool_02\.mzML/ });
    expect(row).not.toHaveTextContent("▸");
    expect(within(row).queryByText("Showing,")).toBeNull();
    expect(discarded.active).toBe("file-1");
  });

  it("does not claim the session is empty before the list has been read", () => {
    // Rust keeps the workspace across a reload of this window, so until the
    // list has been read, "there is nothing here" is a claim this side cannot
    // make.
    render(<Harness load={{ status: "loading" }} rows={0} />);

    expect(screen.getByText("Reading the workspace list…")).toBeVisible();
    expect(screen.queryByText("No files in this session yet")).toBeNull();
  });

  it("keeps its actions under stable accessible names", () => {
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeEnabled();
    // Said where the actions are, not only in a confirmation nobody has to
    // read: removing a row is not deleting a file.
    expect(screen.getByText(/removing a row never deletes a file/)).toBeVisible();
  });

  it("offers adding files and nothing else when the session holds none", () => {
    render(<Harness rows={0} />);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("No files in this session yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add files…" })).toBeEnabled();
    // No second Add action hiding in the empty state: one action, one place.
    expect(screen.getAllByRole("button", { name: "Add files…" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
  });

  it("offers an accessible escape from an unresolved first folder import", () => {
    render(
      <Harness
        canAddFiles={false}
        canAddFolder={false}
        canMutate
        folderBusy
        rows={0}
      />,
    );

    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    const clear = screen.getByRole("button", { name: "Clear list" });
    expect(clear).toBeEnabled();
    expect(clear).toHaveAccessibleDescription(
      "Clear list also prevents the pending folder import from adding files.",
    );
  });

  it("offers a way back when the list itself could not be read", () => {
    const retry = vi.fn();
    render(
      <DatasetRoster
        canAddFiles
        canAddFolder
        canMutate
        canPreview
        canReloadRoster
        dispatch={() => undefined}
        focusAddFilesToken={0}
        folderBusy={false}
        load={{
          status: "failed",
          error: {
            kind: "preview_worker_unavailable",
            summary: "MSCanvas could not run that request.",
            detail: null,
            retryable: true,
          },
        }}
        onActivate={() => undefined}
        onAddFiles={() => undefined}
        onAddFolder={() => undefined}
        onClearList={() => undefined}
        onReloadRoster={retry}
        onRemoveSelected={() => undefined}
        projection={rosterProjection(initialRosterState)}
        restoreAddFolderFocusToken={0}
        state={initialRosterState}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try reading it again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("selecting rows with the pointer", () => {
  it("selects only the row that was clicked", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("option", { name: /Blank_03\.mzML/ }));

    expect(selectedNames()).toEqual(["Blank_03.mzML"]);
    expect(tabStops()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
  });

  it("adds and removes one row at a time with Ctrl", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("option", { name: /QC_pool_01\.mzML/ }));
    fireEvent.click(screen.getByRole("option", { name: /Blank_03\.mzML/ }), { ctrlKey: true });
    expect(selectedNames()).toEqual(["QC_pool_01.mzML", "Blank_03.mzML"]);

    fireEvent.click(screen.getByRole("option", { name: /QC_pool_01\.mzML/ }), { ctrlKey: true });
    expect(selectedNames()).toEqual(["Blank_03.mzML"]);
  });

  it("selects the whole insertion-order range with Shift", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("option", { name: /QC_pool_02\.mzML/ }));
    fireEvent.click(screen.getByRole("option", { name: /QC_pool_04\.mzML/ }), { shiftKey: true });

    expect(selectedNames()).toEqual(["QC_pool_02.mzML", "Blank_03.mzML", "QC_pool_04.mzML"]);
  });

  it("reads a row on a double click and on nothing else", () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);

    fireEvent.click(screen.getByRole("option", { name: /Blank_03\.mzML/ }));
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByRole("option", { name: /Blank_03\.mzML/ }));
    expect(onActivate).toHaveBeenCalledWith("file-2");
  });
});

describe("driving the roster from the keyboard alone", () => {
  it("moves focus without selecting and without reading anything", () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);
    rows()[0]?.focus();

    press("ArrowDown");
    press("ArrowDown");

    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Blank_03\.mzML/ }));
    // Focus is not selection and neither is a read. Every one of these would be
    // a ProteoWizard process if focus followed selection.
    expect(selectedNames()).toEqual([]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("toggles the focused row with Space", () => {
    render(<Harness />);
    rows()[0]?.focus();

    press("ArrowDown");
    press(" ");
    expect(selectedNames()).toEqual(["QC_pool_02.mzML"]);

    press(" ");
    expect(selectedNames()).toEqual([]);
  });

  it("extends the anchored range with Shift and the arrows", () => {
    render(<Harness />);
    rows()[0]?.focus();

    press("ArrowDown");
    press(" ");
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });

    expect(selectedNames()).toEqual(["QC_pool_02.mzML", "Blank_03.mzML", "QC_pool_04.mzML"]);
  });

  it("selects everything with Ctrl+A and jumps with Home and End", () => {
    render(<Harness />);
    rows()[0]?.focus();

    press("a", { ctrlKey: true });
    expect(selectedNames()).toHaveLength(4);

    press("End");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /QC_pool_04\.mzML/ }));
    press("Home");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /QC_pool_01\.mzML/ }));
    // Jumping moved focus and left the selection where it was.
    expect(selectedNames()).toHaveLength(4);
  });

  it("leaves a bare A alone so it can still be typed", () => {
    render(<Harness />);
    rows()[0]?.focus();

    press("a");

    expect(selectedNames()).toEqual([]);
  });

  it("reads the focused row on Enter, and only when reading is possible", () => {
    const onActivate = vi.fn();
    const { unmount } = render(<Harness onActivate={onActivate} />);
    rows()[0]?.focus();

    press("ArrowDown");
    press("Enter");
    expect(onActivate).toHaveBeenCalledWith("file-1");

    unmount();
    onActivate.mockClear();
    render(<Harness canPreview={false} onActivate={onActivate} />);
    rows()[0]?.focus();

    press("Enter");

    // No usable backend, or a read already running: Enter must not queue one.
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Preview focused" })).toBeDisabled();
  });

  it("gives the keyboard back to Add files… when the last row goes", () => {
    const { rerender } = render(<Harness focusAddFilesToken={0} rows={0} />);

    rerender(<Harness focusAddFilesToken={1} rows={0} />);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add files…" }));
  });

  it("gives the keyboard back to Add files… when the picker settles", () => {
    // The action is disabled for the picker's whole modal lifetime, and
    // disabling the focused button is what blurs it. Nothing puts it back, so a
    // keyboard user who cancelled the dialog was left at the top of the
    // document with no place in the tab order.
    const { rerender } = render(<Harness canAddFiles rows={2} />);
    const add = screen.getByRole("button", { name: "Add files…" });
    add.focus();
    expect(document.activeElement).toBe(add);

    fireEvent.click(add);
    rerender(<Harness canAddFiles={false} rows={2} />);
    blurAsABrowserWould(add);

    rerender(<Harness canAddFiles rows={2} />);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add files…" }));
  });

  it("takes no focus the user never put on Add files…", () => {
    // A pointer press that never gave the button the keyboard has no place to
    // return to, and taking focus here would be a move of its own rather than a
    // restoration. Deliberately settled with the keyboard on the body, which is
    // the one state in which taking it would succeed.
    const { rerender } = render(<Harness canAddFiles rows={2} />);
    expect(document.body).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));
    rerender(<Harness canAddFiles={false} rows={2} />);
    expect(document.body).toHaveFocus();
    rerender(<Harness canAddFiles rows={2} />);

    expect(document.body).toHaveFocus();
  });

  it("takes no focus back over a control the user has since chosen", () => {
    const { rerender } = render(<Harness canAddFiles rows={2} />);
    const add = screen.getByRole("button", { name: "Add files…" });
    add.focus();

    fireEvent.click(add);
    rerender(<Harness canAddFiles={false} rows={2} />);
    blurAsABrowserWould(add);
    // The user went somewhere themselves while the dialog was up.
    rows()[1]?.focus();
    const chosen = document.activeElement;

    rerender(<Harness canAddFiles rows={2} />);

    expect(document.activeElement).toBe(chosen);
  });

  it("pays a settled shell retry debt without needing an observed disabled commit", () => {
    const { rerender } = render(<Harness restoreAddFolderFocusToken={0} rows={0} />);
    const folder = screen.getByRole("button", { name: "Add mzML folder…" });
    const focusing = vi.spyOn(folder, "focus");
    expect(document.body).toHaveFocus();

    // A native dismissal can settle before React commits an intermediate busy
    // state. The token is the request edge, so the debt must still be payable.
    rerender(<Harness restoreAddFolderFocusToken={1} rows={0} />);

    expect(folder).toHaveFocus();
    expect(focusing).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe("the two ways of adding acquisitions", () => {
  it("offers five actions, in one place, under stable names", () => {
    render(<Harness />);

    const actions = screen
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((label) => label !== "Clear search");
    expect(actions).toEqual([
      "Add files…",
      "Add mzML folder…",
      "Preview focused",
      "Remove selected",
      "Clear list",
    ]);
  });

  it("keeps the folder action's name while an import runs, and marks it busy", () => {
    // The name is how a user finds an action again, so it does not move. It
    // also must not claim a folder is being scanned: the flag is set before the
    // native dialog opens, so for as long as the user spends navigating it --
    // or if they cancel -- nothing is being scanned at all.
    render(<Harness canAddFiles={false} canAddFolder={false} canMutate={false} folderBusy />);

    const folder = screen.getByRole("button", { name: "Add mzML folder…" });
    expect(folder).toBeDisabled();
    expect(folder).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/Scanning folder/)).toBeNull();
    // No percentage anywhere: nothing has counted the tree, so there is no
    // proportion to report and none is made up.
    expect(folder.textContent).not.toMatch(/\d/);
    // And the region the import is about to change says it is not settled.
    expect(screen.getByRole("region", { name: "Workspace" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeDisabled();
  });

  it("keeps workspace mutation controls and refuses only the roster read", () => {
    // The three have different concurrency contracts and are three answers, not
    // one boolean. Clearing is the reliable final-empty escape and removal still
    // manages rows already on screen; reading the list back is another statement
    // about what the workspace is and could win the gate and supersede the very
    // import the user is waiting for.
    render(
      <Harness
        canAddFiles={false}
        canAddFolder={false}
        canMutate
        canReloadRoster={false}
        folderBusy
      />,
    );

    expect(screen.getByRole("button", { name: "Add files…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear list" })).toBeEnabled();
    // `Remove selected` still needs a selected row, which is its own condition
    // and not this one.
    fireEvent.click(rows()[0] as HTMLElement);
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
  });

  it("refuses the roster read while an import is unresolved", () => {
    render(
      <Harness
        canMutate
        canReloadRoster={false}
        folderBusy
        load={{
          status: "failed",
          error: {
            kind: "preview_worker_unavailable",
            summary: "MSCanvas could not run that request.",
            detail: null,
            retryable: true,
          },
        }}
        rows={0}
      />,
    );

    expect(screen.getByRole("button", { name: "Try reading it again" })).toBeDisabled();
  });

  it("says nothing about a scan while the roster is idle", () => {
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Add mzML folder…" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(screen.getByRole("region", { name: "Workspace" })).toHaveAttribute("aria-busy", "false");
  });

  it("hands each acquisition action to its own callback", () => {
    const onAddFiles = vi.fn();
    const onAddFolder = vi.fn();
    render(<Harness onAddFiles={onAddFiles} onAddFolder={onAddFolder} />);

    fireEvent.click(screen.getByRole("button", { name: "Add mzML folder…" }));

    expect(onAddFolder).toHaveBeenCalledTimes(1);
    expect(onAddFiles).not.toHaveBeenCalled();
  });
});

describe("saying which of two identically named rows is which", () => {
  /** A state whose first two rows share a filename and say where they are. */
  function collided(): RosterState {
    return rosterReducer(initialRosterState, {
      type: "rosterLoaded",
      roster: {
        datasets: [
          { handle: "file-0", fileName: "sample.mzML", byteLength: 4_096, relativeContext: "batch-1" },
          { handle: "file-1", fileName: "sample.mzML", byteLength: 8_192, relativeContext: "batch-2" },
          { handle: "file-2", fileName: "unique.mzML", byteLength: 2_048, relativeContext: null },
        ],
        capacity: 1_024,
      },
    });
  }

  it("renders the context beside the name and nowhere else", () => {
    render(<Fixed state={collided()} />);

    const row = screen.getByRole("option", { name: /sample\.mzML,\s*batch-1/ });
    expect(within(row).getByText("batch-1")).toBeVisible();
    // The filename is the primary label and is said once.
    expect(within(row).getAllByText("sample.mzML")).toHaveLength(1);
    // And a row whose name is already unique says nothing.
    const unique = screen.getByRole("option", { name: /unique\.mzML/ });
    expect(unique.textContent).toBe("unique.mzML2.0 KiB");
  });

  it("uses the bounded value exactly as Rust gave it, in the visible text and the title alike", () => {
    render(<Fixed state={collided()} />);

    const context = within(screen.getByRole("option", { name: /sample\.mzML,\s*batch-2/ })).getByText(
      "batch-2",
    );
    // No client-side path processing of any kind: the tooltip says exactly what
    // is on screen, so hovering reveals nothing the row did not already show.
    expect(context).toHaveAttribute("title", "batch-2");
  });

  it("does not take the place of what a row says about its file or about the view", () => {
    // Three different things, and none of them may stand in for another: where
    // the file was found, what happened when it was read, and why a row the
    // search did not match is on screen anyway.
    const searched = rosterReducer(
      rosterReducer(
        rosterReducer(collided(), { type: "rowPressed", handle: "file-0", modifiers: { ctrl: false, shift: false } }),
        { type: "rowStateChanged", handle: "file-0", state: "missing" },
      ),
      { type: "searchChanged", query: "unique" },
    );

    render(<Fixed state={searched} />);

    const row = screen.getByRole("option", { name: /sample\.mzML/ });
    expect(within(row).getByText("batch-1")).toBeVisible();
    expect(within(row).getByText("Missing")).toBeVisible();
    expect(within(row).getByText("Selected — outside search")).toBeVisible();
  });
});
