/**
 * Viewer Closure scale QA — the linked viewer at the representative run size.
 *
 * ADR 0003 measured the representative acquisition at 36,319 spectra, so that
 * is the size the DOM is asked to hold here. The questions are structural
 * rather than aesthetic: does the table still window its rows, does the plot
 * still draw a bounded number of nodes, and does moving the viewport still ask
 * the backend for nothing.
 *
 * The table is built inside the page. Shipping 36,319 rows through an init
 * script would be megabytes of JSON in the driver payload, and the fixture is
 * deterministic either way.
 *
 * Timings printed here are observations on one machine, not thresholds. Every
 * assertion is on structure.
 */

import { IPC_TABLE_KEY, installIpcBoundary, ipcCalls } from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";

/** The repository's measured representative scan count. */
const REPRESENTATIVE_SCANS = 36_319;

const PLOT = "svg.chromatogram-svg";
const READOUT = ".chromatogram-readout";

interface PlotBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Replaces the preview's spectrum table with a synthetic run of `rowCount`. */
async function seedARunOf(rowCount: number): Promise<void> {
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
          // Deterministic and shaped, so a reduction that dropped extremes
          // would be dropping something a test could name.
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

async function openTheRun(rowCount: number): Promise<number> {
  await browser.setWindowSize(1366, 768);
  await installIpcBoundary(ipcTable());
  await browser.url("/");
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();
  await seedARunOf(rowCount);
  const started = Date.now();
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).doubleClick();
  await browser.$(PLOT).waitForDisplayed({ timeout: 60_000 });
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed({
    timeout: 60_000,
  });
  return Date.now() - started;
}

async function plotBox(): Promise<PlotBox> {
  return browser.execute((css: string) => {
    const rect = document.querySelector(css)?.getBoundingClientRect();
    return rect === undefined
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, PLOT);
}

describe(`the linked viewer at ${String(REPRESENTATIVE_SCANS)} scans`, () => {
  it("windows the table and bounds the plot instead of drawing every scan", async () => {
    const openMs = await openTheRun(REPRESENTATIVE_SCANS);

    const counts = await browser.execute((css: string) => {
      const svg = document.querySelector(css);
      const paths = [...(svg?.querySelectorAll("path.chromatogram-trace") ?? [])];
      return {
        rows: document.querySelectorAll("div.spectrum-table-row").length,
        paths: paths.length,
        circles: svg?.querySelectorAll("circle").length ?? 0,
        svgNodes: svg?.querySelectorAll("*").length ?? 0,
        vertices: paths.reduce(
          (total, path) => total + (path.getAttribute("d") ?? "").split(/[ML]/u).length,
          0,
        ),
      };
    }, PLOT);

    // The table is still windowed: tens of rows in the document, not tens of
    // thousands.
    expect(counts.rows).toBeGreaterThan(0);
    expect(counts.rows).toBeLessThan(200);
    // One path for the one visible trace, and no node per scan.
    expect(counts.paths).toBe(1);
    expect(counts.circles).toBe(0);
    expect(counts.svgNodes).toBeLessThan(40);
    // The drawing is a screen budget rather than a share of the run.
    expect(counts.vertices).toBeLessThan(4_000);

    // eslint-disable-next-line no-console
    console.log(
      `OBSERVATION open-to-linked-views ${String(openMs)} ms for ` +
        `${String(REPRESENTATIVE_SCANS)} scans, ${String(counts.rows)} table rows and ` +
        `${String(counts.vertices)} plot vertices in the document`,
    );
  });

  it("answers pointer moves without asking the backend", async () => {
    await openTheRun(REPRESENTATIVE_SCANS);
    const before = (await ipcCalls()).length;
    const box = await plotBox();
    const y = Math.round(box.top + box.height / 2);

    const started = Date.now();
    let moves = browser.action("pointer");
    for (let step = 0; step < 40; step += 1) {
      moves = moves.move({
        x: Math.round(box.left + 70 + (step / 40) * (box.width - 90)),
        y,
      });
    }
    await moves.perform();
    const hoverMs = Date.now() - started;

    await browser.waitUntil(
      async () => (await browser.$(READOUT).getText()).startsWith("Hovering"),
      { timeout: 20_000, timeoutMsg: "the plot never reported a hovered scan at this scale" },
    );

    // Forty pointer moves over a 36,319-scan run, and nothing crossed the
    // boundary. Hover is a lookup, not a read.
    expect((await ipcCalls()).length).toBe(before);

    // eslint-disable-next-line no-console
    console.log(`OBSERVATION 40 pointer moves ${String(hoverMs)} ms at this scale`);
  });

  it("zooms and pans this run without asking the backend for anything", async () => {
    await openTheRun(REPRESENTATIVE_SCANS);
    const before = (await ipcCalls()).length;

    const started = Date.now();
    await browser.$("button=Zoom in").click();
    await browser.$("button=Zoom in").click();
    await browser.$("button=Zoom out").click();
    await browser.$("button=Reset range").click();
    const viewportMs = Date.now() - started;

    expect((await ipcCalls()).length).toBe(before);
    expect(await browser.$(".chromatogram-range").getText()).toContain("full range");

    // eslint-disable-next-line no-console
    console.log(`OBSERVATION four viewport actions ${String(viewportMs)} ms at this scale`);
  });

  it("selects the scan that was pointed at, out of every scan in the run", async () => {
    // The lookup is over the full model rather than the drawn vertices, and at
    // this size the difference is the point: the plot draws well under a
    // thousand vertices for 36,319 scans, so a click resolved against the
    // drawing could not land this close to a named scan.
    await openTheRun(REPRESENTATIVE_SCANS);

    const box = await plotBox();
    const drawn = ((1_000 - 64 - 12) / 1_000) * box.width;
    const x = Math.round(box.left + (64 / 1_000) * box.width + drawn * 0.5);
    const y = Math.round(box.top + box.height / 2);
    await browser.action("pointer").move({ x, y }).down().up().perform();

    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelector('div.spectrum-table-row[aria-selected="true"]') !== null,
        ),
      { timeout: 20_000, timeoutMsg: "the click never selected a scan" },
    );

    const reads = (await ipcCalls()).filter((call) => call.command === "load_selected_spectrum");
    expect(reads).toHaveLength(1);
    const index = Number(reads[0]?.args["index"]);
    expect(Math.abs(index - REPRESENTATIVE_SCANS / 2)).toBeLessThan(REPRESENTATIVE_SCANS * 0.02);
  });
});
