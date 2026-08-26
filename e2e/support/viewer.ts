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

/** The plot's own viewBox, which its drawing area is a fraction of. */
const PLOT_VIEWBOX_WIDTH = 1_000;
const PADDING_LEFT = 64;
const PADDING_RIGHT = 12;

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
export async function openTheViewer(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly scans?: number;
  } = {},
): Promise<void> {
  await browser.setWindowSize(options.width ?? 1_366, options.height ?? 768);
  await installIpcBoundary(ipcTable());
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

/** The plot's own rectangle, which every pointer gesture is aimed at. */
export async function plotBox(): Promise<Box> {
  return browser.execute((css: string) => {
    const rect = document.querySelector(css)?.getBoundingClientRect();
    return rect === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, PLOT) as Promise<Box>;
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
export async function revealThePlot(): Promise<Box> {
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
  return visiblePlotBox();
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
export async function visiblePlotBox(): Promise<Box> {
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
  }, PLOT) as Promise<Box>;
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
