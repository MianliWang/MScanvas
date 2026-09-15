import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { createFakePreviewApi, deferred } from "../../test/previewFixtures";
import { ActiveClearDialog } from "./ActiveClearDialog";
import { PreviewApiProvider } from "./api";
import type { WorkspaceClearOutcome } from "./contracts";

const PLAN = { planId: "clear-17", totalCount: 3, protectedCount: 2, removableCount: 1, active: true } as const;

describe("active clear confirmation", () => {
  afterEach(() => vi.restoreAllMocks());
  it("displays Rust counts, deduplicates confirmation and keeps a stale refusal actionable", async () => {
    const result = deferred<WorkspaceClearOutcome>();
    const execute = vi.fn(() => result.promise);
    const close = vi.fn();
    const api = createFakePreviewApi({ planWorkspaceClear: () => Promise.resolve({ Ok: PLAN }) });
    render(<PreviewApiProvider value={api}><ActiveClearDialog returnTo={null} onClose={close} onExecute={execute} /></PreviewApiProvider>);
    expect(await screen.findByText("1 of 3 rows can be removed now; 2 are protected by this conversion.")).toBeVisible();
    const remove = screen.getByRole("button", { name: "Remove non-running" });
    fireEvent.click(remove); fireEvent.click(remove);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("clear-17", "removeNonRunning");
    expect(screen.getByRole("button", { name: "Cancel and clear" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await act(async () => { result.resolve({ status: "refused", reason: "stalePlan" }); });
    expect(screen.getByText(/rows or conversion changed/)).toBeVisible();
    expect(remove).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check current rows" }));
    await waitFor(() => expect(remove).toBeEnabled());
  });

  it("Return and Escape spend no mutation and restore the initiating control", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const execute = vi.fn();
    const api = createFakePreviewApi({ planWorkspaceClear: () => Promise.resolve({ Ok: PLAN }) });
    function Harness() {
      const [returnTo, setReturnTo] = useState<HTMLElement | null>(null);
      return <><button onClick={event => setReturnTo(event.currentTarget)}>Clear</button>{returnTo ? <ActiveClearDialog returnTo={returnTo} onClose={() => setReturnTo(null)} onExecute={execute} /> : null}</>;
    }
    render(<PreviewApiProvider value={api}><Harness /></PreviewApiProvider>);
    const clear = screen.getByRole("button", { name: "Clear" });
    clear.focus(); fireEvent.click(clear);
    await screen.findByText(/1 of 3 rows/);
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    await waitFor(() => expect(clear).toHaveFocus());
    fireEvent.click(clear);
    await screen.findByText(/1 of 3 rows/);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(clear).toHaveFocus());
    expect(execute).not.toHaveBeenCalled();
  });

  it("offers no non-running mutation for an entirely protected captured set", async () => {
    const execute = vi.fn();
    const api = createFakePreviewApi({ planWorkspaceClear: () => Promise.resolve({ Ok: { ...PLAN, removableCount: 0, protectedCount: 3 } }) });
    render(<PreviewApiProvider value={api}><ActiveClearDialog returnTo={null} onClose={vi.fn()} onExecute={execute} /></PreviewApiProvider>);
    await screen.findByText(/Every captured row belongs/);
    const remove = screen.getByRole("button", { name: "Remove non-running" });
    expect(remove).toBeDisabled(); fireEvent.click(remove);
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel and clear" })).toBeEnabled();
  });
});
