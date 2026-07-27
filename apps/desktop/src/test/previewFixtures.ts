/**
 * Deterministic preview data and a controllable API for tests.
 *
 * This exists only under `src/test`, is never imported by application code, and
 * never reaches a bundle. It substitutes at the application boundary — the same
 * `PreviewApi` the Tauri commands implement — so the tests exercise the real
 * components, the real state machine and the real rendering, with only the
 * process launches replaced.
 */

import type { PreviewApi } from "../features/mzml-preview/api";
import type {
  BackendAvailability,
  Preview,
  PreviewError,
  SelectedFile,
  SelectedSpectrum,
  SelectedSpectrumOutcome,
  SpectrumRow,
} from "../features/mzml-preview/contracts";

export const availableBackend: BackendAvailability = {
  state: "available",
  release: "3.0.25000",
  buildDate: "2026-05-04",
  sameInstallation: true,
  failure: null,
};

export const unavailableBackend: BackendAvailability = {
  state: "unavailable",
  release: null,
  buildDate: null,
  sameInstallation: false,
  failure: {
    kind: "backend_not_found",
    summary: "No ProteoWizard installation was found on this machine.",
    correctiveAction: "Install ProteoWizard, then check again.",
  },
};

export const selectedFile: SelectedFile = {
  handle: "file-0",
  fileName: "QC_pool_01.mzML",
  byteLength: 208_408_454,
};

/**
 * Deterministic row generation. Values are arbitrary but stable, so a test can
 * assert on an exact cell without depending on a clock or a random source.
 */
export function buildRows(count: number): SpectrumRow[] {
  const rows: SpectrumRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const msLevel = index % 4 === 0 ? 1 : 2;
    rows.push({
      index,
      identifier: `controllerType=0 controllerNumber=1 scan=${index + 1}`,
      scanNumber: index + 1,
      msLevel,
      retentionTime: { value: index * 0.0125, unitKnown: false },
      basePeakMz: 400 + (index % 500),
      basePeakIntensity: 1_000 + index,
      totalIonCurrent: 10_000 + index * 3,
      precursorMz: msLevel === 1 ? null : 500 + (index % 300),
    });
  }
  return rows;
}

export function buildPreview(rowCount = 6, truncated = false): Preview {
  const rows = buildRows(rowCount);
  return {
    file: selectedFile,
    metadata: {
      sections: [
        {
          id: "file_description",
          title: "File description",
          entries: ["fileContent: MSn spectrum", "sourceFile: <path>"],
          totalEntryCount: 2,
          truncated: false,
        },
        {
          id: "software_list",
          title: "Software",
          entries: ["software: pwiz 3.0.25000"],
          totalEntryCount: 1,
          truncated: false,
        },
      ],
      leadingEntryCount: 2,
    },
    runSummary: {
      totalSpectrumCount: truncated ? 250_000 : rowCount,
      msLevels: [
        { msLevel: 1, spectrumCount: Math.ceil(rowCount / 4) },
        { msLevel: 2, spectrumCount: rowCount - Math.ceil(rowCount / 4) },
      ],
      chromatogramCount: null,
      retentionTimeRange: {
        minimum: { value: 0, unitKnown: false },
        maximum: { value: (rowCount - 1) * 0.0125, unitKnown: false },
      },
    },
    spectrumTable: {
      rows,
      totalRowCount: truncated ? 250_000 : rowCount,
      truncated,
    },
  };
}

export function buildSpectrum(index: number, pointCount: number): SelectedSpectrum {
  const mz: number[] = [];
  const intensity: number[] = [];
  for (let point = 0; point < pointCount; point += 1) {
    mz.push(300 + point * 0.5);
    intensity.push(100 + ((point * 37) % 900));
  }
  // Derived, so the reported base peak is a point the spectrum actually has.
  let basePeakIndex = 0;
  for (let point = 1; point < pointCount; point += 1) {
    if ((intensity[point] ?? 0) > (intensity[basePeakIndex] ?? 0)) {
      basePeakIndex = point;
    }
  }

  return {
    index,
    scanNumber: index + 1,
    identifiers: [`controllerType=0 controllerNumber=1 scan=${index + 1}`],
    msLevel: 2,
    retentionTime: { value: index * 0.0125, unitKnown: false },
    pointCount,
    mz,
    intensity,
    mzLow: pointCount === 0 ? 0 : 300,
    mzHigh: pointCount === 0 ? 0 : 300 + (pointCount - 1) * 0.5,
    basePeakMz: pointCount === 0 ? 0 : (mz[basePeakIndex] ?? 0),
    basePeakIntensity: pointCount === 0 ? 0 : (intensity[basePeakIndex] ?? 0),
    totalIonCurrent: 54_321,
    precursors: pointCount === 0 ? [] : [{ index: 0, mz: 512.25, intensity: 8_400 }],
    totalPrecursorCount: pointCount === 0 ? 0 : 1,
    precursorsTruncated: false,
    representationKnown: false,
    valueUnitsKnown: false,
    truncated: false,
  };
}

export function previewError(overrides: Partial<PreviewError> = {}): PreviewError {
  return {
    kind: "backend_failed",
    summary: "The preview could not be produced.",
    detail: null,
    retryable: true,
    ...overrides,
  };
}

/** A promise a test resolves by hand, to control async ordering exactly. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveInner, rejectInner) => {
    resolve = resolveInner;
    reject = rejectInner;
  });
  return { promise, resolve, reject };
}

export interface FakePreviewApiOptions {
  readonly availability?: BackendAvailability | (() => Promise<BackendAvailability>);
  readonly file?: SelectedFile | null | (() => Promise<SelectedFile | null>);
  readonly preview?: Preview | (() => Promise<Preview>);
  readonly spectrum?: (index: number) => Promise<SelectedSpectrumOutcome>;
}

export interface FakePreviewApi extends PreviewApi {
  readonly requestedSpectra: number[];
  readonly openCount: () => number;
}

export function createFakePreviewApi(options: FakePreviewApiOptions = {}): FakePreviewApi {
  const requestedSpectra: number[] = [];
  let openCount = 0;

  return {
    requestedSpectra,
    openCount: () => openCount,
    inspectBackend: () =>
      typeof options.availability === "function"
        ? options.availability()
        : Promise.resolve(options.availability ?? availableBackend),
    chooseFile: () =>
      typeof options.file === "function"
        ? options.file()
        : Promise.resolve(options.file === undefined ? selectedFile : options.file),
    openPreview: () => {
      openCount += 1;
      return typeof options.preview === "function"
        ? options.preview()
        : Promise.resolve(options.preview ?? buildPreview());
    },
    loadSpectrum: (_handle, index) => {
      requestedSpectra.push(index);
      return options.spectrum === undefined
        ? Promise.resolve({ outcome: "spectrum", spectrum: buildSpectrum(index, 12) })
        : options.spectrum(index);
    },
  };
}
