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
import type { SpectrumExportState, SpectrumState } from "./usePreviewWorkspace";
import { buildSpectrum } from "../../test/previewFixtures";

function renderPanel(
  state: SpectrumState,
  exportState: SpectrumExportState = { status: "idle" },
): { readonly onExport: ReturnType<typeof vi.fn>; readonly onDismiss: ReturnType<typeof vi.fn> } {
  const onExport = vi.fn();
  const onDismiss = vi.fn();
  render(
    <SelectedSpectrumPanel
      exportState={exportState}
      onDismissExport={onDismiss}
      onExport={onExport}
      onRetry={() => undefined}
      state={state}
    />,
  );
  return { onExport, onDismiss };
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
          onDismissExport={() => undefined}
          onExport={() => undefined}
          onRetry={() => undefined}
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
    renderPanel(loaded(), { status: "exporting", format: "svg" });

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
      format: "tsv",
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
      format: "csv",
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
});
