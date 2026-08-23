/**
 * The transport between browser events and the accepted interaction contract.
 *
 * `viewerInteractionReducer` decides every transition. This hook decides none
 * of them. What it adds is one thing React's own `useReducer` cannot: a
 * *synchronous* answer. A native wheel listener has to tag its debounced settle
 * with the epoch the reducer assigned to the gesture it just started, and a
 * drag has to tag every later move with it -- and `dispatch` from `useReducer`
 * returns nothing, with the new state arriving a render later.
 *
 * The alternative would be for the adapter to mirror the counter itself, which
 * is exactly the race an epoch exists to remove. So the reducer keeps
 * allocating, and this returns what it produced.
 *
 * One authority, published twice. The ref is the current state for a handler
 * that runs between renders; the state is the same object for the render. They
 * are written together, in that order, so nothing can read a value the other
 * has not seen -- `useViewerInteraction.test.tsx` holds that as an assertion
 * rather than as a comment.
 */

import { useCallback, useRef, useState } from "react";

import type { ViewerEvent, ViewerInteractionState } from "./interactionState";
import { initialViewerInteractionState, viewerInteractionReducer } from "./interactionState";

export interface ViewerInteractionController {
  /** The state this render draws. */
  readonly state: ViewerInteractionState;
  /**
   * Applies one event and answers with the state it produced.
   *
   * The answer is what an adapter reads a reducer-assigned epoch out of. An
   * event the reducer refuses returns the very state it was given, by identity,
   * so a caller can compare with `===`.
   */
  readonly dispatch: (event: ViewerEvent) => ViewerInteractionState;
  /** The current state, for a handler that runs between renders. */
  readonly current: () => ViewerInteractionState;
}

export function useViewerInteraction(): ViewerInteractionController {
  const [state, setState] = useState<ViewerInteractionState>(initialViewerInteractionState);
  const held = useRef<ViewerInteractionState>(initialViewerInteractionState);

  const dispatch = useCallback((event: ViewerEvent): ViewerInteractionState => {
    const next = viewerInteractionReducer(held.current, event);
    // An identity no-op publishes nothing. That is what lets a renderer resolve
    // the nearest scan on every pointer frame and dispatch freely: the pointer
    // crossing into another scan is a state change, and the pointer moving is
    // not.
    if (next !== held.current) {
      held.current = next;
      setState(next);
    }
    return next;
  }, []);

  const current = useCallback(() => held.current, []);

  return { state, dispatch, current };
}
