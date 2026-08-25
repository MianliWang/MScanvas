/**
 * M4.3 on the real thing: exporting a chromatogram in WebView2.
 *
 * What this layer adds over the browser suite is everything under the command.
 * `begin_chromatogram_export` and `copy_chromatogram_plot` are left **real**, so
 * a reservation coming back is proof that the production path ran: the token
 * matched a snapshot Rust holds, the range was validated against the run those
 * facts describe, the trace set was read, the figure settings were checked and
 * the one scientific export lane was taken.
 *
 * The run behind it is the ordinary seeded one -- a synthetic spectrum table
 * read through the production parser and installed into the ordinary slot, so
 * nothing here is a shortcut around the eligibility a real preview goes through.
 *
 * The save half is answered from the table, because its real implementation
 * opens a modal dialog this session has no authority over. `e2e/native/` drives
 * that one.
 */

import {
  SEEDED_CHROMATOGRAM_TOKEN,
  ipcCalls,
  loadWith,
  selectFirstSpectrum,
  tauriTable,
} from "../support/tauriPanel";

const TOGGLE = "button#chromatogram-export-toggle";
const PANEL = "#chromatogram-export-panel";

/** Opens the export surface, which every viewer opens closed. */
async function openExport(): Promise<void> {
  await browser.$(TOGGLE).click();
  await browser.$(PANEL).waitForDisplayed({ timeout: 30_000 });
}

function control(label: string) {
  return browser.$(PANEL).$(`button=${label}`);
}

/** What this panel's live region says, read from the document. */
async function statusText(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${PANEL} .spectrum-export-status`,
  );
}

async function begunExports(): Promise<Record<string, unknown>[]> {
  return (await ipcCalls())
    .filter((call) => call.command === "begin_chromatogram_export")
    .map((call) => call.args);
}

describe("exporting a chromatogram on the real Tauri WebView", () => {
  beforeEach(async () => {
    await loadWith(
      tauriTable({
        real: ["begin_chromatogram_export", "copy_chromatogram_plot"],
        extra: { save_chromatogram_export: { status: "cancelled" } },
      }),
    );
    await selectFirstSpectrum();
    await openExport();
  });

  it("names the chromatogram Rust retained and comes back with a reservation", async () => {
    // Not answered from the table: this is the production command, matching the
    // token against the snapshot Rust holds and resolving the range against the
    // run those facts describe. A reservation coming back is the proof -- a
    // stale token or a range outside the run would have been refused instead.
    await control("Export CSV…").click();

    await browser.waitUntil(async () => (await statusText()).length > 0, {
      timeout: 60_000,
      timeoutMsg: "the export never reported an outcome",
    });
    const begun = await begunExports();
    expect(begun).toHaveLength(1);
    expect(begun[0]?.["exportToken"]).toBe(SEEDED_CHROMATOGRAM_TOKEN);
    expect(begun[0]?.["format"]).toBe("csv");
    expect(begun[0]?.["range"]).toEqual({ scope: "full", low: null, high: null });
    // The save half is answered from the table, so what the panel reports is
    // the cancellation standing in for a dialog nobody dismissed.
    expect(await statusText()).toContain("cancelled");
  });

  it("carries the visible traces and the figure settings into the real command", async () => {
    await browser.$("section.chromatogram-panel").$("label*=BPC").click();

    await control("Export SVG…").click();
    await browser.waitUntil(async () => (await statusText()).length > 0, { timeout: 60_000 });

    const begun = await begunExports();
    expect(begun).toHaveLength(1);
    expect(begun[0]?.["traces"]).toEqual({ tic: true, bpc: true });
    expect(begun[0]?.["settings"]).toEqual({
      widthPx: 1_200,
      heightPx: 640,
      pngDpi: 300,
      theme: "light",
    });
  });

  it("refuses a token this session no longer holds", async () => {
    // Through the real command, with a token nothing issued. Rust answers that
    // it is gone rather than exporting whichever run is loaded now.
    const refusal = await browser.execute(async () => {
      const invoke = (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] as {
        invoke: (command: string, args: unknown) => Promise<unknown>;
      };
      try {
        await invoke.invoke("begin_chromatogram_export", {
          exportToken: "999999",
          format: "csv",
          range: { scope: "full", low: null, high: null },
          traces: { tic: true, bpc: false },
          settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" },
        });
        return "accepted";
      } catch (error) {
        return JSON.stringify(error);
      }
    });

    expect(refusal).toContain("chromatogram_export_stale");
  });

  it("refuses a range the run does not have", async () => {
    // Refused rather than clamped: a window this source does not have is a
    // request about something else.
    const refusal = await browser.execute(async () => {
      const invoke = (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] as {
        invoke: (command: string, args: unknown) => Promise<unknown>;
      };
      try {
        await invoke.invoke("begin_chromatogram_export", {
          exportToken: "2",
          format: "csv",
          range: { scope: "current", low: -50, high: 5_000 },
          traces: { tic: true, bpc: false },
          settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" },
        });
        return "accepted";
      } catch (error) {
        return JSON.stringify(error);
      }
    });

    expect(refusal).toContain("chromatogram_range_outside_source");
  });

});
