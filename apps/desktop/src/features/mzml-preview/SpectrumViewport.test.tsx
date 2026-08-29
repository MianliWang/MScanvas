/**
 * The visible m/z viewport, against the contract it is an adapter over.
 *
 * M5.1 shipped the reducer, the planner and a bounded screen projection, and
 * put nothing on screen. This file is about the seam M5.2 added: a component
 * that turns wheel notches, pointer frames and key presses into the events
 * ADR 0038 names, and draws what comes back.
 *
 * The defect it exists to prevent is the one that seam invites -- a renderer
 * answering, from geometry it happens to hold, a question the contract has
 * already answered. So the cases are chosen to fail if any of these is decided
 * locally:
 *
 * - a button, a key and a wheel are live exactly when putting them through the
 *   reducer would change the range on screen, and one that would not is left to
 *   the column that scrolls;
 * - what is drawn answers the axis it is drawn under -- a newly committed
 *   window draws nothing until its own drawing arrives, and a stale answer,
 *   success or failure alike, changes nothing;
 * - one press owns the plot until that same press ends it, and its pan is
 *   measured from where it began rather than from the previous frame;
 * - a spectrum with no admitted domain is still a spectrum: its points are
 *   drawn over their own range, the reason is stated, and nothing about it
 *   pretends to be navigable.
 *
 * Whether the viewport moved and whether the browser event was claimed are two
 * different failures -- one is the product's behaviour, the other is who the
 * input belonged to -- so every wheel and every key case asserts both.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewError, SpectrumProjection, SpectrumViewportDomain } from "./contracts";
import { formatMz } from "./format";
import { SpectrumViewport } from "./SpectrumViewport";
import {
  SPECTRUM_PLOT_DRAWN_WIDTH,
  SPECTRUM_PLOT_PADDING_LEFT,
  SPECTRUM_PLOT_VIEWBOX_WIDTH,
} from "./StickSpectrum";
import type { SpectrumViewportEvent, SpectrumViewportState } from "./viewer/spectrumViewport";
import { mzDomain, renderedMzDomain } from "./viewer/spectrumViewport";
import type { SpectrumViewportAction } from "./viewer/spectrumViewportAction";
import {
  applySpectrumViewportAction,
  MZ_PAN_STEP,
  VISIBLE_SPECTRUM_VIEWPORT_ACTIONS,
} from "./viewer/spectrumViewportAction";
import type { SpectrumViewportController } from "./viewer/useSpectrumViewport";
import { useSpectrumViewport } from "./viewer/useSpectrumViewport";
import { ZOOM_STEP_FACTOR } from "./viewer/viewportAction";

/**
 * The spectrum every admitted case navigates.
 *
 * A span of 400, so the narrowest window the contract allows is 0.04 and can be
 * named exactly rather than reached by pressing a button two hundred times.
 */
const FULL: SpectrumViewportDomain = { state: "admitted", low: 100, high: 500 };
const MINIMUM_SPAN = 400 * (1 / 10_000);

/** A spectrum whose points all report one m/z: a domain with no width. */
const FLAT: SpectrumViewportDomain = { state: "admitted", low: 250, high: 250 };

/** Rust's verdict that no domain can be established without altering the data. */
const REFUSED: SpectrumViewportDomain = { state: "refused", reason: "sourceNotOrdered" };

/** The plot's own width in client pixels, so one viewBox unit is one pixel. */
const PLOT_PIXELS = SPECTRUM_PLOT_VIEWBOX_WIDTH;

/** The middle of the drawn band, which is where a wheel anchors by default. */
const CENTRE_X = SPECTRUM_PLOT_PADDING_LEFT + SPECTRUM_PLOT_DRAWN_WIDTH / 2;

const HEADING_ID = "selected-spectrum-heading";
const HEADING = "Selected spectrum";

const CONTROLS = ["Zoom in m/z", "Zoom out m/z", "Reset m/z range"] as const;
const RETRY = "Draw this m/z range again";

/** One wheel notch inward and one outward, in the unit nearly every device uses. */
const IN = -240;
const OUT = 240;

/**
 * The arrays this document received, drawn where there is no viewport.
 *
 * Three points inside the reported pair, so the transfer caption has a count to
 * state and a refused spectrum can be shown to be drawn rather than blanked.
 */
const TRANSFERRED_MZ: readonly number[] = [120, 260, 480];
const TRANSFERRED_INTENSITY: readonly number[] = [10, 90, 30];

/** A drawing of the window every projection case commits to. */
const DRAWN: SpectrumProjection = {
  low: 200,
  high: 300,
  mz: [210, 250, 290],
  intensity: [10, 40, 25],
  sourcePoints: 3,
  reduced: false,
};

/** The same window, truthfully holding no reported point. */
const NO_POINT_IN_WINDOW: SpectrumProjection = {
  low: 200,
  high: 300,
  mz: [],
  intensity: [],
  sourcePoints: 0,
  reduced: false,
};

const PROJECTION_ERROR: PreviewError = {
  kind: "spectrumProjection",
  summary: "The retained spectrum did not answer.",
  detail: "The reader was busy with another request.",
  retryable: true,
};

interface Shown {
  readonly low: number;
  readonly high: number;
}

let controller: SpectrumViewportController | null = null;

/**
 * How many times the surface's owner has been asked to render.
 *
 * The panel and the workspace above it render from the same published state, so
 * counting here counts what a pointer frame would have cost them: the facts
 * list, the precursor list, the export controls, and a fresh reduction over the
 * projection, once per browser pointer frame.
 */
let ownerRenders = 0;

function Harness({
  domain,
  intensity,
  mz,
  onRetryProjection,
  projectionError,
}: {
  readonly domain: SpectrumViewportDomain | null;
  readonly intensity: readonly number[];
  readonly mz: readonly number[];
  readonly onRetryProjection: () => void;
  readonly projectionError: PreviewError | null;
}) {
  const viewport = useSpectrumViewport();
  controller = viewport;
  ownerRenders += 1;
  const { dispatch } = viewport;
  // The announcement the workspace makes, in the same phase it makes it, so the
  // first painted frame already knows whether this spectrum has a range at all.
  useLayoutEffect(() => {
    if (domain !== null) {
      dispatch({ type: "spectrum-selected", spectrumToken: "a", domain });
    }
  }, [dispatch, domain]);
  return (
    <>
      <h3 id={HEADING_ID}>{HEADING}</h3>
      <SpectrumViewport
        dispatch={viewport.dispatch}
        intensity={intensity}
        labelledBy={HEADING_ID}
        mz={mz}
        onRetryProjection={onRetryProjection}
        projectionError={projectionError}
        readState={viewport.current}
        reportedMzHigh={500}
        reportedMzLow={100}
        representationKnown
        state={viewport.state}
      />
    </>
  );
}

function renderViewport(
  options: {
    readonly domain?: SpectrumViewportDomain | null;
    readonly projectionError?: PreviewError | null;
  } = {},
): { readonly onRetryProjection: ReturnType<typeof vi.fn> } {
  const onRetryProjection = vi.fn();
  render(
    <Harness
      domain={options.domain === undefined ? FULL : options.domain}
      intensity={TRANSFERRED_INTENSITY}
      mz={TRANSFERRED_MZ}
      onRetryProjection={onRetryProjection}
      projectionError={options.projectionError ?? null}
    />,
  );
  givePlotABox();
  return { onRetryProjection };
}

/**
 * A plot element with a real box, because jsdom gives every element a zero one.
 *
 * Both interactions that read a coordinate -- the wheel's anchor and the drag's
 * displacement -- divide by this width. Without it every pointer position would
 * resolve to the same fraction and every anchored case would pass for the wrong
 * reason.
 */
function givePlotABox(): void {
  plotBox = vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PLOT_PIXELS,
    bottom: 260,
    width: PLOT_PIXELS,
    height: 260,
    toJSON: () => ({}),
  } as DOMRect);
}

/**
 * The spy `givePlotABox` installs, so a case can ask whether layout was read.
 *
 * Reading it is how "released before anything is measured" becomes a fact
 * rather than a claim about the order of lines in a handler.
 */
let plotBox: { readonly mock: { readonly calls: readonly unknown[] } } | null = null;

/** How many times the adapter has measured the plot. */
function layoutReads(): number {
  if (plotBox === null) {
    throw new Error("this render installed no plot box");
  }
  return plotBox.mock.calls.length;
}

/** The drawing: where the wheel is claimed and where a key press lands. */
function plot(): HTMLElement {
  return screen.getByRole("img", { name: HEADING });
}

/** The pointer surface, which exists only where there is a viewport to drag. */
function pointerSurface(): HTMLElement {
  const element = document.querySelector<HTMLElement>("div.spectrum-viewport-plot");
  if (element === null) {
    throw new Error("this viewport offers no pointer surface");
  }
  return element;
}

function control(label: (typeof CONTROLS)[number]): HTMLButtonElement {
  return screen.getByRole("button", { name: label }) as HTMLButtonElement;
}

function state(): SpectrumViewportState {
  if (controller === null) {
    throw new Error("the harness published no controller");
  }
  return controller.state;
}

/** The state, narrowed to the one variant that has a range in it. */
function ready(): SpectrumViewportState & { readonly status: "ready" } {
  const current = state();
  if (current.status !== "ready") {
    throw new Error(`expected an admitted viewport, got ${current.status}`);
  }
  return current;
}

function shown(): Shown {
  const domain = renderedMzDomain(state());
  if (domain === null) {
    throw new Error("no m/z range is on screen");
  }
  return domain;
}

/**
 * The state as the contract holds it right now, published or not.
 *
 * A gesture's frames are applied to the reducer and deliberately not published,
 * so `state()` is what React drew and this is what the reducer knows. Tests
 * about a gesture in flight ask this one; tests about what a reader sees ask the
 * other, and the difference between them is the property that keeps pointer
 * frames off the panel's render path.
 */
function live(): SpectrumViewportState {
  if (controller === null) {
    throw new Error("the harness published no controller");
  }
  return controller.current();
}

function liveShown(): Shown {
  const domain = renderedMzDomain(live());
  if (domain === null) {
    throw new Error("no m/z range is live");
  }
  return domain;
}

function dispatchNow(event: SpectrumViewportEvent): SpectrumViewportState {
  if (controller === null) {
    throw new Error("the harness published no controller");
  }
  return controller.dispatch(event);
}

/** Drives the reducer directly, to reach a state without miming a gesture. */
function send(event: SpectrumViewportEvent): void {
  act(() => {
    dispatchNow(event);
  });
}

/** The subrange every navigation case starts from: inside the spectrum, both ways. */
function commitSubrange(): void {
  send({ type: "viewport-step", domain: mzDomain(200, 300) });
}

/** The narrowest window this spectrum allows, named rather than pressed into. */
function commitNarrowest(): void {
  send({ type: "viewport-step", domain: mzDomain(200, 200 + MINIMUM_SPAN) });
}

/** Asks for a drawing the way the workspace does, and answers with the generation. */
function requestProjection(): number {
  let generation: number | null = null;
  act(() => {
    const requested = dispatchNow({ type: "projection-requested" });
    generation =
      requested.status === "ready" && requested.projection.status === "loading"
        ? requested.projection.generation
        : null;
  });
  if (generation === null) {
    throw new Error("this viewport accepted no projection request");
  }
  return generation;
}

function drawProjection(projection: SpectrumProjection): void {
  send({ type: "projection-succeeded", generation: requestProjection(), projection });
}

function failProjection(retryable: boolean): void {
  send({ type: "projection-failed", generation: requestProjection(), retryable });
}

/**
 * Sends one real cancelable wheel event to the production listener.
 *
 * Returned rather than swallowed, because `defaultPrevented` is half of what
 * every wheel case has to say. React's own `onWheel` is passive, so the adapter
 * attaches its own listener to the drawing -- which is why the event is
 * dispatched there and why `fireEvent.wheel`, which answers with a boolean,
 * cannot be used.
 */
function wheel(options: {
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly clientX?: number;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
}): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX ?? CENTRE_X,
    ctrlKey: options.ctrlKey ?? false,
    deltaMode: options.deltaMode ?? 0,
    deltaY: options.deltaY,
    shiftKey: options.shiftKey ?? false,
  });
  act(() => {
    plot().dispatchEvent(event);
  });
  return event;
}

/**
 * One key press, built by hand for the same reason the wheel is.
 *
 * Every modifier is defaulted explicitly rather than left off the dictionary, so
 * a case that means "unmodified" says so and cannot pass because a field it
 * never thought about happened to be absent.
 */
function key(
  name: string,
  modifiers: {
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly altKey?: boolean;
    readonly shiftKey?: boolean;
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    altKey: modifiers.altKey ?? false,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.ctrlKey ?? false,
    key: name,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  });
  act(() => {
    plot().dispatchEvent(event);
  });
  return event;
}

function pressPointer(clientX: number, pointerId = 1): void {
  fireEvent.pointerDown(pointerSurface(), { button: 0, clientX, clientY: 120, pointerId });
}

function movePointer(clientX: number, pointerId = 1): void {
  fireEvent.pointerMove(pointerSurface(), { clientX, clientY: 120, pointerId });
}

function releasePointer(clientX: number, pointerId = 1): void {
  fireEvent.pointerUp(pointerSurface(), { button: 0, clientX, clientY: 120, pointerId });
}

function cancelPointer(clientX: number, pointerId = 1): void {
  fireEvent.pointerCancel(pointerSurface(), { clientX, clientY: 120, pointerId });
}

/** Where a fraction of the drawn band falls, in client pixels. */
function clientXFor(fraction: number): number {
  return SPECTRUM_PLOT_PADDING_LEFT + fraction * SPECTRUM_PLOT_DRAWN_WIDTH;
}

function rangeText(): string {
  return document.getElementById("spectrum-viewport-range")?.textContent ?? "";
}

function statusText(): string {
  return document.getElementById("spectrum-viewport-status")?.textContent ?? "";
}

function captionText(): string {
  return document.querySelector("figcaption.spectrum-caption")?.textContent ?? "";
}

/** The one path every stick is emitted into, or `null` when nothing is drawn. */
function sticks(): Element | null {
  return document.querySelector("path.spectrum-sticks");
}

beforeEach(() => {
  ownerRenders = 0;
  // Not `shouldAdvanceTime`. A wheel's settle is scheduled 120ms out, and a
  // clock that advanced with real time could fire it between two lines of a
  // test -- which would make "the gesture has not settled yet" a statement
  // about how fast this machine is.
  vi.useFakeTimers();
});

afterEach(() => {
  // Unmounted first, so the adapter's own cleanup drops the settle timer before
  // the pending queue is run: a settle fired into a mounted tree from outside
  // `act` is noise that belongs to the teardown rather than to any assertion.
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  controller = null;
  plotBox = null;
});

describe("what each m/z control would do", () => {
  const cases: readonly {
    readonly name: string;
    readonly domain: SpectrumViewportDomain;
    readonly reach: () => void;
    readonly expected: Readonly<Record<(typeof CONTROLS)[number], boolean>>;
  }[] = [
    {
      name: "a spectrum showing its whole m/z range",
      domain: FULL,
      reach: () => undefined,
      // Nothing wider to show, and nothing to go back to.
      expected: { "Zoom in m/z": true, "Zoom out m/z": false, "Reset m/z range": false },
    },
    {
      name: "an ordinary subrange",
      domain: FULL,
      reach: commitSubrange,
      expected: { "Zoom in m/z": true, "Zoom out m/z": true, "Reset m/z range": true },
    },
    {
      name: "the narrowest window this spectrum allows",
      domain: FULL,
      reach: commitNarrowest,
      // Nothing narrower to show, but plenty wider.
      expected: { "Zoom in m/z": false, "Zoom out m/z": true, "Reset m/z range": true },
    },
    {
      name: "a spectrum whose points all report one m/z",
      domain: FLAT,
      reach: () => undefined,
      // A zero-width domain has no subrange and no superrange. The points are
      // still drawn -- there is nothing to zoom, which is not the same as
      // nothing to see.
      expected: { "Zoom in m/z": false, "Zoom out m/z": false, "Reset m/z range": false },
    },
    {
      name: "a spectrum whose m/z range Rust refused",
      domain: REFUSED,
      reach: () => undefined,
      expected: { "Zoom in m/z": false, "Zoom out m/z": false, "Reset m/z range": false },
    },
  ];

  for (const scenario of cases) {
    it(`offers exactly the controls that would move ${scenario.name}`, () => {
      renderViewport({ domain: scenario.domain });
      scenario.reach();

      for (const label of CONTROLS) {
        if (scenario.expected[label]) {
          expect(control(label), label).toBeEnabled();
        } else {
          expect(control(label), label).toBeDisabled();
        }
      }
    });

    it(`makes each open control move ${scenario.name} and each closed one move nothing`, () => {
      /*
       * The user-facing half of the same rule, asserted over the whole group: a
       * control that is offered changes the range on screen, and one that is
       * refused changes no state at all -- by identity, so a new object holding
       * the same numbers is a failure rather than a pass.
       */
      renderViewport({ domain: scenario.domain });
      scenario.reach();

      for (const label of CONTROLS) {
        const before = state();
        if (control(label).disabled) {
          /*
           * Two refusals, and only one of them is the adapter's.
           *
           * React does not call `onClick` for a `disabled` button whatever
           * dispatched the event, so clicking one -- by hand or otherwise --
           * tests the browser and nothing else. The adapter's own guard is the
           * one that matters, because the press re-plans from live state rather
           * than trusting the `disabled` a render computed; so it is asked
           * directly, the way the button's handler asks it.
           */
          act(() => {
            control(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
          expect(state(), `${label} while closed, clicked`).toBe(before);

          const action = VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.find(
            (entry) => entry.label === label,
          )?.action;
          expect(action, `${label} is a known action`).toBeDefined();
          let dispatched = true;
          act(() => {
            dispatched = applySpectrumViewportAction(
              state(),
              (event) => dispatchNow(event),
              action as SpectrumViewportAction,
            );
          });
          expect(dispatched, `${label} while closed, applied`).toBe(false);
          expect(state(), `${label} while closed, after applying`).toBe(before);
          continue;
        }
        const shownBefore = shown();
        fireEvent.click(control(label));
        const shownAfter = shown();
        expect(
          shownAfter.low !== shownBefore.low || shownAfter.high !== shownBefore.high,
          `${label} while open`,
        ).toBe(true);
      }
    });
  }

  it("draws one button per visible action, named for the axis it acts on", () => {
    // `Zoom in` alone would be the second control in this window with that
    // accessible name, and the list is the contract's rather than this file's so
    // the render and the keyboard cannot drift apart about which controls exist.
    renderViewport();

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      ...VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.map((entry) => entry.label),
    ]);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      ...CONTROLS,
    ]);
  });
});

describe("pressing a control", () => {
  it("plans a press against the live state rather than the render that drew it", () => {
    /*
     * The interval between the render that computed `disabled` and the press
     * that arrives: a settling gesture, a drawing landing, another spectrum
     * chosen. Here the state is moved inside the same batch as the click, so the
     * button in the document is still the enabled one while the live state says
     * its action would do nothing.
     *
     * A handler that dispatched what its render had decided would produce a new
     * state object for a transition nobody would ever see.
     */
    renderViewport();
    commitSubrange();
    expect(control("Reset m/z range")).toBeEnabled();

    let afterReset: SpectrumViewportState | null = null;
    act(() => {
      afterReset = dispatchNow({ type: "viewport-reset" });
      control("Reset m/z range").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(afterReset).not.toBeNull();
    expect(state()).toBe(afterReset);
    expect(control("Reset m/z range")).toBeDisabled();
  });

  it("zooms the window the live state holds, not the one the render drew", () => {
    // The other direction of the same seam, and the discriminating one: both
    // windows leave the button open, so only *which range it acted on* can tell
    // a live plan from one captured by an older render.
    renderViewport();
    commitSubrange();

    act(() => {
      dispatchNow({ type: "viewport-step", domain: mzDomain(400, 480) });
      control("Zoom in m/z").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const after = shown();
    expect(after.low).toBeGreaterThanOrEqual(400);
    expect(after.high).toBeLessThanOrEqual(480);
    expect((after.low + after.high) / 2).toBeCloseTo(440, 9);
  });

  it("zooms a press about the centre of the window on screen", () => {
    // A button is one deliberate decision and must not depend on where a pointer
    // happened to be left; anchoring under the cursor is the wheel's gesture,
    // and substituting it here would move the range out from under the press.
    renderViewport();
    commitSubrange();

    fireEvent.click(control("Zoom in m/z"));

    const after = shown();
    expect((after.low + after.high) / 2).toBeCloseTo(250, 9);
    expect(after.high - after.low).toBeCloseTo(100 * ZOOM_STEP_FACTOR, 9);
  });

  it("gives the whole spectrum back on a reset, rather than a window that spans it", () => {
    // `null` is what a `Current`-range export later reads as "the whole
    // spectrum", so a reset that committed a numerically equal window would be a
    // different answer to that question.
    renderViewport();
    commitSubrange();

    fireEvent.click(control("Reset m/z range"));

    expect(ready().committed).toBeNull();
    expect(rangeText()).toBe("Showing m/z 100.0000 to 500.0000 (full range)");
  });
});

describe("reaching the m/z range from the keyboard", () => {
  const cases: readonly {
    readonly name: string;
    readonly key: string;
    readonly holds: (before: Shown) => void;
  }[] = [
    {
      name: "narrows the window on +",
      key: "+",
      holds: (before) => {
        expect(shown().high - shown().low).toBeLessThan(before.high - before.low);
      },
    },
    {
      name: "narrows the window on = as well, which is + without a shift",
      key: "=",
      holds: (before) => {
        expect(shown().high - shown().low).toBeLessThan(before.high - before.low);
      },
    },
    {
      name: "widens the window on -",
      key: "-",
      holds: (before) => {
        expect(shown().high - shown().low).toBeGreaterThan(before.high - before.low);
      },
    },
    {
      name: "widens the window on _ as well",
      key: "_",
      holds: (before) => {
        expect(shown().high - shown().low).toBeGreaterThan(before.high - before.low);
      },
    },
    {
      name: "slides the window down the axis on ArrowLeft, keeping its width",
      key: "ArrowLeft",
      holds: (before) => {
        const after = shown();
        expect(after.low).toBeCloseTo(before.low - (before.high - before.low) * MZ_PAN_STEP, 9);
        expect(after.high - after.low).toBeCloseTo(before.high - before.low, 9);
      },
    },
    {
      name: "slides the window up the axis on ArrowRight, keeping its width",
      key: "ArrowRight",
      holds: (before) => {
        const after = shown();
        expect(after.low).toBeCloseTo(before.low + (before.high - before.low) * MZ_PAN_STEP, 9);
        expect(after.high - after.low).toBeCloseTo(before.high - before.low, 9);
      },
    },
    {
      name: "gives the whole spectrum back on Home",
      key: "Home",
      holds: () => {
        expect(ready().committed).toBeNull();
      },
    },
    {
      name: "gives the whole spectrum back on 0 as well",
      key: "0",
      holds: () => {
        expect(ready().committed).toBeNull();
      },
    },
  ];

  for (const scenario of cases) {
    it(scenario.name, () => {
      renderViewport();
      commitSubrange();
      plot().focus();
      const before = shown();

      const event = key(scenario.key);

      expect(event.defaultPrevented, scenario.key).toBe(true);
      scenario.holds(before);
    });
  }

  it("claims no key at the far edges of the spectrum, and moves nothing there", () => {
    // The whole range is on screen: there is nothing wider, nothing to reset to,
    // and nowhere to slide. A key that changes nothing is not this plot's input,
    // so the surface it sits in keeps it.
    renderViewport();
    plot().focus();

    for (const name of ["-", "_", "Home", "0", "ArrowLeft", "ArrowRight"]) {
      const before = state();
      const event = key(name);
      expect(event.defaultPrevented, name).toBe(false);
      expect(state(), name).toBe(before);
    }
  });

  it("stops claiming + at the narrowest window, and still claims the way back", () => {
    renderViewport();
    commitNarrowest();
    plot().focus();
    const before = state();

    const inward = key("+");

    expect(inward.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
    expect(key("-").defaultPrevented).toBe(true);
  });

  it("leaves every key it has no transition for to the page", () => {
    // Tab, Escape and the browser's own shortcuts are not this plot's to
    // swallow, and neither is an arrow it has no meaning for.
    renderViewport();
    commitSubrange();
    plot().focus();

    for (const name of ["Tab", "a", "Escape", "ArrowUp", "PageDown"]) {
      const before = state();
      const event = key(name);
      expect(event.defaultPrevented, name).toBe(false);
      expect(state(), name).toBe(before);
    }
  });

  it("claims nothing from the keyboard for a spectrum whose range was refused", () => {
    renderViewport({ domain: REFUSED });

    for (const name of ["+", "-", "ArrowLeft", "Home", "0"]) {
      const before = state();
      const event = key(name);
      expect(event.defaultPrevented, name).toBe(false);
      expect(state(), name).toBe(before);
    }
  });
});

/*
 * Who owns a wheel event.
 *
 * Cancelling one is a claim on it, and this panel sits inside a column that
 * scrolls and inside a panel that scrolls. A wheel cancelled and then not used
 * is a wheel that neither zoomed nor scrolled anything -- so the rule is the one
 * the buttons follow, asked of a gesture instead of a press: the panel owns a
 * wheel exactly when putting it through the contract would change the settled
 * range on screen.
 */
describe("who owns a wheel over the spectrum", () => {
  it("claims a wheel that narrows the range, and narrows it", () => {
    renderViewport();
    const before = shown();

    const event = wheel({ deltaY: IN });

    expect(event.defaultPrevented).toBe(true);
    expect(ready().gesture).not.toBeNull();
    expect(shown().high - shown().low).toBeLessThan(before.high - before.low);
  });

  it("leaves a wheel that cannot widen the whole spectrum to the browser", () => {
    // The state the panel opens in, and the one a reader is in when they want to
    // scroll on to the facts below.
    renderViewport();
    const before = state();

    const event = wheel({ deltaY: OUT });

    expect(event.defaultPrevented).toBe(false);
    // And nothing was left behind: no gesture, no epoch, no settle.
    expect(state()).toBe(before);
    expect(ready().gesture).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(state()).toBe(before);
  });

  it("stops claiming an inward wheel at the narrowest window, and still claims an outward one", () => {
    renderViewport();
    commitNarrowest();
    const atFloor = state();

    const inward = wheel({ deltaY: IN });

    expect(inward.defaultPrevented).toBe(false);
    expect(state()).toBe(atFloor);

    const outward = wheel({ deltaY: OUT });

    expect(outward.defaultPrevented).toBe(true);
    expect(shown().high - shown().low).toBeGreaterThan(MINIMUM_SPAN);
  });

  it("leaves both directions to the browser for a spectrum with no width to zoom", () => {
    renderViewport({ domain: FLAT });
    const before = state();

    const inward = wheel({ deltaY: IN });
    const outward = wheel({ deltaY: OUT });

    expect(inward.defaultPrevented).toBe(false);
    expect(outward.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
    expect(ready().gesture).toBeNull();
  });

  it("leaves a wheel whose unit it cannot read to the browser", () => {
    // A `deltaMode` this viewer has never heard of could mean anything, and
    // treating it as pixels would turn some future device's ordinary scroll into
    // a wild zoom. Declining is the safe reading, not a guess.
    renderViewport();
    const before = state();

    const event = wheel({ deltaY: IN, deltaMode: 7 });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
  });

  it("leaves a wheel asking for nothing at all to the browser", () => {
    renderViewport();
    const before = state();

    const event = wheel({ deltaY: 0 });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
  });

  it("holds the m/z under the pointer, wherever the pointer is", () => {
    // Pointer-anchored zoom, which is the gesture the button's centre anchor is
    // deliberately not. Run at both edges as well as the middle, because a
    // fraction taken from the element rather than from the drawn band would only
    // be wrong away from the centre.
    for (const [name, fraction] of [
      ["left", 0],
      ["centre", 0.5],
      ["right", 1],
    ] as const) {
      cleanup();
      renderViewport();
      const before = shown();
      const held = before.low + (before.high - before.low) * fraction;

      const event = wheel({ deltaY: IN, clientX: clientXFor(fraction) });

      expect(event.defaultPrevented, name).toBe(true);
      const after = shown();
      expect(after.high - after.low, name).toBeLessThan(before.high - before.low);
      expect((held - after.low) / (after.high - after.low), name).toBeCloseTo(fraction, 6);
    }
  });

  it("spends one epoch on a stream of wheel events and settles it once", () => {
    // A wheel is a stream with no end signal. What must not happen is an epoch
    // per event -- each one would be a gesture the next could no longer address,
    // and the settle for any of them could commit a range that had been left.
    renderViewport();
    const before = state();

    const first = wheel({ deltaY: IN });
    const epoch = ready().gesture?.epoch;
    const second = wheel({ deltaY: IN });
    const third = wheel({ deltaY: IN });

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(third.defaultPrevented).toBe(true);
    expect(epoch).toBeDefined();
    expect(ready().gesture?.epoch).toBe(epoch);
    expect(state().nextEpoch).toBe(before.nextEpoch + 1);
    // Still a drawing rather than a decision: the committed window has not moved.
    expect(ready().committed).toBeNull();

    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(ready().gesture, "one millisecond before the settle").not.toBeNull();

    // Where the stream has actually got to, read from the contract rather than
    // from the render: the second and third notches were applied and not
    // published, which is what keeps a wheel stream off the panel's render path.
    const transient = liveShown();
    expect(transient).not.toEqual(shown());

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const settled = state();

    expect(ready().gesture).toBeNull();
    // Settling publishes, so what the reader is left looking at is where the
    // stream ended rather than where its first notch put it.
    expect(renderedMzDomain(settled)).toEqual(transient);

    // And once is once: nothing later re-commits what has already been committed.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(state()).toBe(settled);
  });

  it("leaves a wheel arriving while a press owns the plot to the browser", () => {
    /*
     * The planner reads the active epoch out of the state, so a wheel arriving
     * mid-drag would join the *pan's* gesture -- and the wheel's own timer would
     * then settle someone else's gesture, after which every later pointer frame
     * carries a dead epoch and the pan freezes until the button comes up.
     *
     * So it is not this panel's event: nothing cancelled, nothing dispatched,
     * nothing scheduled, and the pan left exactly as it was.
     */
    renderViewport();
    commitSubrange();
    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);
    const panning = state();
    const epoch = ready().gesture?.epoch;
    expect(epoch).toBeDefined();

    const event = wheel({ deltaY: IN });

    expect(event.defaultPrevented).toBe(false);
    expect(state()).toBe(panning);
    expect(ready().gesture?.epoch).toBe(epoch);

    // No settle was scheduled either, so the pan's own epoch is still the live one.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(state()).toBe(panning);

    movePointer(CENTRE_X + 80);
    expect(ready().gesture?.epoch).toBe(epoch);
    releasePointer(CENTRE_X + 80);
    expect(ready().gesture).toBeNull();
    expect(ready().committed).not.toBeNull();
  });

  it("claims no wheel for a spectrum whose range was refused", () => {
    renderViewport({ domain: REFUSED });
    const before = state();

    const inward = wheel({ deltaY: IN });
    const outward = wheel({ deltaY: OUT });

    expect(inward.defaultPrevented).toBe(false);
    expect(outward.defaultPrevented).toBe(false);
    expect(state()).toBe(before);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(state()).toBe(before);
  });
});

/*
 * Input the window owns, which this panel may not take.
 *
 * `who owns a wheel over the spectrum` above asks whether an input is
 * *productive*. This asks the question before it: whether the input was this
 * panel's to plan at all.
 *
 * The chromatogram answers it with the same predicate, and its own suite pins
 * the same cases, because whose input this is has no axis in it. What changed
 * the answer is evidence about the host rather than about hardware: WebView2
 * enables its zoom controls by default and drives them with Ctrl+wheel,
 * Ctrl+Plus and Ctrl+Minus, and this application disables neither. Nothing here
 * decides what device produced an event.
 */
describe("input the host owns", () => {
  /** A window with room in every direction, so nothing is refused at an edge. */
  const ROOMY = mzDomain(200, 300);

  /** Every key this panel maps, including the duplicate spellings. */
  const VIEWPORT_KEYS = ["+", "=", "-", "_", "ArrowLeft", "ArrowRight", "Home", "0"];

  const HOST_MODIFIERS: readonly {
    readonly label: string;
    readonly modifiers: {
      readonly ctrlKey?: boolean;
      readonly metaKey?: boolean;
      readonly altKey?: boolean;
    };
  }[] = [
    { label: "ctrl", modifiers: { ctrlKey: true } },
    { label: "meta", modifiers: { metaKey: true } },
    { label: "alt", modifiers: { altKey: true } },
  ];

  it("releases a ctrl wheel before it measures anything, and claims it without ctrl", () => {
    /*
     * `live()` rather than `state()` for the released half. A wheel the reducer
     * accepted would start a gesture, and a gesture's frames are deliberately
     * not published -- so asking only what React drew could not tell a released
     * event apart from a claimed one whose frame was withheld. The reducer's own
     * state is the strict question.
     */
    renderViewport();
    const before = live();
    const fullSpan = shown().high - shown().low;
    const measured = layoutReads();

    const released = wheel({ deltaY: IN, ctrlKey: true });

    expect(released.defaultPrevented).toBe(false);
    // Nothing planned: no reducer event, so no gesture, no epoch, and no
    // generation spent asking Rust to draw a window nobody asked for.
    expect(live()).toBe(before);
    expect(state()).toBe(before);
    // And nothing measured. The guard sits ahead of the anchor calculation, so a
    // released wheel costs the panel no layout at all.
    expect(layoutReads()).toBe(measured);
    // No settle was scheduled either, so nothing commits a window later.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(live()).toBe(before);

    // The same delta, the same plot, the same anchor. Only the owner differs.
    const claimed = wheel({ deltaY: IN });

    expect(claimed.defaultPrevented).toBe(true);
    expect(liveShown().high - liveShown().low).toBeLessThan(fullSpan);
    expect(layoutReads()).toBeGreaterThan(measured);
  });

  it("releases a ctrl wheel from a subrange, where both directions are productive", () => {
    /*
     * At full range an outward wheel is released too, for an unrelated reason:
     * there is nothing wider to show. From a subrange both directions move the
     * axis, so a release here can only be about the modifier.
     */
    renderViewport();
    send({ type: "viewport-step", domain: ROOMY });
    const before = live();

    for (const deltaY of [IN, OUT]) {
      const event = wheel({ deltaY, ctrlKey: true });

      expect(event.defaultPrevented, String(deltaY)).toBe(false);
      expect(live(), String(deltaY)).toBe(before);
    }
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(live()).toBe(before);
  });

  it("still reads magnitude the same way whether or not shift is held", () => {
    // Shift has no owner and is given no meaning, which is the rule ctrl used to
    // be judged by. It survives here because it is still true.
    renderViewport();
    send({ type: "viewport-step", domain: ROOMY });

    const held = wheel({ deltaY: IN, shiftKey: true });
    const withShift = liveShown();

    cleanup();
    renderViewport();
    send({ type: "viewport-step", domain: ROOMY });
    const plain = wheel({ deltaY: IN });

    expect(held.defaultPrevented).toBe(true);
    expect(plain.defaultPrevented).toBe(true);
    expect(liveShown()).toEqual(withShift);
  });

  it("releases every viewport key under ctrl, meta and alt", () => {
    renderViewport();
    plot().focus();

    for (const name of VIEWPORT_KEYS) {
      for (const { label, modifiers } of HOST_MODIFIERS) {
        // Restored before each press, so every key is judged from a window with
        // somewhere to go and no release can be a boundary in disguise.
        send({ type: "viewport-step", domain: ROOMY });
        const before = live();

        const event = key(name, modifiers);

        expect(event.defaultPrevented, label + "+" + name).toBe(false);
        expect(live(), label + "+" + name).toBe(before);
      }
    }
  });

  it("still claims every unmodified viewport key", () => {
    // The other half of the same rule, and the one a careless guard breaks.
    renderViewport();
    plot().focus();

    for (const name of VIEWPORT_KEYS) {
      send({ type: "viewport-step", domain: ROOMY });
      const before = live();

      const event = key(name);

      expect(event.defaultPrevented, name).toBe(true);
      expect(live(), name).not.toBe(before);
    }
  });

  it("still zooms on a shift-produced plus", () => {
    /*
     * Not an exotic case: on common layouts `+` *is* Shift+`=`, so this is how
     * the ordinary shortcut arrives. A guard that rejected Shift would take the
     * zoom away and protect no accelerator.
     */
    renderViewport();
    plot().focus();
    const before = shown();

    const event = key("+", { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(shown().high - shown().low).toBeLessThan(before.high - before.low);
  });

  it("releases a plus that carries ctrl as well as shift", () => {
    // Shift is not a licence. Ctrl is present, so the press is the host's.
    renderViewport();
    plot().focus();
    const before = live();

    const event = key("+", { ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(live()).toBe(before);
  });

  it("leaves a key it does not map alone, modified or not", () => {
    // The guard is about ownership, not about swallowing more. Tab and Escape
    // were never this panel's and still are not.
    renderViewport();
    plot().focus();
    const before = live();

    for (const name of ["Tab", "Escape", "a"]) {
      expect(key(name).defaultPrevented, name).toBe(false);
      expect(key(name, { ctrlKey: true }).defaultPrevented, "ctrl+" + name).toBe(false);
    }
    expect(live()).toBe(before);
  });
});

describe("panning the spectrum with a press", () => {
  it("dispatches nothing at all for a press that never travels past the slop", () => {
    /*
     * There is nothing on the other side of this threshold. A click on a
     * spectrum selects nothing -- the scan is chosen on the chromatogram and in
     * the table -- so a press that only trembled must leave no gesture, no
     * epoch, and no selection of a peak, an ion or an annotation invented here.
     */
    renderViewport();
    commitSubrange();
    const before = state();

    pressPointer(CENTRE_X);
    expect(state()).toBe(before);
    movePointer(CENTRE_X + 2);
    expect(state()).toBe(before);
    releasePointer(CENTRE_X + 2);

    expect(state()).toBe(before);
    expect(rangeText()).toBe("Showing m/z 200.0000 to 300.0000");
  });

  it("starts no gesture for a drag with nowhere to pan", () => {
    /*
     * The same rule the wheel and the buttons follow, asked of a drag. The whole
     * spectrum is on screen, so the pan clamps straight back onto it -- and a
     * gesture started for that would allocate an epoch, settle it, commit the
     * window already committed, and ask Rust for a drawing of a range nothing
     * moved. A pan that moves nothing asks for nothing.
     */
    renderViewport();
    const before = state();

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 60);
    expect(state(), "past the slop").toBe(before);
    movePointer(CENTRE_X + 240);
    expect(state(), "and further still").toBe(before);
    releasePointer(CENTRE_X + 240);

    expect(state()).toBe(before);
  });

  it("keeps the drawing in hand when a drag has nowhere to pan", () => {
    // The visible cost of the rule above, and the reason it is a rule: a settled
    // gesture returns the projection to `idle`, so a drag that committed the
    // window already committed would blank a current drawing and ask for it
    // again.
    renderViewport();
    drawProjection(DRAWN);
    expect(sticks()).not.toBeNull();

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 60);
    releasePointer(CENTRE_X + 60);

    expect(sticks()).not.toBeNull();
    expect(statusText()).toBe("");
    expect(rangeText()).toBe("Showing m/z 100.0000 to 500.0000 (full range)");
  });

  it("starts exactly one gesture once the press travels past the slop", () => {
    renderViewport();
    commitSubrange();
    const before = state();

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);

    expect(ready().gesture).not.toBeNull();
    const epoch = ready().gesture?.epoch;
    expect(state().nextEpoch).toBe(before.nextEpoch + 1);

    movePointer(CENTRE_X + 60);
    movePointer(CENTRE_X + 80);

    // Later frames move the gesture that is already running; they do not each
    // become one, which is what an epoch per frame would look like.
    expect(ready().gesture?.epoch).toBe(epoch);
    expect(state().nextEpoch).toBe(before.nextEpoch + 1);
  });

  it("pans from where the press began rather than from the previous frame", () => {
    /*
     * Two routes to the same displacement land on the same window, so a long
     * drag accumulates no drift and a frame the browser coalesced away costs
     * nothing.
     *
     * **The drag has to reach the edge for this to mean anything.** Panning is a
     * translation, so away from the edges origin-based and previous-frame-based
     * panning are the same arithmetic and any fixture in the middle of the
     * spectrum passes either way. Against the edge they part company: the
     * clamped window stops moving while the pointer keeps going, so a
     * frame-based pan measures its next step from a window the pointer has
     * already left and lands short as soon as the drag turns back.
     */
    renderViewport();
    commitSubrange();

    // Out to the edge and part of the way back, in one move.
    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 1_500);
    const atTheEdge = ready().gesture?.domain;
    movePointer(CENTRE_X + 40);
    releasePointer(CENTRE_X + 40);
    const direct = ready().committed;
    expect(direct).not.toBeNull();
    // The excursion really did reach the edge, or this proves nothing.
    expect(atTheEdge?.low).toBeCloseTo(FULL.low, 9);
    expect(direct?.low).not.toBeCloseTo(FULL.low, 6);

    // The same journey in three frames. From the origin this is the same
    // window; from the previous frame it is not.
    send({ type: "viewport-reset" });
    commitSubrange();
    pressPointer(CENTRE_X, 2);
    movePointer(CENTRE_X + 300, 2);
    movePointer(CENTRE_X + 1_500, 2);
    movePointer(CENTRE_X + 40, 2);
    releasePointer(CENTRE_X + 40, 2);

    expect(ready().committed?.low).toBeCloseTo(direct?.low ?? 0, 12);
    expect(ready().committed?.high).toBeCloseTo(direct?.high ?? 0, 12);
  });

  it("commits the pan when the press is released, keeping the window's width", () => {
    renderViewport();
    commitSubrange();
    const before = shown();

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);
    releasePointer(CENTRE_X + 40);

    const after = shown();
    expect(ready().gesture).toBeNull();
    expect(ready().committed).not.toBeNull();
    // The drawing follows the pointer, so dragging right shows lower m/z.
    expect(after.low).toBeLessThan(before.low);
    expect(after.high - after.low).toBeCloseTo(before.high - before.low, 9);
  });

  it("abandons a cancelled press rather than committing it", () => {
    renderViewport();
    commitSubrange();
    const committed = ready().committed;

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);
    expect(ready().gesture).not.toBeNull();
    cancelPointer(CENTRE_X + 40);

    expect(ready().gesture).toBeNull();
    expect(ready().committed).toEqual(committed);
  });

  it("keeps the plot with the pointer that pressed it when a second one arrives", () => {
    /*
     * A second contact is not a second gesture. It may not take the first one's
     * place, its capture or its record -- and above all its release must not
     * clear the owner's, or the pan would be left running with nothing able to
     * end it.
     */
    renderViewport();
    commitSubrange();
    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);
    const owned = state();
    const epoch = ready().gesture?.epoch;

    pressPointer(CENTRE_X + 200, 2);
    expect(state(), "a second press").toBe(owned);
    movePointer(CENTRE_X + 300, 2);
    expect(state(), "a second pointer moving").toBe(owned);
    releasePointer(CENTRE_X + 300, 2);
    expect(state(), "a second pointer released").toBe(owned);

    // And the pointer that owns it can still finish what it was doing.
    movePointer(CENTRE_X + 80);
    expect(ready().gesture?.epoch).toBe(epoch);
    releasePointer(CENTRE_X + 80);
    expect(ready().gesture).toBeNull();
    expect(ready().committed).not.toBeNull();
  });

  it("does not ask the owner to render once per pointer frame of a long drag", () => {
    /*
     * The frontend rule this closes is `apps/desktop/AGENTS.md`'s: keep
     * pointer-move and cursor-frame data out of React state. A drag is a stream
     * of frames, and publishing each one re-rendered the panel and the workspace
     * above it -- the facts list, the precursor list, the export controls -- and
     * ran the plot's reduction again, for a change one number wide.
     *
     * So the count is asserted against the *gesture* rather than against the
     * frames: a drag publishes when it starts and when it settles, and a
     * hundred frames in between publish nothing. Asserted as a bound rather than
     * an exact number, because what matters is that it does not scale.
     */
    renderViewport();
    drawProjection(DRAWN);
    send({ type: "viewport-step", domain: mzDomain(200, 300) });
    drawProjection({ ...DRAWN, low: 200, high: 300 });

    const before = ownerRenders;
    pressPointer(CENTRE_X);
    for (let frame = 0; frame < 100; frame += 1) {
      movePointer(CENTRE_X - 20 - frame);
    }
    const duringDrag = ownerRenders - before;
    // One publication for the gesture starting, and nothing for the frames.
    expect(duringDrag, "renders during a hundred pointer frames").toBeLessThanOrEqual(2);

    releasePointer(CENTRE_X - 120);
    const wholeGesture = ownerRenders - before;
    // The settle publishes, and the drawing it commits to needs a render.
    expect(wholeGesture, "renders for the whole gesture").toBeLessThanOrEqual(4);

    // And it was a real drag: a hundred frames moved the contract's own range.
    expect(liveShown().low).not.toBe(200);
  });

  it("keeps moving the drawing while a drag publishes nothing", () => {
    /*
     * The other half of the same repair. Taking frames off the render path must
     * not turn a drag into "nothing happens until you let go", so the adapter
     * moves the sticks and the numbers itself: the layer is transformed as a
     * whole, which is exact and costs no second reduction, and the axis and the
     * range line are written beside it so a drawing never moves under numbers
     * that do not.
     */
    renderViewport();
    drawProjection(DRAWN);
    send({ type: "viewport-step", domain: mzDomain(200, 300) });
    drawProjection({ ...DRAWN, low: 200, high: 300 });

    const layer = () => plot().querySelector("g.spectrum-sticks-layer");
    const axisLow = () => plot().querySelector("text.spectrum-axis-low")?.textContent ?? "";
    expect(layer()?.getAttribute("transform"), "at rest").toBeNull();

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X - 60);
    const startedAt = rangeText();
    const publishedRenders = ownerRenders;

    movePointer(CENTRE_X - 200);

    // Nothing was published for that frame, and the drawing moved anyway.
    expect(ownerRenders, "no render for the frame").toBe(publishedRenders);
    expect(layer()?.getAttribute("transform"), "the sticks moved").toMatch(/translate/u);
    expect(rangeText(), "the range line moved").not.toBe(startedAt);
    expect(axisLow(), "the axis moved").toBe(formatMz(liveShown().low));

    // Settling hands the drawing back to React, which redraws it at the range it
    // committed to -- so the transform left over from the gesture is gone.
    releasePointer(CENTRE_X - 200);
    expect(layer()?.getAttribute("transform"), "after the settle").toBeNull();
  });

  it("starts no gesture for a drag pushed outward at an edge it already rests on", () => {
    /*
     * The drag half of the same boundary. The keyboard's pan and this one are
     * the same transition asked by different hands, so a window flush against
     * the source must be as inert under a finger as under `ArrowRight` -- no
     * epoch allocated, no window committed that differs only in the last place,
     * and no drawing asked of Rust for it.
     */
    renderViewport();
    drawProjection(DRAWN);
    // Flush against the low edge of the spectrum.
    send({ type: "viewport-step", domain: mzDomain(FULL.low, FULL.low + 100) });
    drawProjection({ ...DRAWN, low: FULL.low, high: FULL.low + 100 });
    const before = state();
    expect(ready().committed?.low).toBe(FULL.low);

    // Dragged right, which pushes the window further left: there is nowhere
    // left for it to go.
    pressPointer(CENTRE_X);
    for (const step of [40, 120, 400, 900]) {
      movePointer(CENTRE_X + step);
    }
    expect(ready().gesture, "no gesture was started").toBeNull();
    expect(state().nextEpoch, "no epoch was spent").toBe(before.nextEpoch);
    expect(state().nextGeneration, "no drawing was asked for").toBe(before.nextGeneration);

    releasePointer(CENTRE_X + 900);
    expect(state(), "and the release committed nothing").toBe(before);

    // The way back is open, so the plot is not simply dead.
    pressPointer(CENTRE_X, 2);
    movePointer(CENTRE_X - 200, 2);
    expect(ready().gesture, "the other direction still pans").not.toBeNull();
  });

  it("moves nothing when the spectrum changes under a press that is still down", () => {
    /*
     * A press outlives a selection. The scan can change from the table, from the
     * chromatogram or from Previous and Next while a button is held down on this
     * plot, and pointer capture stops another element taking the press but does
     * nothing about the spectrum beneath it.
     *
     * A gesture already started is safe by its epoch -- the new context never
     * issued it, so a move addressed to it is a no-op by identity. A press that
     * has not started one yet carries no epoch to be refused by, and its
     * remembered starting window belongs to the *previous* spectrum. Left
     * unchecked, the first move after the change starts a gesture on the new
     * spectrum at a range taken from the old one's -- which is precisely the
     * continuity `spectrumViewport.ts` says it refuses to invent.
     */
    renderViewport();
    drawProjection(DRAWN);
    send({ type: "viewport-step", domain: mzDomain(200, 300) });
    expect(rangeText()).toContain("200.0000 to 300.0000");

    pressPointer(clientXFor(0.8));
    // The selection moves on while the button is still down, to a spectrum
    // whose m/z range has nothing in common with this one's.
    send({
      type: "spectrum-selected",
      spectrumToken: "another",
      domain: { state: "admitted", low: 1_000, high: 2_000 },
    });
    const afterSelection = rangeText();

    movePointer(clientXFor(0.2));
    releasePointer(clientXFor(0.2));

    // The new spectrum opens at its own whole domain and stays there. Nothing
    // of the previous window reached it, and no gesture was ever published.
    expect(rangeText()).toBe(afterSelection);
    expect(rangeText()).toContain("1000.0000 to 2000.0000");
    expect(renderedMzDomain(state())).toEqual({ low: 1_000, high: 2_000 });
  });

  it("ignores a press that is not the primary button", () => {
    // A context menu or a middle-click paste is not a pan, and starting one
    // would take a gesture the user never asked for.
    renderViewport();
    commitSubrange();
    const before = state();

    fireEvent.pointerDown(pointerSurface(), { button: 2, clientX: CENTRE_X, pointerId: 3 });
    fireEvent.pointerMove(pointerSurface(), { clientX: CENTRE_X + 60, pointerId: 3 });

    expect(state()).toBe(before);
  });
});

describe("what the plot draws, and what it says it is drawing", () => {
  it("draws the projection that answers the committed window", () => {
    renderViewport();
    commitSubrange();
    drawProjection(DRAWN);

    expect(sticks()).not.toBeNull();
    expect(captionText()).toMatch(
      /Drawn as 3 sticks of the 3 observations this spectrum has between m\/z 200\.0000 and 300\.0000/u,
    );
    // Nothing left to say, so the region says nothing: a live region whose text
    // is added and removed as a sibling node is not reliably announced.
    expect(statusText()).toBe("");
    expect(document.getElementById("spectrum-viewport-status")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("never leaves an old drawing beneath a newly committed range", () => {
    // The defect this whole projection state exists to prevent: one range's data
    // under another range's axes. The commit returns the projection to `idle`,
    // and nothing is drawn until the answer for these numbers arrives.
    renderViewport();
    commitSubrange();
    drawProjection(DRAWN);
    expect(sticks()).not.toBeNull();

    send({ type: "viewport-step", domain: mzDomain(220, 260) });

    expect(sticks()).toBeNull();
    expect(rangeText()).toBe("Showing m/z 220.0000 to 260.0000");
    expect(statusText()).toMatch(
      /Drawing m\/z 220\.0000 to 260\.0000 from the retained spectrum\. Nothing is drawn here until it arrives\./u,
    );
    // The caption speaks for the range beneath it and does not name a window:
    // the status region above already named the one being drawn, and during a
    // gesture the two are different ranges.
    expect(captionText()).toMatch(/Waiting for the drawing of this range\. Nothing is drawn here yet\./u);
  });

  it("draws nothing for an answer to a window the viewport has already left", () => {
    // A stale success and a stale failure are the same answer: this drawing is
    // not current for these axes, so it replaces nothing and surfaces nothing.
    renderViewport();
    commitSubrange();
    const generation = requestProjection();
    send({ type: "viewport-step", domain: mzDomain(220, 260) });
    const abandoned = state();

    send({ type: "projection-succeeded", generation, projection: DRAWN });

    expect(state(), "a late success").toBe(abandoned);
    expect(sticks()).toBeNull();

    send({ type: "projection-failed", generation, retryable: true });

    expect(state(), "a late failure").toBe(abandoned);
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("draws nothing for a window that truthfully holds no measured point", () => {
    renderViewport();
    commitSubrange();
    drawProjection(NO_POINT_IN_WINDOW);

    expect(sticks()).toBeNull();
    // Not a failure, so nothing offers to try again.
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(statusText()).toMatch(
      /This spectrum reports no measured point between m\/z 200\.0000 and 300\.0000\./u,
    );
  });

  it("tells an empty window, a drawing not yet arrived, a failure and a refusal apart", () => {
    /*
     * The four silent plots, and the only thing distinguishing them is what this
     * region says. A window that truthfully holds no reported point is not a
     * spectrum with no peaks, is not a drawing that has not arrived, and is not
     * a failure -- and a reader who cannot tell which of those they are looking
     * at has been told nothing.
     */
    const said = new Map<string, string>();

    cleanup();
    renderViewport();
    commitSubrange();
    requestProjection();
    said.set("waiting for a drawing", statusText());

    cleanup();
    renderViewport();
    commitSubrange();
    drawProjection(NO_POINT_IN_WINDOW);
    said.set("a window with no point in it", statusText());

    cleanup();
    renderViewport({ projectionError: PROJECTION_ERROR });
    commitSubrange();
    failProjection(true);
    said.set("a drawing that failed", statusText());

    cleanup();
    renderViewport({ domain: REFUSED });
    said.set("a spectrum with no range", statusText());

    for (const [name, text] of said) {
      expect(text.length, name).toBeGreaterThan(0);
    }
    expect(new Set(said.values()).size).toBe(said.size);
    const empty = said.get("a window with no point in it") ?? "";
    expect(empty).toMatch(/reports no measured point between m\/z 200\.0000 and 300\.0000/u);
    expect(empty).toMatch(/That is what the file says about this range, not a drawing that failed/u);
  });

  it("draws a gesture over the gesture's range, not the range its points answer", () => {
    /*
     * The half of the transient state that a caption cannot show. During a
     * gesture the points in hand answer the *committed* window, and they are
     * stretched over the range under the cursor -- so the axis has to be the
     * gesture's. A renderer that widened the axis back to the points it happens
     * to hold would put the reader's zoom back where it started while claiming
     * to have moved, which is the drawing deciding the range instead of the
     * other way round.
     */
    renderViewport();
    // A drawing of the whole spectrum, so its points reach well outside the
    // range the gesture is about. Points inside the gesture would make the two
    // answers identical and the case would pass for the wrong reason.
    drawProjection({
      low: 100,
      high: 500,
      mz: [110, 250, 480],
      intensity: [10, 40, 25],
      sourcePoints: 3,
      reduced: false,
    });
    send({ type: "gesture-started", domain: mzDomain(200, 300) });

    const labels = [...plot().querySelectorAll("text.axis-label")].map(
      (node) => node.textContent ?? "",
    );
    expect(labels).toContain("200.0000");
    expect(labels).toContain("300.0000");
    // The window the points answer is nowhere on the axis.
    expect(labels).not.toContain("100.0000");
    expect(labels).not.toContain("500.0000");
  });

  it("keeps the drawing in hand while a gesture is in flight, and says it is not the answer", () => {
    // The one moment the picture is not an answer about the range beneath it.
    // Said plainly rather than hidden, so a mid-drag view is never read as the
    // drawing of the range under the cursor.
    renderViewport();
    commitSubrange();
    drawProjection(DRAWN);

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);

    expect(ready().gesture).not.toBeNull();
    expect(sticks()).not.toBeNull();
    expect(captionText()).toMatch(
      /Showing the drawing already in hand while the range is being changed\./u,
    );
    expect(captionText()).toMatch(
      /Release to draw the range under it from the retained spectrum\./u,
    );
  });

  it("offers to draw the range again for a failure that can be retried", () => {
    renderViewport({ projectionError: PROJECTION_ERROR });
    commitSubrange();

    failProjection(true);

    expect(screen.getByRole("button", { name: RETRY })).toBeVisible();
    expect(statusText()).toBe(
      "The retained spectrum did not answer. The reader was busy with another request.",
    );
    expect(sticks()).toBeNull();
  });

  it("offers no retry for a failure that cannot be retried", () => {
    renderViewport({ projectionError: PROJECTION_ERROR });
    commitSubrange();

    failProjection(false);

    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("still says the range could not be drawn when no message came with the failure", () => {
    renderViewport({ projectionError: null });
    commitSubrange();

    failProjection(true);

    expect(statusText()).toBe("This m/z range could not be drawn.");
  });

  it("asks Rust for nothing at all while a press is dragging the plot", () => {
    /*
     * A gesture is a drawing rather than a decision, and the only route this
     * component has to the boundary is the callback beside it. A pan that asked
     * for a window per pointer frame would turn a screen refresh into a stream
     * of requests -- which is why `projectionWindow` names the committed window
     * and why nothing here may ask for the one under the cursor.
     */
    const { onRetryProjection } = renderViewport();
    drawProjection(DRAWN);
    send({ type: "viewport-step", domain: mzDomain(200, 300) });
    drawProjection({ ...DRAWN, low: 200, high: 300 });
    const before = state().nextGeneration;

    pressPointer(clientXFor(0.7));
    for (const fraction of [0.66, 0.6, 0.52, 0.44, 0.3]) {
      movePointer(clientXFor(fraction));
    }

    /*
     * Asserted on the generation counter, not on a callback.
     *
     * `projection-requested` is the only event that spends a generation, so a
     * counter that has not moved is a proof that nothing was asked for -- by any
     * route, including one this component does not have today. The retry
     * callback is checked beside it because it is the component's one declared
     * way to reach the boundary, but on its own it would be an assertion about a
     * function no pointer path calls.
     */
    expect(state().nextGeneration, "during the drag").toBe(before);
    expect(onRetryProjection).not.toHaveBeenCalled();
    // And the gesture really did happen, so this is not a statement about a
    // press that did nothing.
    expect(rangeText()).not.toContain("200.0000 to 300.0000");

    releasePointer(clientXFor(0.3));
    // Still nothing: the settle commits a window, and asking Rust to draw it is
    // the workspace's to do from the state the settle left behind.
    expect(state().nextGeneration, "after the settle").toBe(before);
    expect(onRetryProjection).not.toHaveBeenCalled();
  });

  it("asks for the drawing again when the retry is pressed", () => {
    // Asked of the workspace rather than dispatched here: which generation the
    // new request belongs to is the reducer's to hand out.
    const { onRetryProjection } = renderViewport({ projectionError: PROJECTION_ERROR });
    commitSubrange();
    failProjection(true);

    fireEvent.click(screen.getByRole("button", { name: RETRY }));

    expect(onRetryProjection).toHaveBeenCalledTimes(1);
  });
});

describe("a spectrum with no m/z range to navigate", () => {
  it("still draws the points this document received, over their own range", () => {
    // A refusal is a fact about drawability, not about the data: the points are
    // still shown, exactly as they were before this panel had a viewport at all.
    renderViewport({ domain: REFUSED });

    expect(sticks()).not.toBeNull();
    expect(captionText()).toMatch(/Drawn as 3 sticks, one per point\./u);
  });

  it("names what happened rather than saying the spectrum is unusable", () => {
    renderViewport({ domain: REFUSED });

    expect(statusText()).toMatch(/^The m\/z range of this spectrum cannot be navigated\./u);
    expect(statusText()).toMatch(/do not increase from one point to the next/u);
    expect(statusText()).toMatch(/drawn in the order the file reports them/u);
    expect(rangeText()).toBe("No m/z range to navigate.");
  });

  it("leaves the drawing out of the tab order and offers nothing to drag", () => {
    // A tab stop that reaches a picture nothing can be done to spends a keyboard
    // user's time to tell them nothing.
    renderViewport({ domain: REFUSED });

    expect(plot()).not.toHaveAttribute("tabindex");
    expect(document.querySelector("div.spectrum-viewport-plot")).toBeNull();
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("says nothing about a range when no spectrum has been selected at all", () => {
    renderViewport({ domain: null });

    expect(rangeText()).toBe("No m/z range to navigate.");
    expect(statusText()).toBe("");
    for (const label of CONTROLS) {
      expect(control(label), label).toBeDisabled();
    }
  });
});

describe("what the panel says is on screen", () => {
  it("names the whole spectrum as the full range", () => {
    renderViewport();

    expect(rangeText()).toBe("Showing m/z 100.0000 to 500.0000 (full range)");
  });

  it("drops the full-range note once a subrange is committed", () => {
    renderViewport();

    commitSubrange();

    expect(rangeText()).toBe("Showing m/z 200.0000 to 300.0000");
  });

  it("follows a gesture rather than the committed window while one is in flight", () => {
    renderViewport();
    commitSubrange();

    pressPointer(CENTRE_X);
    movePointer(CENTRE_X + 40);

    expect(rangeText()).not.toBe("Showing m/z 200.0000 to 300.0000");
    expect(rangeText()).toMatch(/^Showing m\/z /u);
  });

  it("describes the drawing with both the range and the status, and makes it a tab stop", () => {
    renderViewport();

    expect(plot()).toHaveAttribute(
      "aria-describedby",
      "spectrum-viewport-range spectrum-viewport-status",
    );
    expect(plot()).toHaveAttribute("tabindex", "0");
  });
});
