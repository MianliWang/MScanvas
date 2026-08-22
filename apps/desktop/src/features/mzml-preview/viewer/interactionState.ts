/**
 * Layers B, C, D and E — one state machine over the viewer's interaction.
 *
 * PR #72 built these as separate React effects that each answered a slightly
 * different question about the same situation, and bounded review found a real,
 * reachable defect at almost every seam: a reveal suppressed because a roving
 * tab stop was mistaken for visibility; a repeated selection invisible to a
 * consumer watching a value instead of an event; one linked view consuming a
 * commit and the other not; a pending wheel debounce overwriting a selection's
 * reveal. Those are not four unrelated bugs. They are what happens when
 * ownership and precedence are implicit.
 *
 * So they are explicit here, in one reducer, with no React, no DOM, no timers
 * and no browser globals. A timer is an adapter: it eventually emits
 * `gesture-settled`, and whether that event still means anything is this
 * reducer's decision rather than a race between `clearTimeout` and a callback.
 */

import type { RetentionTimeDomain } from "./scanModel";
import { clampDomain, isFullDomain, revealDomain } from "./viewport";

/**
 * A gesture in progress: a wheel zoom or a drag pan that has not settled.
 *
 * Its `epoch` is what makes a late callback answerable. Every scheduled settle
 * belongs to one epoch, and an epoch that has been cancelled, superseded or
 * invalidated by a new preview can never commit anything afterwards.
 */
export interface ActiveGesture {
  readonly epoch: number;
  readonly domain: RetentionTimeDomain;
}

/** The one persistent selection, and the commit that produced it. */
export interface Selection {
  readonly index: number;
  /**
   * Monotonic across the session, and never derived from the index.
   *
   * Selecting the scan that is already selected is a new commit -- the user
   * asked for that scan again -- and a consumer watching the index cannot tell
   * that happened. Both linked views watch this instead.
   *
   * Assigned here, like a gesture epoch, and for the same reason. Several
   * producers commit selections -- the plot, the scan table, Previous and Next
   * -- and if each supplied a number they could reuse one, or a preview change
   * could reset it. A consumer that had already bookmarked that value would
   * then treat a real, different selection as one it had acted on, and silently
   * not reveal: the defect this contract exists to make unrepresentable,
   * reintroduced through the door the contract left open.
   */
  readonly revision: number;
  readonly retentionTime: number;
}

/**
 * Transient coordinate inspection: which scan the pointer is over.
 *
 * The resolved scan, and nothing else. Not a scaled screen coordinate -- PR #72
 * stored the scaled x, which a keyboard zoom invalidated without clearing,
 * leaving a guide rule at a stale position and a readout naming a scan no longer
 * under the cursor. And not the pointer's own retention time either, for a
 * second reason: the readout names a scan and the guide rule is drawn at that
 * scan's position, so the pointer's exact coordinate is never displayed, and
 * carrying it here would make every frame of a pointer move a different state.
 *
 * Because a scan is all this holds, re-establishing the same one is a no-op by
 * identity. A renderer may therefore resolve the nearest scan on every pointer
 * frame and dispatch freely: the state changes only when the pointer crosses
 * from one scan to another, which is bounded by the run rather than by the
 * pointer's sampling rate. Continuous cursor coordinates stay in the renderer,
 * where `apps/desktop/AGENTS.md` requires them to stay.
 */
export interface Hover {
  readonly spectrumIndex: number;
}

export interface ViewerInteractionState {
  /** The loaded run's full retention-time domain, or `null` while none is. */
  readonly fullDomain: RetentionTimeDomain | null;
  /**
   * The committed viewport. `null` means the whole run.
   *
   * This is the semantic answer to "what range is the user looking at", and the
   * authority a current-range export may later consume. A gesture in progress
   * is deliberately not part of it.
   */
  readonly committedDomain: RetentionTimeDomain | null;
  readonly gesture: ActiveGesture | null;
  readonly selection: Selection | null;
  readonly hover: Hover | null;
  /** The epoch the next gesture will be given. Monotonic, never reused. */
  readonly nextGestureEpoch: number;
  /** The revision the next selection commit will be given. Never reused. */
  readonly nextSelectionRevision: number;
}

export const initialViewerInteractionState: ViewerInteractionState = {
  fullDomain: null,
  committedDomain: null,
  gesture: null,
  selection: null,
  hover: null,
  nextGestureEpoch: 1,
  nextSelectionRevision: 1,
};

export type ViewerEvent =
  | { readonly type: "preview-loaded"; readonly fullDomain: RetentionTimeDomain }
  | { readonly type: "preview-closed" }
  /**
   * A gesture begins. The reducer assigns its epoch; the adapter reads it back
   * from `state.gesture` and tags every later event for that gesture with it.
   *
   * Deliberately not supplied by the caller. Two adapters allocating from one
   * counter is exactly the race an epoch exists to remove, and a caller that
   * guesses an epoch can address a gesture that is not its own.
   */
  | { readonly type: "gesture-started"; readonly domain: RetentionTimeDomain }
  | { readonly type: "gesture-moved"; readonly epoch: number; readonly domain: RetentionTimeDomain }
  | { readonly type: "gesture-settled"; readonly epoch: number }
  | { readonly type: "gesture-cancelled"; readonly epoch: number }
  /** A keyboard step or a button: committed immediately, with no gesture. */
  | { readonly type: "viewport-step"; readonly domain: RetentionTimeDomain }
  | { readonly type: "viewport-reset" }
  /**
   * A persistent selection commit.
   *
   * No revision: the reducer assigns it. Producers say *what* was selected, and
   * the one thing that can tell two commits apart is not theirs to invent.
   */
  | {
      readonly type: "selection-committed";
      readonly index: number;
      readonly retentionTime: number;
    }
  /** The pointer is over this scan. Dispatch freely; see {@link Hover}. */
  | { readonly type: "hover-established"; readonly spectrumIndex: number }
  | { readonly type: "hover-cleared" };

/**
 * The interaction reducer.
 *
 * Total and deterministic: every event produces a state, and an event that no
 * longer applies produces the state it was given, unchanged by identity.
 */
export function viewerInteractionReducer(
  state: ViewerInteractionState,
  event: ViewerEvent,
): ViewerInteractionState {
  switch (event.type) {
    case "preview-loaded":
      // Everything belongs to the preview that was on screen. A range chosen in
      // one run means nothing in another, and a settle still in flight from the
      // previous one must not be able to commit into this one -- which the
      // epoch advance below guarantees without depending on a timer being
      // cleared in time.
      //
      // Both counters carry across rather than restarting. A consumer's
      // bookmark may outlive the preview it was made under, and a restarted
      // counter would let a new commit collide with it.
      return {
        fullDomain: event.fullDomain,
        committedDomain: null,
        gesture: null,
        selection: null,
        hover: null,
        nextGestureEpoch: state.nextGestureEpoch + 1,
        nextSelectionRevision: state.nextSelectionRevision,
      };

    case "preview-closed":
      return {
        fullDomain: null,
        committedDomain: null,
        gesture: null,
        selection: null,
        hover: null,
        nextGestureEpoch: state.nextGestureEpoch + 1,
        nextSelectionRevision: state.nextSelectionRevision,
      };

    case "gesture-started": {
      const full = state.fullDomain;
      if (full === null) {
        return state;
      }
      return {
        ...state,
        gesture: { epoch: state.nextGestureEpoch, domain: clampDomain(event.domain, full) },
        nextGestureEpoch: state.nextGestureEpoch + 1,
        // A gesture beginning ends inspection: the user has stopped pointing at
        // a scan and started moving the axis.
        hover: null,
      };
    }

    case "gesture-moved": {
      const full = state.fullDomain;
      if (full === null || state.gesture === null || state.gesture.epoch !== event.epoch) {
        return state;
      }
      return {
        ...state,
        gesture: { epoch: event.epoch, domain: clampDomain(event.domain, full) },
      };
    }

    case "gesture-settled": {
      const full = state.fullDomain;
      // A settle from an epoch that is no longer active is a no-op, and it is
      // one *by identity*: the caller receives the very state it passed in.
      // Correctness here may not rest on `clearTimeout` winning a race.
      if (full === null || state.gesture === null || state.gesture.epoch !== event.epoch) {
        return state;
      }
      return {
        ...state,
        committedDomain: committed(state.gesture.domain, full),
        gesture: null,
        hover: null,
      };
    }

    case "gesture-cancelled":
      if (state.gesture === null || state.gesture.epoch !== event.epoch) {
        return state;
      }
      // Abandoned rather than committed: what the user was in the middle of
      // doing is discarded, and the committed viewport is untouched.
      return { ...state, gesture: null };

    case "viewport-step": {
      const full = state.fullDomain;
      if (full === null) {
        return state;
      }
      // A keyboard step or a button supersedes anything in flight, for the same
      // reason a selection does: it is a later, deliberate instruction about
      // the same viewport.
      return {
        ...state,
        committedDomain: committed(event.domain, full),
        gesture: null,
        hover: null,
      };
    }

    case "viewport-reset": {
      if (state.fullDomain === null) {
        return state;
      }
      return { ...state, committedDomain: null, gesture: null, hover: null };
    }

    case "selection-committed": {
      const selection: Selection = {
        index: event.index,
        revision: state.nextSelectionRevision,
        retentionTime: event.retentionTime,
      };
      const nextSelectionRevision = state.nextSelectionRevision + 1;
      const full = state.fullDomain;
      if (full === null) {
        return { ...state, selection, nextSelectionRevision, gesture: null, hover: null };
      }
      // Precedence, in order, and the order is the contract:
      //
      // 1. the gesture stops being authoritative. It is dropped here rather
      //    than left to settle later, so its pending settle becomes a stale
      //    epoch and can no longer overwrite what follows;
      // 2. the reveal is computed against the *committed* viewport, which is
      //    now the only viewport there is;
      // 3. hover is cleared, because the axis may have just moved under it.
      const base = state.committedDomain;
      const revealed = base === null ? null : revealDomain(base, full, event.retentionTime);
      return {
        ...state,
        selection,
        nextSelectionRevision,
        gesture: null,
        hover: null,
        committedDomain: revealed === null ? null : committed(revealed, full),
      };
    }

    case "hover-established": {
      if (state.fullDomain === null) {
        return state;
      }
      // The same scan is the same state. Returned by identity so a renderer can
      // dispatch on every pointer frame without any consumer re-rendering: what
      // reaches this contract is "the pointer crossed into another scan", not
      // "the pointer moved".
      if (state.hover?.spectrumIndex === event.spectrumIndex) {
        return state;
      }
      return { ...state, hover: { spectrumIndex: event.spectrumIndex } };
    }

    case "hover-cleared":
      return state.hover === null ? state : { ...state, hover: null };
  }
}

/** The committed form of a domain: clamped, and `null` when it is the run. */
function committed(
  domain: RetentionTimeDomain,
  full: RetentionTimeDomain,
): RetentionTimeDomain | null {
  const clamped = clampDomain(domain, full);
  return isFullDomain(clamped, full) ? null : clamped;
}

/**
 * The viewport a renderer should draw right now.
 *
 * The gesture when one is in progress, the committed range otherwise, the whole
 * run when neither. Readers ask this rather than choosing between the fields
 * themselves, which is how the two came to disagree in PR #72.
 */
export function renderedDomain(state: ViewerInteractionState): RetentionTimeDomain | null {
  if (state.gesture !== null) {
    return state.gesture.domain;
  }
  if (state.committedDomain !== null) {
    return state.committedDomain;
  }
  return state.fullDomain;
}

/** The epoch a gesture adapter should tag its events with, if one is active. */
export function activeGestureEpoch(state: ViewerInteractionState): number | null {
  return state.gesture?.epoch ?? null;
}

/**
 * What a linked view has already acted on.
 *
 * Each persistent consumer keeps one of these. There is exactly one
 * `selectionRevision` in the state; this is a consumer's bookmark into it, not
 * a second selection.
 */
export interface SelectionConsumer {
  readonly lastConsumedRevision: number | null;
}

export const initialSelectionConsumer: SelectionConsumer = { lastConsumedRevision: null };

/**
 * Whether this consumer should act on the current selection, and its next
 * bookmark.
 *
 * The rule, and every case review found the old code getting wrong:
 *
 * - a new revision is acted on, **including** one that selects the scan already
 *   selected. That is a commit, and the row or the marker may have been
 *   scrolled or panned away since the last one;
 * - the same revision is never acted on twice, however many renders, viewport
 *   changes or gesture domains arrive in between. That is what keeps a pan the
 *   user makes from being undone;
 * - no selection at all resets the bookmark, so the next commit is fresh.
 */
export function consumeSelection(
  consumer: SelectionConsumer,
  selection: Selection | null,
): { readonly consumer: SelectionConsumer; readonly consumed: Selection | null } {
  if (selection === null) {
    return {
      consumer: consumer.lastConsumedRevision === null ? consumer : initialSelectionConsumer,
      consumed: null,
    };
  }
  if (consumer.lastConsumedRevision === selection.revision) {
    return { consumer, consumed: null };
  }
  return { consumer: { lastConsumedRevision: selection.revision }, consumed: selection };
}
