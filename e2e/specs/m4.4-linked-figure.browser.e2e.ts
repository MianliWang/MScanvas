/**
 * M4.4 rendered QA — the linked chromatogram + spectrum surface.
 *
 * The unit suite pins the pair, the range matrix and the two-panel geometry.
 * What only a browser can answer is whether the third set of controls is
 * *reachable* once it is added to a surface whose layout was already measured to
 * the pixel, and whether what the shipped bundle sends across the boundary is
 * the pair on screen with the range and the traces the user chose.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * about which command was called with which argument is a claim about the
 * shipped frontend.
 */

import { ALLOWED_CONSOLE_SUBSTRINGS, boxOf, consoleEntries, ipcCalls } from "../support/harness";
import { SELECTED_RETENTION_TIME } from "../support/fixtures";
import { CHROMATOGRAM, PLOT, openTheViewer, pointAt, revealThePlot } from "../support/viewer";

/** Enough scans that a range can hold some of them and not others. */
const SCANS = 200;

const TOGGLE = "button#chromatogram-export-toggle";
const PANEL = "#chromatogram-export-panel";
const LINKED = "#chromatogram-linked-section";
const REASON = "#chromatogram-linked-unavailable";
const FIRST_ROW = 'div.spectrum-table-row[data-row-position="0"]';

/** Every action the linked section offers. */
const LINKED_ACTIONS = [
  "Export linked SVG…",
  "Export linked PNG…",
  "Copy linked plot",
] as const;

/** Every action the surface offered before this milestone. */
const EXPORT_ACTIONS = [
  "Export SVG…",
  "Export PNG…",
  "Copy plot",
  "Export CSV…",
  "Export TSV…",
] as const;

/** Everything the open surface has to keep within reach, all of it at once. */
const EVERY_ACTION = [...EXPORT_ACTIONS, ...LINKED_ACTIONS] as const;

/** The viewer column, which is one of the two scroll owners in play. */
const VIEWER_STACK = ".viewer-stack";

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

/** Reads one spectrum, so there is a pair to link. */
async function selectAScan(): Promise<void> {
  await browser.$(FIRST_ROW).click();
  await browser.$("section.spectrum-panel").$("button=Copy plot").waitForDisplayed({
    timeout: 30_000,
  });
}

/**
 * One of the linked section's controls, found by its own text.
 *
 * Chained rather than written as one selector string: WebdriverIO's text
 * pseudo-selector is not CSS and cannot be combined with a CSS prefix, and the
 * driver refuses the whole thing rather than the half it does not understand.
 */
function linked(label: string) {
  return browser.$(LINKED).$(`button=${label}`);
}

function control(label: string) {
  return browser.$(PANEL).$(`button=${label}`);
}

/** Why the linked actions are closed, read from the document. */
async function linkedReason(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    REASON,
  );
}

/**
 * What the linked section's live region says.
 *
 * Read from the document rather than through `getText`, which answers only for
 * text inside the viewport: this section sits at the bottom of a surface that
 * scrolls, so it is routinely present, correct and below the fold.
 */
async function linkedStatus(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${LINKED} [role="status"]`,
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
 * Scrolls the viewer until one control is genuinely reachable.
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
    return { top: rect.top, bottom: rect.bottom };
  }, selector);
}

describe("the linked chromatogram and spectrum figure, rendered", () => {
  it("offers three linked actions and no linked data document", async () => {
    await openTheViewer({ scans: SCANS });
    await selectAScan();
    await openExport();

    for (const label of LINKED_ACTIONS) {
      expect(await linked(label).isExisting()).toBe(true);
    }
    // No combined table: a document that interleaved two measurements, or
    // dropped the link to avoid it, would be a file that lies about what it is.
    for (const label of ["Export CSV…", "Export TSV…"]) {
      expect(await browser.$(LINKED).$(`button=${label}`).isExisting()).toBe(false);
    }
    expect(await browser.$(LINKED).$("legend").getText()).toBe("Linked chromatogram + spectrum");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("sends the pair, the range and the traces on screen", async () => {
    await openTheViewer({ scans: SCANS });
    await selectAScan();
    await openExport();

    await linked("Export linked SVG…").click();

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
    await openTheViewer({ scans: SCANS });
    await selectAScan();
    await openExport();

    await linked("Copy linked plot").click();

    await browser.waitUntil(async () => (await linkedCopies()).length === 1, {
      timeout: 30_000,
      timeoutMsg: "the linked copy never reached the boundary",
    });
    expect(await linkedRequests()).toEqual([]);
    await browser.waitUntil(
      async () => (await linkedStatus()).includes("Copied the linked figure"),
      { timeout: 30_000, timeoutMsg: "the linked copy never reported an outcome" },
    );
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says why it is closed before a scan has been selected, and sends nothing", async () => {
    await openTheViewer({ scans: SCANS });
    await openExport();

    expect(await linkedReason()).toBe("Select a scan and wait for its spectrum to load.");
    for (const label of LINKED_ACTIONS) {
      expect(await linked(label).isEnabled()).toBe(false);
      // Pressed anyway: `disabled` is an affordance, and what matters is that
      // nothing crossed the boundary.
      await browser.execute((text: string) => {
        Array.from(document.querySelectorAll("button"))
          .filter((node) => (node.textContent ?? "").trim() === text)
          .forEach((node) => {
            (node as HTMLButtonElement).click();
          });
      }, label);
    }
    expect(await linkedRequests()).toEqual([]);
    expect(await linkedCopies()).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says the selected scan is outside the current range once the viewer moves away", async () => {
    await openTheViewer({ scans: SCANS });
    await selectAScan();

    // A wheel that settles is a committed viewport, and this one is centred
    // well away from the first scan.
    const at = await pointAt(0.6);
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

    await openExport();
    await browser.$(PANEL).$("label*=Current range").click();
    await browser.waitUntil(async () => (await linkedReason()).length > 0, {
      timeout: 30_000,
      timeoutMsg: "the linked section never said why it was closed",
    });

    expect(await linkedReason()).toBe(
      "The selected scan is outside the current chromatogram range. Choose Full run or move " +
        "the current range to include the selected scan.",
    );
    expect(await linkedRequests()).toEqual([]);
    // The chromatogram's own exports are untouched: the range holds scans, just
    // not the selected one.
    expect(await control("Export CSV…").isEnabled()).toBe(true);

    // Full run is one of the two fixes the sentence offers.
    await browser.$(PANEL).$("label*=Full run").click();
    await browser.waitUntil(async () => (await linkedReason()).length === 0, {
      timeout: 30_000,
      timeoutMsg: "choosing Full run never reopened the linked actions",
    });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("closes at a height of 259 and opens at 260", async () => {
    await openTheViewer({ scans: SCANS });
    await selectAScan();
    await openExport();
    const height = browser.$(PANEL).$("label*=Height").$("input");

    await height.setValue("259");
    await browser.waitUntil(async () => (await linkedReason()).length > 0, {
      timeout: 30_000,
      timeoutMsg: "259 never closed the linked actions",
    });
    expect(await linkedReason()).toBe(
      "A two-panel linked figure needs a height of at least 260.",
    );
    // One panel still fits, so the chromatogram's own figure is untouched.
    expect(await control("Export SVG…").isEnabled()).toBe(true);

    await height.setValue("260");
    await browser.waitUntil(async () => (await linkedReason()).length === 0, {
      timeout: 30_000,
      timeoutMsg: "260 never reopened the linked actions",
    });
    await linked("Export linked SVG…").click();
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
       * for eight. The linked section makes the open surface taller, and a
       * surface whose new controls are only reachable by driving the browser is
       * a surface no user can operate.
       *
       * Reachability rather than position: the whole rectangle inside
       * everything that clips, and `elementFromPoint` landing on the control.
       * Getting there uses the application's own scroll owner.
       */
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      await selectAScan();
      const closed = await scrollExtent(CHROMATOGRAM);
      await openExport();

      const opened = await scrollExtent(CHROMATOGRAM);
      expect(opened.extent).toBeGreaterThan(closed.extent);
      expect(opened.extent).toBeGreaterThan(opened.height);

      for (const label of EVERY_ACTION) {
        const reach = await bringIntoView(label);
        expect(reach.found).toBe(true);
        expect(reach.clippedBy).toEqual([]);
        expect(reach.inViewport).toBe(true);
        expect(reach.hitTestReachesIt).toBe(true);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`dispatches the operation a real click asks for at ${viewport.name}`, async () => {
      // Reachable is not the same claim as operable. This scrolls the surface
      // the way a user would, clicks the control the hit test says is there,
      // and proves the command it names is what crossed the boundary.
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      await selectAScan();
      await openExport();

      const reach = await bringIntoView("Copy linked plot");
      expect(reach.hitTestReachesIt).toBe(true);
      await linked("Copy linked plot").click();
      await browser.waitUntil(async () => (await linkedCopies()).length === 1, {
        timeout: 30_000,
        timeoutMsg: "a real click on the linked copy dispatched nothing",
      });

      const svg = await bringIntoView("Export linked SVG…");
      expect(svg.hitTestReachesIt).toBe(true);
      await linked("Export linked SVG…").click();
      await browser.waitUntil(async () => (await linkedRequests()).length === 1, {
        timeout: 30_000,
        timeoutMsg: "a real click on the linked export dispatched nothing",
      });
      expect((await linkedRequests())[0]?.["format"]).toBe("svg");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`keeps the chromatogram itself reachable and operable at ${viewport.name}`, async () => {
      /*
       * What the linked section costs. It makes the open export surface about
       * 96px taller, and the surface already pushes the plot down inside a
       * panel that scrolls -- the trade M4.3 measured and accepted. So the
       * claim worth making is not that the plot stays where it was, which it
       * does not, but that it is still reachable through the product's own
       * scroll owner and still *works* once it is.
       */
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      await selectAScan();
      await openExport();

      const box = await revealThePlot();
      // The plot is legitimately taller than the band its panel gives it, so
      // what has to be non-empty is the part actually painted on screen.
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
      // narrows the range, so the viewport a current-range linked export would
      // carry can still be chosen with the surface open.
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

    it(`keeps the three views apart with the linked section open at ${viewport.name}`, async () => {
      // The surface must not buy its extra room by covering the views beside
      // it. Each panel keeps its own band, and nothing the linked section draws
      // is painted over the scan table below.
      await openTheViewer({ width: viewport.width, height: viewport.height, scans: SCANS });
      await selectAScan();
      await openExport();
      await scrollTo(VIEWER_STACK, 0);

      const chromatogram = await panelBox(CHROMATOGRAM);
      const table = await panelBox("section.spectrum-table-panel");
      const spectrum = await panelBox("section.spectrum-panel");
      expect(chromatogram.bottom).toBeLessThanOrEqual(table.top + 1);
      expect(table.bottom).toBeLessThanOrEqual(spectrum.top + 1);

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
      }, EVERY_ACTION);
      expect(intruding).toEqual([]);

      // And the plot itself did not pay for the surface by disappearing.
      const box = await boxOf(PLOT);
      expect(box.height).toBeGreaterThan(40);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
