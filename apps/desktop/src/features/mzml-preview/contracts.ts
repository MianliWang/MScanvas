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

/**
 * Which family Rust admitted a row as.
 *
 * Closed, and deliberately not general. There is no `vendorRaw`, no `raw` and
 * no `unknown`: one vendor family has measured conversion evidence, and a
 * member here is a claim the product understands the data behind it.
 */
export type DatasetSourceKind = "mzml" | "thermo_raw";

export interface SelectedFile {
  /** Opaque, session-scoped. Never a path. */
  readonly handle: string;
  readonly fileName: string;
  readonly byteLength: number;
  /**
   * Required on every row. The one decision that depends on it — whether a row
   * can be previewed at all — is not a decision to guess, so there is no
   * optional or unknown member to fall back to.
   *
   * Not identity, not searched, and not a sort key.
   */
  readonly sourceKind: DatasetSourceKind;
  /**
   * Where this row sits below the folder it was found in, and only when two or
   * more live rows share its final filename.
   *
   * `null` is the ordinary answer. Rust decides it over the whole roster every
   * time one is built, so it appears when a colliding row arrives and goes
   * again when that row leaves. It is display only: never searched, never a
   * sort key, and never part of a dataset's identity.
   *
   * Never a drive, a UNC prefix, an absolute path, `..`, or the chosen folder's
   * own name — the least that has to be said to tell identical names apart.
   */
  readonly relativeContext: string | null;
}

/**
 * Every dataset the session holds, in the order Rust holds them.
 *
 * The order is authoritative and is not re-derived here: the registry has one
 * order, and sorting or grouping a copy of it would be a second answer to the
 * same question.
 */
export interface WorkspaceRoster {
  readonly datasets: readonly SelectedFile[];
  /**
   * The session limit these rows are bounded by, counted in Rust.
   *
   * Carried with the roster so the interface states the limit that is actually
   * enforced rather than a number of its own.
   */
  readonly capacity: number;
}

/**
 * What one chosen file did. Reported per item and in picker order, because one
 * file that could not be read says nothing about the rest of a batch.
 */
export type WorkspaceAddOutcome =
  | { readonly outcome: "added"; readonly dataset: SelectedFile }
  | { readonly outcome: "duplicate"; readonly existing: SelectedFile }
  | {
      readonly outcome: "rejected";
      /** The final filename only. Never a path and never a folder. */
      readonly candidateName: string;
      readonly error: PreviewError;
    };

export interface WorkspaceAddResult {
  readonly roster: WorkspaceRoster;
  readonly outcomes: readonly WorkspaceAddOutcome[];
}

/** Which named traversal limit a folder scan reached. */
export type FolderScanLimit = "depth" | "entries" | "directories" | "candidates";

/**
 * How a folder scan itself went, as distinct from what it added.
 *
 * Deliberately not a count of what was inspected: how many entries a folder
 * holds and how many directories are under it describe the shape of the user's
 * tree, and pointing at a folder is not permission to report that. What is here
 * is what a reader needs in order to know whether the answer is the whole
 * answer.
 */
export interface FolderDiscoverySummary {
  /**
   * Whether everything under the chosen folder was described.
   *
   * One answer rather than three, so an incomplete scan cannot be reported as
   * complete by checking the wrong field. False whenever a limit was reached, a
   * linked entry was skipped, or a subtree could not be read.
   */
  readonly complete: boolean;
  /**
   * Entries refused for carrying a reparse tag: junctions, symbolic links,
   * mount points and cloud placeholders alike. MSCanvas follows none of them.
   */
  readonly skippedReparseCount: number;
  readonly inaccessibleEntryCount: number;
  readonly limitsReached: readonly FolderScanLimit[];
}

/** What one folder import did, per candidate and to the scan as a whole. */
export interface FolderIngestionResult {
  readonly roster: WorkspaceRoster;
  readonly outcomes: readonly WorkspaceAddOutcome[];
  readonly discovery: FolderDiscoverySummary;
}

/** Which bounded native-drop traversal limit was reached. */
export type DropScanLimit = "roots" | "depth" | "entries" | "directories" | "candidates";

/**
 * Path-free facts about one Explorer drop.
 *
 * Root and traversal failures stay aggregate-only. In particular, this shape
 * has nowhere for a root name or path to arrive. `workspaceWasEmpty` is the
 * native service's snapshot at the start of the accepted operation; the
 * frontend uses it only to decide whether one first-run preview may start.
 */
export interface DropIngestionSummary {
  readonly workspaceWasEmpty: boolean;
  readonly complete: boolean;
  readonly topLevelItemCount: number;
  readonly skippedReparseRootCount: number;
  readonly inaccessibleRootCount: number;
  readonly remoteRootCount: number;
  readonly unsupportedRootCount: number;
  readonly skippedReparseEntryCount: number;
  readonly inaccessibleEntryCount: number;
  readonly limitsReached: readonly DropScanLimit[];
}

/** What one accepted native Explorer drop did. */
export interface DropIngestionResult {
  readonly roster: WorkspaceRoster;
  readonly outcomes: readonly WorkspaceAddOutcome[];
  readonly summary: DropIngestionSummary;
}

/**
 * The closed, path-free state carried by the native drop Channel.
 *
 * `operationId` is an opaque decimal string rather than a JavaScript number,
 * so a native counter never crosses the safe-integer boundary.
 */
/**
 * Why one native drop was refused before any of its paths were retained.
 *
 * Two reasons, because the user does something different about each: another
 * drop finishes on its own, and a conversion is work they started.
 */
export type WorkspaceDropRejectionReason = "drop_busy" | "conversion_busy";

export type WorkspaceDropState =
  | { readonly status: "idle" }
  | { readonly status: "hovering"; readonly itemCount: number }
  | {
      readonly status: "importing";
      readonly operationId: string;
      readonly itemCount: number;
    }
  | {
      readonly status: "completed";
      readonly operationId: string;
      readonly result: DropIngestionResult;
    }
  | {
      readonly status: "failed";
      readonly operationId: string;
      readonly error: PreviewError;
    }
  | { readonly status: "rejected"; readonly reason: WorkspaceDropRejectionReason };

/** One monotonically sequenced native drop update. */
export interface WorkspaceDropUpdate {
  readonly sequence: number;
  readonly state: WorkspaceDropState;
}

export interface WorkspaceRemoveResult {
  readonly roster: WorkspaceRoster;
  readonly removedHandles: readonly string[];
  /**
   * Handles that named no row. An ordinary reconciliation outcome: the
   * interface asked about rows it believed it had, and this is the answer.
   */
  readonly unknownHandles: readonly string[];
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

/** The only output format this workflow produces. */
export type ConversionOutputFormat = "mzML";

/**
 * How a conversion output was judged.
 *
 * `output_only` means nothing was compared: the source has no mzML reading, so
 * only the output's own postconditions were established.
 */
export type ValidationMode = "source_comparison" | "output_only";

/**
 * What happens when the planned output name is already taken.
 *
 * Two members, and overwrite is not one of them.
 */
export type ConversionConflictPolicy = "fail" | "skip";

/** What was measured of a finalized output. */
export interface ConversionOutput {
  readonly byteLength: number;
  readonly sha256: string;
  readonly spectrumCount: number;
  readonly chromatogramCount: number;
}

/**
 * How a finalized output was judged, including what the judgement could not
 * reach.
 *
 * `inapplicable` is not a softer `unverified`: it names properties this source
 * posture has no reading of at all.
 */
export interface ConversionValidation {
  readonly mode: ValidationMode;
  readonly fullyVerified: boolean;
  readonly verified: readonly string[];
  readonly unverified: readonly string[];
  readonly inapplicable: readonly string[];
}

/** Bounded facts about the backend process. No raw output crosses. */
export interface ConversionBackendFacts {
  readonly exitCode: number | null;
  readonly elapsedMilliseconds: number;
}

/** What one conversion did, in facts that name no location. */
export interface ConversionReport {
  readonly datasetHandle: string;
  readonly sourceKind: DatasetSourceKind;
  readonly outcome: string;
  readonly detailedOutcome: string | null;
  readonly outputFileName: string | null;
  readonly output: ConversionOutput | null;
  readonly validation: ConversionValidation | null;
  readonly backend: ConversionBackendFacts | null;
  readonly stagingResidue: string | null;
  readonly installationGeneration: number;
}

/** Where one queue item is. */
export type ConversionQueueItemState =
  | "pending"
  | "running"
  | "finalized"
  | "skipped"
  | "failed"
  /** Stopped while running, with the owned process tree confirmed gone. */
  | "cancelled"
  /** A stopped queue never began it. Not a failure and not an attempt. */
  | "notRun"
  /** Stopped while running, and the termination could not be confirmed. */
  | "cancellationFailed";

/**
 * What a stop established about one attempt.
 *
 * Path-free like everything else on this wire: no process identifier, no job
 * handle, no staging location and no backend text.
 */
export interface ConversionCancellation {
  readonly processLaunched: boolean;
  readonly terminationRequested: boolean;
  /**
   * Whether MSCanvas knows no converter process of this attempt survives.
   *
   * True when the owned tree was observed empty, and true when no process was
   * created for there to be one. False is the whole reason
   * `cancellationFailed` exists.
   */
  readonly treeTerminationConfirmed: boolean;
  readonly elapsedMilliseconds: number;
  readonly termination: string | null;
  readonly partialOutputObserved: boolean;
  readonly stagingResidue: string | null;
}

/** One item of a queue. */
export interface ConversionQueueItem {
  readonly datasetHandle: string;
  readonly fileName: string;
  readonly sourceKind: DatasetSourceKind;
  /** Derived before the queue was created, so collisions are refused early. */
  readonly outputFileName: string;
  readonly state: ConversionQueueItemState;
  readonly attempts: number;
  readonly retryable: boolean;
  /** The latest attempt's report. Only the latest — never a history. */
  readonly report: ConversionReport | null;
  /** Why an attempt never reached a conversion at all. */
  readonly error: PreviewError | null;
  /**
   * What a stop established about this item's attempt.
   *
   * Present only for an item a stop actually reached. A `notRun` item has
   * none, because nothing ran for it to establish anything about.
   */
  readonly cancellation: ConversionCancellation | null;
}

/** One queue, in facts that name no location. */
export interface ConversionQueue {
  readonly items: readonly ConversionQueueItem[];
  /** Which item is running, or how many are done when none is. */
  readonly currentIndex: number;
  readonly itemCount: number;
  readonly retryRound: number;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly finalizedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly retryableFailedCount: number;
  readonly nonRetryableFailedCount: number;
  /** Items whose running conversion was stopped, tree confirmed gone. */
  readonly cancelledCount: number;
  /** Items a stopped queue never began. Not failures. */
  readonly notRunCount: number;
  /** Items whose stop could not be confirmed. */
  readonly cancellationFailedCount: number;
  /** A refusal that stopped the whole queue rather than one item. */
  readonly error: PreviewError | null;
  /**
   * Where the sequence of backend changes stood when this queue last resolved
   * one.
   *
   * Carried by the queue and not only by its items, because the pass that
   * matters most may produce no item at all: a queue refused for running on a
   * different installation resolved that installation first.
   */
  readonly installationGeneration: number;
}

/**
 * The session's one conversion slot.
 *
 * One queue, never a list of queues: `terminal` is replaced by the next queue
 * and never accumulated. A single-dataset conversion is a queue of one, so
 * there is one protocol rather than two.
 */
export type WorkspaceConversionState =
  | { readonly status: "idle" }
  | {
      readonly status: "awaitingDestination";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    }
  | {
      readonly status: "running";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    }
  /**
   * A stop was accepted and the queue has not settled yet.
   *
   * Its own status rather than a flag on `running`, because what a reader may
   * do differs: no further item will start, and the one that is running may
   * still finish naturally. Nothing here predicts which.
   */
  | {
      readonly status: "stopping";
      readonly operationId: string;
      readonly queue: ConversionQueue;
    }
  | {
      readonly status: "terminal";
      readonly operationId: string;
      /** Why this queue is over. A stopped queue is not retried in place. */
      readonly reason: ConversionQueueTerminalReason;
      readonly queue: ConversionQueue;
    };

/** Why a terminal queue is over. */
export type ConversionQueueTerminalReason =
  | "completed"
  /** Stopped, and no converter process of this application's survives. */
  | "stopped"
  /** Stopped, and MSCanvas could not confirm the process ended. */
  | "stopFailed";

/** One bounded read of that slot, with the key that orders two reads. */
/**
 * What one diagnostics export wrote.
 *
 * A name, a length and a digest. Deliberately not a location: the user chose
 * the folder and knows where it is, and this side is never told. The digest is
 * what makes the answer checkable by someone about to send the file on.
 */
export interface ConversionDiagnosticsExport {
  /** Which queue this describes, and which settling of it. */
  readonly operationId: string;
  readonly retryRound: number;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly diagnosticItemCount: number;
}

/**
 * What this document may know about saving diagnostics for the queue it reads.
 *
 * Rides on the conversion read for the reason the quarantine flag does: a
 * document already asks for that on mount and while work is under way, so a
 * reload recovers this with the queue rather than needing a second question.
 *
 * Nothing here is the diagnostics themselves. No excerpt, no document and no
 * path crosses this boundary — only whether one can be saved, how much it would
 * describe, whether one is being saved now, and what the last one wrote.
 */
export interface ConversionDiagnosticsState {
  /** How many items of the current queue an export would describe. */
  readonly eligibleItemCount: number;
  /**
   * Whether the queue is terminal and there is something to export.
   *
   * Carried rather than derived from the count: a stop-failed queue is
   * exportable for what the queue itself records even where no item carries a
   * diagnostic of its own.
   */
  readonly available: boolean;
  /** Whether an export is between being asked for and being finished. */
  readonly exporting: boolean;
  /**
   * The last export of the current queue. Dropped when the queue is replaced;
   * the file it names is not.
   */
  readonly lastExport: ConversionDiagnosticsExport | null;
}

export interface WorkspaceConversionUpdate {
  readonly sequence: number;
  readonly state: WorkspaceConversionState;
  /** What this document may know about saving diagnostics for that queue. */
  readonly diagnostics: ConversionDiagnosticsState;
  /**
   * Whether this session has stopped trusting the backend.
   *
   * Set by a stop whose termination could not be confirmed, and never cleared:
   * nothing in the session can establish that the process it lost track of has
   * ended.
   */
  readonly backendQuarantined: boolean;
}

/** One row of a queue plan. */
export interface ConversionQueuePlanItem {
  readonly datasetHandle: string;
  readonly fileName: string;
  readonly outputFileName: string;
}

/** What the interface shows before a queue is started. */
export interface ConversionQueuePlan {
  readonly items: readonly ConversionQueuePlanItem[];
  readonly outputFormat: ConversionOutputFormat;
  readonly compression: string;
  readonly validationMode: ValidationMode;
  /** The most items one queue may hold, as Rust enforces it. */
  readonly capacity: number;
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

/**
 * What one finalized output did when the user asked to adopt it.
 *
 * Closed and path-free. Every member names its queue item by facts this
 * document already has -- the item''s position and the row it was converted
 * from -- plus the output name the queue displayed throughout. Only the two
 * outcomes that have a workspace row carry one.
 */
export type WorkspaceOutputAdoptionOutcome =
  | {
      readonly kind: "added";
      readonly itemIndex: number;
      readonly sourceHandle: string;
      readonly outputFileName: string;
      readonly dataset: SelectedFile;
    }
  | {
      readonly kind: "alreadyInWorkspace";
      readonly itemIndex: number;
      readonly sourceHandle: string;
      readonly outputFileName: string;
      readonly dataset: SelectedFile;
    }
  | {
      readonly kind: "refused";
      readonly itemIndex: number;
      readonly sourceHandle: string;
      readonly outputFileName: string;
      /**
       * One of `output_missing`, `output_changed`, `output_unreadable`,
       * `output_not_mzml` or `workspace_full`. Stable, and never an OS error.
       */
      readonly reason: string;
    };

/** What adopting a terminal queue's finalized outputs did. */
export interface WorkspaceOutputAdoptionResult {
  /**
   * Which queue this describes, and which settling of it.
   *
   * Both, because neither alone identifies the result. A retry settles the same
   * operation a second time and can finish between two reads, so holding this
   * beside a queue means checking the round as well as the identifier.
   */
  readonly operationId: string;
  readonly retryRound: number;
  /** Authoritative and whole, like every other workspace answer. */
  readonly roster: WorkspaceRoster;
  /** In queue order, one per finalized output the queue held. */
  readonly outcomes: readonly WorkspaceOutputAdoptionOutcome[];
}