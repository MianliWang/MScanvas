/**
 * Viewer Closure R1 scale QA — the linked viewer at the representative run size.
 *
 * ADR 0003 measured the representative acquisition at 36,319 spectra, so that
 * is the size the DOM is asked to hold here. The questions are structural
 * rather than aesthetic: does the table still window its rows, does the plot
 * still draw a bounded number of nodes, does a click still resolve against
 * every scan rather than the few thousand that were drawn, and does moving the
 * viewport still ask the backend for nothing.
 *
 * The table is built inside the page. Shipping 36,319 rows through an init
 * script would be megabytes of JSON in the driver payload, and the fixture is
 * deterministic either way.
 *
 * Timings printed here are observations on one machine, not thresholds. Every
 * assertion is on structure.
 */

import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, ipcCalls } from "../support/harness";
import {
  PLOT,
  RT_STEP,
  clickThePlotAt,
  openTheViewer,
  pointAt,
  pointAtRetentionTime,
  readout,
  selectedRowPosition,
  viewerReads,
} from "../support/viewer";

/** The repository's measured representative scan count. */
const REPRESENTATIVE_SCANS = 36_319;

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

async function counts(): Promise<{
  readonly rows: number;
  readonly paths: number;
  readonly circles: number;
  readonly svgNodes: number;
  readonly vertices: number;
}> {
  return browser.execute((css: string) => {
    const svg = document.querySelector(css);
    const paths = [...(svg?.querySelectorAll("path.chromatogram-trace") ?? [])];
    return {
      rows: document.querySelectorAll("div.spectrum-table-window div.spectrum-table-row").length,
      paths: paths.length,
      circles: svg?.querySelectorAll("circle").length ?? 0,
      svgNodes: svg?.querySelectorAll("*").length ?? 0,
      vertices: paths.reduce(
        (total, path) => total + ((path.getAttribute("d") ?? "").split(/[ML]/u).length - 1),
        0,
      ),
    };
  }, PLOT);
}

describe(`the linked viewer at ${String(REPRESENTATIVE_SCANS)} scans`, () => {
  it("windows the table and bounds the trace instead of drawing every scan", async () => {
    const startedAt = Date.now();
    await openTheViewer({ scans: REPRESENTATIVE_SCANS });
    const openMs = Date.now() - startedAt;

    const measured = await counts();

    // The table is still windowed: tens of rows in the document, not tens of
    // thousands.
    expect(measured.rows).toBeGreaterThan(0);
    expect(measured.rows).toBeLessThan(200);
    // One path for the one visible trace, and no node per scan. The point glyph
    // belongs to a trace whose *visible geometry* is a single vertex; a run of
    // 36,319 scans has a line, and must not become a scatter plot.
    expect(measured.paths).toBe(1);
    expect(measured.circles).toBe(0);
    expect(
      await browser.execute(
        () => document.querySelectorAll("circle.chromatogram-point").length,
      ),
    ).toBe(0);
    // A screen budget rather than the run's size: at most four vertices per
    // column, over 900 columns.
    expect(measured.vertices).toBeLessThanOrEqual(3_600);
    expect(measured.svgNodes).toBeLessThan(40);

    // Both traces, and it is still one path each.
    await browser.$("//span[normalize-space()='BPC']/preceding-sibling::input").click();
    const both = await counts();
    expect(both.paths).toBe(2);
    expect(both.vertices).toBeLessThanOrEqual(7_200);

    console.log(
      `SCALE ${String(REPRESENTATIVE_SCANS)} scans: open ${String(openMs)}ms, ` +
        `${String(measured.rows)} rendered rows, ${String(measured.paths)} trace path, ` +
        `${String(measured.vertices)} drawn vertices, ${String(measured.svgNodes)} svg nodes.`,
    );
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("resolves a click against every scan rather than the vertices it drew", async () => {
    await openTheViewer({ scans: REPRESENTATIVE_SCANS });

    const target = 12_345;
    const at = await pointAtRetentionTime(target * RT_STEP);
    const startedAt = Date.now();
    await clickThePlotAt(at.x, at.y);
    await browser.waitUntil(async () => (await selectedRowPosition()) !== null, {
      timeout: 20_000,
      timeoutMsg: "the click never selected a scan",
    });
    const selectMs = Date.now() - startedAt;

    const selected = await selectedRowPosition();
    // Within a scan of the pointer, which is the resolution of the plot itself:
    // 36,319 scans over about 900 drawn pixels is roughly 40 scans per pixel,
    // and a click lands on the nearest of them.
    expect(selected).not.toBeNull();
    expect(Math.abs((selected ?? 0) - target)).toBeLessThanOrEqual(40);
    const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.args["index"]).toBe(selected);

    console.log(`SCALE click to selected row: ${String(selectMs)}ms.`);
  });

  it("asks the backend for nothing while the pointer and the viewport move", async () => {
    await openTheViewer({ scans: REPRESENTATIVE_SCANS });
    const before = viewerReads(await ipcCalls());

    const startedAt = Date.now();
    // Real pointer motion across the plot. At this run size nearly every frame
    // crosses into another scan, which is the case worth measuring.
    const path = browser.action("pointer");
    for (let step = 0; step <= 20; step += 1) {
      const at = await pointAt(step / 20);
      path.move({ x: at.x, y: at.y });
    }
    await path.perform();
    const hoverMs = Date.now() - startedAt;

    expect(await readout()).toMatch(/^Hovering index /u);

    const middle = await pointAt(0.5);
    await browser.action("wheel").scroll({ x: middle.x, y: middle.y, deltaY: -240 }).perform();
    await browser.$("button=Zoom in").click();
    await browser.$("button=Zoom out").click();
    await browser.$("button=Reset range").click();

    expect(viewerReads(await ipcCalls())).toBe(before);
    // The table is still windowed after all of it.
    expect((await counts()).rows).toBeLessThan(200);

    // Driver-paced rather than application-paced: WebDriver gives each
    // pointer move its own duration, so this is the cost of *driving* 21
    // frames and not the cost of rendering them.
    console.log(
      `SCALE 21 driver-paced pointer frames across the plot: ${String(hoverMs)}ms.`,
    );
    expect(await unexpectedConsole()).toEqual([]);
  });
});
