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

/** Opens the ⋯ menu from the keyboard and waits for its items. */
async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: en.plotMoreExports }), { key: "Enter" });
  await screen.findByRole("menu");
}

describe("a plot head's figure actions", () => {
  it("offers Export… and ⋯ in the head, and Quick PNG and Copy plot in the menu", async () => {
    renderActions();
    expect(screen.getByRole("button", { name: en.figureExportTitle })).toHaveTextContent(en.plotExport);
    // Direction A's head: no PNG or Copy button beside Export….
    expect(screen.queryByRole("button", { name: en.figureQuickPng })).toBeNull();
    expect(screen.queryByRole("button", { name: en.viewerCopy })).toBeNull();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: en.figureQuickPng })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: en.viewerCopy })).toBeVisible();
  });

  it("starts one PNG and refuses a repeat, or a Copy, while it runs", async () => {
    const pending = deferred<void>();
    const png = vi.fn(() => pending.promise);
    const copy = vi.fn();
    function Harness() {
      const [busy, setBusy] = useState(false);
      return <QuickFigureActions busy={busy} figureUnavailable={false} pngUnavailable={false} menuItems={[]}
        onPreview={() => {}} onPng={() => { setBusy(true); void png().finally(() => setBusy(false)); }} onCopy={copy} />;
    }
    render(<SessionPreferencesProvider><Harness /></SessionPreferencesProvider>);
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: en.figureQuickPng }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(png).toHaveBeenCalledOnce();
    await openMenu();
    // Named by the running format, refused rather than disabled, and still in the menu.
    const running = screen.getByRole("menuitem", { name: "Exporting PNG…" });
    expect(running).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(running);
    expect(png).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("menuitem", { name: en.viewerCopy }));
    expect(copy).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); });
    expect(screen.getByRole("menuitem", { name: en.figureQuickPng })).not.toHaveAttribute("aria-disabled");
  });

  it("opens the figure dialog from Export…, which keeps its full name", () => {
    const onPreview = vi.fn();
    renderActions({ onPreview });
    const open = screen.getByRole("button", { name: en.figureExportTitle });
    expect(open).toHaveTextContent(en.plotExport);
    fireEvent.click(open);
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it("refuses PNG and Copy with the reason inside each item, and keeps both in the arrow-key order", async () => {
    const onPng = vi.fn();
    renderActions({ figureUnavailable: true, reason: "Width must be a whole number of at least 1.", onPng });
    await openMenu();
    for (const name of [en.figureQuickPng, en.viewerCopy]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).not.toHaveAttribute("data-disabled");
      expect(item).toHaveAccessibleDescription("Width must be a whole number of at least 1.");
    }
    fireEvent.click(screen.getByRole("menuitem", { name: en.figureQuickPng }));
    expect(onPng).not.toHaveBeenCalled();
  });

  it("lists the plot's own items first, then the other exports, and says why a closed one is closed", async () => {
    const range = vi.fn();
    const csv = vi.fn();
    const linked = vi.fn();
    const items: PlotMenuItem[] = [
      { key: "csv", label: "Export CSV…", onSelect: csv, describedBy: "note" },
      { key: "linked", label: en.figurePreviewLinked, onSelect: linked, refused: true, reason: en.linkedNoSpectrum },
    ];
    renderActions({ leadingItems: [{ key: "range", label: en.rangeSet, onSelect: range }], menuItems: items,
      menuNote: { id: "note", text: en.viewerExportTraceHelp } });
    const more = screen.getByRole("button", { name: en.plotMoreExports });
    await openMenu();
    // Each item's label is its first text; a reason follows it.
    expect(screen.getAllByRole("menuitem").map(item => item.childNodes[0]?.textContent))
      .toEqual([en.rangeSet, en.figureQuickPng, en.viewerCopy, "Export CSV…", en.figurePreviewLinked]);
    // Refused rather than disabled: named by its label alone, described by its
    // reason, and still an item the arrow keys reach.
    const closed = screen.getByRole("menuitem", { name: en.figurePreviewLinked });
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
