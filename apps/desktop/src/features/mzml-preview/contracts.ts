/**
 * The shapes the Rust preview boundary sends.
 *
 * The frontend never parses ProteoWizard output. Everything here is already
 * typed, redacted and bounded by Rust; this file only names it.
 */

export interface BackendFailure {
  readonly kind: string;
  readonly summary: string;
  readonly correctiveAction: string;
}

export interface BackendAvailability {
  readonly state: "available" | "unavailable";
  /**
   * Which installation this verdict describes. Carried with the verdict rather
   * than tracked separately, so a reading can never be rendered beside the
   * wrong origin.
   */
  readonly origin: "automatic" | "chosen";
  /**
   * How many times the installation in use has changed, counted in Rust.
   *
   * Which verdict is current is decided there, not here. The two commands
   * contend for one lock that does not grant in call order, so a recheck begun
   * after a folder choice can be served before it and describe the installation
   * the choice replaced. Apply a verdict only when this is at least the highest
   * already applied.
   */
  readonly installationGeneration: number;
  readonly release: string | null;
  readonly buildDate: string | null;
  readonly sameInstallation: boolean;
  readonly failure: BackendFailure | null;
}

export interface SelectedFile {
  /** Opaque, session-scoped. Never a path. */
  readonly handle: string;
  readonly fileName: string;
  readonly byteLength: number;
}

export interface MetadataSection {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly string[];
  /** How many lines the section really has, which can exceed `entries`. */
  readonly totalEntryCount: number;
  readonly truncated: boolean;
}

export interface Metadata {
  readonly sections: readonly MetadataSection[];
}

export interface MsLevelCount {
  /** `null` is the backend's "other" bucket, not a missing value. */
  readonly msLevel: number | null;
  readonly spectrumCount: number;
}

/**
 * The measured formatter emits no retention-time unit, so `unitKnown` is false
 * and no unit may be displayed alongside the value.
 */
export interface RetentionTime {
  readonly value: number;
  readonly unitKnown: boolean;
}

export interface RetentionTimeRange {
  readonly minimum: RetentionTime;
  readonly maximum: RetentionTime;
}

export interface RunSummary {
  readonly totalSpectrumCount: number;
  readonly msLevels: readonly MsLevelCount[];
  /** How many buckets the summary really reported. */
  readonly totalMsLevelCount: number;
  readonly msLevelsTruncated: boolean;
  /** `null` because no chromatogram count is emitted. It is not zero. */
  readonly chromatogramCount: number | null;
  readonly retentionTimeRange: RetentionTimeRange | null;
}

export interface SpectrumRow {
  readonly index: number;
  readonly identifier: string;
  readonly scanNumber: number | null;
  readonly msLevel: number;
  readonly retentionTime: RetentionTime;
  readonly basePeakMz: number;
  readonly basePeakIntensity: number;
  readonly totalIonCurrent: number;
  readonly precursorMz: number | null;
}

export interface SpectrumTable {
  readonly rows: readonly SpectrumRow[];
  readonly totalRowCount: number;
  readonly truncated: boolean;
}

export interface Preview {
  /**
   * Where the sequence of backend changes stood when this preview was read.
   *
   * An open is a look at the backend and can be the first thing to notice a
   * change, so it can advance the sequence itself. Adopting it is what stops a
   * later verdict's higher number reading as a change that happened after this
   * preview — which would discard the very reading that caused it.
   */
  readonly installationGeneration: number;
  readonly file: SelectedFile;
  readonly metadata: Metadata;
  readonly runSummary: RunSummary;
  readonly spectrumTable: SpectrumTable;
}

export interface Precursor {
  readonly index: number;
  readonly mz: number;
  readonly intensity: number;
}

export interface SelectedSpectrum {
  readonly index: number;
  readonly scanNumber: number | null;
  readonly identifiers: readonly string[];
  readonly msLevel: number;
  readonly retentionTime: RetentionTime;
  readonly pointCount: number;
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
  readonly mzLow: number;
  readonly mzHigh: number;
  readonly basePeakMz: number;
  readonly basePeakIntensity: number;
  readonly totalIonCurrent: number;
  readonly precursors: readonly Precursor[];
  /** How many precursors the spectrum really has. */
  readonly totalPrecursorCount: number;
  readonly precursorsTruncated: boolean;
  /** No profile/centroid marker was emitted, so none may be displayed. */
  readonly representationKnown: boolean;
  /** No array unit was emitted, so none may be displayed. */
  readonly valueUnitsKnown: boolean;
  readonly truncated: boolean;
}

/**
 * A spectrum that exists but has no peaks is `spectrum` with `pointCount: 0`.
 * `unavailable` means the backend has no spectrum at that index at all.
 */
export type SelectedSpectrumOutcome =
  | { readonly outcome: "spectrum"; readonly spectrum: SelectedSpectrum }
  | { readonly outcome: "unavailable"; readonly requestedIndex: number };

export interface PreviewError {
  readonly kind: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly retryable: boolean;
}

export function isPreviewError(value: unknown): value is PreviewError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PreviewError).kind === "string" &&
    typeof (value as PreviewError).summary === "string"
  );
}

/** Normalizes anything thrown across the boundary into a displayable error. */
export function toPreviewError(value: unknown): PreviewError {
  if (isPreviewError(value)) {
    return value;
  }
  return {
    kind: "unexpected_error",
    summary: "Something went wrong while talking to the MSCanvas backend.",
    detail: null,
    retryable: true,
  };
}
