/**
 * M4.4 on the real Tauri WebView, against real Rust.
 *
 * The browser suite proves what the shipped bundle sends. This proves what Rust
 * does with it: the pair is bound from two retained snapshots, the marker's
 * coordinate comes back from the retained table rather than from anything the
 * document holds, and every refusal a linked figure has is the one a reader is
 * shown.
 *
 * `begin_linked_figure_export` and `copy_linked_plot` are left real, and so are
 * `begin_chromatogram_export` and `save_chromatogram_export` -- the last of them
 * only ever called here with a reservation it must refuse, which it does before
 * any dialog is dispatched. `save_linked_figure_export` is answered from the
 * table, because the only thing left in it is a native save dialog, and that is
 * its own milestone's evidence.
 *
 * The seeded session holds one run of 24 scans from retention time 0.10 to 0.33
 * and one spectrum of its first scan. The document holds a mocked preview of six
 * rows from 0 to 0.0625 and no retention time at all for the selected scan --
 * which is what makes the numbers coming back checkable: 24 scans and a marker
 * at 0.10 are facts only Rust has.
 */

import {
  SEEDED_CHROMATOGRAM_TOKEN,
  SEEDED_TOKEN,
  clipboardIsUsable,
  ipcCalls,
  loadWith,
  selectFirstSpectrum,
  tauriTable,
} from "../support/tauriPanel";

const TOGGLE = "button#chromatogram-export-toggle";
const PANEL = "#chromatogram-export-panel";
const LINKED = "#chromatogram-linked-section";

/** How many scans Rust's seeded run holds. The document is told six. */
const SEEDED_SCANS = 24;

/** Where the seeded run's first scan sits, which is the marker's coordinate. */
const SEEDED_RETENTION_TIME = 0.1;

/** The seeded run's last scan, for a range that reaches past the selection. */
const SEEDED_LAST_RETENTION_TIME = 0.33;

const FIGURE_SETTINGS = { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" } as const;

/** Opens the export surface, which every viewer opens closed. */
async function openExport(): Promise<void> {
  await browser.$(TOGGLE).click();
  await browser.$(PANEL).waitForDisplayed({ timeout: 30_000 });
}

function linked(label: string) {
  return browser.$(LINKED).$(`button=${label}`);
}

/** What the linked section's live region says, read from the document. */
async function linkedStatus(): Promise<string> {
  return browser.execute(
    (css: string) => document.querySelector(css)?.textContent?.trim() ?? "",
    `${LINKED} [role="status"]`,
  );
}

async function begunLinked(): Promise<Record<string, unknown>[]> {
  return (await ipcCalls())
    .filter((call) => call.command === "begin_linked_figure_export")
    .map((call) => call.args);
}

/**
 * Calls one command through the application's own IPC and answers what it said.
 *
 * Written without a named inner function on purpose. The runner transpiles this
 * file with esbuild, which rewrites a named function expression to call its
 * `__name` helper -- and that helper does not exist in the page this body is
 * serialized into.
 */
async function callRust(command: string, args: Record<string, unknown>): Promise<string> {
  return browser.execute(
    async (name: string, payload: Record<string, unknown>) => {
      const internals = (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] as {
        invoke: (command: string, args: unknown) => Promise<unknown>;
      };
      try {
        return JSON.stringify({ ok: await internals.invoke(name, payload) });
      } catch (error) {
        return JSON.stringify({ refused: error });
      }
    },
    command,
    args,
  );
}

/** One linked figure request, as the interface would send it. */
function linkedArgs(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chromatogramToken: SEEDED_CHROMATOGRAM_TOKEN,
    spectrumToken: SEEDED_TOKEN,
    format: "svg",
    range: { scope: "full", low: null, high: null },
    traces: { tic: true, bpc: false },
    settings: FIGURE_SETTINGS,
    ...overrides,
  };
}

describe("exporting a linked figure on the real Tauri WebView", () => {
  beforeEach(async () => {
    await loadWith(
      tauriTable({
        real: [
          "begin_linked_figure_export",
          "copy_linked_plot",
          "begin_chromatogram_export",
          "save_chromatogram_export",
        ],
        extra: { save_linked_figure_export: { status: "cancelled" } },
      }),
    );
    await selectFirstSpectrum();
    await openExport();
  });

  it("binds the pair the session holds and opens a real reservation", async () => {
    await linked("Export linked SVG…").click();

    await browser.waitUntil(async () => (await begunLinked()).length === 1, {
      timeout: 60_000,
      timeoutMsg: "the linked export never reached Rust",
    });
    const [request] = await begunLinked();
    expect(request?.["chromatogramToken"]).toBe(SEEDED_CHROMATOGRAM_TOKEN);
    expect(request?.["spectrumToken"]).toBe(SEEDED_TOKEN);
    expect(request?.["settings"]).toEqual(FIGURE_SETTINGS);

    // Rust accepted the pair, so the mocked dialog answered and the surface says
    // what a dismissed one means.
    await browser.waitUntil(async () => (await linkedStatus()).includes("cancelled"), {
      timeout: 60_000,
      timeoutMsg: "the linked export never reported an outcome",
    });
    expect(await linkedStatus()).toContain("Nothing was saved.");
  });

  it("places the marker at a retention time only Rust has", async () => {
    /*
     * The claim this milestone rests on, at the boundary that decides it, and
     * without needing anything to come back.
     *
     * The document was given a preview of six rows running to 0.0625 and no
     * retention time at all for the scan it selected. Rust's retained run
     * begins at 0.10, and the selected scan is its first. So the range that is
     * accepted and the range that is refused differ exactly at 0.10: a
     * containment test decided from the retained row, against a number this
     * side does not hold and never sent.
     */
    expect(
      await callRust(
        "begin_linked_figure_export",
        linkedArgs({
          range: {
            scope: "current",
            low: SEEDED_RETENTION_TIME,
            high: SEEDED_LAST_RETENTION_TIME,
          },
        }),
      ),
    ).toContain('"ok"');

    expect(
      await callRust(
        "begin_linked_figure_export",
        linkedArgs({
          range: { scope: "current", low: 0.11, high: SEEDED_LAST_RETENTION_TIME },
        }),
      ),
    ).toContain("linked_selection_outside_range");

    // And the run Rust holds is not the run the document was given: the six
    // rows this side drew end at 0.0625, which is a range Rust does not have.
    expect(
      await callRust(
        "begin_linked_figure_export",
        linkedArgs({ range: { scope: "current", low: 0, high: 0.0625 } }),
      ),
    ).toContain("chromatogram_range_outside_source");
  });

  it("reports the retained run and the marked scan when a copy can be made", async function reportsTheRetainedRun() {
    /*
     * The same claim read off a finished operation, which needs a clipboard.
     *
     * Skipped loudly rather than quietly where the session has none: the reason
     * is printed, and the milestone records it as an environmental residual
     * rather than as a pass. What it would add is the count -- 24 scans, where
     * the document was told six -- read back out of a real Rust outcome.
     */
    if (!clipboardIsUsable()) {
      console.log(
        "SKIPPED: this Windows session's clipboard cannot be opened by any process, " +
          "so a real linked copy cannot complete here. See e2e/native/README.md.",
      );
      this.skip();
    }
    await linked("Copy linked plot").click();

    await browser.waitUntil(async () => (await linkedStatus()).includes("Copied"), {
      timeout: 60_000,
      timeoutMsg: "the linked copy never reported an outcome",
    });
    const said = await linkedStatus();
    expect(said).toContain(`in a run of ${String(SEEDED_SCANS)} scans`);
    expect(said).toContain("marking spectrum 0");
  });

  it("refuses a chromatogram token this session no longer holds", async () => {
    const answer = await callRust(
      "begin_linked_figure_export",
      linkedArgs({ chromatogramToken: "999999" }),
    );
    expect(answer).toContain("linked_figure_stale");
  });

  it("refuses a spectrum token this session no longer holds", async () => {
    const answer = await callRust(
      "begin_linked_figure_export",
      linkedArgs({ spectrumToken: "999999" }),
    );
    expect(answer).toContain("linked_figure_stale");
  });

  it("refuses a current range the selected scan is outside", async () => {
    // The seeded selection sits at 0.10 and this range begins after it. Rust
    // decides that against the retained row; the document never sends a time.
    const answer = await callRust(
      "begin_linked_figure_export",
      linkedArgs({
        range: { scope: "current", low: 0.15, high: SEEDED_LAST_RETENTION_TIME },
      }),
    );
    expect(answer).toContain("linked_selection_outside_range");
  });

  it("accepts a current range that still holds the selected scan", async () => {
    const answer = await callRust(
      "begin_linked_figure_export",
      linkedArgs({
        range: {
          scope: "current",
          low: SEEDED_RETENTION_TIME,
          high: SEEDED_LAST_RETENTION_TIME,
        },
      }),
    );
    expect(answer).toContain('"ok"');
    expect(answer).not.toContain("linked_");
  });

  it("refuses a range the run does not have, rather than clamping it", async () => {
    const answer = await callRust(
      "begin_linked_figure_export",
      linkedArgs({ range: { scope: "current", low: -50, high: 5_000 } }),
    );
    expect(answer).toContain("chromatogram_range_outside_source");
  });

  it("refuses a figure one pixel short of two panels, and draws one at 260", async () => {
    const short = await callRust(
      "begin_linked_figure_export",
      linkedArgs({ settings: { ...FIGURE_SETTINGS, heightPx: 259 } }),
    );
    expect(short).toContain("linked_figure_too_short");

    const exact = await callRust(
      "begin_linked_figure_export",
      linkedArgs({ settings: { ...FIGURE_SETTINGS, heightPx: 260 } }),
    );
    expect(exact).toContain('"ok"');
  });

  it("refuses a figure with no visible trace", async () => {
    const answer = await callRust(
      "begin_linked_figure_export",
      linkedArgs({ traces: { tic: false, bpc: false } }),
    );
    expect(answer).toContain("chromatogram_no_visible_trace");
  });

  it("takes the one scientific lane the chromatogram was holding", async () => {
    /*
     * One place for a claim to live, proved without a dialog. A chromatogram
     * reservation is issued, a linked one is issued after it, and the first is
     * then not a reservation any more: its own save command no longer knows it.
     * Two lanes would have left both alive.
     */
    const chromatogram = await callRust("begin_chromatogram_export", {
      exportToken: SEEDED_CHROMATOGRAM_TOKEN,
      format: "csv",
      range: { scope: "full", low: null, high: null },
      traces: { tic: true, bpc: false },
      settings: FIGURE_SETTINGS,
    });
    expect(chromatogram).toContain('"ok"');
    const superseded = JSON.parse(chromatogram)["ok"] as string;

    expect(await callRust("begin_linked_figure_export", linkedArgs())).toContain('"ok"');

    const answer = await callRust("save_chromatogram_export", { reservationId: superseded });
    expect(answer).toContain("chromatogram_export_stale");
  });

  it("does not wedge the lane when a linked reservation is handed to the wrong save", async () => {
    /*
     * The three surfaces share one reservation counter, so a linked reservation
     * is a perfectly well-formed chromatogram reservation and a document that
     * reloaded and replayed one reaches exactly this. The kind is checked before
     * the lane is marked claimed -- marking it on the way to refusing would
     * leave the lane committed with no dialog, no writer and nothing to cancel
     * it, and every later scientific export of the session refused until the
     * application was restarted.
     */
    const begun = await callRust("begin_linked_figure_export", linkedArgs());
    expect(begun).toContain('"ok"');
    const reservation = JSON.parse(begun)["ok"] as string;

    expect(await callRust("save_chromatogram_export", { reservationId: reservation })).toContain(
      "chromatogram_export_stale",
    );

    // The lane is neither claimed nor wedged: the next linked export begins,
    // and so does an ordinary chromatogram one.
    expect(await callRust("begin_linked_figure_export", linkedArgs())).toContain('"ok"');
    expect(
      await callRust("begin_chromatogram_export", {
        exportToken: SEEDED_CHROMATOGRAM_TOKEN,
        format: "csv",
        range: { scope: "full", low: null, high: null },
        traces: { tic: true, bpc: false },
        settings: FIGURE_SETTINGS,
      }),
    ).toContain('"ok"');
  });
});
