import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { UI_RESOURCES } from "../preferences/i18n";
import { deferred } from "../../test/previewFixtures";
import { QuickFigureActions } from "./QuickFigureActions";

describe("quick scientific figure actions", () => {
  it("keeps the PNG initiator focusable, names its running format and guards repeated activation", async () => {
    const pending = deferred<void>();
    const png = vi.fn(() => pending.promise);
    const copy = vi.fn();
    function Harness() {
      const [busy, setBusy] = useState(false);
      return <QuickFigureActions busy={busy} figureUnavailable={false} pngUnavailable={false} context="Spectrum 2 · Current range · 960 × 600 px"
        onPreview={() => {}} onPng={() => { setBusy(true); void png().finally(() => setBusy(false)); }} onCopy={copy} />;
    }
    render(<SessionPreferencesProvider><Harness /></SessionPreferencesProvider>);
    const button = screen.getByRole("button", { name: UI_RESOURCES.en.figureQuickPng });
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAccessibleName("Exporting PNG…");
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(png).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Copy plot" })).toBeDisabled();
    expect(copy).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); });
    expect(button).toHaveAccessibleName(UI_RESOURCES.en.figureQuickPng);
    expect(button).toHaveFocus();
  });
});
