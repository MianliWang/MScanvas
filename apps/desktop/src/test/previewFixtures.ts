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
import type { WorkspaceDropUpdate } from "../features/mzml-preview/contracts";
import type { WorkspaceDropTransport } from "../features/mzml-preview/dropTransport";
import type {
  BackendAvailability,
  ConversionConflictPolicy,
  ConversionQueuePlan,
  ConversionQueueItem,
  FolderDiscoverySummary,
  FolderIngestionResult,
  Preview,
  PreviewError,
  SelectedFile,
  SelectedSpectrum,
  SelectedSpectrumOutcome,
  SpectrumRow,
  WorkspaceAddOutcome,
  WorkspaceConversionState,
  WorkspaceRemoveResult,
  WorkspaceRoster,
} from "../features/mzml-preview/contracts";

export interface FakeWorkspaceDropTransport extends WorkspaceDropTransport {
  emit(update: WorkspaceDropUpdate): void;
  subscriberCount(): number;
}

/** A deterministic, path-free Channel substitute for hook and rendered tests. */
export function createFakeWorkspaceDropTransport(): FakeWorkspaceDropTransport {
  const subscribers = new Set<(update: WorkspaceDropUpdate) => void>();
  return {
    subscribe: async (onUpdate) => {
      subscribers.add(onUpdate);
      return () => {
        subscribers.delete(onUpdate);
      };
    },
    emit: (update) => {
      for (const subscriber of subscribers) {
        subscriber(update);
      }
    },
    subscriberCount: () => subscribers.size,
  };
}

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
  sourceKind: "mzml",
  relativeContext: null,
};

export const secondFile: SelectedFile = {
  handle: "file-1",
  fileName: "QC_pool_02.mzML",
  byteLength: 191_004_112,
  sourceKind: "mzml",
  relativeContext: null,
};

export const thirdFile: SelectedFile = {
  handle: "file-2",
  fileName: "Blank_03.mzML",
  byteLength: 12_004_112,
  sourceKind: "mzml",
  relativeContext: null,
};

/**
 * Two files of one name, which is the case relative context exists for.
 *
 * Distinct handles and distinct sizes, because they are different acquisitions:
 * the only thing they share is the last component of where they were found.
 */
export const collidingFile: SelectedFile = {
  handle: "file-3",
  fileName: "sample.mzML",
  byteLength: 4_000_000,
  sourceKind: "mzml",
  relativeContext: null,
};

export const otherCollidingFile: SelectedFile = {
  handle: "file-4",
  fileName: "sample.mzML",
  byteLength: 6_000_000,
  sourceKind: "mzml",
  relativeContext: null,
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

/**
 * Where a row was found, which is what a collision context is derived from.
 *
 * `null` is a file the user pointed at directly; an array is the components
 * below the chosen folder, filename excluded, so an empty array is a file at
 * the top of that folder. It is never rendered as such — Rust decides whether
 * anything is said at all, and this fake decides it the same way.
 */
export type DatasetOrigin = readonly string[] | null;

/** A row the session already holds, with where it came from when that matters. */
export type HeldFile =
  | SelectedFile
  | { readonly file: SelectedFile; readonly parents: readonly string[] };

/** One thing a folder scan proposed: a file to add, or a candidate Rust refused. */
export type ScannedFile =
  | { readonly file: SelectedFile; readonly parents?: readonly string[] }
  | { readonly rejected: string; readonly error?: PreviewError };

/** What one folder scan found, and how the scan itself went. */
export interface FolderScan {
  readonly files: readonly ScannedFile[];
  /** Complete and clean unless a test says otherwise. */
  readonly discovery?: Partial<FolderDiscoverySummary>;
}

/** A scan that described the whole folder and skipped nothing. */
export const COMPLETE_SCAN: FolderDiscoverySummary = {
  complete: true,
  skippedReparseCount: 0,
  inaccessibleEntryCount: 0,
  limitsReached: [],
};

/**
 * What the folder picker hands back when a test did not say.
 *
 * Deliberately not `null`: a dismissed picker is a case a test chooses, and a
 * default that stood in for one would let a test claiming to add a folder pass
 * without the folder ever being added.
 */
const DEFAULT_FOLDER_SCAN: FolderScan = {
  files: [{ file: selectedFile, parents: [] }],
};

/**
 * The session's rows, each with where it came from.
 *
 * Held apart from the roster the fake hands back, because the roster is
 * derived: a row's collision context is a fact about the whole list and changes
 * as rows arrive and leave, exactly as it does in Rust.
 */
interface Held {
  readonly file: SelectedFile;
  readonly origin: DatasetOrigin;
  /** The session identifier, which never rewinds, as the allocator's does not. */
  readonly item: number;
}

/**
 * Which rows need a context said about them, modelled as Rust models it.
 *
 * Recomputed over the whole list rather than stored, and produced only for
 * exact filename collisions. A fake that stored the context at insertion could
 * not tell a correct rule from one that leaves a stale context behind after the
 * row that caused it has gone.
 */
function relativeContexts(held: readonly Held[]): Map<number, string> {
  const byName = new Map<string, Held[]>();
  for (const entry of held) {
    const group = byName.get(entry.file.fileName) ?? [];
    group.push(entry);
    byName.set(entry.file.fileName, group);
  }

  const contexts = new Map<number, string>();
  for (const group of byName.values()) {
    if (group.length < 2) {
      continue;
    }
    const described = group.map((entry) => [entry, describeOrigin(entry.origin)] as const);
    const seen = new Map<string, number>();
    for (const [, description] of described) {
      seen.set(description, (seen.get(description) ?? 0) + 1);
    }
    for (const [entry, description] of described) {
      contexts.set(
        entry.item,
        (seen.get(description) ?? 0) > 1
          ? `${description} · workspace item ${String(entry.item)}`
          : description,
      );
    }
  }
  return contexts;
}

function describeOrigin(origin: DatasetOrigin): string {
  if (origin === null) {
    return "Added directly";
  }
  return origin.length === 0 ? "Top level" : origin.join("\\");
}

export interface FakePreviewApiOptions {
  readonly availability?: BackendAvailability | (() => Promise<BackendAvailability>);
  /** What the folder picker resolves to. `null` stands for a dismissed picker. */
  readonly chosenInstallation?:
    | BackendAvailability
    | null
    | (() => Promise<BackendAvailability | null>);
  /** What the session already holds when the webview mounts. */
  readonly initialDatasets?: readonly HeldFile[];
  /** What the conversion slot holds when the webview mounts. */
  readonly initialConversion?: WorkspaceConversionState;
  /** What `describeConversion` answers. Defaults to a plan for the named row. */
  readonly conversionPlan?: (handles: readonly string[]) => Promise<ConversionQueuePlan>;
  /**
   * What one conversion does.
   *
   * Given the state publisher, so a test can move the slot through `running`
   * before settling it — which is what a conversion actually does, and what a
   * canned reply cannot express.
   */
  readonly conversion?: (
    request: ConversionRequest,
    publish: (state: WorkspaceConversionState) => void,
  ) => Promise<WorkspaceConversionState>;
  /** What `Retry failed` does. */
  readonly retry?: (
    publish: (state: WorkspaceConversionState) => void,
  ) => Promise<WorkspaceConversionState>;
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
  /**
   * What the folder picker and the scan behind it hand back. `null` is a
   * dismissed picker, which is deliberately not the same as a folder that held
   * no mzML files.
   *
   * Supplied as a function for the cases where the operation fails: a rejected
   * promise is a discovery refusal, and a deferred one is a scan the test
   * finishes by hand.
   */
  readonly scannedFolder?: FolderScan | null | (() => Promise<FolderScan | null>);
  /**
   * Replaces the folder import entirely, for the cases the modelled one cannot
   * produce.
   *
   * The model always answers with the roster as it is when the scan resolves,
   * which is the honest thing for an import that ran alone. It cannot produce
   * the one case that matters when removing and clearing stay available
   * throughout: a reply carrying a roster from *before* a mutation the user
   * made while it was out there.
   */
  readonly folderResult?: () => Promise<FolderIngestionResult | null>;
  /**
   * Controls the edge after Rust returned the baseline reservation and the
   * exact claim request was dispatched. By default the fake acknowledges
   * synchronously, before the picker/scan result; a test can retain the callback
   * to model the narrow begin-response window explicitly.
   */
  readonly acknowledgeFolderReservation?: (onReserved: () => void) => void;
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
  /**
   * Publishes one conversion state, as Rust would when its slot moves.
   *
   * The slot is modelled rather than canned: the fake holds the current state
   * and a sequence that only advances, so a test can drive a whole operation --
   * awaiting, running, terminal -- and a test that installs an older sequence is
   * exercising the same staleness rule the real transport imposes.
   */
  readonly publishConversion: (state: WorkspaceConversionState) => void;
  /** Every conversion this fake was asked to start, in order. */
  readonly conversionRequests: readonly ConversionRequest[];
}

/** One conversion the fake was asked for. */
export interface ConversionRequest {
  readonly handles: readonly string[];
  readonly conflictPolicy: ConversionConflictPolicy;
}

/** One queue item, as a test describes it. */
export function queueItem(
  handle: string,
  fileName: string,
  overrides: Partial<ConversionQueueItem> = {},
): ConversionQueueItem {
  return {
    datasetHandle: handle,
    fileName,
    sourceKind: "thermo_raw",
    outputFileName: fileName.replace(/\.raw$/i, ".mzML"),
    state: "pending",
    attempts: 0,
    retryable: false,
    report: null,
    error: null,
    ...overrides,
  };
}

/** A whole queue from its items, with the counts Rust would derive. */
export function queueOf(items: readonly ConversionQueueItem[]) {
  const count = (state: ConversionQueueItem["state"]) =>
    items.filter((item) => item.state === state).length;
  const failed = count("failed");
  const retryable = items.filter((item) => item.state === "failed" && item.retryable).length;
  return {
    items,
    currentIndex: items.filter((item) => item.state !== "pending").length,
    itemCount: items.length,
    retryRound: 0,
    conflictPolicy: "fail" as const,
    finalizedCount: count("finalized"),
    skippedCount: count("skipped"),
    failedCount: failed,
    retryableFailedCount: retryable,
    nonRetryableFailedCount: failed - retryable,
    error: null,
  };
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
  let nextItem = 1;
  const hold = (file: SelectedFile, origin: DatasetOrigin): Held => ({
    file,
    origin,
    item: nextItem++,
  });
  let held: Held[] = (options.initialDatasets ?? []).map((entry) =>
    "file" in entry ? hold(entry.file, entry.parents) : hold(entry, null),
  );
  const snapshot = (): WorkspaceRoster => {
    const contexts = relativeContexts(held);
    return {
      datasets: held.map((entry) => ({
        ...entry.file,
        relativeContext: contexts.get(entry.item) ?? null,
      })),
      capacity,
    };
  };
  const datasets = (): readonly SelectedFile[] => snapshot().datasets;

  // The conversion slot, modelled. One state and a sequence that only
  // advances, which is exactly what Rust holds -- so a test that publishes an
  // older sequence is exercising the real staleness rule rather than a fiction.
  let conversion: WorkspaceConversionState = options.initialConversion ?? { status: "idle" };
  let conversionSequence = options.initialConversion === undefined ? 0 : 1;
  const conversionRequests: ConversionRequest[] = [];
  const publishConversion = (state: WorkspaceConversionState): void => {
    conversion = state;
    conversionSequence += 1;
  };
  const defaultConversion = (request: ConversionRequest): WorkspaceConversionState => ({
    status: "terminal",
    operationId: String(conversionSequence + 1),
    queue: queueOf(
      request.handles.map((handle, index) =>
        queueItem(handle, `acquisition-${String(index)}.raw`, {
          state: "finalized",
          attempts: 1,
          report: {
            datasetHandle: handle,
            sourceKind: "thermo_raw",
            outcome: "finalized",
            detailedOutcome: null,
            outputFileName: `acquisition-${String(index)}.mzML`,
            output: {
              byteLength: 28_655,
              sha256: "6CE2ACE65485488F4A337EE17B71559E737C1944B641F279744932C3C3D8648C",
              spectrumCount: 1,
              chromatogramCount: 1,
            },
            validation: {
              mode: "output_only",
              fullyVerified: false,
              verified: ["source_unchanged"],
              unverified: [],
              inapplicable: ["spectrum_count"],
            },
            backend: { exitCode: 0, elapsedMilliseconds: 663 },
            stagingResidue: null,
            installationGeneration: 0,
          },
        }),
      ),
    ),
  });

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

  /**
   * What one candidate did, before anything is said about it.
   *
   * An added or duplicate row is named by its session item rather than by a
   * copy of the dataset, because the dataset a caller is handed depends on what
   * the rest of the batch turns out to be: the second `sample.mzML` is the
   * reason the first one has a context at all. Described mid-batch, the first
   * outcome would carry none while the roster beside it carried one.
   */
  type Pending =
    | { readonly kind: "row"; readonly duplicate: boolean; readonly item: number }
    | { readonly kind: "rejected"; readonly candidateName: string; readonly error: PreviewError };

  const acceptOne = (file: SelectedFile, origin: DatasetOrigin): Pending => {
    const existing = held.find((entry) => entry.file.handle === file.handle);
    if (existing !== undefined) {
      return { kind: "row", duplicate: true, item: existing.item };
    }
    if (held.length >= capacity) {
      return { kind: "rejected", candidateName: file.fileName, error: workspaceFullError() };
    }
    const entry = hold(file, origin);
    held = [...held, entry];
    return { kind: "row", duplicate: false, item: entry.item };
  };

  const addOne = (picked: PickedFile): Pending =>
    "rejected" in picked
      ? {
          kind: "rejected",
          candidateName: picked.rejected,
          error:
            picked.error ?? previewError({ kind: "unsupported_extension", retryable: false }),
        }
      : acceptOne(picked, null);

  const scanOne = (scanned: ScannedFile): Pending =>
    "rejected" in scanned
      ? {
          kind: "rejected",
          candidateName: scanned.rejected,
          error:
            scanned.error ?? previewError({ kind: "unsupported_extension", retryable: false }),
        }
      : acceptOne(scanned.file, scanned.parents ?? []);

  /** Says what each candidate did, once the whole batch is in the roster. */
  const describeAll = (pending: readonly Pending[]): WorkspaceAddOutcome[] => {
    const roster = snapshot();
    const byItem = new Map(held.map((entry, index) => [entry.item, roster.datasets[index]]));
    return pending.map((entry): WorkspaceAddOutcome => {
      if (entry.kind === "rejected") {
        return {
          outcome: "rejected",
          candidateName: entry.candidateName,
          error: entry.error,
        };
      }
      const dataset = byItem.get(entry.item);
      if (dataset === undefined) {
        throw new Error("the fake described an outcome for a row it does not hold");
      }
      return entry.duplicate
        ? { outcome: "duplicate", existing: dataset }
        : { outcome: "added", dataset };
    });
  };

  const fake: FakePreviewApi = {
    requestedSpectra,
    openedHandles,
    openCount: () => openCount,
    rosterReads: () => rosterReads,
    calls: () => [...calls],
    datasets,
    deliveredVerdicts,
    publishConversion,
    conversionRequests,
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
        // Every candidate first, then the roster they produced, and only then
        // what each one did. Snapshotting before the batch would answer with
        // the workspace as it was, and describing an outcome before the batch
        // ends would describe a row against a roster it is not in yet.
        const pending = picked.map(addOne);
        return { roster: snapshot(), outcomes: describeAll(pending) };
      }),
    chooseFolder: (onReserved) => {
      if (options.acknowledgeFolderReservation === undefined) {
        onReserved();
      } else {
        options.acknowledgeFolderReservation(onReserved);
      }
      if (options.folderResult !== undefined) {
        return options.folderResult();
      }
      return (
        typeof options.scannedFolder === "function"
          ? options.scannedFolder()
          : Promise.resolve(
              options.scannedFolder === undefined ? DEFAULT_FOLDER_SCAN : options.scannedFolder,
            )
      ).then((scan): FolderIngestionResult | null => {
        if (scan === null) {
          return null;
        }
        const pending = scan.files.map(scanOne);
        return {
          roster: snapshot(),
          outcomes: describeAll(pending),
          discovery: { ...COMPLETE_SCAN, ...scan.discovery },
        };
      });
    },
    removeDatasets: (handles) => {
      if (options.removeDatasets !== undefined) {
        return options.removeDatasets(handles);
      }
      const requested = [...new Set(handles)];
      const removedHandles = requested.filter((handle) =>
        held.some((entry) => entry.file.handle === handle),
      );
      const unknownHandles = requested.filter((handle) => !removedHandles.includes(handle));
      held = held.filter((entry) => !removedHandles.includes(entry.file.handle));
      return Promise.resolve({ roster: snapshot(), removedHandles, unknownHandles });
    },
    clearWorkspace: () => {
      if (options.clearWorkspace !== undefined) {
        return options.clearWorkspace();
      }
      held = [];
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
        file: datasets().find((dataset) => dataset.handle === handle) ?? preview.file,
      }));
    },
    loadSpectrum: (_handle, index) => {
      requestedSpectra.push(index);
      return options.spectrum === undefined
        ? Promise.resolve({ outcome: "spectrum", spectrum: buildSpectrum(index, 12) })
        : options.spectrum(index);
    },
    describeConversion: (handles) => {
      if (options.conversionPlan !== undefined) {
        return options.conversionPlan(handles);
      }
      const rows = handles.map((handle) =>
        snapshot().datasets.find((dataset) => dataset.handle === handle),
      );
      if (rows.some((row) => row === undefined)) {
        return Promise.reject(
          previewError({ kind: "unknown_file_handle", summary: "That file is no longer open." }),
        );
      }
      return Promise.resolve({
        items: rows.map((row) => ({
          datasetHandle: row!.handle,
          fileName: row!.fileName,
          outputFileName: row!.fileName.replace(/\.raw$/i, ".mzML"),
        })),
        outputFormat: "mzML",
        compression: "zlib",
        validationMode: "output_only",
        capacity: 16,
      });
    },
    getConversionState: () => Promise.resolve({ sequence: conversionSequence, state: conversion }),
    retryConversions: async () => {
      const settled = options.retry === undefined ? conversion : await options.retry(publishConversion);
      publishConversion(settled);
      return { sequence: conversionSequence, state: conversion };
    },
    convertDatasets: async (handles, conflictPolicy, onReserved) => {
      const request = { handles, conflictPolicy };
      conversionRequests.push(request);
      // Started before the reservation edge is announced, so a conversion that
      // publishes `running` has published it by the time the caller reads the
      // slot. Rust marks running inside the destination command for the same
      // reason: the read that follows the claim must find the state the claim
      // produced, not the one before it.
      const settling =
        options.conversion === undefined
          ? Promise.resolve(defaultConversion(request))
          : options.conversion(request, publishConversion);
      onReserved();
      const settled = await settling;
      publishConversion(settled);
      return { sequence: conversionSequence, state: conversion };
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
    "chooseFolder",
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
