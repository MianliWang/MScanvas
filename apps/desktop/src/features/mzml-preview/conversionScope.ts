import { isConvertibleSourceKind, type SelectedFile } from "./contracts";
import { formatDatasetLabel } from "./format";
import { orderRoster, type SortMode } from "./rosterView";

export type ConversionScope = "selected" | "all" | "file";

/**
 * The one row "Convert this file…" named. Its name stays with its handle, so
 * the scope can still say which file it held after that row has been removed.
 * Not its context: Rust recomputes that with every roster, so only the live row's
 * is true (ADR 0006).
 */
export type ConversionFile = Pick<SelectedFile, "handle" | "fileName">;

export interface ConversionScopeFacts {
  readonly datasets: readonly SelectedFile[];
  readonly conversionMembership: ReadonlySet<string>;
  readonly sort: SortMode;
}

export interface ResolvedConversionScope {
  readonly scope: ConversionScope;
  /** What says which file this scope is held to; `null` under the other two scopes. */
  readonly fileLabel: string | null;
  readonly requestedCount: number;
  readonly excludedCount: number;
  /** The requested rows this scope cannot convert, in execution order, to name them (PM9.4 O2). */
  readonly excluded: readonly SelectedFile[];
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
  file: ConversionFile | null = null,
): ResolvedConversionScope {
  const requested = orderRoster(facts.datasets, facts.sort).filter((row) =>
    scope === "all" || (scope === "file" ? row.handle === file?.handle : facts.conversionMembership.has(row.handle)));
  const members = requested.filter((row) => isConvertibleSourceKind(row.sourceKind));
  const held = requested[0];
  return {
    scope,
    fileLabel: scope !== "file" ? null : held === undefined ? file?.fileName ?? null : formatDatasetLabel(held),
    requestedCount: requested.length,
    excludedCount: requested.length - members.length,
    excluded: requested.filter((row) => !isConvertibleSourceKind(row.sourceKind)),
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
