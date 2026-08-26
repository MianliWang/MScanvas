/**
 * M4.3 rendered QA — what the run on screen can be exported as.
 *
 * The unit suite pins the schema, the range arithmetic and the value window.
 * What only a browser can answer is whether the surface is reachable, whether
 * opening it costs the measured three-panel layout anything, and whether what
 * the shipped bundle actually sends across the boundary is the committed range
 * and the traces on screen.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * about which command was called with which argument is a claim about the
 * shipped frontend.
 */

import { ALLOWED_CONSOLE_SUBSTRINGS, boxOf, consoleEntries, ipcCalls } from "../support/harness";
import { VENDOR_ROW } from "../support/fixtures";
import {
  CHROMATOGRAM,
  PLOT,
  openTheViewer,
  pointAt,
  rangeCaption,
  revealThePlot,
  visibleSpan,
} from "../support/viewer";

/** Enough scans that a range can hold some of them and not others. */
const SCANS = 200;

const TOGGLE = "button#chromatogram-export-toggle";
const PANEL = "#chromatogram-export-panel";

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** Opens the export surface, which every viewer opens closed. */
async function openExport(): Promise<void> {
  await browser.$(TOGGLE).click();
  await browser.$(PANEL).waitForDisplayed({ timeout: 10_000 });
}

/**
 * One of this panel's controls, found by its own text.
 *
 * Chained rather than written as one selector string: WebdriverIO's text
 * pseudo-selector is not CSS and cannot be combined with a CSS prefix, and the
 * driver refuses the whole thing rather than the half it does not understand.
 */
function control(label: string) {
  return browser.$(PANEL).$(`button=${label}`);
}

/** Every action the export surface offers, in the order they are laid out. */
const EXPORT_ACTIONS = [
  "Export SVG\u2026",
  "Export PNG\u2026",
  "Copy plot",
  "Export CSV\u2026",
  "Export TSV\u2026",
] as const;

/** The viewer column, which is one of the two scroll owners in play. */
const VIEWER_STACK = ".viewer-stack";

/**
 * What the application can actually be scrolled to.
 *
 * `scrollIntoView` is deliberately not used: it drives the browser rather than
 * the product, and would report a control reachable that no user could reach.
 * Only real scroll owners are moved here, and only through their own
 * `scrollTop`.
 */
async function scrollTo(selector: string, top: number): Promise<void> {
  await browser.execute(
    (css: string, to: number) => {
      const owner = document.querySelector(css);
      if (owner !== null) {
        owner.scrollTop = to;
      }
    },
    selector,
    top,
  );
}

/** How far one scroll owner can be scrolled, and how tall it thinks it is. */
async function scrollExtent(selector: string): Promise<{ height: number; extent: number }> {
  return browser.execute((css: string) => {
    const owner = document.querySelector(css);
    return owner === null
      ? { height: 0, extent: 0 }
      : { height: owner.clientHeight, extent: owner.scrollHeight };
  }, selector);
}

/**
 * Whether one control is genuinely on screen: inside every ancestor that clips,
 * inside the viewport, and the thing the browser would hand a click to.
 *
 * The last part is what an x-only assertion cannot do. A control whose left and
 * right edges sit inside its panel is still gone if its top and bottom do not,
 * and `elementFromPoint` is the question a user's pointer asks.
 */
async function reachability(label: string): Promise<{
  found: boolean;
  clippedBy: string[];
  inViewport: boolean;
  hitTestReachesIt: boolean;
}> {
  return browser.execute((text: string) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (node) => (node.textContent ?? "").trim() === text,
    );
    if (button === undefined) {
      return { found: false, clippedBy: [], inViewport: false, hitTestReachesIt: false };
    }
    const rect = button.getBoundingClientRect();
    const clippedBy: string[] = [];
    for (
      let node = button.parentElement;
      node !== null && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") {
        continue;
      }
      const bounds = node.getBoundingClientRect();
      const outside =
        rect.top < bounds.top - 1 ||
        rect.bottom > bounds.bottom + 1 ||
        rect.left < bounds.left - 1 ||
        rect.right > bounds.right + 1;
      if (outside) {
        clippedBy.push(node.className === "" ? node.tagName : String(node.className));
      }
    }
    const centre = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + rect.height / 2),
    );
    return {
      found: true,
      clippedBy,
      inViewport:
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth,
      hitTestReachesIt: centre !== null && (centre === button || button.contains(centre)),
    };
  }, label);
}

/**
 * Scrolls the viewer column until one control is genuinely reachable.
 *
 * The offset is computed rather than stepped towards: the control's position
 * within the scrolling column is known, so one scroll puts it in the middle of
 * the visible band. Answers the measurement taken afterwards, so a failure
 * reports what was actually on screen rather than only that a search gave up.
 */
async function bringIntoView(label: string): Promise<Awaited<ReturnType<typeof reachability>>> {
  const already = await reachability(label);
  if (already.hitTestReachesIt && already.clippedBy.length === 0 && already.inViewport) {
    return already;
  }
  await browser.execute((text: string) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (node) => (node.textContent ?? "").trim() === text,
    );
    if (button === undefined) {
      return;
    }
    // Every ancestor that genuinely scrolls, innermost first. Which one owns
    // this control is the product's choice, not this test's, so the test moves
    // whichever ones exist rather than naming one.
    for (
      let node: HTMLElement | null = button.parentElement;
      node !== null && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      const scrolls =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight;
      if (!scrolls) {
        continue;
      }
      const offset =
        button.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
      node.scrollTop = Math.max(0, offset - node.clientHeight / 2);
    }
  }, label);
  return reachability(label);
}

/** Where one panel sits, for the assertions about panels not covering others. */
async function panelBox(selector: string): Promise<{ top: number; bottom: number }> {
  return browser.execute((css: string) => {
    const found = document.querySelector(css);
    if (found === null) {
      return { top: 0, bottom: 0 };
    }
    const rect = found.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
  }, selector);
}

/** Chooses a range scope by its visible label. */
async function chooseScope(label: string): Promise<void> {
  await browser.$(PANEL).$(`label*=${label}`).click();
}

/**
 * What the panel says the current range is.
 *
 * Read from the document rather than through `getText`, which answers only for
 * text inside the viewport. The viewer column scrolls, so a panel opened at the
 * bottom of it is present, correct and partly below the fold -- and a helper
 * that returned an empty string for it would fail a test about what the product
 * says.
 */
async function rangeNote(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${PANEL} .chromatogram-export-note`,
  );
}

/** What this panel's live region says, read the same way and for the same reason. */
async function exportStatus(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${PANEL} .spectrum-export-status`,
  );
}

/** The last chromatogram export this run began, as it crossed the boundary. */
async function lastExportRequest(): Promise<Record<string, unknown> | null> {
  const calls = await ipcCalls();
  const began = calls.filter((call) => call.command === "begin_chromatogram_export");
  return (began.at(-1)?.args ?? null) as Record<string, unknown> | null;
}

describe("exporting the chromatogram, rendered", () => {
  it("adds nothing to the viewer's height while it is closed", async () => {
    /*
     * The three-panel column has measured floors and its panels clip, so a
     * disclosure that added a row to the body would push a control out of the
     * panel rather than make it taller. The control that opens this one lives
     * in the header row that already exists.
     */
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });

    const closed = await boxOf(CHROMATOGRAM);
    expect(await browser.$(PANEL).isExisting()).toBe(false);
    expect(await browser.$(TOGGLE).getAttribute("aria-expanded")).toBe("false");
    // The plot is still drawn at its own size, with the toggle beside the other
    // header controls rather than above or below them.
    const plot = await boxOf(PLOT);
    expect(plot.height).toBeGreaterThan(40);
    const toggle = await boxOf(TOGGLE);
    expect(toggle.top).toBeLessThan(plot.top);

    await openExport();

    // Open, it is inside the panel and nothing it added is off the page.
    const panel = await boxOf(PANEL);
    expect(panel.width).toBeGreaterThan(0);
    expect(panel.height).toBeGreaterThan(0);
    const opened = await boxOf(CHROMATOGRAM);
    expect(opened.height).toBeGreaterThanOrEqual(closed.height);
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const viewport of [
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "1920x1080", width: 1_920, height: 1_080 },
    { name: "960x640", width: 960, height: 640 },
  ] as const) {
    it(`keeps every export control inside the panel at ${viewport.name}`, async () => {
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      await openExport();

      const panel = await boxOf(PANEL);
      for (const label of ["Export SVG…", "Export PNG…", "Copy plot", "Export CSV…", "Export TSV…"]) {
        const found = control(label);
        expect(await found.isDisplayed()).toBe(true);
        const at = await found.getLocation();
        const size = await found.getSize();
        expect(at.x).toBeGreaterThanOrEqual(panel.left - 1);
        expect(at.x + size.width).toBeLessThanOrEqual(panel.left + panel.width + 1);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  for (const viewport of [
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "960x640", width: 960, height: 640 },
    { name: "1920x1080", width: 1_920, height: 1_080 },
  ] as const) {
    it(`brings every export action within reach at ${viewport.name}`, async () => {
      /*
       * The P1 Round 2 of M4.3.1 found. The controls existed, their x
       * coordinates were inside the panel, and every one of them was clipped
       * out of the panel's box and unhittable -- so the suite passed while the
       * feature could not be operated at any supported size.
       *
       * What is asserted here is reachability rather than position: the whole
       * rectangle inside everything that clips, and `elementFromPoint` landing
       * on the control. Getting there uses the application's own scroll owner,
       * because a control only the WebDriver can reveal is not reachable.
       */
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      const closed = await scrollExtent(CHROMATOGRAM);
      await openExport();

      // Opening puts the surface into a scrollable layout rather than into a
      // clipped area: the panel now has more content than box, and says so.
      const opened = await scrollExtent(CHROMATOGRAM);
      expect(opened.extent).toBeGreaterThan(closed.extent);
      expect(opened.extent).toBeGreaterThan(opened.height);

      for (const label of EXPORT_ACTIONS) {
        const reach = await bringIntoView(label);
        expect(reach.found).toBe(true);
        expect(reach.clippedBy).toEqual([]);
        expect(reach.inViewport).toBe(true);
        expect(reach.hitTestReachesIt).toBe(true);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`keeps the linked panels reachable and apart at ${viewport.name}`, async () => {
      // Opening the surface must not buy its room by covering the views beside
      // it. Each panel keeps its own band, and each is still scrollable to.
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      await openExport();
      await scrollTo(VIEWER_STACK, 0);

      const chromatogram = await panelBox(CHROMATOGRAM);
      const table = await panelBox("section.spectrum-table-panel");
      const spectrum = await panelBox("section.spectrum-panel");
      expect(chromatogram.bottom).toBeLessThanOrEqual(table.top + 1);
      expect(table.bottom).toBeLessThanOrEqual(spectrum.top + 1);

      // And nothing the surface draws reaches into the panel below it. The
      // boxes not overlapping is not the same claim: a panel that spills its
      // content keeps its own bounds and paints over its neighbour anyway,
      // which is buying room rather than making it.
      const intruding = await browser.execute((labels: readonly string[]) => {
        const below = document.querySelector("section.spectrum-table-panel");
        if (below === null) {
          return ["the scan table is not on screen"];
        }
        const bounds = below.getBoundingClientRect();
        // Only what is actually painted there. A control scrolled out of its
        // own panel still reports the position it would occupy, and clipped
        // away is not the same as drawn over the neighbour.
        const clipped = (node: Element): boolean => {
          const rect = node.getBoundingClientRect();
          for (
            let up: HTMLElement | null = (node as HTMLElement).parentElement;
            up !== null && up !== document.body;
            up = up.parentElement
          ) {
            const style = getComputedStyle(up);
            if (style.overflowX === "visible" && style.overflowY === "visible") {
              continue;
            }
            const box = up.getBoundingClientRect();
            if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1) {
              return true;
            }
          }
          return false;
        };
        return Array.from(document.querySelectorAll("button"))
          .filter((node) => labels.includes((node.textContent ?? "").trim()))
          .filter((node) => !clipped(node))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1;
          })
          .map((node) => (node.textContent ?? "").trim());
      }, EXPORT_ACTIONS);
      expect(intruding).toEqual([]);

      // And the plot itself did not pay for the surface by disappearing.
      const plot = await boxOf(PLOT);
      expect(plot.height).toBeGreaterThan(40);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("keeps the export actions reachable while the settings are unusable", async () => {
    // The surface is taller in its error state: two live problem sentences
    // appear above the actions. A layout that fits only the shortest successful
    // state is a layout that clips exactly when a user is trying to correct
    // something.
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    await browser.$(PANEL).$("label*=Width").$("input").setValue("");
    await browser.$(PANEL).$("label*=PNG DPI").$("input").setValue("");

    const problems = await browser.execute((css: string) => {
      return Array.from(document.querySelectorAll(css))
        .map((node) => node.textContent?.trim() ?? "")
        .join(" ");
    }, `${PANEL} .spectrum-figure-problem`);
    expect(problems.length).toBeGreaterThan(0);

    for (const label of ["Export CSV\u2026", "Export TSV\u2026"]) {
      const reach = await bringIntoView(label);
      expect(reach.clippedBy).toEqual([]);
      expect(reach.hitTestReachesIt).toBe(true);
    }
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("activates a reachable export action through the rendered surface", async () => {
    // Reachability that stops at geometry proves less than it looks. This one
    // scrolls the real column, clicks the real control, and asserts the request
    // crossed the boundary.
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    const reach = await bringIntoView("Export CSV\u2026");
    expect(reach.hitTestReachesIt).toBe(true);
    await control("Export CSV\u2026").click();

    await browser.waitUntil(async () => (await lastExportRequest()) !== null, {
      timeout: 10_000,
      timeoutMsg: "clicking the control the user can see reached nothing",
    });
    expect(await lastExportRequest().then((request) => request?.["format"])).toBe("csv");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("exports the whole run until a range is chosen", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    await control("Export CSV…").click();

    await browser.waitUntil(async () => (await lastExportRequest()) !== null, {
      timeout: 10_000,
      timeoutMsg: "the export never reached the boundary",
    });
    const request = await lastExportRequest();
    expect(request?.["range"]).toEqual({ scope: "full", low: null, high: null });
    // The token Rust issued, and nothing about the rows this document holds.
    expect(request?.["exportToken"]).toBe("chromatogram-token");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says a current range is the whole run until the viewport is committed", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();
    await chooseScope("Current range");

    expect(await rangeNote()).toContain("whole run until the viewport is changed");

    await control("Export CSV…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });

    // Null rather than the run's own bounds: Rust resolves it, and this side
    // does not invent a subrange to make the option look different.
    expect(await lastExportRequest().then((request) => request?.["range"])).toEqual({
      scope: "current",
      low: null,
      high: null,
    });
  });

  it("sends the committed range once the viewport has been moved", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    const at = await pointAt(0.5);
    const full = await visibleSpan();
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
    await browser.waitUntil(async () => (await visibleSpan()) < full, {
      timeout: 10_000,
      timeoutMsg: "the wheel never changed the visible range",
    });
    await openExport();
    await chooseScope("Current range");
    // The gesture settles a moment after the last event, and the panel says
    // which range it settled on.
    await browser.waitUntil(async () => /Current range is [\d.]/u.test(await rangeNote()), {
      timeout: 10_000,
      timeoutMsg: "the committed range never reached the panel",
    });

    await control("Export CSV…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });

    const range = (await lastExportRequest())?.["range"] as Record<string, number | null>;
    // Compared against what the panel offered rather than against the axis
    // caption: both are drawn from the committed domain, and the panel is the
    // one this surface promised to export.
    // The sentence ends in a full stop, and a greedy `[\d.]+` swallows it -- so
    // the second number is matched as a number rather than as digits-and-dots.
    const [, low, high] =
      /Current range is (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/u.exec(await rangeNote()) ?? [];
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
    expect(Number(range["high"])).toBeCloseTo(Number(high), 3);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("does not export the range a gesture is still holding", async () => {
    /*
     * A transient range is a drawing, not a decision. An export invoked while a
     * wheel or a drag is in flight writes the last range the user settled on --
     * and the panel goes on saying that one, so what is offered and what is
     * sent agree.
     */
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    const at = await pointAt(0.5);
    const full = await visibleSpan();
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
    await browser.waitUntil(async () => (await visibleSpan()) < full, { timeout: 10_000 });
    await openExport();
    await chooseScope("Current range");
    await browser.waitUntil(async () => /Current range is [\d.]/u.test(await rangeNote()), {
      timeout: 10_000,
    });
    const committed = await rangeNote();

    /*
     * A drag that has moved and has not been released.
     *
     * Two things this needed before it was a drag at all, both found while M4.4
     * was measuring the same surface.
     *
     * The plot is scrolled back onto the screen first. The export surface is
     * taller than the three-panel column has room for, so opening it puts the
     * plot below its panel's own fold -- and the panel clips. A pointer put at
     * the centre of the plot's *layout* box therefore landed on whatever was
     * painted at that screen point instead: measured at 1366x768 on the M4.3
     * surface, a `<span>` of the panel below. The gesture this test is about
     * never started, and every assertion held vacuously.
     *
     * And the release is skipped explicitly. `perform()` releases the pointer
     * when the sequence ends, so "has not been released" was true only for the
     * 120ms the settle debounce had left to run -- an assertion about
     * scheduling. `perform(true)` leaves the button down, which is what the
     * sentence above says.
     */
    const plot = await revealThePlot();
    const start = { x: Math.round(plot.left + plot.width * 0.6), y: Math.round(plot.top + plot.height / 2) };
    await browser
      .action("pointer")
      .move({ x: start.x, y: start.y })
      .down()
      .move({ x: start.x - 80, y: start.y })
      .perform(true);
    const transient = await rangeCaption();
    expect(transient).not.toBe(committed);

    // The panel still offers the committed range, not the one being drawn.
    expect(await rangeNote()).toBe(committed);
    await browser.action("pointer").up().perform();
    // And the gesture was not settled or cancelled by being read: releasing it
    // still commits what it was showing.
    await browser.waitUntil(async () => (await rangeCaption()) === transient, { timeout: 10_000 });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("sends the traces that are on screen with a figure", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    await control("Export SVG…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    expect((await lastExportRequest())?.["traces"]).toEqual({ tic: true, bpc: false });

    await browser.$(CHROMATOGRAM).$("label*=BPC").click();
    await control("Export SVG…").click();
    await browser.waitUntil(
      async () => {
        const calls = await ipcCalls();
        return calls.filter((call) => call.command === "begin_chromatogram_export").length === 2;
      },
      { timeout: 10_000 },
    );
    expect((await lastExportRequest())?.["traces"]).toEqual({ tic: true, bpc: true });
  });

  it("closes the figure outputs with no trace on screen, and leaves the data", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await browser.$(CHROMATOGRAM).$("label*=TIC").click();
    await openExport();

    for (const label of ["Export SVG…", "Export PNG…", "Copy plot"]) {
      expect(await control(label).isEnabled()).toBe(false);
    }
    for (const label of ["Export CSV…", "Export TSV…"]) {
      expect(await control(label).isEnabled()).toBe(true);
    }
    expect(await browser.$(PANEL).$("*=Data exports always include both").isExisting()).toBe(
      true,
    );

    await control("Export TSV…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    expect((await lastExportRequest())?.["format"]).toBe("tsv");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("needs no selected spectrum, and keeps working once there is one", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();
    expect(await control("Export CSV…").isEnabled()).toBe(true);

    // Now with a spectrum read, which is when both export surfaces are on
    // screen at once.
    await browser.$('div.spectrum-table-row[data-row-position="2"]').click();
    await browser.waitUntil(
      async () => (await ipcCalls()).some((call) => call.command === "load_selected_spectrum"),
      { timeout: 10_000 },
    );

    expect(await control("Export CSV…").isEnabled()).toBe(true);
    // Two panels, and no identifier collision between them.
    const duplicated = await browser.execute(() => {
      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      return ids.length - new Set(ids).size;
    });
    expect(duplicated).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps the export surface through a vendor row's focus", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    await browser.$(`li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`).click();

    expect(await browser.$(PLOT).isDisplayed()).toBe(true);
    expect(await control("Export CSV…").isEnabled()).toBe(true);
    await control("Export CSV…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    // The run that is loaded, not the row that has focus.
    expect((await lastExportRequest())?.["exportToken"]).toBe("chromatogram-token");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says what was saved", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    await control("Export CSV…").click();

    await browser.waitUntil(async () => (await exportStatus()).includes("Saved"), {
      timeout: 10_000,
      timeoutMsg: "the export never reported what it wrote",
    });
    const said = await exportStatus();
    expect(said).toContain("mscanvas-chromatogram-full.csv");
    // The count Rust holds, not the rows this document received.
    expect(said).toContain("36,319");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("copies the plot without a dialog", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();

    await control("Copy plot").click();

    await browser.waitUntil(
      async () => (await ipcCalls()).some((call) => call.command === "copy_chromatogram_plot"),
      { timeout: 10_000, timeoutMsg: "the copy never reached the boundary" },
    );
    await browser.waitUntil(async () => (await exportStatus()).includes("Copied"), {
      timeout: 10_000,
      timeoutMsg: "the copy never reported itself",
    });
    const calls = await ipcCalls();
    expect(calls.some((call) => call.command === "copy_chromatogram_plot")).toBe(true);
    // No save dialog was involved: a copy chooses no destination.
    expect(calls.some((call) => call.command === "save_chromatogram_export")).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("leaves the console clean through a whole export session", async () => {
    await openTheViewer({ width: 1_366, height: 768, scans: SCANS });
    await openExport();
    await chooseScope("Current range");
    await chooseScope("Full run");
    await browser.$(CHROMATOGRAM).$("label*=BPC").click();
    await control("Export SVG…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    await browser.$(TOGGLE).click();

    expect(await browser.$(PANEL).isExisting()).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });
});
