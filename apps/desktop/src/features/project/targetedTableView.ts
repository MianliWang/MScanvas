/**
 * A stored targeted result's rows, sorted and filtered in the page (S-7.1).
 *
 * The scan table's rule (`viewer/scanTableView.ts`), written beside it: missing
 * values last in either direction, ties in their original order, and no
 * formatted or translated value as an input. None of this changes a value.
 *
 * ponytail: this sorts in the page only because a whole result fits one read:
 * a plan holds at most 200 targets (`record.rs` `MAX_TARGETS`) and a page 500
 * rows (`payload.rs` `MAX_PAGE_ROWS`). A larger result moves it to Rust, as
 * ADR 0067 decision 6 does for matrices.
 */

import type { PayloadRow, RowOutcome, TargetedTableSortKey, TargetedTableView } from "./projectApi";

/** Every outcome, in the order the report counts them; also how they sort. */
export const ROW_OUTCOMES = [
  "DETECTED",
  "DETECTED_AMBIGUOUS",
  "SHARED",
  "SUPPRESSED_BY_OVERLAP",
  "NOT_DETECTED",
  "FAILED",
] as const satisfies readonly RowOutcome[];

export interface TargetedViewOptions {
  /** The outcomes pressed. None pressed is no filter on outcome. */
  readonly outcomes: readonly RowOutcome[];
  readonly text: string;
  readonly sort: TargetedTableView["sort"];
}

export const INITIAL_TARGETED_VIEW: TargetedViewOptions = { outcomes: [], text: "", sort: null };

/** What the page knows about a row's target that the row itself does not hold. */
export interface TargetNames {
  readonly nameOf: (targetId: string) => string;
  readonly formulaOf: (targetId: string) => string;
}

export function targetedViewActive(options: TargetedViewOptions) {
  return options.outcomes.length > 0 || options.text.trim() !== "" || options.sort !== null;
}

/** Case does not matter: a name is typed by one person and looked for by another. */
function matchesText(row: PayloadRow, text: string, names: TargetNames) {
  const needle = text.trim().toLowerCase();
  return (
    names.nameOf(row.targetId).toLowerCase().includes(needle) ||
    names.formulaOf(row.targetId).toLowerCase().includes(needle)
  );
}

function sortValue(row: PayloadRow, key: TargetedTableSortKey, names: TargetNames): string | number | null {
  switch (key) {
    case "label":
      return names.nameOf(row.targetId);
    case "outcome":
      return ROW_OUTCOMES.indexOf(row.outcome);
    case "feature_apex_rt_s":
      return row.feature?.apexRtS ?? null;
    case "raw_area":
      return row.feature?.rawArea ?? null;
  }
}

function isMissing(value: string | number | null) {
  return value === null || (typeof value === "number" && !Number.isFinite(value));
}

/** The rows shown, as a new list; the stored order is the tie-break, by a stable sort. */
export function projectTargetedRows(
  rows: readonly PayloadRow[],
  options: TargetedViewOptions,
  names: TargetNames,
): readonly PayloadRow[] {
  const kept = rows.filter(
    (row) =>
      (options.outcomes.length === 0 || options.outcomes.includes(row.outcome)) &&
      matchesText(row, options.text, names),
  );
  const sort = options.sort;
  if (sort === null) return kept;
  const sign = sort.direction === "ascending" ? 1 : -1;
  return kept.sort((left, right) => {
    const a = sortValue(left, sort.key, names);
    const b = sortValue(right, sort.key, names);
    if (isMissing(a) || isMissing(b)) return Number(isMissing(a)) - Number(isMissing(b));
    return a! < b! ? -sign : a! > b! ? sign : 0;
  });
}

/**
 * One choice per outcome the result holds, with how many rows pressing it would
 * show under the typed text. An outcome the result does not hold is no choice.
 */
export function outcomeChoices(rows: readonly PayloadRow[], text: string, names: TargetNames) {
  return ROW_OUTCOMES.filter((outcome) => rows.some((row) => row.outcome === outcome)).map((outcome) => ({
    outcome,
    count: rows.filter((row) => row.outcome === outcome && matchesText(row, text, names)).length,
  }));
}

export function toggleOutcome(options: TargetedViewOptions, outcome: RowOutcome): TargetedViewOptions {
  return {
    ...options,
    outcomes: ROW_OUTCOMES.filter((known) => options.outcomes.includes(known) !== (known === outcome)),
  };
}

export function toggleTargetedSort(options: TargetedViewOptions, key: TargetedTableSortKey): TargetedViewOptions {
  const ascending = options.sort?.key === key && options.sort.direction === "ascending";
  return { ...options, sort: { key, direction: ascending ? "descending" : "ascending" } };
}

/** The view as Rust checks and names it: `outcomes` is explicit, never empty for "all". */
export function targetedViewWire(shown: readonly PayloadRow[], options: TargetedViewOptions): TargetedTableView {
  return {
    targetIds: shown.map((row) => row.targetId),
    outcomes: options.outcomes.length === 0 ? ROW_OUTCOMES : options.outcomes,
    text: options.text.trim(),
    sort: options.sort,
  };
}
