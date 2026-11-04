import { describe, expect, it } from "vitest";

import { absentRow, detectedRow } from "../../test/projectFixtures";
import type { PayloadRow } from "./projectApi";
import {
  INITIAL_TARGETED_VIEW,
  outcomeChoices,
  projectTargetedRows,
  ROW_OUTCOMES,
  targetedViewActive,
  targetedViewWire,
  toggleOutcome,
  toggleTargetedSort,
  type TargetedViewOptions,
} from "./targetedTableView";

const feature = detectedRow().feature!;
const row = (targetId: string, outcome: PayloadRow["outcome"], rawArea: number | null, apexRtS = 100): PayloadRow =>
  rawArea === null
    ? absentRow({ targetId, outcome })
    : detectedRow({ targetId, outcome, feature: { ...feature, rawArea, apexRtS } });

const ROWS = [
  row("a", "DETECTED", 30),
  row("b", "NOT_DETECTED", null),
  row("c", "SHARED", 10),
  row("d", "FAILED", null),
  row("e", "DETECTED", 30),
  row("f", "DETECTED", 20),
];
const NAMES: Record<string, readonly [string, string]> = {
  a: ["Caffeine", "C8H10N4O2"],
  b: ["adenine", "C5H5N5"],
  c: ["Zebrafish toxin", "C9H11NO3"],
  d: ["äpfel", "C2H6O"],
  e: ["Caffeine (D3)", "C8H7D3N4O2"],
  f: ["Beta", "C5H5N5"],
};
const names = {
  nameOf: (id: string) => NAMES[id][0],
  formulaOf: (id: string) => NAMES[id][1],
};
const shown = (options: Partial<TargetedViewOptions>, rows = ROWS) =>
  projectTargetedRows(rows, { ...INITIAL_TARGETED_VIEW, ...options }, names).map((one) => one.targetId);
const sort = (key: NonNullable<TargetedViewOptions["sort"]>["key"], direction: "ascending" | "descending") => ({
  sort: { key, direction },
});

describe("a targeted results table's view (S-7.1)", () => {
  it("starts as the table, in plan order, with nothing active", () => {
    expect(shown({})).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(targetedViewActive(INITIAL_TARGETED_VIEW)).toBe(false);
    expect(targetedViewActive({ ...INITIAL_TARGETED_VIEW, text: "  " })).toBe(false);
    expect(targetedViewActive({ ...INITIAL_TARGETED_VIEW, text: "a" })).toBe(true);
    expect(targetedViewActive({ ...INITIAL_TARGETED_VIEW, outcomes: ["FAILED"] })).toBe(true);
    expect(targetedViewActive({ ...INITIAL_TARGETED_VIEW, ...sort("label", "ascending") })).toBe(true);
  });

  it("never changes the rows it was given", () => {
    const before = [...ROWS];
    shown(sort("raw_area", "descending"));
    expect(ROWS).toEqual(before);
    // No filter and no sort still answers a new list: the caller may not sort the source by mistake.
    expect(projectTargetedRows(ROWS, INITIAL_TARGETED_VIEW, names)).not.toBe(ROWS);
  });

  it("keeps missing values last in either direction", () => {
    expect(shown(sort("raw_area", "ascending"))).toEqual(["c", "f", "a", "e", "b", "d"]);
    expect(shown(sort("raw_area", "descending"))).toEqual(["a", "e", "f", "c", "b", "d"]);
    expect(shown(sort("feature_apex_rt_s", "descending")).slice(-2)).toEqual(["b", "d"]);
  });

  it("treats a value that is not a number as missing", () => {
    const rows = [row("c", "SHARED", Number.NaN), row("a", "DETECTED", 1), row("f", "DETECTED", Number.POSITIVE_INFINITY)];
    expect(shown(sort("raw_area", "ascending"), rows)).toEqual(["a", "c", "f"]);
    expect(shown(sort("raw_area", "descending"), rows)).toEqual(["a", "c", "f"]);
  });

  it("breaks a tie by plan order in either direction", () => {
    expect(shown(sort("raw_area", "ascending")).indexOf("a")).toBeLessThan(shown(sort("raw_area", "ascending")).indexOf("e"));
    expect(shown(sort("raw_area", "descending")).indexOf("a")).toBeLessThan(shown(sort("raw_area", "descending")).indexOf("e"));
    expect(shown(sort("outcome", "descending"))).toEqual(["d", "b", "c", "a", "e", "f"]);
  });

  it("sorts outcomes by the code's order and names by code unit, never by translated words", () => {
    expect(shown(sort("outcome", "ascending"))).toEqual(["a", "e", "f", "c", "b", "d"]);
    // Upper case before lower, a non-ASCII letter after both: no locale decides it.
    expect(shown(sort("label", "ascending"))).toEqual(["f", "a", "e", "c", "b", "d"]);
    expect(shown(sort("label", "descending"))).toEqual(["d", "b", "c", "e", "a", "f"]);
  });

  it("filters by the outcomes pressed, in any number", () => {
    expect(shown({ outcomes: ["DETECTED"] })).toEqual(["a", "e", "f"]);
    expect(shown({ outcomes: ["FAILED", "SHARED"] })).toEqual(["c", "d"]);
    expect(shown({ outcomes: ["SUPPRESSED_BY_OVERLAP"] })).toEqual([]);
  });

  it("filters by text over the name and the formula, whatever the case", () => {
    expect(shown({ text: "caff" })).toEqual(["a", "e"]);
    expect(shown({ text: "ADENINE" })).toEqual(["b"]);
    expect(shown({ text: "c5h5" })).toEqual(["b", "f"]);
    expect(shown({ text: "  beta  " })).toEqual(["f"]);
    expect(shown({ text: "nothing like it" })).toEqual([]);
    expect(shown({ text: "caff", outcomes: ["SHARED"] })).toEqual([]);
  });

  it("offers the outcomes the result holds, counted under the text", () => {
    expect(outcomeChoices(ROWS, "", names)).toEqual([
      { outcome: "DETECTED", count: 3 },
      { outcome: "SHARED", count: 1 },
      { outcome: "NOT_DETECTED", count: 1 },
      { outcome: "FAILED", count: 1 },
    ]);
    expect(outcomeChoices(ROWS, "caff", names)).toEqual([
      { outcome: "DETECTED", count: 2 },
      { outcome: "SHARED", count: 0 },
      { outcome: "NOT_DETECTED", count: 0 },
      { outcome: "FAILED", count: 0 },
    ]);
  });

  it("presses and releases an outcome, keeping one order", () => {
    const one = toggleOutcome(INITIAL_TARGETED_VIEW, "FAILED");
    expect(one.outcomes).toEqual(["FAILED"]);
    const two = toggleOutcome(one, "DETECTED");
    expect(two.outcomes).toEqual(["DETECTED", "FAILED"]);
    expect(toggleOutcome(two, "FAILED").outcomes).toEqual(["DETECTED"]);
  });

  it("sorts ascending first, then flips, and a new column starts ascending", () => {
    const first = toggleTargetedSort(INITIAL_TARGETED_VIEW, "raw_area");
    expect(first.sort).toEqual({ key: "raw_area", direction: "ascending" });
    const second = toggleTargetedSort(first, "raw_area");
    expect(second.sort).toEqual({ key: "raw_area", direction: "descending" });
    expect(toggleTargetedSort(second, "raw_area").sort?.direction).toBe("ascending");
    expect(toggleTargetedSort(second, "label").sort).toEqual({ key: "label", direction: "ascending" });
  });

  it("describes the view explicitly: every outcome when none is pressed, the text as filtered on", () => {
    const options = { outcomes: [], text: "  caff ", sort: { key: "label", direction: "descending" } } as const;
    const rows = projectTargetedRows(ROWS, options, names);
    expect(targetedViewWire(rows, options)).toEqual({
      targetIds: ["e", "a"],
      outcomes: ROW_OUTCOMES,
      text: "caff",
      sort: { key: "label", direction: "descending" },
    });
    const pressed = { ...INITIAL_TARGETED_VIEW, outcomes: ["SHARED"] } as const;
    expect(targetedViewWire(projectTargetedRows(ROWS, pressed, names), pressed)).toEqual({
      targetIds: ["c"],
      outcomes: ["SHARED"],
      text: "",
      sort: null,
    });
  });
});
