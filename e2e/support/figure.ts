/**
 * A plot's figure and data exports since the rebuild (spec 3.4, 6).
 *
 * The inline export panels are gone. Each plot head carries Export… (the
 * figure dialog) and a ⋯ menu (direction A: Set range…, Quick PNG, Copy plot,
 * CSV, TSV and, on the chromatogram, Linked figure…). The dialog is portaled to the body, so its controls are
 * looked up under `FIGURE_DIALOG`, never under the plot that opened it. Its
 * Copy, SVG and PNG are refused until a preview is drawn, which is why a spec
 * that exports from it answers `preview_figure` first.
 */
import { IPC_TABLE_KEY } from "./harness";

export const FIGURE_DIALOG = ".figure-export-dialog";

/** A plot's figure actions in its head: Export…, then ⋯. */
export const figureActions = (plot: string): string => `${plot} .figure-quick-actions`;

/** The plot head's ⋯ trigger. */
export const plotMenuTrigger = (plot: string): string => `${figureActions(plot)} button[aria-haspopup="menu"]`;

/** One item of the open ⋯ menu, by the words it starts with. */
export const plotMenuItem = (name: string): string => `//*[@role="menuitem"][starts-with(normalize-space(), "${name}")]`;

/**
 * Answers `preview_figure` with a labelled synthetic SVG of the requested
 * size, as m7.4 and the copy tour do: layout evidence only, never the
 * renderer's output. In-page, so it is installed after the page loads and is
 * lost on a reload. `empty` answers an honest empty figure.
 */
export async function answerFigurePreviews(empty = false): Promise<void> {
  await browser.execute(
    (tableKey: string, isEmpty: boolean) => {
      const table = Reflect.get(window, tableKey) as Record<string, unknown>;
      const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
        invoke: (name: string, args: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
      };
      const invoke = internals.invoke;
      internals.invoke = (name, args, ...rest) => {
        if (name === "preview_figure") {
          const request = args["request"] as { requestId: string; settings: { widthPx: number; heightPx: number } };
          const { widthPx: width, heightPx: height } = request.settings;
          table[name] = {
            status: "rendered",
            requestId: request.requestId,
            specId: JSON.stringify(request),
            empty: isEmpty,
            width,
            height,
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 1200 640"><rect width="1200" height="640" fill="white"/><text x="70" y="55" fill="#1b2532" font-size="24">MOCK IPC FIGURE</text><path d="M80 90V550H1150" fill="none" stroke="#485666" stroke-width="2"/>${isEmpty ? "" : '<path d="M150 550V430M330 550V250M600 550V125M850 550V375M1050 550V480" stroke="#267fbb" stroke-width="3"/>'}</svg>`,
          };
        }
        return invoke(name, args, ...rest);
      };
    },
    IPC_TABLE_KEY,
    empty,
  );
}

/** Opens a plot's figure dialog from its head's Export…, the way a person does. */
export async function openFigureDialog(plot: string): Promise<void> {
  const entry = browser.$(`${figureActions(plot)} > button:first-child`);
  await entry.waitForDisplayed({ timeout: 30_000 });
  await entry.click();
  await browser.$(FIGURE_DIALOG).waitForDisplayed();
}

/** Waits until the dialog's preview is drawn, which is what offers Copy, SVG and PNG. */
export async function waitForFigurePreview(): Promise<void> {
  await browser.$(`${FIGURE_DIALOG} .figure-preview img`).waitForDisplayed({ timeout: 30_000 });
}

/** Closes the dialog through its own close control ("Return to viewer"). */
export async function closeFigureDialog(): Promise<void> {
  await browser.$(`${FIGURE_DIALOG} .figure-export-head button`).click();
  await browser.$(FIGURE_DIALOG).waitForExist({ reverse: true });
}

/** A dialog button by the words on it (Copy plot, Export SVG…, Export CSV…). */
export function figureDialogButton(label: string) {
  return browser.$(FIGURE_DIALOG).$(`button=${label}`);
}

/** Opens a plot's ⋯ menu and chooses the item that starts with `name`. */
export async function choosePlotMenuItem(plot: string, name: string): Promise<void> {
  await openPlotMenu(plot);
  await browser.$(plotMenuItem(name)).click();
}

/** Opens a plot's ⋯ menu and waits for its items. */
export async function openPlotMenu(plot: string): Promise<void> {
  const trigger = browser.$(plotMenuTrigger(plot));
  await trigger.scrollIntoView({ block: "center" });
  await trigger.click();
  await browser.$('[role="menuitem"]').waitForDisplayed();
}
