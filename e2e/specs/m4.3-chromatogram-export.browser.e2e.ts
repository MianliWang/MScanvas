/**
 * M4.3 rendered QA — what the run on screen can be exported as.
 *
 * The unit suite pins the schema, the range arithmetic and the value window.
 * What only a browser can answer is whether the surface is reachable, whether
 * opening it costs the measured viewer layout anything, and whether what the
 * shipped bundle actually sends across the boundary is the committed range and
 * the traces on screen.
 *
 * Since the rebuild (spec 3.4, 6) that surface is the Export figure dialog,
 * opened from the chromatogram head's Export…; the head itself keeps PNG, Copy
 * and a ⋯ menu with the data documents. The dialog is modal and portaled to the
 * body, so it adds no row to the viewer and is looked up under its own root.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * about which command was called with which argument is a claim about the
 * shipped frontend.
 */

import { ALLOWED_CONSOLE_SUBSTRINGS, boxOf, consoleEntries, ipcCalls } from "../support/harness";
import { VENDOR_ROW } from "../support/fixtures";
import {
  CHROMATOGRAM,
  type OpenViewerOptions,
  PLOT,
  openTheViewer,
  pointAt,
  rangeCaption,
  revealRosterRow,
  revealThePlot,
  visibleSpan,
} from "../support/viewer";
import {
  FIGURE_DIALOG,
  answerFigurePreviews,
  closeFigureDialog,
  figureActions,
  openFigureDialog,
  openPlotMenu,
  plotMenuItem,
} from "../support/figure";

/** Enough scans that a range can hold some of them and not others. */
const SCANS = 200;

/** The chromatogram head's Export…, which opens the dialog. */
const ENTRY = `${figureActions(CHROMATOGRAM)} > button:first-child`;
const PANEL = FIGURE_DIALOG;
/** The evidence column, the viewer's scroll owner since M7.2/M7.3. */
const EVIDENCE = "#workbench-evidence";
/** The dialog's "Current range" option, which names the window it covers. */
const CURRENT_OPTION = `${PANEL} .figure-export-range [role="radio"]:first-child`;
/** The window that option names, at four decimals. */
const RT_WINDOW = /RT (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)/u;

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/**
 * A viewer of a long enough run, with the dialog's preview answered.
 *
 * The dialog's Copy, SVG and PNG wait for a drawn preview, answered here with a
 * labelled mock: the arguments these tests watch are the export commands'.
 * In-page, so installed once the page has loaded.
 */
async function openViewer(options: OpenViewerOptions = {}): Promise<void> {
  await openTheViewer({ width: 1_366, height: 768, ...options, scans: SCANS });
  await answerFigurePreviews();
}

/** Opens the export surface: the chromatogram head's Export…. */
async function openExport(): Promise<void> {
  await openFigureDialog(CHROMATOGRAM);
}

/**
 * One of the dialog's controls, found by its own text.
 *
 * Chained rather than written as one selector string: WebdriverIO's text
 * pseudo-selector is not CSS and cannot be combined with a CSS prefix, and the
 * driver refuses the whole thing rather than the half it does not understand.
 */
function control(label: string) {
  return browser.$(PANEL).$(`button=${label}`);
}

/**
 * Whether an action is offered: neither disabled nor refused. A refused action
 * is `aria-disabled` and keeps its Tab stop, so `isEnabled` alone says nothing.
 */
async function offered(label: string): Promise<boolean> {
  const button = control(label);
  return (await button.isEnabled()) && (await button.getAttribute("aria-disabled")) !== "true";
}

/**
 * Presses a dialog action once it is offered. The figure actions wait for the
 * preview of the current question, so a press before it is drawn is refused --
 * which is the product working, not something to race.
 */
async function press(label: string): Promise<void> {
  await browser.waitUntil(() => offered(label), {
    timeout: 15_000,
    timeoutMsg: `${label} was never offered`,
  });
  await control(label).click();
}

/** Every action the export surface offers, in the order they are laid out. */
const EXPORT_ACTIONS = [
  "Export CSV…",
  "Export TSV…",
  "Copy plot",
  "Export SVG…",
  "Export PNG…",
] as const;

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
 * Scrolls the dialog until one control is genuinely reachable.
 *
 * The offset is computed rather than stepped towards: the control's position
 * within its scrolling column is known, so one scroll puts it in the middle of
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

interface Band {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Where the viewer's three panels sit, for the assertions about them staying apart. */
async function viewerPanels(): Promise<{ chromatogram: Band; table: Band; spectrum: Band }> {
  return browser.execute((chromatogram: string) => {
    const band = (css: string) => {
      const rect = document.querySelector(css)?.getBoundingClientRect();
      return rect === undefined
        ? { top: 0, bottom: 0, left: 0, right: 0 }
        : {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
    };
    return {
      chromatogram: band(chromatogram),
      table: band("section.spectrum-table-panel"),
      spectrum: band("section.spectrum-panel"),
    };
  }, CHROMATOGRAM);
}

/** Chooses a range scope by its visible label. */
async function chooseScope(label: string): Promise<void> {
  await browser.$(PANEL).$(`button*=${label}`).click();
}

/**
 * What the dialog says the current range is: the "Current range" option, with
 * the committed window it covers when one narrower than the run is committed.
 *
 * Read from the document rather than through `getText`, which answers only for
 * text inside the viewport, and the options column scrolls on its own.
 */
async function rangeNote(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    CURRENT_OPTION,
  );
}

/** What the dialog's result line says, read the same way and for the same reason. */
async function exportStatus(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${PANEL} .figure-export-result [role="status"]`,
  );
}

/** What the chromatogram's own result line under the plot says. */
async function plotStatus(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${CHROMATOGRAM} .spectrum-export-status:not(.linked-figure-status)`,
  );
}

/** The last chromatogram export this run began, as it crossed the boundary. */
async function lastExportRequest(): Promise<Record<string, unknown> | null> {
  const calls = await ipcCalls();
  const began = calls.filter((call) => call.command === "begin_chromatogram_export");
  return (began.at(-1)?.args ?? null) as Record<string, unknown> | null;
}

/** Whether the plot draws a range band, the trace of a range drag. */
async function bandVisibility(): Promise<string | null> {
  return browser.execute(
    (css: string) => document.querySelector(`${css} .plot-range-band`)?.getAttribute("visibility") ?? null,
    PLOT,
  );
}

/** Narrows the run with a wheel over the plot, and waits for it to settle. */
async function narrowTheRun(): Promise<void> {
  const at = await pointAt(0.5);
  const full = await visibleSpan();
  await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
  await browser.waitUntil(async () => (await visibleSpan()) < full, {
    timeout: 10_000,
    timeoutMsg: "the wheel never changed the visible range",
  });
}

describe("exporting the chromatogram, rendered", () => {
  it("adds nothing to the viewer's height while it is closed", async () => {
    /*
     * The viewer's column has measured floors and its panels clip, so a surface
     * that added a row to the body would push a control out of the panel rather
     * than make it taller. The control that opens this one lives in the head
     * row that already exists, and what it opens is a dialog over the viewer.
     */
    await openViewer();

    const closed = await boxOf(CHROMATOGRAM);
    expect(await browser.$(PANEL).isExisting()).toBe(false);
    // The plot is still drawn at its own size, with the entry beside the other
    // head controls rather than above or below them.
    const plot = await boxOf(PLOT);
    expect(plot.height).toBeGreaterThan(40);
    const entry = await boxOf(ENTRY);
    expect(entry.top).toBeLessThan(plot.top);
    expect(await browser.$(ENTRY).getAttribute("aria-label")).toBe("Export figure");

    await openExport();

    // Open, it has a box of its own, and the chromatogram's did not change.
    const panel = await boxOf(PANEL);
    expect(panel.width).toBeGreaterThan(0);
    expect(panel.height).toBeGreaterThan(0);
    const opened = await boxOf(CHROMATOGRAM);
    expect(Math.abs(opened.height - closed.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(opened.top - closed.top)).toBeLessThanOrEqual(1);
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const viewport of [
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "1920x1080", width: 1_920, height: 1_080 },
    { name: "960x640", width: 960, height: 640 },
  ] as const) {
    it(`keeps every export control inside the panel at ${viewport.name}`, async () => {
      await openViewer({ width: viewport.width, height: viewport.height });
      await openExport();

      const panel = await boxOf(PANEL);
      for (const label of EXPORT_ACTIONS) {
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
       * on the control. Getting there uses the dialog's own scroll owner (its
       * options column scrolls at a small window), because a control only the
       * WebDriver can reveal is not reachable.
       */
      await openViewer({ width: viewport.width, height: viewport.height });
      await openExport();

      for (const label of EXPORT_ACTIONS) {
        const reach = await bringIntoView(label);
        expect(reach.found).toBe(true);
        expect(reach.clippedBy).toEqual([]);
        expect(reach.inViewport).toBe(true);
        expect(reach.hitTestReachesIt).toBe(true);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`keeps the viewer's panels where they were, and apart, at ${viewport.name}`, async () => {
      // Opening the surface must not buy its room by moving the views beneath
      // it. Each panel keeps its own band, and each keeps it while the dialog
      // is open.
      await openViewer({ width: viewport.width, height: viewport.height });
      await scrollTo(EVIDENCE, 0);
      const closed = await viewerPanels();
      await openExport();
      const opened = await viewerPanels();
      expect(opened).toEqual(closed);

      // The rebuild's order (spec 3.1): the chromatogram across the top, then
      // the scan list beside the spectrum it selects.
      expect(closed.chromatogram.bottom).toBeLessThanOrEqual(
        Math.min(closed.table.top, closed.spectrum.top) + 1,
      );
      expect(closed.table.right).toBeLessThanOrEqual(closed.spectrum.left + 1);

      // And the plot itself did not pay for the surface by disappearing.
      const plot = await boxOf(PLOT);
      expect(plot.height).toBeGreaterThan(40);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("keeps the export actions reachable while the settings are unusable", async () => {
    // The surface is taller in its error state: two live problem sentences
    // appear among the options. A layout that fits only the shortest successful
    // state is a layout that clips exactly when a user is trying to correct
    // something.
    await openViewer();
    await openExport();

    // By id suffix: the dialog's ids come from `useId`. Emptied by keys, as
    // m7.4-conversion-figures does, so React sees the edit.
    for (const field of ["-widthPx", "-pngDpi"]) {
      await browser.$(`${PANEL} input[id$="${field}"]`).click();
      await browser.keys(["Control", "a"]);
      await browser.keys("Backspace");
    }

    const problems = await browser.execute((css: string) => {
      return Array.from(document.querySelectorAll(css))
        .map((node) => node.textContent?.trim() ?? "")
        .join(" ");
    }, `${PANEL} .spectrum-figure-problem`);
    expect(problems.length).toBeGreaterThan(0);

    for (const label of ["Export CSV…", "Export TSV…"]) {
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
    await openViewer();
    await openExport();

    const reach = await bringIntoView("Export CSV…");
    expect(reach.hitTestReachesIt).toBe(true);
    await control("Export CSV…").click();

    await browser.waitUntil(async () => (await lastExportRequest()) !== null, {
      timeout: 10_000,
      timeoutMsg: "clicking the control the user can see reached nothing",
    });
    expect(await lastExportRequest().then((request) => request?.["format"])).toBe("csv");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("exports the whole run until a range is chosen", async () => {
    await openViewer();
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
    await openViewer();
    await openExport();
    await chooseScope("Current range");

    // Chosen, and naming no window: nothing narrower than the run is
    // committed, and the option does not invent one to look different.
    expect(await browser.$(CURRENT_OPTION).getAttribute("aria-checked")).toBe("true");
    expect(await rangeNote()).toBe("Current range");

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
    await openViewer();
    await narrowTheRun();
    await openExport();
    await chooseScope("Current range");
    // The gesture settles a moment after the last event, and the option says
    // which range it settled on.
    await browser.waitUntil(async () => RT_WINDOW.test(await rangeNote()), {
      timeout: 10_000,
      timeoutMsg: "the committed range never reached the dialog",
    });

    await control("Export CSV…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });

    const range = (await lastExportRequest())?.["range"] as Record<string, number | null>;
    // Compared against what the dialog offered rather than against the axis
    // caption: both are drawn from the committed domain, and the dialog is the
    // one this surface promised to export.
    const [, low, high] = RT_WINDOW.exec(await rangeNote()) ?? [];
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
    expect(Number(range["high"])).toBeCloseTo(Number(high), 3);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("does not export the range a gesture is still holding", async () => {
    /*
     * A transient range is a drawing, not a decision. An export invoked while a
     * wheel or a drag is in flight writes the last range the user settled on.
     */
    await openViewer();
    await narrowTheRun();
    await openExport();
    await chooseScope("Current range");
    await browser.waitUntil(async () => RT_WINDOW.test(await rangeNote()), {
      timeout: 10_000,
    });
    const [, low, high] = RT_WINDOW.exec(await rangeNote()) ?? [];
    // The scope is the workspace's, so it outlives the dialog.
    await closeFigureDialog();

    /*
     * A drag that has moved and has not been released.
     *
     * The plot is scrolled onto the screen first, through the product's scroll
     * owners, so the pointer lands on the plot rather than on whatever is
     * painted at its layout box's centre. And the release is skipped
     * explicitly: `perform()` releases the pointer when the sequence ends, so
     * "has not been released" would be true only for the settle debounce.
     * `perform(true)` leaves the button down, which is what the sentence above
     * says.
     */
    const plot = await revealThePlot();
    const committed = await rangeCaption();
    const start = { x: Math.round(plot.left + plot.width * 0.6), y: Math.round(plot.top + plot.height / 2) };
    await browser
      .action("pointer")
      .move({ x: start.x, y: start.y })
      .down()
      .move({ x: start.x - 80, y: start.y })
      .perform(true);
    // A primary-button drag draws a range band over the plot: a transient
    // range, drawn and not yet decided, while the caption keeps the committed one.
    expect(await bandVisibility()).toBe("visible");
    expect(await rangeCaption()).toBe(committed);

    // An export asked for now -- the head's Copy, pressed without moving the
    // held pointer -- carries the committed range, not the one being drawn.
    await browser.execute((css: string) => {
      document.querySelector<HTMLButtonElement>(css)?.click();
    }, `${figureActions(CHROMATOGRAM)} button[aria-label="Copy plot"]`);
    await browser.waitUntil(
      async () => (await ipcCalls()).some((call) => call.command === "copy_chromatogram_plot"),
      { timeout: 10_000, timeoutMsg: "the copy never reached the boundary" },
    );
    const copied = (await ipcCalls()).find((call) => call.command === "copy_chromatogram_plot");
    const range = copied?.args["range"] as Record<string, number | null>;
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
    expect(Number(range["high"])).toBeCloseTo(Number(high), 3);

    await browser.action("pointer").up().perform();
    // And neither the export nor the release committed the drawn range: what
    // the viewer shows as committed is still the range the reader settled on.
    expect(await rangeCaption()).toBe(committed);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("sends the traces that are on screen with a figure", async () => {
    await openViewer();
    await openExport();

    await press("Export SVG…");
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    expect((await lastExportRequest())?.["traces"]).toEqual({ tic: true, bpc: false });

    // The traces are chosen on the plot, so the dialog is closed to choose one.
    await closeFigureDialog();
    await browser.$(CHROMATOGRAM).$("button=BPC").click();
    await openExport();
    await press("Export SVG…");
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
    await openViewer();
    await browser.$(CHROMATOGRAM).$("button=TIC").click();

    // The head's figure actions are refused, not disabled: each keeps its Tab
    // stop and points at the sentence that says why.
    const figureOutputs = [
      `${figureActions(CHROMATOGRAM)} button[aria-label="Quick PNG"]`,
      `${figureActions(CHROMATOGRAM)} button[aria-label="Copy plot"]`,
    ];
    await browser.waitUntil(
      async () => (await browser.$(figureOutputs[0]!).getAttribute("aria-disabled")) === "true",
      { timeout: 10_000, timeoutMsg: "hiding both traces never refused the figure" },
    );
    for (const selector of figureOutputs) {
      expect(await browser.$(selector).getAttribute("aria-disabled")).toBe("true");
      expect(await browser.$(selector).getAttribute("aria-describedby")).toContain(
        "chromatogram-figure-reason",
      );
    }
    expect(await browser.$("#chromatogram-figure-reason").getText()).toBe("Both traces are hidden.");
    // Pressed anyway: the refusal is what reaches the boundary, which is nothing.
    await browser.execute((selectors: string[]) => {
      for (const css of selectors) document.querySelector<HTMLButtonElement>(css)?.click();
    }, figureOutputs);
    const figureCalls = (await ipcCalls()).filter(
      (call) => call.command === "begin_chromatogram_export" || call.command === "copy_chromatogram_plot",
    );
    expect(figureCalls).toEqual([]);

    // The data documents stay offered in the ⋯ menu, and still work.
    await openPlotMenu(CHROMATOGRAM);
    for (const name of ["Export CSV", "Export TSV"]) {
      expect(await browser.$(plotMenuItem(name)).getAttribute("aria-disabled")).toBe(null);
    }
    await browser.$(plotMenuItem("Export TSV")).click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    expect((await lastExportRequest())?.["format"]).toBe("tsv");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("needs no selected spectrum, and keeps working once there is one", async () => {
    await openViewer();
    await openExport();
    expect(await offered("Export CSV…")).toBe(true);
    await closeFigureDialog();

    // Now with a spectrum read, which is when both plots carry export actions
    // at once.
    await browser.$('div.spectrum-table-row[data-row-position="2"]').click();
    await browser.waitUntil(
      async () => (await ipcCalls()).some((call) => call.command === "load_selected_spectrum"),
      { timeout: 10_000 },
    );
    await browser.$(figureActions("section.spectrum-panel")).waitForExist({ timeout: 10_000 });

    await openExport();
    expect(await offered("Export CSV…")).toBe(true);
    // Two plots' actions and the dialog, and no identifier collision between them.
    const duplicated = await browser.execute(() => {
      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      return ids.length - new Set(ids).size;
    });
    expect(duplicated).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps the export surface through a vendor row's focus", async () => {
    await openViewer();

    // The M7.2 grouped roster's row, revealed where the window folds the roster
    // (PM9.7; slice-03 §5 (b): `li.dataset-row` no longer exists). A vendor row
    // is selected, not opened; the dialog is modal, so this happens first.
    await revealRosterRow(VENDOR_ROW.handle);
    await browser.$(`.grouped-roster [data-handle="${VENDOR_ROW.handle}"]`).click();

    expect(await browser.$(PLOT).isDisplayed()).toBe(true);
    await openExport();
    expect(await offered("Export CSV…")).toBe(true);
    await control("Export CSV…").click();
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    // The run that is loaded, not the row that has focus.
    expect((await lastExportRequest())?.["exportToken"]).toBe("chromatogram-token");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says what was saved", async () => {
    await openViewer();
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
    // And the plot says it too, once the dialog has returned to the viewer.
    await closeFigureDialog();
    expect(await plotStatus()).toBe(said);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("copies the plot without a dialog", async () => {
    await openViewer();

    // The head's Copy: no figure dialog and no save dialog.
    await browser.$(`${figureActions(CHROMATOGRAM)} button[aria-label="Copy plot"]`).click();

    await browser.waitUntil(
      async () => (await ipcCalls()).some((call) => call.command === "copy_chromatogram_plot"),
      { timeout: 10_000, timeoutMsg: "the copy never reached the boundary" },
    );
    await browser.waitUntil(async () => (await plotStatus()).includes("Copied"), {
      timeout: 10_000,
      timeoutMsg: "the copy never reported itself",
    });
    const calls = await ipcCalls();
    expect(calls.some((call) => call.command === "copy_chromatogram_plot")).toBe(true);
    // No save dialog was involved: a copy chooses no destination.
    expect(calls.some((call) => call.command === "save_chromatogram_export")).toBe(false);
    expect(await browser.$(PANEL).isExisting()).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("leaves the console clean through a whole export session", async () => {
    await openViewer();
    await openExport();
    await chooseScope("Current range");
    await chooseScope("Full run");
    await closeFigureDialog();
    await browser.$(CHROMATOGRAM).$("button=BPC").click();
    await openExport();
    await press("Export SVG…");
    await browser.waitUntil(async () => (await lastExportRequest()) !== null, { timeout: 10_000 });
    await closeFigureDialog();

    expect(await browser.$(PANEL).isExisting()).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });
});
