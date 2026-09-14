import { useCallback, useMemo, useState } from "react";
import type { SpectrumRow } from "../contracts";
import { indexScanTable, INITIAL_SCAN_TABLE_OPTIONS, projectScanTable, toggleScanSort,
  type ScanSortKey, type ScanTableOptions, type ScanTableProjection } from "./scanTableView";

export interface ScanTableView {
  readonly projection: ScanTableProjection;
  readonly options: ScanTableOptions;
  readonly msLevels: readonly number[];
  readonly setQuery: (query: string) => void;
  readonly setMsLevel: (level: number | null) => void;
  readonly sortBy: (key: ScanSortKey) => void;
  readonly clearFilters: () => void;
}

/** View choices belong to this loaded table; locale/hover/layout never rebuild it. */
export function useScanTableView(rows: readonly SpectrumRow[]): ScanTableView {
  const [choice, setChoice] = useState({ rows, options: INITIAL_SCAN_TABLE_OPTIONS });
  const options = choice.rows === rows ? choice.options : INITIAL_SCAN_TABLE_OPTIONS;
  const index = useMemo(() => indexScanTable(rows), [rows]);
  const projection = useMemo(() => projectScanTable(index, options), [index, options]);
  const update = useCallback((change: (current: ScanTableOptions) => ScanTableOptions) => {
    setChoice(current => ({ rows, options: change(current.rows === rows ? current.options : INITIAL_SCAN_TABLE_OPTIONS) }));
  }, [rows]);
  const setQuery = useCallback((query: string) => update(current => ({ ...current, query })), [update]);
  const setMsLevel = useCallback((msLevel: number | null) => update(current => ({ ...current, msLevel })), [update]);
  const sortBy = useCallback((key: ScanSortKey) => update(current => toggleScanSort(current, key)), [update]);
  const clearFilters = useCallback(() => update(current => ({ ...current, query: "", msLevel: null })), [update]);
  return useMemo(() => ({ projection, options, msLevels: index.msLevels, setQuery, setMsLevel, sortBy, clearFilters }),
    [projection, options, index.msLevels, setQuery, setMsLevel, sortBy, clearFilters]);
}
