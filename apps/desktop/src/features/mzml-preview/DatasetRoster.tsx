import { useEffect, useRef } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent } from "react";

import { formatByteLength, formatCount } from "./format";
import {
  rowPresentation,
  type RosterAction,
  type RosterState,
  type RowPresentation,
} from "./rosterSelection";
import {
  describeProjection,
  isSortMode,
  PIN_REASON_LABEL,
  SORT_MODE_LABEL,
  SORT_MODES,
  type RosterProjection,
} from "./rosterView";
import type { RosterLoadState } from "./usePreviewWorkspace";

export interface DatasetRosterProps {
  readonly state: RosterState;
  /**
   * What the state puts on screen. Passed in rather than derived here so the
   * rows this renders and the rows the reducer ranges over are one list.
   */
  readonly projection: RosterProjection;
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
  projection,
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
  const searchRef = useRef<HTMLInputElement | null>(null);
  const seenFocusToken = useRef(focusAddFilesToken);
  const pendingRestore = useRef<HTMLButtonElement | null>(null);
  const restoreOutstanding = useRef(false);
  /**
   * The row that last took the keyboard, remembered by handle.
   *
   * Not a boolean "the keyboard was in here somewhere": that cannot tell a row
   * unmounting from under the user apart from the user walking out of the list,
   * and the two need opposite answers. A handle can be asked the only question
   * that matters — is the row that had the keyboard still on screen?
   */
  const keyboardOn = useRef<string | null>(null);
  /** The focused handle the roving tab stop was last moved to follow. */
  const followed = useRef(state.focused);

  /**
   * Keeps the keyboard on the row that has the tab stop, and never on nothing.
   *
   * Two jobs that used to be one. While the keyboard is inside the list it
   * follows the roving tab stop, and only then: adding files moves the focused
   * row too, and taking the keyboard away from wherever the user actually is
   * would be a move of its own rather than a roving tab stop.
   *
   * The second job is what a projection makes possible. A row can leave the
   * list while the keyboard is on it -- deselect the kept row a search was
   * holding on screen, or let a read finish on a row the query does not match --
   * and an unmounting element takes focus to the body silently, with no event
   * and with `contains` no longer true of anything. The row that took its place
   * if there is one, the search box if there is not, the body never.
   *
   * What makes that safe is asking about the row rather than about the list.
   * Focus reaches the body for reasons that have nothing to do with this
   * component -- disabling `Add files…` for the picker's lifetime blurs it
   * there, and that button is waiting for its own restoration. Recovering on
   * "the keyboard was in the list at some point" would fire then too and take
   * the keyboard back into the roster, which is the defect issue #25 fixed.
   * Recovering only when the row that actually held it has left the projection
   * cannot: that row is still there.
   *
   * Deliberately not keyed on `state.focused`: the row can go while the focused
   * handle stays exactly as it was.
   */
  useEffect(() => {
    const list = listRef.current;
    const active = document.activeElement;
    const moved = followed.current !== state.focused;
    followed.current = state.focused;
    if (list !== null && list.contains(active)) {
      if (!moved) {
        // The tab stop is where it was, so the keyboard is where the user put
        // it. Following it on every commit would take focus off a row they
        // reached for themselves.
        return;
      }
      const row = list.querySelector<HTMLElement>(`[data-handle="${state.focused ?? ""}"]`);
      if (row !== null && row !== active) {
        row.focus({ preventScroll: false });
      }
      return;
    }
    const orphaned = keyboardOn.current;
    if (active !== document.body || orphaned === null || projection.handles.has(orphaned)) {
      // Either the keyboard is somewhere of the user's own choosing, or nothing
      // was left behind here to recover, or the row that held it is still on
      // screen and has simply been blurred by something that is not this
      // component's business.
      return;
    }
    keyboardOn.current = null;
    const row =
      state.focused === null
        ? null
        : (list?.querySelector<HTMLElement>(`[data-handle="${state.focused}"]`) ?? null);
    if (row !== null) {
      row.focus({ preventScroll: true });
      return;
    }
    searchRef.current?.focus({ preventScroll: true });
  });

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

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: "searchChanged", query: event.target.value });
  };

  const handleSearchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || state.query === "") {
      return;
    }
    dispatch({ type: "searchCleared" });
    event.preventDefault();
  };

  const clearSearch = () => {
    dispatch({ type: "searchCleared" });
    // Back where they were typing. Clearing a search is a step in the search,
    // not a way out of it.
    searchRef.current?.focus({ preventScroll: true });
  };

  const handleSort = (event: ChangeEvent<HTMLSelectElement>) => {
    const chosen = event.target.value;
    if (isSortMode(chosen)) {
      dispatch({ type: "sortChanged", sort: chosen });
    }
  };

  const rowCount = state.datasets.length;
  const visible = projection.datasets;
  const focusStop = state.focused ?? visible[0]?.handle ?? null;
  // Measured against what the search matched, never against what is on screen:
  // a query that matched three of four files narrowed the view whether or not
  // a fourth row is being kept visible for another reason. The same sentence
  // the live region reads, so the two halves cannot drift apart.
  const searching = projection.searching && projection.matchCount !== rowCount;
  const headline = searching
    ? `${describeProjection(projection)} Removing a row never deletes a file.`
    : `${
        state.capacity === 0
          ? "Files in this session"
          : `${formatCount(rowCount)} of ${formatCount(state.capacity)} files in this session`
      } · removing a row never deletes a file`;

  return (
    <section aria-labelledby="dataset-roster-heading" className="panel dataset-roster-panel">
      <header className="panel-header compact">
        <div>
          <h2 id="dataset-roster-heading">Workspace</h2>
          {/* The line the panel already had, which already truncates with an
              ellipsis and already carries the whole sentence in its `title`.
              The search summary belongs here rather than in a line of its own:
              a row of its own costs height in the one panel that is counting
              it, and at the widths where the roster's actions wrap it was the
              list that paid. */}
          <p
            className={searching ? "dataset-roster-matches" : undefined}
            id="dataset-roster-matches"
            title={headline}
          >
            {headline}
          </p>
        </div>
      </header>

      {/* Only over a list there is something to narrow. Offered against an
          empty workspace they would be two controls that cannot do anything,
          taking the height the empty state needs to explain itself. */}
      {rowCount === 0 ? null : (
        <div className="dataset-roster-filters">
          {/* A group rather than a wrapping label: a `<label>` names exactly
              one control, and putting the clear action inside one made it part
              of the search box's own name. Associated by `for` instead, which
              says the same thing without the ambiguity. */}
          <div className="roster-field">
            <label htmlFor="dataset-roster-search">Search files</label>
            <input
              aria-describedby={searching ? "dataset-roster-matches" : undefined}
              id="dataset-roster-search"
              onChange={handleSearch}
              onKeyDown={handleSearchKeys}
              ref={searchRef}
              type="search"
              value={state.query}
            />
            {/* In the field's own group, so this row stays two items wide and
                one line tall whatever it holds. Not offered while the no-match
                state is showing: that state offers the same action, and two
                controls of one name are two answers to "which one clears the
                search". */}
            {state.query === "" || visible.length === 0 ? null : (
              <button className="link-button" onClick={clearSearch} type="button">
                Clear search
              </button>
            )}
          </div>
          <div className="roster-field">
            <label htmlFor="dataset-roster-sort">Sort files</label>
            <select id="dataset-roster-sort" onChange={handleSort} value={state.sort}>
              {SORT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SORT_MODE_LABEL[mode]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

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

      {rowCount > 0 && visible.length === 0 ? (
        // Not the empty state. The session holds files; the search is what is
        // standing between the user and them, and saying "no files in this
        // session" here would be a claim about the workspace rather than about
        // the query.
        <div className="empty-state">
          <strong>No files match this search</strong>
          <span>
            {formatCount(rowCount)} {rowCount === 1 ? "file is" : "files are"} in this session.
            Clear the search to see {rowCount === 1 ? "it" : "them"} again.
          </span>
          <button className="secondary-button" onClick={clearSearch} type="button">
            Clear search
          </button>
        </div>
      ) : rowCount === 0 ? (
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
          onBlur={(event) => {
            // Only when the keyboard has genuinely gone somewhere else. A
            // `relatedTarget` outside the list is a user moving on, and what
            // they left behind stops being this component's to recover. A null
            // one is what an unmounting row looks like -- there is nowhere for
            // focus to have gone -- and that is the case the record exists for,
            // so it is kept.
            const next = event.relatedTarget;
            if (next instanceof Node && !event.currentTarget.contains(next)) {
              keyboardOn.current = null;
            }
          }}
          onFocus={(event) => {
            // Recorded as it happens rather than at the next commit. A row can
            // be focused and then unmounted without a render in between, and
            // by the time anything else runs the only evidence of which row
            // held the keyboard has gone with it.
            keyboardOn.current =
              event.target instanceof HTMLElement
                ? (event.target.closest<HTMLElement>("[data-handle]")?.dataset.handle ?? null)
                : null;
          }}
          onKeyDown={handleKeyDown}
          ref={listRef}
          role="listbox"
        >
          {visible.map((dataset) => {
            const selected = state.selected.has(dataset.handle);
            const presentation = rowPresentation(state, dataset.handle);
            const pinned = projection.pinned.get(dataset.handle);
            // Two different things, and never one instead of the other. What a
            // row says about its file -- that it was replaced, is missing, or
            // could not be read -- is not a fact a search may suppress, and it
            // was suppressed while every pinned row rendered its view reason in
            // the one slot both had to share. A row the search did not match
            // says why it is here anyway, in words rather than in a shade, and
            // in the row's own text so a screen reader is told what the screen
            // says.
            const label = ROW_STATE_LABEL[presentation];
            const reason = pinned === undefined ? "" : PIN_REASON_LABEL[pinned];
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
                {/* One track for both, so the name keeps a column of its own.
                    An `auto` grid track takes its max-content width before the
                    name's `1fr` gets any, and a long reason beside a long state
                    could squeeze the name out of a narrow panel entirely. */}
                {label === "" && reason === "" ? null : (
                  <span className="dataset-row-notes">
                    {label === "" ? null : <span className="dataset-row-state">{label}</span>}
                    {/* A separator in the text, not only a gap in the layout.
                        The row's accessible name is its text content run
                        together, and without this a reader hears
                        "Could not be readSelected — outside search". */}
                    {label === "" || reason === "" ? null : (
                      <span className="visually-hidden">, </span>
                    )}
                    {reason === "" ? null : <span className="dataset-row-kept">{reason}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
