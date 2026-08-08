//! Serializable transfer objects for the mzML preview boundary.
//!
//! Every type here is what the webview is allowed to see. None of them carries
//! an absolute backend path, raw backend text, or a value the backend did not
//! actually emit. Unknown facts stay explicitly unknown rather than being
//! defaulted into something that looks measured.

use serde::{Deserialize, Serialize};

/// The largest spectrum-table payload one open operation may transfer.
///
/// The measured representative acquisition has 36,319 spectra, so this is
/// headroom rather than a limit reached in practice. A larger acquisition is
/// reported as truncated instead of silently cut.
pub const MAX_SPECTRUM_TABLE_ROWS: usize = 100_000;

/// The largest per-spectrum point count one selection may transfer.
pub const MAX_SPECTRUM_POINTS: usize = 500_000;

/// The longest metadata line the boundary forwards.
pub const MAX_METADATA_LINE_CHARS: usize = 400;

/// The most metadata lines one section may transfer.
///
/// A section runs to tens of lines in every measured file, so this is headroom.
/// It exists because the 8 MiB output bound alone permits hundreds of thousands
/// of very short lines, and a list that long would stall the render rather than
/// inform anyone.
pub const MAX_METADATA_ENTRIES: usize = 1_000;

/// The longest backend release or build-date label the boundary forwards.
///
/// Both come from the installed tool's own help text, so they are backend text
/// like any other and are bounded and redacted the same way.
pub const MAX_BACKEND_LABEL_CHARS: usize = 120;

/// The most MS-level buckets one run summary may transfer.
///
/// Real acquisitions report a handful. The ceiling exists because a malformed
/// summary could name a great many inside the same 8 MiB output bound.
pub const MAX_MS_LEVELS: usize = 64;

/// The most precursor records one selected spectrum may transfer.
///
/// A precursor list is a handful of entries in every measured file; the ceiling
/// exists because a malformed one could carry very many short records inside
/// the same 8 MiB output bound.
pub const MAX_PRECURSORS: usize = 1_000;

/// The longest bounded diagnostic detail attached to an error.
pub const MAX_ERROR_DETAIL_CHARS: usize = 400;

/// The longest spectrum identifier the boundary forwards.
///
/// A native identifier is a short controller/scan descriptor in every measured
/// format, but it is backend text and a file may put anything there.
pub const MAX_IDENTIFIER_CHARS: usize = 200;

/// The most datasets one session's workspace may hold.
///
/// A named resource contract rather than a performance promise. Every Windows
/// row owns a live handle on its file for as long as it exists, and every
/// mutation answers with the whole roster, so the session's cost in handles and
/// in transfer size both rise with the number of rows. A thousand is far above
/// what a batch of acquisitions looks like and far below where either of those
/// becomes a question, which is what a bound is for.
pub const MAX_WORKSPACE_DATASETS: usize = 1_024;

/// The longest candidate name a rejected addition may report.
///
/// A rejected candidate never reached acceptance, so nothing has vouched for
/// its name. Windows bounds a file name at 255 characters; this bounds what the
/// boundary forwards at the same place, so a name that arrived longer than any
/// filesystem allows cannot become an unbounded string on screen.
pub const MAX_CANDIDATE_NAME_CHARS: usize = 255;

/// Whether a user-installed ProteoWizard backend is usable.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvailabilityDto {
    /// `available` or `unavailable`. MSCanvas never bundles or installs a
    /// backend, so unavailability is an ordinary user-facing state.
    pub state: String,
    /// How many times the installation in use has changed, counted in Rust.
    ///
    /// Which verdict is current is decided by the order the service granted,
    /// not the order the caller asked. Two commands contend for the same lock
    /// and it does not grant in request order, so a recheck started after a
    /// folder choice can be served before it and describe the installation the
    /// choice replaced. A caller applies a verdict only when this is at least
    /// the highest it has applied.
    pub installation_generation: u64,
    /// `automatic` or `chosen`: which installation this verdict describes.
    ///
    /// Carried with the verdict rather than tracked separately, so a reading
    /// can never be shown beside the wrong origin. That pairing is the whole
    /// risk of letting the installation change during a session: a stale
    /// "available" beside a folder the user just picked says the folder works
    /// when nothing has looked at it.
    pub origin: String,
    pub release: Option<String>,
    pub build_date: Option<String>,
    pub same_installation: bool,
    pub failure: Option<BackendFailureDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendFailureDto {
    pub kind: String,
    pub summary: String,
    pub corrective_action: String,
}

/// The longest disambiguating context one row may carry.
///
/// It is a fragment of a path under a folder the user chose, so it is bounded
/// like every other value that crosses this boundary. A deep tree can nest far
/// enough that the whole location would be a paragraph rather than a label, and
/// a roster of a thousand rows would carry a thousand of them.
pub const MAX_RELATIVE_CONTEXT_CHARS: usize = 128;

/// One accepted local file. The absolute path stays in Rust; the webview
/// receives an opaque handle and the display name only.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFileDto {
    pub handle: String,
    pub file_name: String,
    pub byte_length: u64,
    /// Which family Rust admitted this row as.
    ///
    /// Required on every row and closed to exactly two values. An optional or
    /// unknown member would be a row the interface has to guess about, and the
    /// one decision that depends on this -- whether a row can be previewed at
    /// all -- is not a decision to guess.
    ///
    /// It is not identity: two rows of different families are still two rows,
    /// and one file admitted twice keeps the family it was first admitted
    /// under. It is not searched and not sorted by.
    pub source_kind: DatasetSourceKindDto,
    /// Where this row sits below the folder it was found in, and only when two
    /// or more live rows share its final filename.
    ///
    /// `None` is the ordinary answer. It is never the chosen root's own name,
    /// never a drive, never a UNC prefix, never absolute and never contains
    /// `..`: it is the least that has to be said to tell identical names apart,
    /// which is the only reason ADR 0006 permits saying anything at all. It is
    /// display only -- not searched, not sorted by, and not part of identity.
    pub relative_context: Option<String>,
}

/// The complete family vocabulary a roster row can carry.
///
/// Closed, and deliberately not general. There is no `vendorRaw`, no `raw` and
/// no `unknown`: ADR 0010 admitted exactly one vendor family on measured
/// evidence, and a member that exists here is a claim the product understands
/// the data behind it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatasetSourceKindDto {
    Mzml,
    ThermoRaw,
}

/// Every dataset the session holds, in the order they were added.
///
/// The order is the registry's and is authoritative: the webview draws what it
/// is given rather than sorting a list of its own. There is no path field and
/// no parent-folder field, because a roster of many rows is exactly where one
/// would leak the most.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRosterDto {
    pub datasets: Vec<SelectedFileDto>,
    /// The session capacity these rows are bounded by.
    ///
    /// Carried with the roster rather than restated in the webview, so the
    /// limit the interface shows is the limit Rust enforces. A second copy of
    /// the number would be a second authority to keep true.
    pub capacity: usize,
}

/// What one chosen file did to the workspace.
///
/// Reported per item and in picker order, because one rejected candidate says
/// nothing about the rest of a batch: the files that were accepted stay
/// accepted, and the user is told which of the ones they chose did not arrive.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum WorkspaceAddOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Added { dataset: SelectedFileDto },
    /// The file is already in the workspace. The row named here is the one the
    /// user already has, described as it was registered rather than as it was
    /// just named: two names for one file are one dataset.
    #[serde(rename_all = "camelCase")]
    Duplicate { existing: SelectedFileDto },
    /// A file that could not be added, named by its final filename only.
    ///
    /// Nothing accepted it, so there is no dataset to name it by -- and the one
    /// thing that may be said about it is the last component of what the user
    /// picked, never the folder it sits in.
    #[serde(rename_all = "camelCase")]
    Rejected {
        candidate_name: String,
        error: PreviewErrorDto,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAddResultDto {
    pub roster: WorkspaceRosterDto,
    pub outcomes: Vec<WorkspaceAddOutcomeDto>,
}

/// What removing rows did, including the handles that named nothing.
///
/// A handle the session no longer holds is an ordinary reconciliation outcome
/// rather than a failure: the webview asked about a row it believed it had, and
/// the answer is the roster it actually has.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRemoveResultDto {
    pub roster: WorkspaceRosterDto,
    pub removed_handles: Vec<String>,
    pub unknown_handles: Vec<String>,
}

/// Which named traversal limit a folder scan reached.
///
/// Named rather than counted, because which one ran out is what tells a user
/// whether choosing a narrower folder would help. The order is ADR 0007's
/// declaration order and is stable, so two scans that hit the same limits
/// describe themselves identically.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FolderScanLimitDto {
    Depth,
    Entries,
    Directories,
    Candidates,
}

/// What a folder scan saw, in facts that name no file and no directory.
///
/// Deliberately not everything the private summary holds. How many entries were
/// inspected and how many directories were entered describe the shape of the
/// user's tree, which is not something a folder's contents give this boundary
/// leave to report. What is here is what a reader needs in order to know
/// whether the answer is the whole answer.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderDiscoverySummaryDto {
    /// Whether everything under the chosen folder was described.
    ///
    /// False whenever a limit was reached, a linked entry was skipped or a
    /// subtree could not be read. One answer rather than three, so a caller
    /// cannot report a partial scan as a complete one by checking the wrong
    /// field.
    pub complete: bool,
    /// Entries refused for carrying a reparse tag: junctions, symbolic links,
    /// mount points and cloud placeholders alike. MSCanvas follows none of
    /// them, so a folder full of them yields little and says so.
    pub skipped_reparse_count: u64,
    /// Entries and subtrees the filesystem would not describe.
    pub inaccessible_entry_count: u64,
    pub limits_reached: Vec<FolderScanLimitDto>,
}

/// What one folder import did.
///
/// The roster is authoritative as always, the outcomes are one per candidate in
/// discovery order, and the summary is how the scan itself went. A scan that
/// found nothing is an ordinary result with no outcomes; a scan that was cut
/// short is a result that says so.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderIngestionResultDto {
    pub roster: WorkspaceRosterDto,
    pub outcomes: Vec<WorkspaceAddOutcomeDto>,
    pub discovery: FolderDiscoverySummaryDto,
}

/// One Rust-issued claim on the right to choose a destination and convert.
///
/// Opaque, path-free and single-use. It grants no filesystem authority: what it
/// names is one bound decision Rust already made -- which dataset, at which
/// request epoch, under which conflict policy, for which document -- so the
/// picker that follows cannot be about anything else.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConversionReservationDto {
    pub reservation_id: String,
}

/// The only output format this workflow can produce.
///
/// A one-member union rather than a bare string, so adding mzXML later is a
/// change to this vocabulary and to everything that reads it, rather than a new
/// value appearing in a field nobody validates.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConversionOutputFormatDto {
    #[serde(rename = "mzML")]
    MzMl,
}

/// How a conversion output was judged.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValidationModeDto {
    /// The source was read under the same model as the output and the two were
    /// compared.
    SourceComparison,
    /// Only the output's own postconditions were established. Nothing was
    /// compared, and nothing is claimed about what the source contained.
    OutputOnly,
}

/// What happens when the planned output name is already taken.
///
/// Two members, and overwrite is not one of them. ADR 0009 refuses to replace a
/// file this boundary did not create, and a policy that could would make the
/// no-clobber guarantee a preference.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConversionConflictPolicyDto {
    Fail,
    Skip,
}

/// The most items one queue may hold.
///
/// Far below the workspace's own capacity, and deliberately so. This slice runs
/// items serially and has no cancellation, so a queue is something the user
/// waits out: at a realistic minute or three per acquisition, sixteen is
/// something like half an hour. A queue sized to the roster would be an
/// afternoon nobody could stop.
///
/// Stated as one number rather than derived from anything, because it is a
/// judgement about how long a person should be asked to wait and not a fact
/// about the machine.
pub const MAX_CONVERSION_QUEUE_ITEMS: usize = 16;

/// One bounded, path-free read of the session's conversion slot.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConversionUpdateDto {
    /// A checked, session-scoped ordering key. It is not a workspace
    /// generation, not a request epoch and carries no filesystem authority.
    pub sequence: u64,
    pub state: WorkspaceConversionStateDto,
    /// Whether this session has stopped trusting the backend.
    ///
    /// Set when a stop request could not be confirmed, which is the one state
    /// in which MSCanvas cannot say whether a converter process of its own is
    /// still running. It rides on the conversion read because that is what a
    /// document already asks for on mount and while work is under way, so a
    /// reload recovers the quarantine with the queue that caused it rather
    /// than needing a second question.
    pub backend_quarantined: bool,
}

/// The complete conversion-state vocabulary exposed to the webview.
///
/// One queue, not a list of queues: `terminal` is replaced by the next queue
/// and never accumulated. A single-dataset conversion is a queue of one, so
/// there is one protocol rather than two.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceConversionStateDto {
    Idle,
    /// A reservation exists and the native picker is open or about to be.
    #[serde(rename_all = "camelCase")]
    AwaitingDestination {
        /// Decimal text keeps a Rust `u64` exact across JavaScript's number
        /// boundary while revealing no internal generation or token.
        operation_id: String,
        queue: ConversionQueueDto,
    },
    /// A destination was accepted and items are being converted in order. There
    /// is deliberately no completed fraction: what is measured is how many
    /// items are done, and nothing measures a fraction of one.
    #[serde(rename_all = "camelCase")]
    Running {
        operation_id: String,
        queue: ConversionQueueDto,
    },
    /// A stop was requested and the queue has not settled yet.
    ///
    /// Its own state rather than a flag on `running`, because what a reader may
    /// do differs: no further item will start, and the one that is running may
    /// still finish naturally. Nothing here predicts which.
    #[serde(rename_all = "camelCase")]
    Stopping {
        operation_id: String,
        queue: ConversionQueueDto,
    },
    /// Every item reached an outcome, or the queue was refused before any of
    /// them could, or the queue was stopped.
    #[serde(rename_all = "camelCase")]
    Terminal {
        operation_id: String,
        /// Why this queue is over. A stopped queue is terminal in a different
        /// way from a completed one -- it is not retried in place -- so the
        /// reason is carried rather than inferred from the item states, which
        /// a completed queue of only failures would otherwise imitate.
        reason: ConversionQueueTerminalReasonDto,
        queue: ConversionQueueDto,
    },
}

/// Why a terminal queue is over.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConversionQueueTerminalReasonDto {
    /// Every item reached an outcome of its own, or the queue was refused.
    Completed,
    /// The user asked for it to stop, and MSCanvas knows no converter process
    /// of its own survives.
    Stopped,
    /// The user asked for it to stop, and MSCanvas could not confirm that the
    /// converter process ended. Deliberately not called stopped.
    StopFailed,
}

/// One queue, in facts that name no location.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionQueueDto {
    /// The items, in the order they will run. Fixed when the queue was created:
    /// re-sorting or re-searching the roster afterwards changes what the user
    /// is looking at, not what this queue does.
    pub items: Vec<ConversionQueueItemDto>,
    /// Which item is running, or how many have finished when none is. Always a
    /// count of items, never a fraction of one.
    pub current_index: usize,
    pub item_count: usize,
    /// How many times `Retry failed` has run. Zero for a queue's first pass.
    pub retry_round: u64,
    pub conflict_policy: ConversionConflictPolicyDto,
    pub finalized_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    /// How many failures another attempt could plausibly change, under the same
    /// source, destination, policy and build.
    pub retryable_failed_count: usize,
    pub non_retryable_failed_count: usize,
    /// Items whose running conversion was stopped with the process tree
    /// confirmed gone. Counted apart from failures: a cancelled item is
    /// something the user asked for, not something that went wrong.
    pub cancelled_count: usize,
    /// Items a stopped queue never began. They did not fail and launched no
    /// process, and counting them as failures would report work that was never
    /// attempted as work that went wrong.
    pub not_run_count: usize,
    /// Items whose stop could not be confirmed. Apart from both of the above,
    /// because what is unknown here is whether a process survived.
    pub cancellation_failed_count: usize,
    /// A refusal that stopped the whole queue rather than one item -- a
    /// destination this boundary will not write to, a backend that cannot
    /// convert, a reservation that is no longer valid.
    pub error: Option<PreviewErrorDto>,
    /// Where the sequence of backend changes stood when this queue last
    /// resolved one.
    ///
    /// Carried by the queue and not only by its items, because the pass that
    /// matters most for this may produce no item at all: a queue refused for
    /// running on a different installation resolved that installation first,
    /// and a reader with only the old items' reports would go on showing the
    /// installation those results came from.
    pub installation_generation: u64,
}

/// One item of a queue.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionQueueItemDto {
    pub dataset_handle: String,
    pub file_name: String,
    pub source_kind: DatasetSourceKindDto,
    /// The name this item's output will take, derived before the queue was
    /// created. Two items that would produce the same name in one folder are
    /// refused there rather than discovered here.
    pub output_file_name: String,
    pub state: ConversionQueueItemStateDto,
    /// How many times this item has been attempted. One after the first pass.
    pub attempts: u64,
    pub retryable: bool,
    /// The latest attempt's report, when an attempt reached a conversion.
    /// Only the latest: an attempt history would be an unbounded one, and
    /// nothing in this workflow reads a second entry.
    pub report: Option<ConversionReportDto>,
    /// Why an attempt never reached a conversion at all. Distinct from a
    /// conversion that ran and failed, which is a `report`.
    pub error: Option<PreviewErrorDto>,
    /// What a stop established about this item's attempt. Present only for an
    /// item a stop actually reached; a `notRun` item has none, because nothing
    /// ran for it to establish anything about.
    pub cancellation: Option<ConversionCancellationDto>,
}

/// Where one item is.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConversionQueueItemStateDto {
    Pending,
    Running,
    Finalized,
    /// The planned name was already taken and the policy asked for it to be
    /// left alone. Not a failure, and deliberately not a success: nothing was
    /// inspected and nothing was written.
    Skipped,
    Failed,
    /// The running conversion was stopped and its owned process tree was
    /// confirmed gone. No output was finalized.
    Cancelled,
    /// A stopped queue never began this item. Not a failure: no process was
    /// launched and nothing was created.
    NotRun,
    /// The stop was requested and could not be confirmed. Whether a converter
    /// process survived is unknown, which is why this is neither cancelled nor
    /// an ordinary failure.
    CancellationFailed,
}

/// What a stop established about one attempt.
///
/// Path-free and identifier-free by construction. There is no process
/// identifier, job handle, staging path or backend text here, and no field one
/// could reach through.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionCancellationDto {
    /// Whether a converter process was handed to the process boundary at all.
    pub process_launched: bool,
    /// Always true for an item a stop reached; carried rather than implied so a
    /// reader never has to infer it from the item state.
    pub termination_requested: bool,
    /// Whether the owned process tree was confirmed empty. False is the whole
    /// reason `cancellationFailed` exists.
    pub tree_termination_confirmed: bool,
    /// How long the stop request took to produce a result, measured by the
    /// queue around the attempt. Milliseconds, matching the one time format
    /// already on this wire.
    pub elapsed_milliseconds: u64,
    /// How the process ended, by the process boundary's own identifier.
    pub termination: Option<String>,
    /// Whether the private staging area held anything when the stop settled.
    /// A shape, never a name.
    pub partial_output_observed: bool,
    /// What identity-bound cleanup could not remove, by stable identifier.
    pub staging_residue: Option<String>,
}

/// What the interface shows before a queue is started.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionQueuePlanDto {
    pub items: Vec<ConversionQueuePlanItemDto>,
    pub output_format: ConversionOutputFormatDto,
    /// The compression every binary array in every output must carry, taken
    /// from the policy the plans are fixed with.
    pub compression: String,
    pub validation_mode: ValidationModeDto,
    /// The most items one queue may hold, carried with the plan so the
    /// interface states the limit Rust enforces rather than one of its own.
    pub capacity: usize,
}

/// One row of a queue plan.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionQueuePlanItemDto {
    pub dataset_handle: String,
    pub file_name: String,
    pub output_file_name: String,
}

/// What one conversion did, in facts that name no location.
///
/// The projection of the private report, and deliberately smaller than it. What
/// is here is what this surface shows; everything else -- above all any path --
/// stays in Rust.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionReportDto {
    pub dataset_handle: String,
    pub source_kind: DatasetSourceKindDto,
    /// What the run did, by the conversion boundary's own identifier.
    pub outcome: String,
    /// The precise failure, when the outcome was a failure. Separate from
    /// `outcome` because the interface groups by one and explains by the other.
    pub detailed_outcome: Option<String>,
    /// The name the finalized output took. A display name, not a location, and
    /// absent unless a file was actually finalized.
    pub output_file_name: Option<String>,
    pub output: Option<ConversionOutputDto>,
    pub validation: Option<ConversionValidationDto>,
    pub backend: Option<ConversionBackendFactsDto>,
    /// What the run could not reclaim of its own staging area, by stable
    /// identifier. Reported beside the outcome rather than folded into it: a
    /// conversion can succeed and still leave something behind, and the two are
    /// different things to tell a user.
    pub staging_residue: Option<String>,
    pub installation_generation: u64,
}

/// What was measured of a finalized output.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOutputDto {
    pub byte_length: u64,
    /// The digest of the file that was written. Already established as safe to
    /// show: it is a property of the output's bytes and names nothing about
    /// where it or its source lives.
    pub sha256: String,
    pub spectrum_count: u64,
    pub chromatogram_count: u64,
}

/// How a finalized output was judged, including what the judgement could not
/// reach.
///
/// `inapplicable` is not a softer `unverified`. A property that could not apply
/// is one this source posture has no reading of at all, so reporting it as
/// merely unverified would suggest a check that could have been made and was
/// not.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionValidationDto {
    pub mode: ValidationModeDto,
    pub fully_verified: bool,
    pub verified: Vec<String>,
    pub unverified: Vec<String>,
    pub inapplicable: Vec<String>,
}

/// Bounded facts about the backend process. Raw stdout and stderr are
/// deliberately absent: they can name the acquisition and the destination.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionBackendFactsDto {
    pub exit_code: Option<i32>,
    pub elapsed_milliseconds: u64,
}

/// What a conversion reservation that names nothing answers with.
pub fn invalid_conversion_reservation() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "invalid_conversion_reservation",
        "That conversion request is no longer valid. Start it again.",
        false,
    )
}

/// What a row of a family this product cannot read answers with.
pub fn dataset_not_previewable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "dataset_not_previewable",
        "Convert to mzML before previewing this acquisition.",
        false,
    )
}

/// What a queue larger than one session may run answers with.
pub fn queue_too_large() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_too_large",
        // Formatted from the bound rather than restating it. A sentence naming
        // its own number is a second copy of the limit, free to be right today
        // and wrong after the constant moves.
        format!(
            "MSCanvas converts up to {MAX_CONVERSION_QUEUE_ITEMS} acquisitions in one queue. \
             Select fewer and convert the rest afterwards."
        ),
        false,
    )
}

/// What a queue naming no convertible row answers with.
pub fn queue_is_empty() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_is_empty",
        "Select at least one Thermo RAW row to convert.",
        false,
    )
}

/// What a queue naming one row twice answers with.
pub fn queue_duplicate_dataset() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_duplicate_dataset",
        "That request names the same acquisition more than once.",
        false,
    )
}

/// What a queue whose items would fight over one output name answers with.
///
/// Refused before a picker opens, because conflict policy cannot settle it: two
/// items of one queue writing one name is not a conflict with something that
/// was already there, and letting queue order decide the winner would make the
/// result depend on a sort the user can change.
pub fn queue_output_name_collision(names: &[String]) -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_output_name_collision",
        "Two or more selected acquisitions would produce the same converted filename, so nothing \
         was queued. Convert them separately, or into different folders.",
        false,
    )
    .with_detail(names.join(", "))
}

/// What a retry answers with when the folder it would write into is no longer
/// the one the queue was admitted against.
pub fn queue_destination_changed() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_destination_changed",
        "The folder those conversions were saved to is no longer the same folder, so nothing was \
         retried. Start a new conversion to choose it again.",
        true,
    )
}

/// What a retry answers with when the installed ProteoWizard is no longer the
/// one the queue's earlier items were converted on.
pub fn queue_installation_changed() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_installation_changed",
        "The installed ProteoWizard has changed since those conversions ran, so nothing was \
         retried. Start a new conversion so every file in it comes from one installation.",
        false,
    )
}

/// What a second conversion answers with while one is already under way.
pub fn conversion_busy() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "conversion_busy",
        "MSCanvas converts one acquisition at a time. Wait for the current conversion to finish.",
        true,
    )
}

/// What a stop answers with when there is no running queue of the caller's to
/// stop.
///
/// One refusal for every way of naming the wrong thing -- a replaced document,
/// an operation the slot no longer holds, an idle slot, a queue that is already
/// over. Telling them apart would describe the session's internal state to a
/// caller that, by construction, is not the one running it.
pub fn conversion_not_stoppable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "conversion_not_stoppable",
        "There is no conversion of yours to stop.",
        false,
    )
}

/// What every backend operation answers with once a stop could not be
/// confirmed.
pub fn backend_quarantined() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "backend_quarantined",
        "MSCanvas could not confirm that the converter process stopped. Restart MSCanvas before \
         starting another preview or conversion.",
        false,
    )
}

/// What a row that cannot be converted answers with.
pub fn dataset_not_convertible() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "dataset_not_convertible",
        "That row is already mzML, so there is nothing to convert.",
        false,
    )
}

/// One Rust-issued claim on the current document's bounded drop subscriber.
///
/// The identifier is opaque and path-free. It grants no filesystem authority
/// and is accepted only once while the document epoch that issued it remains
/// current.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDropSubscriptionReservationDto {
    pub reservation_id: String,
}

/// One bounded, path-free native-drop update sent to the current document.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDropUpdateDto {
    /// A checked, session-scoped ordering key. It is not a workspace
    /// generation and carries no filesystem authority.
    pub sequence: u64,
    pub state: WorkspaceDropStateDto,
}

/// The complete native-drop state vocabulary exposed to the webview.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceDropStateDto {
    Idle,
    #[serde(rename_all = "camelCase")]
    Hovering {
        item_count: usize,
    },
    #[serde(rename_all = "camelCase")]
    Importing {
        /// Decimal text keeps a Rust `u64` exact across JavaScript's number
        /// boundary while revealing no internal generation or token.
        operation_id: String,
        item_count: usize,
    },
    #[serde(rename_all = "camelCase")]
    Completed {
        operation_id: String,
        result: DropIngestionResultDto,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        operation_id: String,
        error: PreviewErrorDto,
    },
    Rejected {
        reason: DropRejectionReasonDto,
    },
}

/// Why one native drop was refused before any of its paths were retained.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum DropRejectionReasonDto {
    #[serde(rename = "drop_busy")]
    DropBusy,
    /// A conversion is under way. Dropping files would change the workspace the
    /// conversion is reading from, so the drop is refused rather than queued.
    #[serde(rename = "conversion_busy")]
    ConversionBusy,
}

/// Which shared native-drop budget prevented the remaining roots from being
/// fully described.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum DropScanLimitDto {
    Roots,
    Depth,
    Entries,
    Directories,
    Candidates,
}

/// Aggregate facts about a mixed native drop. Root names, paths, traversal
/// counts and identities remain private to Rust.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DropIngestionSummaryDto {
    /// The authoritative workspace was empty at the drop's generation claim.
    /// This is the proof the frontend must use for the one allowed automatic
    /// preview; it must not infer the fact from a later roster.
    pub workspace_was_empty: bool,
    pub complete: bool,
    pub top_level_item_count: usize,
    pub skipped_reparse_root_count: u64,
    pub inaccessible_root_count: u64,
    pub remote_root_count: u64,
    pub unsupported_root_count: u64,
    pub skipped_reparse_entry_count: u64,
    pub inaccessible_entry_count: u64,
    pub limits_reached: Vec<DropScanLimitDto>,
}

/// The authoritative result of one mixed native drop.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DropIngestionResultDto {
    pub roster: WorkspaceRosterDto,
    pub outcomes: Vec<WorkspaceAddOutcomeDto>,
    pub summary: DropIngestionSummaryDto,
}

/// A path-free, single-use claim on one pending folder import.
///
/// The identifier correlates the two narrow commands needed to survive a
/// webview reload. It is not the workspace generation or the internal token,
/// and it grants no filesystem access: Rust accepts it only once and only while
/// the reservation it names is still current.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderImportReservationDto {
    pub reservation_id: String,
}

/// What a folder import answers with when the workspace moved on beneath it.
///
/// Scanning holds no lock, which is what keeps the workspace usable while a
/// large tree is read. The cost is that the user can decide something else
/// meanwhile -- add files, remove rows, empty the list, or reload the window --
/// and this is what that costs: nothing is added, and the scan is worth
/// repeating if they still want it.
pub fn import_superseded() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "import_superseded",
        "The workspace changed while MSCanvas was scanning that folder, so none of its files \
         were added. Scan the folder again.",
        true,
    )
}

/// What an unknown, replaced or already-spent folder reservation answers with.
pub fn invalid_folder_import_reservation() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "invalid_folder_import_reservation",
        "That folder import is no longer available. Start it again.",
        true,
    )
}

/// What an unknown, replaced, spent or old-document drop subscription answers.
pub fn invalid_workspace_drop_subscription() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "invalid_workspace_drop_subscription",
        "That workspace drop subscription is no longer available. Start it again.",
        true,
    )
}

/// What a valid, non-duplicate file is refused with when the session is full.
pub fn workspace_full() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "workspace_full",
        "This session already holds as many files as MSCanvas keeps in one workspace, so that \
         one was not added. Remove some rows and add it again.",
        false,
    )
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSectionDto {
    pub id: String,
    pub title: String,
    pub entries: Vec<String>,
    /// How many lines the section really has, which can exceed `entries`.
    pub total_entry_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataDto {
    pub sections: Vec<MetadataSectionDto>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MsLevelCountDto {
    /// `None` is the backend's "other" bucket, not a missing value.
    pub ms_level: Option<u32>,
    pub spectrum_count: u64,
}

/// A retention time with the unit the backend actually emitted.
///
/// The measured `msaccess` formatter emits no unit, so `unit_known` is false
/// and no unit is invented for display.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetentionTimeDto {
    pub value: f64,
    pub unit_known: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetentionTimeRangeDto {
    pub minimum: RetentionTimeDto,
    pub maximum: RetentionTimeDto,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSummaryDto {
    pub total_spectrum_count: u64,
    pub ms_levels: Vec<MsLevelCountDto>,
    /// How many buckets the summary really reported.
    pub total_ms_level_count: usize,
    pub ms_levels_truncated: bool,
    /// `None` because the measured run-summary format emits no chromatogram
    /// count. It is not a count of zero.
    pub chromatogram_count: Option<u64>,
    pub retention_time_range: Option<RetentionTimeRangeDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumRowDto {
    pub index: u64,
    /// The backend's own identifier for the row, redacted for reporting.
    pub identifier: String,
    pub scan_number: Option<u64>,
    pub ms_level: u32,
    pub retention_time: RetentionTimeDto,
    pub base_peak_mz: f64,
    pub base_peak_intensity: f64,
    pub total_ion_current: f64,
    pub precursor_mz: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumTableDto {
    pub rows: Vec<SpectrumRowDto>,
    pub total_row_count: usize,
    /// True when `total_row_count` exceeded the transfer bound and the rows
    /// above are a prefix rather than the whole table.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDto {
    /// Where the sequence of backend changes stood when this was read.
    ///
    /// An open is a look at the backend, so it can be the first thing to see a
    /// change and can advance the sequence itself. Without carrying that, a
    /// caller comparing a later verdict against what it last applied would read
    /// this open's own advance as a change that happened after it, and discard
    /// the very preview that produced it.
    pub installation_generation: u64,
    pub file: SelectedFileDto,
    pub metadata: MetadataDto,
    pub run_summary: RunSummaryDto,
    pub spectrum_table: SpectrumTableDto,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrecursorDto {
    pub index: u64,
    pub mz: f64,
    pub intensity: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedSpectrumDto {
    pub index: u64,
    pub scan_number: Option<u64>,
    pub identifiers: Vec<String>,
    pub ms_level: u32,
    pub retention_time: RetentionTimeDto,
    pub point_count: usize,
    pub mz: Vec<f64>,
    pub intensity: Vec<f64>,
    pub mz_low: f64,
    pub mz_high: f64,
    pub base_peak_mz: f64,
    pub base_peak_intensity: f64,
    pub total_ion_current: f64,
    pub precursors: Vec<PrecursorDto>,
    /// How many precursors the spectrum really has, which can exceed
    /// `precursors`.
    pub total_precursor_count: usize,
    pub precursors_truncated: bool,
    /// The backend emitted no profile/centroid marker for a selected spectrum,
    /// so representation stays unknown rather than being guessed.
    pub representation_known: bool,
    /// The backend emitted no unit for the arrays, so no unit is displayed.
    pub value_units_known: bool,
    pub truncated: bool,
}

/// A selected-spectrum request either produced a spectrum or produced the
/// backend's typed "this index does not exist" answer. A spectrum with no peaks
/// is the first case, not the second.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum SelectedSpectrumOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Spectrum { spectrum: Box<SelectedSpectrumDto> },
    #[serde(rename_all = "camelCase")]
    Unavailable { requested_index: u64 },
}

/// A bounded, path-free failure the webview may display.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewErrorDto {
    pub kind: String,
    pub summary: String,
    pub detail: Option<String>,
    pub retryable: bool,
}

impl PreviewErrorDto {
    pub fn new(kind: impl Into<String>, summary: impl Into<String>, retryable: bool) -> Self {
        Self {
            kind: kind.into(),
            summary: summary.into(),
            detail: None,
            retryable,
        }
    }

    #[must_use]
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        self.detail = Some(bounded_text(&detail, MAX_ERROR_DETAIL_CHARS));
        self
    }
}

/// Truncates on a character boundary and marks the truncation, so a long line
/// can never smuggle unbounded backend text through the boundary.
pub fn bounded_text(value: &str, maximum_chars: usize) -> String {
    if value.chars().count() <= maximum_chars {
        return value.to_owned();
    }
    let mut bounded = value.chars().take(maximum_chars).collect::<String>();
    bounded.push('…');
    bounded
}

/// Replaces every absolute-path-shaped token with a placeholder.
///
/// The session redactor only knows the path the user just opened, but an mzML
/// document commonly records the absolute path it was created from. Displaying
/// that would put a filesystem path the user did not choose in front of them
/// and into anything they later copy out, so path shapes are removed generally
/// rather than only where they are already known.
/// Everything from the first path marker to the end of the line is replaced,
/// because where a path ends cannot be decided: `D:\Program Files\run.raw`
/// contains a space, and stopping at the first one would leave `Files\run.raw`
/// on screen. Losing the tail of a line is the acceptable cost; leaking a
/// filesystem path the user did not choose to reveal is not.
#[must_use]
pub fn redact_absolute_paths(value: &str) -> String {
    value.split_inclusive('\n').map(redact_line).collect()
}

/// Punctuation that separates a key from its value in backend text.
///
/// Distinct from whitespace: after one of these the value begins immediately,
/// whatever its first character is.
const fn is_strong_boundary(byte: u8) -> bool {
    matches!(
        byte,
        b'=' | b'"' | b'\'' | b'(' | b'[' | b'{' | b'<' | b',' | b';' | b'|' | b':'
    )
}

/// Whether the slash at `index` opens the `//` of a URI authority.
///
/// Only that exact shape is exempt, rather than every slash after a colon: an
/// mzML field written as `source:/home/alice/run.raw` is a path, while
/// `http://psi.hupo.org/ms/mzml` is a vocabulary reference worth keeping.
fn starts_uri_authority(bytes: &[u8], index: usize) -> bool {
    if bytes.get(index) != Some(&b'/') || bytes.get(index + 1) != Some(&b'/') || index == 0 {
        return false;
    }
    if bytes.get(index - 1) != Some(&b':') {
        return false;
    }
    let mut scheme_start = index - 1;
    while scheme_start > 0
        && bytes
            .get(scheme_start - 1)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
    {
        scheme_start -= 1;
    }
    // A scheme is at least one character and starts with a letter.
    scheme_start < index - 1 && bytes.get(scheme_start).is_some_and(u8::is_ascii_alphabetic)
}

fn redact_line(line: &str) -> String {
    let body = line.strip_suffix('\n').unwrap_or(line);
    let terminator = if body.len() == line.len() { "" } else { "\n" };
    match find_path_start(body) {
        Some(start) => format!("{}<path>{terminator}", &body[..start]),
        None => line.to_owned(),
    }
}

/// Finds the first byte offset at which an absolute path begins.
///
/// Markers are recognized anywhere in the line, not only at a token start,
/// because mzML metadata routinely writes them as `key=<path>` or inside
/// quotes.
fn find_path_start(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    for (index, _) in line.char_indices() {
        let preceding = if index == 0 {
            None
        } else {
            bytes.get(index - 1)
        };
        let after_boundary = preceding.is_none_or(|byte| !byte.is_ascii_alphanumeric());

        // Compared as bytes, never sliced as text: `index + 5` is not
        // necessarily a character boundary, and an mzML field may legitimately
        // hold non-ASCII. Slicing there would panic on a valid document.
        if after_boundary
            && bytes
                .get(index..index + 5)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"file:"))
        {
            return Some(index);
        }

        // A UNC root, or a POSIX-absolute root, which carries a single leading
        // slash: an mzML written on Linux or macOS records `/home/...` and is
        // just as revealing when previewed on Windows. The preceding-boundary
        // test keeps `m/z`, `counts/second` and a bare `a / b` readable, and
        // the next character must be able to start a path segment.
        if matches!(bytes.get(index), Some(b'\\' | b'/'))
            && preceding.is_none_or(|byte| {
                // Backend text brackets and separates values in several ways,
                // including `key:value`, so a colon counts as a boundary too.
                // Only the `://` of a URI authority is exempt, below.
                byte.is_ascii_whitespace() || is_strong_boundary(*byte)
            })
            && !starts_uri_authority(bytes, index)
            // What may follow depends on what came before. After a strong
            // boundary the value starts here whatever its first character is,
            // so a directory whose name begins with a space is still a path.
            // After whitespace, another space means this is prose — the
            // `a / b` this test exists to leave alone — and not a root.
            //
            // A whitelist of filename characters would be the wrong shape
            // either way: `$HOME`, `@archive` and non-ASCII names are all
            // ordinary segments, and a list of what is allowed will always be
            // missing something.
            && bytes.get(index + 1).is_some_and(|byte| {
                !byte.is_ascii_whitespace()
                    || preceding.is_some_and(|preceding| is_strong_boundary(*preceding))
            })
        {
            return Some(index);
        }

        if after_boundary
            && bytes.get(index).is_some_and(u8::is_ascii_alphabetic)
            && bytes.get(index + 1) == Some(&b':')
            && matches!(bytes.get(index + 2), Some(b'\\' | b'/'))
        {
            return Some(index);
        }
    }
    None
}

/// Rejects any value that cannot round-trip through JSON.
///
/// The typed parsers already refuse non-finite numbers, so reaching this is a
/// contract violation rather than ordinary input; it fails closed instead of
/// serializing a null the frontend would read as a measured value.
pub fn require_finite(value: f64) -> Result<f64, PreviewErrorDto> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(PreviewErrorDto::new(
            "non_finite_value",
            "The backend result contained a value that cannot be displayed.",
            false,
        ))
    }
}

pub fn require_finite_option(value: Option<f64>) -> Result<Option<f64>, PreviewErrorDto> {
    value.map(require_finite).transpose()
}
