/**
 * Driving the real application to a loaded spectrum, once, for every suite.
 *
 * Four rendered suites need the same thing: a document whose answers are known,
 * a preview open, and a spectrum selected. Written four times it drifted four
 * ways -- and one of those ways cost a hundred seconds a test.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MZML_ROW, ipcTable, spectrumWithPeaks } from "./fixtures";

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

export const EXPORT_BLOCK = ".spectrum-export";
export const STATUS = ".spectrum-export-status";

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
 * Drives the shipped interface from a cold document to a selected spectrum.
 *
 * The preview is opened with the keyboard, which is what the roster documents:
 * "Reading one is `Preview focused` or Enter, and nothing else." A double-click
 * opens one too, and this suite used to use it -- but WebDriver's synthetic
 * double-click does not reliably become a `dblclick` in WebView2, so the retry
 * loop around it spent a hundred seconds a test failing to open a preview that
 * one keypress opens immediately.
 */
export async function selectFirstSpectrum(): Promise<void> {
  const row = `li.dataset-row[data-handle="${MZML_ROW.handle}"]`;
  const firstSpectrum = 'div.spectrum-table-row[data-row-position="0"]';

  await browser.$(row).waitForDisplayed({ timeout: 60_000 });
  // Clicked to focus and select, then activated. Two separate things the roster
  // deliberately keeps separate: selecting a row is not reading it.
  await browser.$(row).click();
  await browser.keys(["Enter"]);
  await browser.$(firstSpectrum).waitForDisplayed({ timeout: 60_000 });

  await browser.$(firstSpectrum).click();
  await browser.$(EXPORT_BLOCK).waitForDisplayed({ timeout: 30_000 });
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
      const inputs = [...document.querySelectorAll("label.spectrum-figure-field input")];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      fields.slice(0, 3).forEach((value, index) => {
        const input = inputs[index];
        if (value !== null && input instanceof HTMLInputElement) {
          setter?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      const theme = fields[3];
      if (theme !== null && theme !== undefined) {
        const chosen = document.querySelector(`input[type='radio'][value='${theme}']`);
        if (chosen instanceof HTMLInputElement) {
          chosen.click();
        }
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

/** What the export status region currently says. */
export async function statusText(): Promise<string> {
  return (await browser.$(STATUS).getText()).trim();
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
export async function waitForOutcome(timeout = 120_000): Promise<string> {
  await browser.$("button=Dismiss export message").waitForDisplayed({
    timeout,
    timeoutMsg: "the operation never reported a finished outcome",
  });
  return statusText();
}
