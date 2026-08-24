/**
 * The selected spectrum's one export affordance.
 *
 * Every state this panel can be in decides whether an export is offered at all,
 * and the loaded state decides what a user is told about one that ran. Both are
 * asserted here rather than left to the hook, because the whole point of this
 * surface is that a person can reach it: an action that exists but is refused,
 * or a result that outlives the spectrum it describes, are failures a passing
 * hook test would not see.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SelectedSpectrum } from "./contracts";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import type {
  FigureSettingsDraft,
  SpectrumExportState,
  SpectrumState,
} from "./usePreviewWorkspace";
import { buildSpectrum } from "../../test/previewFixtures";

/** The fields a panel starts with, which is what most of these tests want. */
const DEFAULT_DRAFT: FigureSettingsDraft = {
  widthPx: "1200",
  heightPx: "640",
  pngDpi: "300",
  theme: "light",
};

function renderPanel(
  state: SpectrumState,
  exportState: SpectrumExportState = { status: "idle" },
  draft: FigureSettingsDraft = DEFAULT_DRAFT,
  renderProblem: string | null = null,
  dpiProblem: string | null = null,
  // What the composition passes: the lane is busy while *either* surface owns
  // it, and this panel's own running state is one of the two ways it can be.
  // Defaulted from that so every case written before the lane was shared keeps
  // saying exactly what it said.
  scientificExportBusy: boolean = exportState.status === "running",
): {
  readonly onExport: ReturnType<typeof vi.fn>;
  readonly onDismiss: ReturnType<typeof vi.fn>;
  readonly onCopyPlot: ReturnType<typeof vi.fn>;
  readonly onFigureSetting: ReturnType<typeof vi.fn>;
  readonly onFigureTheme: ReturnType<typeof vi.fn>;
} {
  const onExport = vi.fn();
  const onDismiss = vi.fn();
  const onCopyPlot = vi.fn();
  const onFigureSetting = vi.fn();
  const onFigureTheme = vi.fn();
  render(
    <SelectedSpectrumPanel
      exportState={exportState}
      figureSettings={draft}
      onCopyPlot={onCopyPlot}
      onDismissExport={onDismiss}
      onExport={onExport}
      onFigureSetting={onFigureSetting}
      onFigureTheme={onFigureTheme}
      onRetry={() => undefined}
      pngDpiProblem={dpiProblem}
      renderSettingsProblem={renderProblem}
      scientificExportBusy={scientificExportBusy}
      state={state}
    />,
  );
  return { onExport, onDismiss, onCopyPlot, onFigureSetting, onFigureTheme };
}

function loaded(overrides: Partial<SelectedSpectrum> = {}): SpectrumState {
  return { status: "loaded", spectrum: { ...buildSpectrum(3, 4), ...overrides } };
}

function exportButtons(): readonly HTMLElement[] {
  return ["SVG", "CSV", "TSV"].map((format) =>
    screen.getByRole("button", { name: `Export ${format}…` }),
  );
}

describe("selected spectrum export affordance", () => {
  it("offers nothing before a spectrum has loaded", () => {
    // Four states, and none of them has a measurement to write. An export
    // control here would be an action that is present and refuses, which is
    // worse than one that is not there.
    for (const state of [
      { status: "none" } as const,
      { status: "loading", index: 3 } as const,
      { status: "unavailable", requestedIndex: 3 } as const,
      {
        status: "failed",
        index: 3,
        error: { kind: "spectrum_failed", summary: "No.", detail: null, retryable: true },
      } as const,
    ]) {
      const { unmount } = render(
        <SelectedSpectrumPanel
          exportState={{ status: "idle" }}
          figureSettings={DEFAULT_DRAFT}
          onCopyPlot={() => undefined}
          onDismissExport={() => undefined}
          onExport={() => undefined}
          onFigureSetting={() => undefined}
          onFigureTheme={() => undefined}
          onRetry={() => undefined}
          pngDpiProblem={null}
          renderSettingsProblem={null}
          scientificExportBusy={false}
          state={state}
        />,
      );
      expect(screen.queryByRole("button", { name: /^Export /u })).toBeNull();
      unmount();
    }
  });

  it("offers all three formats for a loaded spectrum, each named in its label", () => {
    renderPanel(loaded());

    // The accessible name carries the format, so a screen-reader user choosing
    // between three buttons is choosing between three documents rather than
    // three identically named actions.
    for (const button of exportButtons()) {
      expect(button).toBeEnabled();
    }
  });

  it("offers them for a spectrum that loaded with no peaks", () => {
    // An empty spectrum is a real scientific answer, and an honest empty figure
    // is a real export of it. Refusing here would make "this sample had no
    // peaks" the one result a user cannot take away with them.
    renderPanel(loaded({ pointCount: 0, mz: [], intensity: [] }));

    for (const button of exportButtons()) {
      expect(button).toBeEnabled();
    }
    expect(screen.getByText("This spectrum has no peaks")).toBeVisible();
  });

  it("asks for the format that was pressed", () => {
    const { onExport } = renderPanel(loaded());

    fireEvent.click(screen.getByRole("button", { name: "Export CSV…" }));

    expect(onExport.mock.calls).toEqual([["csv"]]);
  });

  it("reaches every format from the keyboard", () => {
    const { onExport } = renderPanel(loaded());

    // Ordinary buttons: focusable in document order, activated by key with no
    // pointer involved, and each one keeps a visible focus ring from the
    // shared button styles rather than removing outlines of its own.
    const [svg, csv, tsv] = exportButtons();
    for (const button of [svg, csv, tsv]) {
      button?.focus();
      expect(button).toHaveFocus();
      expect(button?.tagName).toBe("BUTTON");
      // `fireEvent.click` is what a keyboard activation dispatches on a button;
      // there is no pointer-only path into any of these.
      fireEvent.click(button as HTMLElement);
    }

    expect(onExport.mock.calls).toEqual([["svg"], ["csv"], ["tsv"]]);
  });

  it("closes every action while one export is running and says which", () => {
    renderPanel(loaded(), { status: "running", operation: "svg" });

    // Rust holds one export slot and refuses a second, so leaving the others
    // live would offer an action already known to fail.
    for (const format of ["CSV", "TSV"]) {
      expect(screen.getByRole("button", { name: `Export ${format}…` })).toBeDisabled();
    }
    const running = screen.getByRole("button", { name: "Exporting SVG…" });
    expect(running).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Choose where to save the SVG file.",
    );
  });

  it("reports a saved export by name and point count, and never a path", () => {
    renderPanel(loaded(), {
      status: "saved",
      format: "csv",
      fileName: "mscanvas-spectrum-3.csv",
      figure: null,
      pointCount: 1_000_000,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved mscanvas-spectrum-3.csv with 1,000,000 points.");
    // The count is the complete spectrum's, not the drawing's, and the folder
    // it went into is not this side's to know.
    expect(status.textContent).not.toMatch(/[/\\]/u);
  });

  it("treats a dismissed dialog as an outcome rather than a failure", () => {
    renderPanel(loaded(), { status: "cancelled" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Export cancelled. Nothing was saved.",
    );
    // Still offered, and the spectrum is exactly as it was.
    for (const button of exportButtons()) {
      expect(button).toBeEnabled();
    }
    expect(screen.getByText("Spectrum 3")).toBeVisible();
  });

  it("says what a typed refusal was, in its own words", () => {
    renderPanel(loaded(), {
      status: "failed",
      operation: "tsv",
      error: {
        kind: "spectrum_destination_exists",
        summary: "A file of that name is already in that folder.",
        detail: null,
        retryable: true,
      },
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "A file of that name is already in that folder.",
    );
    // Recoverable: the actions stay live, because choosing another name is the
    // whole of the recovery.
    for (const button of exportButtons()) {
      expect(button).toBeEnabled();
    }
  });

  it("says what a refusal left behind, not only that it refused", () => {
    // The detail is where a refusal puts the part the user has to act on. A
    // failed export that could not remove its own temporary file has left one
    // in the folder the user chose, and only the detail says so -- rendering
    // the summary alone would tell them the save did not happen and leave the
    // evidence that it half-did sitting there unexplained.
    renderPanel(loaded(), {
      status: "failed",
      operation: "csv",
      error: {
        kind: "spectrum_destination_exists",
        summary: "A file of that name is already in that folder.",
        detail:
          'MSCanvas also left a temporary file whose name begins with ".mscanvas-export-" ' +
          "in that folder and could not remove it.",
        retryable: true,
      },
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("A file of that name is already in that folder.");
    expect(status).toHaveTextContent(".mscanvas-export-");
  });

  it("lets a result be dismissed without touching the spectrum", () => {
    const { onDismiss } = renderPanel(loaded(), { status: "cancelled" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss export message" }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.getByText("Spectrum 3")).toBeVisible();
  });

  it("offers no dismissal while nothing has happened", () => {
    renderPanel(loaded());

    expect(screen.queryByRole("button", { name: "Dismiss export message" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("offers the figure controls and the data actions as separate groups", () => {
    renderPanel(loaded());

    // The figure settings decide what a figure looks like and reach nothing in
    // a data document. Grouping says so before any label has to.
    for (const label of ["Width", "Height", "PNG DPI"]) {
      expect(screen.getByRole("textbox", { name: new RegExp(`^${label}`, "u") })).toBeVisible();
    }
    for (const theme of ["Light", "Dark"]) {
      expect(screen.getByRole("radio", { name: theme })).toBeVisible();
    }
    for (const name of ["Export SVG…", "Export PNG…", "Copy plot", "Export CSV…", "Export TSV…"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    // Light is where a figure starts, because a reader publishing on paper is
    // the case a default should serve.
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  });

  it("starts at the figure M4.1 shipped", () => {
    renderPanel(loaded());

    expect(screen.getByRole("textbox", { name: /^Width/u })).toHaveValue("1200");
    expect(screen.getByRole("textbox", { name: /^Height/u })).toHaveValue("640");
    expect(screen.getByRole("textbox", { name: /^PNG DPI/u })).toHaveValue("300");
  });

  it("says DPI is one format's metadata rather than a count of pixels", () => {
    // Two things a user could be misled about by the control rather than by
    // the file: that DPI alone adds pixels, and that it reaches every figure.
    renderPanel(loaded());

    expect(screen.getByText("PNG metadata only")).toBeVisible();
  });

  it("reports every field a figure could not be built from", () => {
    renderPanel(
      loaded(),
      { status: "idle" },
      { widthPx: "0", heightPx: "", pngDpi: "12.5", theme: "light" },
      "Width, Height must be a whole number of at least 1.",
      "PNG DPI must be a whole number of at least 1.",
    );

    // The figure actions are closed, because there is no figure to draw.
    for (const name of ["Export SVG…", "Export PNG…", "Copy plot"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    // The data actions are not: a width nobody could draw at says nothing
    // about a list of numbers.
    for (const name of ["Export CSV…", "Export TSV…"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    // And the reason is attached to the fields rather than only shown near
    // them, so it is read out when focus arrives -- each field carrying its
    // own, rather than one sentence about every field there is.
    const width = screen.getByRole("textbox", { name: /^Width/u });
    expect(width).toHaveAttribute("aria-invalid", "true");
    expect(width).toHaveAccessibleDescription(
      "Width, Height must be a whole number of at least 1.",
    );
    const dpi = screen.getByRole("textbox", { name: /^PNG DPI/u });
    expect(dpi).toHaveAttribute("aria-invalid", "true");
    expect(dpi).toHaveAccessibleDescription("PNG DPI must be a whole number of at least 1.");
  });

  it("closes only the PNG export when the resolution is the unusable field", () => {
    // The Round-2 finding, as an affordance. DPI is written into one format's
    // metadata and read by nothing else: an SVG has no pixels to give a
    // physical size to, and a clipboard image is RGBA with nowhere for a
    // `pHYs` chunk. Closing those two over this number would take away two
    // working operations for a reason that could not have affected either.
    renderPanel(
      loaded(),
      { status: "idle" },
      { widthPx: "1200", heightPx: "640", pngDpi: "50", theme: "light" },
      null,
      "PNG DPI must be a whole number of at least 1.",
    );

    expect(screen.getByRole("button", { name: "Export PNG…" })).toBeDisabled();
    for (const name of ["Export SVG…", "Copy plot", "Export CSV…", "Export TSV…"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    // And the width is not marked wrong, because nothing is wrong with it.
    const width = screen.getByRole("textbox", { name: /^Width/u });
    expect(width).not.toHaveAttribute("aria-invalid");
    expect(width).toHaveAccessibleDescription("");
  });

  it("closes every figure action when the size is the unusable field", () => {
    // The other half of the same split: a width nothing can be drawn at stops
    // all three, because all three are drawings.
    renderPanel(
      loaded(),
      { status: "idle" },
      { widthPx: "", heightPx: "640", pngDpi: "300", theme: "light" },
      "Width must be a whole number of at least 1.",
      null,
    );

    for (const name of ["Export SVG…", "Export PNG…", "Copy plot"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    const dpi = screen.getByRole("textbox", { name: /^PNG DPI/u });
    expect(dpi).not.toHaveAttribute("aria-invalid");
    expect(dpi).toHaveAccessibleDescription("");
  });

  it("reports what a figure was rendered as, and a data document that it was not one", () => {
    renderPanel(loaded(), {
      status: "saved",
      format: "png",
      fileName: "mscanvas-spectrum-3.png",
      figure: { width: 1_200, height: 640, dpi: 300, theme: "light" },
      pointCount: 1_000_000,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved mscanvas-spectrum-3.png with 1,000,000 points, 1,200 by 640 pixels at 300 DPI, light theme.",
    );
  });

  it("says an SVG has no physical resolution to report", () => {
    renderPanel(loaded(), {
      status: "saved",
      format: "svg",
      fileName: "mscanvas-spectrum-3.svg",
      figure: { width: 800, height: 600, dpi: null, theme: "dark" },
      pointCount: 12,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("800 by 600 pixels, dark theme");
    expect(status).not.toHaveTextContent("DPI");
  });

  it("reports a copied plot without naming a file or a resolution", () => {
    renderPanel(loaded(), {
      status: "copied",
      figure: { width: 1_200, height: 640, theme: "dark" },
      pointCount: 8,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Copied the plot with 8 points, 1,200 by 640 pixels");
    // No file was written, so there is nothing to name and nothing to find.
    expect(status).not.toHaveTextContent("Saved");
    expect(status).not.toHaveTextContent(".png");
    // And no DPI. A clipboard image is RGBA and a size, with nowhere for a
    // `pHYs` chunk, so naming one would describe a property it does not have.
    expect(status).not.toHaveTextContent("DPI");
    // A result is still a result: it can be dismissed like any other.
    expect(screen.getByRole("button", { name: "Dismiss export message" })).toBeVisible();
  });

  it("closes every figure and data action while a copy is running", () => {
    renderPanel(loaded(), { status: "running", operation: "copy" });

    for (const name of ["Export SVG…", "Export PNG…", "Export CSV…", "Export TSV…"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    const running = screen.getByRole("button", { name: "Copying plot…" });
    expect(running).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Drawing the plot for the clipboard.");
  });

  it("closes every action while a PNG is being written and says which", () => {
    renderPanel(loaded(), { status: "running", operation: "png" });

    for (const name of ["Export SVG…", "Copy plot", "Export CSV…", "Export TSV…"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Exporting PNG…" })).toBeDisabled();
  });

  it("reports a copy that the clipboard refused", () => {
    renderPanel(loaded(), {
      status: "failed",
      operation: "copy",
      error: {
        kind: "figure_clipboard_unavailable",
        summary: "MSCanvas could not put the plot on the clipboard. Nothing was copied.",
        detail: null,
        retryable: true,
      },
    });

    expect(screen.getByRole("status")).toHaveTextContent("Nothing was copied.");
    // Retryable: the actions stay live, because trying again is the recovery.
    expect(screen.getByRole("button", { name: "Copy plot" })).toBeEnabled();
  });

  it("hands each control back to the caller rather than deciding anything itself", () => {
    const { onCopyPlot, onFigureSetting, onFigureTheme } = renderPanel(loaded());

    fireEvent.change(screen.getByRole("textbox", { name: /^Width/u }), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy plot" }));

    expect(onFigureSetting.mock.calls).toEqual([["widthPx", "800"]]);
    expect(onFigureTheme.mock.calls).toEqual([["dark"]]);
    expect(onCopyPlot).toHaveBeenCalledOnce();
  });
});
