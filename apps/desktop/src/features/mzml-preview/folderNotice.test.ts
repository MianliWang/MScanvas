import { describe, expect, it } from "vitest";

import type {
  FolderDiscoverySummary,
  FolderIngestionResult,
  PreviewError,
  SelectedFile,
  WorkspaceAddOutcome,
} from "./contracts";
import { describeFolderResult } from "./folderNotice";

const CLEAN: FolderDiscoverySummary = {
  complete: true,
  skippedReparseCount: 0,
  inaccessibleEntryCount: 0,
  limitsReached: [],
};

function file(name: string, relativeContext: string | null = null): SelectedFile {
  return {
    handle: `handle-${name}`,
    fileName: name,
    byteLength: 1_024,
    sourceKind: "mzml",
    relativeContext,
  };
}

function added(name: string, relativeContext: string | null = null): WorkspaceAddOutcome {
  return { outcome: "added", dataset: file(name, relativeContext) };
}

function duplicate(name: string, relativeContext: string | null = null): WorkspaceAddOutcome {
  return { outcome: "duplicate", existing: file(name, relativeContext) };
}

function rejected(name: string, overrides: Partial<PreviewError> = {}): WorkspaceAddOutcome {
  return {
    outcome: "rejected",
    candidateName: name,
    error: {
      kind: "file_not_resolvable",
      summary: "MSCanvas could not open that file.",
      detail: null,
      retryable: true,
      ...overrides,
    },
  };
}

function result(
  outcomes: readonly WorkspaceAddOutcome[],
  discovery: Partial<FolderDiscoverySummary> = {},
): FolderIngestionResult {
  return {
    roster: {
      datasets: outcomes.flatMap((outcome) =>
        outcome.outcome === "added" ? [outcome.dataset] : [],
      ),
      capacity: 1_024,
    },
    outcomes,
    discovery: { ...CLEAN, ...discovery },
  };
}

describe("accounting for one folder import", () => {
  it("states what a complete scan added", () => {
    const notice = describeFolderResult(result([added("a.mzML"), added("b.mzML")]));

    expect(notice.message).toBe("Added 2 files.");
    expect(notice.tone).toBe("info");
    expect(notice.details).toEqual([]);
    expect(notice.more).toBe(0);
  });

  it("counts duplicates and refusals apart from each other", () => {
    const notice = describeFolderResult(
      result([
        added("a.mzML"),
        duplicate("held.mzML"),
        rejected("broken.mzML"),
        rejected("late.mzML", { kind: "workspace_full", retryable: false }),
      ]),
    );

    expect(notice.message).toContain("Added 1 file.");
    expect(notice.message).toContain("1 file already in the workspace.");
    expect(notice.message).toContain("1 file could not be added.");
    // A full workspace is a different thing from a file that could not be read,
    // and the recovery is different too.
    expect(notice.message).toContain(
      "1 file did not fit: the workspace already holds as many as MSCanvas keeps.",
    );
    expect(notice.tone).toBe("warning");
  });

  it("says a complete folder held no mzML, without calling it a failure", () => {
    const notice = describeFolderResult(result([]));

    expect(notice.message).toBe("No mzML files were found in that folder.");
    expect(notice.tone).toBe("info");
  });

  it("never claims a folder holds no mzML when the scan did not describe it", () => {
    // The two sentences a partial scan must not be allowed to merge. A scan
    // that stopped early cannot speak for what is in the folder, and reporting
    // it as an empty folder is the worst answer available: the user would
    // believe there is nothing there.
    const notice = describeFolderResult(result([], { complete: false, inaccessibleEntryCount: 2 }));

    expect(notice.message).toContain("No files were added, and the scan was incomplete.");
    expect(notice.message).not.toContain("No mzML files were found");
    expect(notice.tone).toBe("warning");
  });

  it("says an incomplete scan processed what it found rather than the whole folder", () => {
    const notice = describeFolderResult(
      result([added("a.mzML"), added("b.mzML")], { complete: false, limitsReached: ["depth"] }),
    );

    expect(notice.message).toContain("Added 2 files.");
    expect(notice.message).toContain(
      "MSCanvas added what it found, but the scan did not describe the whole folder.",
    );
    // An incomplete scan is a warning even when everything it found arrived.
    expect(notice.tone).toBe("warning");
  });

  it("says linked and special entries were skipped rather than calling them links", () => {
    // A reparse tag is what they have in common. Junctions, symbolic links,
    // mount points and cloud placeholders are only some of what carries one,
    // and MSCanvas refuses all of them without asking which it was looking at.
    const many = describeFolderResult(
      result([added("a.mzML")], { complete: false, skippedReparseCount: 3 }),
    );
    expect(many.message).toContain(
      "MSCanvas skipped 3 linked or special filesystem entries and did not follow them.",
    );

    const one = describeFolderResult(
      result([added("a.mzML")], { complete: false, skippedReparseCount: 1 }),
    );
    expect(one.message).toContain(
      "MSCanvas skipped 1 linked or special filesystem entry and did not follow it.",
    );
  });

  it("counts what could not be read without naming any of it", () => {
    const notice = describeFolderResult(
      result([added("a.mzML")], { complete: false, inaccessibleEntryCount: 4 }),
    );

    expect(notice.message).toContain("4 entries could not be read, so they were left out.");
  });

  it("says in plain words which named limit each scan reached", () => {
    const limits = {
      depth: "it is nested deeper than MSCanvas walks in one scan",
      entries: "it holds more entries than MSCanvas inspects in one scan",
      directories: "it holds more subfolders than MSCanvas enters in one scan",
      candidates: "it holds more .mzML files than MSCanvas takes from one scan",
    } as const;
    for (const [limit, said] of Object.entries(limits)) {
      const notice = describeFolderResult(
        result([added("a.mzML")], {
          complete: false,
          limitsReached: [limit as keyof typeof limits],
        }),
      );
      expect(notice.message).toContain(`The scan stopped short of the whole folder because ${said}.`);
    }
    // And the counters themselves are never repeated: how many entries a folder
    // holds is the shape of the user's tree.
    const notice = describeFolderResult(
      result([added("a.mzML")], { complete: false, limitsReached: ["entries", "directories"] }),
    );
    expect(notice.message).toContain(
      "it holds more entries than MSCanvas inspects in one scan and it holds more subfolders " +
        "than MSCanvas enters in one scan",
    );
  });

  it("still says something about a limit this version does not recognise", () => {
    // The union is closed against a matching Rust build, which is exactly why
    // this is here rather than a filter: a value that fell through silently
    // would make an incomplete scan look like one that stopped for no reason.
    const unknown = result([added("a.mzML")], {
      complete: false,
      limitsReached: ["something-new" as "depth"],
    });

    const notice = describeFolderResult(unknown);

    expect(notice.message).toContain("it reached a scan limit this version cannot name");
  });

  it("bounds the details it spells out and says how many it stopped short of", () => {
    const notice = describeFolderResult(
      result([
        added("kept.mzML"),
        duplicate("one.mzML"),
        duplicate("two.mzML"),
        rejected("three.mzML"),
        rejected("four.mzML"),
        rejected("five.mzML"),
      ]),
    );

    expect(notice.details).toHaveLength(3);
    expect(notice.more).toBe(2);
  });

  it("lists details in the order the scan produced them", () => {
    // Which is the order the roster is in. Grouping by kind would put a refused
    // file before a duplicate that was found first, and an order that disagrees
    // with the list on screen buys nothing.
    const notice = describeFolderResult(
      result([duplicate("first.mzML"), rejected("second.mzML"), duplicate("third.mzML")]),
    );

    expect(notice.details).toEqual([
      "first.mzML is already in the workspace.",
      "second.mzML: MSCanvas could not open that file.",
      "third.mzML is already in the workspace.",
    ]);
  });

  it("names a row by its filename and the context Rust gave it, and nothing more", () => {
    const notice = describeFolderResult(result([duplicate("sample.mzML", "batch-2")]));

    expect(notice.details).toEqual(["sample.mzML (batch-2) is already in the workspace."]);
    // Nothing path-shaped: a context is a fragment below the chosen folder, and
    // the folder's own name is not in it.
    expect(notice.details.join(" ")).not.toContain("\\\\");
    expect(notice.details.join(" ")).not.toContain(":");
  });

  it("stamps no sequence of its own", () => {
    // The hook counts accounts, because only it knows how many there have been.
    expect(describeFolderResult(result([added("a.mzML")])).sequence).toBe(0);
  });
});
