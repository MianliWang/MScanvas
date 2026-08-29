/**
 * M4.2: the figure a user chooses, and what the interface sends because of it.
 *
 * The M4.1 suite beside this one already pins the panel's layout, its focus
 * treatment and every export outcome. What is new here is that a figure now has
 * settings, that two of the five actions draw pixels, and that one of them
 * writes no file at all -- so what these tests watch is the *arguments*: exactly
 * which numbers cross the boundary, for which action, and which never do.
 *
 * The backend is replaced at the `invoke` boundary and nothing else is. Whether
 * Rust honours these numbers is settled in Rust, against the bytes it produces;
 * what a rendered test can settle is that the numbers leaving here are the ones
 * the user chose.
 */

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  installIpcBoundary,
  ipcCalls,
  setInvokeRejection,
  setInvokeResult,
} from "../support/harness";
import { COMPLETE_POINT_COUNT, MZML_ROW, ipcTable } from "../support/fixtures";

const EXPORT_BLOCK = ".spectrum-export";
const STATUS = ".spectrum-export-status";
const PROBLEM = "#spectrum-figure-problem";
const DPI_PROBLEM = "#spectrum-figure-dpi-problem";

interface FigureSettings {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pngDpi: number;
  readonly theme: string;
}

async function open(): Promise<void> {
  await installIpcBoundary(ipcTable());
  await browser.url("/");
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).waitForDisplayed();
  await browser.$(`li.dataset-row[data-handle="${MZML_ROW.handle}"]`).doubleClick();
  await browser.$('div.spectrum-table-row[data-row-position="0"]').waitForDisplayed();
  await browser.$('div.spectrum-table-row[data-row-position="0"]').click();
  await browser.$(EXPORT_BLOCK).waitForDisplayed();
}

/**
 * Types one figure field, replacing whatever it held.
 *
 * Emptied with the keyboard rather than with `setValue("")`, which is a no-op
 * that leaves the previous number in place -- and a blank field is a real state
 * a person passes through on the way to a different number, so it has to be
 * reachable here too.
 */
async function setField(label: string, value: string): Promise<void> {
  const field = await fieldOf(label);
  await field.click();
  await browser.keys(["Control", "a"]);
  await browser.keys(["Delete"]);
  if (value !== "") {
    await field.setValue(value);
  }
}

async function fieldOf(label: string): Promise<WebdriverIO.Element> {
  const inputs = await browser.$$("label.spectrum-figure-field input").getElements();
  for (const input of inputs) {
    const owner = await input.parentElement();
    if ((await owner.getText()).trim().startsWith(label)) {
      return input;
    }
  }
  throw new Error(`no figure field labelled ${label}`);
}

async function press(label: string): Promise<void> {
  await browser.$(`button=${label}`).click();
}

async function statusText(): Promise<string> {
  return (await browser.$(STATUS).getText()).trim();
}

async function argumentsOf(command: string): Promise<Record<string, unknown>[]> {
  return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args);
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .map((entry) => `${entry.level}: ${entry.text}`)
    .filter((line) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => line.includes(allowed)));
}

describe("M4.2 figure settings, in the rendered interface", () => {
  describe("what crosses the boundary", () => {
    it("sends the figure the user chose with a PNG export", async () => {
      await open();
      await setInvokeResult("save_selected_spectrum_export", {
        status: "saved",
        format: "png",
        fileName: "mscanvas-spectrum-0.png",
        figure: { width: 800, height: 600, dpi: 600, theme: "dark" },
        rangeScope: "full",
        rangeLow: null,
        rangeHigh: null,
        sourcePointCount: COMPLETE_POINT_COUNT,
        exportedPointCount: COMPLETE_POINT_COUNT,
      });

      await setField("Width", "800");
      await setField("Height", "600");
      await setField("PNG DPI", "600");
      await browser.$("input[type='radio'][value='dark']").click();
      await press("Export PNG…");
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });

      const begun = await argumentsOf("begin_selected_spectrum_export");
      expect(begun).toHaveLength(1);
      expect(begun[0]?.["format"]).toBe("png");
      expect(typeof begun[0]?.["exportToken"]).toBe("string");
      expect(String(begun[0]?.["exportToken"]).length).toBeGreaterThan(0);
      expect(begun[0]?.["settings"]).toEqual({
        widthPx: 800,
        heightPx: 600,
        pngDpi: 600,
        theme: "dark",
      } satisfies FigureSettings);

      // What came back describes the file rather than the request, which is how
      // a reader knows the setting took effect.
      expect(await statusText()).toContain("800 by 600 pixels at 600 DPI, dark theme");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("reports no physical resolution for a vector export", async () => {
      await open();
      await setInvokeResult("save_selected_spectrum_export", {
        status: "saved",
        format: "svg",
        fileName: "mscanvas-spectrum-0.svg",
        // The same settings object crosses for every figure format; only the
        // raster one has pixels whose physical size can be recorded.
        figure: { width: 1_200, height: 640, dpi: null, theme: "light" },
        rangeScope: "full",
        rangeLow: null,
        rangeHigh: null,
        sourcePointCount: COMPLETE_POINT_COUNT,
        exportedPointCount: COMPLETE_POINT_COUNT,
      });

      await setField("PNG DPI", "600");
      await press("Export SVG…");
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });

      const begun = await argumentsOf("begin_selected_spectrum_export");
      expect((begun[0]?.["settings"] as FigureSettings).pngDpi).toBe(600);
      // Sent, and not reflected: an SVG has no pixels to describe.
      expect(await statusText()).toContain("1,200 by 640 pixels, light theme");
      expect(await statusText()).not.toContain("DPI");
    });

    it("copies the plot without naming a format, a file or a destination", async () => {
      await open();

      await setField("Width", "640");
      await browser.$("input[type='radio'][value='dark']").click();
      await press("Copy plot");
      await browser.waitUntil(async () => (await statusText()).startsWith("Copied"), {
        timeout: 15_000,
      });

      const copied = await argumentsOf("copy_selected_spectrum_plot");
      expect(copied).toHaveLength(1);
      // The range came with M5.3, and the point of this case survives it: a copy
      // carries what it is about and nothing more -- no destination, no format,
      // and no file name, because it writes none.
      expect(Object.keys(copied[0] ?? {}).sort()).toEqual(["exportToken", "range", "settings"]);
      expect(copied[0]?.["range"]).toEqual({ scope: "full", low: null, high: null });
      expect(copied[0]?.["settings"]).toEqual({
        widthPx: 640,
        heightPx: 640,
        pngDpi: 300,
        theme: "dark",
      } satisfies FigureSettings);

      // One command, not two: a copy chooses no destination, so there is no
      // reservation to issue and no dialog to open.
      expect(await argumentsOf("begin_selected_spectrum_export")).toEqual([]);
      expect(await argumentsOf("save_selected_spectrum_export")).toEqual([]);
      expect(await statusText()).not.toContain("Saved");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("carries a data export the same way whatever the figure is set to", async () => {
      await open();
      await setInvokeResult("save_selected_spectrum_export", {
        status: "saved",
        format: "csv",
        fileName: "mscanvas-spectrum-0.csv",
        figure: null,
        rangeScope: "full",
        rangeLow: null,
        rangeHigh: null,
        sourcePointCount: COMPLETE_POINT_COUNT,
        exportedPointCount: COMPLETE_POINT_COUNT,
      });

      await setField("Width", "4000");
      await browser.$("input[type='radio'][value='dark']").click();
      await press("Export CSV…");
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });

      const begun = await argumentsOf("begin_selected_spectrum_export");
      expect(begun[0]?.["format"]).toBe("csv");
      // A data document reports no figure, so nothing about a size or a theme
      // appears beside it.
      const status = await statusText();
      expect(status).toContain("1,000,000 points.");
      expect(status).not.toContain("pixels");
      expect(status).not.toContain("theme");
    });
  });

  describe("settings that describe no figure", () => {
    for (const [field, value] of [
      ["Width", "0"],
      ["Height", ""],
    ] as const) {
      it(`refuses every figure action while ${field} is "${value}"`, async () => {
        await open();
        await setField(field, value);

        for (const action of ["Export SVG…", "Export PNG…", "Copy plot"]) {
          expect(await browser.$(`button=${action}`).isEnabled()).toBe(false);
        }
        // The data actions stay live: a width nobody could draw at says nothing
        // about a list of numbers.
        for (const action of ["Export CSV…", "Export TSV…"]) {
          expect(await browser.$(`button=${action}`).isEnabled()).toBe(true);
        }

        // Said in words, and attached to the field rather than only placed near
        // it, so it is read out when focus arrives.
        expect(await browser.$(PROBLEM).getText()).toContain("whole number of at least 1");
        const input = await fieldOf(field);
        expect(await input.getAttribute("aria-invalid")).toBe("true");
        const described = await input.getAttribute("aria-describedby");
        expect(described).toBe("spectrum-figure-problem");

        // Nothing was asked of the backend for a *figure*, because this side
        // already knew there was none to draw.
        expect(await argumentsOf("begin_selected_spectrum_export")).toEqual([]);
        expect(await argumentsOf("copy_selected_spectrum_plot")).toEqual([]);

        // But a data export still works. Leaving those buttons enabled and
        // having them do nothing would be worse than either offering them or
        // closing them -- and a size and a theme are not properties of a
        // measurement.
        await setInvokeResult("save_selected_spectrum_export", {
          status: "saved",
          format: "csv",
          fileName: "mscanvas-spectrum-0.csv",
          figure: null,
          rangeScope: "full",
          rangeLow: null,
          rangeHigh: null,
          sourcePointCount: COMPLETE_POINT_COUNT,
          exportedPointCount: COMPLETE_POINT_COUNT,
        });
        await press("Export CSV…");
        await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
          timeout: 15_000,
        });
        const data = await argumentsOf("begin_selected_spectrum_export");
        expect(data).toHaveLength(1);
        expect(data[0]?.["format"]).toBe("csv");

        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    it("closes only the PNG export while PNG DPI is \"12.5\", and sends the rest", async () => {
      // The resolution is written into one format's metadata and read by
      // nothing else. An SVG has no pixels to give a physical size to, and a
      // clipboard image is RGBA with nowhere for a `pHYs` chunk -- so closing
      // those two over this number would take away two working operations for
      // a reason that could not have reached either.
      //
      // Proven by running them, not by reading a `disabled` attribute: the
      // question is what crosses the boundary.
      await open();
      await setField("PNG DPI", "12.5");

      expect(await browser.$("button=Export PNG…").isEnabled()).toBe(false);
      for (const action of ["Export SVG…", "Copy plot", "Export CSV…", "Export TSV…"]) {
        expect(await browser.$(`button=${action}`).isEnabled()).toBe(true);
      }

      // The reason is on the field it belongs to, and the size fields beside it
      // are not marked wrong, because nothing is wrong with them.
      expect(await browser.$(DPI_PROBLEM).getText()).toContain("PNG DPI must be a whole number");
      const dpiField = await fieldOf("PNG DPI");
      expect(await dpiField.getAttribute("aria-invalid")).toBe("true");
      expect(await dpiField.getAttribute("aria-describedby")).toBe("spectrum-figure-dpi-problem");
      expect(await browser.$(PROBLEM).getText()).toBe("");
      const widthField = await fieldOf("Width");
      expect(await widthField.getAttribute("aria-invalid")).toBe(null);

      // The SVG goes, carrying the figure that was asked for and the default
      // resolution the uniform transport needs and neither side reads.
      await press("Export SVG…");
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });
      const begun = await argumentsOf("begin_selected_spectrum_export");
      expect(begun).toHaveLength(1);
      expect(begun[0]?.["format"]).toBe("svg");
      expect(begun[0]?.["settings"]).toEqual({
        widthPx: 1_200,
        heightPx: 640,
        pngDpi: 300,
        theme: "light",
      });

      // And so does the copy.
      await browser.$("button=Dismiss export message").click();
      await press("Copy plot");
      await browser.waitUntil(async () => (await statusText()).startsWith("Copied"), {
        timeout: 15_000,
      });
      const copied = await argumentsOf("copy_selected_spectrum_plot");
      expect(copied).toHaveLength(1);
      expect(copied[0]?.["settings"]).toEqual({
        widthPx: 1_200,
        heightPx: 640,
        pngDpi: 300,
        theme: "light",
      });
      // What comes back names no resolution, so neither does the sentence.
      expect(await statusText()).not.toContain("DPI");

      // The one action the number closes never asked.
      expect(begun.map((call) => call["format"])).toEqual(["svg"]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("sends a resolution only Rust can judge, rather than judging it here", async () => {
      // 50 is a whole positive number. Whether a PNG can record it is a bound
      // Rust holds, and duplicating it here would be a second copy to drift --
      // so the export goes, carrying 50, and Rust answers.
      await open();
      await setField("PNG DPI", "50");

      expect(await browser.$("button=Export PNG…").isEnabled()).toBe(true);
      await press("Export PNG…");
      await browser.waitUntil(async () => (await statusText()).startsWith("Saved"), {
        timeout: 15_000,
      });

      const begun = await argumentsOf("begin_selected_spectrum_export");
      expect(begun[0]?.["settings"]).toEqual({
        widthPx: 1_200,
        heightPx: 640,
        pngDpi: 50,
        theme: "light",
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("offers the figure actions again once the settings describe one", async () => {
      await open();
      await setField("Width", "0");
      expect(await browser.$("button=Export PNG…").isEnabled()).toBe(false);

      await setField("Width", "900");

      expect(await browser.$("button=Export PNG…").isEnabled()).toBe(true);
      expect(await browser.$(PROBLEM).getText()).toBe("");
    });
  });

  describe("refusals a figure can meet", () => {
    it("renders a typed raster refusal and leaves the vector action live", async () => {
      await open();
      await setInvokeRejection("begin_selected_spectrum_export", {
        kind: "figure_font_unavailable",
        summary:
          "MSCanvas could not find a font on this computer to draw the figure's labels with, " +
          "so no image was produced. Export the figure as SVG, which keeps the text as text.",
        detail: null,
        retryable: false,
      });

      await press("Export PNG…");
      await browser.waitUntil(async () => (await statusText()).length > 0, { timeout: 15_000 });

      expect(await statusText()).toContain("Export the figure as SVG");
      // A raster capability this machine lacks does not take the vector export
      // away, which is the whole point of saying so.
      expect(await browser.$("button=Export SVG…").isEnabled()).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("renders a typed clipboard refusal without claiming anything was copied", async () => {
      await open();
      await setInvokeRejection("copy_selected_spectrum_plot", {
        kind: "figure_clipboard_unavailable",
        summary: "MSCanvas could not put the plot on the clipboard. Nothing was copied.",
        detail: null,
        retryable: true,
      });

      await press("Copy plot");
      await browser.waitUntil(async () => (await statusText()).length > 0, { timeout: 15_000 });

      expect(await statusText()).toContain("Nothing was copied.");
      expect(await statusText()).not.toContain("Copied the plot");
      expect(await browser.$("button=Copy plot").isEnabled()).toBe(true);
    });
  });

  describe("the figure controls at every viewport", () => {
    for (const viewport of [
      { name: "1366x768", width: 1366, height: 768 },
      { name: "1920x1080", width: 1920, height: 1080 },
      { name: "960x640", width: 960, height: 640 },
    ] as const) {
      it(`offers every figure control at ${viewport.name}`, async () => {
        await browser.setWindowSize(viewport.width, viewport.height);
        await open();

        // Every control has area and is inside the panel horizontally. The
        // panel scrolls vertically by design at the narrow viewport, which is
        // reach rather than clipping.
        const facts = await browser.execute(() => {
          const panel = document.querySelector("section.spectrum-panel");
          if (panel === null) {
            return null;
          }
          const bounds = panel.getBoundingClientRect();
          const nodes = [
            ...panel.querySelectorAll("label.spectrum-figure-field input"),
            ...panel.querySelectorAll("input[type='radio']"),
            ...panel.querySelectorAll(".spectrum-export-actions button"),
          ];
          return {
            count: nodes.length,
            offenders: nodes
              .map((node) => {
                const box = node.getBoundingClientRect();
                const label = (node.getAttribute("value") ?? node.textContent ?? "").trim();
                if (box.width <= 0 || box.height <= 0) {
                  return `${label} has no area`;
                }
                if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) {
                  return `${label} escapes the panel horizontally`;
                }
                if (box.top < bounds.top - 0.5) {
                  return `${label} is drawn above the panel`;
                }
                return null;
              })
              .filter((offender) => offender !== null),
          };
        });

        expect(facts).not.toBeNull();
        // Three fields, two range scopes, two theme choices, five actions. The
        // range scopes arrived with M5.3 and are counted here rather than
        // filtered out: this case is about every control in the panel fitting
        // inside it, and a control excluded from the count is a control this
        // measurement stops making a claim about.
        expect(facts?.count).toBe(12);
        expect(facts?.offenders).toEqual([]);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  });

  describe("the keyboard", () => {
    it("reaches every figure control and activates one without a pointer", async () => {
      await browser.setWindowSize(1366, 768);
      await open();

      // From the last figure field, Tab walks the theme group and then every
      // action in document order.
      await browser.execute(() => {
        const inputs = [...document.querySelectorAll("label.spectrum-figure-field input")];
        (inputs[inputs.length - 1] as HTMLInputElement | undefined)?.focus();
      });
      await browser.keys(["Tab"]);
      expect(
        await browser.execute(() => (document.activeElement as HTMLInputElement | null)?.value),
      ).toBe("light");

      // A radio group is one tab stop; the arrow keys move within it, which is
      // the platform's own semantics rather than something invented here.
      await browser.keys(["ArrowDown"]);
      expect(
        await browser.execute(() => (document.activeElement as HTMLInputElement | null)?.value),
      ).toBe("dark");

      await browser.keys(["Tab"]);
      expect(
        await browser.execute(() => (document.activeElement?.textContent ?? "").trim()),
      ).toBe("Export SVG…");

      // And Enter runs the focused action, carrying the theme the arrow key
      // chose.
      await browser.execute(() => {
        const copy = [...document.querySelectorAll("button")].find(
          (candidate) => (candidate.textContent ?? "").trim() === "Copy plot",
        );
        copy?.focus();
      });
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await statusText()).startsWith("Copied"), {
        timeout: 15_000,
      });

      const copied = await argumentsOf("copy_selected_spectrum_plot");
      expect((copied[0]?.["settings"] as FigureSettings).theme).toBe("dark");
      expect(await unexpectedConsole()).toEqual([]);
    });
  });
});
