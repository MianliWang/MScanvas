/**
 * What one press of a visible viewport control would do.
 *
 * A button that is enabled is a claim, and the claim it makes is that pressing
 * it does something. `Zoom out` at full range made that claim and did nothing,
 * for the state the viewer opens in; so did both zoom controls for a run of a
 * single scan, whose retention-time span is zero. Beside them `Reset range`
 * computed its own disabled state and told the truth, which is what made the
 * group inconsistent rather than merely quiet.
 *
 * The repair is not a list of boundaries. It is one rule:
 *
 *   **a visible viewport action is available exactly when applying it would
 *   change the effective rendered domain.**
 *
 * Every boundary follows from that without being named: full range has nothing
 * wider to show, the minimum span has nothing narrower, a zero-width run has
 * neither, and a viewport already showing the whole run has nothing to reset to.
 *
 * Nothing here is a second viewport authority. The candidate range comes from
 * `zoomDomain`, and what that range *becomes* comes from the reducer itself --
 * the same transition the press will make. This module asks the contract a
 * question; it does not answer one.
 */

import type { ViewerEvent, ViewerInteractionState } from "./interactionState";
import { renderedDomain, viewerInteractionReducer } from "./interactionState";
import type { RetentionTimeDomain } from "./scanModel";
import { zoomDomain } from "./viewport";

/** The three actions the viewport control group offers. */
export type ViewportAction = "zoom-in" | "zoom-out" | "reset";

/**
 * How far one deliberate zoom moves.
 *
 * A larger step than a wheel notch, because a button press is one decision
 * rather than a stream of them.
 */
export const ZOOM_STEP_FACTOR = 0.6;

export interface ViewportActionPlan {
  /** Whether pressing this control would change what is on screen. */
  readonly available: boolean;
  /** The range that would be shown afterwards, or `null` if nothing would be. */
  readonly nextDomain: RetentionTimeDomain | null;
  /** The event to dispatch, or `null` when there is nothing worth dispatching. */
  readonly event: ViewerEvent | null;
}

const UNAVAILABLE: ViewportActionPlan = { available: false, nextDomain: null, event: null };

/**
 * Plans one viewport action against one interaction state.
 *
 * Pure, and a projection rather than a state: nothing here is stored, and the
 * same call is made again from the live state when the control is actually
 * pressed.
 *
 * The comparison is between **rendered domains**, and that is load-bearing
 * rather than pedantic. Comparing `zoomDomain`'s own output with the range on
 * screen would reintroduce the defect on a large class of runs: canonical
 * clamping is not exactly idempotent at the full-range bound, because it
 * recovers the low edge as `full.high - span` and that subtraction rounds. A
 * run of 0.0125 to 453.9875 clamps to a low of 0.012499999999988631 -- a range
 * the reducer then recognises as the whole run and commits as `null`, showing
 * exactly what was already there. Asking what the *reducer* would render
 * removes the question instead of approximating an answer to it, and needs no
 * epsilon.
 */
export function planViewportAction(
  state: ViewerInteractionState,
  action: ViewportAction,
): ViewportActionPlan {
  const full = state.fullDomain;
  const shown = renderedDomain(state);
  if (full === null || shown === null) {
    return UNAVAILABLE;
  }
  const event: ViewerEvent =
    action === "reset"
      ? { type: "viewport-reset" }
      : {
          type: "viewport-step",
          domain: zoomDomain(
            shown,
            full,
            action === "zoom-in" ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR,
            0.5,
          ),
        };
  const next = renderedDomain(viewerInteractionReducer(state, event));
  // By value. The arithmetic is deterministic, so a clamp that lands on the
  // range already shown produces the same numbers in a new object -- and
  // comparing references would call that a change, which is the whole defect.
  if (next === null || (next.low === shown.low && next.high === shown.high)) {
    return UNAVAILABLE;
  }
  return { available: true, nextDomain: next, event };
}

/**
 * Takes one viewport action, if it would still do anything.
 *
 * Planned again here rather than trusting the `disabled` a render computed. The
 * state can move between the render that drew the button and the press that
 * reaches it -- a settling gesture, a selection's reveal, a preview replaced --
 * and a boolean captured by an older render is a claim about a state that has
 * gone. The rendered capability and this guard are one rule with two readers,
 * not two policies that happen to agree.
 */
export function applyViewportAction(
  state: ViewerInteractionState,
  dispatch: (event: ViewerEvent) => ViewerInteractionState,
  action: ViewportAction,
): void {
  const plan = planViewportAction(state, action);
  if (plan.event !== null) {
    dispatch(plan.event);
  }
}
