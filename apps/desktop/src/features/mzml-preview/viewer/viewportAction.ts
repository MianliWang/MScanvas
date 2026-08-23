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
import {
  activeGestureEpoch,
  renderedDomain,
  viewerInteractionReducer,
} from "./interactionState";
import type { RetentionTimeDomain } from "./scanModel";
import { zoomDomain } from "./viewport";

/** The three actions the viewport control group offers. */
export type ViewportAction = "zoom-in" | "zoom-out" | "reset";

/** Which way a wheel notch is asking the viewport to go. */
export type WheelDirection = "in" | "out";

/**
 * How far one deliberate zoom moves.
 *
 * A larger step than a wheel notch, because a button press is one decision
 * rather than a stream of them.
 */
export const ZOOM_STEP_FACTOR = 0.6;

/** How far one wheel notch moves the visible span. */
export const WHEEL_ZOOM_FACTOR = 0.85;

/** What one event would leave on screen, once it has finished happening. */
export interface RenderedDomainTransition {
  readonly changed: boolean;
  /** The range that would be shown afterwards, or `null` if it is this one. */
  readonly nextDomain: RetentionTimeDomain | null;
}

const UNCHANGED: RenderedDomainTransition = { changed: false, nextDomain: null };

/**
 * Whether one event would change the range on screen, and what it would leave.
 *
 * The one place that question is answered, so a button and a wheel cannot come
 * to answer it slightly differently. It is a pure projection: the reducer is
 * asked what the event does, and nothing is kept.
 *
 * **A gesture is projected through its settle**, and that is not fastidiousness.
 * A gesture's rendered domain is the clamped range it holds; a *settled* one is
 * put through the same normalisation every committed viewport gets, where a
 * range covering the whole run becomes the run. Those differ, because canonical
 * clamping recovers a low edge as `full.high - span` and that subtraction
 * rounds: for a run of 0.0125 to 453.9875, zooming out at full range produces a
 * gesture domain of 0.012499999999988631 to 453.9875. Compared as a transient
 * that is a change -- a change of one part in a hundred million million, which
 * no screen has ever shown -- and the wheel would be claimed for it. Asking what
 * the gesture *settles* to gives the run back, exactly, and the answer is the
 * honest one: turning the wheel there moves nothing.
 *
 * Events that are not gestures settle nothing and take the same path unchanged.
 */
export function planRenderedDomainTransition(
  state: ViewerInteractionState,
  event: ViewerEvent,
): RenderedDomainTransition {
  const shown = renderedDomain(state);
  if (shown === null) {
    return UNCHANGED;
  }
  const applied = viewerInteractionReducer(state, event);
  const epoch = activeGestureEpoch(applied);
  const finished =
    epoch === null
      ? applied
      : viewerInteractionReducer(applied, { type: "gesture-settled", epoch });
  const next = renderedDomain(finished);
  // By value. The arithmetic is deterministic, so a clamp that lands on the
  // range already shown produces the same numbers in a new object -- and
  // comparing references would call that a change, which is the whole defect.
  if (next === null || (next.low === shown.low && next.high === shown.high)) {
    return UNCHANGED;
  }
  return { changed: true, nextDomain: next };
}

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
  const transition = planRenderedDomainTransition(state, event);
  if (!transition.changed) {
    return UNAVAILABLE;
  }
  return { available: true, nextDomain: transition.nextDomain, event };
}

export interface WheelGesturePlan {
  /**
   * Whether the viewer claims this wheel event.
   *
   * Claiming one means cancelling the browser's default action for it, so this
   * is not a question about what the viewer would *like* to do. The viewer
   * column scrolls, and a wheel MSCanvas cancels without using is a wheel that
   * did nothing at all.
   */
  readonly handled: boolean;
  readonly event: ViewerEvent | null;
  readonly nextDomain: RetentionTimeDomain | null;
}

const UNHANDLED: WheelGesturePlan = { handled: false, event: null, nextDomain: null };

/**
 * What one wheel notch would do, and whether the viewer owns it.
 *
 * Shares the productivity question with the buttons and nothing else, because
 * the two gestures are not the same thing. A button is one deliberate decision:
 * a fixed step, anchored at the centre, committed at once. A wheel is a stream:
 * a smaller factor, anchored under the pointer so the retention time there stays
 * there, carried as a transient gesture with a reducer-assigned epoch, and
 * settled a moment after the last notch.
 *
 * The epoch is read from the state rather than allocated here. An adapter that
 * invented one could address a gesture that is not its own, which is exactly the
 * race an epoch exists to remove.
 */
export function planWheelGesture(
  state: ViewerInteractionState,
  direction: WheelDirection,
  anchor: number,
): WheelGesturePlan {
  const full = state.fullDomain;
  const shown = renderedDomain(state);
  if (full === null || shown === null) {
    return UNHANDLED;
  }
  const candidate = zoomDomain(
    shown,
    full,
    direction === "in" ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR,
    anchor,
  );
  const epoch = activeGestureEpoch(state);
  const event: ViewerEvent =
    epoch === null
      ? { type: "gesture-started", domain: candidate }
      : { type: "gesture-moved", epoch, domain: candidate };
  const transition = planRenderedDomainTransition(state, event);
  if (!transition.changed) {
    return UNHANDLED;
  }
  return { handled: true, event, nextDomain: transition.nextDomain };
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
