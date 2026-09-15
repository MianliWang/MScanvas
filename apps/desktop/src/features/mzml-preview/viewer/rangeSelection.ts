/** The axis discriminator also prevents an m/z domain entering RT arithmetic. */
declare const horizontalAxis: unique symbol;
export interface RetentionTimeAxis { readonly [horizontalAxis]?: "rt" }
export interface MzAxis { readonly [horizontalAxis]?: "mz" }

export interface RangeTransaction<A extends "rt" | "mz", D> {
  readonly axis: A;
  readonly epoch: number;
  readonly source: number | string;
  readonly selectionRevision: number;
  readonly committed: D | null;
}
export interface RangeSelection<A extends "rt" | "mz", D> {
  readonly transaction: RangeTransaction<A, D>;
  readonly phase: "drawing" | "pending";
  readonly domain: D;
}

export function sameRange(left: { readonly low: number; readonly high: number } | null,
  right: { readonly low: number; readonly high: number } | null): boolean {
  return left === null || right === null ? left === right : left.low === right.low && left.high === right.high;
}

/** Empty/nonfinite proposals are refused before the existing domain clamp. */
export function usableRange(domain: { readonly low: number; readonly high: number }): boolean {
  return Number.isFinite(domain.low) && Number.isFinite(domain.high) &&
    Number.isFinite(domain.high - domain.low) && domain.high > domain.low;
}

export function sameTransaction<A extends "rt" | "mz", D extends { readonly low: number; readonly high: number }>(
  left: RangeTransaction<A, D>, right: RangeTransaction<A, D>,
): boolean {
  return left.axis === right.axis && left.epoch === right.epoch && left.source === right.source &&
    left.selectionRevision === right.selectionRevision && sameRange(left.committed, right.committed);
}
