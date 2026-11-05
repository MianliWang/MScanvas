import { describe, expect, it } from "vitest";
import { buildRows } from "../../../test/previewFixtures";
import { adjacentDisplayedScan, apexMs1Row, findScanByNumber, indexScanTable, INITIAL_SCAN_TABLE_OPTIONS, matchesScanFilters, projectScanTable, toggleScanSort } from "./scanTableView";

const rows = buildRows(5).map((row, position) => ({ ...row,
  index: [70, 20, 90, 30, 40][position]!, identifier: ["z9", "a10", "a2", "a2", "中文"][position]!,
  scanNumber: [11, null, 2, 2, null][position]!, msLevel: position % 2 + 1,
  retentionTime: { value: [10, 2, 2, 1, 5][position]!, unit: "notReported" as const } }));
const index = indexScanTable(rows);
const ids = (options = INITIAL_SCAN_TABLE_OPTIONS) => projectScanTable(index, options).rows.map(row => row.index);

describe("loaded scan-table projection", () => {
  it("retains source order initially, compares numeric keys numerically, and preserves tie order", () => {
    expect(ids()).toEqual([70, 20, 90, 30, 40]);
    expect(ids(toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "retentionTime"))).toEqual([30, 20, 90, 40, 70]);
    expect(ids(toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "index"))).toEqual([20, 30, 40, 70, 90]);
    expect(rows.map(row => row.index)).toEqual([70, 20, 90, 30, 40]);
  });
  it("sorts rows in mixed retention-time units as one group per unit, never interleaved", () => {
    const mixed = indexScanTable(buildRows(4).map((row, position) => ({ ...row,
      retentionTime: { value: [2, 30, 0.5, 1][position]!, unit: (["minute", "second", "minute", "second"] as const)[position]! } })));
    const sorted = (options: typeof INITIAL_SCAN_TABLE_OPTIONS) => projectScanTable(mixed, options).rows.map(row => row.index);
    const ascending = toggleScanSort(INITIAL_SCAN_TABLE_OPTIONS, "retentionTime");
    // 1 s, 30 s, then 0.5 min, 2 min -- not 0.5, 1, 2, 30 as if one scale ([2, 3, 0, 1]).
    expect(sorted(ascending)).toEqual([3, 1, 2, 0]);
    expect(sorted(toggleScanSort(ascending, "retentionTime"))).toEqual([0, 2, 1, 3]);
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

describe("go to a scan number", () => {
  it("finds the row declaring the number, as typed or as the list writes it", () => {
    expect(findScanByNumber(rows, "11")?.index).toBe(70);
    expect(findScanByNumber(rows, " 11 ")?.index).toBe(70);
    const thousands = buildRows(1500);
    expect(findScanByNumber(thousands, "1,234")?.scanNumber).toBe(1234);
  });
  it("takes the first in file order where several rows declare one number", () => {
    expect(findScanByNumber(rows, "2")?.index).toBe(90);
  });
  it("answers nothing for a number no row declares, and never reads it as a row index", () => {
    expect(findScanByNumber(rows, "70")).toBeNull();
    expect(findScanByNumber(rows, "3")).toBeNull();
  });
  it.each(["", "abc", "1.5", "-2", "1e1", "1,2", "12,34", "０"])("refuses %j as not a whole number", text => {
    expect(findScanByNumber(buildRows(40), text)).toBeNull();
  });
  it("says which filters let a row through, for a row the projection dropped", () => {
    const row = rows[0]!;
    expect(matchesScanFilters(row, INITIAL_SCAN_TABLE_OPTIONS)).toBe(true);
    expect(matchesScanFilters(row, { ...INITIAL_SCAN_TABLE_OPTIONS, query: "z9" })).toBe(true);
    expect(matchesScanFilters(row, { ...INITIAL_SCAN_TABLE_OPTIONS, query: "nothing" })).toBe(false);
    expect(matchesScanFilters(row, { ...INITIAL_SCAN_TABLE_OPTIONS, msLevel: 2 })).toBe(false);
  });
});

describe("the list following the chromatogram's committed range", () => {
  const range = (low: number, high: number) => ({ low, high });
  const within = (low: number, high: number, options = INITIAL_SCAN_TABLE_OPTIONS) =>
    projectScanTable(index, options, range(low, high)).rows.map(row => row.index);
  it("keeps the rows inside the range, edges included", () => {
    expect(within(2, 5)).toEqual([20, 90, 40]);
  });
  it("adds to the search and the MS-level filter rather than replacing them", () => {
    expect(within(1, 5, { ...INITIAL_SCAN_TABLE_OPTIONS, query: "a2" })).toEqual([90, 30]);
    expect(within(1, 5, { ...INITIAL_SCAN_TABLE_OPTIONS, msLevel: 2 })).toEqual([20, 30]);
  });
  it("is the whole list with no range, and empty with a range holding no scan", () => {
    expect(projectScanTable(index, INITIAL_SCAN_TABLE_OPTIONS, null).rows).toHaveLength(5);
    const empty = projectScanTable(index, INITIAL_SCAN_TABLE_OPTIONS, range(6, 7));
    expect(empty.rows).toEqual([]);
    expect(empty.positions.size).toBe(0);
  });
});

describe("the scan an open selects", () => {
  const run = (scans: readonly (readonly [number, number])[]) => buildRows(scans.length).map((row, position) =>
    ({ ...row, msLevel: scans[position]![0], totalIonCurrent: scans[position]![1] }));
  it("takes the MS1 declaring the largest TIC, whatever an MS2 declares", () => {
    expect(apexMs1Row(run([[1, 5], [2, 900], [1, 70], [1, 30]]))?.index).toBe(2);
  });
  it("gives a tie to the first in file order", () => {
    expect(apexMs1Row(run([[2, 70], [1, 70], [1, 70]]))?.index).toBe(1);
  });
  it("has nothing to say for a file with no MS1, or no rows", () => {
    expect(apexMs1Row(run([[2, 70], [3, 80]]))).toBeNull();
    expect(apexMs1Row([])).toBeNull();
  });
  it("skips a declared value that is not a number, and keeps a negative one as a value", () => {
    expect(apexMs1Row(run([[1, Number.NaN], [1, -5], [1, Number.POSITIVE_INFINITY]]))?.index).toBe(1);
    expect(apexMs1Row(run([[1, Number.NaN]]))).toBeNull();
  });
});
