/**
 * Viewer Closure on the real thing: the linked chromatogram in WebView2.
 *
 * What this layer adds over the browser suite is the transport. The preview and
 * the roster are answered — reading them needs a ProteoWizard installation and
 * an mzML file — but the document is the shipped bundle running in the real
 * WebView inside the real Rust process, and `load_selected_spectrum` is left
 * real, so a click in the plot crosses the actual IPC boundary into the
 * production selected-spectrum command and comes back through it.
 *
 * No dialog is involved anywhere in this milestone, so nothing here needs
 * authority over a window this session does not own.
 */

import { MZML_ROW } from "../support/fixtures";
import { ipcCalls, loadWith, tauriTable } from "../support/tauriPanel";

const PLOT = "svg.chromatogram-svg";
const READOUT = ".chromatogram-readout";
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

/** Opens the seeded preview through the interface, as the roster documents. */
async function openThePreview(): Promise<void> {
  const row = `li.dataset-row[data-handle="${MZML_ROW.handle}"]`;
  await browser.$(row).waitForDisplayed({ timeout: 60_000 });
  await browser.$(row).click();
  await browser.keys(["Enter"]);
  await browser.$(PLOT).waitForDisplayed({ timeout: 60_000 });
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed({
    timeout: 60_000,
  });
}

describe("the linked chromatogram on the real Tauri WebView", () => {
  // Every test establishes its own document, with its own explicit setup. A
  // shared one made an earlier suite depend on whatever the previous test left
  // behind, and a failure there was unreadable.
  beforeEach(async () => {
    // The selected-spectrum command is left real, so a click in the plot runs
    // the production command over the production transport.
    await loadWith(tauriTable({ real: ["load_selected_spectrum"] }));
    await openThePreview();
  });

  it("renders the chromatogram from the preview the document was given", async () => {
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
    expect(await browser.$(".chromatogram-axis-caption").getText()).toContain(
      "unit not reported",
    );
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
    const box = await browser.execute((css: string) => {
      const rect = document.querySelector(css)?.getBoundingClientRect();
      return rect === undefined
        ? { left: 0, top: 0, width: 0, height: 0 }
        : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }, PLOT);
    const drawn = ((1_000 - 64 - 12) / 1_000) * box.width;
    const x = Math.round(box.left + (64 / 1_000) * box.width + drawn * 0.5);
    const y = Math.round(box.top + box.height / 2);

    await browser.action("pointer").move({ x, y }).down().up().perform();

    await browser.waitUntil(async () => (await selectedRowPosition()) !== null, {
      timeout: 60_000,
      timeoutMsg: "the click never selected a scan",
    });
    const selected = await selectedRowPosition();

    // The real command, called once, for the scan the pointer was over.
    const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.args["index"]).toBe(selected);

    // And Rust's own answer came back through the real transport into the
    // panel. Which answer it is depends on the machine: the roster and the
    // preview are seeded, but the spectrum read is real, so on a session with
    // no ProteoWizard installation and no file behind the handle it is a typed
    // refusal rather than a spectrum. Both are the command answering. What must
    // never happen is a third outcome -- a blank panel, or a document that
    // stopped rendering because a rejection went unhandled.
    const settled = await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const plot = document.querySelector('svg[role="img"][aria-label^="Spectrum"]');
          if (plot !== null) {
            return "spectrum";
          }
          const panel = document.querySelector("section.spectrum-panel");
          const text = (panel?.textContent ?? "").trim();
          if (text.includes("could not be loaded") || text.includes("Try loading this spectrum")) {
            return "refused";
          }
          return false;
        }),
      { timeout: 60_000, timeoutMsg: "the panel never settled on Rust's answer" },
    );
    expect(["spectrum", "refused"]).toContain(settled);

    // Either way the selection stands, so the marker is on the scan that was
    // clicked: the linked views agree about which scan is being asked about,
    // whatever the answer turns out to be.
    const marker = await browser.execute(
      () => document.querySelector("g.chromatogram-selected") !== null,
    );
    expect(marker).toBe(true);
    // The readout names that same scan. It says "Hovering" while the pointer is
    // still on the plot and "Selected" once it is not, and which of the two is
    // showing is not what this test is about -- the scan is.
    expect(await readout()).toContain(`index ${String(selected)},`);
  });

  it("keeps the table row and the chromatogram marker on the same scan", async () => {
    await browser.$('div.spectrum-table-row[data-row-position="2"]').click();

    await browser.waitUntil(async () => (await selectedRowPosition()) === 2, {
      timeout: 60_000,
      timeoutMsg: "the table selection did not take",
    });
    await browser.waitUntil(async () => (await readout()).includes("Selected index 2,"), {
      timeout: 60_000,
      timeoutMsg: "the chromatogram marker did not follow the table",
    });

    // Next scan steps both surfaces together, through the same one selection.
    await browser.$("button=Next scan").click();
    await browser.waitUntil(async () => (await selectedRowPosition()) === 3, {
      timeout: 60_000,
      timeoutMsg: "Next scan did not move the selection",
    });
    expect(await readout()).toContain("Selected index 3,");

    const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
    expect(reads.map((call) => call.args["index"])).toEqual([2, 3]);
  });

  it("moves the viewport on the real WebView without asking Rust for anything", async () => {
    const before = (await ipcCalls()).length;

    await browser.$("button=Zoom in").click();
    await browser.waitUntil(async () => !(await rangeCaption()).includes("full range"), {
      timeout: 20_000,
      timeoutMsg: "Zoom in did not change the range",
    });
    await browser.$("button=Reset range").click();
    await browser.waitUntil(async () => (await rangeCaption()).includes("full range"), {
      timeout: 20_000,
      timeoutMsg: "Reset range did not return the whole run",
    });

    expect((await ipcCalls()).length).toBe(before);
  });
});
