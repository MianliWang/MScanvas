import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { UI_RESOURCES } from "../preferences/i18n";
import { deferred } from "../../test/previewFixtures";
import { QuickFigureActions, type PlotMenuItem } from "./QuickFigureActions";

const en = UI_RESOURCES.en;

function renderActions(props: Partial<Parameters<typeof QuickFigureActions>[0]> = {}) {
  return render(<SessionPreferencesProvider><QuickFigureActions busy={false} figureUnavailable={false} pngUnavailable={false}
    onPreview={() => {}} onPng={() => {}} onCopy={() => {}} menuItems={[]} {...props} /></SessionPreferencesProvider>);
}

describe("a plot head's figure actions", () => {
  it("keeps the PNG initiator focusable, names its running format and guards repeated activation", async () => {
    const pending = deferred<void>();
    const png = vi.fn(() => pending.promise);
    const copy = vi.fn();
    function Harness() {
      const [busy, setBusy] = useState(false);
      return <QuickFigureActions busy={busy} figureUnavailable={false} pngUnavailable={false} menuItems={[]}
        onPreview={() => {}} onPng={() => { setBusy(true); void png().finally(() => setBusy(false)); }} onCopy={copy} />;
    }
    render(<SessionPreferencesProvider><Harness /></SessionPreferencesProvider>);
    const button = screen.getByRole("button", { name: en.figureQuickPng });
    expect(button).toHaveTextContent("PNG");
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAccessibleName("Exporting PNG…");
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(png).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: en.viewerCopy })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: en.viewerCopy }));
    expect(copy).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); });
    expect(button).toHaveAccessibleName(en.figureQuickPng);
    expect(button).toHaveFocus();
  });

  it("opens the figure dialog from Export…, which keeps its full name", () => {
    const onPreview = vi.fn();
    renderActions({ onPreview });
    const open = screen.getByRole("button", { name: en.figureExportTitle });
    expect(open).toHaveTextContent(en.plotExport);
    fireEvent.click(open);
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it("refuses PNG and Copy with the visible reason, and keeps both in the Tab order", () => {
    const onPng = vi.fn();
    render(<SessionPreferencesProvider>
      <QuickFigureActions busy={false} figureUnavailable pngUnavailable={false} reasonId="why" menuItems={[]}
        onPreview={() => {}} onPng={onPng} onCopy={() => {}} />
      <p id="why">Width must be a whole number of at least 1.</p>
    </SessionPreferencesProvider>);
    for (const name of [en.figureQuickPng, en.viewerCopy]) {
      const control = screen.getByRole("button", { name });
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).not.toBeDisabled();
      expect(control).toHaveAccessibleDescription("Width must be a whole number of at least 1.");
    }
    fireEvent.click(screen.getByRole("button", { name: en.figureQuickPng }));
    expect(onPng).not.toHaveBeenCalled();
  });

  it("lists the other exports under ⋯, and says why a closed one is closed", async () => {
    const csv = vi.fn();
    const linked = vi.fn();
    const items: PlotMenuItem[] = [
      { key: "csv", label: "Export CSV…", onSelect: csv, describedBy: "note" },
      { key: "linked", label: en.figurePreviewLinked, onSelect: linked, refused: true, reason: en.linkedNoSpectrum },
    ];
    renderActions({ menuItems: items, menuNote: { id: "note", text: en.viewerExportTraceHelp } });
    const more = screen.getByRole("button", { name: en.plotMoreExports });
    fireEvent.keyDown(more, { key: "Enter" });
    // Refused rather than disabled: named by its label alone, described by its
    // reason, and still an item the arrow keys reach.
    const closed = await screen.findByRole("menuitem", { name: en.figurePreviewLinked });
    expect(closed).toHaveAttribute("aria-disabled", "true");
    expect(closed).not.toHaveAttribute("data-disabled");
    expect(closed).toHaveAccessibleDescription(en.linkedNoSpectrum);
    expect(closed).toHaveTextContent(en.linkedNoSpectrum);
    fireEvent.click(closed);
    expect(linked).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Export CSV…" })).toHaveAccessibleDescription(en.viewerExportTraceHelp);
    fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV…" }));
    expect(csv).toHaveBeenCalledWith(more);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
