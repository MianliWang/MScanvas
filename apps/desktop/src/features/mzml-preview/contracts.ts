/**
 * One answer from an operation that looks at the backend, and the authority it
 * left behind.
 *
 * Recording an observation is only half of it: an observation recorded and not
 * delivered leaves the session correct in Rust and stale on screen. Every
 * operation that can observe or replace the binding answers in this shape.
 *
 * The two are judged by different rules and neither by the other's — the
 * projection by revision, which orders; the outcome by whatever question the
 * request was asking.
 */
export interface AuthorityObserved<T> {
  readonly authority: BackendAuthorityProjection;
  readonly outcome: T;
}

/** Which installation a fact is about.
 *
 * Opaque. Equality is the only operation permitted on it: it answers *is this
 * the binding you are rendering*, and nothing else. Nothing here may subtract
 * two of these, order them, or assume the next one is one greater — that is the
 * arithmetic the counter this replaced invited, and every reader supplied its
 * own meaning for it.
 */
export type BackendBindingReceipt = number;

/** Whether MSCanvas is bound to an installation it may launch. */
export type BackendBinding = "installed" | "noInstallation";

/** Whether preview may run on the bound build. */
export type BackendPreviewAvailability = "usable" | "unusable";

/**
 * Whether a verdict about the bound installation exists at all.
 *
 * `unresolved` is a real state every session opens in, and it carries no
 * receipt. Nothing may invent one for it.
 */
export type BackendAuthorityState =
  | { readonly state: "unresolved" }
  | {
      readonly state: "settled";
      readonly receipt: BackendBindingReceipt;
      readonly binding: BackendBinding;
      readonly previewAvailability: BackendPreviewAvailability;
    };

/**
 * What every backend-observing response carries beside its own outcome.
 *
 * `revision` is ordering and nothing else: a projection with a lower revision
 * is stale and may not replace a higher one. Identity is `receipt`, and the two
 * are separate because a receipt can say that two things differ and cannot say
 * which of them is newer.
 */
export interface BackendAuthorityProjection {
  readonly revision: number;
  readonly state: BackendAuthorityState;
}

/**
 * The vocabulary of each conversion dimension, as Rust spells it.
 *
 * Closed unions rather than strings, so a value this side has no rendering for
 * cannot be represented at all. They are the crate's own stable identifiers,
 * and a Rust test holds this file to them: a dimension that grows a variant
 * fails there rather than arriving as an unlabelled control.
 *
 * Listing the *members* of a dimension is not listing the *combinations* of
 * them. A free cross-product of these is forty-eight; nine were measured, and
 * which nine is a question only the catalog answers.
 */
/**
 * The one format the admitted table names, as an intent spells it.
 *
 * Deliberately not `ConversionOutputFormat`, which is the same format as an
 * *output* names it. The two are the same value seen from either end of the
 * conversion and they are spelled differently at the boundary, so one type
 * standing for both would have to pick a spelling and misdescribe the other.
 */
export type ConversionIntentFormat = "mzml";
export type ConversionProcessing = "no_additional_centroiding" | "unscoped_default_centroiding";
export type ConversionSpectrumPopulation = "all" | "ms1_only" | "ms2_only";
export type ConversionNumericPrecision =
  | "mz64_intensity32"
  | "mz64_intensity64"
  | "mz32_intensity32"
  | "mz32_intensity64";
export type ConversionCompression = "zlib" | "none";

/**
 * One admitted conversion combination, named by its five axes.
 *
 * `id` is what this side compares and echoes back; the five axis fields are
 * what it renders. Both come from one value in Rust, so a control cannot
 * describe one combination while selecting another.
 */
export interface ConversionIntentDescriptor {
  readonly id: string;
  readonly format: ConversionIntentFormat;
  readonly processing: ConversionProcessing;
  readonly population: ConversionSpectrumPopulation;
  readonly precision: ConversionNumericPrecision;
  readonly compression: ConversionCompression;
}

/**
 * One row of the admitted table, and whether the bound installation can run it.
 *
 * Availability belongs to the row. There is deliberately no per-axis-value
 * availability in this contract: a build lacking only the peak-picking grammar
 * must not be able to tell a reader it does not offer 64-bit intensity, all
 * spectra, or zlib.
 *
 * A combination with no row at all is a different statement — *not qualified*,
 * about the product's evidence rather than about this build — and it is read as
 * the absence of a row, never as `available: false`.
 */
/**
 * Why one admitted combination is not offered, where it is not.
 *
 * Two refusals rather than one, because they are different facts and lead to
 * different sentences. `unsupported_by_installation` is about this build: a
 * different ProteoWizard release can change it. `not_evidenced_for_conversion_sources`
 * is about the product'''s evidence: the combination is one MSCanvas measured, and
 * the measurement was not taken on the kinds of acquisition this workflow
 * converts. Peak picking is the axis that reaches, because the picker is chosen
 * by the reader rather than by the writer.
 */
export type ConversionRowAvailability =
  | "available"
  | "unsupported_by_installation"
  | "not_evidenced_for_conversion_sources";

export interface ConversionCatalogRow {
  readonly intent: ConversionIntentDescriptor;
  readonly available: boolean;
  /** Which of the three answers this row got. */
  readonly availability: ConversionRowAvailability;
}

/**
 * What is known about conversion settings for the binding the snapshot's
 * authority names.
 *
 * Carries no copy of that binding's identity. There is one receipt per
 * snapshot, in the authority, and this describes the binding it identifies —
 * two copies with no stated equality would make one build's authority beside
 * another build's catalog representable.
 *
 * This side never derives which of these is true. `unattempted` in particular
 * is read from a snapshot; holding no snapshot is an observation about this
 * side, not a judgement about the configuration.
 */
export type ConversionConfiguration =
  | { readonly configuration: "unavailableForBinding" }
  | { readonly configuration: "unattempted" }
  | {
      readonly configuration: "ready";
      readonly catalog: readonly ConversionCatalogRow[];
      /** The identity of the combination MSCanvas ships. */
      readonly shipped: string;
    }
  | { readonly configuration: "failed"; readonly error: PreviewError };

/**
 * What became of one configuration request.
 *
 * Separate from the configuration itself, because a refused read carries both:
 * the refusal is bookkeeping for this side's obligation, and the configuration
 * beside it is the news for the panel.
 *
 * `backendQuarantined` never clears. `backendBusy` is transient: no attempt was
 * spent, so the read is still owed and is re-issued on the next occasion.
 */
export type ConversionConfigurationOutcome =
  | { readonly outcome: "answered" }
  | {
      readonly outcome: "refused";
      readonly reason: "backendQuarantined" | "backendBusy";
    };

/**
 * One conversion-settings snapshot, as one response.
 *
 * The whole answer to one question: what conversion semantics are known for the
 * installation MSCanvas is currently bound to. Nothing here joins a receipt
 * from one response with a catalog from another — that join is what made a
 * stale catalog installable, and what made a plan and a catalog disagree about
 * a number neither of them still described.
 */
export interface ConversionConfigurationSnapshot {
  readonly authority: BackendAuthorityProjection;
  readonly configuration: ConversionConfiguration;
  readonly outcome: ConversionConfigurationOutcome;
}

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
   * The authority this reading was taken at.
   *
   * Not necessarily the session's now. A quarantined session echoes the reading
   * it already had rather than probing again, and this describes the binding
   * that reading was taken of — so the origin and the build beside it are read
   * under the right binding rather than under whichever one is current.
   *
   * A rendered reading whose revision is no longer the authority's is
   * superseded *entire*. The release, the build date and the origin describe a
   * build as much as the verdict does, and marking only the verdict stale would
   * leave the installation the session has left named as the current one.
   */
  readonly authority: BackendAuthorityProjection;
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
   * The authority as this open left it.
   *
   * An open is a look at the backend and can be the first thing to notice a
   * change, so it can settle a new binding itself. Adopting it is what stops a
   * later projection's higher revision reading as a change that happened after
   * this preview — which would discard the very reading that caused it.
   *
   * The receipt of the build that produced this preview is read from here, and
   * is not carried beside it: one hold of the backend lane produced both.
   */
  readonly authority: BackendAuthorityProjection;
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

/**
 * Whether a viewport domain could be established for a spectrum, and what it is.
 *
 * Tagged rather than a nullable pair, so a refusal is a state this side has to
 * handle rather than a sentinel it could mistake for a range.
 */
export type SpectrumViewportDomain =
  | { readonly state: "admitted"; readonly low: number; readonly high: number }
  | { readonly state: "refused"; readonly reason: SpectrumDomainRefusal };

/** Why a spectrum has no viewport domain. */
export type SpectrumDomainRefusal =
  /** The m/z array is not non-decreasing. mzML permits this; nothing sorts it. */
  | "sourceNotOrdered"
  /** A coordinate cannot be placed on an axis. */
  | "notFinite"
  /** The two arrays disagree about how many points there are. */
  | "axisLengthMismatch"
  /** The m/z endpoints do not form an interval the contract accepts. */
  | "domainUnusable"
  /**
   * The intensity axis does not form an interval the contract accepts.
   *
   * Coordinate validity alone is not drawability: finite values can still span
   * a width no renderer can divide by. Named apart so this is never reported as
   * unordered or non-finite data.
   */
  | "valueDomainUnusable";

/**
 * One bounded drawing of one committed m/z window.
 *
 * A screen representation and nothing more. Every value came out of the
 * complete spectrum Rust retained, `sourcePoints` says how many observations
 * the window actually holds, and `reduced` says whether fewer are drawn than
 * were measured -- so a reader can see both numbers rather than take the
 * drawing for the measurement.
 *
 * **Never an export source.** Scientific export is a sibling projection of the
 * same retained spectrum, taken from the complete arrays in Rust. Nothing in
 * this type may reach a file.
 */
export interface SpectrumProjection {
  /**
   * The window this drawing answers, echoed back.
   *
   * Not decoration: it is how a late answer is told from the window the
   * viewport is committed to now.
   */
  readonly low: number;
  readonly high: number;
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
  /** How many source observations the window holds. Zero is a real answer. */
  readonly sourcePoints: number;
  /** Whether fewer points are drawn than the window measured. */
  readonly reduced: boolean;
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
   * Whether this spectrum has an m/z domain a viewport may navigate.
   *
   * Rust's answer, taken from the complete spectrum it retained and decided by
   * the same admissibility the scientific figure uses. This side cannot work it
   * out for itself and must not try: `mz` and `intensity` are bounded for
   * transfer, `mzLow`/`mzHigh` are the backend's separately reported pair which
   * the export renderer refuses as a domain, and neither settles the question
   * for a spectrum whose arrays arrived truncated.
   *
   * A refusal is a fact about drawability rather than about the source. Such a
   * spectrum is still valid data and still exports as CSV and TSV.
   */
  readonly viewportDomain: SpectrumViewportDomain;
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
  | ({
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
    } & ExportedSpectrumRange);

/**
 * The range one finished spectrum export was taken over.
 *
 * Reported by Rust from the range it resolved when the export **began**, which
 * is what lets a confirmation stay true after the viewport has moved. A message
 * built from live viewport state instead would be describing a window the file
 * may not hold.
 *
 * Shared by the saved and copied outcomes because it is the same claim about
 * the same decision, and two copies of it could drift.
 */
export interface ExportedSpectrumRange {
  /**
   * `full` or `current`, as asked for rather than as it resolved.
   *
   * A current-range export of a viewport that had committed nothing narrower
   * covers the whole spectrum and is still a current-range export.
   */
  readonly rangeScope: SpectrumRangeScope;
  /**
   * The exact m/z bounds the export covered, for a current range.
   *
   * `null` for a full-source export, which has no window: an absent pair rather
   * than the spectrum's own bounds, because a full export is not a window that
   * happens to be wide.
   */
  readonly rangeLow: number | null;
  readonly rangeHigh: number | null;
  /** How many points the retained spectrum holds. */
  readonly sourcePointCount: number;
  /**
   * How many of them this export covered.
   *
   * Equal to `sourcePointCount` for a full export; smaller, possibly zero, for
   * a range. Zero is a successful export rather than a failure.
   */
  readonly exportedPointCount: number;
}

/**
 * How much of a spectrum an export covers.
 *
 * `full` needs no range at all: Rust resolves it from the spectrum it retained,
 * and it is the scope that works for every spectrum -- including one whose
 * figure contract refuses it a viewport, because a data document needs no
 * ordering to write.
 *
 * `current` carries the viewport's **committed** m/z window, and nothing else —
 * not the range a wheel or a drag is transiently showing, not the SVG viewBox,
 * not an axis tick, not a pointer position, and not the bounded projection the
 * screen was given to draw.
 */
export type SpectrumRangeScope = "full" | "current";

/**
 * Whether a selected spectrum has a range to export over, and if not, why.
 *
 * Two absences, kept apart because only one of them is a refusal. A spectrum
 * with no peaks has an admitted domain that is zero wide — there is nothing to
 * navigate, which is why no viewport is published for it, and nothing about the
 * figure contract declined anything. A spectrum whose m/z the contract cannot
 * accept without altering it is the one that was refused.
 *
 * Reporting the two identically would make the interface state a verdict Rust
 * never reached.
 */
export type SpectrumRangeAvailability = "available" | "noPeaks" | "noViewport";

/**
 * One spectrum range request, as this side sends it.
 *
 * Its own type rather than {@link ChromatogramRange}. The two carry the same
 * three fields about two different axes, and one shape shared between them
 * would make handing a retention-time range to a spectrum export a thing that
 * compiles. Rust keeps the two apart for the same reason.
 *
 * The numbers are plain `number`s at this boundary, deliberately. An
 * {@link MzDomain} is branded so it cannot be confused with a retention-time
 * pair *inside* the viewport's arithmetic; serialising one would need a cast
 * around that brand, so the request is built by reading `low` and `high` off a
 * committed domain rather than by asserting the domain into a wire shape.
 */
export interface SpectrumRange {
  readonly scope: SpectrumRangeScope;
  /**
   * The committed window, where there is one.
   *
   * `null` is not a missing answer: it is the viewport saying it has committed
   * no narrower window, so the current range *is* the whole admitted domain.
   * Rust resolves that from the retained spectrum rather than this side
   * inventing a subrange to make the option look different.
   */
  readonly low: number | null;
  readonly high: number | null;
}

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

/** What a chromatogram figure put on the clipboard was. */
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
export type SpectrumCopyOutcome = {
  readonly status: "copied";
  readonly figure: CopiedFigure;
} & ExportedSpectrumRange;

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
  /**
   * Recorded differences that fail nothing.
   *
   * A fourth list and not a fourth disposition. Each is a difference the
   * measured evidence already shows a faithful run can legitimately produce,
   * so folding them into `unverified` would report expected behaviour as an
   * unanswered question.
   */
  readonly advisory: readonly string[];
}

/**
 * What one attempt established about its private staging area.
 *
 * The second of the five judgements, and the one nothing else answers. A clean
 * teardown reports no residue whether the directory held a half-written
 * document or nothing at all; the destination says only what was published;
 * exit status says neither.
 *
 * Four arms, because "empty" is not one answer. Never created, could not be
 * read, and read and found empty are three different facts.
 */
export type ConversionStagedOutput =
  /**
   * No staging area was available to observe: the converter was never given
   * anywhere to write, whether because none was made or because one was made
   * and torn down before anything was invoked.
   */
  | { readonly kind: "notCreated" }
  /** It existed and could not be read. Unknown, and never empty. */
  | { readonly kind: "unobserved"; readonly phase: string }
  | {
      readonly kind: "observed";
      /** When the read was taken. An empty snapshot is empty at that moment. */
      readonly phase: string;
      readonly entryCount: number;
      readonly directoryCount: number;
      /**
       * Whether any ordinary staged file held bytes then. Zero-byte files and
       * entries that are neither a file nor a directory are counted in
       * `entryCount` and are deliberately not called output documents.
       */
      readonly nonEmptyFileObserved: boolean;
      /**
       * Whether the enumeration stopped at its bound, so the counts are lower
       * bounds rather than totals.
       *
       * `directoryCount` and `nonEmptyFileObserved` are zero and false there
       * because nothing was classified, not because nothing of that kind was
       * present.
       */
      readonly bounded: boolean;
    }
  /** The staged output took its final name. Not an observation. */
  | { readonly kind: "published" };

/**
 * What the execution boundary established about one attempt's own process.
 *
 * Read from the boundary rather than from whether backend facts came back: a
 * run whose streams could not be captured reports none and may well have
 * created a process.
 */
export type ConversionProcessOutcome =
  /** The attempt settled before the provider was invoked at all. */
  | { readonly kind: "notAttempted" }
  /** It was invoked, and what became of the process could not be established. */
  | { readonly kind: "indeterminate" }
  | {
      readonly kind: "settled";
      readonly termination: string;
      readonly exitCode: number | null;
    };

/**
 * What an adoption did with one item's finalized outputs.
 *
 * Historical, and about this settling of this queue: it says what an adoption
 * did, not what the workspace holds now. Removing a row afterwards leaves this
 * unchanged, because removing a row deletes no file and undoes no past process
 * outcome.
 */
export type ConversionItemAdoption =
  /** Nobody has asked yet, which is not the same as having been refused. */
  | { readonly kind: "notRequested" }
  /** This item holds no finalized output an adoption could offer. */
  | { readonly kind: "nothingToAdopt" }
  | {
      readonly kind: "settled";
      readonly added: number;
      readonly alreadyInWorkspace: number;
      readonly refused: number;
      /** Why each refusal happened, by stable identifier, in offer order. */
      readonly refusals: readonly string[];
    };

/**
 * One output of a backend-named set, with what was established about it.
 *
 * One entry per member rather than parallel arrays of names and states, so a
 * member cannot acquire another member's digest by an off-by-one. `output` and
 * `validation` are present exactly for a member that was validated.
 */
export interface ConversionOutputMember {
  readonly fileName: string;
  readonly state: string;
  readonly output: ConversionOutput | null;
  readonly validation: ConversionValidation | null;
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
  /**
   * The judgement this item's source posture is read under.
   *
   * Stated in its own right, because `validation` travels with a finalization:
   * a refused output keeps no record, and a check reported without its scope
   * says less than the boundary established.
   */
  readonly validationMode: ValidationMode;
  readonly validation: ConversionValidation | null;
  readonly backend: ConversionBackendFacts | null;
  readonly stagingResidue: string | null;
  /**
   * Which installation produced this result.
   *
   * A historical fact, and one that is *expected* to differ from the binding
   * the session is on once the installation has changed — so it is read as
   * provenance rather than judged for currency.
   */
  readonly receipt: BackendBindingReceipt | null;
}

/** Where one queue item is. */
export type ConversionQueueItemState =
  | "pending"
  | "running"
  | "finalized"
  | "skipped"
  | "failed"
  /**
   * A stop settled it and no backend process of it survives.
   *
   * Two ways that is so, and this state is both: a tree existed and was
   * confirmed gone, or nothing was launched for there to be one. The
   * cancellation facts' `ownedTree` says which; this state does not, and must
   * not be described as a confirmed tree.
   */
  | "cancelled"
  /**
   * The queue never began it. Not a failure and not an attempt.
   *
   * A stop is one way that happens and not the only one: a session that loses
   * track of a process it started refuses the rest of the queue, and that queue
   * is `completed`.
   */
  | "notRun"
  /**
   * The user settled it without running it, and the queue carried on.
   *
   * Three states now say no process ran, and they are three because they answer
   * three questions. `skipped` is the conflict policy leaving an existing file
   * alone. `notRun` is a stopped queue never reaching the item. This is a
   * decision the user made about this item, and the plan still holds it.
   */
  | "skippedByRequest"
  /** Stopped while running, and the termination could not be confirmed. */
  | "cancellationFailed";

/**
 * What a stop established about one attempt.
 *
 * Path-free like everything else on this wire: no process identifier, no job
 * handle, no staging location and no backend text.
 */
export type ConversionOwnedTreeDisposition =
  /** No process was created, so there was no tree. Not a confirmation and not an uncertainty. */
  | "none_launched"
  /**
   * A tree existed, the run owned it before it could grow, and the owned job
   * reported itself empty. The one member that asserts a terminated tree.
   */
  | "confirmed_gone"
  /**
   * A tree existed and its disappearance could not be established. The one
   * member that quarantines the session.
   */
  | "unconfirmed";

export interface ConversionCancellation {
  /**
   * Whether a converter process was created, where the boundary could say.
   *
   * `null` for a stop it could not confirm — the item's own `process` judgement
   * reports `indeterminate` there, and `false` would say no process launched
   * while that judgement says the opposite is unestablished.
   */
  readonly processLaunched: boolean | null;
  readonly terminationRequested: boolean;
  /**
   * What the stop established about this attempt's backend process tree.
   *
   * Three members rather than a boolean. The boolean this replaced said `true`
   * both for a tree confirmed gone and for a run that launched nothing, so a
   * reader given only `true` could not tell a claim about a process that
   * existed from a statement that none did.
   */
  readonly ownedTree: ConversionOwnedTreeDisposition;
  readonly elapsedMilliseconds: number;
  readonly termination: string | null;
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
  /** Members the integrity judgement read and refused. */
  readonly rejectedCount: number;
  /**
   * Members nobody examined.
   *
   * These four counts partition the members and sum to `memberCount`. This one
   * is not "members without a final name": that is this plus the two above it.
   */
  readonly notPublishedCount: number;
  /** `null` where the acquisition was never bound — not zero, which is a claim. */
  readonly boundSourceObjects: number | null;
  /**
   * The set's manifest: one entry per discovered member, in publication order.
   *
   * Bounded by `maxMembers`. It replaced two positional arrays whose pairing
   * nothing enforced.
   */
  readonly members: readonly ConversionOutputMember[];
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
  /**
   * Which installation produced this set. Provenance, like the single-output
   * report's, and exempt from the currency rule for the same reason.
   */
  readonly receipt: BackendBindingReceipt | null;
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
  /**
   * Whether *this* attempt has been asked to end while the queue runs on.
   *
   * The authority's own answer, so it survives this document: stopping one file
   * takes as long as the converter takes, and a view that remounted inside that
   * window used to read the item back as plainly `running` and offer the
   * control again for a request already accepted.
   *
   * False for an item whose stop has settled. This says a request is
   * outstanding; what a settled one established is `cancellation`.
   */
  readonly stopRequested: boolean;
  /**
   * The first judgement: what the execution boundary established about this
   * attempt's own process.
   *
   * On the item rather than on the report, because a cancelled row has no
   * report and is exactly the row a reader most needs this for.
   */
  readonly process: ConversionProcessOutcome;
  /**
   * The second judgement: what the private staging area held.
   *
   * Answerable whether or not anything was published, and independent of what
   * teardown reclaimed.
   */
  readonly staged: ConversionStagedOutput;
  /**
   * The identity minted for this attempt before the provider was invoked.
   *
   * `null` for an item that settled ahead of the launch — a refusal, a skip, a
   * stop that beat the process — which is what keeps any of them from reading
   * as a run that happened. Opaque, session-local, stable across re-reads of
   * the same attempt, and different for a retry.
   */
  readonly runIdentity: string | null;
  /** The fifth judgement: what an adoption did with this item's outputs. */
  readonly adoption: ConversionItemAdoption;
}

/** One queue, in facts that name no location. */
export interface ConversionQueue {
  readonly items: readonly ConversionQueueItem[];
  /** Which item is running, or how many are done when none is. */
  readonly currentIndex: number;
  readonly itemCount: number;
  readonly retryRound: number;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly destinationPolicy: DestinationPolicy;
  /** Current retained bindings; zero-attempt cleanup releases them. Not a conflict check. */
  readonly destinationStatus: "unresolved" | "bound";
  readonly finalizedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly retryableFailedCount: number;
  readonly nonRetryableFailedCount: number;
  /**
   * Items a stop settled with no backend process of them surviving — whether a
   * tree was confirmed gone or nothing was launched for there to be one.
   *
   * Deliberately not a count of confirmed process trees: which of the two each
   * item was is on its own cancellation facts.
   */
  readonly cancelledCount: number;
  /**
   * Items the queue never began. Not failures.
   *
   * A stop is one way that happens and not the only one: a session that loses
   * track of a converter process refuses the rest of the queue on its own, and
   * that queue is `completed`.
   */
  readonly notRunCount: number;
  /**
   * Items the user settled without running, while the queue carried on.
   * Counted apart from `notRunCount`: a decision the user made is not a
   * consequence of ending the batch.
   */
  readonly skippedByRequestCount: number;
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
   * Which installation this queue is bound to.
   *
   * Carried by the queue and not only by its items, because the pass that
   * matters most may produce no item at all: a queue refused for running on a
   * different installation resolved that installation first.
   *
   * `null` through `awaitingDestination`, where there is nothing truthful to
   * say — nothing is bound at `BEGIN`, and the first drain pass binds one. A
   * different question from what the session is bound to now, and allowed to
   * differ from it for the length of a drain.
   */
  readonly receipt: BackendBindingReceipt | null;
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
   * Set where MSCanvas cannot say whether a process it started is still
   * running — a stop it could not confirm, or a conversion, preview, spectrum
   * read or discovery probe that ended without accounting for one. Never
   * cleared: nothing in the session can establish that the process it lost
   * track of has ended.
   */
  readonly backendQuarantined: boolean;
  /**
   * The authority as it stood when this answer was made.
   *
   * Carried by every operation answering in this shape. Several of them take
   * the backend lane and observe; the poll can neither observe nor replace
   * anything, and carries it because it is the session's only voice while a
   * drain runs.
   *
   * A poll is deliberately not an occasion to re-issue anything: a request
   * deferred by a running drain must not be re-made on every tick of that
   * drain's own polling.
   */
  readonly authority: BackendAuthorityProjection;
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

/**
 * The exact question one plan answers.
 *
 * Every fact that changes what the future queue *means*, and nothing that does
 * not. Two rows in this order, this combination, this policy, on this
 * installation — change any of them and the answer describes a different
 * conversion.
 *
 * **The receipt is part of the question.** This side knows which binding it is
 * rendering, so it says so; Rust compares that with its own and refuses when
 * they differ, rather than echoing it back. Without it a plan computed under
 * one installation could be shown, and started, under another.
 *
 * **`BackendAuthorityRevision` is deliberately absent.** A revision orders
 * publications; it does not say which installation a plan is about. The same
 * receipt legitimately arrives under a later revision — a preview verdict can
 * move on a build that has not changed — and a question carrying the revision
 * would call its own answer stale for a fact about msaccess's grammar.
 */
/** A semantic destination choice. Rust alone resolves and retains locations. */
export type DestinationPolicy =
  | { readonly kind: "customFolder" }
  | { readonly kind: "sourceSibling" }
  | { readonly kind: "namedSubfolder"; readonly name: string };

export interface ConversionPlanRequest {
  /** The rows, in the order they would run, which is the order on screen. */
  readonly handles: readonly string[];
  /** The admitted combination, by the identity Rust's catalog gave it. */
  readonly intentId: string;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly destinationPolicy: DestinationPolicy;
  /** The binding this side is rendering. */
  readonly expectedReceipt: BackendBindingReceipt;
}

/** What the interface shows before a queue is started. */
export interface ConversionQueuePlan {
  readonly items: readonly ConversionQueuePlanItem[];
  readonly outputFormat: ConversionOutputFormat;
  readonly compression: string;
  readonly validationMode: ValidationMode;
  /** The most items one queue may hold, as Rust enforces it. */
  readonly capacity: number;
  /**
   * The combination this plan describes, whole.
   *
   * Rust reconstructs it from the admitted table and answers with what it
   * resolved, so the panel renders the semantic the queue would be bound with
   * rather than the identity it happened to send.
   */
  readonly intent: ConversionIntentDescriptor;
  /** The conflict policy this plan was asked under. */
  readonly conflictPolicy: ConversionConflictPolicy;
  /** Validated by Rust; describing it creates and resolves no destination. */
  readonly destinationPolicy: DestinationPolicy;
  /** The binding this plan is about, checked by Rust and given back. */
  readonly receipt: BackendBindingReceipt;
}

/**
 * What a plan request produced.
 *
 * A plan asked under a binding Rust has already left is not an error about the
 * rows: it is news about the installation, and the only useful thing to answer
 * with is the authority itself. Ordinary refusals — an unknown handle, two rows
 * that would write one name — arrive as a rejected promise, because they carry
 * no claim about a binding.
 *
 * A successful plan carries no authority projection, and that is not an
 * omission. This operation takes no gate and runs no discovery, so it observes
 * nothing and has nothing to project; its receipt is a component of the
 * question, checked and echoed.
 */
export type ConversionPlanOutcome =
  | { readonly outcome: "planned"; readonly plan: ConversionQueuePlan }
  | {
      readonly outcome: "capacityExceeded";
      readonly capacity: number;
      readonly requestedCount: number;
    }
  | {
      readonly outcome: "bindingReplaced";
      readonly authority: BackendAuthorityProjection;
    };

/**
 * The exact question one `BEGIN` acts on.
 *
 * The plan question's membership, minus nothing. A start that took fewer facts
 * could be right about the rows and wrong about the build, or right about the
 * build and wrong about the semantic — and Rust proves all of them again rather
 * than trusting that this side checked.
 */
export interface ConversionBeginRequest {
  readonly handles: readonly string[];
  readonly intentId: string;
  readonly conflictPolicy: ConversionConflictPolicy;
  readonly destinationPolicy: DestinationPolicy;
  /** The binding the plan on screen was authored under. */
  readonly expectedReceipt: BackendBindingReceipt;
}

/**
 * What one `BEGIN` produced, before any folder was chosen.
 *
 * In band, both arms. A refused `BEGIN` creates no queue, so there is no slot
 * to poll and nothing else would arrive to correct a screen still showing the
 * build the session has left — which is why the refusal travels inside an
 * {@link AuthorityObserved} rather than as a bare rejection.
 */
export type ConversionBeginOutcome =
  | { readonly outcome: "reserved"; readonly reservation: ConversionReservation }
  | { readonly outcome: "refused"; readonly error: PreviewError };

/**
 * One Rust-issued claim on the right to choose a destination and convert.
 *
 * Opaque, path-free and single-use. It grants no filesystem authority: what it
 * names is one bound decision Rust already made.
 */
export interface ConversionReservation {
  readonly reservationId: string;
}

/**
 * What one start did, from the click to the folder.
 *
 * Two commands and one answer, because the reader made one decision. A start
 * that Rust refused never reaches a picker, so there is no queue to report and
 * the refusal is the outcome.
 */
export type ConversionStartOutcome =
  | { readonly outcome: "converted"; readonly update: WorkspaceConversionUpdate }
  | { readonly outcome: "refused"; readonly error: PreviewError };

/**
 * Whether a single-output run failed *because* the integrity judgement refused
 * it.
 *
 * Read from the boundary's own identifier rather than from the absence of a
 * validation record: a refused output carries none, and so does a run that
 * never produced one, and those are opposite answers to "was it checked".
 */
export function conversionOutcomeRefusedByIntegrity(outcome: string): boolean {
  return outcome === "output_rejected";
}

/**
 * Whether a single-output run passed its check and then failed to publish.
 *
 * Both identifiers name a failure that happens strictly after the judgement
 * returned a valid output: the rename did not land, or something appeared at
 * the final name during the run. Neither retains the record, and neither may be
 * reported as a run that was never checked.
 */
export function conversionOutcomePassedThenUnpublished(outcome: string): boolean {
  return outcome === "output_not_finalized" || outcome === "destination_appeared_during_run";
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
    // The record is not the only evidence that a check ran. It travels with a
    // finalization, so an output the judgement *refused* keeps none, and so
    // does one that passed and then could not be given its final name. Reading
    // only the record reported "no check" on exactly the runs a check decided.
    return (
      result.report.validation !== null ||
      conversionOutcomeRefusedByIntegrity(result.report.outcome) ||
      conversionOutcomePassedThenUnpublished(result.report.outcome)
    );
  }
  // A refused member counts. The judgement ran on it and did not pass it, which
  // is a check having happened rather than one having been skipped -- and it is
  // the case where a set carries no other evidence of one, because a refusal
  // keeps no validation record and publishes nothing.
  return (
    result.report.finalizedCount > 0 ||
    result.report.validatedNotPublishedCount > 0 ||
    result.report.rejectedCount > 0
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
