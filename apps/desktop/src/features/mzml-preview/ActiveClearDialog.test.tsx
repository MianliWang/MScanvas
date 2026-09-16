import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { createFakePreviewApi, deferred } from "../../test/previewFixtures";
import { ActiveClearDialog } from "./ActiveClearDialog";
import { PreviewApiProvider } from "./api";
import type { WorkspaceClearOutcome } from "./contracts";
import type { ActiveClearFocusReturn } from "./activeClearFocusReturn";

const PLAN = { planId: "clear-17", totalCount: 3, protectedCount: 2, removableCount: 1, active: true } as const;

describe("active clear confirmation", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it.each(["Remove non-running", "Cancel and clear"])("keeps %s focusable and deduplicated until refusal recovery", async name => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const result = deferred<WorkspaceClearOutcome>();
    const execute = vi.fn(() => result.promise);
    const close = vi.fn();
    const api = createFakePreviewApi({ planWorkspaceClear: () => Promise.resolve({ Ok: PLAN }) });
    render(<PreviewApiProvider value={api}><ActiveClearDialog onEmptyRosterClosed={vi.fn()} returnTo={null} onClose={close} onExecute={execute} /></PreviewApiProvider>);
    await screen.findByText(/1 of 3 rows/);
    const initiator = screen.getByRole("button", { name });
    initiator.focus(); fireEvent.click(initiator);
    expect(initiator).toBeEnabled();
    expect(initiator).toHaveAttribute("aria-disabled", "true");
    expect(initiator).toHaveFocus();
    fireEvent.click(initiator); fireEvent.keyDown(initiator, { key: "Enter" });
    expect(execute).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Return" })).toBeDisabled();
    expect(screen.getByRole("button", { name: name === "Cancel and clear" ? "Remove non-running" : "Cancel and clear" })).toBeDisabled();
    fireEvent.keyDown(initiator, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await act(async () => result.resolve({ status: "refused", reason: "stalePlan" }));
    expect(screen.getByRole("button", { name: "Check current rows" })).toHaveFocus();
    expect(initiator).toBeDisabled();
  });

  it.each(["unchanged", "removed", "blurred", "returned"])("preserves the %s ownership claim across delayed modal cleanup", async destination => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const result = deferred<WorkspaceClearOutcome>();
    const closed = vi.fn((claim: ActiveClearFocusReturn) => { const current = claim.isCurrent(); claim.release(); return current; });
    const api = createFakePreviewApi({ planWorkspaceClear: async () => ({ Ok: PLAN }) });
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <ActiveClearDialog returnTo={null} onClose={() => setOpen(false)} onEmptyRosterClosed={closed} onExecute={() => result.promise} /> : null;
    }
    render(<PreviewApiProvider value={api}><Harness /></PreviewApiProvider>);
    await screen.findByText(/1 of 3 rows/);
    const initiator = screen.getByRole("button", { name: "Cancel and clear" });
    initiator.focus(); fireEvent.click(initiator);
    // Hold only the already-announced Radix cleanup task, after async planning.
    vi.useFakeTimers();
    await act(async () => result.resolve({ status: "removed", result: { roster: { capacity: 1024, datasets: [] }, removedHandles: [], unknownHandles: [] } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closed).not.toHaveBeenCalled();
    if (destination === "removed") {
      const chosen = document.createElement("button");
      document.body.append(chosen); chosen.focus(); chosen.remove();
    } else if (destination !== "unchanged") {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      fireEvent(window, new Event("blur"));
      if (destination === "returned") {
        vi.mocked(document.hasFocus).mockReturnValue(true);
        fireEvent(window, new Event("focus"));
      }
    }
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(closed).toHaveBeenCalledOnce();
    expect(closed).toHaveReturnedWith(destination === "unchanged");
  });

  it.each([true, false])("recovers an execution exception only while the document owns focus (%s)", async foreground => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const result = deferred<WorkspaceClearOutcome>();
    const api = createFakePreviewApi({ planWorkspaceClear: async () => ({ Ok: PLAN }) });
    render(<PreviewApiProvider value={api}><ActiveClearDialog returnTo={null} onClose={vi.fn()} onEmptyRosterClosed={vi.fn()} onExecute={() => result.promise} /></PreviewApiProvider>);
    await screen.findByText(/1 of 3 rows/);
    const initiator = screen.getByRole("button", { name: "Cancel and clear" });
    initiator.focus(); fireEvent.click(initiator);
    vi.mocked(document.hasFocus).mockReturnValue(foreground);
    await act(async () => result.reject(Error("Controlled execution failure")));
    const recovery = screen.getByRole("button", { name: "Check current rows" });
    expect(recovery).toBeEnabled();
    if (foreground) expect(recovery).toHaveFocus(); else expect(recovery).not.toHaveFocus();
  });

  it("displays Rust counts, deduplicates confirmation and keeps a stale refusal actionable", async () => {
    const result = deferred<WorkspaceClearOutcome>();
    const execute = vi.fn(() => result.promise);
    const close = vi.fn();
    const api = createFakePreviewApi({ planWorkspaceClear: () => Promise.resolve({ Ok: PLAN }) });
    render(<PreviewApiProvider value={api}><ActiveClearDialog onEmptyRosterClosed={vi.fn()} returnTo={null} onClose={close} onExecute={execute} /></PreviewApiProvider>);
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
      return <><button onClick={event => setReturnTo(event.currentTarget)}>Clear</button>{returnTo ? <ActiveClearDialog onEmptyRosterClosed={vi.fn()} returnTo={returnTo} onClose={() => setReturnTo(null)} onExecute={execute} /> : null}</>;
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
    render(<PreviewApiProvider value={api}><ActiveClearDialog onEmptyRosterClosed={vi.fn()} returnTo={null} onClose={vi.fn()} onExecute={execute} /></PreviewApiProvider>);
    await screen.findByText(/Every captured row belongs/);
    const remove = screen.getByRole("button", { name: "Remove non-running" });
    expect(remove).toBeDisabled(); fireEvent.click(remove);
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel and clear" })).toBeEnabled();
  });
});
