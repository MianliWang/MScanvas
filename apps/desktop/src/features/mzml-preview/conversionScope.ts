import { isConvertibleSourceKind, type SelectedFile } from "./contracts";
import { orderRoster, type SortMode } from "./rosterView";

export type ConversionScope = "selected" | "all";

export interface ConversionScopeFacts {
  readonly datasets: readonly SelectedFile[];
  readonly selected: ReadonlySet<string>;
  readonly sort: SortMode;
}

export interface ResolvedConversionScope {
  readonly scope: ConversionScope;
  readonly requestedCount: number;
  readonly excludedCount: number;
  readonly members: readonly SelectedFile[];
  readonly handles: readonly string[];
  readonly sort: SortMode;
}

/**
 * A query over Rust's roster facts, never a second stored roster. Search,
 * pinning and focus are deliberately not operands. Family eligibility uses
 * the existing projection; Rust revalidates every handle and provider binding.
 */
export function resolveConversionScope(
  scope: ConversionScope,
  facts: ConversionScopeFacts,
): ResolvedConversionScope {
  const requested = orderRoster(facts.datasets, facts.sort)
    .filter((row) => scope === "all" || facts.selected.has(row.handle));
  const members = requested.filter((row) => isConvertibleSourceKind(row.sourceKind));
  return {
    scope,
    requestedCount: requested.length,
    excludedCount: requested.length - members.length,
    members,
    handles: members.map((row) => row.handle),
    sort: facts.sort,
  };
}

/** Only scope, resolved membership and order change the execution question. */
export function sameConversionScope(
  left: Pick<ResolvedConversionScope, "scope" | "handles">,
  right: Pick<ResolvedConversionScope, "scope" | "handles">,
): boolean {
  return left.scope === right.scope && left.handles.length === right.handles.length &&
    left.handles.every((handle, index) => handle === right.handles[index]);
}
