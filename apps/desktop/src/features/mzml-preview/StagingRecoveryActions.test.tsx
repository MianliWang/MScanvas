import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { deferred } from "../../test/previewFixtures";
import type { StagingReclaimOutcome } from "./contracts";
import { StagingRecoveryActions } from "./StagingRecoveryActions";

const recovery = { recoveryId: "staging-7", attempt: 2, status: "recoverable" } as const;

describe("live staging recovery", () => {
  it("leaves a deliberate focus destination intact when cleanup settles", async () => {
    const pending = deferred<StagingReclaimOutcome>();
    render(<><StagingRecoveryActions recovery={recovery} enabled reclaim={() => pending.promise} onReview={vi.fn()} /><button>Other work</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Clean owned temporary output" }));
    const other = screen.getByRole("button", { name: "Other work" });
    other.focus();
    await act(async () => pending.resolve({ status: "cleaned" }));
    expect(other).toHaveFocus();
    expect(screen.getByRole("button", { name: "Review a new plan" })).not.toHaveFocus();
  });
  it("keeps cleanup distinct from replan and guards a repeated activation until its answer", async () => {
    const pending = deferred<StagingReclaimOutcome>();
    const reclaim = vi.fn(() => pending.promise);
    const review = vi.fn();
    render(<StagingRecoveryActions recovery={recovery} enabled reclaim={reclaim} onReview={review} />);
    const cleanup = screen.getByRole("button");
    cleanup.focus(); fireEvent.click(cleanup); fireEvent.click(cleanup);
    expect(cleanup).toHaveFocus();
    expect(reclaim).toHaveBeenCalledExactlyOnceWith("staging-7");
    expect(review).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ status: "cleaned" }));
    expect(review).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Owned temporary output has been cleaned");
    expect(screen.getByRole("button", { name: "Review a new plan" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Review a new plan" }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(reclaim).toHaveBeenCalledTimes(1);
  });

  it("retains the live claim after a transient lock refusal and does not turn lost proof into cleanup", async () => {
    const reclaim = vi.fn(async (): Promise<StagingReclaimOutcome> => ({ status: "refused", reason: "stillBlocked" }));
    const review = vi.fn();
    const view = render(<StagingRecoveryActions recovery={recovery} enabled reclaim={reclaim} onReview={review} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("status")).toHaveTextContent(/lock/);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-disabled", "true");
    view.rerender(<StagingRecoveryActions key="lost" recovery={{ ...recovery, status: "proofUnavailable" }} enabled reclaim={reclaim} onReview={review} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Review a new plan" }));
    expect(reclaim).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(1);
  });
});
