/**
 * M4.2 on the real thing, with a real spectrum behind it.
 *
 * The M4.1 suite beside this one proves the shipped composition stands up. What
 * this one adds is that the export path is *reachable*: under the `e2e` feature
 * Rust installs one synthetic spectrum into the ordinary export slot at startup,
 * so the production commands have something real to name.
 *
 * That changes what a rendered test can settle. `begin_selected_spectrum_export`
 * is no longer answered from a table -- it runs, validates the settings, matches
 * the token against the retained snapshot and issues a reservation. `Copy plot`
 * runs all the way: the real `FigureSpec`, the real SVG, the real rasterizer and
 * the real clipboard call. Neither opens a dialog, which is why they belong here
 * rather than in `e2e/native/`.
 *
 * What is still answered from the table is the part that would need a
 * ProteoWizard installation and an mzML file: the roster, opening a preview and
 * reading a spectrum. The panel is rendered from those answers, and the token it
 * carries is the one Rust actually holds.
 */

import {
  SEEDED_TOKEN,
  chooseFigure,
  clipboardIsUsable,
  dismissExportMessage,
  focusApplicationWindow,
  ipcCalls,
  loadWith,
  openSpectrumFigureDialog,
  pressDialogAction,
  selectFirstSpectrum,
  statusText,
  tauriTable,
  waitForOutcome,
} from "../support/tauriPanel";

/** The localized owned-error wording (M7.4) for Rust's raster and DPI refusals. */
const RASTER_BUDGET = /limited to 32[,.\u00a0\u202f ]?000[,.\u00a0\u202f ]?000 pixels/u;
const DPI_RANGE = "72\u20131200";

/**
 * Everything the panel currently shows, in one round trip.
 *
 * One `execute` rather than a query per control. On a real WebView each round
 * trip is milliseconds that add up across a suite.
 */
async function panelFacts(): Promise<{
  readonly actions: string[];
  readonly fields: Record<string, string>;
  readonly theme: string | null;
}> {
  return browser.execute(() => {
    // The figure dialog since the rebuild (spec 3.4).
    const panel = document.querySelector(".figure-export-dialog");
    const fields: Record<string, string> = {};
    for (const field of panel?.querySelectorAll(".spectrum-figure-settings .spectrum-figure-field") ?? []) {
      const input = field.querySelector("input");
      const label = field.querySelector("label");
      const name = (label?.textContent ?? "").trim().split(" ")[0] ?? "";
      if (input instanceof HTMLInputElement && name !== "") {
        fields[name] = input.value;
      }
    }
    // The theme is a segmented control of radio buttons: Light, then Dark.
    const checked = panel?.querySelector(".spectrum-figure-field-theme [role='radio'][aria-checked='true']");
    return {
      // Document order: the Data group's CSV and TSV, then the footer's Copy, SVG and PNG.
      actions: [...(panel?.querySelectorAll(".figure-export-data-actions button, .figure-export-actions button") ?? [])].map(
        (button) => (button.textContent ?? "").trim(),
      ),
      fields,
      theme: checked === null || checked === undefined ? null : (checked.textContent ?? "").trim().toLowerCase(),
    };
  });
}

describe("M4.2 on the real Tauri WebView", () => {
  // Every test establishes its own document. Sharing one made an earlier suite
  // depend on whatever the previous test happened to leave behind, and a
  // failure there was unreadable.
  beforeEach(async () => {
    // The begin half of an export and the copy command are left real; the save
    // half is answered, because its real implementation opens a modal dialog
    // this session has no authority over. `e2e/native/` drives that one.
    await loadWith(
      tauriTable({
        real: ["begin_selected_spectrum_export", "copy_selected_spectrum_plot"],
        extra: { save_selected_spectrum_export: { status: "cancelled" } },
      }),
    );
    await selectFirstSpectrum();
    await openSpectrumFigureDialog();
  });

  it("renders every figure control and the settings it starts at", async () => {
    const facts = await panelFacts();

    expect(facts.actions).toEqual([
      "Export CSV…",
      "Export TSV…",
      "Copy plot",
      "Export SVG…",
      "Export PNG…",
    ]);
    expect(facts.fields).toEqual({ Width: "1200", Height: "640", PNG: "300" });
    expect(facts.theme).toBe("light");
  });

  it("carries the chosen settings into the real export command", async () => {
    // Not answered from the table: this is the production command, validating
    // the settings and matching the token against the spectrum Rust holds. A
    // reservation coming back is the proof -- a stale token or a size no figure
    // could be drawn at would have been refused instead.
    await chooseFigure({ width: "820", height: "540", dpi: "600", theme: "dark" });

    await pressDialogAction("Export PNG…");
    await waitForOutcome(60_000);

    const begun = (await ipcCalls()).filter(
      (call) => call.command === "begin_selected_spectrum_export",
    );
    expect(begun).toHaveLength(1);
    expect(begun[0]?.args["format"]).toBe("png");
    expect(begun[0]?.args["exportToken"]).toBe(SEEDED_TOKEN);
    expect(begun[0]?.args["settings"]).toEqual({
      widthPx: 820,
      heightPx: 540,
      pngDpi: 600,
      theme: "dark",
    });
    // The save half is answered from the table, so what the panel reports is
    // the cancellation that stands in for a dialog nobody dismissed.
    expect(await statusText()).toContain("cancelled");
  });

  it("refuses a figure the settings could not describe, without asking Rust", async () => {
    await browser.execute(() => {
      const input = document.querySelector(".figure-export-dialog input[id$='-widthPx']");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("The figure dialog's width field is missing.");
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Refused, not disabled (spec 1.4): still focusable, with the reason beside them.
    const blocked = await browser.execute(() =>
      [...document.querySelectorAll(".figure-export-dialog .figure-export-actions button")]
        .filter((button) => button.getAttribute("aria-disabled") === "true")
        .map((button) => (button.textContent ?? "").trim()),
    );
    expect(blocked).toEqual(["Copy plot", "Export SVG…", "Export PNG…"]);
    expect(
      (await ipcCalls()).filter((call) => call.command === "begin_selected_spectrum_export"),
    ).toEqual([]);
  });

  it("draws and copies the plot through the production path", async () => {
    // The whole of it, for real: the retained snapshot, the `FigureSpec`, the
    // deterministic SVG, `resvg`, and the platform clipboard call. No dialog, so
    // nothing here needs authority over a window this session does not own.
    //
    // Two outcomes are accepted, and exactly one assertion is made about each.
    // The clipboard is a single system-wide object, and a Windows session whose
    // clipboard has been left unopenable refuses *every* process -- asserting
    // "copied" there would be asserting something no program could do. What is
    // never acceptable is a third outcome: a crash, a wrong token, or a success
    // claimed without one.
    focusApplicationWindow();
    await pressDialogAction("Copy plot");
    const status = await waitForOutcome();

    const copied = (await ipcCalls()).filter(
      (call) => call.command === "copy_selected_spectrum_plot",
    );
    expect(copied).toHaveLength(1);
    expect(copied[0]?.args["exportToken"]).toBe(SEEDED_TOKEN);

    if (status.startsWith("Copied")) {
      expect(status).toContain("1,200 by 640 pixels");
      // The seeded spectrum's own point count, which came from Rust rather than
      // from anything this document holds.
      expect(status).toContain("64 points");
      return;
    }

    // The other honest end. It must be the typed clipboard refusal, and it must
    // not claim anything was copied.
    expect(clipboardIsUsable()).toBe(false);
    expect(status).toContain("Nothing was copied.");
    expect(status).toContain("Another program is holding the clipboard");
  });

  it("refuses a copy of a figure too large to hold as pixels, before allocating any", async () => {
    // The Round-2 finding, against the production command. A 20,000 x 20,000
    // figure is one the vector contract quite correctly allows, and the copy
    // path used to take it all the way to the rasterizer -- about 1.6 GiB of
    // pixmap for an operation nobody could have wanted at that size.
    //
    // Asserted here rather than only in Rust because `copy_selected_spectrum_plot`
    // needs a real application to run at all: this is the command itself
    // refusing, not a helper it is assumed to call.
    await chooseFigure({ width: "20000", height: "20000" });

    focusApplicationWindow();
    await pressDialogAction("Copy plot");
    const status = await waitForOutcome();

    // Since M7.4 the panel shows its own localized message for the refusal's
    // code rather than Rust's English text: the same 32-million-pixel budget.
    expect(status).toMatch(RASTER_BUDGET);
    // The command ran and refused. A refusal that never reached Rust would be
    // the frontend duplicating a bound, which is the drift this avoids.
    const copied = (await ipcCalls()).filter(
      (call) => call.command === "copy_selected_spectrum_plot",
    );
    expect(copied).toHaveLength(1);
    expect(copied[0]?.args["settings"]).toEqual({
      widthPx: 20_000,
      heightPx: 20_000,
      pngDpi: 300,
      theme: "light",
    });
  });

  it("still exports that figure as a vector, and refuses it as a raster", async () => {
    // The other half of the same rule, through the production begin command.
    // The budget is a question about the output: an SVG has no pixels to hold,
    // so the size that stopped the copy must not stop it.
    await chooseFigure({ width: "20000", height: "20000" });

    await pressDialogAction("Export SVG…");
    expect(await waitForOutcome(60_000)).toContain("cancelled");
    await dismissExportMessage();

    await pressDialogAction("Export PNG…");
    expect(await waitForOutcome(60_000)).toMatch(RASTER_BUDGET);

    const begun = (await ipcCalls()).filter(
      (call) => call.command === "begin_selected_spectrum_export",
    );
    expect(begun.map((call) => call.args["format"])).toEqual(["svg", "png"]);
  });

  it("refuses a resolution no PNG records, and lets every other output through", async () => {
    // 50 DPI is a whole positive number, so the interface has nothing to say
    // about it and it crosses. Rust records physical resolutions from 72, and
    // refuses the one format that writes one -- leaving `Export SVG…` and
    // `Copy plot`, neither of which has a `pHYs` chunk to put it in.
    await chooseFigure({ dpi: "50" });

    await pressDialogAction("Export SVG…");
    expect(await waitForOutcome(60_000)).toContain("cancelled");
    await dismissExportMessage();

    await pressDialogAction("Export PNG…");
    const refusal = await waitForOutcome(60_000);
    // The localized M7.4 message for the same 72 to 1200 range.
    expect(refusal).toContain(DPI_RANGE);
    await dismissExportMessage();

    focusApplicationWindow();
    await pressDialogAction("Copy plot");
    const copied = await waitForOutcome();
    expect(copied).not.toContain(DPI_RANGE);
    // And whatever the clipboard did, the confirmation names no resolution:
    // there is nowhere in an RGBA image for one to be recorded.
    expect(copied).not.toContain("DPI");
  });
});
