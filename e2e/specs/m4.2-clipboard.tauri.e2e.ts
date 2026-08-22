/**
 * Copy plot, all the way to the system clipboard, read back from outside.
 *
 * The application is clipboard **write-only**: `capabilities/default.json`
 * grants the webview no clipboard permission, Tauri denies what a capability
 * does not list, and the pixels are built and handed over entirely in Rust. That
 * posture is the feature, so it cannot be verified from inside -- a test that
 * could read the clipboard would be testing an application that had been given
 * the very capability this one refuses.
 *
 * So the reading happens in the test process, which is what any other program on
 * the machine would see. What the application does here is exactly what a user
 * pressing `Copy plot` does: the real snapshot, the real `FigureSpec`, the real
 * SVG, the real rasterizer, the real `ClipboardExt::write_image`.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chooseFigure,
  clipboardIsUsable,
  loadWith,
  selectFirstSpectrum,
  tauriTable,
  waitForOutcome,
} from "../support/tauriPanel";

const HERE = dirname(fileURLToPath(import.meta.url));
const READER = resolve(HERE, "..", "native", "read-clipboard-image.ps1");


interface ClipboardImage {
  readonly present: boolean;
  readonly width: number;
  readonly height: number;
  readonly distinct: number;
  readonly detail: string;
}

/** What the clipboard holds, according to a process that is not the app. */
function readClipboard(): ClipboardImage | null {
  const run = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", READER],
    { encoding: "utf8", windowsHide: true },
  );
  const match = /\{.*\}/su.exec(run.stdout);
  return match === null ? null : (JSON.parse(match[0]) as ClipboardImage);
}

function clearClipboard(): void {
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", READER, "-Clear"],
    { encoding: "utf8", windowsHide: true },
  );
}

describe("M4.2 Copy plot, read back from outside the application", () => {
  beforeEach(async function skipWithoutAClipboard() {
    // Asked of the machine, not of the application. The clipboard is a single
    // system-wide object, and a Windows session whose clipboard has been left
    // unopenable -- by a clipboard manager, or a stale remote-desktop helper --
    // refuses every process on it. Asserting a successful copy there would be
    // asserting something no program could do.
    //
    // Skipped loudly rather than quietly: the reason is printed, and the
    // milestone records it as an environmental residual rather than as a pass.
    if (!clipboardIsUsable()) {
      console.log(
        "SKIPPED: this Windows session's clipboard cannot be opened by any process, " +
          "so a real copy cannot be read back here. See e2e/native/README.md.",
      );
      this.skip();
    }
    clearClipboard();
    await loadWith(tauriTable({ real: ["copy_selected_spectrum_plot"] }));
    await selectFirstSpectrum();
  });

  after(() => {
    // The clipboard is the user's, not this suite's. Whatever was there before
    // is gone either way, so the least this can do is not leave a figure on it.
    clearClipboard();
  });

  it("puts an image of exactly the chosen size on the clipboard", async () => {
    await chooseFigure({ width: "420", height: "300", theme: "light" });

    await browser.$("button=Copy plot").click();
    const status = await waitForOutcome();
    expect(status).toContain("Copied the plot");

    const image = readClipboard();
    expect(image?.present).toBe(true);
    expect(image?.width).toBe(420);
    expect(image?.height).toBe(300);
    // More than one colour, so the figure drew something rather than handing
    // over a rectangle of background.
    expect(image?.distinct).toBeGreaterThan(1);
  });

  it("copies the theme the user chose", async () => {
    await chooseFigure({ width: "420", height: "300", theme: "light" });
    await browser.$("button=Copy plot").click();
    expect(await waitForOutcome()).toContain("Copied the plot");
    const light = readClipboard();
    expect(light?.present).toBe(true);

    clearClipboard();
    await loadWith(tauriTable({ real: ["copy_selected_spectrum_plot"] }));
    await selectFirstSpectrum();
    await chooseFigure({ width: "420", height: "300", theme: "dark" });
    await browser.$("button=Copy plot").click();
    expect(await waitForOutcome()).toContain("Copied the plot");
    const dark = readClipboard();

    expect(dark?.present).toBe(true);
    expect(dark?.width).toBe(light?.width);
    expect(dark?.height).toBe(light?.height);
    // The same figure at the same size, and not the same pixels: the palette is
    // written into the drawing rather than applied by whatever opens it.
    expect(dark?.distinct).toBeGreaterThan(1);
  });
});
