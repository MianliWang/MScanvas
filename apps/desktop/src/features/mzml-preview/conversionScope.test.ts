import { describe, expect, it } from "vitest";
import type { SelectedFile } from "./contracts";
import { resolveConversionScope, sameConversionScope } from "./conversionScope";
import { initialRosterState } from "./rosterSelection";
import { projectRoster, SORT_MODES, type SortMode } from "./rosterView";

const rows: readonly SelectedFile[] = [
  { handle: "one", fileName: "run-10.raw", byteLength: 20, sourceKind: "thermo_raw", relativeContext: null },
  { handle: "two", fileName: "Run-2.raw", byteLength: 10, sourceKind: "shimadzu_lcd", relativeContext: null },
  { handle: "three", fileName: "run-2.raw", byteLength: 10, sourceKind: "sciex_wiff", relativeContext: null },
  { handle: "open", fileName: "open.mzML", byteLength: 5, sourceKind: "mzml", relativeContext: null },
];
const facts = { ...initialRosterState, datasets: rows, selected: new Set(["two", "open"]), focused: "one" };

describe("explicit conversion scope over the complete roster", () => {
  it("separates selected, all, visible and eligible; preserves hidden selection", () => {
    const selected = resolveConversionScope("selected", facts);
    const all = resolveConversionScope("all", facts);
    expect(selected).toMatchObject({ scope: "selected", requestedCount: 2, excludedCount: 1, handles: ["two"] });
    expect(all).toMatchObject({ scope: "all", requestedCount: 4, excludedCount: 1, handles: ["one", "two", "three"] });
    const searched = { ...facts, query: "no matching name", active: null, converting: null, queued: new Set<string>() };
    const visible = projectRoster(searched);
    expect([...visible.handles]).toEqual(["two", "open"]);
    expect(visible.pinned.get("two")).toBe("selected");
    expect(resolveConversionScope("all", searched)).toEqual(all);
    expect(resolveConversionScope("selected", searched)).toEqual(selected);
  });

  it("keeps one-row selection selected and never falls back to focus", () => {
    expect(resolveConversionScope("selected", { ...facts, selected: new Set(["two"]) }))
      .toMatchObject({ scope: "selected", requestedCount: 1, handles: ["two"] });
    for (const selected of [new Set<string>(), new Set(["open"]), new Set(["missing"])]) {
      expect(resolveConversionScope("selected", { ...facts, selected }).handles).toEqual([]);
    }
    expect(resolveConversionScope("all", { ...facts, datasets: [] })).toMatchObject({ requestedCount: 0, excludedCount: 0, handles: [] });
  });

  const expected: Record<SortMode, readonly string[]> = {
    added: ["one", "two", "three"], "name-asc": ["two", "three", "one"],
    "name-desc": ["one", "two", "three"], "size-asc": ["two", "three", "one"],
    "size-desc": ["one", "two", "three"],
  };
  for (const sort of SORT_MODES) it(`uses ${sort} and Rust added order for ties in both scopes`, () => {
    const input = { ...facts, sort, selected: new Set(rows.map((row) => row.handle)) };
    for (const scope of ["selected", "all"] as const) {
      expect(resolveConversionScope(scope, input).handles).toEqual(expected[sort]);
      const visible = projectRoster({ ...input, query: "", converting: null, queued: new Set<string>() });
      expect(resolveConversionScope(scope, input).handles)
        .toEqual(visible.datasets.filter((row) => row.sourceKind !== "mzml").map((row) => row.handle));
    }
    expect(rows.map((row) => row.handle)).toEqual(["one", "two", "three", "open"]);
  });

  it("compares scope and actual order, not query, focus or equivalent sort labels", () => {
    const selected = resolveConversionScope("selected", facts);
    expect(sameConversionScope(selected, resolveConversionScope("selected", { ...facts, sort: "name-desc" }))).toBe(true);
    expect(sameConversionScope(selected, { ...selected, scope: "all" })).toBe(false);
    const all = resolveConversionScope("all", facts);
    expect(sameConversionScope(all, { ...all, handles: [...all.handles].reverse() })).toBe(false);
    expect(sameConversionScope(all, resolveConversionScope("all", { ...facts, selected: new Set() }))).toBe(true);
  });
});
