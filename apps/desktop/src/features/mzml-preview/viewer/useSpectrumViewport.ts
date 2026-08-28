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
 * One authority, published twice. The ref is the current state for a handler
 * that runs between renders; the state is the same object for the render. They
 * are written together, in that order, so nothing can read a value the other has
 * not seen.
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

export function useSpectrumViewport(): SpectrumViewportController {
  const [state, setState] = useState<SpectrumViewportState>(initialSpectrumViewportState);
  const held = useRef<SpectrumViewportState>(initialSpectrumViewportState);

  const dispatch = useCallback((event: SpectrumViewportEvent): SpectrumViewportState => {
    const next = spectrumViewportReducer(held.current, event);
    // An identity no-op publishes nothing. That is what lets a settle whose
    // epoch has been superseded, or an answer whose generation has, cost a
    // comparison rather than a render.
    if (next !== held.current) {
      held.current = next;
      setState(next);
    }
    return next;
  }, []);

  const current = useCallback(() => held.current, []);

  return { state, dispatch, current };
}
