/**
 * Viewer Closure R1 rendered QA — the linked viewer, in a real browser.
 *
 * The unit tests beside the components already pin what each surface does. What
 * only a browser can answer is whether the plot is actually inside its panel at
 * a given window, whether a real wheel and a real drag move the viewport,
 * whether a revealed row lands where the sticky header leaves it, and whether
 * the three linked views agree on screen rather than only in state.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * about which command was called with which argument is a claim about the
 * shipped frontend.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  boxOfButton,
  consoleEntries,
  focusedName,
  focusedTreatment,
  horizontalOverflow,
  installIpcBoundary,
  ipcCalls,
} from "../support/harness";
import { MZML_ROW, VENDOR_ROW, ipcTable } from "../support/fixtures";
import type { Box } from "../support/viewer";
import {
  AXIS_CAPTION,
  CHROMATOGRAM,
  PLOT,
  RANGE,
  READOUT,
  RT_STEP,
  SPECTRUM,
  TABLE,
  clickThePlotAt,
  leaveThePlot,
  openTheViewer,
  plotBox,
  pointAt,
  pointAtRetentionTime,
  rangeCaption,
  readout,
  selectedRowPosition,
  viewerReads,
  visibleDomain,
  visibleSpan,
} from "../support/viewer";

const VIEWPORTS = [
  { name: "1366x768", width: 1_366, height: 768 },
  { name: "1920x1080", width: 1_920, height: 1_080 },
  { name: "960x640", width: 960, height: 640 },
] as const;

/** Enough scans that a pointer pixel is not the whole run. */
const SCANS = 200;

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** How many nodes the plot draws, which must not grow with the run. */
async function plotNodeCounts(): Promise<{
  readonly paths: number;
  readonly circles: number;
  readonly total: number;
}> {
  return browser.execute((css: string) => {
    const svg = document.querySelector(css);
    return {
      paths: svg?.querySelectorAll("path.chromatogram-trace").length ?? 0,
      circles: svg?.querySelectorAll("circle").length ?? 0,
      total: svg?.querySelectorAll("*").length ?? 0,
    };
  }, PLOT);
}

/** Sends one key to the focused plot without moving the pointer off it. */
async function keyThePlot(key: string): Promise<void> {
  await browser.execute(
    (css: string, sent: string) => {
      const plot = document.querySelector<SVGSVGElement>(css);
      plot?.focus();
      plot?.dispatchEvent(new KeyboardEvent("keydown", { key: sent, bubbles: true }));
    },
    PLOT,
    key,
  );
}

/**
 * Dispatches one cancelable key press and reports whether the viewer took it.
 *
 * `keyThePlot` above answers nothing, which is enough where the question is
 * whether the range moved. Where the question is *ownership* the claim is half
 * the answer, so this one returns it and names every modifier explicitly --
 * a case that means "unmodified" then says so rather than relying on a field it
 * never considered being absent.
 */
async function keyClaim(
  key: string,
  modifiers: {
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly altKey?: boolean;
    readonly shiftKey?: boolean;
  } = {},
): Promise<boolean> {
  return browser.execute(
    (
      css: string,
      sent: string,
      held: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
    ) => {
      const plot = document.querySelector<SVGSVGElement>(css);
      plot?.focus();
      const event = new KeyboardEvent("keydown", {
        altKey: held.altKey,
        bubbles: true,
        cancelable: true,
        ctrlKey: held.ctrlKey,
        key: sent,
        metaKey: held.metaKey,
        shiftKey: held.shiftKey,
      });
      plot?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    PLOT,
    key,
    {
      altKey: modifiers.altKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
    },
  ) as Promise<boolean>;
}

/** One cancelable wheel carrying a modifier, and whether the viewer took it. */
async function modifiedWheelClaim(
  clientX: number,
  deltaY: number,
  modifiers: { readonly ctrlKey?: boolean; readonly shiftKey?: boolean } = {},
): Promise<boolean> {
  return browser.execute(
    (
      css: string,
      x: number,
      delta: number,
      held: { ctrlKey: boolean; shiftKey: boolean },
    ) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        ctrlKey: held.ctrlKey,
        deltaY: delta,
        shiftKey: held.shiftKey,
      });
      document.querySelector(css)?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    PLOT,
    clientX,
    deltaY,
    { ctrlKey: modifiers.ctrlKey ?? false, shiftKey: modifiers.shiftKey ?? false },
  ) as Promise<boolean>;
}

/**
 * Dispatches one cancelable wheel and reports whether the viewer took it.
 *
 * `deltaMode` defaults to pixels, which is what nearly every device sends.
 */
async function wheelClaim(
  clientX: number,
  deltaY: number,
  deltaMode = 0,
): Promise<boolean> {
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
    PLOT,
    clientX,
    deltaY,
    deltaMode,
  ) as Promise<boolean>;
}

/**
 * Sends a whole stream of identical events the way one gesture arrives.
 *
 * Dispatched inside one script so the stream is not paced by the driver, and so
 * it cannot be interrupted by the settle it schedules.
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
    PLOT,
    clientX,
    deltaY,
    count,
  ) as Promise<number>;
}

/** Sends one wheel notch without moving the pointer, so hover stays where it is. */
async function wheelInPlace(clientX: number, deltaY: number): Promise<void> {
  await browser.execute(
    (css: string, x: number, delta: number) => {
      document.querySelector(css)?.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, deltaY: delta }),
      );
    },
    PLOT,
    clientX,
    deltaY,
  );
}

describe("the linked viewer, rendered", () => {
  describe("layout", () => {
    for (const viewport of VIEWPORTS) {
      it(`keeps the plot and its controls inside the panel at ${viewport.name}`, async () => {
        await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });

        const panel = await boxOf(CHROMATOGRAM);
        expect(panel.width).toBeGreaterThan(0);
        expect(panel.height).toBeGreaterThan(0);

        const plot = await boxOf(PLOT);
        // A plot with no area is a plot nobody can read or point at.
        expect(plot.width).toBeGreaterThan(0);
        expect(plot.height).toBeGreaterThanOrEqual(52);
        // Per edge, so a failure names which way it escaped.
        expect(plot.left).toBeGreaterThanOrEqual(panel.left - 0.5);
        expect(plot.right).toBeLessThanOrEqual(panel.right + 0.5);
        expect(plot.top).toBeGreaterThanOrEqual(panel.top - 0.5);
        expect(plot.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);

        for (const control of ["Zoom in", "Zoom out", "Reset range"]) {
          const button = await boxOfButton(control);
          expect(button.width).toBeGreaterThan(0);
          expect(button.height).toBeGreaterThan(0);
          expect(button.left).toBeGreaterThanOrEqual(panel.left - 0.5);
          expect(button.right).toBeLessThanOrEqual(panel.right + 0.5);
          expect(button.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);
        }

        // The traces are switched here too, and a checkbox squeezed to nothing
        // is a control that exists and cannot be used.
        const toggles = await browser.execute(() =>
          [...document.querySelectorAll("label.chromatogram-trace-toggle input")].map((input) => {
            const box = input.getBoundingClientRect();
            return { width: box.width, height: box.height };
          }),
        );
        expect(toggles).toHaveLength(2);
        for (const toggle of toggles) {
          expect(toggle.width).toBeGreaterThan(0);
          expect(toggle.height).toBeGreaterThan(0);
        }

        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`keeps the scan steps and the panels clear of each other at ${viewport.name}`, async () => {
        await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });

        const table = await boxOf(TABLE);
        for (const control of ["Previous scan", "Next scan"]) {
          const button = await boxOfButton(control);
          expect(button.width).toBeGreaterThan(0);
          expect(button.height).toBeGreaterThan(0);
          expect(button.left).toBeGreaterThanOrEqual(table.left - 0.5);
          expect(button.right).toBeLessThanOrEqual(table.right + 0.5);
          expect(button.bottom).toBeLessThanOrEqual(table.bottom + 0.5);
        }

        // Stacked, not overlapping. Two panels sharing pixels would hide rows
        // behind a plot, which is the failure a screenshot would show and a
        // unit test could not.
        const chromatogram = await boxOf(CHROMATOGRAM);
        const spectrum = await boxOf(SPECTRUM);
        expect(chromatogram.bottom).toBeLessThanOrEqual(table.top + 0.5);
        expect(table.bottom).toBeLessThanOrEqual(spectrum.top + 0.5);
        expect(table.height).toBeGreaterThan(0);
        expect(spectrum.height).toBeGreaterThan(0);

        // And one complete row of the table is reachable, which is the least
        // that is still a table.
        const rows = await browser.execute(
          () => document.querySelectorAll("div.spectrum-table-window div.spectrum-table-row").length,
        );
        expect(rows).toBeGreaterThan(0);

        const overflow = await horizontalOverflow();
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
      });
    }

    it("keeps everything under the plot readable at the narrow window", async () => {
      // The failure this guards against is not overflow, which would be
      // visible: the body clips, so a caption that does not fit is silently
      // gone. Reading the text back is what catches that -- an element with a
      // layout rect but no visible text is exactly what a clipped caption looks
      // like.
      await openTheViewer({ width: 960, height: 640, scans: SCANS });

      const panel = await boxOf(CHROMATOGRAM);
      for (const caption of [AXIS_CAPTION, READOUT, RANGE]) {
        const text = (await browser.$(caption).getText()).trim();
        expect(text.length).toBeGreaterThan(0);
        const box = await boxOf(caption);
        expect(box.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);
      }
      for (const group of [".chromatogram-traces", ".chromatogram-viewport-actions"]) {
        const box = await boxOf(group);
        expect(box.top).toBeGreaterThanOrEqual(panel.top - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);
        expect(box.height).toBeGreaterThan(0);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("what the plot draws", () => {
    it("draws one path per trace rather than one node per scan", async () => {
      await openTheViewer({ scans: SCANS });

      expect((await plotNodeCounts()).paths).toBe(1);
      await browser.$("//span[normalize-space()='BPC']/preceding-sibling::input").click();

      const both = await plotNodeCounts();
      expect(both.paths).toBe(2);
      expect(both.circles).toBe(0);
      // A small fixed set of elements: axes, labels, a clip and two traces.
      expect(both.total).toBeLessThan(40);

      await browser.$("//span[normalize-space()='TIC']/preceding-sibling::input").click();
      expect((await plotNodeCounts()).paths).toBe(1);
    });

    it("says on purpose when both traces are hidden", async () => {
      await openTheViewer({ scans: SCANS });

      await browser.$("//span[normalize-space()='TIC']/preceding-sibling::input").click();

      expect((await plotNodeCounts()).paths).toBe(0);
      expect(await browser.$(PLOT).isDisplayed()).toBe(true);
      expect(await browser.$("text.chromatogram-hidden-note").getText()).toBe(
        "Both traces are hidden.",
      );
    });

    it("says what the traces are and which units were not reported", async () => {
      await openTheViewer({ scans: SCANS });

      const caption = await browser.$(AXIS_CAPTION).getText();
      expect(caption).toContain("Per-scan values from the loaded spectrum table");
      expect(caption).toContain("Not a stored chromatogram record");
      expect(caption).toContain("Retention time — unit not reported");
      expect(caption).toContain("Intensity — unit not reported");
    });
  });

  describe("real pointer interaction", () => {
    it("reports the scan under the pointer without selecting anything", async () => {
      await openTheViewer({ scans: SCANS });

      const at = await pointAt(0.5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).perform();
      await browser.waitUntil(async () => (await readout()).startsWith("Hovering"), {
        timeout: 10_000,
        timeoutMsg: "the plot never reported a hovered scan",
      });

      expect(await readout()).toContain("MS");
      expect(await readout()).toContain("TIC");
      // Transient: nothing was selected and nothing was read.
      expect(await selectedRowPosition()).toBeNull();
      expect(
        (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum"),
      ).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("selects the nearest scan on click, and every linked view follows", async () => {
      await openTheViewer({ scans: SCANS });

      const at = await pointAtRetentionTime(60 * RT_STEP);
      await clickThePlotAt(at.x, at.y);

      await browser.waitUntil(async () => (await selectedRowPosition()) === 60, {
        timeout: 10_000,
        timeoutMsg: "the click never selected scan 60",
      });
      await leaveThePlot();
      await browser.waitUntil(async () => (await readout()).startsWith("Selected index 60,"), {
        timeout: 10_000,
        timeoutMsg: "the plot never reported the selected scan",
      });

      // The one backend read, for that scan and no other.
      const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
      expect(reads).toHaveLength(1);
      expect(reads[0]?.args["index"]).toBe(60);

      // The marker is a rule and a glyph rather than a colour.
      const marker = await browser.execute(() => {
        const group = document.querySelector("g.chromatogram-selected");
        return {
          present: group !== null,
          lines: group?.querySelectorAll("line").length ?? 0,
          glyphs: group?.querySelectorAll("rect").length ?? 0,
        };
      });
      expect(marker).toEqual({ present: true, lines: 1, glyphs: 1 });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("zooms on a real wheel and keeps the range it reached", async () => {
      await openTheViewer({ scans: SCANS });
      expect(await rangeCaption()).toContain("full range");

      const at = await pointAt(0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -240 }).perform();

      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the wheel never changed the visible range",
      });
      const settled = await rangeCaption();
      // Still there after the debounce has had every chance to fire.
      await browser.pause(300);
      expect(await rangeCaption()).toBe(settled);
      expect(await browser.$("button=Reset range").isEnabled()).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("pans on a real drag without changing the span", async () => {
      await openTheViewer({ scans: SCANS });
      await browser.$("button=Zoom in").click();
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
      });
      const before = await visibleSpan();
      const low = (await visibleDomain()).low;

      const from = await pointAt(0.7);
      const to = await pointAt(0.3);
      await browser
        .action("pointer")
        .move({ x: from.x, y: from.y })
        .down()
        .move({ x: to.x, y: to.y, duration: 60 })
        .up()
        .perform();

      await browser.waitUntil(async () => (await visibleDomain()).low > low, {
        timeout: 10_000,
        timeoutMsg: "the drag did not move the viewport",
      });
      // Panned rather than resized, and nothing was selected by the drag.
      expect(Math.abs((await visibleSpan()) - before)).toBeLessThan(before * 0.02);
      expect(await selectedRowPosition()).toBeNull();
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("resets to the whole run", async () => {
      await openTheViewer({ scans: SCANS });
      await browser.$("button=Zoom in").click();
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
      });

      await browser.$("button=Reset range").click();

      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "Reset range did not return the whole run",
      });
      expect(await browser.$("button=Reset range").isEnabled()).toBe(false);
    });

    it("never asks the backend for anything while the viewport moves", async () => {
      await openTheViewer({ scans: SCANS });
      const before = viewerReads(await ipcCalls());

      const at = await pointAt(0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -240 }).perform();
      await browser.action("pointer").move({ x: at.x, y: at.y }).perform();
      await browser.$("button=Zoom in").click();
      await browser.$("button=Zoom out").click();
      await browser.$("button=Reset range").click();

      expect(viewerReads(await ipcCalls())).toBe(before);
    });
  });

  describe("a gesture that has not settled", () => {
    it("loses to a selection committed before its debounce fires", async () => {
      /*
       * PR #72 finding 8, on the rendered viewer. A wheel begins a transient
       * viewport; a selection arrives before the settle; the stale timer is then
       * allowed to fire. The settle addresses an epoch the selection dropped, so
       * it can commit nothing -- and the viewport is what the selection left.
       *
       * Both halves happen inside one `execute` so the whole race fits well
       * inside the 120ms debounce, which no pair of WebDriver commands would.
       * Nothing here cancels the timer: correctness may not rest on that.
       */
      await openTheViewer({ scans: SCANS });
      expect(await rangeCaption()).toContain("full range");
      const at = await pointAt(0.5);

      await browser.execute(
        (plot: string, x: number) => {
          document.querySelector(plot)?.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, deltaY: -240 }),
          );
          document
            .querySelector('div.spectrum-table-row[data-row-position="3"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        },
        PLOT,
        at.x,
      );

      await browser.waitUntil(async () => (await selectedRowPosition()) === 3, {
        timeout: 10_000,
        timeoutMsg: "the selection never took",
      });
      // Long enough for the settle to have fired several times over.
      await browser.pause(500);

      // The selection had nothing to reveal at full range, so the committed
      // viewport is still the whole run. Without the epoch check the stale
      // settle would have committed the wheel's zoom over it.
      expect(await rangeCaption()).toContain("full range");
      expect(await selectedRowPosition()).toBe(3);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("how long an observation is worth", () => {
    it("drops a hover the axis moved under, and takes a fresh one", async () => {
      // R0 finding 10, at the visible adapter. The key is sent to the focused
      // plot rather than pressed on a button, so the pointer never leaves and
      // the only thing that changed is the range.
      await openTheViewer({ scans: SCANS });
      const at = await pointAt(0.5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).perform();
      await browser.waitUntil(async () => (await readout()).startsWith("Hovering"), {
        timeout: 10_000,
      });

      await keyThePlot("+");

      await browser.waitUntil(async () => !(await readout()).startsWith("Hovering"), {
        timeout: 10_000,
        timeoutMsg: "the hover survived the axis moving under it",
      });
      expect(
        await browser.execute(() => document.querySelector("g.chromatogram-hover") !== null),
      ).toBe(false);

      // Invalidation is not a ban: the next pointer frame establishes a fresh
      // observation under the new range.
      const next = await pointAt(0.4);
      await browser.action("pointer").move({ x: next.x, y: next.y }).perform();
      await browser.waitUntil(async () => (await readout()).startsWith("Hovering"), {
        timeout: 10_000,
        timeoutMsg: "no fresh observation was established",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("keeps a hover a gesture resolved to the range already shown", async () => {
      // Not an enumeration of events: zooming out at full range clamps to what
      // is already drawn, nothing moves on screen, and the observation is still
      // accurate. The wheel is dispatched in place so the pointer does not move
      // and re-establish it for the wrong reason.
      await openTheViewer({ scans: SCANS });
      const at = await pointAt(0.5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).perform();
      await browser.waitUntil(async () => (await readout()).startsWith("Hovering"), {
        timeout: 10_000,
      });
      const reported = await readout();
      expect(await rangeCaption()).toContain("full range");

      await wheelInPlace(at.x, 240);

      await browser.pause(300);
      expect(await rangeCaption()).toContain("full range");
      expect(await readout()).toBe(reported);
    });
  });

  describe("the keyboard", () => {
    it("reaches the plot, shows it has focus, and moves the range", async () => {
      await openTheViewer({ scans: SCANS });

      await browser.execute((css: string) => {
        document.querySelector<SVGSVGElement>(css)?.focus();
      }, PLOT);
      expect(
        (await browser.execute(() => document.activeElement?.tagName ?? "")).toLowerCase(),
      ).toBe("svg");
      expect((await focusedTreatment()).visible).toBe(true);

      await keyThePlot("+");
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the keyboard did not zoom",
      });
      const zoomed = await rangeCaption();
      const span = await visibleSpan();

      await keyThePlot("ArrowRight");
      await browser.waitUntil(async () => (await rangeCaption()) !== zoomed, {
        timeout: 10_000,
        timeoutMsg: "the keyboard did not pan",
      });
      // Panned rather than resized: a different stretch of the run, the same
      // width of it.
      expect(Math.abs((await visibleSpan()) - span)).toBeLessThan(span * 0.02);

      await keyThePlot("Home");
      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the keyboard did not reset",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("moves table focus with the arrows without reading a spectrum", async () => {
      // Load-bearing. Selection-following-focus would launch one ProteoWizard
      // process per key press.
      await openTheViewer({ scans: SCANS });
      await browser.execute(() => {
        document
          .querySelector<HTMLElement>('div.spectrum-table-row[data-row-position="0"]')
          ?.focus();
      });

      await browser.keys(["ArrowDown", "ArrowDown"]);

      expect(
        (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum"),
      ).toEqual([]);
      expect(await selectedRowPosition()).toBeNull();

      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
        timeout: 10_000,
        timeoutMsg: "Enter did not commit the focused row",
      });
      expect(
        (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum"),
      ).toHaveLength(1);
    });

    it("steps scans with Previous and Next, keeping the keyboard on the button", async () => {
      await openTheViewer({ scans: SCANS });
      await browser.$('div.spectrum-table-row[data-row-position="1"]').click();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 1, { timeout: 10_000 });

      await browser.execute(() => {
        [...document.querySelectorAll("button")]
          .find((button) => (button.textContent ?? "").trim() === "Next scan")
          ?.focus();
      });
      await browser.keys(["Enter"]);

      await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
        timeout: 10_000,
        timeoutMsg: "Next scan did not move the selection",
      });
      // The button the user is operating keeps the keyboard, so pressing it
      // again works without hunting for focus.
      expect(await focusedName()).toBe("Next scan");

      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await selectedRowPosition()) === 3, {
        timeout: 10_000,
      });
    });
  });

  describe("reveal geometry, measured", () => {
    /*
     * Two different scrolls are easy to confuse, and confusing them once
     * already produced a wrong fix in this milestone.
     *
     * WebDriver's own `scrollIntoView` -- which it performs implicitly before
     * clicking an element it considers out of view -- places the element at the
     * container's top edge, which in this table is *underneath* the sticky
     * header. A click intercepted by the column header after such a scroll says
     * nothing about the application's reveal.
     *
     * MSCanvas's reveal is a different calculation. The header is
     * `position: sticky`, so it stays in normal flow and the row canvas begins
     * after it; a row at canvas offset `rowTop` renders at
     * `headerHeight + rowTop - scrollTop`, and is clear of the header exactly
     * when `rowTop >= scrollTop`.
     *
     * So these cases scroll the container directly and then let the application
     * reveal, and they assert against measured rectangles rather than against
     * scrollTop arithmetic.
     */
    async function tableGeometry(): Promise<{
      readonly headerBottom: number;
      readonly viewportBottom: number;
      readonly scrollTop: number;
      readonly selectedTop: number;
      readonly selectedPosition: number | null;
    }> {
      return browser.execute(() => {
        const viewport = document.querySelector(".spectrum-table-viewport");
        const header = document.querySelector(".spectrum-table-head");
        const selected = document.querySelector('div.spectrum-table-row[aria-selected="true"]');
        const position = selected?.getAttribute("data-row-position");
        return {
          headerBottom: header?.getBoundingClientRect().bottom ?? 0,
          viewportBottom: viewport?.getBoundingClientRect().bottom ?? 0,
          scrollTop: viewport?.scrollTop ?? 0,
          selectedTop: selected?.getBoundingClientRect().top ?? 0,
          selectedPosition: position === undefined || position === null ? null : Number(position),
        };
      });
    }

    /** Scrolls the table itself, the way a user's wheel would. */
    async function scrollTableTo(scrollTop: number): Promise<void> {
      await browser.execute((top: number) => {
        const viewport = document.querySelector(".spectrum-table-viewport");
        if (viewport !== null) {
          viewport.scrollTop = top;
          viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
      }, scrollTop);
    }

    it("puts a revealed row exactly at the sticky header's bottom edge", async () => {
      // Discriminating, and measured rather than computed. Scrolled well past
      // it, revealing row 4 must place its top on the header's bottom edge.
      // Subtracting the header a second time would leave the row one row-height
      // lower, which is what the equality below would catch.
      await openTheViewer({ scans: SCANS });
      await scrollTableTo(1_000);

      const at = await pointAtRetentionTime(4 * RT_STEP);
      await clickThePlotAt(at.x, at.y);
      await browser.waitUntil(async () => (await selectedRowPosition()) === 4, {
        timeout: 10_000,
        timeoutMsg: "the click never selected scan 4",
      });

      const geometry = await tableGeometry();
      expect(geometry.selectedTop).toBeCloseTo(geometry.headerBottom, 0);
      expect(geometry.selectedTop).toBeLessThan(geometry.viewportBottom);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("does not move a row that already begins immediately below the header", async () => {
      // The case the wrong geometry got wrong: a row exactly at the header's
      // bottom edge is fully visible, and revealing it must be a no-op.
      await openTheViewer({ scans: SCANS });
      await browser.$('div.spectrum-table-row[data-row-position="2"]').click();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
        timeout: 10_000,
      });

      // Row 2 sits at canvas offset 60; a scroll of exactly 60 puts it against
      // the header.
      await scrollTableTo(60);
      const before = await tableGeometry();
      expect(before.selectedTop).toBeCloseTo(before.headerBottom, 0);

      // Commit it again from the plot -- a new commit, and one the reveal acts
      // on.
      const at = await pointAtRetentionTime(2 * RT_STEP);
      await clickThePlotAt(at.x, at.y);
      await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
        timeout: 10_000,
      });

      const after = await tableGeometry();
      expect(after.scrollTop).toBe(before.scrollTop);
      expect(after.selectedTop).toBeCloseTo(after.headerBottom, 0);
    });

    it("brings a row the user scrolled away back when the same scan is committed again", async () => {
      await openTheViewer({ scans: SCANS });
      const at = await pointAtRetentionTime(40 * RT_STEP);
      await clickThePlotAt(at.x, at.y);
      await browser.waitUntil(async () => (await selectedRowPosition()) === 40, {
        timeout: 10_000,
      });
      const revealed = (await tableGeometry()).scrollTop;
      expect(revealed).toBeGreaterThan(0);

      await scrollTableTo(0);
      await clickThePlotAt(at.x, at.y);

      await browser.waitUntil(async () => (await tableGeometry()).scrollTop === revealed, {
        timeout: 10_000,
        timeoutMsg: "the repeated commit did not reveal the row again",
      });
      // Two commits, two reads: a commit that a linked view acts on is still
      // one selection and one process.
      expect(
        (await ipcCalls())
          .filter((call) => call.command === "load_selected_spectrum")
          .map((call) => call.args["index"]),
      ).toEqual([40, 40]);
    });
  });

  describe("linked selection", () => {
    it("keeps the table, the plot and the spectrum on one scan in both directions", async () => {
      await openTheViewer({ scans: SCANS });

      // From the plot.
      const at = await pointAtRetentionTime(80 * RT_STEP);
      await clickThePlotAt(at.x, at.y);
      await browser.waitUntil(async () => (await selectedRowPosition()) === 80, {
        timeout: 10_000,
      });
      await leaveThePlot();
      await browser.waitUntil(async () => (await readout()).includes("Selected index 80,"), {
        timeout: 10_000,
        timeoutMsg: "the plot never reported the selected scan",
      });
      await browser.$("//h2[normalize-space()='Selected spectrum']").waitForDisplayed();

      // From the table, to a different row. The reveal above scrolled the table
      // to the selected row, so the first row is above the fold; scrolled back,
      // as a user would, before it is clicked.
      await browser.execute(() => {
        const viewport = document.querySelector(".spectrum-table-viewport");
        if (viewport !== null) {
          viewport.scrollTop = 0;
          viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
      });
      await browser.$('div.spectrum-table-row[data-row-position="0"]').click();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 0, {
        timeout: 10_000,
        timeoutMsg: "the table selection did not take",
      });
      await browser.waitUntil(async () => (await readout()).includes("Selected index 0,"), {
        timeout: 10_000,
        timeoutMsg: "the chromatogram marker did not follow the table",
      });

      const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
      expect(reads.map((call) => call.args["index"])).toEqual([80, 0]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("reveals a marker panned out of view without giving up the span", async () => {
      await openTheViewer({ scans: SCANS });
      await browser.$('div.spectrum-table-row[data-row-position="0"]').click();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 0, {
        timeout: 10_000,
      });

      // Zoom in, then pan away from the marker.
      await browser.$("button=Zoom in").click();
      await browser.$("button=Zoom in").click();
      await browser.waitUntil(async () => (await visibleDomain()).low > 0, {
        timeout: 10_000,
        timeoutMsg: "the viewport never left the start of the run",
      });
      const span = await visibleSpan();
      const before = await visibleDomain();

      // Commit the same scan again from the table.
      await browser.$('div.spectrum-table-row[data-row-position="0"]').click();

      await browser.waitUntil(async () => (await visibleDomain()).low < before.low, {
        timeout: 10_000,
        timeoutMsg: "the reveal never brought the marker back",
      });
      // Moved the least it could, and kept the width the user chose rather than
      // resetting the zoom. Compared at the caption's own four-decimal
      // resolution.
      expect(Math.abs((await visibleSpan()) - span)).toBeLessThan(0.001);
      expect(await rangeCaption()).not.toContain("full range");
    });

    it("leaves the loaded viewer alone when a vendor row takes focus", async () => {
      // The established rule: a focused workspace row is not the loaded
      // preview's authority.
      await openTheViewer({ scans: SCANS });
      await browser.$('div.spectrum-table-row[data-row-position="1"]').click();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 1, { timeout: 10_000 });
      await browser.$("button=Zoom in").click();
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
      });
      const range = await rangeCaption();
      const marker = await readout();
      const before = viewerReads(await ipcCalls());

      await browser.$(`li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`).click();

      expect(await browser.$(PLOT).isDisplayed()).toBe(true);
      expect(await rangeCaption()).toBe(range);
      expect(await readout()).toBe(marker);
      expect(await selectedRowPosition()).toBe(1);
      // Focusing a row is a real workspace action with its own command. What
      // must not happen is the viewer being re-read: the chromatogram's source,
      // its range and its selected scan all belong to the preview that is
      // loaded, not to the row that has focus.
      expect(viewerReads(await ipcCalls())).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("the viewport control group, rendered", () => {
    /*
     * A button that is enabled is a claim, and only a browser can say whether
     * pressing it did anything. The rule under all of it is one sentence: a
     * visible viewport action is available exactly when applying it would change
     * the range on screen.
     */
    const CONTROLS = ["Zoom in", "Zoom out", "Reset range"] as const;

    async function controlStates(): Promise<Record<string, boolean>> {
      return browser.execute((labels: readonly string[]) => {
        const buttons = [...document.querySelectorAll("button")];
        const state: Record<string, boolean> = {};
        for (const label of labels) {
          const found = buttons.find(
            (button) => (button.textContent ?? "").trim() === label,
          );
          state[label] = found !== undefined && !found.disabled;
        }
        return state;
      }, CONTROLS) as Promise<Record<string, boolean>>;
    }

    it("offers only the action that can do anything when the whole run is shown", async () => {
      // The state the viewer opens in.
      await openTheViewer({ scans: SCANS });

      expect(await rangeCaption()).toContain("full range");
      expect(await controlStates()).toEqual({
        "Zoom in": true,
        "Zoom out": false,
        "Reset range": false,
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers the other two as soon as there is something to go back to", async () => {
      await openTheViewer({ scans: SCANS });
      const full = await visibleSpan();

      await browser.$("button=Zoom in").click();

      await browser.waitUntil(async () => (await visibleSpan()) < full, {
        timeout: 10_000,
        timeoutMsg: "Zoom in did not narrow the range",
      });
      expect(await rangeCaption()).not.toContain("full range");
      expect(await controlStates()).toEqual({
        "Zoom in": true,
        "Zoom out": true,
        "Reset range": true,
      });
    });

    it("stops offering to zoom in at the narrowest viewport the run allows", async () => {
      // Driven there by pressing the button, not by naming a range.
      await openTheViewer({ scans: SCANS });
      for (let step = 0; step < 60; step += 1) {
        if (!(await controlStates())["Zoom in"]) {
          break;
        }
        await browser.$("button=Zoom in").click();
      }

      const states = await controlStates();
      expect(states["Zoom in"]).toBe(false);
      // And the way back out is still open.
      expect(states["Zoom out"]).toBe(true);
      expect(states["Reset range"]).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers nothing for a run whose one scan has no width to zoom", async () => {
      await openTheViewer({ scans: 1 });

      // The measurement is on screen. There is nothing to zoom, which is not
      // the same as nothing to see.
      expect(
        await browser.execute(
          () => document.querySelectorAll("circle.chromatogram-point").length,
        ),
      ).toBe(1);
      expect(await controlStates()).toEqual({
        "Zoom in": false,
        "Zoom out": false,
        "Reset range": false,
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("makes every control it offers change the range it reports", async () => {
      // The user-facing property, over the whole group and in three states.
      await openTheViewer({ scans: SCANS });

      const reachStates: (() => Promise<void>)[] = [
        async () => {
          // The opening state, unchanged.
        },
        async () => {
          await browser.$("button=Zoom in").click();
        },
        async () => {
          for (let step = 0; step < 60; step += 1) {
            if (!(await controlStates())["Zoom in"]) {
              break;
            }
            await browser.$("button=Zoom in").click();
          }
        },
      ];

      for (const reach of reachStates) {
        await reach();
        for (const label of CONTROLS) {
          if (!(await controlStates())[label]) {
            continue;
          }
          const before = await rangeCaption();
          await browser.$(`button=${label}`).click();
          await browser.waitUntil(async () => (await rangeCaption()) !== before, {
            timeout: 10_000,
            timeoutMsg: `${label} was offered and changed nothing`,
          });
        }
      }
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("who owns a wheel, rendered", () => {
    /*
     * Cancelling a wheel event is a claim on it, and the viewer column scrolls.
     * A wheel MSCanvas cancels and then does not use is a wheel that neither
     * zoomed nor scrolled, which is the defect this closes.
     *
     * What a browser can settle that a jsdom cannot: that the column really does
     * have somewhere to scroll to at a window people use, and that the listener
     * shipped in the built bundle -- registered non-passive, on the real element,
     * with the real box under a real pointer position -- reaches the same verdict
     * the contract does.
     *
     * What it cannot settle, stated plainly rather than glossed: a WebDriver
     * `dispatchEvent` is not a user gesture, and this engine performs no native
     * scrolling for one however the listener answers. So `defaultPrevented` is
     * the evidence here, and nothing below claims a synthetic wheel scrolled
     * anything. Whether an uncancelled wheel then scrolls the column is the
     * browser's own contract, and the measured overflow is what makes that
     * contract have something to act on.
     */

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

    const IN = -240;
    const OUT = 240;

    it("has a column with somewhere to scroll to at 1366x768", async () => {
      // The reason the claim matters. On the laptop window this product is
      // measured against, the three panels do not all fit, and the wheel is how
      // a reader reaches the ones below.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });

      const stack = await stackOverflow();
      expect(stack.overflowY).toBe("auto");
      expect(stack.clientHeight).toBeGreaterThan(0);
      expect(stack.scrollHeight).toBeGreaterThan(stack.clientHeight);
    });

    it("does not claim a wheel that cannot widen the run, and moves nothing", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const before = await rangeCaption();
      expect(before).toContain("full range");

      expect(await wheelClaim(at.x, OUT)).toBe(false);

      expect(await rangeCaption()).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("claims a wheel that narrows it, and moves the range with it", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const full = await visibleSpan();

      expect(await wheelClaim(at.x, IN)).toBe(true);

      await browser.waitUntil(async () => (await visibleSpan()) < full, {
        timeout: 10_000,
        timeoutMsg: "a claimed wheel changed nothing",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("stops claiming inward wheels at the narrowest viewport the run allows", async () => {
      // Driven there by turning the wheel, not by naming a range.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      let claimed = 0;
      for (let notch = 0; notch < 120; notch += 1) {
        if (!(await wheelClaim(at.x, IN))) {
          break;
        }
        claimed += 1;
      }
      expect(claimed).toBeGreaterThan(0);

      expect(await wheelClaim(at.x, IN)).toBe(false);
      // And the way back out is still the viewer's.
      expect(await wheelClaim(at.x, OUT)).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("claims neither direction for a run whose one scan has no width to zoom", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: 1 });
      const at = await pointAt(0.5);

      expect(await wheelClaim(at.x, IN)).toBe(false);
      expect(await wheelClaim(at.x, OUT)).toBe(false);

      // And the measurement is still drawn. Nothing to zoom is not nothing to
      // see, and releasing the wheel did not cost the glyph.
      expect(
        await browser.execute(
          () => document.querySelectorAll("circle.chromatogram-point").length,
        ),
      ).toBe(1);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("input the host owns, rendered", () => {
    /*
     * Whose input an event is, asked of the shipped bundle.
     *
     * The suite above asks whether an input is *productive*. This asks the
     * question before it, and the answer changed: WebView2 enables its zoom
     * controls by default and drives them with Ctrl+wheel, Ctrl+Plus and
     * Ctrl+Minus, and this application disables neither, so those inputs are the
     * window's rather than a plot's. ADR 0033's reasoning about hardware still
     * stands -- nothing here decides what device sent anything.
     *
     * The same limitation as the block above applies and is worth restating,
     * because it is easy to overclaim here: a WebDriver `dispatchEvent` is not a
     * user gesture, and this engine performs no native zoom for one however the
     * listener answers. So what these cases prove is that **MSCanvas does not
     * claim the event**, which is what leaves the host's documented accelerator
     * path available. None of them claims that a browser zoomed.
     */

    const IN = -240;
    const OUT = 240;

    /** Every key this plot maps, including the duplicate spellings. */
    const VIEWPORT_KEYS = ["+", "=", "-", "_", "ArrowLeft", "ArrowRight", "Home", "0"];

    it("releases a ctrl wheel and claims the identical wheel without it", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const before = await rangeCaption();
      expect(before).toContain("full range");

      expect(await modifiedWheelClaim(at.x, IN, { ctrlKey: true })).toBe(false);
      expect(await rangeCaption()).toBe(before);

      // The same delta, the same plot, the same anchor. Only the owner differs.
      expect(await modifiedWheelClaim(at.x, IN)).toBe(true);
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "an unmodified wheel changed nothing",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("releases a ctrl wheel from a subrange, where both directions are productive", async () => {
      // At full range an outward wheel is released for an unrelated reason.
      // From a subrange both directions move the axis, so a release here can
      // only be about the modifier.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      await keyThePlot("+");
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the run did not zoom",
      });
      const at = await pointAt(0.5);
      const subrange = await rangeCaption();

      for (const deltaY of [IN, OUT]) {
        expect(await modifiedWheelClaim(at.x, deltaY, { ctrlKey: true })).toBe(false);
      }

      expect(await rangeCaption()).toBe(subrange);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("releases every viewport key under ctrl, meta and alt", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      // From a subrange, so every one of these keys would otherwise be
      // productive and no release can be a boundary in disguise.
      await keyThePlot("+");
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the run did not zoom",
      });
      const subrange = await rangeCaption();

      for (const key of VIEWPORT_KEYS) {
        for (const held of ["ctrlKey", "metaKey", "altKey"] as const) {
          // The key and the modifier travel into the assertion so a failure
          // names which of the twenty-four combinations was claimed.
          expect({ key, held, claimed: await keyClaim(key, { [held]: true }) }).toEqual({
            key,
            held,
            claimed: false,
          });
        }
      }

      expect(await rangeCaption()).toBe(subrange);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("still claims a shift-produced plus", async () => {
      // On common layouts `+` is Shift+`=`, so this is how the ordinary shortcut
      // arrives. Rejecting Shift would take the zoom away and protect nothing.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      expect(await rangeCaption()).toContain("full range");

      expect(await keyClaim("+", { shiftKey: true })).toBe(true);

      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "a shift-produced plus did not zoom",
      });
      // And the same key with ctrl held is the host's again.
      const zoomed = await rangeCaption();
      expect(await keyClaim("+", { ctrlKey: true, shiftKey: true })).toBe(false);
      expect(await rangeCaption()).toBe(zoomed);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("how far a wheel zooms, rendered", () => {
    /*
     * The magnitude half of the wheel, in a real browser.
     *
     * What only this layer can settle is that the two numbers a `WheelEvent`
     * carries survive the trip through the shipped bundle's own listener. The
     * arithmetic is pinned beside the planner; here the question is whether the
     * production adapter reads `deltaY` and `deltaMode` at all, or reduces them
     * to a direction on the way in as it used to.
     *
     * Resolution note: the caption prints four decimals, so what these cases
     * compare is the range a reader can actually see. The exact numeric identity
     * of two chunkings is a unit-level claim and is made there.
     *
     * These are INPUT SHAPES, not hardware. A synthetic event is not a user
     * gesture and this suite has no touchpad in it; nothing below claims parity
     * between physical devices.
     */
    const LINE_MODE = 1;

    it("makes a small delta a small zoom and a large one a large zoom", async () => {
      // The defect, from outside: under the old rule these were one request.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const full = await visibleSpan();

      expect(await wheelClaim(at.x, -1)).toBe(true);
      const gentle = await visibleSpan();

      await browser.$("button=Reset range").click();
      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "Reset range did not return the whole run",
      });

      expect(await wheelClaim(at.x, -100)).toBe(true);
      const firm = await visibleSpan();

      expect(gentle).toBeLessThan(full);
      expect(firm).toBeLessThan(gentle);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("lands in the same place whether one gesture arrives as one event or a hundred", async () => {
      // Same pointer position, same total travel, two packetings of it.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);

      expect(await wheelClaim(at.x, -100)).toBe(true);
      const once = await visibleDomain();

      await browser.$("button=Reset range").click();
      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "Reset range did not return the whole run",
      });

      expect(await wheelStream(at.x, -1, 100)).toBe(100);
      const many = await visibleDomain();

      // Within what the caption can distinguish, which is a tenth of a
      // thousandth of a minute-or-second of retention time.
      expect(Math.abs(many.low - once.low)).toBeLessThan(2e-4);
      expect(Math.abs(many.high - once.high)).toBeLessThan(2e-4);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("does not slam a touchpad-shaped stream into the narrowest viewport", async () => {
      /*
       * Eighty small events. Under the old fixed-per-event rule that compounded
       * as 0.85^80 and reached the narrowest viewport the run allows; their
       * normalized total is now -0.16 of a page.
       */
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const full = await visibleSpan();

      expect(await wheelStream(at.x, -1, 80)).toBe(80);

      const after = await visibleSpan();
      expect(after / full).toBeCloseTo(2 ** -0.16, 3);
      expect(after).toBeGreaterThan(full * 0.5);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("reads a line-mode event as the pixels this product says it is worth", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);

      expect(await wheelClaim(at.x, -1, LINE_MODE)).toBe(true);
      const fromLines = await visibleDomain();

      await browser.$("button=Reset range").click();
      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "Reset range did not return the whole run",
      });

      expect(await wheelClaim(at.x, -25)).toBe(true);
      const fromPixels = await visibleDomain();

      expect(fromLines).toEqual(fromPixels);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("leaves a unit it cannot read to the browser", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const before = await rangeCaption();

      expect(await wheelClaim(at.x, -100, 3)).toBe(false);

      expect(await rangeCaption()).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("refuses an outward delta of any size at full range", async () => {
      // Magnitude decides how much is asked for. It never decides whether the
      // viewer owns the event.
      await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
      const at = await pointAt(0.5);
      const before = await rangeCaption();

      for (const deltaY of [1, 100, 240, 4_000]) {
        expect(await wheelClaim(at.x, deltaY)).toBe(false);
      }

      expect(await rangeCaption()).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("claims neither magnitude for a run whose one scan has no width to zoom", async () => {
      await openTheViewer({ width: 1_366, height: 768, scans: 1 });
      const at = await pointAt(0.5);

      for (const deltaY of [-1, -100, -4_000, 1, 100, 4_000]) {
        expect(await wheelClaim(at.x, deltaY)).toBe(false);
      }

      // And the measurement is still drawn.
      expect(
        await browser.execute(
          () => document.querySelectorAll("circle.chromatogram-point").length,
        ),
      ).toBe(1);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("a run of a single scan", () => {
    /*
     * A complete acquisition of exactly one spectrum. `clipTrace` answers with
     * one real source vertex, and a path whose only command is a moveto strokes
     * nothing -- so the panel drew a labelled axis over an empty plot for a run
     * that had a measurement. Only a browser can say whether the repair put
     * anything on screen, because "visible" is a paint question.
     */
    async function markBox(selector: string): Promise<Box | null> {
      return browser.execute((css: string) => {
        const node = document.querySelector(css);
        if (node === null) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }, selector) as Promise<Box | null>;
    }

    /** The plot's drawing area in page pixels, from its own viewBox padding. */
    async function drawingArea(): Promise<Box> {
      const box = await plotBox();
      const left = box.left + (64 / 1_000) * box.width;
      const top = box.top + (12 / 210) * box.height;
      return {
        left,
        top,
        width: ((1_000 - 64 - 12) / 1_000) * box.width,
        height: ((180 - 12) / 210) * box.height,
      };
    }

    function overlaps(one: Box, other: Box): boolean {
      return (
        one.left < other.left + other.width &&
        one.left + one.width > other.left &&
        one.top < other.top + other.height &&
        one.top + one.height > other.top
      );
    }

    it("puts a visible mark on screen for the one scan it has", async () => {
      await openTheViewer({ scans: 1 });

      // Nothing is selected, and nothing needs to be: the trace has to
      // represent its own measurement.
      expect(await selectedRowPosition()).toBeNull();
      expect(
        await browser.execute(() => document.querySelector("g.chromatogram-selected") !== null),
      ).toBe(false);

      const marks = await browser.execute(() =>
        [...document.querySelectorAll("circle.chromatogram-point")].map(
          (node) => node.getAttribute("class") ?? "",
        ),
      );
      expect(marks).toHaveLength(1);
      expect(marks[0]).toContain("chromatogram-point-tic");

      const mark = await markBox("circle.chromatogram-point");
      expect(mark).not.toBeNull();
      // Paint geometry rather than a point with no size.
      expect(mark?.width ?? 0).toBeGreaterThan(0);
      expect(mark?.height ?? 0).toBeGreaterThan(0);
      // And it is inside the plot rather than somewhere off it.
      expect(overlaps(mark as Box, await drawingArea())).toBe(true);

      // The axis and the caption are unchanged by any of it.
      const values = await browser.execute(() =>
        [...document.querySelectorAll("text.chromatogram-value-label")].map(
          (node) => node.textContent ?? "",
        ),
      );
      expect(values[0]).toBe("5000");
      expect(values[1]).toBe("0");
      const caption = await browser.$(AXIS_CAPTION).getText();
      expect(caption).toContain("Per-scan values from the loaded spectrum table");
      expect(caption).toContain("Retention time — unit not reported");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("marks each series, told apart by more than colour", async () => {
      await openTheViewer({ scans: 1 });
      await browser.$("//span[normalize-space()='BPC']/preceding-sibling::input").click();

      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelectorAll("circle.chromatogram-point").length,
          )) === 2,
        { timeout: 10_000, timeoutMsg: "the second series never drew a mark" },
      );

      const painted = await browser.execute(() =>
        [...document.querySelectorAll("circle.chromatogram-point")].map((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            radius: node.getAttribute("r") ?? "",
            fill: style.fill,
            stroke: style.stroke,
            width: rect.width,
            height: rect.height,
          };
        }),
      );

      expect(painted).toHaveLength(2);
      for (const mark of painted) {
        expect(mark.width).toBeGreaterThan(0);
        expect(mark.height).toBeGreaterThan(0);
      }
      // Two non-colour distinctions: one is filled and the other is an open
      // ring, and they are different sizes. Colour differs too, and is not what
      // this rests on.
      expect(painted[0]?.radius).not.toBe(painted[1]?.radius);
      expect(painted[0]?.fill).not.toBe("none");
      expect(painted[1]?.fill).toBe("none");

      // Switching the first off leaves the second, still visible.
      await browser.$("//span[normalize-space()='TIC']/preceding-sibling::input").click();
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelectorAll("circle.chromatogram-point").length,
          )) === 1,
        { timeout: 10_000, timeoutMsg: "the first series never went away" },
      );
      const remaining = await markBox("circle.chromatogram-point");
      expect(remaining?.width ?? 0).toBeGreaterThan(0);
      expect(remaining?.height ?? 0).toBeGreaterThan(0);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("goes back to a line as soon as there is one to draw", async () => {
      // The mark is for the case that has no line, and for nothing else.
      await openTheViewer({ scans: SCANS });

      expect(
        await browser.execute(
          () => document.querySelectorAll("circle.chromatogram-point").length,
        ),
      ).toBe(0);
      expect((await plotNodeCounts()).paths).toBe(1);
    });
  });

  describe("when the preview has no chromatogram", () => {
    it("says why, and leaves the scan table usable", async () => {
      await browser.setWindowSize(1_366, 768);
      await installIpcBoundary(ipcTable());
      await browser.url("/");
      const row = `li.dataset-row[data-handle="${MZML_ROW.handle}"]`;
      await browser.$(row).waitForDisplayed();
      await browser.execute((tableKey: string) => {
        const answers = (window as unknown as Record<string, Record<string, unknown>>)[tableKey];
        const preview = answers["open_mzml_preview"] as {
          spectrumTable: { rows: unknown[]; totalRowCount: number; truncated: boolean };
        };
        preview.spectrumTable = {
          ...preview.spectrumTable,
          totalRowCount: preview.spectrumTable.rows.length * 10,
          truncated: true,
        };
      }, "__mscanvasIpcTable__");
      await browser.$(row).doubleClick();
      await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed();

      expect(await browser.$(PLOT).isExisting()).toBe(false);
      expect(await browser.$(CHROMATOGRAM).getText()).toContain(
        "TIC and BPC are unavailable for this preview.",
      );
      expect(await browser.$(CHROMATOGRAM).getText()).toContain("did not load the complete");

      // The table still works, and says outright that its last row is not the
      // end of the run.
      expect(await browser.$(TABLE).getText()).toContain("which is not the end of the run");
      // Dispatched rather than driven. WebDriver scrolls an element it thinks
      // is out of view to the container's *top edge* before clicking it, which
      // in this table is underneath the sticky header -- so the click is
      // intercepted by the column header and the failure says nothing about the
      // application. That is the driver's geometry, and the reveal cases above
      // are where this table's own is measured.
      await browser.execute(() => {
        document
          .querySelector('div.spectrum-table-row[data-row-position="1"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await browser.waitUntil(async () => (await selectedRowPosition()) === 1, {
        timeout: 10_000,
        timeoutMsg: "a truncated preview's table could not select a row",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("the console", () => {
    it("stays clean through a whole session of viewer interaction", async () => {
      await openTheViewer({ scans: SCANS });
      const at = await pointAt(0.5);

      await browser.action("pointer").move({ x: at.x, y: at.y }).perform();
      await clickThePlotAt(at.x, at.y);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -240 }).perform();
      await browser
        .action("pointer")
        .move({ x: at.x, y: at.y })
        .down()
        .move({ x: at.x - 80, y: at.y, duration: 40 })
        .up()
        .perform();
      await keyThePlot("+");
      await keyThePlot("ArrowLeft");
      await keyThePlot("Home");
      await browser.$("button=Next scan").click();
      await browser.$("button=Previous scan").click();
      await leaveThePlot();

      expect(await unexpectedConsole()).toEqual([]);
    });
  });
});
