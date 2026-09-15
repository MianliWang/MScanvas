import { describe, expect, it } from "vitest";
import { buildRows } from "../../../test/previewFixtures";
import { adjacentDisplayedScan, indexScanTable, INITIAL_SCAN_TABLE_OPTIONS, projectScanTable, toggleScanSort } from "./scanTableView";

const rows = buildRows(5).map((row, position) => ({ ...row,
  index: [70, 20, 90, 30, 40][position]!, identifier: ["z9", "a10", "a2", "a2", "中文"][position]!,
  scanNumber: [11, null, 2, 2, null][position]!, msLevel: position % 2 + 1,
  retentionTime: { value: [10, 2, 2, 1, 5][position]!, unitKnown: false } }));
const index = indexScanTable(rows);
const ids = (options = INITIAL_SCAN_TABLE_OPTIONS) => projectScanTable(index, options).rows.map(row => row.index);

describe("loaded scan-table projection", () => {
  it("retains source order initially, compares numeric keys numerically, and preserves tie order", () => {
    expect(ids()).toEqual([70, 20, 90, 30, 40]);
    expect(ids(toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "retentionTime"))).toEqual([30, 20, 90, 40, 70]);
    expect(ids(toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "index"))).toEqual([20, 30, 40, 70, 90]);
    expect(rows.map(row => row.index)).toEqual([70, 20, 90, 30, 40]);
  });
  it("keeps missing values last in both directions and equal keys in source order", () => {
    const ascending = toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "scanNumber");
    expect(ids(ascending)).toEqual([90, 30, 70, 20, 40]);
    expect(ids(toggleScanSort(ascending, "scanNumber"))).toEqual([70, 90, 30, 20, 40]);
  });
  it("compares raw identifier code units, independent of any display locale", () => {
    expect(ids(toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "identifier"))).toEqual([20, 90, 30, 70, 40]);
  });
  it("searches only existing raw identifiers, source indices and reported scan numbers", () => {
    expect(ids({ ...INITIAL_SCAN_TABLE_OPTIONS, query: "a2", msLevel: 1 })).toEqual([90]);
    expect(ids({ ...INITIAL_SCAN_TABLE_OPTIONS, query: "11" })).toEqual([70]);
    expect(ids({ ...INITIAL_SCAN_TABLE_OPTIONS, query: "40" })).toEqual([40]);
    expect(ids({ ...INITIAL_SCAN_TABLE_OPTIONS, query: "MS1" })).toEqual([]);
    expect(index.msLevels).toEqual([1, 2]);
  });
  it("steps by displayed source identity and refuses an absent anchor", () => {
    const projection = projectScanTable(index, { ...toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "scanNumber"), query: "a" });
    expect(adjacentDisplayedScan(projection, 90, 1)).toBe(30);
    expect(adjacentDisplayedScan(projection, 20, -1)).toBe(30);
    expect(adjacentDisplayedScan(projection, 70, 1)).toBeNull();
    expect(adjacentDisplayedScan(projection, null, 1)).toBeNull();
  });
  it("handles empty and single rows without inventing a neighbour", () => {
    for (const sample of [[], [rows[0]!]]) {
      const projection = projectScanTable(indexScanTable(sample), INITIAL_SCAN_TABLE_OPTIONS);
      expect(adjacentDisplayedScan(projection, 70, 1)).toBeNull();
      expect(adjacentDisplayedScan(projection, 70, -1)).toBeNull();
    }
  });
});
