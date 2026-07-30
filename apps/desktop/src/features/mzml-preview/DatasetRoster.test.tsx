import { fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SelectedFile } from "./contracts";
import { DatasetRoster } from "./DatasetRoster";
import {
  initialRosterState,
  rosterReducer,
  type RosterState,
  type WorkspaceNotice,
} from "./rosterSelection";
import type { RosterLoadState } from "./usePreviewWorkspace";

const NAMES = ["QC_pool_01.mzML", "QC_pool_02.mzML", "Blank_03.mzML", "QC_pool_04.mzML"];

function dataset(index: number): SelectedFile {
  return {
    handle: `file-${String(index)}`,
    fileName: NAMES[index] ?? `file-${String(index)}.mzML`,
    byteLength: 4_096 * (index + 1),
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
  readonly onRemoveSelected?: () => void;
  readonly onClearList?: () => void;
  readonly canPreview?: boolean;
  readonly canAddFiles?: boolean;
  readonly canMutate?: boolean;
  readonly notice?: WorkspaceNotice | null;
  readonly load?: RosterLoadState;
  readonly focusAddFilesToken?: number;
}

/** The real component over the real reducer, so a keystroke does what it does. */
function Harness({
  rows = 4,
  onActivate = () => undefined,
  onAddFiles = () => undefined,
  onRemoveSelected = () => undefined,
  onClearList = () => undefined,
  canPreview = true,
  canAddFiles = true,
  canMutate = true,
  notice = null,
  load = { status: "ready" },
  focusAddFilesToken = 0,
}: HarnessProps) {
  const [state, dispatch] = useReducer(rosterReducer, seeded(rows));
  return (
    <DatasetRoster
      canAddFiles={canAddFiles}
      canMutate={canMutate}
      canPreview={canPreview}
      dispatch={dispatch}
      error={null}
      focusAddFilesToken={focusAddFilesToken}
      load={load}
      notice={notice}
      onActivate={onActivate}
      onAddFiles={onAddFiles}
      onClearList={onClearList}
      onDismissError={() => undefined}
      onDismissNotice={() => undefined}
      onReloadRoster={() => undefined}
      onRemoveSelected={onRemoveSelected}
      state={state}
    />
  );
}

function rows(): HTMLElement[] {
  return screen.getAllByRole("option");
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
    const state = rosterReducer(seeded(3), { type: "activated", handle: "file-1" });
    render(
      <DatasetRoster
        canAddFiles
        canMutate
        canPreview
        dispatch={() => undefined}
        error={null}
        focusAddFilesToken={0}
        load={{ status: "ready" }}
        notice={null}
        onActivate={() => undefined}
        onAddFiles={() => undefined}
        onClearList={() => undefined}
        onDismissError={() => undefined}
        onDismissNotice={() => undefined}
        onReloadRoster={() => undefined}
        onRemoveSelected={() => undefined}
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

  it("offers a way back when the list itself could not be read", () => {
    const retry = vi.fn();
    render(
      <DatasetRoster
        canAddFiles
        canMutate
        canPreview
        dispatch={() => undefined}
        error={null}
        focusAddFilesToken={0}
        load={{
          status: "failed",
          error: {
            kind: "preview_worker_unavailable",
            summary: "MSCanvas could not run that request.",
            detail: null,
            retryable: true,
          },
        }}
        notice={null}
        onActivate={() => undefined}
        onAddFiles={() => undefined}
        onClearList={() => undefined}
        onDismissError={() => undefined}
        onDismissNotice={() => undefined}
        onReloadRoster={retry}
        onRemoveSelected={() => undefined}
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
});

describe("what the roster says about the last action", () => {
  it("shows a bounded summary and says how many it did not list", () => {
    render(
      <Harness
        notice={{
          tone: "warning",
          message: "Added 1 file. 2 files already in the workspace.",
          details: ["a.mzML is already in the workspace.", "b.mzXML: MSCanvas opens .mzML files."],
          more: 7,
        }}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Added 1 file. 2 files already in the workspace.");
    expect(notice).toHaveTextContent("a.mzML is already in the workspace.");
    expect(notice).toHaveTextContent("7 more not listed here.");
  });
});
