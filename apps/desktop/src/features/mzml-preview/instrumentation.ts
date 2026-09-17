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
  | "openToFirstPreview"
  | "rowSelectToRendered"
  | "spectrumTableRender";

/**
 * What a measurement covered, as a resource and its parameters.
 *
 * Not a sentence. A measurement is recorded by a hook that has no message
 * binding, and a sentence written there would be English wherever it was later
 * rendered -- which is what the inspector's tooltips were. The panel that
 * renders the tooltip is the one with a locale, so it does the wording.
 */
export type PreviewMeasurementDetail =
  | { readonly key: "measureOpenDetail"; readonly rows: string }
  | { readonly key: "measureRowDetail"; readonly index: string }
  | { readonly key: "measureTableDetail"; readonly rows: string };

export interface PreviewMeasurement {
  readonly name: PreviewMeasurementName;
  readonly milliseconds: number;
  /** What the measurement covered, so a number is never read out of context. */
  readonly detail: PreviewMeasurementDetail;
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
