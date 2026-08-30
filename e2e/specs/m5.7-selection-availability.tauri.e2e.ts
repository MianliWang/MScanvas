/**
 * M5.7 in the real WebView — a blocked selection, in the shipped shell.
 *
 * The browser suite beside this one drives every state of the posture and
 * measures it at three windows. What only the compiled application can answer is
 * whether the same thing happens in WebView2: whether the explanation appears
 * and is announced there, whether the two committing surfaces really send
 * nothing across the **real** IPC boundary while it stands, and whether the run
 * stays inspectable rather than being taken away with the action.
 *
 * The backend verdict is answered from the table, because a real one needs a
 * ProteoWizard installation this run does not have. Everything the assertions
 * are actually about — what the shipped bundle does with that verdict, and what
 * reaches the boundary afterwards — is real.
 */

import { ipcCalls, loadWith, selectFirstSpectrum, tauriTable } from "../support/tauriPanel";
import {
  availableBackend,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";

const PLOT = "svg.chromatogram-svg";
const GRID = "div.spectrum-table";
const FIRST_ROW = 'div.spectrum-table-row[data-row-position="0"]';
const NOTICE = "#viewer-selection-availability";
const REGION = '[data-live-region="spectrum-selection-availability"]';

const BACKEND_REASON =
  "Selecting a scan needs ProteoWizard, and this session has no usable backend. " +
  "See the backend status above.";

/** How many times this document has asked the backend to read a spectrum. */
function reads(calls: readonly { readonly command: string }[]): number {
  return calls.filter((call) => call.command === "load_selected_spectrum").length;
}

async function noticeText(): Promise<string | null> {
  return browser.execute((selector: string) => {
    const found = document.querySelector(selector);
    return found === null ? null : (found.textContent ?? "");
  }, NOTICE) as Promise<string | null>;
}

async function attributeOf(selector: string, name: string): Promise<string | null> {
  return browser.execute(
    (target: string, attribute: string) =>
      document.querySelector(target)?.getAttribute(attribute) ?? null,
    selector,
    name,
  ) as Promise<string | null>;
}

/**
 * Answers the next backend check differently, then asks for one.
 *
 * The live answer table is a window property in the compiled shell's QA
 * boundary, so this replaces one entry and presses the control a reader would
 * press. Nothing about the interface is reached past.
 */
async function recheckTheBackend(verdict: unknown): Promise<void> {
  await browser.execute((answer: unknown) => {
    const target = window as unknown as Record<string, Record<string, unknown>>;
    const table = target["__mscanvasIpcTable__"];
    if (table !== undefined) {
      table["inspect_backend"] = { kind: "resolve", value: answer };
    }
  }, verdict);
  const buttons = await browser.$$("button.link-button");
  for (const button of buttons) {
    if ((await button.getText()).trim() === "Check again") {
      await button.click();
      return;
    }
  }
  throw new Error("the backend banner offers no Check again");
}

describe("M5.7 — selection availability in the real shell", () => {
  beforeEach(async () => {
    await loadWith(tauriTable());
    await selectFirstSpectrum();
  });

  it("says nothing while a scan can be selected, from a region that already exists", async () => {
    expect(await browser.$(REGION).isExisting()).toBe(true);
    expect(await noticeText()).toBe(null);
    expect(await attributeOf(GRID, "aria-describedby")).toBe(null);
    expect(await attributeOf(PLOT, "aria-describedby")).toBe("chromatogram-readout");
  });

  it("explains a closed lane once, and sends nothing from either surface", async () => {
    await recheckTheBackend(unavailableBackend);
    await browser.waitUntil(async () => (await noticeText()) === BACKEND_REASON, {
      timeout: 60_000,
      timeoutMsg: "the shell never said why selection was unavailable",
    });

    // One occurrence, and both surfaces point at it.
    expect(
      await browser.execute(
        (reason: string) => (document.body.textContent ?? "").split(reason).length - 1,
        BACKEND_REASON,
      ),
    ).toBe(1);
    expect(await attributeOf(GRID, "aria-describedby")).toBe("viewer-selection-availability");
    expect(await attributeOf(PLOT, "aria-describedby")).toBe(
      "chromatogram-readout viewer-selection-availability",
    );
    expect(await attributeOf(NOTICE, "aria-live")).toBe("polite");

    // Nothing crosses the real boundary from either surface.
    const before = reads(await ipcCalls());
    await browser.$(FIRST_ROW).click();
    await browser.execute((selector: string) => {
      (document.querySelector(selector) as HTMLElement | null)?.focus();
    }, FIRST_ROW);
    await browser.keys("Enter");
    await browser.keys(" ");
    expect(reads(await ipcCalls())).toBe(before);
  });

  it("keeps the run readable while the lane is closed", async () => {
    await recheckTheBackend(unavailableBackend);
    await browser.waitUntil(async () => (await noticeText()) === BACKEND_REASON, {
      timeout: 60_000,
      timeoutMsg: "the shell never said why selection was unavailable",
    });

    // Neither surface is disabled, and the plot is not inert.
    expect(await attributeOf(GRID, "aria-disabled")).toBe(null);
    expect(await attributeOf(PLOT, "aria-disabled")).toBe(null);
    expect(
      await browser.execute(
        (selector: string) =>
          window.getComputedStyle(document.querySelector(selector) as Element).pointerEvents,
        PLOT,
      ),
    ).not.toBe("none");

    // The arrow keys still walk the table, and cost the backend nothing.
    const before = reads(await ipcCalls());
    await browser.execute((selector: string) => {
      (document.querySelector(selector) as HTMLElement | null)?.focus();
    }, FIRST_ROW);
    await browser.keys("ArrowDown");
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute("data-row-position") ?? null,
      ),
    ).toBe("1");
    expect(reads(await ipcCalls())).toBe(before);
  });

  it("commits again as soon as the lane clears", async () => {
    await recheckTheBackend(unavailableBackend);
    await browser.waitUntil(async () => (await noticeText()) === BACKEND_REASON, {
      timeout: 60_000,
      timeoutMsg: "the shell never said why selection was unavailable",
    });
    await recheckTheBackend(availableBackend);
    await browser.waitUntil(async () => (await noticeText()) === null, {
      timeout: 60_000,
      timeoutMsg: "the shell never stopped saying selection was unavailable",
    });

    expect(await attributeOf(GRID, "aria-describedby")).toBe(null);
    const before = reads(await ipcCalls());
    await browser.$('div.spectrum-table-row[data-row-position="1"]').click();
    await browser.waitUntil(async () => reads(await ipcCalls()) > before, {
      timeout: 60_000,
      timeoutMsg: "the table never committed a scan after the lane cleared",
    });
  });
});
