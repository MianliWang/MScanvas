import type { SpectrumRow } from "../contracts";
import type { RetentionTimeDomain } from "./scanModel";
import { contains } from "./viewport";

export const SCAN_SORT_KEYS = ["index", "scanNumber", "identifier", "msLevel", "retentionTime",
  "basePeakMz", "basePeakIntensity", "totalIonCurrent", "precursorMz"] as const;
export type ScanSortKey = typeof SCAN_SORT_KEYS[number];
export interface ScanTableOptions {
  readonly query: string;
  readonly msLevel: number | null;
  readonly sort: { readonly key: ScanSortKey; readonly direction: "ascending" | "descending" } | null;
}
export const INITIAL_SCAN_TABLE_OPTIONS: ScanTableOptions = { query: "", msLevel: null, sort: null };

export interface ScanTableIndex {
  readonly rows: readonly SpectrumRow[];
  readonly msLevels: readonly number[];
  readonly sourcePositions: ReadonlyMap<number, number>;
}
export interface ScanTableProjection {
  readonly rows: readonly SpectrumRow[];
  readonly positions: ReadonlyMap<number, number>;
}

/** Immutable loaded facts only. SpectrumRow requires a reported numeric MS level. */
export function indexScanTable(rows: readonly SpectrumRow[]): ScanTableIndex {
  return { rows, msLevels: [...new Set(rows.map(row => row.msLevel))].sort((a, b) => a - b),
    sourcePositions: new Map(rows.map((row, position) => [row.index, position])) };
}

function scalar(row: SpectrumRow, key: ScanSortKey): number | string | null {
  return key === "retentionTime" ? row.retentionTime.value : row[key];
}

/**
 * Rows in mixed retention-time units sort as groups, one per declared unit,
 * so seconds and minutes are never interleaved as if they were one scale.
 */
const RETENTION_UNIT_RANK = { second: 0, minute: 1, notReported: 2 } as const;

/** Whether the search and the MS-level filter let a row through. */
export function matchesScanFilters(row: SpectrumRow, options: ScanTableOptions): boolean {
  const query = options.query.trim();
  return (options.msLevel === null || row.msLevel === options.msLevel) &&
    (query === "" || row.identifier.includes(query) || String(row.index).includes(query) ||
      (row.scanNumber !== null && String(row.scanNumber).includes(query)));
}

/**
 * The row that declares this scan number, the first in file order if several do,
 * or `null` for anything else: text that is not a whole number (as the list writes
 * it, or plainly), or a number no row declares. Never a row index in its place.
 */
export function findScanByNumber(rows: readonly SpectrumRow[], text: string): SpectrumRow | null {
  const typed = text.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(typed)) return null;
  const scanNumber = Number(typed.replaceAll(",", ""));
  return rows.find(row => row.scanNumber === scanNumber) ?? null;
}

/**
 * The scan an open shows (V-1): the MS1 row declaring the largest TIC, ties going
 * to the first in file order, read from the table and computing no array. `null`
 * for a file with no MS1 (V-1-NOMS1), and never an MS2 scan in its place.
 *
 * The caller refuses a truncated table: the largest value of a prefix is not the
 * run's apex.
 */
export function apexMs1Row(rows: readonly SpectrumRow[]): SpectrumRow | null {
  let apex: SpectrumRow | null = null;
  for (const row of rows) {
    if (row.msLevel === 1 && Number.isFinite(row.totalIonCurrent) && (apex === null || row.totalIonCurrent > apex.totalIonCurrent)) apex = row;
  }
  return apex;
}

/** Raw, case-sensitive substring search; raw identifiers compare by UTF-16 code units.
 * Missing scalars stay last in either direction. Ties keep original table order.
 * No formatted or translated value is an input, and source rows are never mutated.
 * `rtDomain` is the chromatogram's committed range (V-2), edges included; `null` is
 * the whole run, which is also what a table with no chromatogram has.
 */
export function projectScanTable(index: ScanTableIndex, options: ScanTableOptions, rtDomain: RetentionTimeDomain | null = null): ScanTableProjection {
  const rows = index.rows.filter(row => matchesScanFilters(row, options) &&
    (rtDomain === null || contains(rtDomain, row.retentionTime.value)));
  const sort = options.sort;
  if (sort !== null) rows.sort((left, right) => {
    const a = scalar(left, sort.key);
    const b = scalar(right, sort.key);
    const missingA = a === null || (typeof a === "number" && !Number.isFinite(a));
    const missingB = b === null || (typeof b === "number" && !Number.isFinite(b));
    if (missingA !== missingB) return missingA ? 1 : -1;
    const byUnit = sort.key === "retentionTime"
      ? RETENTION_UNIT_RANK[left.retentionTime.unit] - RETENTION_UNIT_RANK[right.retentionTime.unit] : 0;
    const comparison = byUnit !== 0 ? Math.sign(byUnit) : missingA || missingB ? 0 : a! < b! ? -1 : a! > b! ? 1 : 0;
    return comparison === 0
      ? index.sourcePositions.get(left.index)! - index.sourcePositions.get(right.index)!
      : comparison * (sort.direction === "ascending" ? 1 : -1);
  });
  return { rows, positions: new Map(rows.map((row, position) => [row.index, position])) };
}

export function adjacentDisplayedScan(view: ScanTableProjection, selected: number | null, direction: -1 | 1): number | null {
  const position = selected === null ? undefined : view.positions.get(selected);
  return position === undefined ? null : view.rows[position + direction]?.index ?? null;
}

export function toggleScanSort(options: ScanTableOptions, key: ScanSortKey): ScanTableOptions {
  return { ...options, sort: { key, direction: options.sort?.key === key &&
    options.sort.direction === "ascending" ? "descending" : "ascending" } };
}
