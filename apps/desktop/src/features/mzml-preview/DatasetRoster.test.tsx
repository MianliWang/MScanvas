import { fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SelectedFile } from "./contracts";
import { DatasetRoster } from "./DatasetRoster";
import { initialRosterState, rosterReducer, type RosterState } from "./rosterSelection";
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
  readonly load?: RosterLoadState;
  readonly focusAddFilesToken?: number;
}

/**
 * Blurs the way a browser does when a focused control is disabled.
 *
 * jsdom leaves a disabled control focused and then refuses to blur it -- an
 * unfocusable element cannot be blurred -- so the control is briefly enabled to
 * move the keyboard off it and set back exactly as it was. React owns the
 * attribute and is not consulted in between.
 */
function blurAsABrowserWould(control: HTMLElement): void {
  const button = control as HTMLButtonElement;
  const disabled = button.disabled;
  button.disabled = false;
  button.blur();
  button.disabled = disabled;
  expect(document.body).toHaveFocus();
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
      focusAddFilesToken={focusAddFilesToken}
      load={load}
      onActivate={onActivate}
      onAddFiles={onAddFiles}
      onClearList={onClearList}
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
    const state = rosterReducer(
      rosterReducer(seeded(3), { type: "activated", handle: "file-1" }),
      { type: "rowStateChanged", handle: "file-1", state: "loaded" },
    );
    render(
      <DatasetRoster
        canAddFiles
        canMutate
        canPreview
        dispatch={() => undefined}
          focusAddFilesToken={0}
        load={{ status: "ready" }}
          onActivate={() => undefined}
        onAddFiles={() => undefined}
        onClearList={() => undefined}
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
        canMutate
        canPreview
        dispatch={() => undefined}
        focusAddFilesToken={0}
        load={{ status: "ready" }}
        onActivate={() => undefined}
        onAddFiles={() => undefined}
        onClearList={() => undefined}
        onReloadRoster={() => undefined}
        onRemoveSelected={() => undefined}
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

  it("offers a way back when the list itself could not be read", () => {
    const retry = vi.fn();
    render(
      <DatasetRoster
        canAddFiles
        canMutate
        canPreview
        dispatch={() => undefined}
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
          onActivate={() => undefined}
        onAddFiles={() => undefined}
        onClearList={() => undefined}
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
});
