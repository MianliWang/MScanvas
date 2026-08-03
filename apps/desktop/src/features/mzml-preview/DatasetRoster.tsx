import { useCallback, useEffect, useRef } from "react";
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
  readonly onAddFolder: () => void;
  readonly onRemoveSelected: () => void;
  /** Starts Clear and reports whether this activation acquired the mutation gate. */
  readonly onClearList: () => boolean;
  readonly onActivate: (handle: string) => void;
  /**
   * Whether the picker may be opened. Curating a workspace does not need a
   * backend, so this is not about ProteoWizard being installed.
   */
  readonly canAddFiles: boolean;
  /** The same question for the folder picker, which waits on the same things. */
  readonly canAddFolder: boolean;
  /**
   * Whether a folder import is running, which is what the folder action says
   * about itself while it is.
   *
   * Separate from `canAddFolder` because the two answer different questions:
   * one is why the action is refused, which is often another operation
   * entirely, and this one is whether the operation being waited on is this
   * one.
   */
  readonly folderBusy: boolean;
  /** Whether a native Explorer drop is still being inspected. */
  readonly dropBusy: boolean;
  /** Whether an explicit preview may be started right now. */
  readonly canPreview: boolean;
  /**
   * Whether rows may be removed or the list emptied right now.
   *
   * Deliberately true during a folder import. A successful `Clear list` is the
   * reliable way out of one, while `Remove selected` still has to manage the
   * rows already on screen; an import has no cancellation.
   */
  readonly canMutate: boolean;
  /**
   * Whether the list may be read back right now.
   *
   * Its own answer rather than `canMutate`, because it is not an escape route.
   * Rust returns a pure, gate-linearized snapshot, but during an import that
   * snapshot's usefulness depends on whether commit happened before or after
   * it. The folder reply or reconciliation already supplies the authoritative
   * answer without adding another loading state.
   */
  readonly canReloadRoster: boolean;
  /**
   * Increments only when an authoritative roster answer reaches this window.
   * Removal focus recovery waits for this edge because a rejected request can
   * become idle before its reconciliation read has answered.
   */
  readonly rosterSettlementToken: number;
  /** Increments when focus should return to the `Add files…` action. */
  readonly focusAddFilesToken: number;
  /**
   * Increments when a focused transient folder-error action should return to
   * the durable `Add mzML folder…` action, immediately or after a retry settles.
   */
  readonly restoreAddFolderFocusToken: number;
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

const CLEAR_DURING_FOLDER_IMPORT_DESCRIPTION =
  "Clear list also prevents the pending folder import from adding files.";
const CLEAR_DURING_DROP_IMPORT_DESCRIPTION =
  "Clear list also prevents the pending drop from adding files.";

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
  onAddFolder,
  onRemoveSelected,
  onClearList,
  onActivate,
  canAddFiles,
  canAddFolder,
  folderBusy,
  dropBusy,
  canPreview,
  canMutate,
  canReloadRoster,
  rosterSettlementToken,
  focusAddFilesToken,
  restoreAddFolderFocusToken,
}: DatasetRosterProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const addFilesRef = useRef<HTMLButtonElement | null>(null);
  const addFolderRef = useRef<HTMLButtonElement | null>(null);
  const removeSelectedRef = useRef<HTMLButtonElement | null>(null);
  const clearListRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  /** Advances whenever a real control becomes the keyboard's newer destination. */
  const focusOwnershipToken = useRef(0);
  const seenFocusToken = useRef(focusAddFilesToken);
  const seenRestoreAddFolderFocusToken = useRef(restoreAddFolderFocusToken);
  /** Whether the keyboard is still owed to `Add files…` from an emptied list. */
  const focusAddFilesOwed = useRef(false);
  /**
   * Whether the keyboard is on `Clear list`, which can go out from under it.
   *
   * A boolean rather than an element: the question is only ever "was the
   * keyboard here when this disappeared". WebView2 can report that removal as
   * a `focusout` whose destination is null, which does not prove the user went
   * anywhere; only a real destination clears the record.
   */
  const keyboardOnClearList = useRef(false);
  /**
   * Which acquisition action the keyboard has to be given back to, if any.
   *
   * One slot for both, because the two are mutually exclusive: neither picker
   * can be opened while the other's request is unresolved, so there is never
   * more than one restoration outstanding. Holding the element rather than a
   * name is what lets the restoration ask the only questions that matter --
   * is this control still in the document, and is it usable again.
   */
  const pendingPickerRestore = useRef<HTMLButtonElement | null>(null);
  const pickerRestoreOutstanding = useRef(false);
  /**
   * A focused `Remove selected` action that the request disabled.
   *
   * Successful removal returns to the row the reducer chose beside the gap;
   * an answer that removed none of the requested handles returns to the action
   * itself. The requested handles distinguish those outcomes without asking
   * this view to infer a backend result. The debt is armed only after the
   * disabled commit is seen, so an activation that started no request cannot
   * move the keyboard later.
   */
  const removeFocusDebt = useRef<{
    readonly requestedHandles: readonly string[];
    readonly rosterSettlementToken: number;
    sawDisabled: boolean;
  } | null>(null);
  /**
   * A focused `Clear list` action whose failed request still owes a roster read.
   *
   * During a first folder import the action can move seamlessly from being the
   * escape for an unresolved import to managing rows found by reconciliation.
   * Its presence alone therefore cannot say the request settled. The callback
   * reports that this activation acquired the mutation gate; the roster token
   * proves Rust has since supplied the authoritative destination.
   */
  const clearFocusDebt = useRef<{
    focusOwnershipToken: number;
    readonly rosterSettlementToken: number;
  } | null>(null);
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
   * Whether `Clear list` has anything to do, which is when it is offered.
   *
   * Over rows it empties them. Over an empty list it is offered only while a
   * folder import is unresolved, because there it is the escape from one. If it
   * wins the gate it supersedes the import; if the import committed first it
   * clears the rows that arrived. With neither, it would be a control that
   * cannot act.
   */
  const clearListOffered = state.datasets.length > 0 || folderBusy || dropBusy;

  useEffect(() => {
    const recordDestination = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body) {
        focusOwnershipToken.current += 1;
        if (event.target === clearListRef.current && clearFocusDebt.current !== null) {
          // Returning to the same re-enabled action renews its ownership. A
          // different destination still leaves a mismatch that permanently
          // cancels this debt, even if that destination later disappears.
          clearFocusDebt.current.focusOwnershipToken = focusOwnershipToken.current;
        }
      }
    };
    document.addEventListener("focusin", recordDestination);
    return () => {
      document.removeEventListener("focusin", recordDestination);
    };
  }, []);

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
   * and an unmounting element takes focus to the body, with `contains` no
   * longer true of anything. It may report a `focusout` whose destination is
   * null first; that is still disappearance rather than a user-chosen
   * destination. The row that took its place if there is one, the search box if
   * there is not, the body never.
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
   * Pays the focus debt created when removal disables its own focused action.
   *
   * WebView2 moves focus from a disabled button to `body`. When rows changed,
   * the reducer has already reconciled `state.focused` against the exact
   * projection the user was looking at, so its row is the durable destination.
   * If Rust changed nothing, the re-enabled action is the destination instead.
   * A destination the user chose while the request was running always wins.
   * Empty-workspace restoration remains the existing `Add files…` debt.
   */
  useEffect(() => {
    const debt = removeFocusDebt.current;
    if (debt === null) {
      return;
    }
    if (!canMutate) {
      debt.sawDisabled = true;
      return;
    }
    if (!debt.sawDisabled) {
      return;
    }
    if (rosterSettlementToken === debt.rosterSettlementToken) {
      return;
    }
    removeFocusDebt.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    const live = new Set(state.datasets.map((dataset) => dataset.handle));
    const removed = debt.requestedHandles.some((handle) => !live.has(handle));
    if (!removed) {
      const control = removeSelectedRef.current;
      if (control !== null && !control.disabled) {
        control.focus({ preventScroll: true });
      }
      return;
    }
    if (state.datasets.length === 0) {
      return;
    }
    const row =
      state.focused === null
        ? null
        : (listRef.current?.querySelector<HTMLElement>(
            `[data-handle="${state.focused}"]`,
          ) ?? null);
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
   *
   * The debt outlives the commit that incurred it, because the row that had the
   * keyboard can go while `Add files…` is disabled: emptying the list is the
   * reliable way out of a folder import, and acquiring more waits for that
   * import to settle. Focusing a disabled control does nothing, so without this
   * the keyboard would be left on `body` with no way back into the workspace --
   * the defect issue #25 exists for, reached by a route that only opened when
   * clearing became available during discovery.
   */
  const payAddFilesDebt = useCallback(() => {
    if (!focusAddFilesOwed.current) {
      return;
    }
    const control = addFilesRef.current;
    if (control === null || control.disabled) {
      // Still owed. Focusing a disabled control does nothing, so the debt is
      // held rather than paid into nowhere.
      return;
    }
    // Never over a control the user has since chosen for themselves. The row
    // that held the keyboard has gone, so focus is on the body until something
    // else claims it.
    const active = document.activeElement;
    focusAddFilesOwed.current = false;
    if (active === null || active === document.body) {
      control.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (focusAddFilesToken === seenFocusToken.current) {
      return;
    }
    seenFocusToken.current = focusAddFilesToken;
    focusAddFilesOwed.current = true;
    payAddFilesDebt();
  }, [focusAddFilesToken, payAddFilesDebt]);

  // The other half, keyed on the one thing that can pay an outstanding debt.
  // Deliberately not a per-commit effect: this component renders a thousand
  // rows, and work that runs after every one of them for a debt that is almost
  // never outstanding is a cost paid a thousand times for nothing.
  useEffect(() => {
    payAddFilesDebt();
  }, [canAddFiles, payAddFilesDebt]);

  /**
   * Pays the focus debt created when Clear disables its focused action.
   *
   * A rejected Clear request cannot be reconciled against the roster still on
   * screen: Rust may have changed it before the reply was lost, and an older
   * folder reply is deliberately hidden. Wait for that import to finish and
   * for a newer authoritative roster token. Rows return to the re-enabled
   * Clear action; an authoritative empty roster returns to Add files.
   */
  useEffect(() => {
    const debt = clearFocusDebt.current;
    if (debt === null) {
      return;
    }
    if (
      !canMutate ||
      folderBusy ||
      dropBusy ||
      rosterSettlementToken === debt.rosterSettlementToken
    ) {
      return;
    }
    if (focusOwnershipToken.current !== debt.focusOwnershipToken) {
      clearFocusDebt.current = null;
      keyboardOnClearList.current = false;
      return;
    }
    clearFocusDebt.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      keyboardOnClearList.current = false;
      return;
    }
    const control = clearListRef.current;
    if (control !== null && control.isConnected && !control.disabled) {
      control.focus({ preventScroll: true });
      return;
    }
    keyboardOnClearList.current = false;
    focusAddFilesOwed.current = true;
    payAddFilesDebt();
  }, [canMutate, dropBusy, folderBusy, payAddFilesDebt, rosterSettlementToken]);

  /**
   * Catches the keyboard when `Clear list` goes out from under it.
   *
   * That action exists over an empty list only while a folder import is
   * unresolved -- it is the escape from one -- and during a first import from
   * an empty workspace it is the only enabled control in the row, so it is
   * exactly where a keyboard user lands. Every way the import can settle with
   * nothing added takes it away again: a folder holding no mzML, a scan that
   * failed, an import a decision superseded, a dismissed picker.
   *
   * Removing a focused element moves focus to the body. WebView2 can first
   * report a `focusout` whose destination is null, which is not evidence that
   * the user chose somewhere else. Nothing else here would recover it: the row
   * rescue wants a row handle, while acquisition-picker restoration belongs to
   * the acquisition action that started the request. So this debt is minted
   * here and paid by the same machinery an emptied list uses, which already
   * waits for `Add files…` to become usable.
   */
  useEffect(() => {
    if (
      clearFocusDebt.current !== null ||
      clearListOffered ||
      !keyboardOnClearList.current
    ) {
      return;
    }
    keyboardOnClearList.current = false;
    focusAddFilesOwed.current = true;
    payAddFilesDebt();
  }, [clearListOffered, payAddFilesDebt]);

  /**
   * Starts an acquisition action, remembering where the keyboard was.
   *
   * Only what actually held the keyboard is remembered. A press that did not
   * focus the button has no place to return to, and taking focus the user never
   * put here would be a move of its own rather than a restoration.
   *
   * Shared by both pickers, and each restores to its own control: the element
   * pressed is the element remembered, so `Add mzML folder…` can never hand the
   * keyboard back to `Add files…` because it happened to run second.
   */
  const startPicking = (event: MouseEvent<HTMLButtonElement>, run: () => void) => {
    const control = event.currentTarget;
    const ownsKeyboard = document.activeElement === control;
    pendingPickerRestore.current = ownsKeyboard ? control : null;
    pickerRestoreOutstanding.current = false;
    if (ownsKeyboard) {
      // This picker is a later destination chosen while an older mutation may
      // still be waiting for reconciliation. Its own disabled lifetime can
      // move focus to `body`, but that must not revive either older action.
      removeFocusDebt.current = null;
      clearFocusDebt.current = null;
      keyboardOnClearList.current = false;
    }
    run();
  };

  /**
   * Carries keyboard ownership from a transient folder-error action to the
   * durable folder action before the notice disappears.
   *
   * The token is minted only when `Choose another folder` or its adjacent
   * `Dismiss` action held focus. A retry has already disabled the destination
   * by the time this effect runs; a dismissal may pay immediately while it is
   * still enabled. Marking the restoration outstanding explicitly covers both,
   * including a dismissed picker whose promise settles before an intermediate
   * disabled commit can be observed.
   */
  useEffect(() => {
    if (restoreAddFolderFocusToken === seenRestoreAddFolderFocusToken.current) {
      return;
    }
    seenRestoreAddFolderFocusToken.current = restoreAddFolderFocusToken;
    const control = addFolderRef.current;
    if (control === null) {
      return;
    }
    pendingPickerRestore.current = control;
    pickerRestoreOutstanding.current = true;
  }, [restoreAddFolderFocusToken]);

  /**
   * Returns the keyboard to the durable acquisition action when it is usable.
   *
   * A picker action is disabled for the whole request -- the modal lifetime,
   * and for a folder the scan and commit after it -- and disabling the focused
   * button is what blurs it. A transient folder-error action instead disappears
   * immediately. The browser puts neither back, so both paths carry an explicit
   * destination rather than leaving a keyboard user outside the workflow.
   *
   * Asked of the control itself rather than of a `canAdd…` prop. Both are true
   * of one operation and false of the other's, so a shared boolean would
   * restore the folder button the moment a file picker closed; and a request
   * begins and ends with the prop true, so an effect comparing that value
   * alone would not run again if the two renders were ever batched into one.
   * Running after every commit costs a null check, and what makes a settle a
   * settle is stated here instead.
   */
  useEffect(() => {
    const control = pendingPickerRestore.current;
    if (control === null) {
      return;
    }
    if (control.disabled) {
      // Outstanding, so nothing is restored yet -- and having seen it is what
      // tells the end of this request from an effect queued before it began.
      pickerRestoreOutstanding.current = true;
      return;
    }
    if (!pickerRestoreOutstanding.current) {
      return;
    }
    // Ready now: either an immediate dismissal or a request that settled.
    // Held any longer it could fire on a later interaction it says nothing about.
    pendingPickerRestore.current = null;
    pickerRestoreOutstanding.current = false;
    if (!control.isConnected) {
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
    // Marked busy for the whole import, because this is the region the import
    // is about to change. It says the list is not settled without claiming to
    // know which half of the operation is running.
    <section
      aria-busy={folderBusy || dropBusy}
      aria-labelledby="dataset-roster-heading"
      className="panel dataset-roster-panel"
    >
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
          onClick={(event) => {
            startPicking(event, onAddFiles);
          }}
          ref={addFilesRef}
          type="button"
        >
          Add files…
        </button>
        {/* Beside `Add files…` rather than anywhere else, because it answers
            the same question with a different unit of choice: this file, or
            everything under this folder. Its label says what it takes -- mzML
            files -- because a folder of a vendor acquisition is not something
            this version can read, and an action called "Add folder" would
            promise otherwise. */}
        {/* The name never changes. An action's accessible identity is how a
            user finds it again, and `Scanning folder…` was both a different
            identity and a false one: the flag is set before the native dialog
            opens, so for as long as the user spends navigating it -- or if they
            cancel -- nothing was being scanned at all. What is running is said
            once, by the shell, in words true of both phases. */}
        <button
          aria-busy={folderBusy}
          className="secondary-button"
          disabled={!canAddFolder}
          onClick={(event) => {
            startPicking(event, onAddFolder);
          }}
          ref={addFolderRef}
          type="button"
        >
          Add mzML folder…
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
          onClick={(event) => {
            const control = event.currentTarget;
            const ownsKeyboard = document.activeElement === control;
            removeFocusDebt.current =
              ownsKeyboard
                ? {
                    requestedHandles: [...state.selected],
                    rosterSettlementToken,
                    sawDisabled: false,
                  }
                : null;
            if (ownsKeyboard) {
              clearFocusDebt.current = null;
              keyboardOnClearList.current = false;
            }
            onRemoveSelected();
          }}
          ref={removeSelectedRef}
          type="button"
        >
          Remove selected
        </button>
        {clearListOffered ? (
          <button
            aria-describedby={
              [
                folderBusy ? "clear-during-folder-import-description" : null,
                dropBusy ? "clear-during-drop-import-description" : null,
              ]
                .filter((value): value is string => value !== null)
                .join(" ") || undefined
            }
            className="secondary-button"
            disabled={!canMutate}
            onBlur={(event) => {
              if (event.relatedTarget instanceof Node) {
                keyboardOnClearList.current = false;
                clearFocusDebt.current = null;
              }
            }}
            onFocus={() => {
              keyboardOnClearList.current = true;
            }}
            onClick={(event) => {
              const ownsKeyboard = document.activeElement === event.currentTarget;
              const started = onClearList();
              clearFocusDebt.current = ownsKeyboard && started
                ? {
                    focusOwnershipToken: focusOwnershipToken.current,
                    rosterSettlementToken,
                  }
                : null;
              if (ownsKeyboard && started) {
                removeFocusDebt.current = null;
              }
            }}
            ref={clearListRef}
            type="button"
          >
            Clear list
          </button>
        ) : null}
        {folderBusy ? (
          <span className="visually-hidden" id="clear-during-folder-import-description">
            {CLEAR_DURING_FOLDER_IMPORT_DESCRIPTION}
          </span>
        ) : null}
        {dropBusy ? (
          <span className="visually-hidden" id="clear-during-drop-import-description">
            {CLEAR_DURING_DROP_IMPORT_DESCRIPTION}
          </span>
        ) : null}
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
              {/* Refused while a mutation or an import is unresolved, exactly
                  as the shell's copy of this action is. Rust returns a pure,
                  gate-linearized snapshot; native page-load start owns reload
                  ordering. During an import the folder reply or reconciliation
                  already supplies the authoritative answer, without another
                  loading state whose usefulness depends on commit order. */}
              <button
                className="secondary-button"
                disabled={!canReloadRoster}
                onClick={onReloadRoster}
                type="button"
              >
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
                Add one or many local .mzML files, or a folder to take every .mzML file under it.
                MSCanvas only reads them, nothing is uploaded, and nothing leaves this computer.
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
                {/* The name, and only where two rows share one, where it sat
                    under the folder it came from. Rust decides that over the
                    whole live roster and bounds what it says, so this renders
                    the string it was given and derives nothing: a context that
                    appeared because a second `sample.mzML` arrived goes again
                    when that row leaves, without this component being told.

                    Inside the name's own cell rather than in a track of its
                    own, so the row keeps the columns it has and the name keeps
                    the floor it was given. */}
                <span className="dataset-row-label">
                  <span className="dataset-row-name" title={dataset.fileName}>
                    {dataset.fileName}
                  </span>
                  {dataset.relativeContext === null ? null : (
                    <>
                      {/* A separator in the text, not only a gap in the
                          layout: the option's accessible name is its text run
                          together, and without this a reader hears
                          "sample.mzMLbatch-2". */}
                      <span className="visually-hidden">, </span>
                      <span className="dataset-row-context" title={dataset.relativeContext}>
                        {dataset.relativeContext}
                      </span>
                    </>
                  )}
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
