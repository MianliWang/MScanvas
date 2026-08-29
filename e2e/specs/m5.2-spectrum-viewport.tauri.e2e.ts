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
 * - and a full-source export still carries no window, which is what "the screen
 *   never becomes the science" looks like from here.
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

/** One cancelable wheel carrying a modifier, and whether the panel took it. */
async function modifiedWheelClaim(
  clientX: number,
  deltaY: number,
  ctrlKey: boolean,
): Promise<boolean> {
  return browser.execute(
    (css: string, x: number, delta: number, held: boolean) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        ctrlKey: held,
        deltaY: delta,
      });
      document.querySelector(css)?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    PLOT,
    clientX,
    deltaY,
    ctrlKey,
  ) as Promise<boolean>;
}

/** One key press carrying modifiers, and whether the panel took it. */
async function modifiedKeyClaim(
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

    it("leaves a full-source export carrying no window", async () => {
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
      // M5.3 added the range this payload now carries, and the point of this
      // case survives it: the scope is `full`, so the committed viewport
      // reached the request as nothing at all.
      expect(Object.keys(begun?.args ?? {}).sort()).toEqual([
        "exportToken",
        "format",
        "range",
        "settings",
      ]);
      expect(begun?.args["range"]).toEqual({ scope: "full", low: null, high: null });
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
      // Nothing is drawn beneath it, and the caption says the range *failed*
      // rather than that its drawing is still on its way -- which for a refusal
      // asking again cannot change would be a sentence that never went away.
      expect(await drawingCaption()).toContain("This range could not be drawn.");
      expect(await drawingCaption()).not.toContain("Waiting for the drawing");
      // And no retry is offered for it.
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
      expect(await drawingCaption()).toContain("This range could not be drawn.");
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

  describe("a viewport that is admitted and cannot move", () => {
    /*
     * The inert case, in the shell that ships.
     *
     * A spectrum whose points all report one m/z has a real domain and a real
     * drawing, so it stays `ready` and must not be described as unnavigable.
     * Every viewport action is nevertheless unavailable, and what is asserted
     * here is that the real WebView2 keyboard order agrees: the drawing is not a
     * tab stop, and attempting to navigate it costs nothing.
     *
     * **The limitation, stated rather than glossed.** This case answers
     * `project_selected_spectrum` from the table instead of leaving it real.
     * Rust's seeded snapshot spans a real range, so asking the production
     * command for a zero-width window outside it would be the *window refusal*
     * test -- which this suite already has, above -- rather than a test of the
     * focus posture. Everything else here is the shipped composition: the real
     * bundle, the real WebView2, the real Tauri IPC boundary and the real
     * keyboard. The claim is about focus and about what is asked of Rust, and
     * both are measured; it is not a claim about the real projection of a
     * zero-width window.
     */
    const ONE_MZ = 301.25;

    it("keeps the drawing out of the real WebView tab order, and asks for nothing", async () => {
      await loadWith(
        tauriTable({
          viewportDomain: { state: "admitted", low: ONE_MZ, high: ONE_MZ },
          extra: {
            project_selected_spectrum: {
              low: ONE_MZ,
              high: ONE_MZ,
              mz: [ONE_MZ, ONE_MZ, ONE_MZ],
              intensity: [10, 90, 30],
              sourcePoints: 3,
              reduced: false,
            },
          },
        }),
      );
      await selectFirstSpectrum();
      await revealThePlot();
      await waitForADrawing();

      // Admitted, not refused: the panel says the range it has.
      expect(await rangeCaption()).toContain("301.2500");
      expect(await statusText()).not.toContain("cannot be navigated");

      // Not a sequential focus target, by the attribute and by the traversal.
      expect(
        await browser.execute(
          (css: string) => document.querySelector(css)?.getAttribute("tabindex"),
          PLOT,
        ),
      ).toBeNull();
      await browser.execute(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        document.body.focus();
      });
      const trail: string[] = [];
      for (let step = 0; step < 20; step += 1) {
        await browser.keys(["Tab"]);
        trail.push(
          await browser.execute(() => {
            const active = document.activeElement;
            return active === null
              ? "none"
              : `${active.tagName.toLowerCase()}.${(active.getAttribute("class") ?? "").trim()}`;
          }),
        );
      }
      expect(trail.some((stop) => stop.includes("spectrum-plot"))).toBe(false);
      expect(trail.some((stop) => stop.startsWith("button"))).toBe(true);

      // And attempted navigation asked for nothing: the one drawing this
      // spectrum's single window needed, and not one more.
      const asked = (await projectionRequests()).length;
      for (const key of ["+", "-", "ArrowLeft", "ArrowRight", "Home"]) {
        await browser.execute(
          (css: string, sent: string) => {
            const plot = document.querySelector<SVGSVGElement>(css);
            plot?.focus();
            plot?.dispatchEvent(
              new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: sent }),
            );
          },
          PLOT,
          key,
        );
      }
      expect(await projectionRequests()).toHaveLength(asked);
      expect(await rangeCaption()).toContain("301.2500");
    });
  });

  describe("input the host owns", () => {
    /*
     * The cross-axis ownership rule, in the shell it is about.
     *
     * WebView2 enables its zoom controls by default and drives them with
     * Ctrl+wheel, Ctrl+Plus and Ctrl+Minus, and this application disables
     * neither -- `tauri.conf.json` sets no zoom or accelerator option and the
     * Rust window setup applies none. So neither plot may claim those inputs,
     * and the chromatogram's own suite asserts the identical thing.
     *
     * **The limitation, stated rather than glossed.** These are dispatched
     * events, and a dispatched event is not a user gesture: no engine performs
     * its native zoom for one, however the listener answers. What is proved is
     * that *MSCanvas does not claim the input*, that the m/z range does not
     * move, and that the real projection boundary is asked for nothing -- which
     * is what leaves WebView2's documented path available. It is not proved,
     * and is not claimed, that the WebView zoomed.
     */
    it("takes no ctrl-modified wheel or key, and asks Rust for nothing", async () => {
      await loadWith(tauriTable({ real: [PROJECT] }));
      await selectFirstSpectrum();
      const box = await revealThePlot();
      await waitForADrawing();

      // From a subrange, so every input below would otherwise be productive and
      // no release can be a boundary in disguise.
      await pressButton("Zoom in m/z");
      await waitForADrawing();
      const subrange = await rangeCaption();
      const asked = (await projectionRequests()).length;
      const at = Math.round(box.left + box.width / 2);

      for (const deltaY of [-240, 240]) {
        expect(await modifiedWheelClaim(at, deltaY, true)).toBe(false);
      }
      for (const key of ["+", "=", "-", "_", "ArrowLeft", "ArrowRight", "Home", "0"]) {
        for (const held of ["ctrlKey", "metaKey", "altKey"] as const) {
          expect({ key, held, claimed: await modifiedKeyClaim(key, { [held]: true }) }).toEqual({
            key,
            held,
            claimed: false,
          });
        }
      }

      expect(await rangeCaption()).toBe(subrange);
      // The real boundary was never asked to draw a window nobody chose.
      expect(await projectionRequests()).toHaveLength(asked);

      // And the unmodified shortcut still reaches the real boundary in the same
      // shell, including the shift-produced plus that is how `+` arrives.
      expect(await modifiedKeyClaim("+", { shiftKey: true })).toBe(true);
      // Waited for rather than read once: the claim is synchronous and the
      // range that follows it is not, so reading the caption immediately would
      // be a race this suite would lose only sometimes.
      await browser.waitUntil(async () => (await rangeCaption()) !== subrange, {
        timeout: 30_000,
        timeoutMsg: "a shift-produced plus did not zoom the m/z range",
      });
      await waitForADrawing();
      expect((await projectionRequests()).length).toBeGreaterThan(asked);
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
