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
  initialViewerInteractionState,
  renderedDomain,
  viewerInteractionReducer,
} from "./interactionState";
import type { RetentionTimeDomain } from "./scanModel";
import { minimumSpan, zoomDomain } from "./viewport";
import type { ViewportAction } from "./viewportAction";
import { ZOOM_STEP_FACTOR, planViewportAction } from "./viewportAction";

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
