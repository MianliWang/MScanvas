/**
 * M4.4 rendered QA — the linked chromatogram + spectrum surface.
 *
 * The unit suite pins the pair, the range matrix and the two-panel geometry.
 * What only a browser can answer is whether the third set of controls is
 * *reachable* once it is added to a surface whose layout was already measured to
 * the pixel, and whether what the shipped bundle sends across the boundary is
 * the pair on screen with the range and the traces the user chose.
 *
 * Since the rebuild (spec 3.4, 6) the linked figure is "Linked figure…" in the
 * chromatogram head's ⋯ menu, which opens the Export figure dialog for the
 * pair. The menu item says why it is closed, or what to repair, in its own
 * text; the dialog is modal and portaled to the body.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * about which command was called with which argument is a claim about the
 * shipped frontend.
 */

import { ALLOWED_CONSOLE_SUBSTRINGS, boxOf, consoleEntries, ipcCalls } from "../support/harness";
import { SELECTED_RETENTION_TIME } from "../support/fixtures";
import {
  CHROMATOGRAM,
  type OpenViewerOptions,
  PLOT,
  openTheViewer,
  pointAt,
  revealThePlot,
  selectTheSpectrum,
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

const PANEL = FIGURE_DIALOG;
/** The ⋯ menu's entry to the linked figure, by the words it starts with. */
const LINKED_ITEM = "Linked figure";
/** The evidence column, the viewer's scroll owner since M7.2/M7.3. */
const EVIDENCE = "#workbench-evidence";

/** Every action the linked figure's dialog offers. */
const LINKED_ACTIONS = ["Copy plot", "Export SVG…", "Export PNG…"] as const;

/** Every action the chromatogram's own dialog offers. */
const EXPORT_ACTIONS = [
  "Export CSV…",
  "Export TSV…",
  "Copy plot",
  "Export SVG…",
  "Export PNG…",
] as const;

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/**
 * A viewer of a long enough run, with the dialog's preview answered: its Copy,
 * SVG and PNG wait for a drawn preview, here a labelled mock. In-page, so
 * installed once the page has loaded.
 */
async function openViewer(options: OpenViewerOptions = {}): Promise<void> {
  await openTheViewer({ width: 1_366, height: 768, ...options, scans: SCANS });
  await answerFigurePreviews();
}

/** Reads one spectrum, so there is a pair to link. */
async function selectAScan(): Promise<void> {
  await selectTheSpectrum(0);
  await browser.$(figureActions("section.spectrum-panel")).waitForExist({ timeout: 30_000 });
}

/** Opens the linked figure's dialog from the chromatogram's ⋯ menu. */
async function openLinked(): Promise<void> {
  await openPlotMenu(CHROMATOGRAM);
  await browser.$(plotMenuItem(LINKED_ITEM)).click();
  await browser.$(PANEL).waitForDisplayed();
}

/**
 * What the ⋯ menu says about the linked figure: whether its item is refused,
 * and the reason printed inside it. Opens the menu to read it and closes it
 * again with Escape, as a reader would.
 */
async function linkedItem(): Promise<{ readonly refused: boolean; readonly reason: string }> {
  await openPlotMenu(CHROMATOGRAM);
  const item = browser.$(plotMenuItem(LINKED_ITEM));
  const refused = (await item.getAttribute("aria-disabled")) === "true";
  const reason = await browser.execute(
    (name: string) =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .find((node) => (node.textContent ?? "").trim().startsWith(name))
        ?.querySelector(".plot-menu-reason")?.textContent?.trim() ?? "",
    LINKED_ITEM,
  );
  await browser.keys("Escape");
  await browser.$('[role="menu"]').waitForExist({ reverse: true });
  return { refused, reason };
}

/** Waits until the menu's reason for the linked figure is the one given. */
async function linkedReasonBecomes(expected: string, timeoutMsg: string): Promise<void> {
  await browser.waitUntil(async () => (await linkedItem()).reason === expected, {
    timeout: 30_000,
    timeoutMsg,
  });
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

/** Offered: neither disabled nor refused (`aria-disabled`, which keeps a Tab stop). */
async function offered(label: string): Promise<boolean> {
  const button = control(label);
  return (await button.isEnabled()) && (await button.getAttribute("aria-disabled")) !== "true";
}

/** Presses a dialog action once its preview is drawn, which is what offers it. */
async function press(label: string): Promise<void> {
  await browser.waitUntil(() => offered(label), {
    timeout: 30_000,
    timeoutMsg: `${label} was never offered`,
  });
  await control(label).click();
}

/** Chooses a range scope in the open dialog by its visible label. */
async function chooseScope(label: string): Promise<void> {
  await browser.$(PANEL).$(`button*=${label}`).click();
}

/**
 * What the linked dialog's result line says.
 *
 * Read from the document rather than through `getText`, which answers only for
 * text inside the viewport.
 */
async function linkedStatus(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${PANEL} .figure-export-result [role="status"]`,
  );
}

/** Every linked figure this run began, as it crossed the boundary. */
async function linkedRequests(): Promise<Record<string, unknown>[]> {
  return (await ipcCalls())
    .filter((call) => call.command === "begin_linked_figure_export")
    .map((call) => call.args);
}

async function linkedCopies(): Promise<Record<string, unknown>[]> {
  return (await ipcCalls())
    .filter((call) => call.command === "copy_linked_plot")
    .map((call) => call.args);
}

/**
 * What the application can actually be scrolled to.
 *
 * `scrollIntoView` is deliberately not used: it drives the browser rather than
 * the product, and would report a control reachable that no user could reach.
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

describe("the linked chromatogram and spectrum figure, rendered", () => {
  it("offers three linked actions and no linked data document", async () => {
    await openViewer();
    await selectAScan();
    await openLinked();

    for (const label of LINKED_ACTIONS) {
      expect(await control(label).isExisting()).toBe(true);
    }
    // No combined table: a document that interleaved two measurements, or
    // dropped the link to avoid it, would be a file that lies about what it is.
    for (const label of ["Export CSV…", "Export TSV…"]) {
      expect(await control(label).isExisting()).toBe(false);
    }
    // And the range it takes is the run's, not a spectrum's.
    expect(await browser.$(`${PANEL} .figure-export-label`).getText()).toBe("Run range to export");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("sends the pair, the range and the traces on screen", async () => {
    await openViewer();
    await selectAScan();
    await openLinked();

    await press("Export SVG…");

    await browser.waitUntil(async () => (await linkedRequests()).length === 1, {
      timeout: 30_000,
      timeoutMsg: "the linked export never reached the boundary",
    });
    const [request] = await linkedRequests();
    expect(request?.["chromatogramToken"]).toBe("chromatogram-token");
    expect(request?.["spectrumToken"]).toBe("token-0");
    expect(request?.["format"]).toBe("svg");
    expect(request?.["range"]).toEqual({ scope: "full", low: null, high: null });
    // The viewer opens with TIC alone.
    expect(request?.["traces"]).toEqual({ tic: true, bpc: false });
    expect(request?.["settings"]).toEqual({
      widthPx: 1_200,
      heightPx: 640,
      pngDpi: 300,
      theme: "light",
    });
    // Nothing about where the scan sits crosses the boundary. The marker's
    // coordinate is the retained row's, and it travels the other way.
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "chromatogramToken",
      "format",
      "range",
      "settings",
      "spectrumToken",
      "traces",
    ]);

    // And what came back is what is read out, including that coordinate.
    await browser.waitUntil(
      async () => (await linkedStatus()).includes("mscanvas-linked-spectrum-0-full.svg"),
      { timeout: 30_000, timeoutMsg: "the linked export never reported an outcome" },
    );
    expect(await linkedStatus()).toContain(
      `at retention time ${String(SELECTED_RETENTION_TIME)}`,
    );
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("puts the linked figure on the clipboard without choosing a destination", async () => {
    await openViewer();
    await selectAScan();
    await openLinked();

    await press("Copy plot");

    await browser.waitUntil(async () => (await linkedCopies()).length === 1, {
      timeout: 30_000,
      timeoutMsg: "the linked copy never reached the boundary",
    });
    expect(await linkedRequests()).toEqual([]);
    await browser.waitUntil(
      async () => (await linkedStatus()).includes("Copied linked figure"),
      { timeout: 30_000, timeoutMsg: "the linked copy never reported an outcome" },
    );
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says why it is closed before a scan has been selected, and sends nothing", async () => {
    await openViewer();
    await openPlotMenu(CHROMATOGRAM);

    // Refused rather than disabled: it stays in the menu's arrow-key order,
    // with the reason printed inside it and read as its description.
    const item = browser.$(plotMenuItem(LINKED_ITEM));
    expect(await item.getAttribute("aria-disabled")).toBe("true");
    const reason = item.$(".plot-menu-reason");
    expect(await reason.getText()).toBe("Select a scan and wait for its spectrum to load.");
    expect(await item.getAttribute("aria-describedby")).toContain(await reason.getAttribute("id"));

    // Chosen anyway: the menu stays open on it, and nothing opens or crosses
    // the boundary.
    await item.click();
    expect(await item.isDisplayed()).toBe(true);
    expect(await browser.$(PANEL).isExisting()).toBe(false);
    expect(await linkedRequests()).toEqual([]);
    expect(await linkedCopies()).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says the selected scan is outside the current range once the viewer moves away", async () => {
    await openViewer();
    await selectAScan();

    // A wheel that settles is a committed viewport, and this one is centred
    // well away from the first scan. The plot is brought on screen through the
    // product's scroll owner first, so the pointer lands on it.
    const box = await revealThePlot();
    const at = { x: (await pointAt(0.6)).x, y: Math.round(box.top + box.height / 2) };
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
    await browser.waitUntil(
      async () =>
        !(
          await browser.execute(
            () => document.querySelector(".chromatogram-range")?.textContent ?? "",
          )
        ).includes("full range"),
      { timeout: 30_000, timeoutMsg: "the viewport never committed" },
    );

    // The current range is chosen in the chromatogram's dialog, and the run's
    // scope is shared with the linked figure.
    await openFigureDialog(CHROMATOGRAM);
    await chooseScope("Current range");
    await closeFigureDialog();
    await linkedReasonBecomes(
      // M7.3's sentence (en.ts `linkedOutside`, c12f45d; LinkedFigureExport.test.tsx
      // "says the selected scan is outside the current range, and how to fix it").
      "The selected scan is outside the current range. Choose Full run or widen the range to include it.",
      "the menu never said why the linked figure was closed",
    );
    // Said, and still offered: the dialog is where it is repaired.
    expect((await linkedItem()).refused).toBe(false);
    expect(await linkedRequests()).toEqual([]);
    // The chromatogram's own exports are untouched: the range holds scans, just
    // not the selected one.
    await openPlotMenu(CHROMATOGRAM);
    expect(await browser.$(plotMenuItem("Export CSV")).getAttribute("aria-disabled")).toBe(null);

    // Full run is one of the two fixes the sentence offers, chosen in the
    // linked figure's own dialog.
    await browser.$(plotMenuItem(LINKED_ITEM)).click();
    await browser.$(PANEL).waitForDisplayed();
    await chooseScope("Full run");
    await closeFigureDialog();
    await linkedReasonBecomes("", "choosing Full run never reopened the linked figure");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("closes at a height of 259 and opens at 260", async () => {
    await openViewer();
    await selectAScan();
    // The figure settings are the workspace's, shared by every dialog. By id
    // suffix: the dialog's ids come from `useId`.
    const height = `${PANEL} input[id$="-heightPx"]`;

    await openFigureDialog(CHROMATOGRAM);
    await browser.$(height).setValue("259");
    // One panel still fits, so the chromatogram's own figure is untouched.
    await browser.waitUntil(() => offered("Export SVG…"), {
      timeout: 30_000,
      timeoutMsg: "259 closed the chromatogram's own figure",
    });
    await closeFigureDialog();
    await linkedReasonBecomes(
      "A two-panel linked figure needs a height of at least 260.",
      "259 never closed the linked figure",
    );

    await openFigureDialog(CHROMATOGRAM);
    await browser.$(height).setValue("260");
    await closeFigureDialog();
    await linkedReasonBecomes("", "260 never reopened the linked figure");

    await openLinked();
    await press("Export SVG…");
    await browser.waitUntil(async () => (await linkedRequests()).length === 1, {
      timeout: 30_000,
      timeoutMsg: "the linked export never reached the boundary",
    });
    expect((await linkedRequests())[0]?.["settings"]).toEqual({
      widthPx: 1_200,
      heightPx: 260,
      pngDpi: 300,
      theme: "light",
    });
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const viewport of [
    { name: "1366x768", width: 1_366, height: 768 },
    { name: "960x640", width: 960, height: 640 },
    { name: "1920x1080", width: 1_920, height: 1_080 },
  ] as const) {
    it(`brings every export action, old and linked, within reach at ${viewport.name}`, async () => {
      /*
       * The question M4.3.1's Round 2 answered for five controls, asked again
       * for eight: the chromatogram's own dialog, then the ⋯ menu's way into
       * the linked figure and that dialog's actions. A control only reachable
       * by driving the browser is a control no user can operate.
       *
       * Reachability rather than position: the whole rectangle inside
       * everything that clips, and `elementFromPoint` landing on the control.
       * Getting there uses the dialog's own scroll owner.
       */
      await openViewer({ width: viewport.width, height: viewport.height });
      await selectAScan();

      await openFigureDialog(CHROMATOGRAM);
      for (const label of EXPORT_ACTIONS) {
        const reach = await bringIntoView(label);
        expect(reach.found).toBe(true);
        expect(reach.clippedBy).toEqual([]);
        expect(reach.inViewport).toBe(true);
        expect(reach.hitTestReachesIt).toBe(true);
      }
      await closeFigureDialog();

      await openLinked();
      for (const label of LINKED_ACTIONS) {
        const reach = await bringIntoView(label);
        expect(reach.found).toBe(true);
        expect(reach.clippedBy).toEqual([]);
        expect(reach.inViewport).toBe(true);
        expect(reach.hitTestReachesIt).toBe(true);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`dispatches the operation a real click asks for at ${viewport.name}`, async () => {
      // Reachable is not the same claim as operable. This brings the control
      // within reach the way a user would, clicks the control the hit test says
      // is there, and proves the command it names is what crossed the boundary.
      await openViewer({ width: viewport.width, height: viewport.height });
      await selectAScan();
      await openLinked();

      await browser.waitUntil(() => offered("Copy plot"), { timeout: 30_000 });
      const reach = await bringIntoView("Copy plot");
      expect(reach.hitTestReachesIt).toBe(true);
      await control("Copy plot").click();
      await browser.waitUntil(async () => (await linkedCopies()).length === 1, {
        timeout: 30_000,
        timeoutMsg: "a real click on the linked copy dispatched nothing",
      });

      await browser.waitUntil(() => offered("Export SVG…"), { timeout: 30_000 });
      const svg = await bringIntoView("Export SVG…");
      expect(svg.hitTestReachesIt).toBe(true);
      await control("Export SVG…").click();
      await browser.waitUntil(async () => (await linkedRequests()).length === 1, {
        timeout: 30_000,
        timeoutMsg: "a real click on the linked export dispatched nothing",
      });
      expect((await linkedRequests())[0]?.["format"]).toBe("svg");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`keeps the chromatogram itself reachable and operable at ${viewport.name}`, async () => {
      /*
       * What the linked figure costs the plot it is drawn from. The dialog is
       * modal, so the claim worth making is that once it returns to the viewer
       * the plot is still reachable through the product's own scroll owner and
       * still *works* -- the viewport a current-range linked export would
       * carry can still be chosen.
       */
      await openViewer({ width: viewport.width, height: viewport.height });
      await selectAScan();
      await openLinked();
      await closeFigureDialog();

      const box = await revealThePlot();
      // What has to be non-empty is the part actually painted on screen.
      expect(box.height).toBeGreaterThan(40);
      expect(box.width).toBeGreaterThan(40);

      const centre = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      const hitTestReachesIt = await browser.execute(
        (css: string, x: number, y: number) => {
          const plot = document.querySelector(css);
          const found = document.elementFromPoint(x, y);
          return plot !== null && found !== null && (found === plot || plot.contains(found));
        },
        PLOT,
        centre.x,
        centre.y,
      );
      expect(hitTestReachesIt).toBe(true);

      // Reachable is not the same claim as operable: a real wheel over it still
      // narrows the range.
      const before = await browser.execute(
        () => document.querySelector(".chromatogram-range")?.textContent ?? "",
      );
      const at = { x: (await pointAt(0.5)).x, y: centre.y };
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelector(".chromatogram-range")?.textContent ?? "",
          )) !== before,
        { timeout: 30_000, timeoutMsg: "the plot did not respond to a wheel over it" },
      );
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`keeps the three views where they were, and apart, with the linked figure open at ${viewport.name}`, async () => {
      // The surface must not buy its room by moving the views beneath it. Each
      // panel keeps its own band, and keeps it while the dialog is open: in the
      // rebuild's order, the chromatogram across the top, then the scan list
      // beside the spectrum it selects (spec 3.1).
      await openViewer({ width: viewport.width, height: viewport.height });
      await selectAScan();
      await scrollTo(EVIDENCE, 0);
      const closed = await viewerPanels();
      await openLinked();
      expect(await viewerPanels()).toEqual(closed);

      expect(closed.chromatogram.bottom).toBeLessThanOrEqual(
        Math.min(closed.table.top, closed.spectrum.top) + 1,
      );
      expect(closed.table.right).toBeLessThanOrEqual(closed.spectrum.left + 1);

      // And the plot itself did not pay for the surface by disappearing.
      const box = await boxOf(PLOT);
      expect(box.height).toBeGreaterThan(40);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
