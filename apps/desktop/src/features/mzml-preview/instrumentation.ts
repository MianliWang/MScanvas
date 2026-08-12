/**
 * Bounded, descriptive timing for the interactions this slice introduces.
 *
 * These are observations, not budgets. Nothing here fails a build, gates a
 * merge, or caches a result to make a number look better; a threshold would
 * need repeated measurement on a recorded hardware baseline, which this slice
 * deliberately does not claim to have.
 */

/** The measurements the workspace records. */
export type PreviewMeasurementName =
  "openToFirstPreview" | "rowSelectToRendered" | "spectrumTableRender";

export interface PreviewMeasurement {
  readonly name: PreviewMeasurementName;
  readonly milliseconds: number;
  /** What the measurement covered, so a number is never read out of context. */
  readonly detail: string;
}

/** Kept small on purpose: this is a live readout, not a metrics history. */
const MAX_RETAINED_MEASUREMENTS = 24;

export function now(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

export function appendMeasurement(
  measurements: readonly PreviewMeasurement[],
  measurement: PreviewMeasurement,
): PreviewMeasurement[] {
  return [measurement, ...measurements].slice(0, MAX_RETAINED_MEASUREMENTS);
}

export function latestMeasurement(
  measurements: readonly PreviewMeasurement[],
  name: PreviewMeasurementName,
): PreviewMeasurement | null {
  return measurements.find((measurement) => measurement.name === name) ?? null;
}
