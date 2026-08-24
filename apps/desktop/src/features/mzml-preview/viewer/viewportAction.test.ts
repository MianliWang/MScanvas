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
import type { ViewportAction } from "./viewportAction";
import { ZOOM_STEP_FACTOR, planViewportAction, planWheelGesture } from "./viewportAction";
import type { WheelDelta } from "./wheelInput";
import { DOM_DELTA_LINE, DOM_DELTA_PIXEL, wheelZoomFactor } from "./wheelInput";

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

/** A pixel-mode event, which is what nearly every device sends. */
function pixels(deltaY: number): WheelDelta {
  return { deltaY, deltaMode: DOM_DELTA_PIXEL };
}

function lines(deltaY: number): WheelDelta {
  return { deltaY, deltaMode: DOM_DELTA_LINE };
}

/** One ordinary mouse-sized notch, in each direction. */
const INWARD = pixels(-100);
const OUTWARD = pixels(100);

/** Away from both edges, so nothing below is really testing the clamp. */
const OFF_CENTRE = 0.35;

/** Settles whatever gesture is in flight, so a range can be compared. */
function settled(state: ViewerInteractionState): ViewerInteractionState {
  const epoch = activeGestureEpoch(state);
  return epoch === null
    ? state
    : viewerInteractionReducer(state, { type: "gesture-settled", epoch });
}

/** Sends one event, if the viewer would take it. */
function turn(
  state: ViewerInteractionState,
  wheel: WheelDelta,
  anchor: number,
): ViewerInteractionState {
  const plan = planWheelGesture(state, wheel, anchor);
  return plan.event === null ? state : viewerInteractionReducer(state, plan.event);
}

/*
 * The same question, asked of a gesture instead of a press -- and of a gesture
 * that now says how far it turned.
 *
 * Two rules meet in this planner and are deliberately not the same rule.
 * `wheelInput.ts` decides **how much** one event asks for, from its own
 * magnitude and unit. This planner decides **whether the viewer owns it**, which
 * is R1.2's rule unchanged: only if the resulting canonical interaction would
 * change the settled rendered domain. The cases that matter most are the ones
 * where the two interact -- a large delta at a boundary is still not ours, and a
 * very small one that moves the axis still is.
 *
 * The no-run case is here rather than at the component, because a viewer with no
 * run loaded draws no plot for a wheel to arrive at. The planner is where that
 * state can be asked the question at all.
 */
describe("whether the viewer owns one wheel event", () => {
  const ANCHORS = [0, 0.5, 1] as const;

  /** Whether the event would change the range on screen, worked out here. */
  function wouldMoveTheAxis(
    state: ViewerInteractionState,
    wheel: WheelDelta,
    anchor: number,
  ): boolean {
    const full = state.fullDomain;
    const shown = renderedDomain(state);
    const factor = wheelZoomFactor(wheel);
    if (full === null || shown === null || factor === null) {
      return false;
    }
    const candidate = zoomDomain(shown, full, factor, anchor);
    const epoch = activeGestureEpoch(state);
    const applied = viewerInteractionReducer(
      state,
      epoch === null
        ? { type: "gesture-started", domain: candidate }
        : { type: "gesture-moved", epoch, domain: candidate },
    );
    // Carried to its conclusion, because an unsettled gesture is not finished,
    // and what it settles to is what the reader is left looking at.
    const after = renderedDomain(settled(applied));
    return after !== null && (after.low !== shown.low || after.high !== shown.high);
  }

  /**
   * Turns the wheel inward, at this pointer position, until it stops doing
   * anything.
   *
   * The anchor is a parameter because the narrowest viewport is not one range.
   * `zoomDomain` floors the span it asks for, and the last event before the
   * floor lands wherever the pointer held it, so a wheel turned at the left edge
   * of the plot comes to rest against a slightly different pair of numbers than
   * one turned at the middle. Reaching the floor the same way it is then asked
   * about keeps this a statement about the product's boundary rather than about
   * one arbitrary range that happens to sit near it.
   */
  function atWheelFloor(full: RetentionTimeDomain, anchor: number): ViewerInteractionState {
    let state = loaded(full);
    for (let step = 0; step < 2_000; step += 1) {
      const next = turn(state, INWARD, anchor);
      if (next === state) {
        return state;
      }
      state = next;
    }
    throw new Error("the wheel never ran out of run");
  }

  const cases: readonly {
    readonly name: string;
    readonly state: (anchor: number) => ViewerInteractionState;
    readonly expected: { readonly inward: boolean; readonly outward: boolean };
  }[] = [
    {
      name: "a positive-span run, showing all of it",
      // The state the viewer opens in, and the one a reader is in when they
      // want to reach the panels below.
      state: () => loaded(RUN),
      expected: { inward: true, outward: false },
    },
    {
      name: "an ordinary subrange",
      state: () => turn(loaded(RUN), INWARD, 0.5),
      expected: { inward: true, outward: true },
    },
    {
      name: "the narrowest viewport the wheel can reach",
      state: (anchor) => atWheelFloor(RUN, anchor),
      expected: { inward: false, outward: true },
    },
    {
      name: "a run whose scans all share one retention time",
      // A real acquisition with a visible mark and no width to zoom.
      state: () => loaded({ low: 12.5, high: 12.5 }),
      expected: { inward: false, outward: false },
    },
    {
      name: "a run whose low edge does not survive being recovered exactly",
      /*
       * R1.2's case, and it still decides how the question is asked. Zooming out
       * here produces a gesture domain whose low edge is 0.012499999999988631 --
       * compared as a transient that is a change of one part in a hundred
       * million million, and the wheel would be claimed for it. Settled, the run
       * comes back exactly, and the honest answer is that nothing moved.
       */
      state: () => loaded({ low: 0.0125, high: 453.9875 }),
      expected: { inward: true, outward: false },
    },
    {
      name: "a viewport with no run loaded at all",
      state: () => initialViewerInteractionState,
      expected: { inward: false, outward: false },
    },
  ];

  for (const scenario of cases) {
    for (const [name, wheel] of [
      ["inward", INWARD],
      ["outward", OUTWARD],
    ] as const) {
      it(`${name} in ${scenario.name}`, () => {
        for (const anchor of ANCHORS) {
          const label = `anchor ${String(anchor)}`;
          const plan = planWheelGesture(scenario.state(anchor), wheel, anchor);

          expect(plan.handled, label).toBe(scenario.expected[name]);
          // An unclaimed event offers nothing to dispatch, so an input the
          // viewer did not consume can leave nothing behind either.
          expect(plan.event === null, label).toBe(!scenario.expected[name]);
        }
      });
    }

    it(`agrees with what the reducer would settle to in ${scenario.name}`, () => {
      for (const wheel of [INWARD, OUTWARD]) {
        for (const anchor of ANCHORS) {
          const state = scenario.state(anchor);

          expect(
            planWheelGesture(state, wheel, anchor).handled,
            `${String(wheel.deltaY)} at ${String(anchor)}`,
          ).toBe(wouldMoveTheAxis(state, wheel, anchor));
        }
      }
    });
  }

  it("owns a delta far too small to be a notch, if it moves the axis", () => {
    // The half of the rule a magnitude-aware planner could get wrong in one
    // direction: size is not what decides. One pixel is a real request, and it
    // changes the range on screen.
    const plan = planWheelGesture(loaded(RUN), pixels(-1), 0.5);

    expect(plan.handled).toBe(true);
    const width = (plan.nextDomain?.high ?? 0) - (plan.nextDomain?.low ?? 0);
    expect(width).toBeLessThan(RUN.high - RUN.low);
    expect(width).toBeGreaterThan((RUN.high - RUN.low) * 0.99);
  });

  it("does not own a delta of any size the arithmetic cannot use", () => {
    // And the other direction, which is where a magnitude-aware planner could
    // reopen the swallowed-scroll defect: a page of outward wheel at full range
    // is an enormous request for something that does not exist.
    for (const wheel of [pixels(1), pixels(240), pixels(4_000), lines(20)]) {
      const plan = planWheelGesture(loaded(RUN), wheel, 0.5);

      expect(plan.handled, String(wheel.deltaY)).toBe(false);
      expect(plan.event, String(wheel.deltaY)).toBeNull();
    }
  });

  it("declines a unit it cannot read, whatever the magnitude says", () => {
    for (const mode of [3, -1, Number.NaN]) {
      const plan = planWheelGesture(loaded(RUN), { deltaY: -100, deltaMode: mode }, 0.5);

      expect(plan.handled, String(mode)).toBe(false);
      expect(plan.event, String(mode)).toBeNull();
    }
  });

  it("declines a delta that is not a number, and one that is zero", () => {
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      expect(planWheelGesture(loaded(RUN), pixels(delta), 0.5).handled, String(delta)).toBe(
        false,
      );
    }
  });

  it("starts a gesture where there is none, and moves the one there is", () => {
    // The epoch is read from the state, never invented, and one stream of
    // events is one gesture however many events it is made of.
    const state = loaded(RUN);
    const first = planWheelGesture(state, INWARD, 0.5);
    expect(first.event?.type).toBe("gesture-started");

    const moving = viewerInteractionReducer(state, first.event as ViewerEvent);
    const epoch = activeGestureEpoch(moving);
    expect(epoch).not.toBeNull();

    expect(planWheelGesture(moving, INWARD, 0.5).event).toMatchObject({
      type: "gesture-moved",
      epoch,
    });
  });

  it("reports the range the event would leave, not the one it asked for", () => {
    const state = loaded(RUN);
    const plan = planWheelGesture(state, INWARD, 0.5);

    expect(plan.handled).toBe(true);
    expect(plan.nextDomain).toEqual(
      renderedDomain(viewerInteractionReducer(state, plan.event as ViewerEvent)),
    );
  });

  it("lets go of the wheel at the boundary rather than holding it turn after turn", () => {
    /*
     * R1.2's bound, re-checked under continuous magnitudes. `zoomDomain` floors
     * the span it asks for, so a pointer that moves between events can leave the
     * viewport a few parts in a quadrillion from where the floor was reached,
     * and the next event is a real -- and completely invisible -- change that the
     * rule claims. It claims it once, and then the arithmetic has converged.
     */
    const centred = atWheelFloor(RUN, 0.5);
    const before = renderedDomain(settled(centred)) as RetentionTimeDomain;
    let state = centred;
    let claimed = 0;

    for (let step = 0; step < 20; step += 1) {
      // The pointer at the left edge, which is not where the floor was reached.
      const next = turn(state, INWARD, 0);
      if (next === state) {
        break;
      }
      claimed += 1;
      state = next;
    }

    expect(claimed).toBeLessThanOrEqual(2);
    expect(planWheelGesture(state, INWARD, 0).handled).toBe(false);
    const after = renderedDomain(settled(state)) as RetentionTimeDomain;
    // Nothing a screen, or a retention time, could tell apart.
    const tolerance = (RUN.high - RUN.low) * 1e-12;
    expect(Math.abs(after.low - before.low)).toBeLessThan(tolerance);
    expect(Math.abs(after.high - before.high)).toBeLessThan(tolerance);
  });
});

/*
 * How far the wheel zooms, which is the question R1.3 answers.
 *
 * Before it, the planner was handed a direction, so `deltaY` of -1, -20 and -240
 * were one request: the same candidate range came back for all three. Zoom rate
 * was therefore decided by how many `WheelEvent` objects a device chose to emit
 * for one gesture, and from the whole run to the narrowest viewport took 57
 * events whatever those events said they were.
 *
 * These properties replace event counting, and they are asserted at the viewport
 * rather than in the arithmetic because that is where a reader meets them -- and
 * because a planner that read the magnitude and then dropped it on the way to
 * `zoomDomain` would pass every test in `wheelInput.test.ts`.
 */
describe("how far one wheel event zooms", () => {
  /** Runs a whole stream of events through the planner and settles it. */
  function afterTurning(stream: readonly WheelDelta[], anchor: number): RetentionTimeDomain {
    let state = loaded(RUN);
    for (const wheel of stream) {
      state = turn(state, wheel, anchor);
    }
    return renderedDomain(settled(state)) as RetentionTimeDomain;
  }

  function width(domain: RetentionTimeDomain): number {
    return domain.high - domain.low;
  }

  function repeated(count: number, wheel: WheelDelta): WheelDelta[] {
    return Array.from({ length: count }, () => wheel);
  }

  it("lands in the same place however finely one gesture is cut into events", () => {
    /*
     * The invariant that removes event count as a variable. The same total
     * travel, delivered as one event, as a hundred, and as uneven partitions,
     * arrives at the same range -- within ordinary double-precision drift over
     * the multiplications, which is the only tolerance here and is emphatically
     * not a user-facing epsilon for viewport equality.
     */
    const once = afterTurning([pixels(-100)], OFF_CENTRE);
    const partitions: readonly (readonly WheelDelta[])[] = [
      repeated(100, pixels(-1)),
      repeated(4, pixels(-25)),
      [pixels(-10), pixels(-30), pixels(-60)],
      [pixels(-0.5), pixels(-99.5)],
    ];

    for (const stream of partitions) {
      const many = afterTurning(stream, OFF_CENTRE);
      const label = `${String(stream.length)} events`;

      expect(Math.abs(width(many) - width(once)) / width(once), label).toBeLessThan(1e-9);
      expect(Math.abs(many.low - once.low) / width(once), label).toBeLessThan(1e-9);
      expect(Math.abs(many.high - once.high) / width(once), label).toBeLessThan(1e-9);
    }
  });

  it("does not slam a touchpad-shaped stream into the narrowest viewport", () => {
    /*
     * The reported defect, pinned as a number rather than as a feeling. Eighty
     * small events used to compound as 0.85^80 -- about two millionths of the
     * run, far past the 1/10,000 floor, so one flick arrived at maximum zoom.
     * Their normalized total is now -80 x 0.002 = -0.16, and the run keeps
     * 2^-0.16 of its span.
     */
    const after = afterTurning(repeated(80, pixels(-1)), OFF_CENTRE);
    const full = RUN.high - RUN.low;

    expect(width(after) / full).toBeCloseTo(2 ** -0.16, 9);
    expect(width(after)).toBeGreaterThan(full * 0.5);
    // Which is orders of magnitude clear of the floor it used to reach.
    expect(width(after)).toBeGreaterThan(minimumSpan(RUN) * 1_000);
  });

  it("still lets a deliberate stream reach the narrowest viewport", () => {
    // Normalization is not a speed limit. A reader who keeps scrolling still
    // gets all the way in; it takes the travel it says it takes.
    const after = afterTurning(repeated(400, pixels(-240)), 0.5);

    expect(width(after)).toBeCloseTo(minimumSpan(RUN), 12);
  });

  it("makes a bigger turn of the wheel a bigger change", () => {
    const inward = [-1, -20, -100, -240].map((delta) =>
      width(afterTurning([pixels(delta)], OFF_CENTRE)),
    );
    for (let step = 1; step < inward.length; step += 1) {
      expect(inward[step], String(step)).toBeLessThan(inward[step - 1]);
    }

    // And outward, from a subrange there is room to widen from.
    const outward = [1, 20, 100, 240].map((delta) =>
      width(afterTurning([pixels(-500), pixels(delta)], OFF_CENTRE)),
    );
    for (let step = 1; step < outward.length; step += 1) {
      expect(outward[step], String(step)).toBeGreaterThan(outward[step - 1]);
    }
  });

  it("reads the same request the same way whichever unit it arrives in", () => {
    // Twenty-five pixels is one line and five hundred is twenty of them, so
    // these are one gesture described three ways.
    expect(afterTurning([pixels(-25)], OFF_CENTRE)).toEqual(
      afterTurning([lines(-1)], OFF_CENTRE),
    );
    expect(afterTurning([pixels(-500)], OFF_CENTRE)).toEqual(
      afterTurning([lines(-20)], OFF_CENTRE),
    );
  });

  it("comes back to the range it started from when the wheel is turned back", () => {
    // Away from every boundary, where the clamp has no say. Reciprocity at the
    // viewport is not required at the edges of the run, and is not asserted
    // there.
    const there = afterTurning([pixels(-200)], OFF_CENTRE);
    const andBack = afterTurning([pixels(-200), pixels(200)], OFF_CENTRE);

    expect(width(there)).toBeLessThan(RUN.high - RUN.low);
    expect(width(andBack)).toBeCloseTo(RUN.high - RUN.low, 9);
  });

  it("keeps the retention time under the pointer, at every magnitude", () => {
    /*
     * Pointer anchoring, unchanged by normalization and load-bearing: the
     * magnitude decides how much the span shrinks, never what it shrinks
     * towards.
     */
    for (const anchor of [0.1, 0.5, 0.9]) {
      const held = RUN.low + (RUN.high - RUN.low) * anchor;

      for (const delta of [-1, -20, -100, -240]) {
        const after = afterTurning([pixels(delta)], anchor);

        expect(
          (held - after.low) / width(after),
          `${String(delta)} at ${String(anchor)}`,
        ).toBeCloseTo(anchor, 9);
      }
    }
  });

  it("uses the pointer's anchor rather than the button's centre", () => {
    const left = afterTurning([pixels(-100)], 0);
    const right = afterTurning([pixels(-100)], 1);

    expect(left.low).toBeCloseTo(RUN.low, 9);
    expect(right.high).toBeCloseTo(RUN.high, 9);
    expect(right.low).toBeGreaterThan(left.low);
  });

  it("moves less on one event than one press of the button does", () => {
    // The two gestures still differ, and now for a reason that is read from the
    // event rather than fixed: an ordinary notch is not a deliberate press.
    const notch = width(afterTurning([INWARD], 0.5));
    const press = planViewportAction(loaded(RUN), "zoom-in").nextDomain as RetentionTimeDomain;

    expect(notch).toBeGreaterThan(width(press));
    expect(notch).toBeLessThan(RUN.high - RUN.low);
  });
});
