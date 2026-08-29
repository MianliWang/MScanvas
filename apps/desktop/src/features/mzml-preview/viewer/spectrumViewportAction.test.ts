/**
 * One rule, asked of the m/z axis, and every boundary that falls out of it.
 *
 * The defect this closes is the one the retention-time control group was
 * repaired for, arriving on a second surface: a button that is enabled is a
 * claim that pressing it does something, and a wheel that is cancelled is a
 * claim that the panel used it. `Zoom out m/z` at full range, an inward wheel at
 * the narrowest window, and either of them over a spectrum whose points all
 * share one m/z are three ways of making that claim falsely -- and a swallowed
 * wheel is worse than a dead button, because the viewer column stops scrolling
 * and nothing appears to have happened at all.
 *
 * Enumerating those boundaries would be the same mistake in a longer form, so
 * nothing below asks "is this the full domain" or "is this the minimum span". It
 * asks one question -- **would taking this change what is on screen** -- and
 * reads the answers off.
 *
 * The invariant is asserted against a transcription rather than against the
 * planner's own reply: each case builds the action's event from `spectrumViewport.ts`'s
 * arithmetic and the product's shared step, runs the reducer, and compares
 * rendered domains itself. A planner that decided from the action's name, that
 * anchored a button somewhere other than the centre, that used a step of its
 * own, or that reported the range it asked for rather than the one committed,
 * parts company with that immediately.
 *
 * **Where that transcription stops being independent is stated rather than
 * implied.** The two limits -- a zoom asking for at least the whole spectrum,
 * and one asking for no more than the narrowest window the spectrum has -- are
 * spelled out in both, so for those two cases this suite is checking that the
 * planner agrees with a copy of itself. They are covered instead by the two
 * tests that name them directly, over domains measured to round the wrong way,
 * and by the mutations that remove each limit in turn. Everything between the
 * limits, which is every ordinary zoom, is `zoomMzDomain` unchanged and is
 * genuinely checked here.
 *
 * Pure throughout: no React, no DOM, no timers. What an adapter does with a plan
 * belongs to `SpectrumViewport.test.tsx`; whether the plan is honest belongs
 * here.
 */

import { describe, expect, it } from "vitest";

import type { SpectrumViewportDomain } from "../contracts";
import { initialViewerInteractionState, viewerInteractionReducer } from "./interactionState";
import type { RetentionTimeDomain } from "./scanModel";
import type { MzDomain, SpectrumViewportEvent, SpectrumViewportState } from "./spectrumViewport";
import {
  activeMzGestureEpoch,
  clampMzDomain,
  initialSpectrumViewportState,
  minimumMzSpan,
  mzDomain,
  panMzDomain,
  renderedMzDomain,
  spectrumViewportReducer,
  zoomMzDomain,
} from "./spectrumViewport";
import type {
  SpectrumViewportAction,
  VisibleSpectrumViewportAction,
} from "./spectrumViewportAction";
import {
  applySpectrumViewportAction,
  MZ_PAN_STEP,
  planMzWheelGesture,
  planRenderedMzTransition,
  planSpectrumViewportAction,
  VISIBLE_SPECTRUM_VIEWPORT_ACTIONS,
} from "./spectrumViewportAction";
import { ZOOM_STEP_FACTOR, planViewportAction } from "./viewportAction";
import type { WheelDelta } from "./wheelInput";
import { DOM_DELTA_LINE, DOM_DELTA_PIXEL, wheelZoomFactor } from "./wheelInput";

/** The keyboard reaches every action; the panel draws only the first three. */
type PanAction = Exclude<SpectrumViewportAction, VisibleSpectrumViewportAction>;

const VISIBLE: readonly VisibleSpectrumViewportAction[] = ["zoom-in", "zoom-out", "reset"];
const PANS: readonly PanAction[] = ["pan-left", "pan-right"];
const EVERY_ACTION: readonly SpectrumViewportAction[] = [...VISIBLE, ...PANS];

/** An ordinary spectrum's admitted m/z domain, wide enough to have a middle. */
const FULL: MzDomain = mzDomain(100, 500);

function admitted(low: number, high: number): SpectrumViewportDomain {
  return { state: "admitted", low, high };
}

const REFUSED: SpectrumViewportDomain = { state: "refused", reason: "sourceNotOrdered" };

/** Applies events in order, so a test reads as the sequence it is about. */
function run(state: SpectrumViewportState, ...events: SpectrumViewportEvent[]) {
  return events.reduce(spectrumViewportReducer, state);
}

/** A spectrum selected, with Rust's verdict about its domain, and nothing else. */
function selected(domain: SpectrumViewportDomain = admitted(FULL.low, FULL.high)) {
  return run(initialSpectrumViewportState, {
    type: "spectrum-selected",
    spectrumToken: "one",
    domain,
  });
}

/** The same spectrum, narrowed to a committed window by a deliberate step. */
function committedAt(low: number, high: number): SpectrumViewportState {
  return run(selected(), { type: "viewport-step", domain: mzDomain(low, high) });
}

/** Applies one action the way a press would, through the reducer. */
function take(state: SpectrumViewportState, action: SpectrumViewportAction) {
  const plan = planSpectrumViewportAction(state, action);
  return plan.event === null ? state : spectrumViewportReducer(state, plan.event);
}

/**
 * Zooms in until zooming in stops doing anything.
 *
 * Reached through canonical operations rather than by naming a magic window, so
 * the state under test is one the product can actually arrive at.
 */
function atMinimumSpan(): SpectrumViewportState {
  let state = selected();
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
 * A zoom about the centre, bounded by the spectrum's own two limits.
 *
 * The limits are transcribed here rather than left out, because they are part
 * of the *rule* and not of the planner's implementation. `zoomMzDomain` caps a
 * width at the source and floors it at the narrowest window the spectrum
 * allows, but it reaches both by scaling two edges away from a held point --
 * and recovering an edge from a centre rounds, so at either limit it answers
 * with a window that differs from the one it was given by about one part in ten
 * thousand million million. Nothing renders that difference, and acting on it
 * is how `Zoom out m/z` comes to be enabled at full range and how an outward
 * wheel comes to be swallowed by a panel that then does not move.
 *
 * So the rule this suite holds the planner to is the one stated in prose: a
 * zoom asking for at least the whole spectrum **is** the whole spectrum, and one
 * asking for no more than the narrowest window the spectrum allows has no width
 * left to give. Everything between the two limits is `zoomMzDomain` unchanged,
 * which is where the interesting arithmetic lives and where this transcription
 * is genuinely independent of it.
 */
function zoomedTo(shown: MzDomain, full: MzDomain, factor: number, anchor = 0.5): MzDomain {
  const fullSpan = full.high - full.low;
  const span = shown.high - shown.low;
  const smallest = minimumMzSpan(full);
  const next = Math.min(fullSpan, Math.max(smallest, span * factor));
  if (next >= fullSpan) {
    return mzDomain(full.low, full.high);
  }
  if (next <= smallest || next === span) {
    return shown;
  }
  return zoomMzDomain(shown, full, factor, anchor);
}

/**
 * The event an action would send, built here rather than read from the planner.
 *
 * This is what makes the invariant below an independent check. The candidate
 * comes from `spectrumViewport.ts`'s own arithmetic and the step from the
 * product's shared constant, so a planner that grew a second opinion about
 * either would disagree with this the moment it did.
 */
function eventFor(
  state: SpectrumViewportState,
  action: SpectrumViewportAction,
): SpectrumViewportEvent {
  const shown = renderedMzDomain(state);
  if (state.status !== "ready" || shown === null || action === "reset") {
    return { type: "viewport-reset" };
  }
  switch (action) {
    case "zoom-in":
      return { type: "viewport-step", domain: zoomedTo(shown, state.full, ZOOM_STEP_FACTOR) };
    case "zoom-out":
      return { type: "viewport-step", domain: zoomedTo(shown, state.full, 1 / ZOOM_STEP_FACTOR) };
    case "pan-left":
      return { type: "viewport-step", domain: panMzDomain(shown, state.full, -MZ_PAN_STEP) };
    case "pan-right":
      return { type: "viewport-step", domain: panMzDomain(shown, state.full, MZ_PAN_STEP) };
  }
}

/** Whether taking the action would change the range on screen. */
function wouldChangeWhatIsShown(
  state: SpectrumViewportState,
  action: SpectrumViewportAction,
): boolean {
  const shown = renderedMzDomain(state);
  const after = renderedMzDomain(spectrumViewportReducer(state, eventFor(state, action)));
  if (shown === null || after === null) {
    return false;
  }
  return after.low !== shown.low || after.high !== shown.high;
}

function width(domain: MzDomain): number {
  return domain.high - domain.low;
}

/**
 * A full range whose low edge does not survive being recovered exactly.
 *
 * The case that decides how equality is compared, and the reason this planner
 * asks the reducer rather than reading `zoomMzDomain`'s own output. Zooming out
 * at full range recovers the low edge as `held - (held - low)`, and that
 * subtraction rounds: 110.3 comes back as 110.29999999999995. Compared as a
 * transient that is a change of one part in a hundred million million, which no
 * screen has ever shown -- and the panel would claim the wheel for it.
 *
 * These are ordinary reported m/z endpoints rather than contrived ones. That is
 * the point: the arithmetic is exact for most spectra and not for this one, and
 * nothing about a file says which it will be.
 */
const FUZZY: MzDomain = mzDomain(110.3, 2000);

describe("what an m/z viewport control would do", () => {
  const cases: readonly {
    readonly name: string;
    readonly state: () => SpectrumViewportState;
    readonly expected: Readonly<Record<VisibleSpectrumViewportAction, boolean>>;
  }[] = [
    {
      name: "a spectrum showing its whole positive-span domain",
      state: () => selected(),
      // Nothing wider to show, and nothing to reset to.
      expected: { "zoom-in": true, "zoom-out": false, reset: false },
    },
    {
      name: "an ordinary subrange of it",
      state: () => take(selected(), "zoom-in"),
      expected: { "zoom-in": true, "zoom-out": true, reset: true },
    },
    {
      name: "the narrowest window the spectrum allows",
      state: atMinimumSpan,
      // Nothing narrower to show, but plenty wider.
      expected: { "zoom-in": false, "zoom-out": true, reset: true },
    },
    {
      name: "a spectrum whose points all share one m/z",
      state: () => selected(admitted(250.5, 250.5)),
      // A zero-width domain has no subrange and no superrange. The points are
      // still drawn -- a measurement at one m/z is a measurement -- but there is
      // nothing to zoom.
      expected: { "zoom-in": false, "zoom-out": false, reset: false },
    },
    {
      name: "a spectrum whose domain the figure contract refused",
      state: () => selected(REFUSED),
      // A refusal is a fact about drawability, and a viewport that does not
      // exist offers no control that pretends to move it.
      expected: { "zoom-in": false, "zoom-out": false, reset: false },
    },
    {
      name: "a panel with no spectrum selected at all",
      state: () => initialSpectrumViewportState,
      expected: { "zoom-in": false, "zoom-out": false, reset: false },
    },
  ];

  for (const scenario of cases) {
    for (const action of VISIBLE) {
      it(`${action} in ${scenario.name}`, () => {
        const state = scenario.state();

        expect(planSpectrumViewportAction(state, action).available).toBe(
          scenario.expected[action],
        );
      });
    }

    it(`agrees with what the reducer would render in ${scenario.name}`, () => {
      const state = scenario.state();

      for (const action of EVERY_ACTION) {
        expect(planSpectrumViewportAction(state, action).available, action).toBe(
          wouldChangeWhatIsShown(state, action),
        );
      }
    });
  }

  it("reports the range that would be shown, not the one it asked for", () => {
    const state = take(selected(), "zoom-in");
    const plan = planSpectrumViewportAction(state, "reset");

    expect(plan.available).toBe(true);
    expect(plan.nextDomain).toEqual({ low: 100, high: 500 });
    expect(plan.event).toEqual({ type: "viewport-reset" });
  });

  it("offers no event at all where there is nothing to do", () => {
    const plan = planSpectrumViewportAction(selected(), "zoom-out");

    expect(plan.available).toBe(false);
    expect(plan.event).toBeNull();
    expect(plan.nextDomain).toBeNull();
  });

  it("lands on the range it planned, for every action it offers", () => {
    // The plan's `nextDomain` is a promise about what dispatching its own event
    // does, so it is kept here by dispatching it. A planner that reported the
    // range it asked for rather than the one the reducer commits would pass
    // every availability case above and fail this.
    for (const scenario of cases) {
      for (const action of EVERY_ACTION) {
        const state = scenario.state();
        const plan = planSpectrumViewportAction(state, action);
        const label = `${action} in ${scenario.name}`;
        if (plan.event === null) {
          expect(plan.available, label).toBe(false);
          continue;
        }
        expect(renderedMzDomain(spectrumViewportReducer(state, plan.event)), label).toEqual(
          plan.nextDomain,
        );
      }
    }
  });

  it("calls a result that equals the range on screen no change, whatever object it is in", () => {
    // The arithmetic is deterministic, so a clamp that lands on the range
    // already shown produces the same numbers in a new object. Comparing
    // references would call that a change.
    const state = selected();
    const shown = renderedMzDomain(state) as MzDomain;
    const again = zoomMzDomain(shown, FULL, 1 / ZOOM_STEP_FACTOR, 0.5);

    expect(again).not.toBe(shown);
    expect(again).toEqual(shown);
    expect(planSpectrumViewportAction(state, "zoom-out").available).toBe(false);
  });

  it("stops zooming in at the width the spectrum's own floor names", () => {
    // Not because the planner looked for a boundary, but because the next zoom
    // would be asking for a width at or below the narrowest window this
    // spectrum allows -- and there is nothing there to show.
    const state = atMinimumSpan();
    const shown = renderedMzDomain(state) as MzDomain;
    const smallest = minimumMzSpan(FULL);

    expect(planSpectrumViewportAction(state, "zoom-in").available).toBe(false);
    // Down at the floor, and stopped by it rather than short of it: one more
    // step of the shared factor would ask for less than the spectrum allows.
    expect(width(shown)).toBeGreaterThanOrEqual(smallest);
    expect(width(shown) * ZOOM_STEP_FACTOR).toBeLessThanOrEqual(smallest);
    // And the way back is open, so this is a floor rather than a trap.
    expect(planSpectrumViewportAction(state, "zoom-out").available).toBe(true);
  });

  /**
   * The domains whose edges do not survive being recovered from a centre.
   *
   * Not contrived: ordinary reported m/z endpoints, chosen by measuring 121
   * plausible pairs and keeping the ones where the arithmetic rounds the wrong
   * way. Nine of those 121 do it at the centre anchor a button uses; twenty-one
   * do it at some anchor a wheel can land on. The rest are unremarkable, which
   * is why a suite built only from round numbers cannot see any of this.
   */
  const ROUNDS_BADLY: readonly (readonly [number, number])[] = [
    [110.3, 500],
    [110.3, 600.25],
    [133.7, 1200.75],
    [133.7, 1500.05],
    [133.7, 1650.9],
    [133.7, 1800.4],
    [133.7, 2000],
    [120.08, 1500.05],
    [204.9, 2500.125],
  ];

  it("gives the whole spectrum back when a zoom out asks for more than it has", () => {
    /*
     * The measured defect, pinned at the value it produced.
     *
     * `zoomMzDomain` at full range recovers the low edge from the held centre,
     * and for these domains that subtraction lands one unit in the last place
     * *above* `full.low` -- which `clampMzDomain` does not pull back, because it
     * only holds the edge from below. The window is then a subrange by value, so
     * `isFullMzDomain` says no, and everything downstream follows: `Zoom out
     * m/z` stays enabled at full range and the wheel is cancelled for a change
     * no screen can show, so the panel underneath stops scrolling.
     *
     * Asserted against the raw arithmetic as well as the planner, so this fails
     * if the repair is removed *and* documents why it cannot be removed.
     */
    for (const [low, high] of ROUNDS_BADLY) {
      const full = mzDomain(low, high);
      const label = `${String(low)}..${String(high)}`;
      const raw = zoomMzDomain(full, full, 1 / ZOOM_STEP_FACTOR, 0.5);
      // The arithmetic really does drift here; if it stopped, this fixture has
      // stopped being the case this test is about.
      expect(raw.low !== full.low || raw.high !== full.high, `${label} still drifts`).toBe(true);

      const state = selected(admitted(low, high));
      expect(planSpectrumViewportAction(state, "zoom-out").available, `button ${label}`).toBe(false);
      for (const anchor of [0, 0.25, 0.5, 0.75, 1]) {
        expect(
          planMzWheelGesture(state, { deltaY: 100, deltaMode: 0 }, anchor).handled,
          `wheel ${label} @${String(anchor)}`,
        ).toBe(false);
      }
      // And zooming in from full range is still offered, so the repair closed a
      // claim rather than the control.
      expect(planSpectrumViewportAction(state, "zoom-in").available, `in ${label}`).toBe(true);
    }
  });

  it("keeps zooming in until the spectrum's own floor, then stops exactly there", () => {
    /*
     * The other limit, and the direction an over-correction breaks. Refusing the
     * last step outright would leave `Zoom in m/z` disabled while the contract
     * would still narrow the window -- a control saying there is nothing to do
     * when there is, which is the availability rule broken quietly.
     *
     * So the floor has to be *reached*: the width the zooming stops at is the
     * one `minimumMzSpan` names, not something up to two-thirds wider.
     */
    for (const [low, high] of ROUNDS_BADLY) {
      const full = mzDomain(low, high);
      const label = `${String(low)}..${String(high)}`;
      let state = selected(admitted(low, high));
      for (let step = 0; step < 500; step += 1) {
        const plan = planSpectrumViewportAction(state, "zoom-in");
        if (plan.event === null) {
          break;
        }
        state = spectrumViewportReducer(state, plan.event);
      }
      const shown = renderedMzDomain(state) as MzDomain;
      const smallest = minimumMzSpan(full);
      // At the floor, to the precision two doubles can express an interval of
      // this width -- not one zoom step short of it.
      expect(width(shown) / smallest, `width ${label}`).toBeCloseTo(1, 9);
      expect(planSpectrumViewportAction(state, "zoom-in").available, `in ${label}`).toBe(false);
      expect(planSpectrumViewportAction(state, "zoom-out").available, `out ${label}`).toBe(true);
      for (const anchor of [0, 0.25, 0.5, 0.75, 1]) {
        expect(
          planMzWheelGesture(state, { deltaY: -100, deltaMode: 0 }, anchor).handled,
          `wheel ${label} @${String(anchor)}`,
        ).toBe(false);
      }
    }
  });

  /**
   * Endpoint pairs whose arithmetic does not survive a round trip through a
   * clamp, which is the family the boundary defects live in.
   *
   * Eleven lows against eleven highs rather than one hand-picked pair: the
   * measurement that found the zoom defect ran over these, and the pan defect
   * turned out to live in the same place. A single fixture would have shown
   * neither.
   */
  const EDGE_LOWS = [50, 50.5, 70.0625, 100, 100.0625, 110.3, 120.08, 133.7, 150.0725, 200.125, 204.9];
  const EDGE_HIGHS = [500, 600.25, 750.5, 800, 1000.3, 1200.75, 1500.05, 1650.9, 1800.4, 2000, 2500.125];

  /** Every plausible spectrum in that family, as a domain. */
  function edgeDomains(): readonly MzDomain[] {
    const pairs: MzDomain[] = [];
    for (const low of EDGE_LOWS) {
      for (const high of EDGE_HIGHS) {
        if (high > low) {
          pairs.push(mzDomain(low, high));
        }
      }
    }
    return pairs;
  }

  /** A viewport committed to one window of one spectrum. */
  function committedTo(full: MzDomain, window: MzDomain): SpectrumViewportState {
    return run(selected(admitted(full.low, full.high)), {
      type: "viewport-step",
      domain: window,
    });
  }

  it("offers no further pan once a window rests on the edge it is pushed toward", () => {
    /*
     * The defect, over the family it was measured in. A window already flush
     * against the source recomputes its far edge through a clamp, and that
     * subtraction rounds: `{525.15, 1000.3}` pans right to
     * `{525.1500000000001, 1000.3}`, which the planner compares by value and
     * calls a change. Forty-eight of 1,452 flush windows did it.
     *
     * What a reader got there was `ArrowRight` swallowed, a committed window
     * nothing on screen distinguishes from the one before it, and a fresh
     * bounded projection asked of Rust to draw it.
     */
    const offenders: string[] = [];
    let checked = 0;
    for (const full of edgeDomains()) {
      const fullSpan = full.high - full.low;
      for (const fraction of [0.5, 0.1, 0.01, 0.001, 0.0002, 0.0001]) {
        const width = Math.max(minimumMzSpan(full), fullSpan * fraction);
        const cases = [
          ["pan-left", clampMzDomain(mzDomain(full.low, full.low + width), full)],
          ["pan-right", clampMzDomain(mzDomain(full.high - width, full.high), full)],
        ] as const;
        for (const [way, window] of cases) {
          checked += 1;
          const plan = planSpectrumViewportAction(committedTo(full, window), way);
          if (plan.available) {
            offenders.push(`${String(full.low)}..${String(full.high)} ${way}`);
          }
        }
      }
    }
    expect({ checked, offenders }).toEqual({ checked, offenders: [] });
    expect(checked).toBeGreaterThan(1_400);
  });

  it("still offers a pan to a window with room left in that direction", () => {
    // The other half, or the rule above would be satisfied by refusing every
    // pan. A window one step inside each edge moves.
    for (const full of edgeDomains().slice(0, 12)) {
      const width = (full.high - full.low) / 4;
      const step = width * MZ_PAN_STEP;
      const label = `${String(full.low)}..${String(full.high)}`;

      const nearLow = clampMzDomain(mzDomain(full.low + step * 2, full.low + step * 2 + width), full);
      expect(planSpectrumViewportAction(committedTo(full, nearLow), "pan-left").available, `left ${label}`).toBe(true);

      const nearHigh = clampMzDomain(
        mzDomain(full.high - step * 2 - width, full.high - step * 2),
        full,
      );
      expect(planSpectrumViewportAction(committedTo(full, nearHigh), "pan-right").available, `right ${label}`).toBe(true);
    }
  });

  it("lands on the edge in one step, and offers nothing further in that direction", () => {
    /*
     * The step that reaches an edge is a real change and is offered; the step
     * after it is not. That pair is the whole rule, and testing only the second
     * half would be satisfied by a pan that never moved at all.
     */
    for (const full of edgeDomains().slice(0, 12)) {
      const width = (full.high - full.low) / 8;
      const step = width * MZ_PAN_STEP;
      const label = `${String(full.low)}..${String(full.high)}`;

      for (const [way, start] of [
        ["pan-left", clampMzDomain(mzDomain(full.low + step / 2, full.low + step / 2 + width), full)],
        ["pan-right", clampMzDomain(mzDomain(full.high - step / 2 - width, full.high - step / 2), full)],
      ] as const) {
        let state = committedTo(full, start);
        const arriving = planSpectrumViewportAction(state, way);
        expect(arriving.available, `${way} arriving ${label}`).toBe(true);
        state = run(state, arriving.event as SpectrumViewportEvent);

        const shown = renderedMzDomain(state) as MzDomain;
        // It arrived at the edge itself, not one rounding short of it.
        expect(way === "pan-left" ? shown.low : shown.high, `${way} edge ${label}`).toBe(
          way === "pan-left" ? full.low : full.high,
        );
        // And stays: repeated pushes in the same direction are inert by value.
        for (let again = 0; again < 3; again += 1) {
          expect(planSpectrumViewportAction(state, way).available, `${way} again ${label}`).toBe(false);
        }
        // The way back is open, so this is an edge rather than a trap.
        const back = way === "pan-left" ? "pan-right" : "pan-left";
        expect(planSpectrumViewportAction(state, back).available, `${back} ${label}`).toBe(true);
      }
    }
  });

  it("offers no pan at all for a spectrum with no width to pan across", () => {
    const flat = selected(admitted(250.5, 250.5));
    expect(planSpectrumViewportAction(flat, "pan-left").available).toBe(false);
    expect(planSpectrumViewportAction(flat, "pan-right").available).toBe(false);
  });

  it("moves an ordinary interior window by the step the product states", () => {
    // Nothing about the edges may change what a pan does in the middle.
    const full = mzDomain(100, 500);
    const window = mzDomain(250, 300);
    const state = committedTo(full, window);
    const plan = planSpectrumViewportAction(state, "pan-right");

    expect(plan.available).toBe(true);
    expect(plan.nextDomain).toEqual(panMzDomain(window, full, MZ_PAN_STEP));
  });

  it("leaves an inward wheel at that floor to the browser, at every anchor", () => {
    /*
     * The other half of the same limit, and the half that was measured wrong.
     * A wheel anchors under the pointer, so at the floor it has no width to
     * take and only a position to change -- which is a pan wearing a zoom's
     * clothes, and one the panel would have cancelled the event for. Asserted
     * across the anchor, because the defect this closes appeared only away from
     * the centre.
     */
    const state = atMinimumSpan();
    for (const anchor of [0, 0.25, 0.5, 0.75, 1]) {
      expect(
        planMzWheelGesture(state, { deltaY: -100, deltaMode: 0 }, anchor).handled,
        `anchor ${String(anchor)}`,
      ).toBe(false);
      expect(
        planMzWheelGesture(state, { deltaY: 100, deltaMode: 0 }, anchor).handled,
        `outward at anchor ${String(anchor)}`,
      ).toBe(true);
    }
  });

  it("does not claim availability for a change nobody would see", () => {
    /*
     * A gesture whose window is already the whole spectrum. Resetting would drop
     * the gesture -- a real change to the state -- and change nothing on screen.
     * A visible control speaks for what is visible.
     */
    const state = run(selected(), { type: "gesture-started", domain: mzDomain(0, 1_000) });
    expect(renderedMzDomain(state)).toEqual({ low: 100, high: 500 });
    expect(activeMzGestureEpoch(state)).not.toBeNull();

    expect(planSpectrumViewportAction(state, "reset").available).toBe(false);
    expect(planSpectrumViewportAction(state, "zoom-out").available).toBe(false);
    expect(planSpectrumViewportAction(state, "zoom-in").available).toBe(true);
  });

  it("speaks for the screen rather than for the state, while a drawing is outstanding", () => {
    /*
     * The two questions are genuinely different, and this is where they part.
     * Resetting a full-range viewport whose projection is loading *does* produce
     * a new state -- the request is abandoned and the projection returns to
     * `idle` -- and shows exactly the range that was already there. A planner
     * comparing states rather than rendered domains would offer `Reset m/z
     * range` for that, and a reader would press it and watch the plot reload
     * the range it was already looking at.
     */
    const state = run(selected(), { type: "projection-requested" });

    expect(spectrumViewportReducer(state, { type: "viewport-reset" })).not.toBe(state);
    expect(planSpectrumViewportAction(state, "reset").available).toBe(false);
    expect(planSpectrumViewportAction(state, "zoom-out").available).toBe(false);
  });
});

/*
 * Pan is judged by the rule that closes `Zoom out`, and that is the whole
 * argument for one action type rather than two.
 *
 * Pan has no button: the plot is dragged, and the arrow keys reach the same
 * transition. A keyboard route that dispatched an inert step -- committing a
 * window identical to the one on screen, dropping the projection, and asking
 * Rust for the drawing again -- would be the defect the buttons were repaired
 * for, moved somewhere nobody looks.
 */
describe("where a pan may go", () => {
  const cases: readonly {
    readonly name: string;
    readonly state: () => SpectrumViewportState;
    readonly expected: Readonly<Record<PanAction, boolean>>;
  }[] = [
    {
      name: "a window showing the whole spectrum",
      state: () => selected(),
      // There is nothing either side of the source to pan into.
      expected: { "pan-left": false, "pan-right": false },
    },
    {
      name: "a window flush against the low end",
      state: () => committedAt(100, 200),
      expected: { "pan-left": false, "pan-right": true },
    },
    {
      name: "a window in the middle of it",
      state: () => committedAt(250, 350),
      expected: { "pan-left": true, "pan-right": true },
    },
    {
      name: "a window flush against the high end",
      state: () => committedAt(400, 500),
      expected: { "pan-left": true, "pan-right": false },
    },
  ];

  for (const scenario of cases) {
    for (const action of PANS) {
      it(`${action} from ${scenario.name}`, () => {
        expect(planSpectrumViewportAction(scenario.state(), action).available).toBe(
          scenario.expected[action],
        );
      });
    }
  }

  it("agrees with what the reducer would render, wherever the window sits", () => {
    for (const scenario of cases) {
      for (const action of PANS) {
        const state = scenario.state();

        expect(
          planSpectrumViewportAction(state, action).available,
          `${action} from ${scenario.name}`,
        ).toBe(wouldChangeWhatIsShown(state, action));
      }
    }
  });

  it("offers no pan where there is no window to move", () => {
    const states: readonly { readonly name: string; readonly state: SpectrumViewportState }[] = [
      { name: "one m/z", state: selected(admitted(250.5, 250.5)) },
      { name: "refused", state: selected(REFUSED) },
      { name: "no spectrum", state: initialSpectrumViewportState },
    ];

    for (const { name, state } of states) {
      for (const action of PANS) {
        const plan = planSpectrumViewportAction(state, action);

        expect(plan.available, `${action} with ${name}`).toBe(false);
        expect(plan.event, `${action} with ${name}`).toBeNull();
      }
    }
  });

  it("moves a quarter of the visible window, and no part of the spectrum's", () => {
    // A pan is a fraction of what is on screen, so panning stays proportional
    // to how far zoomed in a reader is rather than jumping by a fixed share of
    // a source whose width they can no longer see.
    const narrow = planSpectrumViewportAction(committedAt(250, 350), "pan-right");
    const wide = planSpectrumViewportAction(committedAt(200, 400), "pan-right");

    expect(narrow.nextDomain).toEqual({
      low: 250 + 100 * MZ_PAN_STEP,
      high: 350 + 100 * MZ_PAN_STEP,
    });
    expect(wide.nextDomain).toEqual({
      low: 200 + 200 * MZ_PAN_STEP,
      high: 400 + 200 * MZ_PAN_STEP,
    });
  });
});

/*
 * What a settle changes about the answer.
 *
 * A gesture's rendered domain is the clamped window it holds; a settled one is
 * put through the normalisation every committed viewport gets, where a window
 * covering the whole spectrum becomes the spectrum. Asking the second question
 * rather than the first is what keeps a wheel turned outward at full range
 * unclaimed on a spectrum whose endpoints do not survive the arithmetic exactly.
 */
describe("one event, and what it settles to", () => {
  it("answers unchanged where there is no range on screen at all", () => {
    for (const state of [selected(REFUSED), initialSpectrumViewportState]) {
      const transition = planRenderedMzTransition(state, { type: "viewport-reset" });

      expect(transition.changed, state.status).toBe(false);
      expect(transition.nextDomain, state.status).toBeNull();
    }
  });

  it("gives the spectrum back exactly at a full range that does not round exactly", () => {
    const state = selected(admitted(FUZZY.low, FUZZY.high));
    // The arithmetic the planner's doc comment names, demonstrated rather than
    // asserted about: recovering the low edge from the anchor loses it.
    const held = FUZZY.low + width(FUZZY) * 0.5;
    expect(held - (held - FUZZY.low)).not.toBe(FUZZY.low);

    const candidate = zoomMzDomain(FUZZY, FUZZY, wheelZoomFactor(pixels(100)) as number, 0.5);
    const transition = planRenderedMzTransition(state, {
      type: "gesture-started",
      domain: candidate,
    });

    expect(transition.changed).toBe(false);
    expect(transition.nextDomain).toBeNull();
    // And the settle is where that answer comes from: the gesture is asked what
    // it commits, and it commits the spectrum itself.
    const dragging = run(state, { type: "gesture-started", domain: candidate });
    const epoch = activeMzGestureEpoch(dragging) as number;
    const done = run(dragging, { type: "gesture-settled", epoch });

    expect(done.status === "ready" && done.committed).toBeNull();
    expect(renderedMzDomain(done)).toEqual({ low: FUZZY.low, high: FUZZY.high });
  });

  it("reports the range a settle would commit, not the transient a gesture holds", () => {
    const state = committedAt(200, 300);
    const escaping: SpectrumViewportEvent = {
      type: "gesture-started",
      domain: mzDomain(0, 1_000),
    };

    const transition = planRenderedMzTransition(state, escaping);

    expect(transition.changed).toBe(true);
    expect(transition.nextDomain).toEqual({ low: 100, high: 500 });
    // The settled form of "the whole spectrum" is `null` rather than a window
    // that happens to carry the spectrum's numbers, and the projection above
    // reports what that renders.
    const dragging = run(state, escaping);
    const done = run(dragging, {
      type: "gesture-settled",
      epoch: activeMzGestureEpoch(dragging) as number,
    });
    expect(done.status === "ready" && done.committed).toBeNull();
  });

  it("compares by value, so the same numbers in a new object are not a change", () => {
    const state = selected();
    const shown = renderedMzDomain(state) as MzDomain;
    const same = mzDomain(shown.low, shown.high);

    expect(same).not.toBe(shown);
    expect(planRenderedMzTransition(state, { type: "viewport-step", domain: same }).changed).toBe(
      false,
    );
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

/** Settles whatever gesture is in flight, so a window can be compared. */
function settled(state: SpectrumViewportState): SpectrumViewportState {
  const epoch = activeMzGestureEpoch(state);
  return epoch === null
    ? state
    : spectrumViewportReducer(state, { type: "gesture-settled", epoch });
}

/** Sends one wheel event, if the panel would take it. */
function turn(
  state: SpectrumViewportState,
  wheel: WheelDelta,
  anchor: number,
): SpectrumViewportState {
  const plan = planMzWheelGesture(state, wheel, anchor);
  return plan.event === null ? state : spectrumViewportReducer(state, plan.event);
}

/*
 * The same question, asked of a gesture instead of a press.
 *
 * Two rules meet in this planner and are deliberately not the same rule.
 * `wheelInput.ts` decides **how much** one event asks for, from its own
 * magnitude and unit, and it is the product's rule rather than this axis's --
 * the same physical travel has to ask the same thing of either plot. This
 * planner decides **whether the panel owns the event**, which is the rule
 * above unchanged: only if the resulting canonical interaction would change the
 * settled rendered domain. The cases that matter most are the ones where the
 * two interact -- a large delta at a boundary is still not ours, and a very
 * small one that moves the axis still is.
 *
 * The refused and unselected cases are here rather than at the component,
 * because a panel with no viewport draws no plot for a wheel to arrive at. The
 * planner is where those states can be asked the question at all.
 */
describe("whether the panel owns one wheel event", () => {
  const ANCHORS = [0, 0.5, 1] as const;

  /** Whether the event would change the range on screen, worked out here. */
  function wouldMoveTheAxis(
    state: SpectrumViewportState,
    wheel: WheelDelta,
    anchor: number,
  ): boolean {
    const shown = renderedMzDomain(state);
    const factor = wheelZoomFactor(wheel);
    if (state.status !== "ready" || shown === null || factor === null) {
      return false;
    }
    const candidate = zoomedTo(shown, state.full, factor, anchor);
    const epoch = activeMzGestureEpoch(state);
    const applied = spectrumViewportReducer(
      state,
      epoch === null
        ? { type: "gesture-started", domain: candidate }
        : { type: "gesture-moved", epoch, domain: candidate },
    );
    // Carried to its conclusion, because an unsettled gesture is not finished,
    // and what it settles to is what the reader is left looking at.
    const after = renderedMzDomain(settled(applied));
    return after !== null && (after.low !== shown.low || after.high !== shown.high);
  }

  /**
   * Turns the wheel inward, at this pointer position, until it stops doing
   * anything.
   *
   * The anchor is a parameter because the narrowest window is not one range.
   * `zoomMzDomain` floors the span it asks for, and the last event before the
   * floor lands wherever the pointer held it, so a wheel turned at the left edge
   * of the plot comes to rest against a slightly different pair of numbers than
   * one turned at the middle. Reaching the floor the same way it is then asked
   * about keeps this a statement about the product's boundary rather than about
   * one arbitrary window that happens to sit near it.
   */
  function atWheelFloor(anchor: number): SpectrumViewportState {
    let state = selected();
    for (let step = 0; step < 2_000; step += 1) {
      const next = turn(state, INWARD, anchor);
      if (next === state) {
        return state;
      }
      state = next;
    }
    throw new Error("the wheel never ran out of spectrum");
  }

  const cases: readonly {
    readonly name: string;
    readonly state: (anchor: number) => SpectrumViewportState;
    readonly expected: { readonly inward: boolean; readonly outward: boolean };
  }[] = [
    {
      name: "a spectrum showing its whole positive-span domain",
      // The state the panel opens in, and the one a reader is in when they want
      // to reach whatever is below the plot.
      state: () => selected(),
      expected: { inward: true, outward: false },
    },
    {
      name: "an ordinary subrange of it",
      state: () => turn(selected(), INWARD, 0.5),
      expected: { inward: true, outward: true },
    },
    {
      name: "the narrowest window the wheel can reach",
      state: atWheelFloor,
      expected: { inward: false, outward: true },
    },
    {
      name: "a spectrum whose points all share one m/z",
      // A real acquisition with a visible stick and no width to zoom.
      state: () => selected(admitted(250.5, 250.5)),
      expected: { inward: false, outward: false },
    },
    {
      name: "a full range that does not round exactly",
      // Settled, the spectrum comes back exactly, and the honest answer is that
      // turning the wheel outward there moves nothing.
      state: () => selected(admitted(FUZZY.low, FUZZY.high)),
      expected: { inward: true, outward: false },
    },
    {
      name: "a spectrum whose domain the figure contract refused",
      // The page keeps the scroll. A refusal owns no wheel event.
      state: () => selected(REFUSED),
      expected: { inward: false, outward: false },
    },
    {
      name: "a panel with no spectrum selected at all",
      state: () => initialSpectrumViewportState,
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
          const plan = planMzWheelGesture(scenario.state(anchor), wheel, anchor);

          expect(plan.handled, label).toBe(scenario.expected[name]);
          // An unclaimed event offers nothing to dispatch, so an input the panel
          // did not consume can leave nothing behind either.
          expect(plan.event === null, label).toBe(!scenario.expected[name]);
        }
      });
    }

    it(`agrees with what the reducer would settle to in ${scenario.name}`, () => {
      for (const wheel of [INWARD, OUTWARD]) {
        for (const anchor of ANCHORS) {
          const state = scenario.state(anchor);

          expect(
            planMzWheelGesture(state, wheel, anchor).handled,
            `${String(wheel.deltaY)} at ${String(anchor)}`,
          ).toBe(wouldMoveTheAxis(state, wheel, anchor));
        }
      }
    });
  }

  it("starts a gesture where there is none, and moves the one there is", () => {
    const state = selected();
    const first = planMzWheelGesture(state, INWARD, 0.5);
    expect(first.event?.type).toBe("gesture-started");

    const moving = spectrumViewportReducer(state, first.event as SpectrumViewportEvent);
    const epoch = activeMzGestureEpoch(moving);
    expect(epoch).not.toBeNull();

    expect(planMzWheelGesture(moving, INWARD, 0.5).event).toMatchObject({
      type: "gesture-moved",
      epoch,
    });
  });

  it("carries one stream of events on one epoch, however many arrive", () => {
    /*
     * The epoch is read from the state, never allocated here. An adapter that
     * invented one could address a gesture that is not its own; a planner that
     * started a second gesture per event would leave the first one's settle
     * addressing an epoch nothing would answer, and every event after the first
     * would commit a window of its own.
     */
    let state = turn(selected(), INWARD, OFF_CENTRE);
    const epoch = activeMzGestureEpoch(state);
    expect(epoch).not.toBeNull();

    for (let event = 0; event < 8; event += 1) {
      const plan = planMzWheelGesture(state, INWARD, OFF_CENTRE);

      expect(plan.event, String(event)).toMatchObject({ type: "gesture-moved", epoch });
      state = spectrumViewportReducer(state, plan.event as SpectrumViewportEvent);
      expect(activeMzGestureEpoch(state), String(event)).toBe(epoch);
    }

    expect(state.status === "ready" && state.committed).toBeNull();
  });

  it("declines a unit it cannot read, whatever the magnitude says", () => {
    // A `deltaMode` this code has never heard of could mean anything, and
    // reading it as pixels would turn some future device's ordinary scroll into
    // a wild zoom. Declining leaves the page with its scroll.
    for (const mode of [7, 3, -1, Number.NaN]) {
      const plan = planMzWheelGesture(selected(), { deltaY: -100, deltaMode: mode }, 0.5);

      expect(plan.handled, String(mode)).toBe(false);
      expect(plan.event, String(mode)).toBeNull();
      expect(plan.nextDomain, String(mode)).toBeNull();
    }
  });

  it("declines a delta that is not a number, and one that is zero", () => {
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0]) {
      const plan = planMzWheelGesture(selected(), pixels(delta), 0.5);

      expect(plan.handled, String(delta)).toBe(false);
      expect(plan.event, String(delta)).toBeNull();
    }
  });

  it("does not own a delta of any size the arithmetic cannot use", () => {
    // Where a magnitude-aware planner could reopen the swallowed-scroll defect:
    // a page of outward wheel at full range is an enormous request for
    // something that does not exist.
    for (const wheel of [pixels(1), pixels(240), pixels(4_000), lines(20)]) {
      const plan = planMzWheelGesture(selected(), wheel, 0.5);

      expect(plan.handled, String(wheel.deltaY)).toBe(false);
      expect(plan.event, String(wheel.deltaY)).toBeNull();
    }
  });

  it("owns a delta far too small to be a notch, if it moves the m/z axis", () => {
    // The other half of the rule: size is not what decides. One pixel is a real
    // request, and it changes the range on screen.
    const plan = planMzWheelGesture(selected(), pixels(-1), 0.5);

    expect(plan.handled).toBe(true);
    const span = width(plan.nextDomain as MzDomain);
    expect(span).toBeLessThan(width(FULL));
    expect(span).toBeGreaterThan(width(FULL) * 0.99);
  });

  it("reports the range the event would leave, not the one it asked for", () => {
    const state = selected();
    const plan = planMzWheelGesture(state, INWARD, 0.5);

    expect(plan.handled).toBe(true);
    expect(plan.nextDomain).toEqual(
      renderedMzDomain(spectrumViewportReducer(state, plan.event as SpectrumViewportEvent)),
    );
  });
});

/*
 * How far one wheel event zooms the m/z axis.
 *
 * The rate is a continuous function of the normalized delta rather than of how
 * many `WheelEvent` objects a device chose to emit for one gesture. That
 * property is proved as algebra in `wheelInput.test.ts`; it is proved here at
 * the viewport, because a planner that read the magnitude and then dropped it
 * on the way to `zoomMzDomain` would pass every test there.
 */
describe("how far one wheel event zooms the m/z axis", () => {
  /** Runs a whole stream of events through the planner and settles it. */
  function afterTurning(stream: readonly WheelDelta[], anchor: number): MzDomain {
    let state = selected();
    for (const wheel of stream) {
      state = turn(state, wheel, anchor);
    }
    return renderedMzDomain(settled(state)) as MzDomain;
  }

  function repeated(count: number, wheel: WheelDelta): WheelDelta[] {
    return Array.from({ length: count }, () => wheel);
  }

  it("lands in the same place however finely one gesture is cut into events", () => {
    /*
     * The invariant that removes event count as a variable. One wheel of -100
     * pixels and a hundred of -1 are the same travel and reach the same span,
     * because the mapping is exponential and 2^-0.2 is (2^-0.002)^100. The
     * tolerance is ordinary double-precision drift over the multiplications and
     * is emphatically not a user-facing epsilon for viewport equality.
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

  it("makes a bigger turn of the wheel a bigger change", () => {
    const inward = [-1, -20, -100, -240].map((delta) =>
      width(afterTurning([pixels(delta)], OFF_CENTRE)),
    );
    for (let step = 1; step < inward.length; step += 1) {
      expect(inward[step], String(step)).toBeLessThan(inward[step - 1]);
    }

    // And outward, from a subrange there is room to widen from.
    const outward = [1, 20, 100, 240].map((delta) =>
      width(afterTurning([pixels(-300), pixels(delta)], OFF_CENTRE)),
    );
    for (let step = 1; step < outward.length; step += 1) {
      expect(outward[step], String(step)).toBeGreaterThan(outward[step - 1]);
    }
  });

  it("reads the same request the same way whichever unit it arrives in", () => {
    // Twenty-five pixels is one line and five hundred is twenty of them, so
    // these are one gesture described three ways -- and a reader with a mouse
    // and a reader with a touchpad zoom the same spectrum at the same rate.
    expect(afterTurning([pixels(-25)], OFF_CENTRE)).toEqual(afterTurning([lines(-1)], OFF_CENTRE));
    expect(afterTurning([pixels(-500)], OFF_CENTRE)).toEqual(
      afterTurning([lines(-20)], OFF_CENTRE),
    );
  });

  it("keeps the m/z under the pointer, at every magnitude", () => {
    /*
     * Pointer anchoring, and load-bearing: the magnitude decides how much the
     * span shrinks, never what it shrinks towards. A reader zooms into the peak
     * they are pointing at.
     */
    for (const anchor of [0.1, 0.5, 0.9]) {
      const held = FULL.low + width(FULL) * anchor;

      for (const delta of [-1, -20, -100, -240]) {
        const after = afterTurning([pixels(delta)], anchor);

        expect(
          (held - after.low) / width(after),
          `${String(delta)} at ${String(anchor)}`,
        ).toBeCloseTo(anchor, 9);
      }
    }
  });

  it("moves less on one event than one press of the button does", () => {
    // The two gestures differ, and for a reason read from the event rather than
    // fixed: an ordinary notch is not a deliberate press.
    const notch = width(afterTurning([INWARD], 0.5));
    const press = planSpectrumViewportAction(selected(), "zoom-in").nextDomain as MzDomain;

    expect(notch).toBeGreaterThan(width(press));
    expect(notch).toBeLessThan(width(FULL));
  });
});

/** A dispatch that records what it was given and applies it. */
function recording(state: SpectrumViewportState) {
  const events: SpectrumViewportEvent[] = [];
  let current = state;
  return {
    events,
    dispatch: (event: SpectrumViewportEvent): SpectrumViewportState => {
      events.push(event);
      current = spectrumViewportReducer(current, event);
      return current;
    },
    latest: () => current,
  };
}

describe("taking an action against the state that is actually current", () => {
  it("dispatches the event it planned, and answers that it did", () => {
    const state = committedAt(200, 300);
    const sink = recording(state);

    expect(applySpectrumViewportAction(state, sink.dispatch, "reset")).toBe(true);
    expect(sink.events).toEqual([{ type: "viewport-reset" }]);
    expect(renderedMzDomain(sink.latest())).toEqual({ low: 100, high: 500 });
  });

  it("dispatches nothing at a boundary, and answers that it did not", () => {
    // What a keyboard handler reads to decide whether the key was this panel's
    // to consume. A key that reaches a boundary is not consumed, so the arrow
    // still moves the page.
    const boundaries: readonly {
      readonly name: string;
      readonly state: SpectrumViewportState;
      readonly action: SpectrumViewportAction;
    }[] = [
      { name: "zoom out at full range", state: selected(), action: "zoom-out" },
      { name: "reset at full range", state: selected(), action: "reset" },
      { name: "pan left at the low end", state: committedAt(100, 200), action: "pan-left" },
      { name: "pan right at the high end", state: committedAt(400, 500), action: "pan-right" },
      { name: "zoom in at the narrowest window", state: atMinimumSpan(), action: "zoom-in" },
    ];

    for (const boundary of boundaries) {
      const sink = recording(boundary.state);

      expect(
        applySpectrumViewportAction(boundary.state, sink.dispatch, boundary.action),
        boundary.name,
      ).toBe(false);
      expect(sink.events, boundary.name).toEqual([]);
    }
  });

  it("plans again from the state it is given rather than from an older render", () => {
    /*
     * The state can move between the render that drew the button and the press
     * that reaches it -- a settling gesture, a projection arriving, a different
     * spectrum selected. A render of the narrowed viewport would have drawn
     * `Zoom out m/z` enabled; by the time the press arrives the viewport is back
     * at full range, and the guard is what makes the press inert rather than the
     * boolean that render captured.
     */
    const rendered = committedAt(200, 300);
    expect(planSpectrumViewportAction(rendered, "zoom-out").available).toBe(true);

    const live = run(rendered, { type: "viewport-reset" });
    const sink = recording(live);

    expect(applySpectrumViewportAction(live, sink.dispatch, "zoom-out")).toBe(false);
    expect(sink.events).toEqual([]);
  });

  it("answers false for every action a panel with no viewport could be asked", () => {
    for (const state of [selected(REFUSED), initialSpectrumViewportState]) {
      for (const action of EVERY_ACTION) {
        const sink = recording(state);
        const label = `${action} with ${state.status}`;

        expect(applySpectrumViewportAction(state, sink.dispatch, action), label).toBe(false);
        expect(sink.events, label).toEqual([]);
      }
    }
  });
});

/*
 * One zoom step, and two axes.
 *
 * `ZOOM_STEP_FACTOR` is imported from `viewportAction.ts` rather than restated
 * here, and this is the regression guard for that. A second step constant would
 * make the same button move a different distance depending on which plot it
 * happened to sit over -- a difference nobody would report as a bug and every
 * reader would feel.
 */
describe("one zoom step, and two axes", () => {
  const RUN: RetentionTimeDomain = { low: 100, high: 500 };

  function loaded() {
    return viewerInteractionReducer(initialViewerInteractionState, {
      type: "preview-loaded",
      fullDomain: RUN,
    });
  }

  it("zooms m/z by the step the retention-time axis is zoomed by", () => {
    const mz = planSpectrumViewportAction(selected(), "zoom-in").nextDomain as MzDomain;

    expect(width(mz) / width(FULL)).toBe(ZOOM_STEP_FACTOR);
  });

  it("moves the two plots to the same window, given the same numbers", () => {
    // The same interval, measured on two axes, zoomed by one press each. If a
    // second constant ever appeared, these two would part company here and
    // nowhere else in the suite.
    const mz = planSpectrumViewportAction(selected(), "zoom-in").nextDomain as MzDomain;
    const time = planViewportAction(loaded(), "zoom-in").nextDomain as RetentionTimeDomain;

    expect({ low: mz.low, high: mz.high }).toEqual({ low: time.low, high: time.high });
  });
});

describe("the controls the panel draws", () => {
  it("names the axis in every label, so two zoom controls are told apart", () => {
    // `Zoom in` alone would be the second control in this window with that
    // accessible name -- the chromatogram already offers one -- and two surfaces
    // offering the same verb have to be distinguishable to someone who is being
    // read the interface rather than looking at it.
    for (const control of VISIBLE_SPECTRUM_VIEWPORT_ACTIONS) {
      expect(control.label, control.action).toMatch(/m\/z/);
    }

    const labels = VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.map((control) => control.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("draws a button for the three actions that have one, and for no other", () => {
    // One list, so the render and the keyboard cannot drift apart about which
    // controls exist. Pan is reachable and has no button: the plot is dragged,
    // and the arrow keys reach the same transition.
    expect(VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.map((control) => control.action)).toEqual([
      ...VISIBLE,
    ]);
    for (const pan of PANS) {
      expect(
        VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.some((control) => (control.action as string) === pan),
        pan,
      ).toBe(false);
    }
  });
});
