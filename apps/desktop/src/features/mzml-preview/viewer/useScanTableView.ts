import { useCallback, useMemo, useState } from "react";
import type { SpectrumRow } from "../contracts";
import type { RetentionTimeDomain } from "./scanModel";
import { indexScanTable, INITIAL_SCAN_TABLE_OPTIONS, projectScanTable, toggleScanSort,
  type ScanSortKey, type ScanTableOptions, type ScanTableProjection } from "./scanTableView";

export interface ScanTableView {
  readonly projection: ScanTableProjection;
  readonly options: ScanTableOptions;
  /** The chromatogram's committed range the list is following, or `null` for the whole run. */
  readonly rtDomain: RetentionTimeDomain | null;
  readonly msLevels: readonly number[];
  readonly setQuery: (query: string) => void;
  readonly setMsLevel: (level: number | null) => void;
  readonly sortBy: (key: ScanSortKey) => void;
  /** Sets the order outright; `null` is the file's own order. */
  readonly setSort: (sort: ScanTableOptions["sort"]) => void;
  readonly clearFilters: () => void;
}

/**
 * View choices belong to this loaded table; locale/hover/layout never rebuild it.
 * The range is read, never held: the interaction reducer is its one authority (V-2).
 */
export function useScanTableView(rows: readonly SpectrumRow[], rtDomain: RetentionTimeDomain | null = null): ScanTableView {
  const [choice, setChoice] = useState({ rows, options: INITIAL_SCAN_TABLE_OPTIONS });
  const options = choice.rows === rows ? choice.options : INITIAL_SCAN_TABLE_OPTIONS;
  const index = useMemo(() => indexScanTable(rows), [rows]);
  const projection = useMemo(() => projectScanTable(index, options, rtDomain), [index, options, rtDomain]);
  const update = useCallback((change: (current: ScanTableOptions) => ScanTableOptions) => {
    setChoice(current => ({ rows, options: change(current.rows === rows ? current.options : INITIAL_SCAN_TABLE_OPTIONS) }));
  }, [rows]);
  const setQuery = useCallback((query: string) => update(current => ({ ...current, query })), [update]);
  const setMsLevel = useCallback((msLevel: number | null) => update(current => ({ ...current, msLevel })), [update]);
  const sortBy = useCallback((key: ScanSortKey) => update(current => toggleScanSort(current, key)), [update]);
  const setSort = useCallback((sort: ScanTableOptions["sort"]) => update(current => ({ ...current, sort })), [update]);
  const clearFilters = useCallback(() => update(current => ({ ...current, query: "", msLevel: null })), [update]);
  return useMemo(() => ({ projection, options, rtDomain, msLevels: index.msLevels, setQuery, setMsLevel, sortBy, setSort, clearFilters }),
    [projection, options, rtDomain, index.msLevels, setQuery, setMsLevel, sortBy, setSort, clearFilters]);
}
