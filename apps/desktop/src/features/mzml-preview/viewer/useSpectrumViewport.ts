/**
 * The transport between browser events and the m/z viewport contract.
 *
 * `spectrumViewportReducer` decides every transition. This hook decides none of
 * them. What it adds is the one thing React's own `useReducer` cannot: a
 * *synchronous* answer. A native wheel listener has to tag its debounced settle
 * with the epoch the reducer assigned to the gesture it just started; a drag has
 * to tag every later move with it; and an adapter asking for a drawing has to
 * know which generation the request it just made belongs to. `dispatch` from
 * `useReducer` returns nothing, with the new state arriving a render later.
 *
 * The alternative would be for the adapter to mirror the counters itself, which
 * is exactly the race the epoch and the generation exist to remove. So the
 * reducer keeps allocating, and this returns what it produced.
 *
 * One authority, two readers. The ref is the current state for a handler that
 * runs between renders; the published state is what React draws. **They are not
 * always the same object, and that is this transport's whole job.**
 *
 * ## Why a pointer frame is not published
 *
 * `apps/desktop/AGENTS.md` says to keep pointer-move and cursor-frame data out
 * of React state, and a drag is a stream of them. Publishing each one re-rendered
 * the workspace and the selected-spectrum panel -- the facts list, the precursor
 * list, the export controls -- and recomputed the plot's reduction, once per
 * browser pointer frame, for a change that is one number wide.
 *
 * So every event is *applied* -- the reducer decides all of them, and the ref is
 * always current, which is what an adapter reading an epoch depends on -- and
 * only a transition the rendered surface has to know about is *published*. A
 * gesture starting is published: a gesture now exists, an epoch was allocated,
 * and the caption becomes a transient one. A gesture settling or being cancelled
 * is published. What is not published is the gesture *moving*, which is the frame
 * data itself, and which the adapter draws by moving the sticks it already has.
 *
 * This is `useViewerInteraction.ts` for the other axis, and deliberately a
 * second hook rather than a generic one: the two contracts own different state
 * and different events, and a shared transport would have to be generic over
 * exactly the distinction ADR 0038's brand exists to keep.
 */

import { useCallback, useRef, useState } from "react";

import type { SpectrumViewportEvent, SpectrumViewportState } from "./spectrumViewport";
import { initialSpectrumViewportState, spectrumViewportReducer } from "./spectrumViewport";

export interface SpectrumViewportController {
  /** The state this render draws. */
  readonly state: SpectrumViewportState;
  /**
   * Applies one event and answers with the state it produced.
   *
   * The answer is what an adapter reads a reducer-assigned epoch or generation
   * out of. An event the reducer refuses returns the very state it was given, by
   * identity, so a caller can compare with `===`.
   */
  readonly dispatch: (event: SpectrumViewportEvent) => SpectrumViewportState;
  /** The current state, for a handler that runs between renders. */
  readonly current: () => SpectrumViewportState;
}

/**
 * Whether two states differ only in where a gesture in flight has got to.
 *
 * Compared by reference on every field but the gesture's own range, which is
 * exact rather than approximate: `gesture-moved` is the one transition that
 * rebuilds the gesture and carries every other field through unchanged, so a
 * transition that leaves them all identical *is* a frame and a transition that
 * touches any of them is not. Nothing here needs to know which event was
 * dispatched, which is what keeps this a property of the states rather than a
 * second opinion about the contract's events.
 */
function isGestureFrame(
  previous: SpectrumViewportState,
  next: SpectrumViewportState,
): boolean {
  if (previous.status !== "ready" || next.status !== "ready") {
    return false;
  }
  if (previous.gesture === null || next.gesture === null) {
    return false;
  }
  return (
    previous.gesture.epoch === next.gesture.epoch &&
    previous.spectrumToken === next.spectrumToken &&
    previous.full === next.full &&
    previous.committed === next.committed &&
    previous.projection === next.projection &&
    previous.nextEpoch === next.nextEpoch &&
    previous.nextGeneration === next.nextGeneration
  );
}

export function useSpectrumViewport(): SpectrumViewportController {
  const [state, setState] = useState<SpectrumViewportState>(initialSpectrumViewportState);
  const held = useRef<SpectrumViewportState>(initialSpectrumViewportState);

  const dispatch = useCallback((event: SpectrumViewportEvent): SpectrumViewportState => {
    const previous = held.current;
    const next = spectrumViewportReducer(previous, event);
    // An identity no-op publishes nothing. That is what lets a settle whose
    // epoch has been superseded, or an answer whose generation has, cost a
    // comparison rather than a render.
    if (next === previous) {
      return next;
    }
    // Applied always: the reducer decides every transition and the ref is what
    // an adapter reads its epoch and its live range out of between renders.
    held.current = next;
    // Published only where the rendered surface has to change. A gesture frame
    // is drawn by moving the sticks that are already on screen.
    if (!isGestureFrame(previous, next)) {
      setState(next);
    }
    return next;
  }, []);

  const current = useCallback(() => held.current, []);

  return { state, dispatch, current };
}
