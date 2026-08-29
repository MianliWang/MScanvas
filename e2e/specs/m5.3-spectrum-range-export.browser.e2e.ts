/**
 * M5.3 rendered QA — a selected spectrum's exports, over one committed range.
 *
 * The unit suites pin the range arithmetic, the two data schemas and the visible
 * value window. What only a browser can answer is whether the chooser is
 * reachable at the windows people use, whether opening it costs the measured
 * three-panel layout anything, and — the claim this milestone stands on —
 * whether what the shipped bundle actually sends across the boundary is the
 * **committed** m/z window rather than the range a gesture is holding or the
 * arrays the screen was drawn from.
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
import { COMPLETE_POINT_COUNT, ipcTable, secondSpectrum } from "../support/fixtures";
import {
  SPECTRUM,
  SPECTRUM_PLOT,
  openTheSpectrum,
  revealTheSpectrum,
  spectrumDomain,
  spectrumPointAt,
  spectrumRangeCaption,
  spectrumSpan,
} from "../support/viewer";

const VIEWPORTS = [
  { name: "1920x1080", width: 1_920, height: 1_080 },
  { name: "1366x768", width: 1_366, height: 768 },
  { name: "960x640", width: 960, height: 640 },
] as const;

/** The chooser, and the two labels a reader actually sees on it. */
const RANGE_GROUP = "fieldset.spectrum-export-range";
const RANGE_NOTE = `${RANGE_GROUP} p`;
const FULL_SCOPE = "Full spectrum";
const CURRENT_SCOPE = "Current range";

/** The viewer column, which is one of the two scroll owners in play. */
const VIEWER_STACK = ".viewer-stack";

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/**
 * One of the spectrum panel's controls, found by the text on it.
 *
 * Chained rather than written as one selector string: WebdriverIO's text
 * pseudo-selector is not CSS and cannot be combined with a CSS prefix.
 */
function control(label: string) {
  return browser.$(SPECTRUM).$(`button=${label}`);
}

/** Chooses a scope by clicking the label a reader would click. */
async function chooseScope(label: string): Promise<void> {
  const option = await browser.$(SPECTRUM).$(`label*=${label}`);
  await option.scrollIntoView({ block: "center" });
  await option.click();
}

async function rangeNote(): Promise<string> {
  return (await browser.$(RANGE_NOTE).getText()).trim();
}

/** What the panel's own status region says, verbatim. */
async function exportStatus(): Promise<string> {
  return (await browser.$(`${SPECTRUM} .spectrum-export-status`).getText()).trim();
}

/** The range the most recent selected-spectrum export carried. */
async function lastExportRange(): Promise<Record<string, unknown> | null> {
  const calls = await ipcCalls();
  const begun = calls.filter((call) => call.command === "begin_selected_spectrum_export");
  const last = begun[begun.length - 1];
  return last === undefined
    ? null
    : ((last.args as Record<string, unknown>)["range"] as Record<string, unknown>);
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
  await control(label).click();
  await browser.waitUntil(
    async () =>
      (await ipcCalls()).filter((call) => call.command === "begin_selected_spectrum_export")
        .length > before,
    { timeout: 10_000, timeoutMsg: "the export never reached the boundary" },
  );
}

/** Narrows the viewport with the wheel, and waits for the commit to land. */
async function narrowTheViewport(): Promise<void> {
  await revealTheSpectrum();
  const at = await spectrumPointAt(0.5);
  const full = await spectrumSpan();
  await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
  await browser.waitUntil(async () => (await spectrumSpan()) < full, {
    timeout: 10_000,
    timeoutMsg: "the wheel never narrowed the m/z range",
  });
  await browser.waitUntil(async () => /Current range is m\/z [\d.]/u.test(await rangeNote()), {
    timeout: 10_000,
    timeoutMsg: "the committed window never reached the range note",
  });
}

describe("the selected spectrum's range chooser", () => {
  for (const viewport of VIEWPORTS) {
    it(`is reachable and does not clip the panel at ${viewport.name}`, async () => {
      await openTheSpectrum({
        width: viewport.width,
        height: viewport.height,
        answers: ipcTable(),
      });
      await chooseScope(CURRENT_SCOPE);

      // Both options, drawn where a person can press them.
      for (const label of [FULL_SCOPE, CURRENT_SCOPE]) {
        const option = await browser.$(SPECTRUM).$(`label*=${label}`);
        await expect(option).toBeDisplayed();
        const box = await option.getSize();
        expect(box.height).toBeGreaterThan(0);
        expect(box.width).toBeGreaterThan(0);
      }

      // The plot is still reachable, and the actions below the chooser still
      // are: a range control that pushed either off its own panel would be a
      // control bought with the surface it exists to serve.
      await revealTheSpectrum();
      await expect(browser.$(SPECTRUM_PLOT)).toBeDisplayed();
      await expect(control("Export CSV…")).toBeDisplayed();

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
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });

    await exportAndWait("Export CSV…");

    // The scope a spectrum's export context starts at, carrying no window at
    // all -- Rust resolves the complete retained spectrum without one.
    expect(await lastExportRange()).toEqual({ scope: "full", low: null, high: null });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("says the current range is the whole spectrum until the viewport moves", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
    await chooseScope(CURRENT_SCOPE);

    expect(await rangeNote()).toContain("whole spectrum until the viewport is changed");

    await exportAndWait("Export CSV…");

    // Null rather than the spectrum's own bounds: Rust resolves that from the
    // domain it retained, and this side invents no subrange to fill it.
    expect(await lastExportRange()).toEqual({ scope: "current", low: null, high: null });
  });

  it("sends the committed window once the viewport has been narrowed", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
    await chooseScope(CURRENT_SCOPE);
    await narrowTheViewport();

    await exportAndWait("Export CSV…");

    const range = (await lastExportRange()) as Record<string, number | null>;
    // Compared against what the panel *offered*, which is the promise this
    // surface made, rather than against the axis caption beside it.
    const [, low, high] =
      /Current range is m\/z (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/u.exec(await rangeNote()) ?? [];
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
    expect(Number(range["high"])).toBeCloseTo(Number(high), 3);
    // And the drawing on screen agrees, because both read the committed domain.
    const shown = await spectrumDomain();
    expect(Number(range["low"])).toBeCloseTo(shown.low, 3);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("copies the same committed window a save would write", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
    await chooseScope(CURRENT_SCOPE);
    await narrowTheViewport();
    const offered = await rangeNote();

    await control("Copy plot").click();
    await browser.waitUntil(async () => (await lastCopyRange()) !== null, {
      timeout: 10_000,
      timeoutMsg: "the copy never reached the boundary",
    });

    const range = (await lastCopyRange()) as Record<string, number | null>;
    const [, low] =
      /Current range is m\/z (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/u.exec(offered) ?? [];
    expect(range["scope"]).toBe("current");
    expect(Number(range["low"])).toBeCloseTo(Number(low), 3);
  });

  it("offers no current range for a spectrum with no m/z viewport", async () => {
    await openTheSpectrum({
      width: 1_366,
      height: 768,
      answers: ipcTable({ refusedViewport: true }),
    });

    // Absent rather than inert. A disabled radio a reader cannot explain is
    // worse than a section that says the choice is unavailable.
    await expect(browser.$(SPECTRUM).$(`label*=${CURRENT_SCOPE}`)).not.toBeExisting();
    expect(await rangeNote()).toContain("no m/z viewport");

    // And every full-source export is exactly as available as ever: a viewport
    // refusal is a fact about drawability, never about the source.
    for (const label of ["Export CSV…", "Export TSV…"]) {
      await expect(control(label)).toBeEnabled();
    }
    await exportAndWait("Export CSV…");
    expect(await lastExportRange()).toEqual({ scope: "full", low: null, high: null });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("keeps the current range available while a drawing has failed", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
    await chooseScope(CURRENT_SCOPE);
    await narrowTheViewport();
    const committed = await rangeNote();

    // The screen stops being able to draw. The science does not move.
    await setInvokeResult("project_selected_spectrum", {
      __reject: { kind: "spectrum_projection_window_refused", summary: "no drawing", detail: null },
    });
    await revealTheSpectrum();
    const at = await spectrumPointAt(0.5);
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
    await browser.waitUntil(async () => (await rangeNote()) !== committed, {
      timeout: 10_000,
      timeoutMsg: "the second commit never reached the range note",
    });

    // Still offered, still chosen, and it still exports.
    await expect(browser.$(SPECTRUM).$(`label*=${CURRENT_SCOPE}`)).toBeExisting();
    await exportAndWait("Export CSV…");
    expect((await lastExportRange())?.["scope"]).toBe("current");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("reports the range an export began on, after the viewport has moved", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
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
    await chooseScope(CURRENT_SCOPE);
    await narrowTheViewport();

    await exportAndWait("Export CSV…");
    await browser.waitUntil(async () => (await exportStatus()).startsWith("Saved"), {
      timeout: 10_000,
      timeoutMsg: "the export never published a result",
    });
    const reported = await exportStatus();
    expect(reported).toContain("mscanvas-spectrum-0-current.csv");
    expect(reported).toContain("2,500 of 1,000,000 points");
    expect(reported).toContain("m/z 301.5000 to 303.5000");

    // The reader now moves somewhere else entirely. The result stands, because
    // it describes a file rather than a viewport.
    await revealTheSpectrum();
    const at = await spectrumPointAt(0.5);
    await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -500 }).perform();
    await browser.waitUntil(async () => (await rangeNote()).includes("Current range is m/z"), {
      timeout: 10_000,
    });
    expect(await exportStatus()).toBe(reported);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("reports an empty range as a successful export", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
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
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
    await chooseScope(CURRENT_SCOPE);
    await narrowTheViewport();

    // Another spectrum, and therefore another export context. The token is
    // what makes it one: the mocked boundary answers every selection from one
    // table, so a second row alone would be a redelivery of the same spectrum
    // -- which correctly resets nothing.
    await setInvokeResult("load_selected_spectrum", {
      outcome: "spectrum",
      spectrum: secondSpectrum(),
    });
    await browser.execute(() => {
      document
        .querySelector('div.spectrum-table-row[data-row-position="1"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await browser.waitUntil(
      async () => (await rangeNote()).includes("whole spectrum until the viewport is changed"),
      { timeout: 10_000, timeoutMsg: "the new spectrum kept the old scope" },
    );

    await expect(browser.$(SPECTRUM).$(`label*=${FULL_SCOPE}`)).toBeExisting();
    await exportAndWait("Export CSV…");
    expect(await lastExportRange()).toEqual({ scope: "full", low: null, high: null });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("does not let a spectrum range reach the linked figure", async () => {
    await openTheSpectrum({ width: 1_366, height: 768, answers: ipcTable() });
    await chooseScope(CURRENT_SCOPE);
    await narrowTheViewport();
    const committed = await spectrumRangeCaption();

    await browser.$("button#chromatogram-export-toggle").click();
    await browser.$("#chromatogram-export-panel").waitForDisplayed({ timeout: 10_000 });
    const linked = await browser.$("#chromatogram-export-panel").$("button=Export linked SVG…");
    await linked.scrollIntoView({ block: "center" });
    await linked.click();

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
    expect(JSON.stringify(args)).not.toContain(String(low));
    expect(await unexpectedConsole()).toEqual([]);
  });
});
