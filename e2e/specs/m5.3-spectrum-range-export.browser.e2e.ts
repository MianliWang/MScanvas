/**
 * M5.3 rendered QA — a selected spectrum's exports, over one committed range.
 *
 * The unit suites pin the range arithmetic, the two data schemas and the visible
 * value window. What only a browser can answer is whether the chooser is
 * reachable at the windows people use, whether opening it costs the measured
 * viewer layout anything, and — the claim this milestone stands on — whether
 * what the shipped bundle actually sends across the boundary is the
 * **committed** m/z window rather than the range a gesture is holding or the
 * arrays the screen was drawn from.
 *
 * Since the rebuild (spec 3.4, 6) the chooser is the Range group of the Export
 * figure dialog, opened from the spectrum head's Export…: "Current range"
 * names the committed m/z window it covers, and the data exports sit beside the
 * figure settings. The dialog is modal, so the viewport is moved before it is
 * opened, and the scope a reader chose is the workspace's, so it outlives it.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is, so every claim
 * below about which command was called with which range is a claim about the
 * shipped frontend.
 *
 * One thing this layer deliberately does not claim. The mocked boundary answers
 * an export within a microtask, so no test here asserts anything about the
 * moment between beginning one and its result arriving; what *is* observable,
 * and is measured, is that the result a panel publishes describes the range the
 * export began on however far the viewport has since moved.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  consoleEntries,
  horizontalOverflow,
  ipcCalls,
  setInvokeResult,
} from "../support/harness";
import {
  COMPLETE_POINT_COUNT,
  ipcTable,
  secondSpectrum,
  SETTLED_AUTHORITY,
} from "../support/fixtures";
import {
  SPECTRUM,
  SPECTRUM_PLOT,
  type OpenViewerOptions,
  openTheSpectrum,
  revealTheSpectrum,
  spectrumDomain,
  spectrumPointAt,
  spectrumRangeCaption,
  spectrumSpan,
} from "../support/viewer";
import {
  FIGURE_DIALOG,
  answerFigurePreviews,
  closeFigureDialog,
  figureActions,
  openFigureDialog,
} from "../support/figure";

const VIEWPORTS = [
  { name: "1920x1080", width: 1_920, height: 1_080 },
  { name: "1366x768", width: 1_366, height: 768 },
  { name: "960x640", width: 960, height: 640 },
] as const;

/** The chooser, its two options, and the line under it when it is frozen. */
const RANGE_GROUP = `${FIGURE_DIALOG} .figure-export-range`;
const CURRENT_OPTION = `${RANGE_GROUP} [role="radio"]:first-child`;
const FULL_OPTION = `${RANGE_GROUP} [role="radio"]:last-child`;
const RANGE_NOTE = `${FIGURE_DIALOG} .figure-export-note`;
const FULL_SCOPE = "Full spectrum";
const CURRENT_SCOPE = "Current range";
/** The committed window "Current range" names, at four decimals. */
const MZ_WINDOW = /m\/z (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)/u;

/** The viewer column, which is one of the two scroll owners in play. */
const VIEWER_STACK = ".viewer-view";

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/**
 * One of the dialog's controls, found by the text on it.
 *
 * Chained rather than written as one selector string: WebdriverIO's text
 * pseudo-selector is not CSS and cannot be combined with a CSS prefix.
 */
function control(label: string) {
  return browser.$(FIGURE_DIALOG).$(`button=${label}`);
}

/** Offered: neither disabled nor refused (`aria-disabled`, which keeps a Tab stop). */
async function offered(label: string): Promise<boolean> {
  const button = control(label);
  return (await button.isEnabled()) && (await button.getAttribute("aria-disabled")) !== "true";
}

/** Presses a dialog action once it is offered: Copy waits for a drawn preview. */
async function press(label: string): Promise<void> {
  await browser.waitUntil(() => offered(label), {
    timeout: 15_000,
    timeoutMsg: `${label} was never offered`,
  });
  await control(label).click();
}

/**
 * A selected spectrum, the dialog's preview answered (a labelled mock), and
 * the viewport narrowed first when the case needs a committed window.
 */
async function openTheSpectrumFor(options: OpenViewerOptions, narrowed = false): Promise<void> {
  await openTheSpectrum(options);
  await answerFigurePreviews();
  if (narrowed) await narrowTheViewport();
}

/** Opens the chooser: the spectrum head's Export…, the figure dialog. */
async function openTheChooser(): Promise<void> {
  await openFigureDialog(SPECTRUM);
}

/** Chooses a scope by clicking the option a reader would click. */
async function chooseScope(label: string): Promise<void> {
  await browser.$(FIGURE_DIALOG).$(`button*=${label}`).click();
}

/**
 * What the chooser offers as the current range: the option's own words, with
 * the committed window when one narrower than the spectrum is committed.
 *
 * Read from the document rather than through `getText`, which answers only for
 * text inside the viewport, and the dialog's options column scrolls.
 */
async function rangeNote(): Promise<string> {
  return textOf(CURRENT_OPTION);
}

async function textOf(selector: string): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    selector,
  );
}

/** Waits until the chooser names a committed window. */
async function committedWindowOffered(): Promise<void> {
  await browser.waitUntil(async () => MZ_WINDOW.test(await rangeNote()), {
    timeout: 10_000,
    timeoutMsg: "the committed window never reached the chooser",
  });
}

/**
 * What the spectrum's own status line says, verbatim. It is the plot's, so it
 * is there whether the dialog is open or not.
 */
async function exportStatus(): Promise<string> {
  return textOf(`${SPECTRUM} .spectrum-export-status`);
}

/** The arguments of the most recent selected-spectrum export. */
async function lastExport(): Promise<Record<string, unknown> | null> {
  const begun = (await ipcCalls()).filter(
    (call) => call.command === "begin_selected_spectrum_export",
  );
  return (begun[begun.length - 1]?.args as Record<string, unknown> | undefined) ?? null;
}

/** The range the most recent selected-spectrum export carried. */
async function lastExportRange(): Promise<Record<string, unknown> | null> {
  return ((await lastExport())?.["range"] as Record<string, unknown> | undefined) ?? null;
}

/** The range the most recent `Copy plot` carried. */
async function lastCopyRange(): Promise<Record<string, unknown> | null> {
  const calls = await ipcCalls();
  const copies = calls.filter((call) => call.command === "copy_selected_spectrum_plot");
  const last = copies[copies.length - 1];
  return last === undefined
    ? null
    : ((last.args as Record<string, unknown>)["range"] as Record<string, unknown>);
}

/** Waits until one export has reached the boundary. */
async function exportAndWait(label: string): Promise<void> {
  const before = (await ipcCalls()).filter(
    (call) => call.command === "begin_selected_spectrum_export",
  ).length;
  await press(label);
  await browser.waitUntil(
    async () =>
      (await ipcCalls()).filter((call) => call.command === "begin_selected_spectrum_export")
        .length > before,
    { timeout: 10_000, timeoutMsg: "the export never reached the boundary" },
  );
}

/** Narrows the viewport with the wheel, and waits for the drawing to follow. */
async function narrowTheViewport(): Promise<void> {
  await revealTheSpectrum();
  const at = await spectrumPointAt(0.5);
  const full = await spectrumSpan();
  await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
  await browser.waitUntil(async () => (await spectrumSpan()) < full, {
    timeout: 10_000,
    timeoutMsg: "the wheel never narrowed the m/z range",
  });
}

describe("the selected spectrum's range chooser", () => {
  for (const viewport of VIEWPORTS) {
    it(`is reachable and does not clip the panel at ${viewport.name}`, async () => {
      await openTheSpectrumFor({
        width: viewport.width,
        height: viewport.height,
        answers: ipcTable(),
      });
      await openTheChooser();
      await chooseScope(CURRENT_SCOPE);

      // Both options, drawn where a person can press them, inside the dialog.
      const dialog = await boxOf(FIGURE_DIALOG);
      for (const label of [FULL_SCOPE, CURRENT_SCOPE]) {
        const option = browser.$(FIGURE_DIALOG).$(`button*=${label}`);
        await expect(option).toBeDisplayed();
        const box = await option.getSize();
        const at = await option.getLocation();
        expect(box.height).toBeGreaterThan(0);
        expect(box.width).toBeGreaterThan(0);
        expect(at.x).toBeGreaterThanOrEqual(dialog.left - 0.5);
        expect(at.x + box.width).toBeLessThanOrEqual(dialog.right + 0.5);
      }
      // And the actions the chooser governs still are: a range control that
      // pushed them off the surface would be a control bought with the surface
      // it exists to serve.
      await expect(control("Export CSV…")).toBeDisplayed();

      // Back in the viewer, the plot is still reachable, and so is its way back
      // into the dialog.
      await closeFigureDialog();
      await revealTheSpectrum();
      await expect(browser.$(SPECTRUM_PLOT)).toBeDisplayed();
      await expect(browser.$(`${figureActions(SPECTRUM)} > button:first-child`)).toBeDisplayed();

      // And the column still owns its scroll rather than the page: nothing
      // here widened the document sideways.
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      const stack = await boxOf(VIEWER_STACK);
      expect(stack.width).toBeLessThanOrEqual(viewport.width);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("exports the full source until a range is chosen", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() });
    await openTheChooser();

    await exportAndWait("Export CSV…");

    // The scope a spectrum's export context starts at, carrying no window at
    // all -- Rust resolves the complete retained spectrum without one.
    expect(await lastExportRange()).toEqual({ scope: "full", low: null, high: null });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says the current range is the whole spectrum until the viewport moves", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() });
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);

    // Chosen, and naming no window: only a confirmed range is committed, and
    // nothing narrower than the spectrum is.
    expect(await browser.$(CURRENT_OPTION).getAttribute("aria-checked")).toBe("true");
    expect(await rangeNote()).toBe(CURRENT_SCOPE);

    await exportAndWait("Export CSV…");

    // Null rather than the spectrum's own bounds: Rust resolves that from the
    // domain it retained, and this side invents no subrange to fill it.
    expect(await lastExportRange()).toEqual({ scope: "current", low: null, high: null });
  });

  it("sends the committed window once the viewport has been narrowed", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() }, true);
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);
    await committedWindowOffered();

    await exportAndWait("Export CSV…");

    const range = (await lastExportRange()) as Record<string, number | null>;
    // Compared against what the chooser *offered*, which is the promise this
    // surface made, rather than against the axis caption beside the plot.
    const [, low, high] = MZ_WINDOW.exec(await rangeNote()) ?? [];
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
    expect(Number(range["high"])).toBeCloseTo(Number(high), 3);
    // And the drawing on screen agrees, because both read the committed domain.
    const shown = await spectrumDomain();
    expect(Number(range["low"])).toBeCloseTo(shown.low, 3);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("copies the same committed window a save would write", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() }, true);
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);
    await committedWindowOffered();
    const offeredWindow = await rangeNote();

    await press("Copy plot");
    await browser.waitUntil(async () => (await lastCopyRange()) !== null, {
      timeout: 10_000,
      timeoutMsg: "the copy never reached the boundary",
    });

    const range = (await lastCopyRange()) as Record<string, number | null>;
    const [, low] = MZ_WINDOW.exec(offeredWindow) ?? [];
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
  });

  it("offers no current range for a spectrum with no m/z viewport", async () => {
    await openTheSpectrumFor({
      width: 1_366,
      height: 768,
      answers: ipcTable({ refusedViewport: true }),
    });
    await openTheChooser();

    // Not choosable, and said. The group stays, frozen on the full source,
    // with the line under it saying why -- an inert option a reader cannot
    // explain would be worse than one whose reason is beside it.
    expect(await browser.$(CURRENT_OPTION).isEnabled()).toBe(false);
    expect(await browser.$(FULL_OPTION).getAttribute("aria-checked")).toBe("true");
    expect(await textOf(RANGE_NOTE)).toContain("No m/z range");

    // And every full-source export is exactly as available as ever: a viewport
    // refusal is a fact about drawability, never about the source.
    for (const label of ["Export CSV…", "Export TSV…"]) {
      expect(await offered(label)).toBe(true);
    }
    await exportAndWait("Export CSV…");
    expect(await lastExportRange()).toEqual({ scope: "full", low: null, high: null });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps the current range available while a drawing has failed", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() }, true);
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);
    await committedWindowOffered();
    const committed = await rangeNote();
    await closeFigureDialog();

    // The screen stops being able to draw. The science does not move.
    await setInvokeResult("project_selected_spectrum", {
      __reject: { kind: "spectrum_projection_window_refused", summary: "no drawing", detail: null },
    });
    await revealTheSpectrum();
    const at = await spectrumPointAt(0.5);
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();

    await openTheChooser();
    await browser.waitUntil(async () => (await rangeNote()) !== committed, {
      timeout: 10_000,
      timeoutMsg: "the second commit never reached the chooser",
    });

    // Still offered, still chosen, and it still exports.
    expect(await browser.$(CURRENT_OPTION).isEnabled()).toBe(true);
    expect(await browser.$(CURRENT_OPTION).getAttribute("aria-checked")).toBe("true");
    await exportAndWait("Export CSV…");
    expect((await lastExportRange())?.["scope"]).toBe("current");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("reports the range an export began on, after the viewport has moved", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() }, true);
    await setInvokeResult("save_selected_spectrum_export", {
      status: "saved",
      format: "csv",
      fileName: "mscanvas-spectrum-0-current.csv",
      figure: null,
      rangeScope: "current",
      rangeLow: 301.5,
      rangeHigh: 303.5,
      sourcePointCount: COMPLETE_POINT_COUNT,
      exportedPointCount: 2_500,
    });
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);
    await committedWindowOffered();

    await exportAndWait("Export CSV…");
    await browser.waitUntil(async () => (await exportStatus()).startsWith("Saved"), {
      timeout: 10_000,
      timeoutMsg: "the export never published a result",
    });
    const reported = await exportStatus();
    expect(reported).toContain("mscanvas-spectrum-0-current.csv");
    expect(reported).toContain("2,500 of 1,000,000 points");
    // The exact bounds, unformatted, since M7.3 (en.ts `viewerExportPointRange`,
    // c12f45d; SelectedSpectrumExport.test.tsx "names the file, both counts and
    // the exact bounds it was taken over"; baseline UI-31 keeps exact values in
    // the export notes).
    expect(reported).toContain("m/z 301.5 to 303.5");

    // The reader now moves somewhere else entirely. The result stands, because
    // it describes a file rather than a viewport.
    await closeFigureDialog();
    const before = await spectrumRangeCaption();
    await revealTheSpectrum();
    const at = await spectrumPointAt(0.5);
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
    await browser.waitUntil(async () => (await spectrumRangeCaption()) !== before, {
      timeout: 10_000,
    });
    expect(await exportStatus()).toBe(reported);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("reports an empty range as a successful export", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() });
    await setInvokeResult("save_selected_spectrum_export", {
      status: "saved",
      format: "tsv",
      fileName: "mscanvas-spectrum-0-current.tsv",
      figure: null,
      rangeScope: "current",
      rangeLow: 302.1,
      rangeHigh: 302.4,
      sourcePointCount: COMPLETE_POINT_COUNT,
      exportedPointCount: 0,
    });
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);

    await exportAndWait("Export TSV…");
    await browser.waitUntil(async () => (await exportStatus()).startsWith("Saved"), {
      timeout: 10_000,
    });

    const reported = await exportStatus();
    expect(reported).toContain("0 of 1,000,000 points");
    // A window of a spectrum may truthfully hold nothing, and nothing here
    // presents that as a failure.
    expect(reported).not.toContain("could not");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("starts a newly selected spectrum at the full source", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() }, true);
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);
    await committedWindowOffered();
    await closeFigureDialog();

    // Another spectrum, and therefore another export context. The token is
    // what makes it one: the mocked boundary answers every selection from one
    // table, so a second row alone would be a redelivery of the same spectrum
    // -- which correctly resets nothing.
    const next = secondSpectrum();
    await setInvokeResult("load_selected_spectrum", {
      authority: SETTLED_AUTHORITY,
      outcome: { outcome: "spectrum", spectrum: next },
    });
    await browser.execute(() => {
      document
        .querySelector('div.spectrum-table-row[data-row-position="1"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await openTheChooser();
    await browser.waitUntil(
      async () => (await browser.$(FULL_OPTION).getAttribute("aria-checked")) === "true",
      { timeout: 10_000, timeoutMsg: "the new spectrum kept the old scope" },
    );
    expect(await rangeNote()).toBe(CURRENT_SCOPE);

    await exportAndWait("Export CSV…");
    expect(await lastExportRange()).toEqual({ scope: "full", low: null, high: null });
    // And it is the new spectrum's export.
    expect((await lastExport())?.["exportToken"]).toBe(next.exportToken);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("does not let a spectrum range reach the linked figure", async () => {
    await openTheSpectrumFor({ width: 1_366, height: 768, answers: ipcTable() }, true);
    await openTheChooser();
    await chooseScope(CURRENT_SCOPE);
    await committedWindowOffered();
    await closeFigureDialog();
    const committed = await spectrumRangeCaption();

    // The linked figure: the chromatogram head's ⋯ menu, then its dialog.
    const chromatogram = "section.chromatogram-panel";
    await browser.$(`${figureActions(chromatogram)} button[aria-haspopup="menu"]`).click();
    await browser.$('//*[@role="menuitem"][starts-with(normalize-space(), "Linked figure")]').click();
    await browser.$(FIGURE_DIALOG).waitForDisplayed();
    await press("Export SVG…");

    await browser.waitUntil(
      async () => (await ipcCalls()).some((call) => call.command === "begin_linked_figure_export"),
      { timeout: 10_000, timeoutMsg: "the linked export never reached the boundary" },
    );
    const call = (await ipcCalls()).find(
      (entry) => entry.command === "begin_linked_figure_export",
    );
    const args = call?.args as Record<string, unknown>;
    // ADR 0036: the lower panel is the complete selected spectrum. The range
    // this figure carries is the chromatogram's, and no m/z number is in it.
    expect(args["range"]).toEqual({ scope: "full", low: null, high: null });
    const [, low] = /Showing m\/z ([\d.]+) to ([\d.]+)/u.exec(committed) ?? [];
    expect(low).toBeDefined();
    expect(JSON.stringify(args)).not.toContain(String(low));
    expect(await unexpectedConsole()).toEqual([]);
  });
});
