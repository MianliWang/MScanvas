import { useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import type { PreviewError } from "./contracts";
import { formatByteLength, formatCount } from "./format";
import {
  rowPresentation,
  type RosterAction,
  type RosterState,
  type RowPresentation,
  type WorkspaceNotice,
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
  readonly notice: WorkspaceNotice | null;
  readonly onDismissNotice: () => void;
  readonly error: PreviewError | null;
  readonly onDismissError: () => void;
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
  notice,
  onDismissNotice,
  error,
  onDismissError,
  focusAddFilesToken,
}: DatasetRosterProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const addFilesRef = useRef<HTMLButtonElement | null>(null);
  const seenFocusToken = useRef(focusAddFilesToken);

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
          onClick={onAddFiles}
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

      {error === null ? null : (
        <div className="notice notice-danger" role="status">
          <strong>The workspace could not be changed</strong>
          <span>{error.summary}</span>
          <button className="link-button" onClick={onDismissError} type="button">
            Dismiss
          </button>
        </div>
      )}

      {notice === null ? null : (
        <div
          className={notice.tone === "warning" ? "notice notice-warning" : "notice notice-neutral"}
          role="status"
        >
          <span>{notice.message}</span>
          {notice.details.length === 0 ? null : (
            <ul className="dataset-roster-details">
              {notice.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
              {notice.more === 0 ? null : (
                <li key="more">{formatCount(notice.more)} more not listed here.</li>
              )}
            </ul>
          )}
          <button className="link-button" onClick={onDismissNotice} type="button">
            Dismiss
          </button>
        </div>
      )}

      {load.status === "failed" ? (
        <div className="notice notice-danger" role="status">
          <strong>The workspace list could not be read</strong>
          <span>{load.error.summary}</span>
          <button className="link-button" onClick={onReloadRoster} type="button">
            Try reading it again
          </button>
        </div>
      ) : null}

      {rowCount === 0 ? (
        <div className="empty-state">
          <strong>No files in this session yet</strong>
          <span>
            Add one or many local .mzML files. MSCanvas only reads them, nothing is uploaded, and
            nothing leaves this computer.
          </span>
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
            const active = state.active === dataset.handle;
            const presentation = rowPresentation(state, dataset.handle);
            const label = ROW_STATE_LABEL[presentation];
            return (
              <li
                aria-selected={selected}
                className={`dataset-row${selected ? " is-selected" : ""}${active ? " is-active" : ""}`}
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
                  {active ? "▸" : ""}
                </span>
                <span aria-hidden="true" className="dataset-row-marker">
                  {selected ? "✓" : ""}
                </span>
                {active ? <span className="visually-hidden">Showing, </span> : null}
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
