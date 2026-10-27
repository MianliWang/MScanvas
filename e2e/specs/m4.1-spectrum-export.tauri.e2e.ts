/**
 * M4.1 on the real thing: the compiled application, its real Rust process, and
 * WebView2.
 *
 * This layer exists to answer one question browser mode cannot: does the shipped
 * composition actually stand up and wire together. It is deliberately smaller
 * than the browser suite — layout, focus treatment and every export outcome are
 * measured there, against a renderer that is easier to interrogate and a run
 * that costs seconds rather than minutes.
 *
 * ## What is real here, and what is not
 *
 * Real: the process, the WebView, the frontend bundle, the Tauri IPC transport,
 * and every command no test answers — the boundary compiled in under the `e2e`
 * feature passes those straight through to Rust, so a round trip asserted below
 * is a real one.
 *
 * Answered from the table: the commands that would need a ProteoWizard
 * installation and an mzML file on this machine — the roster, opening a preview,
 * reading a spectrum — and the two export commands, whose real implementations
 * open a native save dialog no WebDriver session can dismiss. Each is answered
 * at the same `__TAURI_INTERNALS__.invoke` boundary `@tauri-apps/api/core`
 * itself calls; nothing about React, the hook, or the components is stubbed.
 *
 * Not covered at all: the native save dialog, and therefore not the production
 * save path either. It is not this document's window, and on a machine without
 * the backend the application refuses the export before a dialog could open.
 * See `e2e/native/README.md` for what that leaves open.
 */

import { ipcTable } from "../support/fixtures";
import { TAURI_VIEWER_PREFERENCES, selectFirstSpectrum } from "../support/tauriPanel";

const PANEL = "section.spectrum-panel";
const EXPORT_BLOCK = ".spectrum-export";
const FORMATS = ["SVG", "CSV", "TSV"] as const;

interface IpcCall {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

/**
 * Seeds the answers the *next* document starts with, then loads it.
 *
 * The application asks the backend its first questions in a mount effect, so an
 * answer has to be in place before the document exists. Session storage is where
 * the compiled-in boundary looks, and it survives the reload.
 */
async function loadWith(table: Record<string, unknown>): Promise<void> {
  const seed = JSON.stringify(
    Object.fromEntries(
      Object.entries(table).map(([command, value]) => [command, { kind: "resolve", value }]),
    ),
  );
  await browser.execute((json: string) => {
    window.sessionStorage.setItem("__mscanvasIpcSeed__", json);
  }, seed);
  await browser.refresh();
}

/**
 * The answers this layer runs with.
 *
 * The export pair is always answered, in every test, and never left to reach
 * Rust. Its real implementation opens a native save dialog -- a modal window
 * this session has no authority over, which holds the WebView until a human
 * dismisses it and turns every later command into a timeout. One unmocked click
 * cost this suite a nine-minute run to learn that.
 */
function tauriTable(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...ipcTable(),
    // The controlled viewer starts with the roster shown at every native size;
    // this does not stand in for a real preference-store check.
    load_ui_preferences: {
      outcome: "loaded",
      revision: 0,
      preferences: TAURI_VIEWER_PREFERENCES,
    },
    begin_selected_spectrum_export: "reservation-1",
    save_selected_spectrum_export: { status: "cancelled" },
    ...extra,
  };
}

/** Every command the running document has issued since it loaded. */
async function ipcCalls(): Promise<IpcCall[]> {
  return (await browser.execute(
    () => (window as unknown as Record<string, unknown>)["__mscanvasIpcCalls__"] ?? [],
  )) as IpcCall[];
}

/**
 * The button carrying exactly this label.
 *
 * One round trip, resolved by the driver. Reading every button's text from the
 * test side instead costs a round trip per button, and on a real WebView that is
 * the difference between a second and a minute -- enough, in a document that
 * renders a spectrum table, to push a test past its own budget and fail for
 * reasons that have nothing to do with what it asserts.
 */
function buttonLabelled(label: string): ReturnType<typeof browser.$> {
  return browser.$(`button=${label}`);
}

describe("M4.1 on the real Tauri WebView, cold", () => {
  it("launches and renders the workspace over real IPC", async () => {
    // Nothing is seeded, so every command this document issues reaches Rust.
    // The application's own shell and mounted roster heading distinguish it
    // from a platform error page, including when the roster is folded.
    await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
    // The roster remains mounted when the native viewport folds it away.
    await browser.$("#dataset-roster-heading").waitForExist({ timeout: 60_000 });
    expect(await browser.getTitle()).toBe("MSCanvas");

    // The real roster answered the real mount effect.
    const calls = await ipcCalls();
    expect(calls.map((call) => call.command)).toContain("get_workspace_roster");

    // No preview is open on a cold session, so no spectrum panel exists -- and
    // therefore no export action, which is the posture M4.1 promises.
    expect(await browser.$(PANEL).isExisting()).toBe(false);
    expect(await browser.$(EXPORT_BLOCK).isExisting()).toBe(false);
  });

  it("carries a real IPC round trip", async () => {
    // Straight at the boundary `@tauri-apps/api/core` itself calls, with no
    // entry in the answer table -- so this is the real command, answered by the
    // real Rust service. If the plumbing were not wired it would not resolve.
    const roster = await browser.execute(() =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke("get_workspace_roster"),
    );
    expect(roster).toBeDefined();
    expect(typeof (roster as { capacity?: number }).capacity).toBe("number");
  });
});

describe("M4.1 on the real Tauri WebView, with a spectrum loaded", () => {
  // Loaded once for the three tests below rather than three times. That sharing
  // is deliberate and declared here: a real launch, a reload and a selection
  // cost about a minute each, and a suite that pays for them per assertion runs
  // its tests out of their own budgets. What it must not become is the accident
  // it was before -- tests that silently depend on a document some earlier test
  // happened to leave behind.
  before(async () => {
    await loadWith(tauriTable());
    await selectFirstSpectrum();
  });

  it("renders the export controls", async () => {
    for (const format of FORMATS) {
      const button = buttonLabelled(`Export ${format}…`);
      await button.waitForDisplayed();
      expect(await button.isEnabled()).toBe(true);
    }
  });

  it("reaches the export controls from the keyboard", async () => {
    // Focused rather than clicked. A click here would run the export, and what
    // this test is asking about is tab order, not what the button does -- and a
    // click would also spend the one export the last test counts on.
    await browser.execute(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) => (candidate.textContent ?? "").trim() === "Export SVG…",
      );
      button?.focus();
    });
    expect(
      await browser.execute(() => (document.activeElement?.textContent ?? "").trim()),
    ).toContain("Export SVG");

    // The figure actions come first now, so the next stop after SVG is PNG.
    // M4.2 added them; the property under test -- that Tab walks the group in
    // document order -- is unchanged.
    await browser.keys(["Tab"]);
    const focused = await browser.execute(() =>
      (document.activeElement?.textContent ?? "").trim(),
    );
    expect(focused).toContain("Export PNG");
  });

  it("invokes the export commands through the real transport", async () => {
    await buttonLabelled("Export CSV…").click();

    // Waited for at the IPC boundary rather than in the status line. What this
    // layer is asking is whether the real frontend reaches the real transport;
    // what the status line then says is measured in browser mode, against a
    // renderer that can be interrogated in seconds rather than minutes.
    await browser.waitUntil(
      async () =>
        (await ipcCalls()).some((call) => call.command === "save_selected_spectrum_export"),
      { timeout: 30_000, timeoutMsg: "the export never reached the save command" },
    );

    const begins = (await ipcCalls()).filter(
      (call) => call.command === "begin_selected_spectrum_export",
    );
    expect(begins).toHaveLength(1);
    expect(begins[0]?.args.format).toBe("csv");
    // The token the real panel is holding, carried by the real transport.
    expect(typeof begins[0]?.args.exportToken).toBe("string");
    expect((begins[0]?.args.exportToken as string).length).toBeGreaterThan(0);
  });
});
