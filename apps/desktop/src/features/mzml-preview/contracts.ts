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
 * no `unknown`: a member here is a claim the product understands the data
 * behind it, backed by measured conversion evidence.
 *
 * All four are product-reachable since ADR 0027: `Add files…` admits them and
 * the three vendor families convert through the one queue. Folder ingestion and
 * the Explorer drop remain regular-mzML-only, for every vendor family and for
 * `sciex_wiff` most of all -- a `.wiff` is half an acquisition, and pairing it
 * with a neighbour a traversal happened to find is a decision no walk has the
 * evidence to make.
 *
 * `sciex_wiff` names a bundle: a `.wiff` primary and the `.wiff.scan` beside
 * it, admitted together as one row. The companion is never a row of its own.
 */
export type DatasetSourceKind =
  | "mzml"
  | "thermo_raw"
  | "shimadzu_lcd"
  | "sciex_wiff";

/**
 * The exact visible name of each family.
 *
 * One record for the roster, the queue plan and every other surface, so the
 * product cannot call one family two things. The vendor names are precise on
 * purpose: what is supported is these two evidenced families, not "vendor RAW".
 */
export const SOURCE_KIND_LABEL: Record<DatasetSourceKind, string> = {
  mzml: "mzML",
  thermo_raw: "Thermo RAW",
  shimadzu_lcd: "Shimadzu LabSolutions LCD",
  sciex_wiff: "SCIEX WIFF",
};

/**
 * Whether the visible queue converts rows of this family.
 *
 * The one frontend projection of Rust's own `is_convertible`, used by every
 * surface that filters or gates on convertibility so none of them can answer
 * differently. Rust remains authoritative: a stale or hand-crafted state that
 * disagreed would still be refused by the boundary itself.
 */
export function isConvertibleSourceKind(kind: DatasetSourceKind): boolean {
  return (
    kind === "thermo_raw" || kind === "shimadzu_lcd" || kind === "sciex_wiff"
  );
}

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
  /**
   * The opaque name of the chromatogram this run may be exported as.
   *
   * `null` where there is none, which is exactly where the viewer draws none: a
   * table this session could not transfer whole, a run with no spectra, a
   * retention time or an intensity that is not a finite number, or a unit this
   * build cannot name. Rust retains every row the backend reported while this
   * document receives a bounded prefix, so a token is issued only for a run the
   * viewer itself would draw.
   *
   * Opaque, session-scoped, and meaningless to anything that did not receive it
   * from Rust. Not a path, not a dataset handle, not an index — and never a
   * reason for this side to believe it holds the science.
   */
  readonly chromatogramExportToken: string | null;
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
  /**
   * Which retained spectrum an export of this panel would write.
   *
   * Opaque and session-scoped. It names the complete spectrum Rust kept, which
   * is deliberately not the arrays beside it: `mz` and `intensity` are bounded
   * for transfer and `truncated` says when that bound was reached, so they are
   * a drawing rather than the measurement. An export sends this token and
   * nothing else, so what reaches the file cannot be what reached the browser.
   */
  readonly exportToken: string;
}

/**
 * What one selected-spectrum export did.
 *
 * `cancelled` is an outcome rather than an error: the save dialog was shown and
 * closed, nothing was created, and the spectrum on screen is exactly as it was.
 * A saved export names the file it wrote and never the folder it went into.
 */
export type SpectrumExportOutcome =
  | { readonly status: "cancelled" }
  | {
      readonly status: "saved";
      readonly format: SpectrumExportFormat;
      readonly fileName: string;
      /**
       * What the figure was rendered as, for the formats that are figures.
       *
       * `null` for the data documents. A size, a resolution and a theme are
       * properties of a drawing, and the same measurement comes out of CSV and
       * TSV whatever the figure is being drawn at.
       */
      readonly figure: ExportedFigure | null;
      /** How many source points the document carries. */
      readonly pointCount: number;
    };

/**
 * What a figure put on the clipboard was.
 *
 * A size and a theme, and **no resolution**. The clipboard receives RGBA, a
 * width and a height; there is no `pHYs` chunk and nowhere for one, so a field
 * for a DPI here would be a field describing a property the artifact does not
 * have. Its own type rather than {@link ExportedFigure} with a `null` in it,
 * because a shape that cannot express the false claim is better than one that
 * merely does not make it today.
 */
export interface CopiedFigure {
  readonly width: number;
  readonly height: number;
  readonly theme: FigureTheme;
}

/** What a figure output was rendered as, reported back rather than assumed. */
export interface ExportedFigure {
  readonly width: number;
  readonly height: number;
  /**
   * The physical resolution recorded in the file, for the formats that record
   * one. `null` for SVG, which has no pixels to describe.
   */
  readonly dpi: number | null;
  readonly theme: FigureTheme;
}

/** The four documents one selected spectrum can be exported as. */
export type SpectrumExportFormat = "svg" | "png" | "csv" | "tsv";

/** The figure's own theme, which is not the application's. */
export type FigureTheme = "light" | "dark";

/**
 * What a figure export is rendered with.
 *
 * Width and height are the final dimensions: an SVG is authored at exactly
 * these figure units and a PNG contains exactly this many pixels. DPI is
 * physical-resolution metadata and multiplies nothing -- it tells whatever
 * opens the PNG how large the image is meant to be on paper, and it reaches
 * neither the SVG nor the data documents.
 */
export interface FigureSettings {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pngDpi: number;
  readonly theme: FigureTheme;
}

/** Which document a chromatogram export writes. */
export type ChromatogramExportFormat = "svg" | "png" | "csv" | "tsv";

/**
 * How much of the run an export covers.
 *
 * `full` needs no range at all: Rust resolves it from the run it retained.
 * `current` carries the viewer's **committed** domain, and nothing else — not
 * the range a wheel or a drag is transiently showing, not the SVG viewBox, not
 * an axis tick and not a pointer position.
 */
export type ChromatogramRangeScope = "full" | "current";

export interface ChromatogramRange {
  readonly scope: ChromatogramRangeScope;
  /**
   * The committed viewport, where there is one.
   *
   * `null` is not a missing answer: it is the viewer saying it has committed no
   * narrower range, so the current range *is* the whole run. Rust resolves that
   * rather than this side inventing a subrange to make the option look
   * different.
   */
  readonly low: number | null;
  readonly high: number | null;
}

/**
 * Which measured traces a chromatogram figure draws.
 *
 * The figure shows what is on screen. A data export carries both columns
 * whatever this says, because hiding a trace is a choice about a plot rather
 * than a decision to leave measured science out of a file.
 */
export interface ChromatogramTraceSet {
  readonly tic: boolean;
  readonly bpc: boolean;
}

export type ChromatogramExportOutcome =
  | { readonly status: "cancelled" }
  | {
      readonly status: "saved";
      readonly format: ChromatogramExportFormat;
      readonly fileName: string;
      /** What the figure was rendered as. `null` for the data documents. */
      readonly figure: ExportedFigure | null;
      /** The traces the figure drew. `null` for the data documents. */
      readonly traces: ChromatogramTraceSet | null;
      /** `full` or `current`, as asked for rather than as it resolved. */
      readonly rangeScope: ChromatogramRangeScope;
      readonly rangeLow: number;
      readonly rangeHigh: number;
      /** How many scans the run holds, counted by Rust rather than here. */
      readonly sourceScanCount: number;
      /**
       * How many source scans the data document carries. `null` for a figure.
       *
       * Zero is a successful export. A range can legitimately contain no scans
       * while the figure still draws the segment crossing it, because that line
       * is geometry the source asserts between its own samples and is not one.
       */
      readonly rowCount: number | null;
    };

/** What a chromatogram figure put on the clipboard was. */
/** What a linked two-panel figure can be written as. Drawings only. */
export type LinkedFigureFormat = "svg" | "png";

/**
 * What one linked figure export did.
 *
 * Path-free like every export outcome, and it names the pair it drew: the
 * chromatogram's scope and resolved range, the traces on screen, and the
 * selected spectrum by index and retention time. Those last two are the link.
 */
export type LinkedFigureExportOutcome =
  | { readonly status: "cancelled" }
  | {
      readonly status: "saved";
      readonly format: LinkedFigureFormat;
      readonly fileName: string;
      readonly figure: ExportedFigure;
      readonly traces: ChromatogramTraceSet;
      readonly rangeScope: ChromatogramRangeScope;
      readonly rangeLow: number;
      readonly rangeHigh: number;
      readonly sourceScanCount: number;
      readonly selectedIndex: number;
      /** From the retained table row, never from anything drawn on screen. */
      readonly selectedRetentionTime: number;
    };

/** What a linked figure put on the clipboard was. */
export interface LinkedFigureCopyOutcome {
  readonly status: "copied";
  readonly figure: CopiedFigure;
  readonly traces: ChromatogramTraceSet;
  readonly rangeScope: ChromatogramRangeScope;
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly sourceScanCount: number;
  readonly selectedIndex: number;
  readonly selectedRetentionTime: number;
}

export interface ChromatogramCopyOutcome {
  readonly status: "copied";
  readonly figure: CopiedFigure;
  readonly traces: ChromatogramTraceSet;
  readonly rangeScope: ChromatogramRangeScope;
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly sourceScanCount: number;
}

/**
 * Copying the plot either put an image on the clipboard or it did not.
 *
 * There is no cancelled case: no dialog is shown, because nothing is being
 * named or saved. A failure arrives as a typed refusal rather than as an
 * outcome.
 */
export interface SpectrumCopyOutcome {
  readonly status: "copied";
  readonly figure: CopiedFigure;
  /** How many source points the copied figure was drawn from. */
  readonly pointCount: number;
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

/**
 * What one queue item's outputs will look like, before it runs.
 *
 * Two named cases rather than a nullable name, because the alternative has no
 * honest value for a set: an empty string is not a filename, and a name derived
 * from the acquisition would be one MSCanvas invented for a document the
 * backend has not written. A renderer must choose an arm, so a blank output
 * column is unrepresentable rather than merely avoided.
 */
export type ConversionOutputPlan =
  | {
      readonly kind: "knownSingle";
      /** Derived before the queue was created, so collisions are refused early. */
      readonly fileName: string;
    }
  | {
      readonly kind: "backendNamedSet";
      /** The lifecycle's own bound. Never a prediction of how many there will be. */
      readonly maxMembers: number;
    };

/**
 * Whether every sample the SCIEX reader identified produced its output.
 *
 * Deliberately not a boolean and deliberately narrow. `established` is a
 * statement about the samples the reader identified — not about the samples in
 * the acquisition, and not about how faithfully any document represents one.
 */
export type ConversionSampleCompleteness =
  | { readonly kind: "notPosed" }
  | { readonly kind: "notEstablished"; readonly reason: string }
  | {
      readonly kind: "established";
      /** The audit's stable identifier. */
      readonly method: string;
      /** How many samples the reader identified and converted. */
      readonly sampleCount: number;
    };

/** Where a non-atomic publication stopped. */
export interface ConversionPartialFinalization {
  readonly finalizedCount: number;
  readonly notPublishedCount: number;
  /** The filesystem's own kind, by stable identifier. Never an OS message. */
  readonly failureKind: string;
}

/**
 * What one backend-named set's attempt did.
 *
 * Counts, stable identifiers and the basenames the backend chose. Bounded by
 * `maxMembers`, path-free, and never a claim about the acquisition beyond what
 * `completeness` states.
 */
export interface ConversionOutputSetReport {
  readonly datasetHandle: string;
  readonly sourceKind: DatasetSourceKind;
  /** What the run did to the set as a whole, by Rust's own identifier. */
  readonly groupOutcome: string;
  /** The precise refusal, when the set was refused before publishing. */
  readonly detailedOutcome: string | null;
  readonly maxMembers: number;
  readonly memberCount: number;
  readonly finalizedCount: number;
  readonly validatedNotPublishedCount: number;
  readonly notPublishedCount: number;
  /** `null` where the acquisition was never bound — not zero, which is a claim. */
  readonly boundSourceObjects: number | null;
  /** Basenames in publication order. Never a directory, never a path. */
  readonly memberFileNames: readonly string[];
  /** How each member ended, positionally matched to `memberFileNames`. */
  readonly memberStates: readonly string[];
  readonly backend: ConversionBackendFacts | null;
  readonly stagingResidue: string | null;
  readonly validationMode: ValidationMode;
  readonly completeness: ConversionSampleCompleteness;
  readonly partial: ConversionPartialFinalization | null;
  /**
   * Whether a complete output-set adoption authority exists for this item.
   *
   * Carried rather than derived from the outcome: a fully finalized set whose
   * completeness was not established has none, and an interface deriving one
   * from the other would offer an action Rust will refuse.
   */
  readonly completeSetAdoptable: boolean;
  readonly installationGeneration: number;
}

/**
 * The latest attempt's result, in the cardinality it actually had.
 *
 * `null` means only that no attempt result exists. An item never carries a
 * single report and a group report at once, and this is what makes that
 * unrepresentable rather than a rule two nullable fields would have to keep.
 */
export type ConversionAttemptResult =
  | { readonly kind: "single"; readonly report: ConversionReport }
  | { readonly kind: "outputSet"; readonly report: ConversionOutputSetReport };

/** One item of a queue. */
export interface ConversionQueueItem {
  readonly datasetHandle: string;
  readonly fileName: string;
  readonly sourceKind: DatasetSourceKind;
  /** What this item will produce, in the cardinality it will produce it. */
  readonly output: ConversionOutputPlan;
  readonly state: ConversionQueueItemState;
  readonly attempts: number;
  readonly retryable: boolean;
  /** The latest attempt's result. Only the latest — never a history. */
  readonly result: ConversionAttemptResult | null;
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
  /**
   * How many output **files** a complete-set adoption would offer.
   *
   * Counted by Rust from the authorities it holds, because that is the only
   * place the answer lives: one finalized Thermo item offers one, one finalized
   * ten-member SCIEX item offers ten. Zero unless the queue is terminal.
   */
  readonly adoptableOutputCount: number;
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
  /**
   * The family this row was admitted as, snapshotted into the plan. Read from
   * here rather than rediscovered from the live roster, so the plan shown is
   * the immutable one the queue will run.
   */
  readonly sourceKind: DatasetSourceKind;
  /** What this row will produce, in the cardinality it will produce it. */
  readonly output: ConversionOutputPlan;
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

/**
 * Whether one queue item's latest attempt actually judged an output.
 *
 * The predicate behind every "output-only validation" claim, written once
 * because two surfaces make that claim and a disclosure they disagreed about
 * would be a check one of them said ran and the other said did not.
 *
 * "Produced a report" is deliberately not the test. A set refused before its
 * outputs were discovered still reports — with no members, nothing finalized
 * and nothing validated — and a queue of those judged nothing at all. A skipped
 * item's existing file was explicitly not inspected, and claiming output-only
 * validation over either would claim a check nobody ran.
 */
export function conversionJudgedAnyOutput(item: ConversionQueueItem): boolean {
  const result = item.result;
  if (result === null || result === undefined) {
    return false;
  }
  if (result.kind === "single") {
    return result.report.validation !== null;
  }
  return (
    result.report.finalizedCount > 0 || result.report.validatedNotPublishedCount > 0
  );
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
      readonly memberIndex: number;
      readonly sourceHandle: string;
      readonly outputFileName: string;
      readonly dataset: SelectedFile;
    }
  | {
      readonly kind: "alreadyInWorkspace";
      readonly itemIndex: number;
      readonly memberIndex: number;
      readonly sourceHandle: string;
      readonly outputFileName: string;
      readonly dataset: SelectedFile;
    }
  | {
      readonly kind: "refused";
      readonly itemIndex: number;
      readonly memberIndex: number;
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
  /**
   * One per output file the queue held, ordered by queue item and then by
   * publication order within one item's set.
   *
   * An item index alone stopped identifying an outcome the moment one item
   * could hold ten of them, so each carries `memberIndex` as well. For a known
   * single output that is zero — a real position, since such an item has
   * exactly one member and it is the first.
   */
  readonly outcomes: readonly WorkspaceOutputAdoptionOutcome[];
}