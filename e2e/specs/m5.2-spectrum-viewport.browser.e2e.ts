/**
 * M5.2 rendered QA — the selected spectrum's m/z viewport, in a real browser.
 *
 * M5.1 shipped the contract and nothing anyone could see: a pure reducer for the
 * m/z axis and a bounded screen projection in Rust. M5.2 is the surface that
 * makes it reachable, and a surface has questions a jsdom cannot answer. Whether
 * the three controls are actually inside the panel at a window people use and
 * can be pressed where they appear. Whether the wheel listener the built bundle
 * registers -- non-passive, on the real element, under a real pointer position
 * -- reaches the same verdict the planner does. Whether a real drag over a plot
 * the panel has scrolled is a pan at all. And, above everything else this
 * milestone claims: whether a window that begins past the end of the transferred
 * prefix draws the retained source rather than blank paper.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * below about which command was called with which window is a claim about the
 * shipped frontend.
 *
 * Two things this layer deliberately does not claim. A `WheelEvent` built and
 * dispatched by the driver is **not a user gesture**, and this engine performs
 * no native scrolling for one however the listener answers -- so
 * `defaultPrevented` is the whole of the evidence about ownership here, and
 * nothing below says a synthetic wheel scrolled anything. And the mocked
 * boundary answers a projection within a microtask, so the moment between
 * committing a window and its drawing arriving is not observable by driving the
 * interface; what *is* observable, and is measured, is that a window whose
 * drawing failed draws nothing at all beneath its own axes.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  boxOfButton,
  consoleEntries,
  horizontalOverflow,
  ipcCalls,
  setInvokeRejection,
  setInvokeResult,
} from "../support/harness";
import {
  SPECTRUM_MZ_HIGH,
  SPECTRUM_MZ_LOW,
  TRUNCATED_MZ_HIGH,
  TRUNCATED_MZ_LOW,
  fullSpectrumProjection,
  ipcTable,
} from "../support/fixtures";
import {
  SPECTRUM,
  SPECTRUM_ACTIONS,
  SPECTRUM_PLOT,
  SPECTRUM_RANGE,
  SPECTRUM_STATUS,
  SPECTRUM_SURFACE,
  openTheSpectrum,
  openTheViewer,
  revealTheSpectrum,
  selectTheSpectrum,
  selectedRowPosition,
  spectrumDomain,
  spectrumPointAt,
  spectrumProjections,
  spectrumRangeCaption,
  spectrumSpan,
  spectrumStatus,
  viewerReads,
} from "../support/viewer";

const VIEWPORTS = [
  { name: "1366x768", width: 1_366, height: 768 },
  { name: "1920x1080", width: 1_920, height: 1_080 },
  { name: "960x640", width: 960, height: 640 },
] as const;

/** The three controls the panel draws, by the words a person reads on them. */
const CONTROLS = ["Zoom in m/z", "Zoom out m/z", "Reset m/z range"] as const;

const RETRY = "Draw this m/z range again";

/**
 * The window one press of `Zoom in m/z` reaches from the whole spectrum.
 *
 * The product's own step of 0.6 about the centre of `buildSpectrum`'s domain,
 * stated here rather than recomputed in each case: a test that derived it would
 * be testing its own arithmetic instead of the panel's.
 */
const ZOOMED_LOW = 300.5;
const ZOOMED_HIGH = 302;

/**
 * And the window it reaches from the *truncated* spectrum's much wider domain.
 *
 * The number this milestone turns on. `SPECTRUM_MZ_HIGH` is where the
 * transferred prefix stops; this window begins more than a hundred m/z above
 * it, so nothing drawn inside it can have come from the arrays this document
 * holds.
 */
const TRUNCATED_WINDOW_LOW = 420;
const TRUNCATED_WINDOW_HIGH = 780;

/** How many observations the seeded retained-source window reports holding. */
const RETAINED_OBSERVATIONS = 372_118;

/** A wheel that narrows the range, and one that would widen it. */
const IN = -240;
const OUT = 240;

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/**
 * Dispatches one cancelable wheel on the drawing and reports whether the panel
 * took it.
 *
 * On the drawing rather than on the wrapper, because that is where the adapter
 * attaches its own non-passive listener -- React's `onWheel` is passive and
 * could not cancel anything. `deltaMode` defaults to pixels, which is what
 * nearly every device sends.
 */
async function wheelClaim(clientX: number, deltaY: number, deltaMode = 0): Promise<boolean> {
  return browser.execute(
    (css: string, x: number, delta: number, mode: number) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        deltaMode: mode,
        deltaY: delta,
      });
      document.querySelector(css)?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    SPECTRUM_PLOT,
    clientX,
    deltaY,
    deltaMode,
  ) as Promise<boolean>;
}

/**
 * Sends a whole stream of identical events the way one gesture arrives.
 *
 * Dispatched inside one script so the stream is not paced by the driver, and so
 * it cannot be interrupted by the settle it schedules. Answers how many of them
 * the panel claimed.
 */
async function wheelStream(clientX: number, deltaY: number, count: number): Promise<number> {
  return browser.execute(
    (css: string, x: number, delta: number, times: number) => {
      const plot = document.querySelector(css);
      let claimed = 0;
      for (let step = 0; step < times; step += 1) {
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          deltaY: delta,
        });
        plot?.dispatchEvent(event);
        if (event.defaultPrevented) {
          claimed += 1;
        }
      }
      return claimed;
    },
    SPECTRUM_PLOT,
    clientX,
    deltaY,
    count,
  ) as Promise<number>;
}

/**
 * Sends one key to the focused drawing, and reports whether the panel took it.
 *
 * Sent to the plot rather than pressed on a button, so nothing moves except the
 * range. The answer is the same claim the wheel makes: a key that changes
 * nothing belongs to the page, and this panel does not swallow it.
 */
async function keyTheSpectrum(key: string): Promise<boolean> {
  return browser.execute(
    (css: string, sent: string) => {
      const plot = document.querySelector<SVGSVGElement>(css);
      plot?.focus();
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: sent });
      plot?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    SPECTRUM_PLOT,
    key,
  ) as Promise<boolean>;
}

/** Which of the three controls would do something, by their own `disabled`. */
async function controlStates(): Promise<Record<string, boolean>> {
  return browser.execute((labels: readonly string[]) => {
    const buttons = [...document.querySelectorAll("button")];
    const state: Record<string, boolean> = {};
    for (const label of labels) {
      const found = buttons.find((button) => (button.textContent ?? "").trim() === label);
      state[label] = found !== undefined && !found.disabled;
    }
    return state;
  }, CONTROLS) as Promise<Record<string, boolean>>;
}

/**
 * What is actually on the plot: its sticks, its axis, and what it claims.
 *
 * The stick count comes from the one path the drawing emits, because that is
 * the whole of what a reader sees -- an empty `d` and an absent path are the
 * same blank plot, and both must be told apart from a plot with marks on it.
 */
async function whatIsDrawn(): Promise<{
  readonly sticks: number;
  readonly axisLow: string;
  readonly axisHigh: string;
  readonly caption: string;
}> {
  return browser.execute((css: string) => {
    const svg = document.querySelector(css);
    const path = svg?.querySelector("path.spectrum-sticks");
    const labels = Array.from(svg?.querySelectorAll("text.axis-label") ?? []);
    return {
      sticks: ((path?.getAttribute("d") ?? "").match(/M/gu) ?? []).length,
      axisLow: labels[0]?.textContent ?? "",
      axisHigh: labels[1]?.textContent ?? "",
      caption: (svg?.closest("figure")?.querySelector("figcaption")?.textContent ?? "").trim(),
    };
  }, SPECTRUM_PLOT) as Promise<{
    sticks: number;
    axisLow: string;
    axisHigh: string;
    caption: string;
  }>;
}

/**
 * Waits until the plot is showing a drawing of the range beneath it.
 *
 * `Drawn as` is the one opening the caption uses for a drawing that answers its
 * own axes. A window still being asked for says `Waiting for the drawing`, and a
 * gesture in flight says `Showing the drawing already in hand` -- so waiting on
 * this word waits for the state a case about a settled viewport is about, and
 * never past one a case about an unsettled viewport is about.
 */
async function waitForTheDrawing(): Promise<void> {
  await browser.waitUntil(async () => (await whatIsDrawn()).caption.startsWith("Drawn as"), {
    timeout: 15_000,
    timeoutMsg: "the viewport never drew the range it committed",
  });
}

/**
 * Waits until the drawing's own axis names the range given here.
 *
 * A one-shot read of the axis is a read of whichever render the driver happened
 * to catch, and this suite drives a surface whose drawing arrives a round trip
 * after the range it answers. Waiting is not a weaker assertion than reading
 * once: the range is committed synchronously, so a drawing that never comes to
 * sit under it fails here with the sentence that says so -- which is exactly
 * the defect (an old drawing left beneath a newer range) this milestone is
 * about.
 */
async function waitForTheAxis(low: string, high: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const drawn = await whatIsDrawn();
      return drawn.axisLow === low && drawn.axisHigh === high;
    },
    {
      timeout: 15_000,
      timeoutMsg: `the drawing never came to sit under m/z ${low} to ${high}`,
    },
  );
}

/** Every drawing this session has asked Rust for, as the windows it asked for. */
async function projectionsAskedFor(): Promise<readonly { low: number; high: number }[]> {
  return spectrumProjections(await ipcCalls());
}

/** Presses one of the panel's controls, where a reader can actually see it. */
async function press(label: string): Promise<void> {
  await revealTheSpectrum();
  await browser.$(`button=${label}`).click();
}

/**
 * What is painted at the centre of one control, by name.
 *
 * A rectangle with an area is not the same claim as a control a pointer can
 * reach: a header, a panel edge or a neighbouring group drawn over it would
 * leave the box exactly as it is. Answers the control's own name when the hit
 * lands on it, and what it landed on otherwise, so a failure says what is in
 * the way.
 */
async function whatIsAt(label: string): Promise<string> {
  return browser.execute((name: string) => {
    const node = [...document.querySelectorAll("button")].find(
      (candidate) => (candidate.textContent ?? "").trim() === name,
    );
    if (node === undefined) {
      return "no such button";
    }
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      return "a control with no area";
    }
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (at === null) {
      return "nothing on screen";
    }
    return at === node || node.contains(at)
      ? name
      : `${at.tagName.toLowerCase()}.${String(at.getAttribute("class") ?? "")}`;
  }, label) as Promise<string>;
}

/** What the viewer column can scroll, in real pixels. */
async function stackOverflow(): Promise<{
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly overflowY: string;
}> {
  return browser.execute(() => {
    const stack = document.querySelector<HTMLElement>("div.viewer-stack");
    return {
      scrollHeight: stack?.scrollHeight ?? 0,
      clientHeight: stack?.clientHeight ?? 0,
      overflowY: stack === null ? "" : getComputedStyle(stack).overflowY,
    };
  });
}

describe("the visible m/z viewport", () => {
  describe("the range a selected spectrum opens at", () => {
    it("draws the whole spectrum, says so, and asks Rust for exactly that window", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();

      expect(await spectrumRangeCaption()).toBe("Showing m/z 300.0000 to 302.5000 (full range)");
      await waitForTheAxis("300.0000", "302.5000");
      const drawn = await whatIsDrawn();
      expect(drawn.sticks).toBe(6);
      expect(drawn.caption).toContain(
        "Drawn as 6 sticks of the 6 observations this spectrum has between m/z 300.0000 and 302.5000",
      );

      // The window Rust was asked for is the spectrum's own domain, and it was
      // asked once. Read from the ledger rather than from what came back: a
      // static table answers every window with the same drawing, so what was
      // *asked for* is the only thing here that is evidence.
      expect(await projectionsAskedFor()).toEqual([
        { low: SPECTRUM_MZ_LOW, high: SPECTRUM_MZ_HIGH },
      ]);

      // A drawing that answers its own axes has nothing left to announce, so the
      // status region says nothing at all.
      expect(await spectrumStatus()).toBe("");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers only the action that can do anything when the whole range is shown", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();

      expect(await controlStates()).toEqual({
        "Zoom in m/z": true,
        "Zoom out m/z": false,
        "Reset m/z range": false,
      });
      expect(await browser.$(`button=${RETRY}`).isExisting()).toBe(false);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("the controls the panel offers", () => {
    it("narrows the range on Zoom in m/z and opens the two ways back", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();

      await press("Zoom in m/z");

      await browser.waitUntil(
        async () => !(await spectrumRangeCaption()).includes("full range"),
        { timeout: 15_000, timeoutMsg: "Zoom in m/z did not narrow the range" },
      );
      expect(await spectrumDomain()).toEqual({ low: ZOOMED_LOW, high: ZOOMED_HIGH });
      expect(await controlStates()).toEqual({
        "Zoom in m/z": true,
        "Zoom out m/z": true,
        "Reset m/z range": true,
      });
      // The axis the drawing is under is the window that was committed, and not
      // the range the answer happened to describe.
      await waitForTheDrawing();
      await waitForTheAxis("300.5000", "302.0000");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("widens the range again on Zoom out m/z, and stops at the whole spectrum", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await press("Zoom in m/z");
      await browser.waitUntil(
        async () => !(await spectrumRangeCaption()).includes("full range"),
        { timeout: 15_000 },
      );

      await press("Zoom out m/z");

      await browser.waitUntil(async () => (await spectrumRangeCaption()).includes("full range"), {
        timeout: 15_000,
        timeoutMsg: "Zoom out m/z did not return the whole spectrum",
      });
      expect(await spectrumDomain()).toEqual({ low: SPECTRUM_MZ_LOW, high: SPECTRUM_MZ_HIGH });
      // And having arrived there it stops offering to go further, which is the
      // rule this control group is built on.
      expect((await controlStates())["Zoom out m/z"]).toBe(false);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("returns the whole spectrum on Reset m/z range", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await press("Zoom in m/z");
      await press("Zoom in m/z");
      await browser.waitUntil(async () => (await spectrumSpan()) < 1, {
        timeout: 15_000,
        timeoutMsg: "two zooms did not narrow the range",
      });

      await press("Reset m/z range");

      await browser.waitUntil(async () => (await spectrumRangeCaption()).includes("full range"), {
        timeout: 15_000,
        timeoutMsg: "Reset m/z range did not return the whole spectrum",
      });
      expect((await controlStates())["Reset m/z range"]).toBe(false);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("stops offering to zoom in at the narrowest window the spectrum allows", async () => {
      // Driven there by pressing the button, not by naming a range.
      await openTheSpectrum();
      await waitForTheDrawing();
      for (let step = 0; step < 60; step += 1) {
        if (!(await controlStates())["Zoom in m/z"]) {
          break;
        }
        await press("Zoom in m/z");
      }

      const states = await controlStates();
      expect(states["Zoom in m/z"]).toBe(false);
      // And the two ways back out are still open.
      expect(states["Zoom out m/z"]).toBe(true);
      expect(states["Reset m/z range"]).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("real pointer interaction", () => {
    it("zooms about the pointer on a real wheel, and keeps the m/z under it where it was", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await revealTheSpectrum();
      // A quarter of the way across the drawn band, so an anchor that was
      // ignored in favour of the centre would be visible in the answer.
      const at = await spectrumPointAt(0.25);
      const held = SPECTRUM_MZ_LOW + (SPECTRUM_MZ_HIGH - SPECTRUM_MZ_LOW) * 0.25;

      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: IN }).perform();

      await browser.waitUntil(
        async () => !(await spectrumRangeCaption()).includes("full range"),
        { timeout: 15_000, timeoutMsg: "a real wheel did not change the m/z range" },
      );
      await waitForTheDrawing();
      const domain = await spectrumDomain();
      expect(domain.high - domain.low).toBeLessThan(SPECTRUM_MZ_HIGH - SPECTRUM_MZ_LOW);
      // The anchored property, and the reason it is worth asserting at this
      // layer: it holds whatever magnitude the browser decided the wheel was
      // worth, so nothing here rests on how Chrome packets a scroll. The m/z
      // that was under the pointer is still a quarter of the way across.
      expect((held - domain.low) / (domain.high - domain.low)).toBeCloseTo(0.25, 2);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("leaves an outward wheel at the whole spectrum alone, and moves nothing", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      const before = await spectrumRangeCaption();
      const asked = (await projectionsAskedFor()).length;

      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: OUT }).perform();

      // Long enough for a settle to have fired several times over, had one been
      // scheduled. An input this panel did not consume must leave no gesture,
      // no epoch and no request behind.
      await browser.pause(400);
      expect(await spectrumRangeCaption()).toBe(before);
      expect(await projectionsAskedFor()).toHaveLength(asked);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("pans from where the press began, keeping the width the reader chose", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await press("Zoom in m/z");
      await waitForTheDrawing();
      const span = await spectrumSpan();
      const before = await spectrumDomain();

      await revealTheSpectrum();
      const from = await spectrumPointAt(0.6);
      const to = await spectrumPointAt(0.45);
      await browser
        .action("pointer")
        .move({ x: from.x, y: from.y })
        .down()
        .move({ x: to.x, y: to.y })
        .up()
        .perform();

      await browser.waitUntil(async () => (await spectrumDomain()).low > before.low, {
        timeout: 15_000,
        timeoutMsg: "the drag did not move the m/z viewport",
      });
      await waitForTheDrawing();
      // Panned rather than resized. Compared at the caption's own four-decimal
      // resolution, which is what a reader can actually distinguish.
      expect(Math.abs((await spectrumSpan()) - span)).toBeLessThan(0.001);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("selects nothing when the spectrum is pressed", async () => {
      /*
       * A press that never passed the drag threshold committed nothing and
       * selects nothing. There is no peak, ion, annotation or scan selection to
       * invent here: the scan is chosen on the chromatogram and in the table,
       * and the only backend read a selection would cause is the one this whole
       * session has already made.
       */
      await openTheSpectrum();
      await waitForTheDrawing();
      const reads = viewerReads(await ipcCalls());
      const asked = (await projectionsAskedFor()).length;
      const before = await spectrumRangeCaption();
      const row = await selectedRowPosition();
      const marked = await browser.execute(
        () => document.querySelectorAll('[aria-selected="true"]').length,
      );

      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();

      await browser.pause(400);
      expect(await spectrumRangeCaption()).toBe(before);
      expect(await projectionsAskedFor()).toHaveLength(asked);
      expect(viewerReads(await ipcCalls())).toBe(reads);
      // The scan that was chosen in the table is still the one chosen, and
      // nothing anywhere in the document became newly selected: no peak, no
      // ion, no annotation and no scan.
      expect(await selectedRowPosition()).toBe(row);
      expect(
        await browser.execute(
          () => document.querySelectorAll('[aria-selected="true"]').length,
        ),
      ).toBe(marked);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("the keyboard", () => {
    it("zooms, pans and resets the m/z range from the drawing itself", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();

      await browser.execute((css: string) => {
        document.querySelector<SVGSVGElement>(css)?.focus();
      }, SPECTRUM_PLOT);
      expect(
        (await browser.execute(() => document.activeElement?.tagName ?? "")).toLowerCase(),
      ).toBe("svg");

      expect(await keyTheSpectrum("+")).toBe(true);
      await browser.waitUntil(
        async () => !(await spectrumRangeCaption()).includes("full range"),
        { timeout: 15_000, timeoutMsg: "the keyboard did not zoom the m/z range" },
      );
      const zoomed = await spectrumRangeCaption();
      const span = await spectrumSpan();

      expect(await keyTheSpectrum("ArrowRight")).toBe(true);
      await browser.waitUntil(async () => (await spectrumRangeCaption()) !== zoomed, {
        timeout: 15_000,
        timeoutMsg: "the keyboard did not pan the m/z range",
      });
      // Panned rather than resized: a different stretch of the spectrum, the
      // same width of it.
      expect(Math.abs((await spectrumSpan()) - span)).toBeLessThan(0.001);

      expect(await keyTheSpectrum("Home")).toBe(true);
      await browser.waitUntil(async () => (await spectrumRangeCaption()).includes("full range"), {
        timeout: 15_000,
        timeoutMsg: "the keyboard did not reset the m/z range",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("leaves a key that would change nothing to the page", async () => {
      // The same rule the wheel follows. At the whole spectrum there is nothing
      // to widen and nowhere to pan, so neither key is this panel's -- and Tab
      // is never this panel's, whatever the range is.
      await openTheSpectrum();
      await waitForTheDrawing();
      const before = await spectrumRangeCaption();

      expect(await keyTheSpectrum("-")).toBe(false);
      expect(await keyTheSpectrum("ArrowLeft")).toBe(false);
      expect(await keyTheSpectrum("ArrowRight")).toBe(false);
      expect(await keyTheSpectrum("Home")).toBe(false);
      expect(await keyTheSpectrum("Tab")).toBe(false);

      expect(await spectrumRangeCaption()).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("who owns a wheel over the spectrum", () => {
    /*
     * Cancelling a wheel event is a claim on it, and this panel sits inside a
     * column that scrolls *and* inside a panel that scrolls. A wheel MSCanvas
     * cancels and then does not use is a wheel that neither zoomed nor scrolled,
     * which is the defect these cases close.
     *
     * Whether the panel claimed the event and whether the range moved are two
     * different questions, and both are asked separately every time: a surface
     * that cancelled everything and moved correctly would pass one of them.
     */

    it("has a column with somewhere to scroll to at 1366x768", async () => {
      // The reason the claim matters. On the laptop window this product is
      // measured against, the three panels do not all fit, and the wheel is how
      // a reader reaches the spectrum at the bottom of the column.
      await openTheSpectrum({ width: 1_366, height: 768 });

      const stack = await stackOverflow();
      expect(stack.overflowY).toBe("auto");
      expect(stack.clientHeight).toBeGreaterThan(0);
      expect(stack.scrollHeight).toBeGreaterThan(stack.clientHeight);
    });

    it("claims a wheel that narrows the range, and moves the range with it", async () => {
      await openTheSpectrum({ width: 1_366, height: 768 });
      await waitForTheDrawing();
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      const full = await spectrumSpan();

      expect(await wheelClaim(at.x, IN)).toBe(true);

      await browser.waitUntil(async () => (await spectrumSpan()) < full, {
        timeout: 15_000,
        timeoutMsg: "a claimed wheel changed nothing",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("releases an outward wheel at the whole spectrum to the page", async () => {
      await openTheSpectrum({ width: 1_366, height: 768 });
      await waitForTheDrawing();
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      const before = await spectrumRangeCaption();
      expect(before).toContain("full range");

      expect(await wheelClaim(at.x, OUT)).toBe(false);

      expect(await spectrumRangeCaption()).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("stops claiming inward wheels at the narrowest window the spectrum allows", async () => {
      // Driven there by turning the wheel, not by naming a range.
      await openTheSpectrum({ width: 1_366, height: 768 });
      await waitForTheDrawing();
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      let claimed = 0;
      for (let notch = 0; notch < 120; notch += 1) {
        if (!(await wheelClaim(at.x, IN))) {
          break;
        }
        claimed += 1;
      }
      expect(claimed).toBeGreaterThan(0);

      expect(await wheelClaim(at.x, IN)).toBe(false);
      // And the way back out is still the panel's.
      expect(await wheelClaim(at.x, OUT)).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("releases every wheel over a spectrum whose m/z range cannot be navigated", async () => {
      await openTheSpectrum({
        width: 1_366,
        height: 768,
        answers: ipcTable({ refusedViewport: true }),
      });
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);

      for (const deltaY of [IN, OUT, -1, 1]) {
        expect(await wheelClaim(at.x, deltaY)).toBe(false);
      }

      // And the points are still drawn. No range to navigate is not nothing to
      // see, and releasing the wheel did not cost the spectrum its picture.
      expect((await whatIsDrawn()).sticks).toBe(6);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("releases a wheel that arrives while a press already owns the plot", async () => {
      /*
       * A press owns the gesture and a wheel is not it. Joining the pan's
       * gesture would put this adapter's settle timer on someone else's epoch,
       * after which every later pointer move carries a dead epoch and the pan
       * freezes until the button comes up. So the event is not claimed, nothing
       * is dispatched, and the pan is left exactly as it was.
       */
      await openTheSpectrum({ width: 1_366, height: 768 });
      await waitForTheDrawing();
      await press("Zoom in m/z");
      await waitForTheDrawing();

      await revealTheSpectrum();
      const from = await spectrumPointAt(0.6);
      const to = await spectrumPointAt(0.45);
      await browser
        .action("pointer")
        .move({ x: from.x, y: from.y })
        .down()
        .move({ x: to.x, y: to.y })
        .perform(true);

      const during = await spectrumRangeCaption();
      const asked = (await projectionsAskedFor()).length;

      expect(await wheelClaim(to.x, IN)).toBe(false);

      expect(await spectrumRangeCaption()).toBe(during);
      expect(await projectionsAskedFor()).toHaveLength(asked);

      // And releasing still commits the pan the press was making.
      await browser.action("pointer").up().perform();
      await waitForTheDrawing();
      expect(await spectrumRangeCaption()).toBe(during);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("how often Rust is asked for a drawing", () => {
    it("asks for nothing while a drag is in flight, and once when it is released", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await press("Zoom in m/z");
      await waitForTheDrawing();
      const asked = (await projectionsAskedFor()).length;

      await revealTheSpectrum();
      const from = await spectrumPointAt(0.6);
      const to = await spectrumPointAt(0.45);
      // The release is skipped explicitly. `perform()` releases the pointer when
      // the sequence ends, so "has not been released" would otherwise be true
      // only for the 120ms the settle had left to run -- an assertion about
      // scheduling rather than about the gesture.
      await browser
        .action("pointer")
        .move({ x: from.x, y: from.y })
        .down()
        .move({ x: to.x, y: to.y })
        .perform(true);

      // The range on screen has moved and the drawing says outright that it is
      // the one already in hand, which is exactly the state that must cost no
      // request: a range still being dragged is a drawing, not a decision.
      const during = await whatIsDrawn();
      expect(during.caption).toContain(
        "Showing the drawing already in hand while the range is being changed",
      );
      expect(during.caption).toContain("Release to draw m/z");
      expect(await projectionsAskedFor()).toHaveLength(asked);

      await browser.action("pointer").up().perform();

      await waitForTheDrawing();
      expect(await projectionsAskedFor()).toHaveLength(asked + 1);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("asks once for a stream of wheel events belonging to one gesture", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      const asked = (await projectionsAskedFor()).length;

      // Sixty events inside one script, the way a precision touchpad delivers
      // one gesture. Every one of them is the panel's, and together they are one
      // epoch that settles once.
      expect(await wheelStream(at.x, -1, 60)).toBe(60);

      await waitForTheDrawing();
      expect(await projectionsAskedFor()).toHaveLength(asked + 1);
      expect(await spectrumRangeCaption()).not.toContain("full range");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("asks exactly once for each window it commits", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      const asked = (await projectionsAskedFor()).length;

      await press("Zoom in m/z");

      await waitForTheDrawing();
      const windows = await projectionsAskedFor();
      expect(windows).toHaveLength(asked + 1);
      expect(windows[windows.length - 1]).toEqual({ low: ZOOMED_LOW, high: ZOOMED_HIGH });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("never reads the preview or the spectrum again while the viewport moves", async () => {
      // Load-bearing. Moving a viewport is not re-acquiring a spectrum, and a
      // pan that re-read the file would launch a ProteoWizard process per
      // gesture.
      await openTheSpectrum();
      await waitForTheDrawing();
      const reads = viewerReads(await ipcCalls());

      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: IN }).perform();
      await press("Zoom in m/z");
      await press("Zoom out m/z");
      await press("Reset m/z range");
      await keyTheSpectrum("+");
      await keyTheSpectrum("ArrowRight");
      await keyTheSpectrum("Home");
      await waitForTheDrawing();

      expect(viewerReads(await ipcCalls())).toBe(reads);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("a drawing that failed, or truthfully held nothing", () => {
    const REFUSAL = {
      kind: "spectrum_projection_failed",
      summary: "That m/z range could not be drawn from the retained spectrum.",
      detail: "The backend refused the window.",
      retryable: true,
    } as const;

    it("draws nothing under the new axes when the drawing failed, and offers to ask again", async () => {
      /*
       * Two properties in one case, because they are one moment. The window that
       * failed is the one committed, and the drawing that answered the *previous*
       * window is gone -- leaving it in place is how a reader comes to see one
       * range's data beneath another range's numbers. And a failure this side can
       * classify as retryable gets a control that asks the same question again.
       */
      await openTheViewer();
      await selectTheSpectrum();
      await waitForTheDrawing();
      expect((await whatIsDrawn()).sticks).toBe(6);

      await setInvokeRejection("project_selected_spectrum", REFUSAL);
      await press("Zoom in m/z");

      await browser.waitUntil(
        async () => (await spectrumStatus()).includes("could not be drawn"),
        { timeout: 15_000, timeoutMsg: "the failed drawing was never reported" },
      );
      expect(await spectrumStatus()).toBe(`${REFUSAL.summary} ${REFUSAL.detail}`);
      // The axes are the newly committed window, and there is nothing beneath
      // them.
      await waitForTheAxis("300.5000", "302.0000");
      const failed = await whatIsDrawn();
      expect(failed.sticks).toBe(0);
      expect(await browser.$(`button=${RETRY}`).isExisting()).toBe(true);

      // Same spectrum, same window, new generation: the retry and the first
      // request ask the same question.
      await setInvokeResult("project_selected_spectrum", fullSpectrumProjection());
      const asked = (await projectionsAskedFor()).length;
      await press(RETRY);

      await waitForTheDrawing();
      const windows = await projectionsAskedFor();
      expect(windows).toHaveLength(asked + 1);
      expect(windows[windows.length - 1]).toEqual({ low: ZOOMED_LOW, high: ZOOMED_HIGH });
      expect(await spectrumStatus()).toBe("");
      expect(await browser.$(`button=${RETRY}`).isExisting()).toBe(false);
      // A refusal rendered in the interface is not a console failure.
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers no retry where the failure says there is nothing to retry", async () => {
      await openTheViewer();
      await setInvokeRejection("project_selected_spectrum", {
        kind: "spectrum_projection_unsupported",
        summary: "This m/z range cannot be drawn from what MSCanvas retained.",
        detail: null,
        retryable: false,
      });
      await selectTheSpectrum();

      await browser.waitUntil(
        async () => (await spectrumStatus()).includes("cannot be drawn"),
        { timeout: 15_000, timeoutMsg: "the failed drawing was never reported" },
      );
      // The whole sentence, and nothing appended where there is no detail.
      expect(await spectrumStatus()).toBe(
        "This m/z range cannot be drawn from what MSCanvas retained.",
      );
      expect(await browser.$(`button=${RETRY}`).isExisting()).toBe(false);
      expect((await whatIsDrawn()).sticks).toBe(0);
      // The controls are still the viewport's own: a drawing that failed did not
      // take away the range there is to navigate.
      expect((await controlStates())["Zoom in m/z"]).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("says a window truthfully holds no point rather than calling it loading or a failure", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();

      await setInvokeResult("project_selected_spectrum", {
        low: ZOOMED_LOW,
        high: ZOOMED_HIGH,
        mz: [],
        intensity: [],
        sourcePoints: 0,
        reduced: false,
      });
      await press("Zoom in m/z");

      await browser.waitUntil(
        async () => (await spectrumStatus()).includes("no measured point"),
        { timeout: 15_000, timeoutMsg: "the empty window was never described" },
      );
      const status = await spectrumStatus();
      expect(status).toContain(
        "This spectrum reports no measured point between m/z 300.5000 and 302.0000",
      );
      expect(status).toContain("That is what the file says about this range");
      // Told apart from the two states it could be mistaken for, in both
      // directions: it is not waiting, and it is not a failure.
      expect(status).not.toContain("Nothing is drawn here until it arrives");
      expect(await browser.$(`button=${RETRY}`).isExisting()).toBe(false);
      expect((await whatIsDrawn()).sticks).toBe(0);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("a spectrum whose m/z range cannot be navigated", () => {
    const REFUSED_TABLE = () => ipcTable({ refusedViewport: true });

    it("still draws the spectrum's own points and says why there is no range", async () => {
      await openTheSpectrum({ answers: REFUSED_TABLE() });

      // Selected, loaded and drawn. A refusal is a fact about drawability, not
      // about the spectrum being unusable.
      expect(await browser.$(SPECTRUM).getText()).toContain("Spectrum 0");
      await waitForTheAxis("300.0000", "302.5000");
      const drawn = await whatIsDrawn();
      expect(drawn.sticks).toBe(6);
      expect(drawn.caption).toContain("Drawn as 6 sticks, one per point.");

      expect(await spectrumRangeCaption()).toBe("No m/z range to navigate.");
      const status = await spectrumStatus();
      expect(status).toContain("The m/z range of this spectrum cannot be navigated.");
      expect(status).toContain("do not increase from one point to the next");
      expect(status).toContain("a sorted copy would be a different measurement");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers no action, takes no key, and asks Rust for no drawing", async () => {
      await openTheSpectrum({ answers: REFUSED_TABLE() });

      expect(await controlStates()).toEqual({
        "Zoom in m/z": false,
        "Zoom out m/z": false,
        "Reset m/z range": false,
      });
      // Not a tab stop either: a keyboard user's time is not spent reaching a
      // picture nothing can be done to.
      expect(
        await browser.execute(
          (css: string) => document.querySelector(css)?.getAttribute("tabindex"),
          SPECTRUM_PLOT,
        ),
      ).toBeNull();
      expect(await keyTheSpectrum("+")).toBe(false);
      expect(await keyTheSpectrum("Home")).toBe(false);

      // The spectrum was read once, and no drawing of it was ever asked for.
      expect(await projectionsAskedFor()).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("a spectrum whose retained source outruns its transfer", () => {
    /*
     * The milestone's headline, measured from outside.
     *
     * The fixture's retained source runs from 300 to 900 and the arrays that
     * reached this document stop at 302.5. Before M5.2 the drawing *was* those
     * arrays, so everything above 302.5 was blank paper. What these cases
     * establish is that the window the panel asks for is the retained
     * spectrum's, and that a window beginning far past the end of the prefix
     * comes back with observations and draws them.
     */

    it("asks for the whole retained range rather than the transferred prefix", async () => {
      await openTheSpectrum({ answers: ipcTable({ truncatedSource: true }) });
      await waitForTheDrawing();

      expect(await projectionsAskedFor()).toEqual([
        { low: TRUNCATED_MZ_LOW, high: TRUNCATED_MZ_HIGH },
      ]);
      expect(await spectrumRangeCaption()).toBe("Showing m/z 300.0000 to 900.0000 (full range)");
      // And the panel says the bound applies to the arrays rather than to the
      // drawing, which is the sentence that stopped being true before M5.2.
      const panel = await browser.$(SPECTRUM).getText();
      expect(panel).toContain("The drawing is not limited to them");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("draws the retained observations of a window that begins past the prefix", async () => {
      await openTheSpectrum({ answers: ipcTable({ truncatedSource: true }) });
      await waitForTheDrawing();

      // Seeded before the press, because the request goes out the moment the
      // window is committed. Every point here is well above where the transfer
      // stopped, so nothing drawn from them could have come from this document.
      await setInvokeResult("project_selected_spectrum", {
        low: TRUNCATED_WINDOW_LOW,
        high: TRUNCATED_WINDOW_HIGH,
        mz: [450, 550, 650, 750],
        intensity: [120_000, 4_200_000, 900_000, 310_000],
        sourcePoints: RETAINED_OBSERVATIONS,
        reduced: true,
      });

      await press("Zoom in m/z");

      await waitForTheDrawing();
      const windows = await projectionsAskedFor();
      const asked = windows[windows.length - 1];
      // The window actually asked for begins above the end of the transferred
      // prefix, which is the whole reason this case exists.
      expect(asked).toEqual({ low: TRUNCATED_WINDOW_LOW, high: TRUNCATED_WINDOW_HIGH });
      expect(asked?.low).toBeGreaterThan(SPECTRUM_MZ_HIGH);

      await waitForTheAxis("420.0000", "780.0000");
      const drawn = await whatIsDrawn();
      // Marks on the plot rather than a blank area. Four points, four sticks.
      expect(drawn.sticks).toBe(4);
      // The count is Rust's about the retained source, not this document's about
      // its prefix: 372,118 observations in a region the transfer never reached.
      expect(drawn.caption).toContain(
        "Drawn as 4 sticks of the 372,118 observations this spectrum has between m/z 420.0000 and 780.0000.",
      );
      expect(await spectrumStatus()).toBe("");
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("layout", () => {
    for (const viewport of VIEWPORTS) {
      it(`keeps the three m/z controls reachable and hit-testable at ${viewport.name}`, async () => {
        await openTheSpectrum({ width: viewport.width, height: viewport.height });
        await waitForTheDrawing();

        // Through the product's own scroll owners, which is what makes this a
        // claim about a reader reaching the controls rather than about the
        // driver being able to.
        const stack = await stackOverflow();
        expect(stack.overflowY).toBe("auto");
        const visible = await revealTheSpectrum();
        expect(visible.width).toBeGreaterThan(0);
        expect(visible.height).toBeGreaterThan(0);

        const panel = await boxOf(SPECTRUM);
        for (const control of CONTROLS) {
          const button = await boxOfButton(control);
          expect(button.width).toBeGreaterThan(0);
          expect(button.height).toBeGreaterThan(0);
          // Sideways only. The panel scrolls, so a control below its visible
          // edge is reachable rather than lost -- but one outside its width is
          // clipped, and this panel clips.
          expect(button.left).toBeGreaterThanOrEqual(panel.left - 0.5);
          expect(button.right).toBeLessThanOrEqual(panel.right + 0.5);
          expect(await whatIsAt(control)).toBe(control);
        }

        const overflow = await horizontalOverflow();
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`keeps the plot, its controls and its captions clear of each other at ${viewport.name}`, async () => {
        await openTheSpectrum({ width: viewport.width, height: viewport.height });
        await waitForTheDrawing();
        await revealTheSpectrum();

        const panel = await boxOf(SPECTRUM);
        const plot = await boxOf(SPECTRUM_PLOT);
        // A plot with no area is a plot nobody can read or point at, and one
        // squeezed below its own height is not a spectrum any more. Its width is
        // asked as a share of the panel rather than in pixels, so the claim is
        // "the drawing gets the room" at every window rather than a number that
        // happens to hold at one of them.
        expect(plot.width).toBeGreaterThan(panel.width * 0.6);
        expect(plot.height).toBeGreaterThanOrEqual(200);
        expect(plot.left).toBeGreaterThanOrEqual(panel.left - 0.5);
        expect(plot.right).toBeLessThanOrEqual(panel.right + 0.5);

        // Stacked, not overlapping: controls above the drawing, the range line
        // below it. Two of them sharing pixels would put a control over the
        // spectrum, which is the failure a screenshot would show and a unit test
        // could not.
        const actions = await boxOf(SPECTRUM_ACTIONS);
        const surface = await boxOf(SPECTRUM_SURFACE);
        const range = await boxOf(SPECTRUM_RANGE);
        expect(actions.height).toBeGreaterThan(0);
        expect(actions.bottom).toBeLessThanOrEqual(surface.top + 0.5);
        expect(surface.bottom).toBeLessThanOrEqual(range.top + 0.5);
        expect(range.left).toBeGreaterThanOrEqual(panel.left - 0.5);
        expect(range.right).toBeLessThanOrEqual(panel.right + 0.5);

        // And the range line says something. An element with a layout rectangle
        // and no visible text is exactly what a clipped caption looks like.
        expect((await spectrumRangeCaption()).length).toBeGreaterThan(0);
        // The status line is measured nowhere here on purpose: a drawing that
        // answers its own axes leaves it empty, and this repository collapses an
        // empty live region by rule rather than unmounting it. What it does when
        // it has something to say is measured beside the states that give it
        // something.
        expect(await browser.$(SPECTRUM_STATUS).isExisting()).toBe(true);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  });

  describe("the console", () => {
    it("stays clean through a whole session of m/z viewport interaction", async () => {
      await openTheSpectrum();
      await waitForTheDrawing();
      await revealTheSpectrum();
      const at = await spectrumPointAt(0.5);

      // Ordered so that every control pressed here is one the panel is
      // offering at the moment it is pressed. Pressing a control the surface
      // has closed is a question about the browser rather than about MSCanvas,
      // and this case is about neither -- it is about the console.
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: IN }).perform();
      await press("Zoom in m/z");
      await press("Zoom out m/z");
      // Measured again, because the two presses above put the keyboard on a
      // control and a panel that has scrolled is a panel whose plot is
      // somewhere else.
      await revealTheSpectrum();
      const middle = await spectrumPointAt(0.5);
      await browser
        .action("pointer")
        .move({ x: middle.x, y: middle.y })
        .down()
        .move({ x: middle.x - 60, y: middle.y })
        .up()
        .perform();
      await keyTheSpectrum("+");
      await keyTheSpectrum("ArrowLeft");
      await keyTheSpectrum("ArrowRight");
      await wheelStream(middle.x, -1, 40);
      await press("Reset m/z range");
      await waitForTheDrawing();

      expect(await unexpectedConsole()).toEqual([]);
    });
  });
});
