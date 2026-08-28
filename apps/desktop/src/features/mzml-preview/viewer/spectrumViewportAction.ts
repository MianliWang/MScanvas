/**
 * What one press, one key or one wheel notch would do to the m/z viewport.
 *
 * The retention-time viewer answered this question once and for three controls,
 * in `viewportAction.ts`, under one rule:
 *
 *   **a visible viewport action is available exactly when applying it would
 *   change the effective rendered domain.**
 *
 * This is that rule again, asked of the other axis. Nothing here is a second
 * viewport authority: the candidate range comes from `spectrumViewport.ts`'s own
 * arithmetic, and what that range *becomes* comes from the reducer itself --
 * the same transition the press will make. This module asks the contract a
 * question; it does not answer one.
 *
 * Written beside `viewportAction.ts` rather than shared with it, for the reason
 * ADR 0038 gives for keeping the two axes apart: `MzDomain` carries a brand a
 * `RetentionTimeDomain` does not, the two reducers own different state, and a
 * planner generic over both would have to erase exactly the distinction the
 * brand exists to keep. What is genuinely common -- how far one deliberate zoom
 * moves, and how a wheel's own magnitude is read -- is imported rather than
 * restated.
 */

import type { MzDomain, SpectrumViewportEvent, SpectrumViewportState } from "./spectrumViewport";
import {
  activeMzGestureEpoch,
  clampMzDomain,
  minimumMzSpan,
  mzDomain,
  panMzDomain,
  renderedMzDomain,
  spectrumViewportReducer,
  zoomMzDomain,
} from "./spectrumViewport";
// The step and the wheel's normalisation are the product's, not this axis's. A
// second zoom step would make the same button move a different distance
// depending on which plot it happened to sit over.
import { ZOOM_STEP_FACTOR } from "./viewportAction";
import type { WheelDelta } from "./wheelInput";
import { wheelZoomFactor } from "./wheelInput";

/**
 * Every viewport transition an adapter can ask for, visible or not.
 *
 * The three the panel draws as buttons, and the two the keyboard adds. One type
 * rather than two, so a pan at the edge of the spectrum is judged by the same
 * rule that closes `Zoom out` at full range -- a keyboard route that dispatched
 * an inert step would be the defect the buttons were repaired for, moved
 * somewhere nobody looks.
 */
export type SpectrumViewportAction = "zoom-in" | "zoom-out" | "reset" | "pan-left" | "pan-right";

/** The subset of them a control group draws as a button. */
export type VisibleSpectrumViewportAction = "zoom-in" | "zoom-out" | "reset";

/**
 * The controls the panel offers, in the order it offers them.
 *
 * One list, so the render and the keyboard cannot drift apart about which
 * controls exist. Pan has no button: the plot is dragged, and the arrow keys
 * reach the same transition.
 *
 * The labels name the axis they act on. `Zoom in` alone would be the second
 * control in this window with that accessible name -- the chromatogram already
 * offers one -- and two surfaces offering the same verb have to be
 * distinguishable to someone who is being read the interface rather than
 * looking at it.
 */
export const VISIBLE_SPECTRUM_VIEWPORT_ACTIONS: readonly {
  readonly action: VisibleSpectrumViewportAction;
  readonly label: string;
}[] = [
  { action: "zoom-in", label: "Zoom in m/z" },
  { action: "zoom-out", label: "Zoom out m/z" },
  { action: "reset", label: "Reset m/z range" },
];

/** What one keyboard pan moves, as a fraction of the visible span. */
export const MZ_PAN_STEP = 0.25;

/** What one event would leave on screen, once it has finished happening. */
export interface RenderedMzTransition {
  readonly changed: boolean;
  /** The range that would be shown afterwards, or `null` if it is this one. */
  readonly nextDomain: MzDomain | null;
}

const UNCHANGED: RenderedMzTransition = { changed: false, nextDomain: null };

/**
 * Whether one event would change the m/z range on screen, and what it leaves.
 *
 * The one place that question is answered, so a button, a key and a wheel
 * cannot come to answer it slightly differently. A pure projection: the reducer
 * is asked what the event does, and nothing is kept.
 *
 * **A gesture is projected through its settle**, so that what is compared is
 * what a reader would be left looking at rather than a transient the reducer has
 * not finished with. A gesture's rendered domain is the clamped range it holds;
 * a settled one is put through the normalisation every committed viewport gets,
 * where a range covering the whole spectrum becomes the spectrum.
 *
 * **On this axis that projection changes no verdict, and saying otherwise was
 * wrong.** The retention-time planner introduced it to keep an outward wheel at
 * full range unclaimed, and it cannot do that here: `committedForm` answers
 * `null` only where the clamped window already equals the source *by value*,
 * which is precisely where the unsettled comparison already said "unchanged".
 * What actually keeps that wheel unclaimed is `zoomedTo` below, which stops the
 * candidate rounding off the limit in the first place. The settle is kept
 * because it is the honest question to ask of a gesture -- not because it is
 * load-bearing.
 *
 * Events that are not gestures settle nothing and take the same path unchanged.
 */
export function planRenderedMzTransition(
  state: SpectrumViewportState,
  event: SpectrumViewportEvent,
): RenderedMzTransition {
  const shown = renderedMzDomain(state);
  if (shown === null) {
    return UNCHANGED;
  }
  const applied = spectrumViewportReducer(state, event);
  const epoch = activeMzGestureEpoch(applied);
  const finished =
    epoch === null
      ? applied
      : spectrumViewportReducer(applied, { type: "gesture-settled", epoch });
  const next = renderedMzDomain(finished);
  // By value. The arithmetic is deterministic, so a clamp that lands on the
  // range already shown produces the same numbers in a new object -- and
  // comparing references would call that a change, which is the whole defect.
  if (next === null || (next.low === shown.low && next.high === shown.high)) {
    return UNCHANGED;
  }
  return { changed: true, nextDomain: next };
}

export interface SpectrumViewportActionPlan {
  /** Whether taking this action would change what is drawn. */
  readonly available: boolean;
  /** The range that would be shown afterwards, or `null` if nothing would be. */
  readonly nextDomain: MzDomain | null;
  /** The event to dispatch, or `null` when there is nothing worth dispatching. */
  readonly event: SpectrumViewportEvent | null;
}

const UNAVAILABLE: SpectrumViewportActionPlan = {
  available: false,
  nextDomain: null,
  event: null,
};

/**
 * The window a zoom asks for, at a width the spectrum can actually be shown at.
 *
 * `zoomMzDomain` already caps a span at the source and floors it at the
 * minimum, and for every width in between it is exactly what this wants. At the
 * two limits it is not, and the reason is arithmetic rather than intent.
 *
 * A zoom holds a point and scales both edges away from it. Recovering an edge
 * from a centre does not round back to where it started, so a zoom that cannot
 * change the width still moves it: for a spectrum of m/z 110.3 to 500, zooming
 * out at full range produces a low of 110.30000000000001, whose span is smaller
 * than the source's by one part in ten thousand million million. Nothing renders
 * that. But `isFullMzDomain` compares edges, so the reducer does not recognise
 * it as the whole spectrum -- it commits it as a subrange, the caption stops
 * saying full range, `Reset m/z range` lights up, `Zoom out m/z` offers to do it
 * again, and the wheel is claimed for it so the panel underneath stops
 * scrolling.
 *
 * Measured over 121 plausible m/z domains: **nine of them at the centre anchor
 * a button uses, and twenty-one -- about one in six -- at some anchor a wheel
 * can land on.** The same rounding reaches the narrowest window from the other
 * direction, where it moves a window that has no width left to give.
 *
 * `clampMzDomain` rescues the rest by holding the low edge to the source, which
 * catches the cases that round *below* `full.low` and none that round above. And
 * projecting the gesture through its settle -- which is how the retention-time
 * planner answers this -- turns out to change no verdict at all: `committedForm`
 * can answer `null` only where the clamped window already equals the source by
 * value, which is exactly where the unsettled comparison already said
 * "unchanged".
 *
 * So the answer is upstream of the rounding, and it is to say the two limits
 * exactly rather than arrive at them by subtraction: asking for at least the
 * whole spectrum **is** the whole spectrum, and asking for no more than the
 * narrowest window this spectrum has **is** that window, built where it already
 * sits. Neither is an epsilon and neither is a second viewport rule: both are
 * the limits `clampMzDomain` enforces, said in values a reader can compare.
 *
 * The retention-time planner shares this arithmetic and therefore this hole.
 * Repairing it there is a change to a shipped surface with its own rendered
 * evidence, and is recorded for the slice that next owns that planner rather
 * than folded into this one.
 */
function zoomedTo(visible: MzDomain, full: MzDomain, factor: number, anchor: number): MzDomain {
  const fullSpan = full.high - full.low;
  const span = visible.high - visible.low;
  if (!(fullSpan > 0) || !(span > 0) || !Number.isFinite(factor) || factor <= 0) {
    return clampMzDomain(visible, full);
  }
  // The width this zoom would settle on, under the same two limits
  // `zoomMzDomain` applies -- asked here so the two limits can be recognised
  // before the anchor arithmetic has a chance to round past them.
  const smallest = minimumMzSpan(full);
  const next = Math.min(fullSpan, Math.max(smallest, span * factor));
  if (next >= fullSpan) {
    return mzDomain(full.low, full.high);
  }
  if (next <= smallest) {
    /*
     * The narrowest window this spectrum has, kept where it already is.
     *
     * Two things have to be true here at once, and an earlier attempt bought the
     * second by giving up the first. **The floor has to be reachable**: refusing
     * this step outright left `Zoom in m/z` disabled while the contract would
     * still have narrowed the window -- by up to 40% of its width -- which is
     * the availability rule broken in the direction nobody notices, a control
     * saying there is nothing to do when there is. **And the floor has to be a
     * resting place**: a window already there must not be moved by asking again,
     * or every further notch of the wheel pans a plot the reader is trying to
     * zoom.
     *
     * Holding the low edge is what makes both true. The width becomes the floor,
     * so this step is a real change and is offered; and the window is built from
     * `visible.low` by a computation that reproduces itself exactly, so asking
     * again from its own answer returns that answer rather than drifting one
     * unit in the last place per notch. Anchoring cannot also survive: it would
     * make the result depend on a width that is only the floor to within a
     * rounding, which is the drift written back in.
     *
     * What that costs is the *last* step of a ten-thousand-fold zoom shrinking
     * toward the window's left edge instead of toward the cursor -- at most
     * two-thirds of the floor, which is 0.0067% of the spectrum.
     */
    const furthest = Math.max(full.low, full.high - smallest);
    const low = Math.min(Math.max(visible.low, full.low), furthest);
    return mzDomain(low, Math.min(full.high, low + smallest));
  }
  if (next === span) {
    return visible;
  }
  return zoomMzDomain(visible, full, factor, anchor);
}

/**
 * The range one deliberate action proposes, before the reducer judges it.
 *
 * Split out so the planner below has one shape to reason about: every action
 * that is not a reset becomes a `viewport-step` over a candidate domain, and a
 * reset is its own event because "the whole spectrum" is not a range this side
 * computes.
 */
function candidateFor(
  action: Exclude<SpectrumViewportAction, "reset">,
  shown: MzDomain,
  full: MzDomain,
): MzDomain {
  switch (action) {
    case "zoom-in":
      // The centre, always. A button is one deliberate decision and must not
      // depend on where a pointer happened to be left; the wheel is the gesture
      // that anchors under the cursor.
      return zoomedTo(shown, full, ZOOM_STEP_FACTOR, 0.5);
    case "zoom-out":
      return zoomedTo(shown, full, 1 / ZOOM_STEP_FACTOR, 0.5);
    case "pan-left":
      return panMzDomain(shown, full, -MZ_PAN_STEP);
    case "pan-right":
      return panMzDomain(shown, full, MZ_PAN_STEP);
  }
}

/**
 * Plans one viewport action against one viewport state.
 *
 * Pure, and a projection rather than a state: nothing here is stored, and the
 * same call is made again from the live state when the control is actually
 * taken.
 *
 * A viewport that is refused, or one for a panel with no spectrum in it, plans
 * nothing at all -- which is what makes "no control pretends to act" a property
 * of this function rather than a rule each control has to remember.
 */
export function planSpectrumViewportAction(
  state: SpectrumViewportState,
  action: SpectrumViewportAction,
): SpectrumViewportActionPlan {
  if (state.status !== "ready") {
    return UNAVAILABLE;
  }
  const shown = renderedMzDomain(state);
  if (shown === null) {
    return UNAVAILABLE;
  }
  const event: SpectrumViewportEvent =
    action === "reset"
      ? { type: "viewport-reset" }
      : { type: "viewport-step", domain: candidateFor(action, shown, state.full) };
  const transition = planRenderedMzTransition(state, event);
  if (!transition.changed) {
    return UNAVAILABLE;
  }
  return { available: true, nextDomain: transition.nextDomain, event };
}

export interface MzWheelPlan {
  /**
   * Whether the panel claims this wheel event.
   *
   * Claiming one means cancelling the browser's default action for it, so this
   * is not a question about what the panel would *like* to do. The viewer
   * column scrolls, and a wheel MSCanvas cancels without using is a wheel that
   * did nothing at all.
   */
  readonly handled: boolean;
  readonly event: SpectrumViewportEvent | null;
  readonly nextDomain: MzDomain | null;
}

const UNHANDLED: MzWheelPlan = { handled: false, event: null, nextDomain: null };

/**
 * What one wheel event would do to the m/z viewport, and whether it is ours.
 *
 * Shares the productivity question with the buttons and nothing else, because
 * the two gestures are not the same thing. A button is one deliberate decision:
 * a fixed step, anchored at the centre, committed at once. A wheel is a stream:
 * a magnitude read from the event itself, anchored under the pointer so the m/z
 * there stays there, carried as a transient gesture with a reducer-assigned
 * epoch, and settled a moment after the last event.
 *
 * **How much** the event asks for belongs to `wheelZoomFactor`, which reads both
 * `deltaY` and `deltaMode` and maps them continuously -- the product's rule,
 * borrowed rather than reinvented, so the same physical travel asks the same
 * thing of either plot. **Whether this panel may claim** the event is this
 * planner's question, and the answer is the rule above: only if the resulting
 * canonical interaction would change the settled rendered domain.
 *
 * The epoch is read from the state rather than allocated here. An adapter that
 * invented one could address a gesture that is not its own, which is exactly the
 * race an epoch exists to remove.
 */
export function planMzWheelGesture(
  state: SpectrumViewportState,
  wheel: WheelDelta,
  anchor: number,
): MzWheelPlan {
  if (state.status !== "ready") {
    // A refused viewport owns no wheel event, and neither does a panel with no
    // spectrum in it. The page keeps the scroll.
    return UNHANDLED;
  }
  const shown = renderedMzDomain(state);
  const factor = wheelZoomFactor(wheel);
  if (shown === null || factor === null) {
    return UNHANDLED;
  }
  const candidate = zoomedTo(shown, state.full, factor, anchor);
  const epoch = activeMzGestureEpoch(state);
  const event: SpectrumViewportEvent =
    epoch === null
      ? { type: "gesture-started", domain: candidate }
      : { type: "gesture-moved", epoch, domain: candidate };
  const transition = planRenderedMzTransition(state, event);
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
 * reaches it -- a settling gesture, a projection arriving, a different spectrum
 * selected -- and a boolean captured by an older render is a claim about a
 * state that has gone. The rendered capability and this guard are one rule with
 * two readers, not two policies that happen to agree.
 *
 * Answers whether anything was dispatched, which is what a keyboard handler
 * reads to decide whether the key was this panel's to consume.
 */
export function applySpectrumViewportAction(
  state: SpectrumViewportState,
  dispatch: (event: SpectrumViewportEvent) => SpectrumViewportState,
  action: SpectrumViewportAction,
): boolean {
  const plan = planSpectrumViewportAction(state, action);
  if (plan.event === null) {
    return false;
  }
  dispatch(plan.event);
  return true;
}
