/**
 * Display formatting.
 *
 * Locale-*aware numerics* are a named later gate, so nothing here consults the
 * host locale: the same value renders identically on every machine and in every
 * test run. Three of these do take the message binding, and that is a different
 * thing -- the digits and the units are unchanged, and what the binding
 * supplies is the English word beside them. `bytes` and `Other` are words; the
 * number, `KiB`, `s`, `ms`, `MS1` and `MS2` are not.
 */

import type { UiMessage } from "../preferences/i18n";
import type { RetentionTime, SelectedFile } from "./contracts";

/**
 * Names one dataset without deriving or exposing any more location than Rust
 * already decided the live roster needs to disambiguate it.
 *
 * The context is roster-relative and can change as same-named rows arrive or
 * leave, so callers should pass the current roster row when one is available;
 * a dataset copied into an older preview response is only a defensive fallback.
 */
export function formatDatasetLabel(dataset: SelectedFile): string {
  return dataset.relativeContext === null
    ? dataset.fileName
    : `${dataset.fileName}, ${dataset.relativeContext}`;
}

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
 *
 * The caveat is a resource, and it is the same one the spectrum panel already
 * used for this field. Held here as English it was the one value in the
 * localized inspector that a Chinese session read in English -- on every run,
 * because the measured formatter never reports a unit.
 */
export function formatRetentionTime(retentionTime: RetentionTime, t: UiMessage): string {
  const value = retentionTime.value.toFixed(4);
  return retentionTime.unitKnown ? value : t("viewerRetentionValue", { value });
}

/** The compact retention-time form for a dense table cell. */
export function formatRetentionTimeValue(retentionTime: RetentionTime): string {
  return retentionTime.value.toFixed(4);
}

/**
 * A file size.
 *
 * The binary units are units in any language and stay as they are. `bytes` is
 * an English word, so below a kibibyte the sentence is a resource.
 */
export function formatByteLength(bytes: number, t: UiMessage): string {
  if (bytes < 1024) {
    return t("formatBytes", { count: bytes });
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

/**
 * An MS level, or the backend's own *other* bucket.
 *
 * `MS1` and `MS2` are identifiers. `Other` is a word, and it names a bucket a
 * real run reaches -- `msLevel: null` is that bucket rather than a missing
 * value -- so it is a resource.
 */
export function formatMsLevel(msLevel: number | null, t: UiMessage): string {
  return msLevel === null ? t("formatMsOther") : `MS${msLevel}`;
}

export function formatDuration(milliseconds: number): string {
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${milliseconds.toFixed(1)} ms`;
}
