/**
 * The whole save path, for real: the interface, the production command, the
 * platform's own dialog, the transactional writer, and a file on disk.
 *
 * This is what M4.1 could not do. Reaching an export needs a loaded spectrum,
 * loading one needs a ProteoWizard installation and an mzML file, and a QA
 * machine has neither -- so Rust held no snapshot and the export refused the
 * stale token before a dialog could open. Under the `e2e` feature Rust now
 * installs one synthetic spectrum into the ordinary slot at startup, and
 * everything after that is production code: `begin`, `claim`, the `FigureSpec`,
 * the renderer, the dialog, the no-clobber rename.
 *
 * ## Why the dialog is driven from another process
 *
 * It is modal and it belongs to the operating system. While it stands open the
 * WebView is held, so the WebDriver command that clicked the button has not
 * returned and no other can be issued. The handler is therefore started *before*
 * the click and races it to the window, selecting by automation id rather than
 * by the localised control names this machine reports in Chinese.
 *
 * ## What this does not prove
 *
 * That ProteoWizard can read an mzML file. It was never meant to: the spectrum
 * is synthetic and reaches the slot through the production parser. What it
 * closes is the export and save residual, which is what M4.1 left unproved.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chooseFigure,
  loadWith,
  selectFirstSpectrum,
  statusText,
  tauriTable,
  waitForOutcome,
} from "../support/tauriPanel";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "..", "native", "save-dialog.ps1");



/** The titles the application gives its own save dialogs. */
const FIGURE_DIALOG = "Export spectrum figure";

interface DialogResult {
  readonly found: boolean;
  readonly named: boolean;
  readonly invoked: boolean;
  readonly detail: string;
  /** Which top-level windows were on screen, when none matched. */
  readonly seen?: string[];
}

/**
 * Starts the dialog handler and answers with a promise for what it did.
 *
 * Started before the click, because after it nothing else can run.
 */
function handleDialog(
  action: "save" | "cancel",
  path?: string,
  timeoutSeconds = 90,
): Promise<{ readonly code: number; readonly result: DialogResult | null }> {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    DRIVER,
    "-Title",
    FIGURE_DIALOG,
    "-Action",
    action,
    "-TimeoutSeconds",
    String(timeoutSeconds),
  ];
  if (path !== undefined) {
    args.push("-Path", path);
  }
  const child = spawn("powershell.exe", args, { windowsHide: true });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  return new Promise((settle) => {
    child.on("close", (code) => {
      const match = /\{.*\}/su.exec(stdout);
      settle({
        code: code ?? -1,
        result: match === null ? null : (JSON.parse(match[0]) as DialogResult),
      });
    });
  });
}

/** What a PNG says about itself, read out of the bytes rather than assumed. */
function readPng(bytes: Buffer): {
  readonly signature: boolean;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly pixelsPerMetre: number | null;
  readonly unit: number | null;
  readonly dataBytes: number;
} {
  const signature = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  let offset = 8;
  let pixelsPerMetre: number | null = null;
  let unit: number | null = null;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const body = offset + 8;
    if (kind === "pHYs") {
      pixelsPerMetre = bytes.readUInt32BE(body);
      unit = bytes.readUInt8(body + 8);
    }
    if (kind === "IDAT") {
      dataBytes += length;
    }
    if (kind === "IEND") {
      break;
    }
    offset = body + length + 4;
  }
  return {
    signature,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes.readUInt8(24),
    colourType: bytes.readUInt8(25),
    pixelsPerMetre,
    unit,
    dataBytes,
  };
}

describe("M4.2 saving a figure through the real dialog", () => {
  let workspace = "";

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), "mscanvas-native-"));
    await loadWith(
      tauriTable({
        real: [
          "begin_selected_spectrum_export",
          "save_selected_spectrum_export",
          "copy_selected_spectrum_plot",
          "begin_chromatogram_export",
          "save_chromatogram_export",
          "copy_chromatogram_plot",
        ],
      }),
    );
    await selectFirstSpectrum();
  });

  afterEach(async () => {
    // A dialog left standing holds the WebView and the export slot, and every
    // later test in this file would fail on a modal window nobody can see. So
    // whatever happened, anything still open is dismissed before moving on.
    const stray = await handleDialog("cancel", undefined, 3);
    if (stray.result?.invoked === true) {
      console.log("NOTE: a stray save dialog was left open and has been dismissed");
    }
  });

  afterEach(() => {
    // Nothing this suite writes survives it. A stray PNG in a temporary
    // directory is the kind of residue that makes the next run's assertions
    // ambiguous.
    if (workspace !== "") {
      rmSync(workspace, { recursive: true, force: true });
      workspace = "";
    }
  });

  it("writes a PNG of exactly the requested size and resolution", async () => {
    const destination = join(workspace, "figure.png");
    await chooseFigure({ width: "500", height: "400", dpi: "600" });

    const dialog = handleDialog("save", destination);
    await browser.$("button=Export PNG…").click();
    const handled = await dialog;

    if (handled.result?.found !== true) {
      // What the panel says is the only evidence of why no dialog opened: the
      // export may have been refused before one could be shown.
      const said = await statusText();
      throw new Error(
        `the save dialog never appeared. The panel says: "${said}". Windows on screen: ` +
          JSON.stringify(handled.result?.seen),
      );
    }
    expect(handled.result?.named).toBe(true);
    expect(handled.result?.invoked).toBe(true);

    expect(await waitForOutcome()).toContain("Saved");

    // The file itself, read from disk and parsed rather than trusted.
    expect(existsSync(destination)).toBe(true);
    const png = readPng(readFileSync(destination));
    expect(png.signature).toBe(true);
    expect(png.width).toBe(500);
    expect(png.height).toBe(400);
    expect(png.bitDepth).toBe(8);
    // 6 is RGBA, which is what this application writes.
    expect(png.colourType).toBe(6);
    // 1 is metres, the only unit PNG defines. 600 DPI is 23622 pixels a metre.
    expect(png.unit).toBe(1);
    expect(png.pixelsPerMetre).toBe(Math.round(600 / 0.0254));
    // Not an empty image.
    expect(png.dataBytes).toBeGreaterThan(500);

    // And the interface says what it wrote, naming the file and never a folder.
    const status = await statusText();
    expect(status).toContain("500 by 400 pixels at 600 DPI");
    expect(status).not.toContain(workspace);
    expect(status).not.toContain("C:\\");
  });

  it("writes an SVG through the same path", async () => {
    const destination = join(workspace, "figure.svg");
    await chooseFigure({ width: "900", height: "500", dpi: "300" });

    const dialog = handleDialog("save", destination);
    await browser.$("button=Export SVG…").click();
    await dialog;

    expect(await waitForOutcome()).toContain("Saved");

    expect(existsSync(destination)).toBe(true);
    const svg = readFileSync(destination, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    // The figure's own semantics, at the size that was asked for.
    expect(svg).toContain('width="900"');
    expect(svg).toContain('height="500"');
    // A vector figure has no physical resolution, and says nothing about one.
    expect(svg).not.toContain("600 DPI");
  });

  it("writes a chromatogram data file through the same real dialog", async () => {
    /*
     * The other scientific export surface, through the same boundary. Rust owns
     * the path, the suggested name comes from the request rather than from
     * anything about the source, and what lands on disk is the document the
     * retained facts describe -- so this is where the schema stops being a unit
     * test and becomes a file.
     */
    const destination = join(workspace, "chromatogram.csv");
    await browser.$("button#chromatogram-export-toggle").click();
    await browser.$("#chromatogram-export-panel").waitForDisplayed({ timeout: 30_000 });

    const dialog = handleDialog("save", destination);
    await browser.$("#chromatogram-export-panel").$("button=Export CSV…").click();
    const handled = await dialog;

    expect(handled.result?.found).toBe(true);
    expect(handled.result?.invoked).toBe(true);

    const status = await waitForOutcome();
    expect(status).toContain("Saved");
    expect(existsSync(destination)).toBe(true);

    // The document Rust wrote, read back from disk.
    const written = readFileSync(destination, "utf8");
    expect(written).toContain("#format,mscanvas_chromatogram_export");
    expect(written).toContain("#schema_version,1");
    expect(written).toContain("#source,per_scan_spectrum_table");
    expect(written).toContain("#range_scope,full");
    expect(written).toContain(
      "spectrum_index,scan_number,ms_level,retention_time,total_ion_current,base_peak_intensity",
    );
    // Both measured columns, and one record per scan of the seeded run.
    const records = written
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .slice(1);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.split(",").length).toBe(6);
    }
    // Nothing about where it came from reached the file.
    expect(written).not.toContain("mzML");
    expect(written).not.toContain(workspace);
  });

  it("treats a dismissed chromatogram dialog as an outcome and writes nothing", async () => {
    await browser.$("button#chromatogram-export-toggle").click();
    await browser.$("#chromatogram-export-panel").waitForDisplayed({ timeout: 30_000 });

    const dialog = handleDialog("cancel");
    await browser.$("#chromatogram-export-panel").$("button=Export SVG…").click();
    const handled = await dialog;

    expect(handled.result?.found).toBe(true);
    expect(handled.result?.invoked).toBe(true);

    const status = await waitForOutcome();
    expect(status).toContain("cancelled");
    expect(status).not.toContain("Saved");
    expect(existsSync(join(workspace, "chromatogram.svg"))).toBe(false);
  });

  it("treats a dismissed dialog as an outcome and writes nothing", async () => {
    const dialog = handleDialog("cancel");
    await browser.$("button=Export PNG…").click();
    const handled = await dialog;

    expect(handled.result?.found).toBe(true);
    expect(handled.result?.invoked).toBe(true);

    const status = await waitForOutcome();
    expect(status).toContain("cancelled");
    expect(status).not.toContain("Saved");
    // Nothing was created anywhere this test could have written to.
    expect(existsSync(join(workspace, "figure.png"))).toBe(false);
  });
});
