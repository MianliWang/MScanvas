/**
 * Driving the real application to a loaded spectrum, once, for every suite.
 *
 * Rendered suites need the same thing: a document whose answers are known,
 * a preview open, and a spectrum selected. Written four times it drifted four
 * ways -- and one of those ways cost a hundred seconds a test.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { StoredPreferences } from "../../apps/desktop/src/features/preferences/storedPreferences";
import { MZML_ROW, SETTLED_AUTHORITY, ipcTable, spectrumWithPeaks } from "./fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Brings the application's own window to the foreground.
 *
 * A person pressing `Copy plot` is looking at the window they pressed it in. A
 * WebDriver session is not -- it drives the application without ever activating
 * it, and on Windows a process whose window has never been foreground is refused
 * the clipboard outright. Restoring that condition is a property of how this
 * suite drives the application, not of what the application does.
 */
export function focusApplicationWindow(): void {
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve(HERE, "..", "native", "focus-window.ps1"),
    ],
    { encoding: "utf8", windowsHide: true },
  );
}

/**
 * The spectrum's figure dialog (rebuild spec 3.4): its footer holds Copy plot,
 * Export SVG… and Export PNG…, its Data group Export CSV… and Export TSV…. The
 * inline export block and its disclosure are gone; Quick PNG and Copy plot are
 * also on the plot's ⋯ menu.
 */
export const EXPORT_BLOCK = ".figure-export-dialog";
export const STATUS = ".spectrum-panel .spectrum-export-status";

/**
 * A controlled viewer session starts with its roster explicitly shown, even
 * below the automatic breakpoint. This is fixture state, not evidence about
 * the real preference store. Preview activation folds it through navigation.
 */
export const TAURI_VIEWER_PREFERENCES: StoredPreferences = {
  schemaVersion: 1,
  appearance: { locale: "en", density: "comfortable" },
  layout: { roster: "shown", details: "automatic" },
};

/**
 * The token Rust's seeded snapshot carries.
 *
 * The session's first install, and the slot names them from one upward. If this
 * were ever wrong the production command would refuse it as stale rather than
 * export something else, so a drift fails loudly rather than passing quietly.
 */
export const SEEDED_TOKEN = "1";

/**
 * The token Rust's seeded chromatogram carries.
 *
 * The session's second install, from the one counter both kinds are named out
 * of. Wrong, it would be refused as stale rather than exporting another run.
 */
export const SEEDED_CHROMATOGRAM_TOKEN = "2";

/**
 * The m/z range Rust's seeded snapshot actually spans.
 *
 * `e2e_seed` writes 64 points from 100 at a step of 12.5, so the domain the
 * production contract admits over it runs to 887.5. Stated here because the
 * panel's own payload is answered from the table above: a viewport told it
 * spans something else would ask the real command for a window the real
 * spectrum does not have, and be refused -- which is the right answer to a
 * question the fixture should not have asked.
 */
export const SEEDED_MZ_LOW = 100;
export const SEEDED_MZ_HIGH = 887.5;

/** The m/z of the seeded spectrum's one measured negative in the first octave. */
export const SEEDED_NEGATIVE_MZ = 137.5;

export interface IpcCall {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

/** Seeds the answers the next document starts with, then loads it. */
export async function loadWith(table: Record<string, unknown>): Promise<void> {
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
 * The answers a real-WebView suite runs with, minus the commands it wants real.
 *
 * The roster, the preview and the spectrum are answered here because reading
 * them needs a ProteoWizard installation and an mzML file. The panel is rendered
 * from those answers, and the token it carries is the one Rust actually holds --
 * so an export started from it names the seeded snapshot.
 */
export function tauriTable(options: {
  readonly real?: readonly string[];
  readonly extra?: Record<string, unknown>;
  /**
   * What the panel is told its m/z domain is.
   *
   * Defaults to the range Rust's seeded snapshot really spans, so a viewport
   * over it navigates the spectrum the production command will be asked about.
   * A suite proving that an outside-source window is *refused* rather than
   * clamped widens this deliberately -- which is the only way to make the
   * frontend ask for a window its own clamping would otherwise never produce.
   */
  readonly viewportDomain?: { readonly state: "admitted"; readonly low: number; readonly high: number };
} = {}): Record<string, unknown> {
  const base = ipcTable();
  const table = {
    ...base,
    load_ui_preferences: {
      outcome: "loaded",
      revision: 0,
      preferences: TAURI_VIEWER_PREFERENCES,
    },
    // These viewer setups make no layout choice after this read. The base
    // table's fixed save response is not a preference-persistence fixture.
    // The preview is answered from the table, so the token it carries has to be
    // the one Rust's seeded snapshot actually holds -- otherwise the production
    // command would refuse it as stale, which is the right answer to the wrong
    // question.
    open_mzml_preview: {
      ...(base["open_mzml_preview"] as Record<string, unknown>),
      chromatogramExportToken: SEEDED_CHROMATOGRAM_TOKEN,
    },
    load_selected_spectrum: {
      outcome: "spectrum",
      spectrum: {
        ...spectrumWithPeaks(),
        exportToken: SEEDED_TOKEN,
        // The domain the seeded snapshot really has. The arrays beside it are
        // still the fixture's six points, and that difference is not an
        // oversight: it is the shape M5.2 has to survive, where what this
        // document holds and what Rust retains are not the same thing.
        viewportDomain: options.viewportDomain ?? {
          state: "admitted",
          low: SEEDED_MZ_LOW,
          high: SEEDED_MZ_HIGH,
        },
      },
    },
    ...(options.extra ?? {}),
  } as Record<string, unknown>;
  // Since 8590adb the command answers the authority projection beside the
  // outcome (fixtures.ts' base table already does). The outcomes above and in
  // callers' `extra` are bare; wrap them under the table's settled authority
  // rather than answer a wire shape the application no longer speaks.
  const spectrum = table["load_selected_spectrum"] as Record<string, unknown> | undefined;
  if (spectrum !== undefined && !("authority" in spectrum)) {
    table["load_selected_spectrum"] = { authority: SETTLED_AUTHORITY, outcome: spectrum };
  }
  for (const command of options.real ?? []) {
    delete table[command];
  }
  return table;
}

/** Every command the running document has issued since it loaded. */
export async function ipcCalls(): Promise<IpcCall[]> {
  return (await browser.execute(
    () => (window as unknown as Record<string, unknown>)["__mscanvasIpcCalls__"] ?? [],
  )) as IpcCall[];
}

/**
 * Reveals the roster using its shipped header toggle, without replacing IPC.
 *
 * A refused toggle is waited out, never pressed repeatedly or bypassed
 * by changing the hidden attribute or installing a preference read-back mock.
 */
export async function revealTauriRoster(): Promise<void> {
  const roster = browser.$("#workbench-roster");
  const toggle = browser.$('[aria-controls="workbench-roster"]');
  await roster.waitForExist({ timeout: 60_000 });
  await toggle.waitForDisplayed({ timeout: 60_000 });
  await browser.waitUntil(async () =>
    await toggle.isEnabled() && (await toggle.getAttribute("aria-disabled")) !== "true", {
    timeout: 60_000,
    timeoutMsg: "the roster toggle never became operable",
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.scrollIntoView({ block: "nearest" });
    await toggle.click();
  }
  await roster.waitForDisplayed({ timeout: 60_000 });
}

/**
 * Clears the roster through its footer's list menu (direction A 2.1) and waits
 * for it to empty. A list with no rows has no menu, so there is nothing to do.
 */
export async function clearRosterList(): Promise<void> {
  const menu = browser.$("#workbench-roster [data-roster-list-menu]");
  if (!(await menu.isExisting())) return;
  await menu.scrollIntoView({ block: "nearest" });
  await menu.click();
  // Refused rather than disabled while the roster is busy (spec 1.4).
  const item = browser.$('[role="menu"] [data-roster-clear]');
  await item.waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(async () => (await item.getAttribute("aria-disabled")) !== "true", {
    timeout: 30_000,
    timeoutMsg: "Clear list was never offered",
  });
  await item.click();
  await browser.waitUntil(async () => (await browser.$$(".grouped-roster [data-handle]").length) === 0);
}

/** Opens one mzML row once, then waits for its linked viewer to be visible. */
export async function openTauriPreview(handle: string): Promise<void> {
  const row = `.grouped-roster [role="row"][data-handle="${handle}"]`;
  await browser.$(row).waitForExist({ timeout: 60_000 });
  await revealTauriRoster();
  await browser.$(row).scrollIntoView({ block: "nearest" });
  await browser.$(row).waitForClickable({ timeout: 60_000 });
  // Since M7.2 a plain row click previews mzML. Enter or a double-click retry
  // would activate it again and can discard the selected-spectrum state.
  await browser.$(row).click();
  await browser.$("#workbench-evidence").waitForDisplayed({ timeout: 60_000 });
  await browser.$("svg.chromatogram-svg").waitForDisplayed({ timeout: 60_000 });
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed({
    timeout: 60_000,
  });
}

/**
 * Drives the shipped interface to a loaded spectrum. Its export controls are
 * in the figure dialog, which a spec that exports opens next with
 * `openSpectrumFigureDialog()`; a modal left open here would cover the viewer
 * for the specs that pan, zoom or select.
 */
export async function selectFirstSpectrum(): Promise<void> {
  const firstSpectrum = 'div.spectrum-table-row[data-row-position="0"]';
  await openTauriPreview(MZML_ROW.handle);
  await browser.$(firstSpectrum).scrollIntoView({ block: "center" });
  await browser.$(firstSpectrum).click();
  // Exists, never displayed: the summary is the plot's visually hidden label.
  await browser.$("#selected-spectrum-summary").waitForExist({ timeout: 60_000 });
}

/**
 * Opens the spectrum's figure dialog from its head's Export…, as a person does.
 * The dialog is presentation only and keeps the selected spectrum and its token.
 */
export async function openSpectrumFigureDialog(): Promise<void> {
  const entry = browser.$(".spectrum-panel .figure-quick-actions > button:first-child");
  await entry.waitForDisplayed({ timeout: 60_000 });
  await entry.scrollIntoView({ block: "nearest" });
  await entry.click();
  await browser.$(EXPORT_BLOCK).waitForDisplayed({ timeout: 30_000 });
}

/**
 * Presses one of the open figure dialog's actions by its words, once it is
 * offered: Copy plot, Export SVG… and Export PNG… are refused, not disabled,
 * until the dialog's preview of the current settings is drawn.
 */
export async function pressDialogAction(label: string): Promise<void> {
  const action = browser.$(EXPORT_BLOCK).$(`button=${label}`);
  await action.waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(async () => (await action.getAttribute("aria-disabled")) !== "true", {
    timeout: 60_000,
    timeoutMsg: `${label} was never offered`,
  });
  await action.click();
}

/**
 * Dismisses the spectrum's last export message so the next outcome is a new
 * one. Its icon button sits in the plot's status line, behind the open modal
 * dialog, so it is pressed by script rather than by a pointer the dialog's
 * overlay would intercept.
 */
export async function dismissExportMessage(): Promise<void> {
  await browser.execute(() => document.querySelector<HTMLButtonElement>(".spectrum-panel .plot-status-line > button")?.click());
}

/** Sets the figure fields and theme the way a person would, through React. */
export async function chooseFigure(values: {
  readonly width?: string;
  readonly height?: string;
  readonly dpi?: string;
  readonly theme?: string;
}): Promise<void> {
  // Written without a named inner function on purpose. The runner transpiles
  // this file with esbuild, which rewrites a named function expression to call
  // its `__name` helper -- and that helper does not exist in the page this body
  // is serialized into, so the whole script fails with a `ReferenceError` that
  // says nothing about what the test was doing.
  await browser.execute(
    (fields: (string | null)[]) => {
      // The fields live in the figure dialog since the rebuild (spec 3.4).
      const panel = document.querySelector(".figure-export-dialog");
      if (panel === null) throw new Error("the figure dialog is not open");
      // Ids end in the field name, after the dialog's own prefix, in every locale.
      const ids = ["widthPx", "heightPx", "pngDpi"];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter === undefined) throw new Error("the native input value setter is missing");
      fields.slice(0, 3).forEach((value, index) => {
        if (value === null) return;
        const input = panel.querySelector(`input[id$="-${ids[index]}"]`);
        if (!(input instanceof HTMLInputElement)) throw new Error(`the figure field ${ids[index]} is missing`);
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      // The theme is a segmented control: Light, then Dark.
      const theme = fields[3];
      if (theme !== null && theme !== undefined) {
        const options = [...panel.querySelectorAll<HTMLButtonElement>('.spectrum-figure-field-theme [role="radio"]')];
        const chosen = options[theme === "light" ? 0 : theme === "dark" ? 1 : -1];
        if (chosen === undefined) throw new Error(`the spectrum figure theme ${theme} is missing`);
        chosen.click();
      }
    },
    [values.width ?? null, values.height ?? null, values.dpi ?? null, values.theme ?? null],
  );
}

/**
 * Whether this Windows session has a working clipboard at all.
 *
 * Not a question about MSCanvas. The clipboard is a single system-wide object,
 * and a misbehaving monitor -- a clipboard manager, a stale remote-desktop
 * helper -- can leave it unopenable by *every* process on the machine until
 * something restarts. When that has happened, a test that asserts a copy
 * succeeded is asserting something no program could do, and reporting it as a
 * product failure would be false.
 *
 * So the condition is detected, from outside, before it is blamed on anything.
 */
export function clipboardIsUsable(): boolean {
  const probe = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
        "$b = New-Object System.Drawing.Bitmap 8,8; " +
        "try { [System.Windows.Forms.Clipboard]::SetImage($b); 'usable' } " +
        "catch { 'unusable' } finally { $b.Dispose() }",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return probe.stdout.includes("usable") && !probe.stdout.includes("unusable");
}

/** What this panel's own export status says, excluding its linked-figure lane. */
export async function statusText(panel = ".spectrum-panel"): Promise<string> {
  return (await browser.$(panel).$(".spectrum-export-status:not(.linked-figure-status)").getText()).trim();
}

/**
 * Waits until the panel has a *finished* outcome to report, and answers with it.
 *
 * Waiting for the status line to be non-empty is not enough: it says "Choose
 * where to save…" and "Drawing the plot…" while an operation is still running,
 * and a test that read those would be asserting against a sentence about the
 * middle of the work. The dismissal offer is the terminal signal -- it appears
 * for a saved, copied, cancelled or failed result and for nothing else.
 */
export async function waitForOutcome(timeout = 120_000, panel = ".spectrum-panel"): Promise<string> {
  // The dismissal is an icon button since the rebuild, in the plot's status
  // foot. Spectrum's is beside its status line; chromatogram's is inside it.
  // Both are terminal controls, with the linked-figure dismissal excluded.
  const dismiss = `${panel} .plot-status-line > button, ${panel} .spectrum-export-status:not(.linked-figure-status) button`;
  await browser.$(dismiss).waitForDisplayed({
    timeout,
    timeoutMsg: "the operation never reported a finished outcome",
  });
  return statusText(panel);
}
