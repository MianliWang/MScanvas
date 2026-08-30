/**
 * M5.7 rendered QA — what the viewer says, and keeps doing, when a scan cannot
 * be committed.
 *
 * The unit suites pin the rule, its four reasons and each surface's behaviour in
 * isolation. What only a browser can answer is whether the explanation is
 * reachable and legible at the windows people use, whether it costs the measured
 * three-panel layout anything, and — the claim this slice stands on — whether
 * the shipped bundle really sends nothing across the boundary when a blocked
 * click and a blocked keypress land on the two surfaces that commit a scan.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * below about what did or did not cross the boundary is a claim about the
 * shipped frontend.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  consoleEntries,
  horizontalOverflow,
  ipcCalls,
  setInvokeResult,
} from "../support/harness";
import { ipcTable } from "../support/fixtures";
import {
  availableBackend,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";
import {
  CHROMATOGRAM,
  PLOT,
  SPECTRUM,
  TABLE,
  openTheViewer,
  plotBox,
  pointAt,
  readout,
  selectedRowPosition,
  viewerReads,
  visibleSpan,
} from "../support/viewer";

const VIEWPORTS = [
  { name: "1920x1080", width: 1_920, height: 1_080 },
  { name: "1366x768", width: 1_366, height: 768 },
  { name: "960x640", width: 960, height: 640 },
] as const;

/** The one explanation, and the region that carries it either way. */
const NOTICE = "#viewer-selection-availability";
const REGION = '[data-live-region="spectrum-selection-availability"]';
const VIEWER_COLUMN = ".viewer-column";
const VIEWER_STACK = ".viewer-stack";
const GRID = "div.spectrum-table";
const FIRST_ROW = 'div.spectrum-table-row[data-row-position="0"]';

const BACKEND_REASON =
  "Selecting a scan needs ProteoWizard, and this session has no usable backend. " +
  "See the backend status above.";

/**
 * Closes the lane the way a reader can actually close it here.
 *
 * The backend verdict is one mocked object and one visible control, so this
 * drives the real path -- press `Check again`, get a different answer -- rather
 * than reaching past the interface. The other two blockers are pinned in the
 * unit suites, where each is one lane fact.
 */
async function recheckTheBackend(verdict: unknown): Promise<void> {
  await setInvokeResult("inspect_backend", verdict);
  const buttons = await browser.$$("button.link-button");
  for (const button of buttons) {
    if ((await button.getText()).trim() === "Check again") {
      await button.click();
      return;
    }
  }
  throw new Error("the backend banner offers no Check again");
}

async function noticeText(): Promise<string | null> {
  return browser.execute((selector: string) => {
    const found = document.querySelector(selector);
    return found === null ? null : (found.textContent ?? "");
  }, NOTICE);
}

async function waitForTheNotice(): Promise<void> {
  await browser.waitUntil(async () => (await noticeText()) === BACKEND_REASON, {
    timeout: 30_000,
    timeoutMsg: "the viewer never said why selection was unavailable",
  });
}

async function waitUntilAvailable(): Promise<void> {
  await browser.waitUntil(async () => (await noticeText()) === null, {
    timeout: 30_000,
    timeoutMsg: "the viewer never stopped saying selection was unavailable",
  });
}

async function describedBy(selector: string): Promise<string | null> {
  return browser.execute(
    (target: string) => document.querySelector(target)?.getAttribute("aria-describedby") ?? null,
    selector,
  );
}

async function blockSelection(): Promise<void> {
  await recheckTheBackend(unavailableBackend);
  await waitForTheNotice();
}

async function unblockSelection(): Promise<void> {
  await recheckTheBackend(availableBackend);
  await waitUntilAvailable();
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

describe("M5.7 — selection availability, rendered", () => {
  it("says nothing, and describes nothing, while a scan can be selected", async () => {
    await openTheViewer({ answers: ipcTable() });

    // The region exists before it has anything to say, so it is being watched
    // when the text arrives rather than arriving with it.
    expect(await browser.$(REGION).isExisting()).toBe(true);
    expect(await noticeText()).toBe(null);
    expect(await describedBy(GRID)).toBe(null);
    expect(await describedBy(PLOT)).toBe("chromatogram-readout");
  });

  it("explains a closed lane once, and points both surfaces at that one sentence", async () => {
    await openTheViewer({ answers: ipcTable() });
    await blockSelection();

    expect(await noticeText()).toBe(BACKEND_REASON);
    // Once in the document. Not a visible sentence plus a hidden copy, and not
    // one sentence per surface.
    const occurrences = await browser.execute(
      (reason: string) => (document.body.textContent ?? "").split(reason).length - 1,
      BACKEND_REASON,
    );
    expect(occurrences).toBe(1);
    expect(await browser.$$(NOTICE).length).toBe(1);

    expect(await describedBy(GRID)).toBe("viewer-selection-availability");
    expect(await describedBy(PLOT)).toBe("chromatogram-readout viewer-selection-availability");
    // Announced politely, by the element that was already there.
    expect(
      await browser.execute(
        (selector: string) => document.querySelector(selector)?.getAttribute("aria-live") ?? null,
        NOTICE,
      ),
    ).toBe("polite");
  });

  it("sends nothing across the boundary from either surface while blocked", async () => {
    await openTheViewer({ answers: ipcTable() });
    await blockSelection();
    const before = viewerReads(await ipcCalls());

    // The plot.
    const box = await plotBox();
    const at = await pointAt(0.5);
    await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();

    // The table: a click, and both activations from the keyboard.
    await browser.$(FIRST_ROW).click();
    await browser.execute((selector: string) => {
      (document.querySelector(selector) as HTMLElement | null)?.focus();
    }, FIRST_ROW);
    await browser.keys("Enter");
    await browser.keys(" ");

    expect(box.width).toBeGreaterThan(0);
    expect(viewerReads(await ipcCalls())).toBe(before);
    expect(await selectedRowPosition()).toBe(null);
  });

  it("keeps every backend-free interaction live while blocked", async () => {
    await openTheViewer({ answers: ipcTable() });
    await blockSelection();

    // Neither surface is disabled, and the plot is not made inert.
    expect(
      await browser.execute(
        (selector: string) => document.querySelector(selector)?.getAttribute("aria-disabled"),
        GRID,
      ),
    ).toBe(null);
    expect(
      await browser.execute(
        (selector: string) => window.getComputedStyle(document.querySelector(selector) as Element)
          .pointerEvents,
        PLOT,
      ),
    ).not.toBe("none");

    // Hover still reports a scan.
    const at = await pointAt(0.4);
    await browser.action("pointer").move({ x: at.x, y: at.y }).perform();
    await browser.waitUntil(async () => (await readout()).includes("Hovering"), {
      timeout: 15_000,
      timeoutMsg: "the readout stopped reporting the scan under the pointer",
    });

    // Zoom still moves the axis.
    const span = await visibleSpan();
    await browser.execute((selector: string) => {
      document
        .querySelector(selector)
        ?.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 500, deltaY: -500 }),
        );
    }, PLOT);
    await browser.waitUntil(async () => (await visibleSpan()) < span, {
      timeout: 15_000,
      timeoutMsg: "the wheel stopped zooming while selection was unavailable",
    });

    // And the arrow keys still walk the table without committing anything.
    const before = viewerReads(await ipcCalls());
    await browser.execute((selector: string) => {
      (document.querySelector(selector) as HTMLElement | null)?.focus();
    }, FIRST_ROW);
    await browser.keys("ArrowDown");
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute("data-row-position") ?? null,
      ),
    ).toBe("1");
    expect(viewerReads(await ipcCalls())).toBe(before);
  });

  it("commits again as soon as the lane clears", async () => {
    await openTheViewer({ answers: ipcTable() });
    await blockSelection();
    await unblockSelection();

    expect(await describedBy(GRID)).toBe(null);
    const before = viewerReads(await ipcCalls());
    await browser.$(FIRST_ROW).click();
    await browser.waitUntil(async () => (await selectedRowPosition()) === 0, {
      timeout: 30_000,
      timeoutMsg: "the table never committed a scan after the lane cleared",
    });
    expect(viewerReads(await ipcCalls())).toBeGreaterThan(before);
  });

  for (const viewport of VIEWPORTS) {
    it(`fits the explanation at ${viewport.name} without hiding a control`, async () => {
      await openTheViewer({
        answers: ipcTable(),
        width: viewport.width,
        height: viewport.height,
      });
      const before = await boxOf(VIEWER_COLUMN);
      await blockSelection();

      // The sentence is on screen and inside the column it belongs to.
      const notice = await boxOf(NOTICE);
      expect(notice.height).toBeGreaterThan(0);
      const column = await boxOf(VIEWER_COLUMN);
      expect(Math.abs(column.width - before.width)).toBeLessThan(1);

      // All three panels are still there, and nothing scrolls sideways.
      for (const panel of [CHROMATOGRAM, TABLE, SPECTRUM]) {
        expect(await browser.$(panel).isExisting()).toBe(true);
      }

      // And the stack still fills what the column has left. Presence is not
      // enough: wrapping the stack in a flex column takes away the stretch it
      // had for free as a grid item, and the symptom is a band of nothing under
      // three views that have bunched at the top.
      const stack = await boxOf(VIEWER_STACK);
      expect(Math.abs(stack.bottom - column.bottom)).toBeLessThan(2);
      expect(stack.top).toBeGreaterThanOrEqual(notice.bottom - 1);
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
