/**
 * Driving the rendered linked viewer, once, for every suite that needs it.
 *
 * The selectors and the geometry live here rather than in each spec because
 * they are the same interface: a spec that re-derived where the plot's drawing
 * area starts would be testing its own arithmetic.
 */

import { IPC_TABLE_KEY, installIpcBoundary } from "./harness";
import { MZML_ROW, ipcTable } from "./fixtures";

export const CHROMATOGRAM = "section.chromatogram-panel";
export const PLOT = "svg.chromatogram-svg";
export const TABLE = "section.spectrum-table-panel";
export const SPECTRUM = "section.spectrum-panel";
export const READOUT = "#chromatogram-readout";
export const RANGE = ".chromatogram-range";
export const AXIS_CAPTION = ".chromatogram-axis-caption";

/**
 * The selected spectrum's m/z viewport, as M5.2 made it reachable.
 *
 * Named here beside the chromatogram's rather than in the one spec that drives
 * them, for the reason this file exists at all: these are the interface, and a
 * spec that spelled a selector out again would be testing its own copy of it.
 *
 * `SPECTRUM_SURFACE` is deliberately not the drawing. The pointer adapters live
 * on the wrapper because the plot itself is replaced whenever the viewport is
 * refused, admitted or given a new spectrum; the wheel listener is on the
 * drawing, which is why the two are separate constants rather than one.
 */
export const SPECTRUM_PLOT = "svg.spectrum-plot";
export const SPECTRUM_SURFACE = "div.spectrum-viewport-plot";
export const SPECTRUM_ACTIONS = ".spectrum-viewport-actions";
export const SPECTRUM_RANGE = "#spectrum-viewport-range";
export const SPECTRUM_STATUS = "#spectrum-viewport-status";

/** The plot's own viewBox, which its drawing area is a fraction of. */
const PLOT_VIEWBOX_WIDTH = 1_000;
const PADDING_LEFT = 64;
const PADDING_RIGHT = 12;

/**
 * The spectrum plot's own viewBox and padding, from `StickSpectrum.tsx`.
 *
 * The element scales to its container and sets `preserveAspectRatio="none"`, so
 * the only way from a client x to a fraction of the drawn band is through these
 * three numbers -- which is exactly why the component exports them to its
 * adapter rather than letting it guess.
 */
const SPECTRUM_VIEWBOX_WIDTH = 1_000;
const SPECTRUM_PADDING_LEFT = 8;
const SPECTRUM_PADDING_RIGHT = 8;

/** `buildRows` places scan n at n × 0.0125, and the seeded run below matches. */
export const RT_STEP = 0.0125;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Replaces the seeded preview's spectrum table with a run of `rowCount` scans.
 *
 * Built inside the page. Shipping tens of thousands of rows through an init
 * script would be megabytes of JSON in the driver payload, and the fixture is
 * deterministic either way.
 */
export async function seedARunOf(rowCount: number): Promise<void> {
  await browser.execute(
    (tableKey: string, count: number) => {
      const answers = (window as unknown as Record<string, Record<string, unknown>>)[tableKey];
      const preview = answers["open_mzml_preview"] as {
        runSummary: { totalSpectrumCount: number; retentionTimeRange: unknown };
        spectrumTable: { rows: unknown[]; totalRowCount: number; truncated: boolean };
      };
      const rows = new Array<unknown>(count);
      for (let index = 0; index < count; index += 1) {
        rows[index] = {
          index,
          identifier: `controllerType=0 controllerNumber=1 scan=${String(index + 1)}`,
          scanNumber: index + 1,
          msLevel: index % 4 === 0 ? 1 : 2,
          retentionTime: { value: index * 0.0125, unitKnown: false },
          basePeakMz: 400 + (index % 500),
          // Deterministic and shaped, so a reduction that dropped an extreme
          // would be dropping something a test can name.
          basePeakIntensity: 10 + ((index * 3) % 900),
          totalIonCurrent: 5_000 + ((index * 7) % 4_000),
          precursorMz: index % 4 === 0 ? null : 500 + (index % 300),
        };
      }
      preview.spectrumTable = { rows, totalRowCount: count, truncated: false };
      preview.runSummary.totalSpectrumCount = count;
      preview.runSummary.retentionTimeRange = {
        minimum: { value: 0, unitKnown: false },
        maximum: { value: (count - 1) * 0.0125, unitKnown: false },
      };
    },
    IPC_TABLE_KEY,
    rowCount,
  );
}

/**
 * A window, a preview and a viewer, in that order.
 *
 * The window size is set here rather than left to whatever the previous test
 * chose. The layout cases deliberately shrink it, and a pointer gesture aimed
 * at a plot that a 640px-tall window has scrolled out of view is a WebDriver
 * error rather than a finding.
 */
export interface OpenViewerOptions {
  readonly width?: number;
  readonly height?: number;
  readonly scans?: number;
  /**
   * The answer table to install, where the default one is not the subject.
   *
   * `ipcTable()` takes options of its own -- a refused viewport, a retained
   * source that outruns its transfer -- and a suite about those needs the table
   * built with them *before* the document loads, because the boundary is a
   * preload script. So the opener takes the table rather than the options: a
   * caller that wants a different backend passes `ipcTable({ … })` and this
   * function stays the one place a session is started.
   */
  readonly answers?: Record<string, unknown>;
}

export async function openTheViewer(options: OpenViewerOptions = {}): Promise<void> {
  await browser.setWindowSize(options.width ?? 1_366, options.height ?? 768);
  await installIpcBoundary(options.answers ?? ipcTable());
  await browser.url("/");
  const row = `li.dataset-row[data-handle="${MZML_ROW.handle}"]`;
  await browser.$(row).waitForDisplayed();
  if (options.scans !== undefined) {
    await seedARunOf(options.scans);
  }
  await browser.$(row).doubleClick();
  await browser.$(PLOT).waitForDisplayed({ timeout: 60_000 });
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed({
    timeout: 60_000,
  });
  // Nearest rather than centred: centring the plot in a scrolling column pushes
  // the captions below it out of view, and a control out of view reads as
  // absent to both a person and `getText`.
  await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
}

/**
 * The plot's own rectangle, which every pointer gesture is aimed at.
 *
 * Takes a selector so the same measurement serves both plots. The chromatogram
 * remains the default, because every caller written before there was a second
 * plot means that one.
 */
export async function plotBox(selector: string = PLOT): Promise<Box> {
  return browser.execute((css: string) => {
    const rect = document.querySelector(css)?.getBoundingClientRect();
    return rect === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, selector) as Promise<Box>;
}

/**
 * Scrolls the application's own owners until the plot is genuinely on screen.
 *
 * The export surface is taller than the three-panel column has room for -- it
 * was measured at 1366x768 for M4.3 and again for M4.4 -- so opening it puts the
 * plot below the fold and the panel scrolls. A gesture test that computed a
 * pointer position from the plot's box without this asks the driver to move
 * outside the window, and the driver refuses.
 *
 * Through the product's scroll owners rather than `scrollIntoView`, which drives
 * the browser: a plot only the WebDriver can reveal is not one a user can reach,
 * and this has to fail in that case rather than paper over it.
 *
 * Answers the *visible* part of the plot afterwards, which is what a caller
 * wanting to put a pointer on it needs. See [[visiblePlotBox]].
 */
export async function revealThePlot(selector: string = PLOT): Promise<Box> {
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
  }, selector);
  return visiblePlotBox(selector);
}

/**
 * The part of the plot a pointer could actually be put on.
 *
 * Not the same thing as [[plotBox]], and the difference is the point. The plot
 * is routinely taller than the band its panel gives it -- the three-panel
 * column is measured, and the export surface takes its room from the same
 * column -- so the plot's own rectangle names a region that is partly painted
 * nowhere. A driver asked to move to the centre of that rectangle refuses, and
 * `elementFromPoint` there answers with whatever is drawn instead.
 *
 * So this is the intersection of the plot with the viewport and with every
 * ancestor that clips: where the plot is, on screen, right now. An empty answer
 * means the plot is not visible at all, which is a real failure rather than a
 * measurement to work around.
 */
export async function visiblePlotBox(selector: string = PLOT): Promise<Box> {
  return browser.execute((css: string) => {
    const plot = document.querySelector(css);
    if (plot === null) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const rect = plot.getBoundingClientRect();
    let left = Math.max(rect.left, 0);
    let top = Math.max(rect.top, 0);
    let right = Math.min(rect.right, window.innerWidth);
    let bottom = Math.min(rect.bottom, window.innerHeight);
    for (
      let node: HTMLElement | null = (plot as HTMLElement).parentElement;
      node !== null && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") {
        continue;
      }
      const bounds = node.getBoundingClientRect();
      left = Math.max(left, bounds.left);
      top = Math.max(top, bounds.top);
      right = Math.min(right, bounds.right);
      bottom = Math.min(bottom, bounds.bottom);
    }
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }, selector) as Promise<Box>;
}

/** Where a fraction of the drawn width falls, in page pixels. */
export async function pointAt(fraction: number): Promise<{ readonly x: number; readonly y: number }> {
  const box = await plotBox();
  const left = box.left + (PADDING_LEFT / PLOT_VIEWBOX_WIDTH) * box.width;
  const drawn =
    ((PLOT_VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT) / PLOT_VIEWBOX_WIDTH) * box.width;
  return { x: Math.round(left + fraction * drawn), y: Math.round(box.top + box.height / 2) };
}

/** Where a retention time falls, under the range currently on screen. */
export async function pointAtRetentionTime(
  retentionTime: number,
): Promise<{ readonly x: number; readonly y: number }> {
  const domain = await visibleDomain();
  return pointAt((retentionTime - domain.low) / (domain.high - domain.low));
}

/**
 * Takes the pointer off the plot, so the readout reports the selection again.
 *
 * A real move rather than a synthesised event: React listens for pointer exits
 * at the document root, and a non-bubbling event dispatched on the element
 * never reaches it.
 */
export async function leaveThePlot(): Promise<void> {
  const box = await plotBox();
  await browser
    .action("pointer")
    .move({ x: Math.round(box.left + box.width / 2), y: Math.max(1, Math.round(box.top) - 6) })
    .perform();
}

export async function readout(): Promise<string> {
  return (await browser.$(READOUT).getText()).trim();
}

export async function rangeCaption(): Promise<string> {
  return (await browser.$(RANGE).getText()).trim();
}

/** What the range caption says is on screen, as numbers. */
export async function visibleDomain(): Promise<{ readonly low: number; readonly high: number }> {
  const caption = await rangeCaption();
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  return { low: Number(low), high: Number(high) };
}

export async function visibleSpan(): Promise<number> {
  const domain = await visibleDomain();
  return domain.high - domain.low;
}

/** Which table row is marked selected, by its position in the run. */
export async function selectedRowPosition(): Promise<number | null> {
  return browser.execute(() => {
    const row = document.querySelector('div.spectrum-table-row[aria-selected="true"]');
    const position = row?.getAttribute("data-row-position");
    return position === undefined || position === null ? null : Number(position);
  });
}

/** How many times the viewer has read the backend, which no gesture may do. */
export function viewerReads(calls: readonly { readonly command: string }[]): number {
  return calls.filter(
    (call) => call.command === "load_selected_spectrum" || call.command === "open_mzml_preview",
  ).length;
}

/** Clicks the plot at a page position, as a press and a release. */
export async function clickThePlotAt(x: number, y: number): Promise<void> {
  await browser.action("pointer").move({ x, y }).down().up().perform();
}

/**
 * Commits one scan from the table, so the spectrum panel has a spectrum in it.
 *
 * Dispatched rather than driven, for the geometry reason the reveal cases in
 * `viewer-r1-linked-viewer` measure: WebDriver scrolls an element it thinks is
 * out of view to its container's *top edge* before clicking it, which in this
 * table is underneath the sticky column header -- so the click is intercepted by
 * the header and the failure says nothing about the application. What this
 * helper is for is having a spectrum, not proving how a row is chosen; that is
 * the linked viewer's own question and is asked there.
 *
 * Waits on the viewport's own range line rather than on the drawing. A refused
 * spectrum draws its points and says there is no range to navigate, and a
 * spectrum whose drawing failed draws nothing at all -- both are states this
 * helper's callers exist to measure, so neither may be waited past.
 */
export async function selectTheSpectrum(position = 0): Promise<void> {
  await browser.execute((row: number) => {
    document
      .querySelector(`div.spectrum-table-row[data-row-position="${String(row)}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, position);
  await browser.$(SPECTRUM_PLOT).waitForExist({ timeout: 60_000 });
  await browser.waitUntil(
    async () =>
      browser.execute(
        (css: string) => (document.querySelector(css)?.textContent ?? "").length > 0,
        SPECTRUM_RANGE,
      ),
    { timeout: 60_000, timeoutMsg: "the selected spectrum never reported an m/z range" },
  );
}

/** A window, a preview, a viewer and one selected spectrum, in that order. */
export async function openTheSpectrum(options: OpenViewerOptions = {}): Promise<void> {
  await openTheViewer(options);
  await selectTheSpectrum();
}

/**
 * Scrolls the application's own owners until the spectrum plot is on screen.
 *
 * The spectrum panel is the third of three in a column that scrolls, and it
 * scrolls inside itself as well, so at every window this suite measures the plot
 * starts below the fold. Through the product's scroll owners rather than the
 * driver's, for the reason [[revealThePlot]] gives: a plot only WebDriver can
 * reveal is not one a user can reach.
 */
export async function revealTheSpectrum(): Promise<Box> {
  return revealThePlot(SPECTRUM_PLOT);
}

/** Where a fraction of the spectrum plot's drawn band falls, in page pixels. */
export async function spectrumPointAt(
  fraction: number,
): Promise<{ readonly x: number; readonly y: number }> {
  const box = await plotBox(SPECTRUM_PLOT);
  // The vertical coordinate comes from the *visible* part, because a driver
  // asked to move to a point the panel has scrolled away refuses. The
  // horizontal one comes from the layout box, because that is the mapping the
  // adapter itself uses and nothing clips this plot sideways.
  const visible = await visiblePlotBox(SPECTRUM_PLOT);
  const left = box.left + (SPECTRUM_PADDING_LEFT / SPECTRUM_VIEWBOX_WIDTH) * box.width;
  const drawn =
    ((SPECTRUM_VIEWBOX_WIDTH - SPECTRUM_PADDING_LEFT - SPECTRUM_PADDING_RIGHT) /
      SPECTRUM_VIEWBOX_WIDTH) *
    box.width;
  return {
    x: Math.round(left + fraction * drawn),
    y: Math.round(visible.top + visible.height / 2),
  };
}

/** What the viewport says is on screen, verbatim. */
export async function spectrumRangeCaption(): Promise<string> {
  return (await browser.$(SPECTRUM_RANGE).getText()).trim();
}

/** What the viewport says it is doing, which is empty while a drawing stands. */
export async function spectrumStatus(): Promise<string> {
  return (await browser.$(SPECTRUM_STATUS).getText()).trim();
}

/** The m/z range on screen, as numbers, at the caption's own four decimals. */
export async function spectrumDomain(): Promise<{ readonly low: number; readonly high: number }> {
  const caption = await spectrumRangeCaption();
  const [, low, high] = /Showing m\/z ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  return { low: Number(low), high: Number(high) };
}

export async function spectrumSpan(): Promise<number> {
  const domain = await spectrumDomain();
  return domain.high - domain.low;
}

/** How many drawings of the retained spectrum this session has asked Rust for. */
export function spectrumProjections(
  calls: readonly { readonly command: string; readonly args: Record<string, unknown> }[],
): readonly { readonly low: number; readonly high: number }[] {
  return calls
    .filter((call) => call.command === "project_selected_spectrum")
    .map((call) => ({ low: Number(call.args["low"]), high: Number(call.args["high"]) }));
}
