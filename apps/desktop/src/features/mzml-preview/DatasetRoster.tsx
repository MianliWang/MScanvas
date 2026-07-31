import { useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { formatByteLength, formatCount } from "./format";
import {
  rowPresentation,
  type RosterAction,
  type RosterState,
  type RowPresentation,
} from "./rosterSelection";
import type { RosterLoadState } from "./usePreviewWorkspace";

export interface DatasetRosterProps {
  readonly state: RosterState;
  readonly load: RosterLoadState;
  readonly onReloadRoster: () => void;
  readonly dispatch: (action: RosterAction) => void;
  readonly onAddFiles: () => void;
  readonly onRemoveSelected: () => void;
  readonly onClearList: () => void;
  readonly onActivate: (handle: string) => void;
  /**
   * Whether the picker may be opened. Curating a workspace does not need a
   * backend, so this is not about ProteoWizard being installed.
   */
  readonly canAddFiles: boolean;
  /** Whether an explicit preview may be started right now. */
  readonly canPreview: boolean;
  /** Whether the roster may be changed right now. */
  readonly canMutate: boolean;
  /** Increments when focus should return to the `Add files…` action. */
  readonly focusAddFilesToken: number;
}

/** What a row says about itself when it is not simply listed. */
const ROW_STATE_LABEL: Record<RowPresentation, string> = {
  ready: "",
  opening: "Reading…",
  loaded: "",
  replaced: "Replaced",
  missing: "Missing",
  failed: "Could not be read",
};

/**
 * The session's workspace: every file it holds, and the actions that curate it.
 *
 * One accessible list, one roving tab stop, and no route by which moving around
 * it reads a file. Reading one is `Preview focused` or Enter, and nothing else.
 */
export function DatasetRoster({
  state,
  load,
  onReloadRoster,
  dispatch,
  onAddFiles,
  onRemoveSelected,
  onClearList,
  onActivate,
  canAddFiles,
  canPreview,
  canMutate,
  focusAddFilesToken,
}: DatasetRosterProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const addFilesRef = useRef<HTMLButtonElement | null>(null);
  const seenFocusToken = useRef(focusAddFilesToken);
  const pendingRestore = useRef<HTMLButtonElement | null>(null);
  const restoreOutstanding = useRef(false);

  /**
   * Keeps the keyboard on the row that has the tab stop.
   *
   * Only while the keyboard is already inside the list. Adding files moves the
   * focused row too, and taking the keyboard away from wherever the user
   * actually is would be a move of its own rather than a roving tab stop.
   */
  useEffect(() => {
    const list = listRef.current;
    if (list === null || state.focused === null) {
      return;
    }
    if (!list.contains(document.activeElement)) {
      return;
    }
    list
      .querySelector<HTMLElement>(`[data-handle="${state.focused}"]`)
      ?.focus({ preventScroll: false });
  }, [state.focused]);

  /**
   * Gives the keyboard back to `Add files…` when the last row goes.
   *
   * Keyed on a counter rather than on the roster being empty, so it fires for
   * the action that emptied it and not for every later render of an empty
   * workspace.
   */
  useEffect(() => {
    if (focusAddFilesToken === seenFocusToken.current) {
      return;
    }
    seenFocusToken.current = focusAddFilesToken;
    addFilesRef.current?.focus({ preventScroll: true });
  }, [focusAddFilesToken]);

  /**
   * Remembers `Add files…` so the keyboard can be given back to it.
   *
   * Only what actually held the keyboard is remembered. A press that did not
   * focus the button has no place to return to, and taking focus the user never
   * put here would be a move of its own rather than a restoration.
   */
  const startAdding = (event: MouseEvent<HTMLButtonElement>) => {
    const control = event.currentTarget;
    pendingRestore.current = document.activeElement === control ? control : null;
    restoreOutstanding.current = false;
    onAddFiles();
  };

  /**
   * Returns the keyboard to `Add files…` once the picker has settled.
   *
   * The action is disabled for the whole request, the picker's modal lifetime
   * included, and disabling the focused button is what blurs it. The browser
   * does not put focus back when it is enabled again, so cancelling the dialog
   * or completing an ordinary addition left a keyboard user without their place
   * in the tab order.
   *
   * Deliberately not keyed on `canAddFiles`: a request begins and ends with it
   * true, so an effect comparing that value alone would not run again if the
   * two renders were ever batched into one. Running after every commit costs a
   * null check, and what makes a settle a settle is stated here instead.
   */
  useEffect(() => {
    const control = pendingRestore.current;
    if (control === null) {
      return;
    }
    if (!canAddFiles) {
      // Outstanding, so nothing is restored yet -- and having seen it is what
      // tells the end of this request from an effect queued before it began.
      restoreOutstanding.current = true;
      return;
    }
    if (!restoreOutstanding.current) {
      return;
    }
    // Settled, whatever the outcome. Held any longer it could fire on a later
    // request it says nothing about.
    pendingRestore.current = null;
    restoreOutstanding.current = false;
    if (!control.isConnected || control.disabled) {
      return;
    }
    // Never over a control the user has since chosen for themselves, including
    // the row this addition just gave the tab stop to. Blurred by the
    // disabling, focus is on the body until something else claims it.
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    control.focus({ preventScroll: true });
  });

  const handleRowPress = (event: MouseEvent<HTMLLIElement>, handle: string) => {
    dispatch({
      type: "rowPressed",
      handle,
      modifiers: { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown":
        dispatch({ type: "focusStepped", delta: 1, extend: event.shiftKey });
        break;
      case "ArrowUp":
        dispatch({ type: "focusStepped", delta: -1, extend: event.shiftKey });
        break;
      case "Home":
        dispatch({ type: "focusJumped", to: "first", extend: event.shiftKey });
        break;
      case "End":
        dispatch({ type: "focusJumped", to: "last", extend: event.shiftKey });
        break;
      case " ":
        dispatch({ type: "focusedToggled" });
        break;
      case "a":
      case "A":
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
        dispatch({ type: "allSelected" });
        break;
      case "Enter":
        // The one keystroke that reads a file. Every other key here moves
        // focus or changes the selection, and neither costs a process.
        if (state.focused !== null && canPreview) {
          onActivate(state.focused);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const rowCount = state.datasets.length;
  const focusStop = state.focused ?? state.datasets[0]?.handle ?? null;

  return (
    <section aria-labelledby="dataset-roster-heading" className="panel dataset-roster-panel">
      <header className="panel-header compact">
        <div>
          <h2 id="dataset-roster-heading">Workspace</h2>
          <p>
            {state.capacity === 0
              ? "Files in this session"
              : `${formatCount(rowCount)} of ${formatCount(state.capacity)} files in this session`}
            {" · removing a row never deletes a file"}
          </p>
        </div>
      </header>

      <div className="dataset-roster-actions">
        <button
          className="primary-button"
          disabled={!canAddFiles}
          onClick={startAdding}
          ref={addFilesRef}
          type="button"
        >
          Add files…
        </button>
        <button
          className="secondary-button"
          disabled={!canPreview || state.focused === null}
          onClick={() => {
            if (state.focused !== null) {
              onActivate(state.focused);
            }
          }}
          type="button"
        >
          Preview focused
        </button>
        <button
          className="secondary-button"
          disabled={!canMutate || state.selected.size === 0}
          onClick={onRemoveSelected}
          type="button"
        >
          Remove selected
        </button>
        {rowCount === 0 ? null : (
          <button
            className="secondary-button"
            disabled={!canMutate}
            onClick={onClearList}
            type="button"
          >
            Clear list
          </button>
        )}
      </div>

      {rowCount === 0 ? (
        <div className="empty-state">
          {load.status === "failed" ? (
            <>
              <strong>The workspace list could not be read</strong>
              <span>{load.error.summary}</span>
              <button className="secondary-button" onClick={onReloadRoster} type="button">
                Try reading it again
              </button>
            </>
          ) : load.status === "loading" ? (
            // Not "there is nothing here". Rust keeps the workspace across a
            // reload of this window, so before the list has been read the one
            // thing that cannot be said is that the session holds nothing.
            <>
              <strong>Reading the workspace list…</strong>
              <span>MSCanvas is asking what this session already holds.</span>
            </>
          ) : (
            <>
              <strong>No files in this session yet</strong>
              <span>
                Add one or many local .mzML files. MSCanvas only reads them, nothing is uploaded,
                and nothing leaves this computer.
              </span>
            </>
          )}
        </div>
      ) : (
        <ul
          aria-labelledby="dataset-roster-heading"
          aria-multiselectable="true"
          className="dataset-roster-list"
          onKeyDown={handleKeyDown}
          ref={listRef}
          role="listbox"
        >
          {state.datasets.map((dataset) => {
            const selected = state.selected.has(dataset.handle);
            const presentation = rowPresentation(state, dataset.handle);
            const label = ROW_STATE_LABEL[presentation];
            // Being the row a read belongs to is not the same as having
            // something on screen. A row keeps that place after a backend
            // change discards what it read, and the marker must not go on
            // claiming a preview nobody can see -- least of all in the hidden
            // text, which is the whole of what a screen reader is told.
            // The bar and the glyph say one thing between them, so they follow
            // one condition. A row being read says so in words instead: the
            // "Reading…" label beside it, which needs no colour either.
            const showing = state.active === dataset.handle && presentation === "loaded";
            return (
              <li
                aria-selected={selected}
                className={`dataset-row${selected ? " is-selected" : ""}${showing ? " is-active" : ""}`}
                data-handle={dataset.handle}
                key={dataset.handle}
                onClick={(event) => {
                  handleRowPress(event, dataset.handle);
                }}
                onDoubleClick={() => {
                  if (canPreview) {
                    onActivate(dataset.handle);
                  }
                }}
                role="option"
                tabIndex={focusStop === dataset.handle ? 0 : -1}
              >
                {/* Two glyphs rather than two shades. Which row is shown and
                    which rows are selected both survive greyscale, high
                    contrast and colour-blind viewing. */}
                <span aria-hidden="true" className="dataset-row-marker">
                  {showing ? "▸" : ""}
                </span>
                <span aria-hidden="true" className="dataset-row-marker">
                  {selected ? "✓" : ""}
                </span>
                {showing ? <span className="visually-hidden">Showing, </span> : null}
                <span className="dataset-row-name" title={dataset.fileName}>
                  {dataset.fileName}
                </span>
                <span className="dataset-row-size">{formatByteLength(dataset.byteLength)}</span>
                {label === "" ? null : <span className="dataset-row-state">{label}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
