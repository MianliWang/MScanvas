import { usableRange } from "./rangeSelection";

/** ASCII decimal-dot grammar; domain values are finite reals, including exponent form. */
export function rangeNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
export function validateRangeDraft(low: string, high: string, full: { readonly low: number; readonly high: number }):
  | { readonly valid: true; readonly low: number; readonly high: number }
  | { readonly valid: false; readonly reason: "rangeBlank" | "rangeInvalid" | "rangeForward" | "rangeOutside" } {
  if (low.trim() === "" || high.trim() === "") return { valid: false, reason: "rangeBlank" };
  const lower = rangeNumber(low); const upper = rangeNumber(high);
  if (lower === null || upper === null) return { valid: false, reason: "rangeInvalid" };
  if (!usableRange({ low: lower, high: upper })) return { valid: false, reason: "rangeForward" };
  if (!usableRange(full) || lower < full.low || upper > full.high) return { valid: false, reason: "rangeOutside" };
  return { valid: true, low: lower, high: upper };
}
