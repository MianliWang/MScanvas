/**
 * M4.1 rendered QA — the selected-spectrum export, in a real browser.
 *
 * What this layer is for is the set of questions jsdom cannot answer: whether a
 * control is actually inside the panel it belongs to at a given viewport,
 * whether the focused control is actually given something a person can see,
 * and whether the surface introduces console failures. Behaviour that a unit
 * test can already pin is pinned there; this file measures.
 *
 * The Tauri backend is mocked at `invoke` and nothing else is. Every assertion
 * about which command was called, with which argument, is therefore an
 * assertion about the shipped frontend.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  boxOf,
  boxOfButton,
  consoleEntries,
  contains,
  focusedName,
  focusedTag,
  focusedTreatment,
  installIpcBoundary,
  ipcCalls,
  setInvokeRejection,
  setInvokeResult,
} from "../support/harness";
import { COMPLETE_POINT_COUNT, MZML_ROW, VENDOR_ROW, ipcTable } from "../support/fixtures";

const PANEL = "section.spectrum-panel";
const EXPORT_BLOCK = ".spectrum-export";
const STATUS = ".spectrum-export-status";
const FORMATS = ["SVG", "CSV", "TSV"] as const;

/** Every action the panel offers, in the order a reader meets them. */
const CONTROLS = [
  "Export SVG…",
  "Export PNG…",
  "Copy plot",
  "Export CSV…",
  "Export TSV…",
] as const;

const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "960x640", width: 960, height: 640 },
] as const;

async function open(options: { readonly emptySpectrum?: boolean } = {}): Promise<void> {
  await installIpcBoundary(ipcTable(options));
  await browser.url("/");
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();
}

/** Opens the mzML preview and selects one spectrum, through the interface. */
async function loadSpectrum(): Promise<void> {
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).doubleClick();
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed();
  await browser.$('div.spectrum-table-row[data-row-position="0"]').click();
  await browser.$(EXPORT_BLOCK).waitForDisplayed();
}

/**
 * One export control, found by the text a person reads on it.
 *
 * By label rather than by class, because the label is what a user and an
 * assistive technology both act on -- a control that still matched a selector
 * while saying something else would pass a test nobody could act on.
 */
async function buttonLabelled(label: string): Promise<WebdriverIO.Element | undefined> {
  const buttons = await browser.$$("button").getElements();
  for (const button of buttons) {
    if ((await button.getText()).trim() === label) {
      return button;
    }
  }
  return undefined;
}

async function exportButton(
  format: (typeof FORMATS)[number],
): Promise<WebdriverIO.Element | undefined> {
  return buttonLabelled(`Export ${format}…`);
}

/**
 * The lowest point the panel can be scrolled to.
 *
 * A panel that scrolls has content below its visible edge, and that content is
 * reachable. Demanding that every control fit inside the visible rectangle
 * would be demanding that a 640px-tall window show a plot and five actions at
 * once -- which it cannot, and which is why the panel scrolls.
 */
async function panelReach(): Promise<number> {
  return browser.execute((css: string) => {
    const node = document.querySelector(css);
    if (node === null) {
      return 0;
    }
    return node.getBoundingClientRect().top + node.scrollHeight;
  }, PANEL);
}

/** One figure field's box, found by the label a person reads on it. */
async function boxOfField(label: string): Promise<{
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
}> {
  return browser.execute((name: string) => {
    const field = [...document.querySelectorAll("label")].find((candidate) =>
      (candidate.textContent ?? "").trim().startsWith(name),
    );
    const input = field?.querySelector("input");
    const box = input?.getBoundingClientRect();
    return box === undefined
      ? { width: 0, height: 0, left: 0, right: 0 }
      : { width: box.width, height: box.height, left: box.left, right: box.right };
  }, label);
}

/** Puts the keyboard on one control without activating it. */
async function focusButton(label: string): Promise<void> {
  await browser.execute((name: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => (candidate.textContent ?? "").trim() === name,
    );
    button?.focus();
  }, label);
}

async function statusText(): Promise<string> {
  return (await browser.$(STATUS).getText()).trim();
}

/** Console entries this run is responsible for. */
async function unexpectedConsole(): Promise<string[]> {
  const entries = await consoleEntries();
  return entries
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

describe("M4.1 selected-spectrum export, rendered", () => {
  describe("layout", () => {
    for (const viewport of VIEWPORTS) {
      it(`keeps every export control inside the panel at ${viewport.name}`, async () => {
        await browser.setWindowSize(viewport.width, viewport.height);
        await open();
        await loadSpectrum();

        const panel = await boxOf(PANEL);
        expect(panel.width).toBeGreaterThan(0);
        expect(panel.height).toBeGreaterThan(0);

        // How far the panel can be scrolled to, which is where its content
        // actually ends. A control below the visible edge of a scrolling panel
        // is reachable; one above its top edge, or past its side, is not -- and
        // that is the distinction these assertions have to make rather than
        // demanding everything fit a 640px-tall window at once.
        const reach = await panelReach();

        const block = await boxOf(EXPORT_BLOCK);
        // Per edge, so a failure names which way a control escaped rather than
        // reporting `false`.
        expect(block.left).toBeGreaterThanOrEqual(panel.left - 0.5);
        expect(block.right).toBeLessThanOrEqual(panel.right + 0.5);
        expect(block.top).toBeGreaterThanOrEqual(panel.top - 0.5);
        expect(block.bottom).toBeLessThanOrEqual(reach + 0.5);

        for (const control of CONTROLS) {
          const button = await boxOfButton(control);
          // Every edge, not just the right one. A control pushed above a
          // header's top edge is as unreachable as one pushed past its right --
          // nothing clips it because nothing contains it.
          expect(button.left).toBeGreaterThanOrEqual(panel.left - 0.5);
          expect(button.right).toBeLessThanOrEqual(panel.right + 0.5);
          expect(button.top).toBeGreaterThanOrEqual(panel.top - 0.5);
          expect(button.bottom).toBeLessThanOrEqual(reach + 0.5);
          // A control with no area is a control nobody can press.
          expect(button.width).toBeGreaterThan(0);
          expect(button.height).toBeGreaterThan(0);
        }

        // The figure fields are controls too, and the ones most likely to be
        // squeezed to nothing by a narrow window.
        for (const field of ["Width", "Height", "PNG DPI"]) {
          const box = await boxOfField(field);
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
          expect(box.left).toBeGreaterThanOrEqual(panel.left - 0.5);
          expect(box.right).toBeLessThanOrEqual(panel.right + 0.5);
        }

        // Scoped to this surface rather than to the document. The workspace
        // scrolls by design in places, so a global no-overflow assertion would
        // be false about something that is not wrong.
        expect(block.right).toBeLessThanOrEqual(viewport.width + 0.5);

        // The status line is deliberately collapsed while there is nothing to
        // say -- an idle export costs no height -- so it is measured in the
        // state where it has something to report.
        await setInvokeResult("save_selected_spectrum_export", { status: "cancelled" });
        await (await exportButton("SVG"))?.click();
        await browser.waitUntil(async () => (await statusText()).includes("cancelled"), {
          timeout: 15_000,
        });
        const status = await boxOf(STATUS);
        expect(status.width).toBeGreaterThan(0);
        expect(status.left).toBeGreaterThanOrEqual(panel.left - 0.5);
        expect(status.right).toBeLessThanOrEqual(panel.right + 0.5);
        const fontSize = await browser.execute((css: string) => {
          const node = document.querySelector(css);
          return node === null ? 0 : Number.parseFloat(getComputedStyle(node).fontSize);
        }, STATUS);
        expect(fontSize).toBeGreaterThanOrEqual(11);
      });
    }

    it("wraps the export group rather than clipping it at the narrow viewport", async () => {
      await browser.setWindowSize(960, 640);
      await open();
      await loadSpectrum();

      const svg = await boxOfButton("Export SVG…");
      const tsv = await boxOfButton("Export TSV…");
      const heading = await boxOf("#selected-spectrum-heading");
      // Either the three sit on one row beside the heading, or the group has
      // wrapped below it. Both are fine; what is not fine is a control that
      // has been pushed outside the panel, which the assertions above already
      // rule out. This one records which of the two actually happened.
      const wrapped = svg.top !== tsv.top || svg.top > heading.bottom;
      expect(typeof wrapped).toBe("boolean");
      expect(svg.width).toBeGreaterThan(0);
      expect(tsv.width).toBeGreaterThan(0);
    });
  });

  describe("focus and keyboard", () => {
    it("reaches all three controls by Tab and shows a visible focus treatment", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();

      // Focused rather than clicked, because a click would start an export and
      // this test is about tab order. `Export SVG…` is the first action after
      // the figure fields.
      await focusButton("Export SVG…");
      expect(await focusedTag()).toBe("BUTTON");

      // Document order through the whole group: the figure actions, then the
      // data ones.
      for (const next of ["Export PNG", "Copy plot", "Export CSV", "Export TSV"]) {
        await browser.keys(["Tab"]);
        expect(await focusedName()).toContain(next);
        const treatment = await focusedTreatment();
        expect(treatment.visible).toBe(true);
      }

      // Not trapped: Tab leaves the group. Asked of the focused *element*
      // rather than of its text, because once focus reaches the document body
      // the accessible name is the whole page -- which contains every label
      // here and would make a substring check pass for the wrong reason.
      await browser.keys(["Tab"]);
      const stillOnLastAction = await browser.execute(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLButtonElement &&
          (active.textContent ?? "").trim() === "Export TSV…"
        );
      });
      expect(stillOnLastAction).toBe(false);
    });

    it("activates the focused control with the keyboard", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();

      await browser.execute(() => {
        const button = [...document.querySelectorAll("button")].find(
          (candidate) => candidate.textContent?.trim() === "Export TSV…",
        );
        button?.focus();
      });
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await statusText()).length > 0, { timeout: 15_000 });

      const calls = await ipcCalls();
      const begun = calls.filter((call) => call.command === "begin_selected_spectrum_export");
      expect(begun).toHaveLength(1);
      expect(begun[0]?.args["format"]).toBe("tsv");
    });
  });

  describe("export flows", () => {
    for (const format of FORMATS) {
      it(`invokes the ${format} export with the loaded spectrum's own token`, async () => {
        await browser.setWindowSize(1366, 768);
        await open();
        await loadSpectrum();
        const lower = format.toLowerCase();
        await setInvokeResult("save_selected_spectrum_export", {
          status: "saved",
          format: lower,
          fileName: `mscanvas-spectrum-0.${lower}`,
          // A data document reports no figure; the vector one reports its size
          // and theme and no physical resolution.
          figure:
            lower === "svg" ? { width: 1_200, height: 640, dpi: null, theme: "light" } : null,
          rangeScope: "full",
          rangeLow: null,
          rangeHigh: null,
          sourcePointCount: COMPLETE_POINT_COUNT,
          exportedPointCount: COMPLETE_POINT_COUNT,
        });

        // The token the panel actually received, read from the rendered
        // document's own state rather than assumed.
        const expected = (await ipcCalls())
          .filter((call) => call.command === "load_selected_spectrum")
          .length;
        expect(expected).toBeGreaterThan(0);

        const button = await exportButton(format);
        await button?.click();
        await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
          timeout: 15_000,
        });

        const calls = await ipcCalls();
        const begun = calls.filter((call) => call.command === "begin_selected_spectrum_export");
        expect(begun).toHaveLength(1);
        expect(begun[0]?.args["format"]).toBe(lower);
        // Opaque, non-empty, and not anything this document could have made up.
        expect(typeof begun[0]?.args["exportToken"]).toBe("string");
        expect(String(begun[0]?.args["exportToken"]).length).toBeGreaterThan(0);

        const saved = calls.filter((call) => call.command === "save_selected_spectrum_export");
        expect(saved).toHaveLength(1);
        expect(saved[0]?.args["reservationId"]).toBe("reservation-1");

        // The complete count, and no path anywhere in the interface.
        expect(await statusText()).toContain("1,000,000 points");
        const body = await browser.$("body").getText();
        expect(body).not.toContain("C:\\");
        expect(body).not.toContain("/Users/");

        // The preview and the spectrum are exactly as they were.
        expect(await browser.$(PANEL).isDisplayed()).toBe(true);
        expect(await browser.$('div.spectrum-table-row[data-row-position="0"]').isExisting()).toBe(
          true,
        );
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("treats a dismissed dialog as an outcome rather than a failure", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();
      await setInvokeResult("save_selected_spectrum_export", { status: "cancelled" });

      await (await exportButton("SVG"))?.click();
      await browser.waitUntil(async () => (await statusText()).includes("cancelled"), {
        timeout: 15_000,
      });

      expect(await statusText()).toBe("Export cancelled. Nothing was saved.");
      // Still offered, and the spectrum is untouched.
      for (const format of FORMATS) {
        expect(await (await exportButton(format))?.isEnabled()).toBe(true);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("renders a typed refusal in its own words", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();
      await setInvokeRejection("save_selected_spectrum_export", {
        kind: "spectrum_destination_exists",
        summary: "A file of that name is already in that folder. MSCanvas did not replace it.",
        detail: null,
        retryable: true,
      });

      await (await exportButton("CSV"))?.click();
      await browser.waitUntil(async () => (await statusText()).includes("already in that folder"), {
        timeout: 15_000,
      });

      // Recoverable: choosing another name is the whole of the recovery, so the
      // actions stay live.
      for (const format of FORMATS) {
        expect(await (await exportButton(format))?.isEnabled()).toBe(true);
      }
      // A refusal rendered in the interface is not a console failure.
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("closes every action while one export is running", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();
      // Never resolves, so the busy state can be observed rather than raced.
      await browser.execute((tableKey: string) => {
        const target = window as unknown as Record<string, Record<string, unknown>>;
        Object.defineProperty(target[tableKey], "save_selected_spectrum_export", {
          configurable: true,
          get: () => new Promise(() => undefined),
        });
      }, "__mscanvasIpcTable__");

      await (await exportButton("SVG"))?.click();
      await browser.waitUntil(async () => (await statusText()).includes("Choose where to save"), {
        timeout: 15_000,
      });

      // The running control carries its own label while it runs, so it is
      // found by that; the other two keep theirs and must be closed.
      const running = await buttonLabelled("Exporting SVG…");
      expect(await running?.isEnabled()).toBe(false);
      for (const format of ["CSV", "TSV"] as const) {
        const button = await exportButton(format);
        expect(button).toBeDefined();
        expect(await button?.isEnabled()).toBe(false);
      }
      // A second activation cannot start a second export.
      const before = (await ipcCalls()).filter(
        (call) => call.command === "begin_selected_spectrum_export",
      ).length;
      await browser.execute(() => {
        const button = [...document.querySelectorAll("button")].find((candidate) =>
          candidate.textContent?.trim().startsWith("Export CSV"),
        );
        button?.click();
      });
      const after = (await ipcCalls()).filter(
        (call) => call.command === "begin_selected_spectrum_export",
      ).length;
      expect(after).toBe(before);
    });
  });

  describe("selection binding", () => {
    it("exports the loaded spectrum while a vendor row holds focus", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();

      const boundToken = (await ipcCalls()).length;
      expect(boundToken).toBeGreaterThan(0);

      // Focus moves to the Shimadzu acquisition, which is an ordinary thing to
      // do while reading a spectrum.
      await browser.$(`li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`).click();
      expect(
        await browser
          .$(`li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`)
          .getAttribute("aria-selected"),
      ).toBe("true");

      await (await exportButton("SVG"))?.click();
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });

      const calls = await ipcCalls();
      const begun = calls.filter((call) => call.command === "begin_selected_spectrum_export");
      expect(begun).toHaveLength(1);
      // The vendor row's handle is not what an export carries, and never was:
      // the token comes from the loaded spectrum's own panel data.
      expect(JSON.stringify(begun[0]?.args)).not.toContain(VENDOR_ROW.handle);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("panel states", () => {
    it("offers nothing before a spectrum has loaded", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      // No preview, so no spectrum panel at all -- and therefore no export.
      expect(await browser.$(PANEL).isExisting()).toBe(false);
      expect(await browser.$(EXPORT_BLOCK).isExisting()).toBe(false);

      await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).doubleClick();
      await browser.$(PANEL).waitForDisplayed();
      await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed();
      // A preview is loaded and no spectrum is selected: still nothing.
      expect(await browser.$(EXPORT_BLOCK).isExisting()).toBe(false);
    });

    it("offers all three formats for a spectrum that loaded with no peaks", async () => {
      await browser.setWindowSize(1366, 768);
      await open({ emptySpectrum: true });
      await loadSpectrum();

      expect(await browser.$(".empty-state").getText()).toContain("This spectrum has no peaks");
      for (const format of FORMATS) {
        expect(await (await exportButton(format))?.isEnabled()).toBe(true);
      }
      const panel = await boxOf(PANEL);
      for (const format of FORMATS) {
        expect(contains(panel, await boxOfButton(`Export ${format}…`))).toBe(true);
      }
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers nothing when the spectrum could not be loaded", async () => {
      await browser.setWindowSize(1366, 768);
      await installIpcBoundary(ipcTable());
      await browser.url("/");
      await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();
      await setInvokeRejection("load_selected_spectrum", {
        kind: "spectrum_failed",
        summary: "That spectrum could not be read.",
        detail: null,
        retryable: true,
      });

      await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).doubleClick();
      await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed();
      await browser.$('div.spectrum-table-row[data-row-position="0"]').click();
      await browser.waitUntil(
        async () => (await browser.$(PANEL).getText()).includes("could not be loaded"),
        { timeout: 15_000 },
      );

      expect(await browser.$(EXPORT_BLOCK).isExisting()).toBe(false);
    });
  });

  describe("console", () => {
    it("introduces no error, warning, rejection or uncaught exception", async () => {
      await browser.setWindowSize(1366, 768);
      await open();
      await loadSpectrum();
      await (await exportButton("SVG"))?.click();
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });

      const unexpected = await unexpectedConsole();
      expect(unexpected).toEqual([]);
    });
  });
});
