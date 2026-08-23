/**
 * One rule, and every boundary that falls out of it.
 *
 * The defect this closes was a control group in which one button computed its
 * own availability and told the truth while the other two claimed to be
 * available wherever they could be pressed. Enumerating the boundaries would
 * have been the same mistake in a longer form, so nothing below asks "is this
 * the full range" or "is this the minimum span". It asks one question --
 * **would pressing this change what is on screen** -- and reads the answers off.
 *
 * The invariant is asserted independently of the planner's own reply: each case
 * builds the action's event from canonical arithmetic, runs the reducer, and
 * compares rendered domains itself. A planner that decided from the action's
 * name would disagree with that immediately.
 */

import { describe, expect, it } from "vitest";

import type { ViewerEvent, ViewerInteractionState } from "./interactionState";
import {
  activeGestureEpoch,
  initialViewerInteractionState,
  renderedDomain,
  viewerInteractionReducer,
} from "./interactionState";
import type { RetentionTimeDomain } from "./scanModel";
import { minimumSpan, zoomDomain } from "./viewport";
import type { ViewportAction, WheelDirection } from "./viewportAction";
import {
  WHEEL_ZOOM_FACTOR,
  ZOOM_STEP_FACTOR,
  planViewportAction,
  planWheelGesture,
} from "./viewportAction";

const ACTIONS: readonly ViewportAction[] = ["zoom-in", "zoom-out", "reset"];

/** A run of this span, loaded, with nothing else having happened to it. */
function loaded(full: RetentionTimeDomain): ViewerInteractionState {
  return viewerInteractionReducer(initialViewerInteractionState, {
    type: "preview-loaded",
    fullDomain: full,
  });
}

/** Applies one action the way a press would, through the reducer. */
function take(state: ViewerInteractionState, action: ViewportAction): ViewerInteractionState {
  const plan = planViewportAction(state, action);
  return plan.event === null ? state : viewerInteractionReducer(state, plan.event);
}

/**
 * Zooms in until zooming in stops doing anything.
 *
 * Reached through canonical operations rather than by naming a magic range, so
 * the state under test is one the product can actually arrive at.
 */
function atMinimumSpan(full: RetentionTimeDomain): ViewerInteractionState {
  let state = loaded(full);
  for (let step = 0; step < 200; step += 1) {
    const next = take(state, "zoom-in");
    if (next === state) {
      return state;
    }
    state = next;
  }
  throw new Error("the minimum span was never reached");
}

/**
 * The event an action would send, built here rather than read from the planner.
 *
 * This is what makes the invariant below an independent check: if the planner
 * ever decided availability from the action's name, or from a boundary it had
 * been told to look for, it would part company with this immediately.
 */
function eventFor(state: ViewerInteractionState, action: ViewportAction): ViewerEvent {
  const full = state.fullDomain;
  const shown = renderedDomain(state);
  if (full === null || shown === null) {
    return { type: "viewport-reset" };
  }
  return action === "reset"
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
}

/** Whether taking the action would change the range on screen. */
function wouldChangeWhatIsShown(
  state: ViewerInteractionState,
  action: ViewportAction,
): boolean {
  const shown = renderedDomain(state);
  const after = renderedDomain(viewerInteractionReducer(state, eventFor(state, action)));
  if (shown === null || after === null) {
    return false;
  }
  return after.low !== shown.low || after.high !== shown.high;
}

const RUN: RetentionTimeDomain = { low: 0, high: 100 };

describe("what a viewport control would do", () => {
  const cases: readonly {
    readonly name: string;
    readonly state: () => ViewerInteractionState;
    readonly expected: Readonly<Record<ViewportAction, boolean>>;
  }[] = [
    {
      name: "a positive-span run, showing all of it",
      state: () => loaded(RUN),
      // Nothing wider to show, and nothing to reset to.
      expected: { "zoom-in": true, "zoom-out": false, reset: false },
    },
    {
      name: "an ordinary subrange",
      state: () => take(loaded(RUN), "zoom-in"),
      expected: { "zoom-in": true, "zoom-out": true, reset: true },
    },
    {
      name: "the narrowest viewport the run allows",
      state: () => atMinimumSpan(RUN),
      // Nothing narrower to show, but plenty wider.
      expected: { "zoom-in": false, "zoom-out": true, reset: true },
    },
    {
      name: "a run whose scans all share one retention time",
      state: () => loaded({ low: 12.5, high: 12.5 }),
      // A zero-width run has no subrange and no superrange. The scan is still
      // drawn -- a single point is a measurement -- but there is nothing to
      // zoom.
      expected: { "zoom-in": false, "zoom-out": false, reset: false },
    },
    {
      name: "a run whose low edge does not survive being recovered exactly",
      /*
       * The case that decides how equality is compared, and the reason this
       * planner asks the reducer rather than reading `zoomDomain`'s own output.
       *
       * Canonical clamping recovers the low edge as `full.high - span`, and that
       * subtraction rounds: 0.0125 to 453.9875 comes back as
       * 0.012499999999988631. Compared against the range on screen that is a
       * change, so `Zoom out` would have claimed to be available -- and the
       * reducer then recognises the result as the whole run and commits `null`,
       * showing exactly what was already there. The defect, reintroduced by the
       * comparison meant to fix it.
       */
      state: () => loaded({ low: 0.0125, high: 453.9875 }),
      expected: { "zoom-in": true, "zoom-out": false, reset: false },
    },
    {
      name: "a viewport with no run loaded at all",
      state: () => initialViewerInteractionState,
      expected: { "zoom-in": false, "zoom-out": false, reset: false },
    },
  ];

  for (const scenario of cases) {
    for (const action of ACTIONS) {
      it(`${action} in ${scenario.name}`, () => {
        const state = scenario.state();

        expect(planViewportAction(state, action).available).toBe(scenario.expected[action]);
      });
    }

    it(`agrees with what the reducer would render in ${scenario.name}`, () => {
      const state = scenario.state();

      for (const action of ACTIONS) {
        expect(planViewportAction(state, action).available, action).toBe(
          wouldChangeWhatIsShown(state, action),
        );
      }
    });
  }

  it("reports the range that would be shown, not the one it asked for", () => {
    const state = take(loaded(RUN), "zoom-in");
    const plan = planViewportAction(state, "reset");

    expect(plan.available).toBe(true);
    expect(plan.nextDomain).toEqual(RUN);
    expect(plan.event).toEqual({ type: "viewport-reset" });
  });

  it("offers no event at all where there is nothing to do", () => {
    const plan = planViewportAction(loaded(RUN), "zoom-out");

    expect(plan.available).toBe(false);
    expect(plan.event).toBeNull();
    expect(plan.nextDomain).toBeNull();
  });

  it("calls a result that equals the range on screen no change, whatever object it is in", () => {
    // The arithmetic is deterministic, so a clamp that lands on the range
    // already shown produces the same numbers in a new object. Comparing
    // references would call that a change.
    const state = loaded(RUN);
    const shown = renderedDomain(state) as RetentionTimeDomain;
    const again = zoomDomain(shown, RUN, 1 / ZOOM_STEP_FACTOR, 0.5);

    expect(again).not.toBe(shown);
    expect(again).toEqual(shown);
    expect(planViewportAction(state, "zoom-out").available).toBe(false);
  });

  it("stops zooming in exactly where the run says the narrowest viewport is", () => {
    // Not because the component looked for `minimumSpan`, but because one more
    // zoom would show the same range.
    const state = atMinimumSpan(RUN);
    const shown = renderedDomain(state) as RetentionTimeDomain;

    expect(shown.high - shown.low).toBeCloseTo(minimumSpan(RUN), 12);
    expect(planViewportAction(state, "zoom-in").available).toBe(false);
  });

  it("keeps the caption's question and the button's question the same question", () => {
    /*
     * The panel still has a separate projection for the words "(full range)".
     * Two rules about the same range is a maintenance hazard, so what makes
     * keeping both safe is stated here rather than assumed: every path that sets
     * a viewport goes through `clampDomain`, so the rendered domain is always
     * *inside* the run -- and for a range that is inside, "covers the whole run"
     * and "is the whole run" are the same predicate.
     *
     * Which is why `Reset range` is available exactly when the caption does not
     * say "(full range)". If a future change ever let a rendered domain escape
     * the run, the two would part company, and this is where that shows up.
     */
    const states: readonly ViewerInteractionState[] = [
      loaded(RUN),
      take(loaded(RUN), "zoom-in"),
      take(take(loaded(RUN), "zoom-in"), "zoom-in"),
      atMinimumSpan(RUN),
      loaded({ low: 12.5, high: 12.5 }),
      loaded({ low: 0.0125, high: 453.9875 }),
      viewerInteractionReducer(loaded(RUN), {
        type: "gesture-started",
        domain: { low: -50, high: 500 },
      }),
      viewerInteractionReducer(loaded(RUN), {
        type: "gesture-started",
        domain: { low: 20, high: 40 },
      }),
    ];

    for (const state of states) {
      const full = state.fullDomain as RetentionTimeDomain;
      const shown = renderedDomain(state) as RetentionTimeDomain;
      const label = JSON.stringify(shown);

      // Contained, always.
      expect(shown.low >= full.low, label).toBe(true);
      expect(shown.high <= full.high, label).toBe(true);

      // So these two are one question asked twice.
      const coversTheRun = shown.low <= full.low && shown.high >= full.high;
      const isTheRun = shown.low === full.low && shown.high === full.high;
      expect(coversTheRun, label).toBe(isTheRun);
      expect(planViewportAction(state, "reset").available, label).toBe(!coversTheRun);
    }
  });

  it("does not claim availability for a change nobody would see", () => {
    /*
     * A gesture whose range is already the whole run. Resetting would drop the
     * gesture -- a real change to the state -- and change nothing on screen. A
     * visible control speaks for what is visible.
     */
    const state = viewerInteractionReducer(loaded(RUN), {
      type: "gesture-started",
      domain: { low: -50, high: 500 },
    });
    expect(renderedDomain(state)).toEqual(RUN);
    expect(state.gesture).not.toBeNull();

    expect(planViewportAction(state, "reset").available).toBe(false);
    expect(planViewportAction(state, "zoom-out").available).toBe(false);
    expect(planViewportAction(state, "zoom-in").available).toBe(true);
  });
});

/*
 * The same question, asked of a gesture instead of a press.
 *
 * A wheel is not a button: a smaller factor, an anchor under the pointer rather
 * than at the centre, a transient gesture carrying a reducer-assigned epoch, and
 * a settle a moment later. What it shares is the only thing worth sharing --
 * whether putting it through the contract would change the range on screen --
 * because that is what decides whether MSCanvas may cancel the browser's default
 * action for it.
 *
 * The no-run case is here rather than at the component, because a viewer with no
 * run loaded draws no plot for a wheel to arrive at. The planner is where that
 * state can be asked the question at all.
 */
describe("what one wheel notch would do", () => {
  const DIRECTIONS: readonly WheelDirection[] = ["in", "out"];
  const ANCHORS = [0, 0.5, 1] as const;

  /** Whether the notch would change the range on screen, worked out here. */
  function wouldMoveTheAxis(
    state: ViewerInteractionState,
    direction: WheelDirection,
    anchor: number,
  ): boolean {
    const full = state.fullDomain;
    const shown = renderedDomain(state);
    if (full === null || shown === null) {
      return false;
    }
    const candidate = zoomDomain(
      shown,
      full,
      direction === "in" ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR,
      anchor,
    );
    const epoch = activeGestureEpoch(state);
    const applied = viewerInteractionReducer(
      state,
      epoch === null
        ? { type: "gesture-started", domain: candidate }
        : { type: "gesture-moved", epoch, domain: candidate },
    );
    // Carried to its conclusion, because an unsettled gesture is not finished,
    // and what it settles to is what the reader is left looking at.
    const settling = activeGestureEpoch(applied);
    const finished =
      settling === null
        ? applied
        : viewerInteractionReducer(applied, { type: "gesture-settled", epoch: settling });
    const after = renderedDomain(finished);
    return after !== null && (after.low !== shown.low || after.high !== shown.high);
  }

  /**
   * Turns the wheel inward, at this pointer position, until it stops doing
   * anything.
   *
   * The anchor is a parameter because the narrowest viewport is not one range.
   * `zoomDomain` floors the span it asks for, and the last notch before the
   * floor lands wherever the pointer held it, so a wheel turned at the left edge
   * of the plot comes to rest against a slightly different pair of numbers than
   * one turned at the middle. Reaching the floor the same way it is then asked
   * about keeps this a statement about the product's boundary rather than about
   * one arbitrary range that happens to sit near it.
   */
  function atWheelFloor(full: RetentionTimeDomain, anchor: number): ViewerInteractionState {
    let state = loaded(full);
    for (let step = 0; step < 400; step += 1) {
      const plan = planWheelGesture(state, "in", anchor);
      if (plan.event === null) {
        return state;
      }
      state = viewerInteractionReducer(state, plan.event);
    }
    throw new Error("the wheel never ran out of run");
  }

  const cases: readonly {
    readonly name: string;
    readonly state: (anchor: number) => ViewerInteractionState;
    readonly expected: Readonly<Record<WheelDirection, boolean>>;
  }[] = [
    {
      name: "a positive-span run, showing all of it",
      // The state the viewer opens in, and the one a reader is in when they
      // want to reach the panels below.
      state: () => loaded(RUN),
      expected: { in: true, out: false },
    },
    {
      name: "an ordinary subrange",
      state: () => {
        const state = loaded(RUN);
        return viewerInteractionReducer(
          state,
          planWheelGesture(state, "in", 0.5).event as ViewerEvent,
        );
      },
      expected: { in: true, out: true },
    },
    {
      name: "the narrowest viewport the wheel can reach",
      state: (anchor) => atWheelFloor(RUN, anchor),
      expected: { in: false, out: true },
    },
    {
      name: "a run whose scans all share one retention time",
      // A real acquisition with a visible mark and no width to zoom.
      state: () => loaded({ low: 12.5, high: 12.5 }),
      expected: { in: false, out: false },
    },
    {
      name: "a run whose low edge does not survive being recovered exactly",
      /*
       * The case that decides how the question is asked. Zooming out here
       * produces a gesture domain whose low edge is 0.012499999999988631 --
       * compared as a transient, a change of one part in a hundred million
       * million, and the wheel would be claimed for it. Settled, the run comes
       * back exactly, and the honest answer is that nothing moved.
       */
      state: () => loaded({ low: 0.0125, high: 453.9875 }),
      expected: { in: true, out: false },
    },
    {
      name: "a viewport with no run loaded at all",
      state: () => initialViewerInteractionState,
      expected: { in: false, out: false },
    },
  ];

  for (const scenario of cases) {
    for (const direction of DIRECTIONS) {
      it(`${direction} in ${scenario.name}`, () => {
        for (const anchor of ANCHORS) {
          const label = `anchor ${String(anchor)}`;
          const plan = planWheelGesture(scenario.state(anchor), direction, anchor);

          expect(plan.handled, label).toBe(scenario.expected[direction]);
          // An unclaimed notch offers nothing to dispatch, so an input the
          // viewer did not consume can leave nothing behind either.
          expect(plan.event === null, label).toBe(!scenario.expected[direction]);
        }
      });
    }

    it(`agrees with what the reducer would settle to in ${scenario.name}`, () => {
      for (const direction of DIRECTIONS) {
        for (const anchor of ANCHORS) {
          const state = scenario.state(anchor);

          expect(
            planWheelGesture(state, direction, anchor).handled,
            `${direction} at ${String(anchor)}`,
          ).toBe(wouldMoveTheAxis(state, direction, anchor));
        }
      }
    });
  }

  it("lets go of the wheel at the boundary rather than holding it turn after turn", () => {
    /*
     * The defect this closes is a wheel the viewer keeps and does not use, so
     * what matters at a boundary is not only that the claim stops but that it
     * stops quickly, whatever the pointer was doing on the way in.
     *
     * A pointer that moves between notches can leave the viewport a few parts in
     * a quadrillion off the range the floor was reached at, and `zoomDomain`
     * floors the span rather than refusing, so the next notch is a real -- and
     * completely invisible -- change. The rule claims it, once, and then the
     * arithmetic has converged and every later notch is released. What is pinned
     * here is that bound: the wheel comes free, and the range does not creep
     * while it does.
     */
    const centred = atWheelFloor(RUN, 0.5);
    const before = renderedDomain(centred) as RetentionTimeDomain;
    let state = centred;
    let claimed = 0;

    for (let notch = 0; notch < 20; notch += 1) {
      // The pointer at the left edge, which is not where the floor was reached.
      const plan = planWheelGesture(state, "in", 0);
      if (plan.event === null) {
        break;
      }
      claimed += 1;
      state = viewerInteractionReducer(state, plan.event);
    }

    expect(claimed).toBeLessThanOrEqual(2);
    expect(planWheelGesture(state, "in", 0).handled).toBe(false);
    const after = renderedDomain(state) as RetentionTimeDomain;
    // Nothing a screen, or a retention time, could tell apart.
    const tolerance = (RUN.high - RUN.low) * 1e-12;
    expect(Math.abs(after.low - before.low)).toBeLessThan(tolerance);
    expect(Math.abs(after.high - before.high)).toBeLessThan(tolerance);
  });

  it("starts a gesture where there is none, and moves the one there is", () => {
    // The epoch is read from the state, never invented. An adapter that minted
    // its own could address a gesture that is not its own, which is the race an
    // epoch exists to remove.
    const state = loaded(RUN);
    const first = planWheelGesture(state, "in", 0.5);
    expect(first.event?.type).toBe("gesture-started");

    const moving = viewerInteractionReducer(state, first.event as ViewerEvent);
    const epoch = activeGestureEpoch(moving);
    expect(epoch).not.toBeNull();

    expect(planWheelGesture(moving, "in", 0.5).event).toMatchObject({
      type: "gesture-moved",
      epoch,
    });
  });

  it("holds the retention time under the pointer rather than the centre", () => {
    // The button planner's centre anchor is a different gesture, and must not
    // be substituted for this one.
    const state = loaded(RUN);
    const left = planWheelGesture(state, "in", 0).nextDomain as RetentionTimeDomain;
    const right = planWheelGesture(state, "in", 1).nextDomain as RetentionTimeDomain;

    expect(left.low).toBeCloseTo(RUN.low, 9);
    expect(right.high).toBeCloseTo(RUN.high, 9);
    expect(right.low).toBeGreaterThan(left.low);
  });

  it("moves the viewport by less than one press of the button does", () => {
    // A stream of notches and one deliberate decision are different gestures,
    // and the step reflects that. Ownership is still one rule for both.
    const state = loaded(RUN);
    const notch = planWheelGesture(state, "in", 0.5).nextDomain as RetentionTimeDomain;
    const press = planViewportAction(state, "zoom-in").nextDomain as RetentionTimeDomain;

    expect(notch.high - notch.low).toBeGreaterThan(press.high - press.low);
    expect(notch.high - notch.low).toBeLessThan(RUN.high - RUN.low);
  });

  it("reports the range the notch would leave, not the one it asked for", () => {
    const state = loaded(RUN);
    const plan = planWheelGesture(state, "in", 0.5);

    expect(plan.handled).toBe(true);
    expect(plan.nextDomain).toEqual(
      renderedDomain(viewerInteractionReducer(state, plan.event as ViewerEvent)),
    );
  });
});
