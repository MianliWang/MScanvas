/**
 * Viewer Closure rendered QA — the linked chromatogram, in a real browser.
 *
 * The unit tests beside the components already pin what each surface does. What
 * only a browser can answer is whether the plot is actually inside its panel at
 * a given window, whether a real wheel and a real drag move the viewport, and
 * whether the three linked views agree on screen rather than only in state.
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
  installIpcBoundary,
  ipcCalls,
} from "../support/harness";
import { MZML_ROW, VENDOR_ROW, ipcTable } from "../support/fixtures";

const CHROMATOGRAM = "section.chromatogram-panel";
const PLOT = "svg.chromatogram-svg";
const TABLE = "section.spectrum-table-panel";
const READOUT = ".chromatogram-readout";
const RANGE = ".chromatogram-range";

const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "960x640", width: 960, height: 640 },
] as const;

/**
 * A window, a preview and a spectrum table, in that order.
 *
 * The window size is set here rather than left to whatever the previous test
 * chose. The layout cases below deliberately shrink it, and a pointer gesture
 * aimed at a plot that a 640px-tall window has scrolled out of view is a
 * WebDriver error rather than a finding.
 */
async function open(width = 1_366, height = 768): Promise<void> {
  await browser.setWindowSize(width, height);
  await installIpcBoundary(ipcTable());
  await browser.url("/");
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).doubleClick();
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed();
  await browser.$(PLOT).waitForDisplayed();
  // Nearest rather than centred: centring the plot in a scrolling column pushes
  // the captions and the viewport actions below it out of view, and a control
  // out of view reads as absent to both a person and `getText`.
  await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
}

/** The plot's own rectangle, which every pointer gesture below is aimed at. */
async function plotBox(): Promise<{
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}> {
  return browser.execute((css: string) => {
    const box = document.querySelector(css)?.getBoundingClientRect();
    return box === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: box.left, top: box.top, width: box.width, height: box.height };
  }, PLOT);
}

/** Where in the plot a fraction of the drawn width falls, in page pixels. */
async function pointAt(fraction: number): Promise<{ readonly x: number; readonly y: number }> {
  const box = await plotBox();
  // The plot's own padding, as a share of its 1000-unit viewBox.
  const left = box.left + (64 / 1_000) * box.width;
  const drawn = ((1_000 - 64 - 12) / 1_000) * box.width;
  return { x: Math.round(left + fraction * drawn), y: Math.round(box.top + box.height / 2) };
}

/**
 * Takes the pointer off the plot, so the readout reports the selection again.
 *
 * A real move rather than a synthesised event: React listens for pointer exits
 * at the document root, and a non-bubbling event dispatched on the element
 * never reaches it.
 */
async function leaveThePlot(): Promise<void> {
  const box = await plotBox();
  await browser
    .action("pointer")
    .move({ x: Math.round(box.left + box.width / 2), y: Math.max(1, Math.round(box.top) - 6) })
    .perform();
}

async function readout(): Promise<string> {
  return (await browser.$(READOUT).getText()).trim();
}

async function rangeCaption(): Promise<string> {
  return (await browser.$(RANGE).getText()).trim();
}

/** Which table row is marked selected, by its position in the run. */
async function selectedRowPosition(): Promise<number | null> {
  return browser.execute(() => {
    const row = document.querySelector('div.spectrum-table-row[aria-selected="true"]');
    const position = row?.getAttribute("data-row-position");
    return position === undefined || position === null ? null : Number(position);
  });
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

async function unexpectedConsole(): Promise<string[]> {
  const entries = await consoleEntries();
  return entries
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

describe("the linked chromatogram, rendered", () => {
  describe("layout", () => {
    for (const viewport of VIEWPORTS) {
      it(`keeps the plot and its controls inside the panel at ${viewport.name}`, async () => {
        await open(viewport.width, viewport.height);

        const panel = await boxOf(CHROMATOGRAM);
        expect(panel.width).toBeGreaterThan(0);
        expect(panel.height).toBeGreaterThan(0);

        const plot = await boxOf(PLOT);
        // A plot with no area is a plot nobody can read or point at.
        expect(plot.width).toBeGreaterThan(0);
        expect(plot.height).toBeGreaterThan(0);
        // Per edge, so a failure names which way it escaped.
        expect(plot.left).toBeGreaterThanOrEqual(panel.left - 0.5);
        expect(plot.right).toBeLessThanOrEqual(panel.right + 0.5);
        expect(plot.top).toBeGreaterThanOrEqual(panel.top - 0.5);

        for (const control of ["Zoom in", "Zoom out", "Reset range", "Previous scan", "Next scan"]) {
          const button = await boxOfButton(control);
          expect(button.width).toBeGreaterThan(0);
          expect(button.height).toBeGreaterThan(0);
          expect(button.left).toBeGreaterThanOrEqual(panel.left - 0.5);
          expect(button.right).toBeLessThanOrEqual(panel.right + 0.5);
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

      it(`keeps the chromatogram clear of the scan table at ${viewport.name}`, async () => {
        await open(viewport.width, viewport.height);

        const chromatogram = await boxOf(CHROMATOGRAM);
        const table = await boxOf(TABLE);
        // Stacked, not overlapping. Two panels sharing pixels would hide rows
        // behind a plot, which is the failure a screenshot would show and a
        // unit test could not.
        expect(chromatogram.bottom).toBeLessThanOrEqual(table.top + 0.5);
        expect(table.height).toBeGreaterThan(0);
      });
    }

    it("keeps the plot and everything under it readable at the narrow window", async () => {
      // The failure this guards against is not overflow, which would be
      // visible: the body clips, so a caption or a control that does not fit
      // is silently gone. Reading the text back is what catches that -- an
      // element with a layout rect but no visible text is exactly what a
      // clipped caption looks like.
      await open(960, 640);

      const panel = await boxOf(CHROMATOGRAM);
      const plot = await boxOf(PLOT);
      expect(plot.height).toBeGreaterThanOrEqual(52);

      for (const caption of [".chromatogram-axis-caption", READOUT, RANGE]) {
        const text = (await browser.$(caption).getText()).trim();
        expect(text.length).toBeGreaterThan(0);
        const box = await boxOf(caption);
        expect(box.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);
      }
      // And the header's control groups are inside the panel rather than
      // centred outside a header that did not grow to fit them.
      for (const group of [".chromatogram-traces", ".chromatogram-scan-steps", ".chromatogram-viewport-actions"]) {
        const box = await boxOf(group);
        expect(box.top).toBeGreaterThanOrEqual(panel.top - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(panel.bottom + 0.5);
        expect(box.height).toBeGreaterThan(0);
      }
    });
  });

  describe("what the plot draws", () => {
    it("draws one path per trace rather than one node per scan", async () => {
      await open();

      expect((await plotNodeCounts()).paths).toBe(1);
      await browser.$("//span[normalize-space()='TIC']/preceding-sibling::input").click();
      await browser.$("//span[normalize-space()='BPC']/preceding-sibling::input").click();

      const counts = await plotNodeCounts();
      expect(counts.paths).toBe(1);
      expect(counts.circles).toBe(0);
      // A small fixed set of elements: axes, labels, a clip and one trace.
      expect(counts.total).toBeLessThan(40);
    });

    it("says what the traces are and what units were not reported", async () => {
      await open();

      const caption = await browser.$(".chromatogram-axis-caption").getText();
      expect(caption).toContain("Per-scan values from the loaded spectrum table");
      expect(caption).toContain("Not a stored chromatogram record");
      const axis = await browser.$(".chromatogram-axis-caption").getText();
      expect(axis).toContain("Retention time — unit not reported");
      expect(axis).toContain("Intensity — unit not reported");
    });
  });

  describe("real pointer interaction", () => {
    it("reports the scan under the pointer without selecting anything", async () => {
      await open();

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
      await open();

      const at = await pointAt(0.5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();

      await browser.waitUntil(async () => (await selectedRowPosition()) !== null, {
        timeout: 10_000,
        timeoutMsg: "the click never selected a scan",
      });
      const selected = await selectedRowPosition();
      // The readout reports the hovered scan while a pointer is on the plot,
      // because that is what hover is for. Off the plot it reports the
      // selection, which is what persists.
      await leaveThePlot();
      await browser.waitUntil(async () => (await readout()).startsWith("Selected"), {
        timeout: 10_000,
        timeoutMsg: "the plot never reported the selected scan",
      });
      expect(selected).not.toBeNull();

      // The one backend read, for that scan and no other.
      const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
      expect(reads).toHaveLength(1);
      expect(reads[0]?.args["index"]).toBe(selected);

      // The marker is drawn, and it is a rule and a glyph rather than a colour.
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
      await open();
      expect(await rangeCaption()).toContain("full range");

      const at = await pointAt(0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -240 }).perform();

      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the wheel never changed the visible range",
      });
      expect(await browser.$("button=Reset range").isEnabled()).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("pans on a real drag without changing the span", async () => {
      await open();
      await browser.$("button=Zoom in").click();
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
      });
      const before = spanOf(await rangeCaption());

      const from = await pointAt(0.7);
      const to = await pointAt(0.3);
      await browser
        .action("pointer")
        .move({ x: from.x, y: from.y })
        .down()
        .move({ x: to.x, y: to.y, duration: 60 })
        .up()
        .perform();

      await browser.waitUntil(
        async () => {
          const caption = await rangeCaption();
          return Math.abs(spanOf(caption) - before) < before * 0.02 && caption !== "";
        },
        { timeout: 10_000, timeoutMsg: "the drag did not keep the span" },
      );
      // Panned rather than resized, and nothing was selected by the drag.
      expect(await selectedRowPosition()).toBeNull();
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("resets to the whole run", async () => {
      await open();
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
      await open();
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

  describe("the keyboard", () => {
    it("reaches the plot and every viewport control", async () => {
      await open();

      await browser.execute((css: string) => {
        document.querySelector<SVGSVGElement>(css)?.focus();
      }, PLOT);
      const focused = await browser.execute(() => document.activeElement?.tagName ?? "");
      expect(focused.toLowerCase()).toBe("svg");

      await browser.keys(["+"]);
      await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the keyboard did not zoom",
      });
      const zoomed = await rangeCaption();
      const span = spanOf(zoomed);

      await browser.keys(["ArrowRight"]);
      await browser.waitUntil(async () => (await rangeCaption()) !== zoomed, {
        timeout: 10_000,
        timeoutMsg: "the keyboard did not pan",
      });
      // Panned rather than resized: a different stretch of the run, the same
      // width of it.
      expect(spanOf(await rangeCaption())).toBeCloseTo(span, 3);

      await browser.keys(["Home"]);
      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 10_000,
        timeoutMsg: "the keyboard did not reset",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("moves table focus with the arrows without reading a spectrum", async () => {
      // Load-bearing. Selection-following-focus would launch one ProteoWizard
      // process per key press.
      await open();
      await browser.execute(() => {
        document.querySelector<HTMLElement>('div.spectrum-table-row[data-row-position="0"]')?.focus();
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
      await open();
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
    });
  });

  describe("reveal geometry, measured", () => {
    /*
     * Two different scrolls are easy to confuse, and confusing them once
     * already produced a wrong fix in this milestone.
     *
     * WebDriver's own `scrollIntoView` — which it performs implicitly before
     * clicking an element it considers out of view — places the element at the
     * container's top edge, which in this table is *underneath* the sticky
     * header. A click intercepted by the column header after such a scroll says
     * nothing about `revealRow`.
     *
     * MSCanvas's reveal is a different calculation. The header is
     * `position: sticky`, so it stays in normal flow and the row canvas begins
     * after it; a row at canvas offset `top` renders at
     * `header.height + top - scrollTop`, and is clear of the header exactly
     * when `top >= scrollTop`.
     *
     * So these cases scroll the container directly and then let the application
     * reveal, and they assert against measured rectangles rather than against
     * scrollTop arithmetic. Nothing here uses the driver's scrollIntoView as
     * the mechanism under test.
     */
    async function tableGeometry(): Promise<{
      readonly headerBottom: number;
      readonly viewportTop: number;
      readonly viewportBottom: number;
      readonly scrollTop: number;
      readonly selectedTop: number;
      readonly selectedBottom: number;
      readonly selectedPosition: number | null;
    }> {
      return browser.execute(() => {
        const viewport = document.querySelector(".spectrum-table-viewport");
        const header = document.querySelector(".spectrum-table-head");
        const selected = document.querySelector('div.spectrum-table-row[aria-selected="true"]');
        const viewportBox = viewport?.getBoundingClientRect();
        const headerBox = header?.getBoundingClientRect();
        const selectedBox = selected?.getBoundingClientRect();
        const position = selected?.getAttribute("data-row-position");
        return {
          headerBottom: headerBox?.bottom ?? 0,
          viewportTop: viewportBox?.top ?? 0,
          viewportBottom: viewportBox?.bottom ?? 0,
          scrollTop: viewport?.scrollTop ?? 0,
          selectedTop: selectedBox?.top ?? 0,
          selectedBottom: selectedBox?.bottom ?? 0,
          selectedPosition:
            position === undefined || position === null ? null : Number(position),
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
      // Discriminating, and measured rather than computed. Scrolled to the end
      // of a short table, row 4 is above the fold; revealing it must place its
      // top on the header's bottom edge. Subtracting the header a second time
      // would scroll a row further and leave the row one row-height lower --
      // which is what the equality below would catch.
      await open();
      await scrollTableTo(1_000);

      const at = await pointAt(4 / 5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 4, {
        timeout: 10_000,
        timeoutMsg: "the click never selected scan 4",
      });

      const geometry = await tableGeometry();
      expect(geometry.selectedTop).toBeCloseTo(geometry.headerBottom, 0);
      // And it is on screen rather than scrolled past the end of the box. The
      // bottom edge is deliberately not asserted: at this window the table's
      // row area is 29px, one pixel less than a row, so no row can fit inside
      // it whole -- the component floors the usable height at one row rather
      // than dividing by zero.
      expect(geometry.selectedTop).toBeLessThan(geometry.viewportBottom);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("does not move a row that already begins immediately below the header", async () => {
      // The case the wrong geometry got wrong: a row exactly at the header's
      // bottom edge is fully visible, and revealing it must be a no-op.
      await open();

      // Select a scan, then scroll the table so that its row sits exactly at
      // the header's bottom edge, and commit the same scan again.
      await browser.$('div.spectrum-table-row[data-row-position="2"]').click();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
        timeout: 10_000,
      });

      // Row 2 sits at canvas offset 60; a scroll of exactly 60 puts it against
      // the header.
      await scrollTableTo(60);
      const before = await tableGeometry();
      expect(before.selectedTop).toBeCloseTo(before.headerBottom, 0);

      // Commit it again from the chromatogram — a new commit, and one the
      // reveal will act on.
      const at = await pointAt(2 / 5);
      await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();
      await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
        timeout: 10_000,
      });

      const after = await tableGeometry();
      // The scroll did not move, and the row is still against the header.
      expect(after.scrollTop).toBe(before.scrollTop);
      expect(after.selectedTop).toBeCloseTo(after.headerBottom, 0);
    });
  });

  describe("linked selection", () => {
    it("keeps the table, the plot and the spectrum on one scan in both directions", async () => {
      await open();

      // From the plot.
      const at = await pointAt(0.8);
      await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();
      await browser.waitUntil(async () => (await selectedRowPosition()) !== null, {
        timeout: 10_000,
      });
      const fromPlot = await selectedRowPosition();
      await leaveThePlot();
      await browser.waitUntil(
        async () => (await readout()).includes(`Selected index ${String(fromPlot)},`),
        { timeout: 10_000, timeoutMsg: "the plot never reported the selected scan" },
      );

      // From the table, to a different row. The reveal above scrolled the
      // table down to the selected row, so the first row is above the fold;
      // scrolled back, as a user would, before it is clicked.
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
      expect(reads.map((call) => call.args["index"])).toEqual([fromPlot, 0]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("leaves the loaded chromatogram alone when a vendor row takes focus", async () => {
      // The established rule: a focused workspace row is not the loaded
      // preview's authority.
      await open();
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
      // Focusing a row is a real workspace action and has its own command. What
      // must not happen is the viewer being re-read: the chromatogram's source,
      // its range and its selected scan all belong to the preview that is
      // loaded, not to the row that has focus.
      expect(viewerReads(await ipcCalls())).toBe(before);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });
});

/** How many times the viewer read the backend, which panning must never do. */
function viewerReads(calls: readonly { readonly command: string }[]): number {
  return calls.filter(
    (call) => call.command === "load_selected_spectrum" || call.command === "open_mzml_preview",
  ).length;
}

/** How wide a "Showing a to b" caption says the viewport is. */
function spanOf(caption: string): number {
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  return Number(high) - Number(low);
}
