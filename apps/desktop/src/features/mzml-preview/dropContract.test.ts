import { describe, expect, it } from "vitest";

import type {
  DropIngestionResult,
  PreviewError,
  WorkspaceDropState,
  WorkspaceDropUpdate,
} from "./contracts";

type ExpectedWorkspaceDropState =
  | { readonly status: "idle" }
  | { readonly status: "hovering"; readonly itemCount: number }
  | { readonly status: "importing"; readonly operationId: string; readonly itemCount: number }
  | {
      readonly status: "completed";
      readonly operationId: string;
      readonly result: DropIngestionResult;
    }
  | {
      readonly status: "failed";
      readonly operationId: string;
      readonly error: PreviewError;
    }
  | {
      readonly status: "rejected";
      readonly reason: "drop_busy" | "conversion_busy";
    };

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

// Compilation fails if either side gains, loses or makes optional a wire field.
const wireStateIsBidirectionallyExact: Equal<WorkspaceDropState, ExpectedWorkspaceDropState> = true;

const error: PreviewError = {
  kind: "drop_failed",
  summary: "The dropped items could not be inspected.",
  detail: null,
  retryable: true,
};

const result: DropIngestionResult = {
  roster: { datasets: [], capacity: 1_024 },
  outcomes: [],
  summary: {
    workspaceWasEmpty: true,
    complete: true,
    topLevelItemCount: 1,
    skippedReparseRootCount: 0,
    inaccessibleRootCount: 0,
    remoteRootCount: 0,
    unsupportedRootCount: 1,
    skippedReparseEntryCount: 0,
    inaccessibleEntryCount: 0,
    limitsReached: ["roots"],
  },
};

describe("workspace drop wire contract", () => {
  it("keeps the closed state union exact in both TypeScript directions", () => {
    expect(wireStateIsBidirectionallyExact).toBe(true);
  });

  it("round-trips every tagged state with the exact camelCase envelope", () => {
    const updates = [
      { sequence: 1, state: { status: "idle" } },
      { sequence: 2, state: { status: "hovering", itemCount: 3 } },
      {
        sequence: 3,
        state: { status: "importing", operationId: "18446744073709551615", itemCount: 3 },
      },
      { sequence: 4, state: { status: "completed", operationId: "17", result } },
      { sequence: 5, state: { status: "failed", operationId: "18", error } },
      { sequence: 6, state: { status: "rejected", reason: "drop_busy" } },
    ] as const satisfies readonly WorkspaceDropUpdate[];

    expect(JSON.parse(JSON.stringify(updates))).toEqual(updates);
    expect(Object.keys(updates[0])).toEqual(["sequence", "state"]);
    expect(updates.map((update) => update.state.status)).toEqual([
      "idle",
      "hovering",
      "importing",
      "completed",
      "failed",
      "rejected",
    ]);
  });
});
