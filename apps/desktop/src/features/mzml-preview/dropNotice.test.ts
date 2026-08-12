import { describe, expect, it } from "vitest";

import type { DropIngestionResult, DropIngestionSummary } from "./contracts";
import { describeDropResult } from "./dropNotice";
import { previewError, selectedFile } from "../../test/previewFixtures";

const completeSummary: DropIngestionSummary = {
  workspaceWasEmpty: true,
  complete: true,
  topLevelItemCount: 1,
  skippedReparseRootCount: 0,
  inaccessibleRootCount: 0,
  remoteRootCount: 0,
  unsupportedRootCount: 0,
  skippedReparseEntryCount: 0,
  inaccessibleEntryCount: 0,
  limitsReached: [],
};

function result(overrides: Partial<DropIngestionResult> = {}): DropIngestionResult {
  return {
    roster: { datasets: [], capacity: 1_000 },
    outcomes: [],
    summary: completeSummary,
    ...overrides,
  };
}

describe("drop result notice", () => {
  it("reports a complete drop with no supported candidates as a neutral result", () => {
    const notice = describeDropResult(result());

    expect(notice.tone).toBe("info");
    expect(notice.message).toBe("No supported mzML files were found in the dropped items.");
  });

  it("uses the exact no-supported result for unsupported direct-file outcomes", () => {
    const notice = describeDropResult(
      result({
        outcomes: [
          {
            outcome: "rejected",
            candidateName: "notes.txt",
            error: previewError({
              kind: "unsupported_extension",
              summary: "Only mzML files are supported.",
            }),
          },
        ],
      }),
    );

    expect(notice.message).toBe("No supported mzML files were found in the dropped items.");
    expect(notice.details).toEqual(["notes.txt: Only mzML files are supported."]);
  });

  it("distinguishes an incomplete no-add result and names only aggregate causes", () => {
    const notice = describeDropResult(
      result({
        summary: {
          ...completeSummary,
          complete: false,
          topLevelItemCount: 8,
          remoteRootCount: 2,
          skippedReparseEntryCount: 1,
          limitsReached: ["roots", "depth", "candidates"],
        },
      }),
    );

    expect(notice.tone).toBe("warning");
    expect(notice.message).toContain(
      "No files were added, and the dropped items were not fully inspected.",
    );
    expect(notice.message).toContain("2 remote top-level items were left out");
    expect(notice.message).toContain("more top-level items were dropped");
    expect(notice.message).toContain("more candidate files than MSCanvas accepts");
    expect(notice.message).not.toContain("more .mzML files");
    expect(notice.message).not.toMatch(/[A-Z]:\\|\\\\|secret-root/i);
  });

  it("describes entry and directory exhaustion as one shared whole-drop ledger", () => {
    const notice = describeDropResult(
      result({
        summary: {
          ...completeSummary,
          complete: false,
          topLevelItemCount: 2,
          limitsReached: ["entries", "directories"],
        },
      }),
    );

    expect(notice.message).toContain("this drop reached the shared entry-inspection limit");
    expect(notice.message).toContain("this drop reached the shared directory-entry limit");
    expect(notice.message).not.toContain("a dropped folder held more");
    expect(notice.message).not.toContain("the dropped folders collectively");
  });

  it("bounds per-file details and does not expose duplicate collision context", () => {
    const duplicate = {
      ...selectedFile,
      relativeContext: "private\\directory",
    };
    const rejected = ["one.mzML", "two.mzML", "three.mzML", "four.mzML"].map((candidateName) => ({
      outcome: "rejected" as const,
      candidateName,
      error: previewError({ summary: "Could not be added." }),
    }));
    const notice = describeDropResult(
      result({
        outcomes: [{ outcome: "duplicate", existing: duplicate }, ...rejected],
      }),
    );

    expect(notice.details).toHaveLength(3);
    expect(notice.more).toBe(2);
    expect(notice.details[0]).toBe(`${selectedFile.fileName} is already in the workspace.`);
    expect(notice.details.join(" ")).not.toContain("private");
  });
});
