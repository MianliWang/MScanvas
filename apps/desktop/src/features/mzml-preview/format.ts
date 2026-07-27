/**
 * Locale-independent display formatting.
 *
 * Locale-aware numerics are a named later gate, so nothing here consults the
 * host locale: the same value renders identically on every machine and in
 * every test run.
 */

import type { RetentionTime } from "./contracts";

/** Groups integer digits without consulting the host locale. */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMz(value: number): string {
  return value.toFixed(4);
}

/**
 * Intensities span many orders of magnitude, so large values move to
 * exponential notation rather than becoming an unreadable digit run.
 */
export function formatIntensity(value: number): string {
  if (value === 0) {
    return "0";
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-3) {
    return value.toExponential(3);
  }
  return value.toFixed(magnitude >= 1000 ? 0 : 2);
}

/**
 * Renders a retention time with no unit, because the backend emits none.
 * Inventing "min" or "s" here would present a guess as a measurement.
 */
export function formatRetentionTime(retentionTime: RetentionTime): string {
  const value = retentionTime.value.toFixed(4);
  return retentionTime.unitKnown ? value : `${value} (unit not reported)`;
}

/** The compact retention-time form for a dense table cell. */
export function formatRetentionTimeValue(retentionTime: RetentionTime): string {
  return retentionTime.value.toFixed(4);
}

export function formatByteLength(bytes: number): string {
  if (bytes < 1024) {
    return `${formatCount(bytes)} bytes`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatMsLevel(msLevel: number | null): string {
  return msLevel === null ? "Other" : `MS${msLevel}`;
}

export function formatDuration(milliseconds: number): string {
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${milliseconds.toFixed(1)} ms`;
}
