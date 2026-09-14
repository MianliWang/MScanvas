import type { SpectrumRow } from "../contracts";

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

/** Raw, case-sensitive substring search; raw identifiers compare by UTF-16 code units.
 * Missing scalars stay last in either direction. Ties keep original table order.
 * No formatted or translated value is an input, and source rows are never mutated.
 */
export function projectScanTable(index: ScanTableIndex, options: ScanTableOptions): ScanTableProjection {
  const query = options.query.trim();
  const rows = index.rows.filter(row =>
    (options.msLevel === null || row.msLevel === options.msLevel) &&
    (query === "" || row.identifier.includes(query) || String(row.index).includes(query) ||
      (row.scanNumber !== null && String(row.scanNumber).includes(query))));
  const sort = options.sort;
  if (sort !== null) rows.sort((left, right) => {
    const a = scalar(left, sort.key);
    const b = scalar(right, sort.key);
    const missingA = a === null || (typeof a === "number" && !Number.isFinite(a));
    const missingB = b === null || (typeof b === "number" && !Number.isFinite(b));
    if (missingA !== missingB) return missingA ? 1 : -1;
    const comparison = missingA || missingB ? 0 : a! < b! ? -1 : a! > b! ? 1 : 0;
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
