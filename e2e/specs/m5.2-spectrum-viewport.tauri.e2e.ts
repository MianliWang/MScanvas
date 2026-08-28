/**
 * The m/z viewport against the real Rust process.
 *
 * The browser suite beside this one drives every state of the visible adapter,
 * and every answer it gets comes from a table this repository wrote. That is the
 * right way to exercise an interface and the wrong way to establish what the
 * boundary does -- a fixture cannot refuse a window, cannot reduce a drawing,
 * and cannot fail to hold a token.
 *
 * So `project_selected_spectrum` is left **real** here. What is asserted is what
 * only the real command can answer:
 *
 * - a committed window reaches the production boundary and comes back drawn;
 * - a window the retained spectrum does not have is **refused rather than
 *   clamped**, which is the property M4.3's range established and this one
 *   inherits;
 * - a token this session no longer holds is refused as stale;
 * - moving a viewport launches no process and re-reads no acquisition;
 * - a drag asks for nothing until it settles;
 * - and the full-source export still sends a token and a format and no range,
 *   which is what "the screen never becomes the science" looks like from here.
 *
 * **One honest limitation, stated rather than worked around.** The panel's own
 * payload is still answered from the table, because reading a spectrum for real
 * needs a ProteoWizard installation and an mzML file that this run does not
 * have. So the `viewportDomain` *field* is the fixture's, not Rust's -- but it
 * is set to the range Rust's seeded snapshot really spans, and every assertion
 * below is about what the real command does with the window that produces.
 * Whether Rust computes that domain correctly from a retained spectrum is the
 * Rust suite's question, and it is answered there.
 */

import {
  SEEDED_MZ_HIGH,
  SEEDED_MZ_LOW,
  SEEDED_TOKEN,
  ipcCalls,
  loadWith,
  selectFirstSpectrum,
  tauriTable,
} from "../support/tauriPanel";
import { spectrumWithPeaks } from "../support/fixtures";

const PLOT = "svg.spectrum-plot";
const SURFACE = "div.spectrum-viewport-plot";
const RANGE = "#spectrum-viewport-range";
const STATUS = "#spectrum-viewport-status";
const CAPTION = "figcaption.spectrum-caption";

/** How many points the seeded snapshot carries, and therefore may draw. */
const SEEDED_POINTS = 64;

/** The command this suite leaves real, and the one it counts. */
const PROJECT = "project_selected_spectrum";

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

async function plotBox(): Promise<Box> {
  return browser.execute((css: string) => {
    const rect = document.querySelector(css)?.getBoundingClientRect();
    return rect === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, PLOT) as Promise<Box>;
}

/** Scrolls the application's own owners until the plot is genuinely on screen. */
async function revealThePlot(): Promise<Box> {
  await browser.execute((css: string) => {
    const plot = document.querySelector(css);
    if (plot === null) {
      return;
    }
    for (
      let node: HTMLElement | null = (plot as HTMLElement).parentElement;
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
        plot.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
      node.scrollTop = Math.max(0, offset - node.clientHeight / 2);
    }
  }, PLOT);
  return plotBox();
}

/** Every window the real boundary has been asked for, in order. */
async function projectionRequests(): Promise<{ low: number; high: number; exportToken: string }[]> {
  const calls = await ipcCalls();
  return calls
    .filter((call) => call.command === PROJECT)
    .map((call) => ({
      low: Number(call.args["low"]),
      high: Number(call.args["high"]),
      exportToken: String(call.args["exportToken"]),
    }));
}

/** Every read of the acquisition, which no viewport interaction may cause. */
async function acquisitionReads(): Promise<string[]> {
  const calls = await ipcCalls();
  return calls
    .map((call) => call.command)
    .filter((command) => command === "load_selected_spectrum" || command === "open_mzml_preview");
}

async function rangeCaption(): Promise<string> {
  return (await browser.$(RANGE).getText()).trim();
}

async function statusText(): Promise<string> {
  return (await browser.$(STATUS).getText()).trim();
}

async function drawingCaption(): Promise<string> {
  return (await browser.$(CAPTION).getText()).trim();
}

/** Waits until a drawing that answers the committed window is on screen. */
async function waitForADrawing(): Promise<void> {
  await browser.waitUntil(async () => (await drawingCaption()).startsWith("Drawn as"), {
    timeout: 30_000,
    timeoutMsg: "the real projection never produced a drawing",
  });
}

async function pressButton(name: string): Promise<void> {
  await browser.execute((label: string) => {
    const node = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (node === undefined) {
      throw new Error(`no button labelled ${label}`);
    }
    (node as HTMLButtonElement).click();
  }, name);
}

describe("the m/z viewport against the real projection boundary", () => {
  describe("a spectrum whose domain the retained snapshot really has", () => {
    beforeEach(async () => {
      // The projection is deleted from the table, so it falls through to Rust.
      await loadWith(tauriTable({ real: [PROJECT] }));
      await selectFirstSpectrum();
      await revealThePlot();
    });

    it("opens at the whole admitted domain and draws what Rust answered", async () => {
      await waitForADrawing();

      expect(await rangeCaption()).toBe(
        `Showing m/z ${SEEDED_MZ_LOW.toFixed(4)} to ${SEEDED_MZ_HIGH.toFixed(4)} (full range)`,
      );
      // The number of observations is Rust's count over the retained snapshot,
      // and it is not the length of anything this document received: the panel's
      // own arrays are the fixture's six points.
      expect(await drawingCaption()).toContain(
        `of the ${String(SEEDED_POINTS)} observations this spectrum has between m/z ${SEEDED_MZ_LOW.toFixed(4)} and ${SEEDED_MZ_HIGH.toFixed(4)}`,
      );
      expect(spectrumWithPeaks().mz).toHaveLength(6);

      const requests = await projectionRequests();
      expect(requests).toEqual([
        { low: SEEDED_MZ_LOW, high: SEEDED_MZ_HIGH, exportToken: SEEDED_TOKEN },
      ]);
      // Nothing is drawn from a claim that failed, so the status is silent.
      expect(await statusText()).toBe("");
    });

    it("draws real sticks, one node, from the retained source", async () => {
      await waitForADrawing();

      const drawn = await browser.execute((css: string) => {
        const svg = document.querySelector(css);
        const path = svg?.querySelector("path.spectrum-sticks");
        return {
          paths: svg?.querySelectorAll("path.spectrum-sticks").length ?? 0,
          commands: (path?.getAttribute("d") ?? "").split("M").length - 1,
        };
      }, PLOT);

      // One node for the whole drawing, and one stick per retained observation:
      // 64 points fit the 1,800-point bound, so the projection is exact.
      expect(drawn.paths).toBe(1);
      expect(drawn.commands).toBe(SEEDED_POINTS);
    });

    it("asks the real boundary once for a committed window, and reads nothing else", async () => {
      await waitForADrawing();
      const before = (await projectionRequests()).length;
      const readsBefore = (await acquisitionReads()).length;

      await pressButton("Zoom in m/z");
      await waitForADrawing();

      const requests = await projectionRequests();
      expect(requests).toHaveLength(before + 1);
      const asked = requests[requests.length - 1];
      // Inside the source, because the viewport's own clamping keeps it there.
      expect(asked?.low).toBeGreaterThanOrEqual(SEEDED_MZ_LOW);
      expect(asked?.high).toBeLessThanOrEqual(SEEDED_MZ_HIGH);
      expect(asked?.exportToken).toBe(SEEDED_TOKEN);
      // A viewport is not an acquisition. Nothing was re-read and no process
      // was launched to answer it.
      expect(await acquisitionReads()).toHaveLength(readsBefore);
      expect(await rangeCaption()).not.toContain("full range");
    });

    it("asks for nothing while a drag is in flight, and once when it settles", async () => {
      await waitForADrawing();
      // Away from full range first, so a pan has somewhere to go.
      await pressButton("Zoom in m/z");
      await waitForADrawing();
      const before = (await projectionRequests()).length;

      const box = await revealThePlot();
      const y = Math.round(box.top + box.height / 2);
      const from = Math.round(box.left + box.width * 0.6);
      const beforeThePress = await rangeCaption();

      // Left down, moved in two stages, and deliberately not released: what is
      // being asserted is what happens *during* a gesture.
      await browser
        .action("pointer")
        .move({ x: from, y })
        .down()
        .move({ duration: 60, x: from - 40, y })
        .move({ duration: 60, x: from - 80, y })
        .perform(true);

      expect(await projectionRequests()).toHaveLength(before);
      // And the range on screen has moved, so this is a real pan rather than a
      // gesture that did nothing. Compared with the range before the press:
      // `#spectrum-viewport-range` always renders *something* for a selected
      // spectrum, so asserting it is non-empty would assert nothing at all.
      const during = await rangeCaption();
      expect(during).not.toBe(beforeThePress);

      await browser.action("pointer").up().perform();
      await browser.waitUntil(
        async () => (await projectionRequests()).length === before + 1,
        {
          timeout: 30_000,
          timeoutMsg: "the settled pan never asked for its drawing",
        },
      );
      await waitForADrawing();
    });

    it("keeps the full-source export a token and a format, with no range", async () => {
      await waitForADrawing();
      await pressButton("Zoom in m/z");
      await waitForADrawing();

      await browser.execute(() => {
        const node = [...document.querySelectorAll("button")].find(
          (candidate) => candidate.textContent?.trim() === "Export CSV…",
        );
        (node as HTMLButtonElement | undefined)?.click();
      });
      await browser.waitUntil(
        async () =>
          (await ipcCalls()).some((call) => call.command === "begin_selected_spectrum_export"),
        { timeout: 30_000, timeoutMsg: "the export never reached the boundary" },
      );

      const begun = (await ipcCalls()).find(
        (call) => call.command === "begin_selected_spectrum_export",
      );
      // A committed viewport changed nothing about what an export asks for.
      // There is no range in this payload, and M5.3 is where one would appear.
      expect(Object.keys(begun?.args ?? {}).sort()).toEqual(["exportToken", "format", "settings"]);
      expect(begun?.args["exportToken"]).toBe(SEEDED_TOKEN);
    });
  });

  describe("a window the retained spectrum does not have", () => {
    it("is refused rather than clamped, and says so without offering a retry", async () => {
      // Told it spans further than the snapshot really does, which is the only
      // way the frontend's own clamping will ever produce an outside window.
      await loadWith(
        tauriTable({
          real: [PROJECT],
          viewportDomain: { state: "admitted", low: SEEDED_MZ_LOW, high: 2_000 },
        }),
      );
      await selectFirstSpectrum();
      await revealThePlot();

      await browser.waitUntil(async () => (await statusText()).length > 0, {
        timeout: 30_000,
        timeoutMsg: "the refused window never reported anything",
      });

      // Rust's own sentence, not one this side invented for it.
      expect(await statusText()).toContain("not one this spectrum has");
      // The committed window is kept: the axis still says what was asked for.
      expect(await rangeCaption()).toBe(
        `Showing m/z ${SEEDED_MZ_LOW.toFixed(4)} to ${(2_000).toFixed(4)} (full range)`,
      );
      // Nothing is drawn beneath it, and no retry is offered for a refusal that
      // asking again cannot change.
      expect(await drawingCaption()).toContain("Nothing is drawn here yet");
      expect(
        await browser.execute(() =>
          [...document.querySelectorAll("button")].some(
            (candidate) => candidate.textContent?.trim() === "Draw this m/z range again",
          ),
        ),
      ).toBe(false);
    });
  });

  describe("a token this session no longer holds", () => {
    it("is refused as stale, and that one is worth trying again", async () => {
      await loadWith(
        tauriTable({
          real: [PROJECT],
          extra: {
            load_selected_spectrum: {
              outcome: "spectrum",
              spectrum: {
                ...spectrumWithPeaks(),
                // A token Rust never issued. Forged rather than expired, which
                // reaches the same refusal by the only route a test can take.
                exportToken: "999999",
                viewportDomain: {
                  state: "admitted",
                  low: SEEDED_MZ_LOW,
                  high: SEEDED_MZ_HIGH,
                },
              },
            },
          },
        }),
      );
      await selectFirstSpectrum();
      await revealThePlot();

      await browser.waitUntil(async () => (await statusText()).length > 0, {
        timeout: 30_000,
        timeoutMsg: "the stale token never reported anything",
      });

      expect(await statusText()).toContain("no longer the one MSCanvas has loaded");
      // Retryable, so the recovery is offered. The window is untouched.
      expect(
        await browser.execute(() =>
          [...document.querySelectorAll("button")].some(
            (candidate) => candidate.textContent?.trim() === "Draw this m/z range again",
          ),
        ),
      ).toBe(true);
      expect(await drawingCaption()).toContain("Nothing is drawn here yet");
    });
  });

  describe("a spectrum the figure contract cannot give a domain", () => {
    it("claims no wheel, offers no action, and asks Rust for nothing", async () => {
      await loadWith(
        tauriTable({
          real: [PROJECT],
          extra: {
            load_selected_spectrum: {
              outcome: "spectrum",
              spectrum: {
                ...spectrumWithPeaks(),
                exportToken: SEEDED_TOKEN,
                viewportDomain: { state: "refused", reason: "sourceNotOrdered" },
              },
            },
          },
        }),
      );
      await selectFirstSpectrum();
      await revealThePlot();

      expect(await statusText()).toContain("cannot be navigated");
      // The spectrum is still there, drawn from the points this document holds.
      expect(await drawingCaption()).toContain("Drawn as");
      expect(await rangeCaption()).toBe("No m/z range to navigate.");

      const claimed = await browser.execute((css: string) => {
        const node = document.querySelector(css);
        if (node === null) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          deltaY: -240,
        });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, PLOT);
      // A refused viewport owns no wheel: the page keeps it.
      expect(claimed).toBe(false);

      const disabled = await browser.execute(() =>
        ["Zoom in m/z", "Zoom out m/z", "Reset m/z range"].map((label) => {
          const node = [...document.querySelectorAll("button")].find(
            (candidate) => candidate.textContent?.trim() === label,
          );
          return node === undefined ? "missing" : (node as HTMLButtonElement).disabled;
        }),
      );
      expect(disabled).toEqual([true, true, true]);

      // And nothing was asked of the projection boundary at all.
      expect(await projectionRequests()).toEqual([]);
    });
  });

  describe("what a viewport never does", () => {
    it("runs no backend operation for a wheel, a drag or a button", async () => {
      await loadWith(tauriTable({ real: [PROJECT] }));
      await selectFirstSpectrum();
      const box = await revealThePlot();
      await waitForADrawing();

      const before = await ipcCalls();
      const y = Math.round(box.top + box.height / 2);
      const at = Math.round(box.left + box.width / 2);

      await browser.action("wheel").scroll({ x: at, y, deltaY: -240 }).perform();
      await browser
        .action("pointer")
        .move({ x: at, y })
        .down()
        .move({ duration: 60, x: at - 60, y })
        .up()
        .perform();
      await pressButton("Reset m/z range");
      await waitForADrawing();

      const after = await ipcCalls();
      const added = after.slice(before.length).map((call) => call.command);
      // Every command a viewport interaction produced, and there is exactly one
      // kind of it. No conversion, no backend probe, and above all no read of
      // the acquisition: ProteoWizard is not what a zoom is for.
      expect([...new Set(added)]).toEqual([PROJECT]);
    });
  });
});
