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
  WorkspaceAddOutcome,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "../features/mzml-preview/contracts";

export const availableBackend: BackendAvailability = {
  state: "available",
  origin: "automatic",
  installationGeneration: 0,
  release: "3.0.25000",
  buildDate: "2026-05-04",
  sameInstallation: true,
  failure: null,
};

/** What a chosen folder holding a usable installation reports. */
export const chosenBackend: BackendAvailability = {
  state: "available",
  origin: "chosen",
  installationGeneration: 1,
  release: "3.0.26013",
  buildDate: "2026-07-01",
  sameInstallation: true,
  failure: null,
};

/// A chosen folder that holds no installation, reported by cause rather than by
/// category. The application classifies this itself so the reason can be
/// specific without a path reaching the webview.
export const chosenFolderWithoutTools: BackendAvailability = {
  state: "unavailable",
  origin: "chosen",
  installationGeneration: 1,
  release: null,
  buildDate: null,
  sameInstallation: false,
  failure: {
    kind: "chosen_folder_missing_both_tools",
    summary:
      "That folder holds neither msconvert.exe nor msaccess.exe, so it is not a ProteoWizard installation.",
    correctiveAction: "Choose a different folder, or go back to searching automatically.",
  },
};

export const unavailableBackend: BackendAvailability = {
  state: "unavailable",
  origin: "automatic",
  installationGeneration: 0,
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

export const secondFile: SelectedFile = {
  handle: "file-1",
  fileName: "QC_pool_02.mzML",
  byteLength: 191_004_112,
};

export const thirdFile: SelectedFile = {
  handle: "file-2",
  fileName: "Blank_03.mzML",
  byteLength: 12_004_112,
};

/** The session capacity Rust enforces, restated here only for the fake. */
export const FAKE_WORKSPACE_CAPACITY = 1_024;

export function workspaceFullError(): PreviewError {
  return {
    kind: "workspace_full",
    summary:
      "This session already holds as many files as MSCanvas keeps in one workspace, so that one was not added. Remove some rows and add it again.",
    detail: null,
    retryable: false,
  };
}

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

export function buildPreview(rowCount = 6, truncated = false, installationGeneration = 0): Preview {
  const rows = buildRows(rowCount);
  return {
    installationGeneration,
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
    },
    runSummary: {
      totalSpectrumCount: truncated ? 250_000 : rowCount,
      msLevels: [
        { msLevel: 1, spectrumCount: Math.ceil(rowCount / 4) },
        { msLevel: 2, spectrumCount: rowCount - Math.ceil(rowCount / 4) },
      ],
      totalMsLevelCount: 2,
      msLevelsTruncated: false,
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

/**
 * One thing the picker handed back: a file the session can accept, or a
 * candidate Rust refused.
 *
 * Modelled rather than canned, because the outcome of adding a file depends on
 * what the workspace already holds. A fake that answered with fixed outcomes
 * could not tell a correct duplicate rule from an incorrect one.
 */
export type PickedFile =
  | SelectedFile
  | { readonly rejected: string; readonly error?: PreviewError };

export interface FakePreviewApiOptions {
  readonly availability?: BackendAvailability | (() => Promise<BackendAvailability>);
  /** What the folder picker resolves to. `null` stands for a dismissed picker. */
  readonly chosenInstallation?:
    | BackendAvailability
    | null
    | (() => Promise<BackendAvailability | null>);
  /** What the session already holds when the webview mounts. */
  readonly initialDatasets?: readonly SelectedFile[];
  /** Replaces the roster read entirely, for the cases where it fails. */
  readonly roster?: () => Promise<WorkspaceRoster>;
  /**
   * What the multi-file picker hands back. `null` is a dismissed picker, which
   * is deliberately not the same as an empty list.
   */
  readonly pickedFiles?:
    | readonly PickedFile[]
    | null
    | (() => Promise<readonly PickedFile[] | null>);
  readonly capacity?: number;
  /** Replaces the removal entirely, for the cases where it fails. */
  readonly removeDatasets?: (handles: readonly string[]) => Promise<WorkspaceRemoveResult>;
  /** Replaces the clear entirely, for the cases where it fails. */
  readonly clearWorkspace?: () => Promise<WorkspaceRoster>;
  readonly preview?: Preview | (() => Promise<Preview>);
  readonly spectrum?: (index: number) => Promise<SelectedSpectrumOutcome>;
}

export interface FakePreviewApi extends PreviewApi {
  readonly requestedSpectra: number[];
  readonly openCount: () => number;
  /** Every handle this fake was asked to read, in order. */
  readonly openedHandles: string[];
  /** How many times the roster has been read. */
  readonly rosterReads: () => number;
  /**
   * Every command this fake was asked for, oldest first.
   *
   * The only way to state "this interaction crossed the boundary zero times"
   * rather than counting one method and hoping the others were quiet too.
   */
  readonly calls: () => readonly string[];
  /** What the fake's session currently holds. */
  readonly datasets: () => readonly SelectedFile[];
  /** Every verdict this fake has handed back, oldest first. */
  readonly deliveredVerdicts: BackendAvailability[];
}

/**
 * A stand-in for the Tauri boundary that models the workspace rather than
 * canning it.
 *
 * It keeps its own ordered list of datasets, decides duplicates by handle,
 * enforces a capacity and answers every mutation with the roster that resulted
 * — the same contract Rust has. Every method is present, so no test can pass by
 * silently defaulting a mutation nobody set up.
 */
export function createFakePreviewApi(options: FakePreviewApiOptions = {}): FakePreviewApi {
  const requestedSpectra: number[] = [];
  const openedHandles: string[] = [];
  let openCount = 0;
  let rosterReads = 0;
  const calls: string[] = [];

  const capacity = options.capacity ?? FAKE_WORKSPACE_CAPACITY;
  let datasets: SelectedFile[] = [...(options.initialDatasets ?? [])];
  const snapshot = (): WorkspaceRoster => ({ datasets: [...datasets], capacity });

  const deliveredVerdicts: BackendAvailability[] = [];
  // Counted here as the service counts it: a change advances it, a plain
  // reading does not. A fake that returned a fixed number would make the
  // ordering rule untestable, and one that never advanced would make every
  // change look older than what is already on screen.
  let generation = 0;
  const deliver = (verdict: BackendAvailability) => {
    const stamped = { ...verdict, installationGeneration: generation };
    deliveredVerdicts.push(stamped);
    return stamped;
  };
  const deliverChange = (verdict: BackendAvailability): BackendAvailability => {
    generation += 1;
    return deliver(verdict);
  };

  const addOne = (picked: PickedFile): WorkspaceAddOutcome => {
    if ("rejected" in picked) {
      return {
        outcome: "rejected",
        candidateName: picked.rejected,
        error: picked.error ?? previewError({ kind: "unsupported_extension", retryable: false }),
      };
    }
    const existing = datasets.find((dataset) => dataset.handle === picked.handle);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    if (datasets.length >= capacity) {
      return {
        outcome: "rejected",
        candidateName: picked.fileName,
        error: workspaceFullError(),
      };
    }
    datasets = [...datasets, picked];
    return { outcome: "added", dataset: picked };
  };

  const fake: FakePreviewApi = {
    requestedSpectra,
    openedHandles,
    openCount: () => openCount,
    rosterReads: () => rosterReads,
    calls: () => [...calls],
    datasets: () => datasets,
    deliveredVerdicts,
    inspectBackend: () =>
      (typeof options.availability === "function"
        ? options.availability()
        : Promise.resolve(options.availability ?? availableBackend)
      ).then(deliver),
    // `?? chosenBackend` would be wrong here: `null` is a meaningful value --
    // a dismissed picker -- and nullish coalescing cannot tell it from an
    // option that was never supplied.
    chooseInstallation: () =>
      (typeof options.chosenInstallation === "function"
        ? options.chosenInstallation()
        : Promise.resolve(
            options.chosenInstallation === undefined ? chosenBackend : options.chosenInstallation,
          )
      ).then((verdict) => (verdict === null ? null : deliverChange(verdict))),
    useAutomaticDiscovery: () =>
      (typeof options.availability === "function"
        ? options.availability()
        : Promise.resolve(options.availability ?? availableBackend)
      ).then(deliverChange),
    getRoster: () => {
      rosterReads += 1;
      return options.roster === undefined ? Promise.resolve(snapshot()) : options.roster();
    },
    chooseFiles: () =>
      (typeof options.pickedFiles === "function"
        ? options.pickedFiles()
        : Promise.resolve(
            options.pickedFiles === undefined ? [selectedFile] : options.pickedFiles,
          )
      ).then((picked) => {
        if (picked === null) {
          return null;
        }
        // Every outcome first, then the roster they produced. Snapshotting
        // before the batch would answer with the workspace as it was, which is
        // the one thing a batch result must not do.
        const outcomes = picked.map(addOne);
        return { roster: snapshot(), outcomes };
      }),
    removeDatasets: (handles) => {
      if (options.removeDatasets !== undefined) {
        return options.removeDatasets(handles);
      }
      const requested = [...new Set(handles)];
      const removedHandles = requested.filter((handle) =>
        datasets.some((dataset) => dataset.handle === handle),
      );
      const unknownHandles = requested.filter((handle) => !removedHandles.includes(handle));
      datasets = datasets.filter((dataset) => !removedHandles.includes(dataset.handle));
      return Promise.resolve({ roster: snapshot(), removedHandles, unknownHandles });
    },
    clearWorkspace: () => {
      if (options.clearWorkspace !== undefined) {
        return options.clearWorkspace();
      }
      datasets = [];
      return Promise.resolve(snapshot());
    },
    openPreview: (handle) => {
      openCount += 1;
      openedHandles.push(handle);
      // Stamped with the generation this fake's service is currently at, as the
      // real one does. A preview that always claimed generation zero would be
      // rejected as stale by anything that had switched installation since --
      // and would let a genuinely stale preview through unnoticed.
      return (
        typeof options.preview === "function"
          ? options.preview()
          : Promise.resolve(options.preview ?? buildPreview())
      ).then((preview) => ({
        ...preview,
        installationGeneration: generation,
        // The preview describes the row that was asked for, as Rust's does.
        file: datasets.find((dataset) => dataset.handle === handle) ?? preview.file,
      }));
    },
    loadSpectrum: (_handle, index) => {
      requestedSpectra.push(index);
      return options.spectrum === undefined
        ? Promise.resolve({ outcome: "spectrum", spectrum: buildSpectrum(index, 12) })
        : options.spectrum(index);
    },
  };

  // Wrapped once, here, rather than threaded through nine method bodies. What
  // this makes testable is the negative claim -- that an interaction crossed
  // the boundary zero times -- which counting any single method cannot state.
  const commands = [
    "inspectBackend",
    "chooseInstallation",
    "useAutomaticDiscovery",
    "getRoster",
    "chooseFiles",
    "removeDatasets",
    "clearWorkspace",
    "openPreview",
    "loadSpectrum",
  ] as const satisfies readonly (keyof PreviewApi)[];
  const recorded: Record<string, unknown> = { ...fake };
  for (const command of commands) {
    const answer = fake[command] as (...args: readonly unknown[]) => unknown;
    recorded[command] = (...args: readonly unknown[]) => {
      calls.push(command);
      return answer(...args);
    };
  }
  return recorded as unknown as FakePreviewApi;
}
