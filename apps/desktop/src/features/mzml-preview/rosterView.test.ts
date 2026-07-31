import { describe, expect, it } from "vitest";

import type { SelectedFile } from "./contracts";
import type { RowPresentation } from "./rosterSelection";
import {
  describeProjection,
  isSortMode,
  normalizeForSearch,
  projectRoster,
  SORT_MODES,
  type PinReason,
  type RosterProjectionInput,
  type SortMode,
} from "./rosterView";

function dataset(handle: string, fileName: string, byteLength = 4_096): SelectedFile {
  return { handle, fileName, byteLength };
}

interface Options {
  readonly query?: string;
  readonly sort?: SortMode;
  readonly selected?: readonly string[];
  readonly active?: string | null;
  readonly rowState?: readonly (readonly [string, RowPresentation])[];
}

function input(datasets: readonly SelectedFile[], options: Options = {}): RosterProjectionInput {
  return {
    datasets,
    query: options.query ?? "",
    sort: options.sort ?? "added",
    selected: new Set(options.selected ?? []),
    active: options.active ?? null,
    rowState: new Map(options.rowState ?? []),
  };
}

function names(datasets: readonly SelectedFile[]): string[] {
  return datasets.map((entry) => entry.fileName);
}

function handles(datasets: readonly SelectedFile[]): string[] {
  return datasets.map((entry) => entry.handle);
}

/** Four rows whose three orders — added, name, size — are all different. */
function fourRows(): SelectedFile[] {
  return [
    dataset("file-0", "sample-10.mzML", 3_000),
    dataset("file-1", "QC_pool.mzML", 1_000),
    dataset("file-2", "sample-2.mzML", 4_000),
    dataset("file-3", "blank.mzML", 2_000),
  ];
}

describe("normalizing a name for comparison", () => {
  it("treats an empty query as empty", () => {
    expect(normalizeForSearch("")).toBe("");
    expect(normalizeForSearch("   ")).toBe("");
  });

  it("ignores surrounding whitespace", () => {
    expect(normalizeForSearch("  QC  ")).toBe("qc");
    expect(normalizeForSearch("\tQC\n")).toBe("qc");
  });

  it("ignores case", () => {
    expect(normalizeForSearch("QC_Pool")).toBe(normalizeForSearch("qc_pool"));
  });

  it("folds compatibility-equivalent forms together", () => {
    // Full-width Latin, which a name can arrive in and a query rarely does.
    expect(normalizeForSearch("ＱＣ")).toBe("qc");
    // A composed and a decomposed accented name are the same file to a reader.
    expect(normalizeForSearch("café")).toBe(normalizeForSearch("café"));
    // And a ligature, which NFKC decomposes and NFC does not.
    expect(normalizeForSearch("ﬁle")).toBe("file");
  });

  it("leaves the displayed name alone", () => {
    // The projection compares a normalized copy; what it hands back to be
    // rendered is the name Rust said, character for character.
    const rows = [dataset("file-0", "ＱＣ_pool.mzML")];

    const projection = projectRoster(input(rows, { query: "qc" }));

    expect(names(projection.datasets)).toEqual(["ＱＣ_pool.mzML"]);
  });
});

describe("matching the query", () => {
  it("shows everything when the query is empty", () => {
    const projection = projectRoster(input(fourRows()));

    expect(projection.datasets).toHaveLength(4);
    expect(projection.matchCount).toBe(4);
    expect(projection.searching).toBe(false);
    expect(projection.pinned.size).toBe(0);
  });

  it("shows everything when the query is only whitespace", () => {
    const projection = projectRoster(input(fourRows(), { query: "   " }));

    expect(projection.datasets).toHaveLength(4);
    expect(projection.searching).toBe(false);
  });

  it("matches a substring anywhere in the name, in any case", () => {
    const projection = projectRoster(input(fourRows(), { query: "AMPLE" }));

    expect(names(projection.datasets)).toEqual(["sample-10.mzML", "sample-2.mzML"]);
    expect(projection.matchCount).toBe(2);
    expect(projection.searching).toBe(true);
  });

  it("matches a Unicode name through its compatibility form", () => {
    const rows = [dataset("file-0", "ＱＣ_pool.mzML"), dataset("file-1", "blank.mzML")];

    const projection = projectRoster(input(rows, { query: "qc_pool" }));

    expect(handles(projection.datasets)).toEqual(["file-0"]);
  });

  it("searches the name and nothing else", () => {
    // Not the handle, and not the size as it is rendered. Both are things a
    // user can see on the row, and neither is a name.
    const rows = [dataset("file-0", "blank.mzML", 4_096)];

    expect(projectRoster(input(rows, { query: "file-0" })).datasets).toHaveLength(0);
    expect(projectRoster(input(rows, { query: "4.0" })).datasets).toHaveLength(0);
    expect(projectRoster(input(rows, { query: "KiB" })).datasets).toHaveLength(0);
  });

  it("reports the whole session as the total, not the visible count", () => {
    const projection = projectRoster(input(fourRows(), { query: "blank" }));

    expect(projection.matchCount).toBe(1);
    expect(projection.total).toBe(4);
  });
});

describe("ordering the visible roster", () => {
  it("reproduces Rust's order for added, and never mutates the input", () => {
    const rows = fourRows();
    const before = [...rows];

    const projection = projectRoster(input(rows, { sort: "added" }));

    expect(handles(projection.datasets)).toEqual(["file-0", "file-1", "file-2", "file-3"]);
    expect(rows).toEqual(before);
    expect(rows).not.toBe(projection.datasets);
  });

  it("orders names naturally rather than by code unit", () => {
    // The whole reason for a numeric collator: `sample-2` is the second
    // acquisition and belongs before the tenth, which a plain string compare
    // gets backwards.
    const projection = projectRoster(input(fourRows(), { sort: "name-asc" }));

    expect(names(projection.datasets)).toEqual([
      "blank.mzML",
      "QC_pool.mzML",
      "sample-2.mzML",
      "sample-10.mzML",
    ]);
  });

  it("reverses that order for Z–A", () => {
    const projection = projectRoster(input(fourRows(), { sort: "name-desc" }));

    expect(names(projection.datasets)).toEqual([
      "sample-10.mzML",
      "sample-2.mzML",
      "QC_pool.mzML",
      "blank.mzML",
    ]);
  });

  it("does not let case decide the primary order", () => {
    // `QC_pool` sits between `blank` and `sample` by letter. A case-sensitive
    // compare would put every capital ahead of every lower-case name instead,
    // which is an order nobody looking for a file thinks in.
    const projection = projectRoster(input(fourRows(), { sort: "name-asc" }));

    expect(names(projection.datasets)[1]).toBe("QC_pool.mzML");
  });

  it("keeps insertion order where names compare equal", () => {
    // Two names one collator calls the same, in a deliberately reversed
    // insertion order: what comes back must be the session's order, not the
    // engine's.
    const rows = [
      dataset("file-0", "run.mzML"),
      dataset("file-1", "RUN.mzML"),
      dataset("file-2", "Run.mzML"),
    ];

    const projection = projectRoster(input(rows, { sort: "name-asc" }));

    expect(handles(projection.datasets)).toEqual(["file-0", "file-1", "file-2"]);
    expect(handles(projectRoster(input(rows, { sort: "name-desc" })).datasets)).toEqual([
      "file-0",
      "file-1",
      "file-2",
    ]);
  });

  it("orders by size in both directions", () => {
    expect(handles(projectRoster(input(fourRows(), { sort: "size-asc" })).datasets)).toEqual([
      "file-1",
      "file-3",
      "file-0",
      "file-2",
    ]);
    expect(handles(projectRoster(input(fourRows(), { sort: "size-desc" })).datasets)).toEqual([
      "file-2",
      "file-0",
      "file-3",
      "file-1",
    ]);
  });

  it("keeps insertion order where sizes are equal", () => {
    const rows = [
      dataset("file-0", "c.mzML", 100),
      dataset("file-1", "a.mzML", 100),
      dataset("file-2", "b.mzML", 100),
    ];

    expect(handles(projectRoster(input(rows, { sort: "size-asc" })).datasets)).toEqual([
      "file-0",
      "file-1",
      "file-2",
    ]);
    expect(handles(projectRoster(input(rows, { sort: "size-desc" })).datasets)).toEqual([
      "file-0",
      "file-1",
      "file-2",
    ]);
  });

  it("sorts the pinned rows into the same order as everything else", () => {
    // One list, not a matched list with an exceptions section under it: a
    // second group would be a second thing to navigate and a second thing to
    // announce.
    const projection = projectRoster(
      input(fourRows(), { query: "sample", selected: ["file-3"], sort: "name-asc" }),
    );

    expect(names(projection.datasets)).toEqual([
      "blank.mzML",
      "sample-2.mzML",
      "sample-10.mzML",
    ]);
  });
});

describe("keeping the user's own work visible", () => {
  const rows = () => [
    dataset("file-0", "QC_pool.mzML"),
    dataset("file-1", "blank.mzML"),
    dataset("file-2", "sample.mzML"),
  ];

  it("hides an ordinary nonmatch", () => {
    const projection = projectRoster(input(rows(), { query: "QC" }));

    expect(handles(projection.datasets)).toEqual(["file-0"]);
    expect(projection.pinned.size).toBe(0);
  });

  it("keeps a selected nonmatch, and says that is why", () => {
    const projection = projectRoster(input(rows(), { query: "QC", selected: ["file-2"] }));

    expect(handles(projection.datasets)).toEqual(["file-0", "file-2"]);
    expect(projection.pinned.get("file-2")).toBe<PinReason>("selected");
    // A pinned row is not a match, and the count must not pretend otherwise.
    expect(projection.matchCount).toBe(1);
  });

  it("keeps the row whose preview is on screen, and says it is showing", () => {
    const projection = projectRoster(
      input(rows(), { query: "QC", active: "file-1", rowState: [["file-1", "loaded"]] }),
    );

    expect(handles(projection.datasets)).toEqual(["file-0", "file-1"]);
    expect(projection.pinned.get("file-1")).toBe<PinReason>("showing");
  });

  it("keeps a row being read, and says it is being read", () => {
    const projection = projectRoster(
      input(rows(), { query: "QC", active: "file-1", rowState: [["file-1", "opening"]] }),
    );

    expect(projection.pinned.get("file-1")).toBe<PinReason>("reading");
  });

  it("keeps a row being read even when the read is not the active one", () => {
    const projection = projectRoster(input(rows(), { query: "QC", rowState: [["file-2", "opening"]] }));

    expect(handles(projection.datasets)).toEqual(["file-0", "file-2"]);
    expect(projection.pinned.get("file-2")).toBe<PinReason>("reading");
  });

  it("does not say a row is showing when nothing is on screen for it", () => {
    // A backend change discards what a row read and leaves it active: it is
    // still the row an explicit re-read acts on, so it stays visible, but
    // calling that "Showing" is the exact claim the roster was repaired for.
    const projection = projectRoster(input(rows(), { query: "QC", active: "file-1" }));

    expect(handles(projection.datasets)).toEqual(["file-0", "file-1"]);
    expect(projection.pinned.get("file-1")).toBe<PinReason>("kept");
  });

  it("lists a row satisfying several conditions exactly once", () => {
    const projection = projectRoster(
      input(rows(), {
        query: "QC",
        selected: ["file-1"],
        active: "file-1",
        rowState: [["file-1", "opening"]],
      }),
    );

    expect(handles(projection.datasets)).toEqual(["file-0", "file-1"]);
    expect(projection.pinned.size).toBe(1);
    // The most specific true thing, and only one of them.
    expect(projection.pinned.get("file-1")).toBe<PinReason>("reading");
  });

  it("pins nothing when there is no query", () => {
    // Every row is an ordinary match, so nothing is being kept against
    // anything and no row should claim it is.
    const projection = projectRoster(
      input(rows(), { selected: ["file-2"], active: "file-1", rowState: [["file-1", "loaded"]] }),
    );

    expect(projection.pinned.size).toBe(0);
    expect(projection.matchCount).toBe(3);
  });

  it("has a visible handle set that agrees with the visible rows", () => {
    const projection = projectRoster(input(rows(), { query: "QC", selected: ["file-2"] }));

    expect([...projection.handles].sort()).toEqual(["file-0", "file-2"]);
  });
});

describe("saying what the search found", () => {
  const rows = () => [
    dataset("file-0", "QC_pool.mzML"),
    dataset("file-1", "blank.mzML"),
    dataset("file-2", "sample.mzML"),
  ];

  it("says the whole list is listed when nothing is being searched", () => {
    // Not silence. A live region whose text is removed announces nothing, so
    // clearing a search would be the one step of a search nobody was told
    // about.
    expect(describeProjection(projectRoster(input(rows())))).toBe("All 3 files listed.");
  });

  it("says nothing at all when there is no list to describe", () => {
    expect(describeProjection(projectRoster(input([])))).toBe("");
  });

  it("counts matches against the whole session", () => {
    expect(describeProjection(projectRoster(input(rows(), { query: "QC" })))).toBe(
      "1 match of 3 files.",
    );
  });

  it("names the kept rows separately from the matches", () => {
    const projection = projectRoster(input(rows(), { query: "QC", selected: ["file-1", "file-2"] }));

    expect(describeProjection(projection)).toBe(
      "1 match of 3 files; 2 selected or active files kept visible.",
    );
  });

  it("is honest when nothing matched", () => {
    expect(describeProjection(projectRoster(input(rows(), { query: "zzz" })))).toBe(
      "0 matches of 3 files.",
    );
  });
});

describe("the sort modes offered", () => {
  it("offers exactly the five the workspace supports", () => {
    expect(SORT_MODES).toEqual(["added", "name-asc", "name-desc", "size-asc", "size-desc"]);
  });

  it("recognises its own values and nothing else", () => {
    for (const mode of SORT_MODES) {
      expect(isSortMode(mode)).toBe(true);
    }
    expect(isSortMode("name")).toBe(false);
    expect(isSortMode("")).toBe(false);
  });
});

describe("a roster at capacity", () => {
  // Not a benchmark and not timed. What it holds is that the projection stays
  // correct, stable and non-mutating at the size Rust actually allows, and
  // that nothing here recurses per row.
  const CAPACITY = 1_024;

  function capacityRows(): SelectedFile[] {
    return Array.from({ length: CAPACITY }, (_, index) =>
      dataset(
        `file-${String(index)}`,
        `${index % 2 === 0 ? "QC" : "blank"}_run-${String(index)}.mzML`,
        (index % 7) * 1_000,
      ),
    );
  }

  it("matches, sorts and pins a full session without mutating it", () => {
    const rows = capacityRows();
    const before = [...rows];

    const projection = projectRoster(
      input(rows, { query: "qc_run", sort: "name-asc", selected: ["file-1"], active: "file-3" }),
    );

    expect(projection.total).toBe(CAPACITY);
    expect(projection.matchCount).toBe(CAPACITY / 2);
    // The two nonmatching rows kept for their own reasons, and no others.
    expect([...projection.pinned.keys()].sort()).toEqual(["file-1", "file-3"]);
    expect(projection.datasets).toHaveLength(CAPACITY / 2 + 2);
    expect(rows).toEqual(before);
  });

  it("keeps ties in insertion order at that size", () => {
    const rows = Array.from({ length: CAPACITY }, (_, index) =>
      dataset(`file-${String(index)}`, "same.mzML", 1_000),
    );

    for (const sort of SORT_MODES) {
      const projection = projectRoster(input(rows, { sort }));
      expect(handles(projection.datasets)).toEqual(handles(rows));
    }
  });
});
