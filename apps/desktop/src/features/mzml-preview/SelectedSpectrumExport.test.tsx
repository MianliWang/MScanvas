import { UI_RESOURCES } from "../preferences/i18n";
import { validateFigureDraft } from "./figureSettingsValidation";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
/**
 * The selected spectrum's export actions, in its plot head.
 *
 * Every state this panel can be in decides whether an export is offered at all,
 * and the loaded state decides what a user is told about one that ran. Both are
 * asserted here rather than left to the hook, because the whole point of this
 * surface is that a person can reach it: an action that exists but is refused
 * without a reason, or a result that outlives the spectrum it describes, are
 * failures a passing hook test would not see. Range, size and theme are the
 * figure dialog's, and are tested there.
 */

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ExportedSpectrumRange, SelectedSpectrum } from "./contracts";
import { SelectedSpectrumPanel } from "./SelectedSpectrumPanel";
import { initialSpectrumViewportState } from "./viewer/spectrumViewport";
import type { FigureSettingsDraft, SpectrumExportState, SpectrumState } from "./usePreviewWorkspace";
import { buildSpectrum } from "../../test/previewFixtures";

const en = UI_RESOURCES.en;

const DEFAULT_DRAFT: FigureSettingsDraft = { widthPx: "1200", heightPx: "640", pngDpi: "300", theme: "light" };

/**
 * The m/z viewport props, held at the state that has no viewport: every export
 * result below is reached without one, through the token Rust retained.
 */
const NO_VIEWPORT = {
  onOpenFigure: () => undefined,
  viewport: initialSpectrumViewportState,
  dispatchViewport: () => initialSpectrumViewportState,
  readViewport: () => initialSpectrumViewportState,
  projectionError: null,
  onRetryProjection: () => undefined,
} as const;

function renderPanel(
  state: SpectrumState,
  exportState: SpectrumExportState = { status: "idle" },
  draft: FigureSettingsDraft = DEFAULT_DRAFT,
  // The lane is busy while *either* surface owns it; this panel's own running
  // state is one of the two ways it can be.
  scientificExportBusy: boolean = exportState.status === "running",
) {
  const onExport = vi.fn();
  const onDismiss = vi.fn();
  const onCopyPlot = vi.fn();
  const onOpenFigure = vi.fn();
  const view = render(
    <SelectedSpectrumPanel
      {...NO_VIEWPORT}
      exportState={exportState}
      figureSettingsValidation={validateFigureDraft(draft)}
      onCopyPlot={onCopyPlot}
      onDismissExport={onDismiss}
      onExport={onExport}
      onOpenFigure={onOpenFigure}
      onRetry={() => undefined}
      scientificExportBusy={scientificExportBusy}
      state={state}
    />,
  );
  return { ...view, onExport, onDismiss, onCopyPlot, onOpenFigure };
}

function loaded(overrides: Partial<SelectedSpectrum> = {}): SpectrumState {
  return { status: "loaded", spectrum: { ...buildSpectrum(3, 4), ...overrides } };
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Opens the ⋯ menu and returns its data items. */
async function dataItems(): Promise<readonly HTMLElement[]> {
  fireEvent.keyDown(button(en.plotMoreExports), { key: "Enter" });
  return Promise.all(["CSV", "TSV"].map(format => screen.findByRole("menuitem", { name: `Export ${format}…` })));
}

describe("selected spectrum export actions", () => {
  it("offers nothing before a spectrum has loaded", () => {
    // None of these states has a measurement to write. An export control here
    // would be an action that is present and refuses, which is worse than one
    // that is not there.
    for (const state of [
      { status: "none" } as const,
      { status: "loading", index: 3 } as const,
      { status: "unavailable", requestedIndex: 3 } as const,
      { status: "failed", index: 3, error: { kind: "spectrum_failed", summary: "No.", detail: null, retryable: true } } as const,
    ]) {
      const { unmount } = renderPanel(state);
      expect(screen.queryByRole("button", { name: en.figureExportTitle })).toBeNull();
      expect(screen.queryByRole("button", { name: en.plotMoreExports })).toBeNull();
      unmount();
    }
  });

  it("offers the figure, PNG, Copy and both data formats for a loaded spectrum", async () => {
    const { onExport, onCopyPlot, onOpenFigure } = renderPanel(loaded());

    fireEvent.click(button(en.figureExportTitle));
    fireEvent.click(button(en.figureQuickPng));
    fireEvent.click(button(en.viewerCopy));
    for (const item of await dataItems()) expect(item).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV…" }));

    expect(onOpenFigure).toHaveBeenCalledOnce();
    expect(onCopyPlot).toHaveBeenCalledOnce();
    expect(onExport.mock.calls).toEqual([["png"], ["csv"]]);
  });

  it("offers them for a spectrum that loaded with no peaks, with no range controls", async () => {
    // An empty spectrum is a real scientific answer, and an honest empty figure
    // is a real export of it.
    renderPanel(loaded({ pointCount: 0, mz: [], intensity: [] }));

    expect(button(en.figureQuickPng)).not.toHaveAttribute("aria-disabled");
    for (const item of await dataItems()) expect(item).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: en.viewerMzZoomIn })).toBeNull();
    expect(screen.getByText("This spectrum has no peaks")).toBeVisible();
  });

  it("refuses every action while one export is running, and says why and which", async () => {
    renderPanel(loaded(), { status: "running", operation: "svg", namesVisibleRun: true });

    // Rust holds one export slot and refuses a second, so the others are
    // refused -- still focusable, pointing at the visible reason.
    for (const name of [en.figureQuickPng, en.viewerCopy]) {
      expect(button(name)).toHaveAttribute("aria-disabled", "true");
      expect(button(name)).toHaveAccessibleDescription(en.plotExportBusy);
    }
    expect(screen.getByText(en.plotExportBusy)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Choose where to save the SVG file.");
    for (const item of await dataItems()) expect(item).toHaveAttribute("aria-disabled", "true");
  });

  it("names the running PNG on its own initiator", () => {
    renderPanel(loaded(), { status: "running", operation: "png", namesVisibleRun: true });
    expect(screen.getByRole("status")).toHaveTextContent("Choose where to save the PNG file.");
    expect(button(en.figureQuickPng)).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses PNG alone when the resolution is the unusable field, and says so", () => {
    renderPanel(loaded(), { status: "idle" }, { ...DEFAULT_DRAFT, pngDpi: "0" });

    expect(button(en.figureQuickPng)).toHaveAttribute("aria-disabled", "true");
    expect(button(en.figureQuickPng)).toHaveAccessibleDescription(en.invalidDpi);
    expect(button(en.viewerCopy)).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(en.invalidDpi)).toBeVisible();
  });

  it("refuses PNG and Copy when the size is the unusable field, and leaves the dialog open to fix it", () => {
    renderPanel(loaded(), { status: "idle" }, { ...DEFAULT_DRAFT, widthPx: "" });

    expect(button(en.figureQuickPng)).toHaveAttribute("aria-disabled", "true");
    expect(button(en.viewerCopy)).toHaveAttribute("aria-disabled", "true");
    expect(button(en.figureExportTitle)).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(en.invalidWidth)).toBeVisible();
  });

  it("reports a saved export by name and point count, and never a path", () => {
    renderPanel(loaded(), {
      status: "saved", format: "csv", fileName: "mscanvas-spectrum-3.csv", figure: null,
      rangeScope: "full", rangeLow: null, rangeHigh: null, sourcePointCount: 1_000_000, exportedPointCount: 1_000_000,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved mscanvas-spectrum-3.csv with 1,000,000 points.");
    expect(status.textContent).not.toMatch(/[/\\]/u);
  });

  it("reports what a figure was rendered as", () => {
    renderPanel(loaded(), {
      status: "saved", format: "png", fileName: "mscanvas-spectrum-3.png", figure: { width: 1_200, height: 640, dpi: 300, theme: "light" },
      rangeScope: "full", rangeLow: null, rangeHigh: null, sourcePointCount: 1_000_000, exportedPointCount: 1_000_000,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved mscanvas-spectrum-3.png with 1,000,000 points, 1,200 by 640 pixels, Light theme, 300 DPI.",
    );
  });

  it("reports a copied plot without naming a file or a resolution", () => {
    renderPanel(loaded(), {
      status: "copied", figure: { width: 1_200, height: 640, theme: "dark" },
      rangeScope: "full", rangeLow: null, rangeHigh: null, sourcePointCount: 8, exportedPointCount: 8,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Copied the plot with 8 points, 1,200 by 640 pixels");
    expect(status).not.toHaveTextContent("Saved");
    expect(status).not.toHaveTextContent("DPI");
    expect(button("Dismiss export message")).toBeVisible();
  });

  it("treats a dismissed dialog as an outcome rather than a failure", () => {
    renderPanel(loaded(), { status: "cancelled" });

    expect(screen.getByRole("status")).toHaveTextContent("Export cancelled. Nothing was saved.");
    expect(button(en.figureQuickPng)).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(/^Spectrum 3, MS/u)).toBeVisible();
  });

  it("localizes a known typed refusal, says what it left behind and keeps recovery", () => {
    renderPanel(loaded(), {
      status: "failed", operation: "csv",
      error: {
        kind: "spectrum_destination_exists",
        summary: "A file of that name is already in that folder.",
        detail: 'MSCanvas also left a temporary file whose name begins with ".mscanvas-export-" in that folder and could not remove it.',
        retryable: true,
      },
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(en.m74ErrorExists);
    expect(status).toHaveTextContent(".mscanvas-export-");
    expect(button(en.viewerCopy)).not.toHaveAttribute("aria-disabled");
  });

  it("lets a result be dismissed without touching the spectrum, and offers no dismissal at rest", () => {
    const { onDismiss, unmount } = renderPanel(loaded(), { status: "cancelled" });
    fireEvent.click(button("Dismiss export message"));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.getByText(/^Spectrum 3, MS/u)).toBeVisible();
    unmount();

    renderPanel(loaded());
    expect(screen.queryByRole("button", { name: "Dismiss export message" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("returns focus to ⋯ once a data item closes the menu", async () => {
    renderPanel(loaded());
    const more = button(en.plotMoreExports);
    more.focus();
    await dataItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Export TSV…" }));
    await waitFor(() => expect(more).toHaveFocus());
  });
});

describe("what a finished range export is allowed to claim", () => {
  function savedOver(range: Partial<ExportedSpectrumRange> & { readonly fileName?: string }): SpectrumExportState {
    return {
      status: "saved", format: "csv", fileName: "mscanvas-spectrum-3-current.csv", figure: null,
      rangeScope: "current", rangeLow: 105.25, rangeHigh: 130.5, sourcePointCount: 1_000_000, exportedPointCount: 2_500, ...range,
    };
  }

  it("names the file, both counts and the exact bounds it was taken over", () => {
    renderPanel(loaded(), savedOver({}));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved mscanvas-spectrum-3-current.csv with 2,500 of 1,000,000 points, m/z 105.25 to 130.5.");
    expect(status.textContent?.replaceAll("m/z", "")).not.toMatch(/[/\\]/u);
  });

  it("reports an empty range as a successful export rather than a failure", () => {
    renderPanel(loaded(), savedOver({ exportedPointCount: 0 }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved mscanvas-spectrum-3-current.csv with 0 of 1,000,000");
    expect(status).not.toHaveTextContent("could not");
  });

  it("names the range a copy covered, since the clipboard holds one image", () => {
    renderPanel(loaded(), {
      status: "copied", figure: { width: 1_200, height: 640, theme: "light" },
      rangeScope: "current", rangeLow: 105.25, rangeHigh: 130.5, sourcePointCount: 1_000_000, exportedPointCount: 2_500,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied the plot with 2,500 of 1,000,000 points, m/z 105.25 to 130.5, 1,200 by 640 pixels, Light theme.",
    );
  });
});
