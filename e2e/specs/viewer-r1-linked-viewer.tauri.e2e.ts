/**
 * Viewer Closure R1 on the real thing: the linked viewer in WebView2.
 *
 * What this layer adds over the browser suite is the transport. The roster and
 * the preview are answered -- reading them needs a ProteoWizard installation
 * and an mzML file -- but the document is the shipped bundle running in the
 * real WebView inside the real Rust process, and `load_selected_spectrum` is
 * left real, so a click in the plot crosses the actual IPC boundary into the
 * production selected-spectrum command and comes back through it.
 *
 * No dialog is involved anywhere in this milestone, so nothing here needs
 * authority over a window this session does not own.
 */

import { MZML_ROW } from "../support/fixtures";
import { ipcCalls, loadWith, tauriTable } from "../support/tauriPanel";

const PLOT = "svg.chromatogram-svg";
const READOUT = "#chromatogram-readout";
const RANGE = ".chromatogram-range";

async function readout(): Promise<string> {
  return (await browser.$(READOUT).getText()).trim();
}

async function rangeCaption(): Promise<string> {
  return (await browser.$(RANGE).getText()).trim();
}

async function selectedRowPosition(): Promise<number | null> {
  return browser.execute(() => {
    const row = document.querySelector('div.spectrum-table-row[aria-selected="true"]');
    const position = row?.getAttribute("data-row-position");
    return position === undefined || position === null ? null : Number(position);
  });
}

/** What the selected-spectrum panel says it is doing, in its own words. */
async function panelState(): Promise<string> {
  return (await browser.$("section.spectrum-panel .panel-header p").getText()).trim();
}

async function spectrumReads(): Promise<number[]> {
  return (await ipcCalls())
    .filter((call) => call.command === "load_selected_spectrum")
    .map((call) => Number(call.args["index"]));
}

/** Opens the seeded preview through the interface, as the roster documents. */
async function openThePreview(): Promise<void> {
  const row = `li.dataset-row[data-handle="${MZML_ROW.handle}"]`;
  await browser.$(row).waitForDisplayed({ timeout: 60_000 });
  // Clicked to focus and select, then activated. A double click opens one too,
  // but WebDriver's synthetic one does not reliably become a `dblclick` in
  // WebView2.
  await browser.$(row).click();
  await browser.keys(["Enter"]);
  await browser.$(PLOT).waitForDisplayed({ timeout: 60_000 });
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed({
    timeout: 60_000,
  });
}

/** Where a fraction of the plot's drawing area falls, in page pixels. */
async function pointAt(fraction: number): Promise<{ readonly x: number; readonly y: number }> {
  const box = await browser.execute((css: string) => {
    const rect = document.querySelector(css)?.getBoundingClientRect();
    return rect === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, PLOT);
  const drawn = ((1_000 - 64 - 12) / 1_000) * box.width;
  return {
    x: Math.round(box.left + (64 / 1_000) * box.width + drawn * fraction),
    y: Math.round(box.top + box.height / 2),
  };
}

/** Dispatches one cancelable wheel and reports whether the viewer took it. */
async function wheelClaim(clientX: number, deltaY: number): Promise<boolean> {
  return browser.execute(
    (css: string, x: number, delta: number) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        deltaY: delta,
      });
      document.querySelector(css)?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    PLOT,
    clientX,
    deltaY,
  ) as Promise<boolean>;
}

/**
 * Takes the pointer off the plot, so the readout reports the selection again.
 *
 * A real move rather than a synthesised event: React listens for pointer exits
 * at the document root, and a non-bubbling event dispatched on the element never
 * reaches it.
 */
async function leaveThePlot(): Promise<void> {
  const box = await browser.execute((css: string) => {
    const rect = document.querySelector(css)?.getBoundingClientRect();
    return rect === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, PLOT);
  await browser
    .action("pointer")
    .move({ x: Math.round(box.left + box.width / 2), y: Math.max(1, Math.round(box.top) - 6) })
    .perform();
}

describe("the linked viewer on the real Tauri WebView", () => {
  // Every test establishes its own document, with its own explicit setup. A
  // shared one made an earlier suite depend on whatever the previous test left
  // behind, and a failure there was unreadable.
  beforeEach(async () => {
    // The selected-spectrum command is left real, so a click in the plot runs
    // the production command over the production transport.
    await loadWith(tauriTable({ real: ["load_selected_spectrum"] }));
    await openThePreview();
  });

  it("draws the chromatogram from the preview the document was given", async () => {
    const facts = await browser.execute((css: string) => {
      const svg = document.querySelector(css);
      return {
        paths: svg?.querySelectorAll("path.chromatogram-trace").length ?? 0,
        circles: svg?.querySelectorAll("circle").length ?? 0,
        toggles: document.querySelectorAll("label.chromatogram-trace-toggle input").length,
      };
    }, PLOT);

    expect(facts.paths).toBe(1);
    expect(facts.circles).toBe(0);
    expect(facts.toggles).toBe(2);
    expect(await rangeCaption()).toContain("full range");
    const caption = await browser.$(".chromatogram-axis-caption").getText();
    expect(caption).toContain("unit not reported");
    expect(caption).toContain("Per-scan values from the loaded spectrum table");
    // Nothing was asked of the backend to draw it.
    expect(await spectrumReads()).toEqual([]);
  });

  it("shows and hides each trace on the real WebView", async () => {
    const drawn = async () =>
      browser.execute(
        (css: string) =>
          [...(document.querySelector(css)?.querySelectorAll("path.chromatogram-trace") ?? [])].map(
            (path) => path.getAttribute("class") ?? "",
          ),
        PLOT,
      );

    expect((await drawn()).join(" ")).toContain("chromatogram-trace-tic");

    await browser.$("//span[normalize-space()='BPC']/preceding-sibling::input").click();
    await browser.waitUntil(async () => (await drawn()).length === 2, {
      timeout: 20_000,
      timeoutMsg: "BPC never appeared",
    });
    expect((await drawn()).join(" ")).toContain("chromatogram-trace-bpc");

    await browser.$("//span[normalize-space()='TIC']/preceding-sibling::input").click();
    await browser.waitUntil(async () => (await drawn()).length === 1, {
      timeout: 20_000,
      timeoutMsg: "TIC never went away",
    });
    expect((await drawn()).join(" ")).toContain("chromatogram-trace-bpc");
  });

  it("crosses the real transport into the production selected-spectrum command", async () => {
    const at = await pointAt(0.5);

    await browser.action("pointer").move({ x: at.x, y: at.y }).down().up().perform();

    await browser.waitUntil(async () => (await selectedRowPosition()) !== null, {
      timeout: 30_000,
      timeoutMsg: "the click never selected a scan",
    });
    const selected = await selectedRowPosition();

    // Exactly one read, for the scan the click resolved to.
    const reads = await spectrumReads();
    expect(reads).toEqual([selected]);
    await browser.$("//h2[normalize-space()='Selected spectrum']").waitForDisplayed({
      timeout: 30_000,
    });

    /*
     * And it settled into a typed outcome.
     *
     * Which outcome is a property of the machine rather than of the transport:
     * this suite answers the roster and the preview because reading them needs
     * a ProteoWizard installation and an mzML file, and leaves this one command
     * real -- so on a machine without either, the honest terminal state is a
     * typed refusal. What must be true everywhere is that the panel leaves
     * `loading`, which is the only state that means the reply never came back
     * through the production path.
     */
    await browser.waitUntil(async () => !(await panelState()).startsWith("Loading spectrum"), {
      timeout: 60_000,
      timeoutMsg: "the selected-spectrum request never came back",
    });
    expect(await panelState()).toMatch(
      new RegExp(
        `^Spectrum ${String(selected)}( is not in this run| could not be loaded)?$`,
        "u",
      ),
    );

    // And the linked views agree. The readout names the hovered scan while a
    // pointer is on the plot, because that is what hover is for; off the plot it
    // names the selection, which is what persists.
    await leaveThePlot();
    await browser.waitUntil(async () => (await readout()).startsWith("Selected index "), {
      timeout: 30_000,
      timeoutMsg: "the plot never reported the selected scan",
    });
    expect(await readout()).toContain(`Selected index ${String(selected)},`);
    expect(
      await browser.execute(() => document.querySelector("g.chromatogram-selected") !== null),
    ).toBe(true);
  });

  it("steps scans through the production selection transport", async () => {
    await browser.$('div.spectrum-table-row[data-row-position="1"]').click();
    await browser.waitUntil(async () => (await selectedRowPosition()) === 1, { timeout: 30_000 });

    await browser.$("button=Next scan").click();
    await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
      timeout: 30_000,
      timeoutMsg: "Next scan did not move the selection",
    });

    await browser.$("button=Previous scan").click();
    await browser.waitUntil(async () => (await selectedRowPosition()) === 1, {
      timeout: 30_000,
      timeoutMsg: "Previous scan did not move the selection",
    });

    // One read per commit, in the order the user asked for them, and each index
    // crossed the real boundary.
    expect(await spectrumReads()).toEqual([1, 2, 1]);
  });

  it("moves the viewport in WebView2 without asking the backend anything", async () => {
    const before = (await ipcCalls()).length;
    const at = await pointAt(0.5);

    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -240 }).perform();
    await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
      timeout: 30_000,
      timeoutMsg: "the wheel never changed the visible range",
    });
    await browser.$("button=Reset range").click();
    await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
      timeout: 30_000,
      timeoutMsg: "Reset range did not return the whole run",
    });

    expect((await ipcCalls()).length).toBe(before);
  });

  it("hands a wheel it cannot use back to the WebView", async () => {
    /*
     * The ownership rule, in the shell that ships. One bounded case, using
     * nothing but a dispatched event and its own `defaultPrevented` -- no
     * production hook exists for this and none was added for it.
     *
     * What it cannot show, here as in the browser suite: that the uncancelled
     * wheel then scrolls anything. A dispatched event is not a user gesture and
     * WebView2 performs no native scroll for one. That an uncancelled wheel
     * scrolls a scrollable ancestor is the engine's own contract; what is worth
     * proving in WebView2 is that the shipped listener answers the same way the
     * contract does.
     */
    if (!(await rangeCaption()).includes("full range")) {
      await browser.$("button=Reset range").click();
      await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
        timeout: 30_000,
        timeoutMsg: "the run never came back to full range",
      });
    }
    const at = await pointAt(0.5);
    const full = await rangeCaption();

    expect(await wheelClaim(at.x, 240)).toBe(false);
    expect(await rangeCaption()).toBe(full);

    // And the notch that can do something is still the viewer's.
    expect(await wheelClaim(at.x, -240)).toBe(true);
    await browser.waitUntil(async () => (await rangeCaption()) !== full, {
      timeout: 30_000,
      timeoutMsg: "a claimed wheel changed nothing in WebView2",
    });
  });
});
