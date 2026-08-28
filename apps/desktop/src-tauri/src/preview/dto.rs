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
/// no `unknown`: a member that exists here is a claim the product understands
/// the data behind it, backed by measured conversion evidence.
///
/// Two of the four are product-reachable. `shimadzu_lcd` and `sciex_wiff` are
/// not, and are here only because this enumeration is total over the families
/// Rust can admit and every roster row carries one. ADR 0019 records why the
/// alternatives are worse, and ADR 0023 applies the same reasoning to the
/// bundle family: reporting such a row as another family would make the roster
/// lie about what it holds, and adding an unknown member would make every row's
/// family a thing the interface has to guess about. No ingestion surface, queue
/// eligibility or action reaches it, and the interface labels it and offers
/// nothing.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatasetSourceKindDto {
    Mzml,
    ThermoRaw,
    /// Admitted privately, product-unreachable. See ADR 0019.
    ShimadzuLcd,
    /// Admitted privately, product-unreachable, and the first family whose
    /// dataset is a bundle rather than a file. See ADR 0023.
    ///
    /// Here for the same structural reason `shimadzu_lcd` is: every roster row
    /// carries a family and the projection is total over what Rust can admit.
    /// It is not a support claim. Nothing a user can do creates a row of this
    /// family, the queue does not accept one, and the label exists so that a
    /// row which cannot occur would still be described honestly rather than as
    /// something else.
    SciexWiff,
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

/// Which output one adoption outcome is about.
///
/// An item index alone stopped identifying an outcome the moment one item could
/// hold ten of them. The member index is the position within that item's own
/// output set, in publication order, and is zero for a known single output —
/// which is a real position rather than a filler, because such an item has
/// exactly one member and it is the first.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionCandidateIdentityDto {
    pub item_index: usize,
    pub member_index: usize,
}

/// What one finalized output did when the user asked to adopt it.
///
/// Closed and path-free. Every member names a queue item by facts the webview
/// already has -- its position, its member position within that item and the
/// row it was converted from -- plus the output name. None of them carries
/// where the file is, and only `added` and `alreadyInWorkspace` carry a
/// workspace row, because they are the only two outcomes that have one.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkspaceOutputAdoptionOutcomeDto {
    /// A new row. The queue's own result is unchanged by this.
    #[serde(rename_all = "camelCase")]
    Added {
        #[serde(flatten)]
        candidate: AdoptionCandidateIdentityDto,
        source_handle: String,
        output_file_name: String,
        dataset: SelectedFileDto,
    },
    /// The session already holds this exact object, by whatever route it
    /// arrived. The existing row is returned as it stands.
    #[serde(rename_all = "camelCase")]
    AlreadyInWorkspace {
        #[serde(flatten)]
        candidate: AdoptionCandidateIdentityDto,
        source_handle: String,
        output_file_name: String,
        dataset: SelectedFileDto,
    },
    /// Nothing was added, and this says only which of the honest reasons it was.
    #[serde(rename_all = "camelCase")]
    Refused {
        #[serde(flatten)]
        candidate: AdoptionCandidateIdentityDto,
        source_handle: String,
        output_file_name: String,
        /// One of `output_missing`, `output_changed`, `output_unreadable`,
        /// `output_not_mzml` or `workspace_full`. Stable, and never an OS error.
        reason: String,
    },
}

/// What adopting a terminal queue's finalized outputs did.
///
/// The roster is authoritative and complete, like every other workspace answer:
/// a caller adopts it whole rather than splicing added rows into a list it
/// already had.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOutputAdoptionResultDto {
    /// Which queue this describes, and which settling of it.
    ///
    /// Both, because neither alone identifies the result. A retry settles the
    /// same operation a second time, and it can finish between two reads -- so a
    /// caller holding this beside a queue needs to know it is the same round,
    /// not merely the same queue in the same state.
    pub operation_id: String,
    pub retry_round: u64,
    pub roster: WorkspaceRosterDto,
    pub outcomes: Vec<WorkspaceOutputAdoptionOutcomeDto>,
}

/// There is no terminal queue of this caller's whose outputs could be adopted.
///
/// One refusal for a stale document, an unknown or superseded operation, a
/// queue still running, and no queue at all. Telling them apart would describe
/// session state to a caller that by construction is not the one holding it.
#[must_use]
pub fn outputs_not_adoptable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "outputs_not_adoptable",
        "There are no converted outputs of yours to add.",
        false,
    )
}

/// Another adoption of the same queue is already under way.
#[must_use]
pub fn adoption_in_progress() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "adoption_in_progress",
        "MSCanvas is already adding this queue's converted outputs.",
        false,
    )
}

/// The workspace changed while the outputs were being checked, so nothing was
/// added.
///
/// Retryable by construction: the outputs are still on disk and the queue is
/// still terminal, so asking again is the whole of the recovery.
#[must_use]
pub fn adoption_superseded() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "adoption_superseded",
        "The workspace changed while MSCanvas was checking the converted outputs. Nothing was \
         added. Try again.",
        true,
    )
}

/// One Rust-issued claim on the right to choose where diagnostics are saved.
///
/// Opaque, path-free and single-use, exactly like the conversion reservation it
/// is modelled on. It grants no filesystem authority: what it names is one bound
/// decision Rust already made -- which terminal queue, which settling of it, for
/// which document -- so the save dialog that follows cannot be about anything
/// else.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionDiagnosticsReservationDto {
    pub reservation_id: String,
}

/// What one diagnostics export wrote.
///
/// A name, a length and a digest. Deliberately not a location: the user chose
/// the folder and knows where it is, and putting it here would hand the webview
/// the one thing this whole boundary exists to keep from it.
///
/// The digest is what makes the answer checkable. Someone about to send this
/// file somewhere can confirm that the bytes they are sending are the bytes
/// MSCanvas measured, which is the only claim it can make about a file it no
/// longer holds.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionDiagnosticsExportDto {
    /// Which queue this describes, and which settling of it.
    ///
    /// Both, for the reason an adoption result carries both: a retry settles
    /// the same operation a second time, so a caller holding this beside a
    /// queue needs to know it is the same round.
    pub operation_id: String,
    pub retry_round: u64,
    pub file_name: String,
    pub byte_length: u64,
    pub sha256: String,
    pub diagnostic_item_count: usize,
}

/// What a document may know about diagnostics for the queue it is reading.
///
/// Rides on the conversion read for the reason the quarantine flag does: a
/// document already asks for that on mount and while work is under way, so a
/// reload recovers this with the queue rather than needing a second question.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionDiagnosticsStateDto {
    /// How many items of the current queue an export would describe.
    ///
    /// Zero unless the queue is terminal, which is what makes the action's
    /// availability a projection of Rust's own rule rather than a second one
    /// the interface maintains.
    pub eligible_item_count: usize,
    /// True when the queue is terminal and there is something to export.
    ///
    /// Carried rather than derived from the count, because a stop-failed queue
    /// is exportable for what the queue itself records even where no item
    /// carries a diagnostic of its own.
    pub available: bool,
    /// Whether an export is between being asked for and being finished.
    pub exporting: bool,
    /// The last export of the current queue. Dropped when the queue is
    /// replaced; the file it names is not.
    pub last_export: Option<ConversionDiagnosticsExportDto>,
}

/// There is no terminal queue of this caller's whose diagnostics could be
/// exported.
///
/// One refusal for a stale document, an unknown or superseded operation, a
/// queue still under way, a queue with nothing worth describing, and no queue at
/// all -- the same collapse `outputs_not_adoptable` makes, for the same reason:
/// telling them apart would describe session state to a caller that by
/// construction is not the one holding it.
#[must_use]
pub fn diagnostics_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_unavailable",
        "There are no conversion diagnostics of yours to save.",
        false,
    )
}

/// The reservation does not name a diagnostics export this document may make.
#[must_use]
pub fn invalid_diagnostics_reservation() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "invalid_diagnostics_reservation",
        "That diagnostics export is no longer valid. Ask for it again.",
        false,
    )
}

/// Another diagnostics export is already under way.
#[must_use]
pub fn diagnostics_export_in_progress() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_export_in_progress",
        "MSCanvas is already saving diagnostics for this queue.",
        false,
    )
}

/// The queue changed between choosing a destination and writing, so nothing was
/// written.
///
/// Retryable by construction where the queue survived: asking again is the whole
/// of the recovery.
#[must_use]
pub fn diagnostics_export_superseded() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_export_superseded",
        "The conversion queue changed while MSCanvas was saving diagnostics. Nothing was written. \
         Try again.",
        true,
    )
}

/// Another export of this session has not finished.
///
/// One at a time, so two save dialogs cannot be open over one spectrum and two
/// writes cannot race for one name.
#[must_use]
pub fn spectrum_export_in_progress() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_export_in_progress",
        "MSCanvas is already exporting this spectrum.",
        false,
    )
}

/// The named spectrum is not the one this session holds.
///
/// Retryable, and the recovery is ordinary: the spectrum on screen has its own
/// token, so selecting it again -- or simply exporting the one that is there --
/// works. Nothing is written from a spectrum other than the one asked for.
#[must_use]
pub fn spectrum_export_stale() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_export_stale",
        "That spectrum is no longer the one MSCanvas has loaded, so nothing was exported. \
         Select the spectrum again and export it.",
        true,
    )
}

/// The spectrum a viewport asked to draw is not the one this session holds.
///
/// Retryable, and the recovery is the same as the export lane's: the spectrum on
/// screen has its own token. A projection is never answered from whichever
/// spectrum happens to be current now.
#[must_use]
pub fn spectrum_projection_stale() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_projection_stale",
        "That spectrum is no longer the one MSCanvas has loaded, so nothing was drawn. \
         Select the spectrum again.",
        true,
    )
}

/// A viewport asked to draw a spectrum that has no m/z domain.
///
/// Not retryable: it is a fact about this spectrum rather than about the
/// moment, and asking again produces the same verdict. The source is unharmed
/// and still exports as data.
#[must_use]
pub fn spectrum_projection_no_domain() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_projection_no_domain",
        "This spectrum has no m/z range MSCanvas can navigate without changing the \
         measurement, so it has no viewport. Its data can still be exported as CSV or TSV.",
        false,
    )
}

/// A viewport asked for a window the retained spectrum does not have.
///
/// Refused rather than clamped to the nearest window that would fit, for the
/// reason the chromatogram's range gives: answering with a different window
/// answers a question nobody asked. Not retryable as asked -- the recovery is a
/// window this spectrum has, which resetting the viewport always is.
#[must_use]
pub fn spectrum_projection_window_refused() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_projection_window_refused",
        "That m/z range is not one this spectrum has, so nothing was drawn. Reset the \
         range to see the whole spectrum.",
        false,
    )
}

/// Another scientific export of this session has not finished.
///
/// One lane for the selected spectrum and the chromatogram together, so two
/// save dialogs cannot be open over one window and a clipboard rasterization
/// cannot race a file write.
#[must_use]
pub fn scientific_export_in_progress() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "scientific_export_in_progress",
        "MSCanvas is already exporting. Finish or cancel that export first.",
        false,
    )
}

/// The named chromatogram is not the one this session holds.
///
/// Retryable, and the recovery is ordinary: the chromatogram on screen has its
/// own token, so opening the preview again -- or simply exporting the one that
/// is there -- works. Nothing is written from a run other than the one asked
/// for, and no token is ever rebound to whatever is current now.
#[must_use]
pub fn chromatogram_export_stale() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "chromatogram_export_stale",
        "That chromatogram is no longer the one MSCanvas has loaded, so nothing was exported. \
         Open the preview again and export it.",
        true,
    )
}

/// The requested range is not one this run covers.
///
/// Refused rather than clamped. A window outside the run is a request about a
/// different run, and quietly exporting the nearest range this one does have
/// would answer a question nobody asked -- in a file that would look like the
/// answer to the one they did.
#[must_use]
pub fn chromatogram_range_outside_source() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "chromatogram_range_outside_source",
        "That retention-time range is not inside the run MSCanvas has loaded, so nothing was \
         exported.",
        true,
    )
}

/// A figure was asked for with neither trace visible.
///
/// Retryable, and the recovery is on screen: show a trace. The data exports are
/// unaffected, because hiding a trace is a choice about a plot rather than a
/// decision to leave measured science out of a file.
#[must_use]
pub fn chromatogram_no_visible_trace() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "chromatogram_no_visible_trace",
        "A chromatogram figure needs at least one visible trace. Show TIC or BPC, or export the \
         data instead.",
        true,
    )
}

/// The specification refused the chromatogram, so no figure was drawn.
#[must_use]
pub fn chromatogram_export_refused() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "chromatogram_export_refused",
        "MSCanvas could not build a figure this chromatogram can be drawn in honestly, so no \
         file was written.",
        false,
    )
}

/// The specification refused the spectrum, so no figure was drawn.
///
/// Not retryable: the same reading will be refused the same way. It is a fact
/// about the spectrum rather than about the moment.
#[must_use]
pub fn spectrum_export_refused() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_export_refused",
        "MSCanvas could not build a figure this spectrum can be drawn in honestly, so no file \
         was written.",
        false,
    )
}

/// The native save dialog could not be shown.
#[must_use]
pub fn spectrum_picker_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_picker_unavailable",
        "MSCanvas could not open the save dialog, so nothing was exported.",
        true,
    )
}

/// A file of that name is already there, and MSCanvas replaced nothing.
#[must_use]
pub fn spectrum_destination_exists(temporary_left_behind: bool) -> PreviewErrorDto {
    with_residue(
        PreviewErrorDto::new(
            "spectrum_destination_exists",
            "A file of that name is already in that folder. MSCanvas did not replace it. Export \
             under another name.",
            true,
        ),
        temporary_left_behind,
    )
}

/// The chosen folder is not one this boundary will create a file in.
#[must_use]
pub fn spectrum_destination_unusable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "spectrum_destination_unusable",
        "MSCanvas exports to a folder on this computer's own drives. Choose a local folder that is \
         not a link.",
        true,
    )
}

/// The bytes could not be written.
#[must_use]
pub fn spectrum_not_written(temporary_left_behind: bool) -> PreviewErrorDto {
    with_residue(
        PreviewErrorDto::new(
            "spectrum_not_written",
            "MSCanvas could not write the export. Nothing was saved under the name you chose.",
            true,
        ),
        temporary_left_behind,
    )
}

/// The bytes were written and could not be given the chosen name.
#[must_use]
pub fn spectrum_not_finalized(temporary_left_behind: bool) -> PreviewErrorDto {
    with_residue(
        PreviewErrorDto::new(
            "spectrum_not_finalized",
            "MSCanvas wrote the export and could not give it the name you chose, so nothing was \
             saved under that name.",
            true,
        ),
        temporary_left_behind,
    )
}

/// A save destination whose name does not say what the file holds.
///
/// Carries the sentence the dialog's own facts produced -- which extension to
/// use, for which document -- and nothing about where the user was working. A
/// refusal is not a place to disclose a path.
///
/// Retryable, because it is: the user chooses another name and the export
/// begins again.
#[must_use]
pub fn spectrum_destination_misnamed(guidance: &str) -> PreviewErrorDto {
    PreviewErrorDto::new("spectrum_destination_misnamed", guidance, true)
}

/// The same refusal for the one document that is not an export of science.
#[must_use]
pub fn diagnostics_destination_misnamed() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_destination_misnamed",
        "Choose a filename ending in .json for a JSON export.",
        true,
    )
}

/// Neither source a linked figure names is still the one on screen.
#[must_use]
pub fn linked_figure_stale() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "linked_figure_stale",
        "That chromatogram or selected spectrum is no longer the one on screen. Select the scan \
         again and retry the linked figure.",
        true,
    )
}

/// The two sources named do not describe one scan of one run.
///
/// Its own refusal rather than a rendering failure: nothing was wrong with the
/// drawing, and telling a user their figure could not be drawn would send them
/// to change a setting that was never the problem.
#[must_use]
pub fn linked_figure_source_mismatch() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "linked_figure_source_mismatch",
        "That selected spectrum is not a scan of the chromatogram on screen. Select a scan from \
         this run and retry the linked figure.",
        true,
    )
}

/// The scan the figure would link to is not inside the range it would draw.
#[must_use]
pub fn linked_selection_outside_range() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "linked_selection_outside_range",
        "The selected scan is outside the current chromatogram range. Choose Full run, or move \
         the current range to include the selected scan.",
        true,
    )
}

/// The contract refused the two panels, so no linked figure was drawn.
///
/// Its own refusal rather than either half's. The boundary knows the *figure*
/// could not be built and does not know which panel refused it -- and answering
/// with the chromatogram's would send a reader to change a range or a trace
/// toggle that had nothing to do with it.
///
/// **The route out is named because it works.** The reachable case is a scan
/// whose m/z array is not ordered: mzML does not require one and nothing here
/// sorts one, and the figure contract will not draw an unordered series. So the
/// spectrum's own *figure* is refused for the same reason by the same
/// `spectrum_panel`, and offering it as the fallback would send a reader to an
/// action that cannot work. Its **data** export is a different path -- one
/// record per retained source point, in source order, needing no ordering at
/// all -- and the chromatogram beside it was already proved drawable when this
/// session installed it. Those two are what this sentence offers.
///
/// Not retryable: the same pair will be refused the same way. It is a fact about
/// the two sources rather than about the moment.
#[must_use]
pub fn linked_figure_not_drawable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "linked_figure_not_drawable",
        "MSCanvas could not build the linked figure without changing the data, so no file was \
         written. Export the chromatogram separately, and export the selected spectrum as CSV \
         or TSV data.",
        false,
    )
}

/// The figure is too short to hold a chromatogram and a spectrum.
#[must_use]
pub fn linked_figure_too_short() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "linked_figure_too_short",
        "A two-panel linked figure needs a height of at least 260. Increase the height, or \
         export the chromatogram and the spectrum separately.",
        true,
    )
}

/// The chosen folder is not one this boundary will create a file in.
#[must_use]
pub fn diagnostics_destination_unusable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_destination_unusable",
        "MSCanvas saves diagnostics to a folder on this computer's own drives. Choose a local \
         folder that is not a link.",
        true,
    )
}

/// What a failed export left behind, said once so every failure says it the
/// same way.
///
/// Attached as the detail rather than folded into the reason, so a write that
/// failed and a write that failed *and* left something in the user's folder are
/// distinguishable to a reader and to a test. Hiding the second inside the first
/// would drop the only part of the failure the user has to act on.
const DIAGNOSTICS_TEMPORARY_LEFT_BEHIND: &str = "MSCanvas also left a temporary file whose name begins with \".mscanvas-export-\" in that \
     folder and could not remove it.";

fn with_residue(error: PreviewErrorDto, temporary_left_behind: bool) -> PreviewErrorDto {
    if temporary_left_behind {
        return error.with_detail(DIAGNOSTICS_TEMPORARY_LEFT_BEHIND);
    }
    error
}

/// A file of that name is already there, and MSCanvas replaced nothing.
#[must_use]
pub fn diagnostics_destination_exists(temporary_left_behind: bool) -> PreviewErrorDto {
    with_residue(
        PreviewErrorDto::new(
            "diagnostics_destination_exists",
            "A file of that name is already in that folder. MSCanvas did not replace it. Save the \
             diagnostics under another name.",
            true,
        ),
        temporary_left_behind,
    )
}

/// The bytes could not be written, or could not be forced to the disk.
#[must_use]
pub fn diagnostics_not_written(temporary_left_behind: bool) -> PreviewErrorDto {
    with_residue(
        PreviewErrorDto::new(
            "diagnostics_not_written",
            "MSCanvas could not write the diagnostics file. Nothing was saved under the name you \
             chose.",
            true,
        ),
        temporary_left_behind,
    )
}

/// The bytes were written and the file could not be given its final name.
#[must_use]
pub fn diagnostics_not_finalized(temporary_left_behind: bool) -> PreviewErrorDto {
    with_residue(
        PreviewErrorDto::new(
            "diagnostics_not_finalized",
            "MSCanvas wrote the diagnostics and could not give the file the name you chose, so \
             nothing was saved under it.",
            true,
        ),
        temporary_left_behind,
    )
}

/// The document is larger than one diagnostics file may be.
///
/// Fails closed and writes nothing. A structurally incomplete JSON document is
/// not a smaller diagnostics file; it is a file no reader can open, offered in
/// exchange for hiding the fact that the bound was reached.
#[must_use]
pub fn diagnostics_too_large() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_too_large",
        "These diagnostics are larger than one MSCanvas file may be, so nothing was saved.",
        false,
    )
}

/// The native save dialog could not be shown.
#[must_use]
pub fn diagnostics_picker_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "diagnostics_picker_unavailable",
        "The save dialog could not be opened, so nothing was saved.",
        true,
    )
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
    /// What this document may know about saving diagnostics for that queue.
    pub diagnostics: ConversionDiagnosticsStateDto,
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
    /// How many output **files** a complete-set adoption of this queue would
    /// offer -- not how many items hold one.
    ///
    /// Counted by Rust from the authorities it actually holds, because that is
    /// the only place the answer lives: one finalized Thermo item offers one,
    /// one finalized ten-member SCIEX item offers ten, and an interface counting
    /// finalized items would offer to add ten files and call it one. Zero unless
    /// the queue is terminal, which is what makes the action's availability a
    /// projection of Rust's own rule rather than a second one the interface
    /// maintains.
    pub adoptable_output_count: usize,
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
    /// What this item's outputs will look like. For a known single output the
    /// name was derived before the queue was created, so two items that would
    /// produce the same name in one folder are refused there rather than
    /// discovered here. A backend-named set carries no name, because none
    /// exists until the run has finished.
    pub output: ConversionOutputPlanDto,
    pub state: ConversionQueueItemStateDto,
    /// How many times this item has been attempted. One after the first pass.
    pub attempts: u64,
    pub retryable: bool,
    /// The latest attempt's result, in the cardinality it had, when an attempt
    /// reached a conversion. Only the latest: an attempt history would be an
    /// unbounded one, and nothing in this workflow reads a second entry.
    pub result: Option<ConversionAttemptResultDto>,
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
    /// Whether MSCanvas knows that no converter process of this attempt
    /// survives.
    ///
    /// True when the owned process tree was terminated and observed empty, and
    /// true when no process was created for there to be a tree. False is the
    /// whole reason `cancellationFailed` exists, and it is the one condition
    /// that quarantines the session.
    pub tree_termination_confirmed: bool,
    /// How long the accepted stop took to produce a result. Milliseconds,
    /// matching the one time format already on this wire, and deliberately not
    /// how long the attempt had been running before the request.
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
    /// The family this row was admitted as, snapshotted into the plan.
    ///
    /// On the plan and not only on the started queue, because a queue may now
    /// mix families and the user reviewing the plan is entitled to see which
    /// row is which before choosing a folder. The interface reads it from
    /// here rather than rediscovering it from the live roster, so the plan it
    /// shows is the immutable one the queue will run.
    pub source_kind: DatasetSourceKindDto,
    /// What this row will produce, in the cardinality it will produce it.
    pub output: ConversionOutputPlanDto,
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

/// What one queue item's outputs will look like, before it runs.
///
/// Two named cases on the wire, for the reason the private topology has two:
/// `None` would have to mean unknown, absent, failed and multi-output at once,
/// and an empty string would be a filename that is not one. A reader must
/// choose an arm to render anything at all, so a blank output column is
/// unrepresentable rather than merely avoided.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversionOutputPlanDto {
    /// One document, named before anything runs, from the source row's own
    /// display name.
    #[serde(rename_all = "camelCase")]
    KnownSingle { file_name: String },
    /// One to `max_members` documents the backend names itself.
    ///
    /// **No name is carried, because none exists.** Not the acquisition's stem,
    /// not the sample count, not a placeholder ending in `.mzML`.
    #[serde(rename_all = "camelCase")]
    BackendNamedSet { max_members: usize },
}

/// The latest attempt's result, in the cardinality it actually had.
///
/// Absent means only "no attempt result exists". A queue item never carries a
/// single report and a group report at once, and this is what makes that
/// unrepresentable rather than a rule two nullable fields would have to keep.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversionAttemptResultDto {
    #[serde(rename_all = "camelCase")]
    Single { report: ConversionReportDto },
    #[serde(rename_all = "camelCase")]
    OutputSet {
        report: ConversionOutputSetReportDto,
    },
}

/// What one backend-named set's attempt did, in facts that name no location.
///
/// Counts, stable identifiers and the backend's chosen basenames. Bounded by
/// the lifecycle's own output bound, so this cannot grow past what one
/// conversion may produce.
///
/// The basenames are here deliberately and are the one judgement call in this
/// shape. They are the user's data, so they stay out of generic `Debug` and out
/// of the diagnostics export — but a user looking at a result that says "ten
/// outputs finalized" and cannot see which ten has been told a number rather
/// than an answer, and the roster beside it will spell every one of them out the
/// moment the set is adopted. Redacting them here while doing that would be
/// theatre. See ADR 0026 for why the export makes the opposite call.
///
/// `Debug` is written out rather than derived, and that is the whole of what
/// keeps the sentence above true: this value is reachable from the queue
/// transfer object, which is reachable from the update the session logs, so a
/// derived one would print every member basename into any log that rendered a
/// conversion. Serializing to the webview is a decision; a debug string is not.
#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOutputSetReportDto {
    pub dataset_handle: String,
    pub source_kind: DatasetSourceKindDto,
    /// What the run did to the set as a whole, by the conversion boundary's own
    /// identifier.
    pub group_outcome: String,
    /// The precise refusal, when the set was refused before anything published.
    pub detailed_outcome: Option<String>,
    /// The lifecycle's bound, so a reader sees the counts are bounded rather
    /// than having to know the constant.
    pub max_members: usize,
    pub member_count: usize,
    pub finalized_count: usize,
    /// Members that passed validation and were never published — the shape a
    /// refusal after validation leaves.
    pub validated_not_published_count: usize,
    pub not_published_count: usize,
    /// How many filesystem objects the acquisition was held to for the run.
    ///
    /// `None` where it never was, which is every refusal that happened before
    /// the source was opened. Zero would say it was bound to nothing.
    pub bound_source_objects: Option<usize>,
    /// The basenames the backend chose, in publication order. Never a
    /// directory, never a path, and bounded by `max_members`.
    pub member_file_names: Vec<String>,
    /// How each member ended, by the boundary's own identifier, positionally
    /// matched to `member_file_names`.
    pub member_states: Vec<String>,
    pub backend: Option<ConversionBackendFactsDto>,
    pub staging_residue: Option<String>,
    /// Always `output_only` for this family, carried rather than implied: a
    /// vendor acquisition has no mzML reading, so nothing about any output was
    /// compared to the source.
    pub validation_mode: ValidationModeDto,
    /// Whether every sample the reader identified produced its output.
    pub completeness: ConversionSampleCompletenessDto,
    /// Present exactly for a partial publication.
    pub partial: Option<ConversionPartialFinalizationDto>,
    /// Whether a complete output-set adoption authority exists for this item.
    ///
    /// Carried rather than derived from the outcome, because the two are
    /// deliberately not the same question: a fully finalized set whose
    /// completeness was not established has no authority, and an interface
    /// deriving one from the other would offer an action Rust will refuse.
    pub complete_set_adoptable: bool,
    pub installation_generation: u64,
}

impl std::fmt::Debug for ConversionOutputSetReportDto {
    /// Shape, counts and stable identifiers. Never a member basename.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConversionOutputSetReportDto")
            .field("dataset_handle", &self.dataset_handle)
            .field("source_kind", &self.source_kind)
            .field("group_outcome", &self.group_outcome)
            .field("detailed_outcome", &self.detailed_outcome)
            .field("member_count", &self.member_count)
            .field("finalized_count", &self.finalized_count)
            .field(
                "validated_not_published_count",
                &self.validated_not_published_count,
            )
            .field("not_published_count", &self.not_published_count)
            .field("bound_source_objects", &self.bound_source_objects)
            // States, not names. Which member ended how is a fact about the
            // run; what it is called is a fact about the acquisition.
            .field("member_states", &self.member_states)
            .field("staging_residue", &self.staging_residue)
            .field("completeness", &self.completeness)
            .field("partial", &self.partial)
            .field("complete_set_adoptable", &self.complete_set_adoptable)
            .finish_non_exhaustive()
    }
}

/// Whether every sample the SCIEX reader identified produced its output.
///
/// Deliberately not a boolean and deliberately narrow. `Established` says what
/// it says and no more: it is a statement about the samples `Reader_ABI`
/// identified, not about the samples in the acquisition, and not about how
/// faithfully any document represents one.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversionSampleCompletenessDto {
    /// The question was never posed, which is every run that never reached the
    /// audit.
    NotPosed,
    /// The run did not support the claim. Not a statement that the acquisition
    /// was incomplete.
    #[serde(rename_all = "camelCase")]
    NotEstablished { reason: String },
    /// Proved, and by what.
    #[serde(rename_all = "camelCase")]
    Established {
        /// The audit's stable identifier — the method, not a sentence.
        method: String,
        /// How many samples the reader identified and converted.
        sample_count: usize,
    },
}

/// Where a non-atomic publication stopped.
///
/// Counts and the filesystem's own kind. The finalized prefix is the user's
/// files: nothing removes, hides or supersedes them, and this says how many
/// there are without saying what they are called.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionPartialFinalizationDto {
    pub finalized_count: usize,
    pub not_published_count: usize,
    /// What the filesystem said about the member that failed, by stable
    /// identifier. Never an OS message.
    pub failure_kind: String,
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

/// One item's output name is already owned by another item of the same queue.
///
/// Distinct from a destination conflict, and deliberately so. What is at that
/// name, if anything, was put there by this very queue moments ago; either way
/// no conflict policy has an opinion about which of two acquisitions should win
/// a name neither of them was promised. Not retryable: the other item owns it
/// just as much on a second attempt.
///
/// Its own identifier rather than `queue_output_name_collision`, because that
/// one is refused before a picker opens and this one can only be discovered
/// while the queue runs -- a backend-named set has no names to compare until it
/// has produced them.
pub(super) fn queue_output_name_claimed(name: &str) -> PreviewErrorDto {
    PreviewErrorDto::new(
        "queue_output_name_claimed",
        "Another acquisition in this queue writes a document with that name.",
        false,
    )
    .with_detail(name)
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
        "MSCanvas is working on the conversion workflow. Wait for it to finish.",
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
    /// The opaque name of the chromatogram this run may be exported as.
    ///
    /// `None` where there is no chromatogram to export, which is exactly where
    /// the viewer draws none: a table this session could not transfer whole, a
    /// run with no spectra, a retention time or an intensity that is not a
    /// finite number, or a unit this build cannot name. Rust retains every row
    /// the backend reported and the webview receives a bounded prefix, so
    /// issuing a token for a run the viewer refuses would open an export door
    /// onto a capability the product does not otherwise have.
    ///
    /// Opaque, session-scoped, and meaningless to anything that did not receive
    /// it here. It is not a path, not a dataset handle and not an index.
    pub chromatogram_export_token: Option<String>,
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
    /// Which retained spectrum this panel's operations name.
    ///
    /// Opaque and session-scoped. It names the complete result Rust kept, not
    /// the possibly shortened arrays beside it, which is the whole point: the
    /// webview can ask for that spectrum to be exported -- or for one window of
    /// it to be drawn -- without being able to supply, or even see, the data the
    /// answer will contain. A token from an earlier selection names a spectrum
    /// this session no longer holds and is refused rather than silently
    /// answered with whatever is current.
    ///
    /// **One identity, two readers.** The scientific export lane and the
    /// viewport's screen projection both resolve this same token against the
    /// same retained snapshot; there is no second source and no second
    /// identity. The field keeps its name because what it names has not
    /// changed, and renaming it would churn every command that carries one
    /// without making anything truer.
    pub export_token: String,
    /// Whether this spectrum has an m/z domain a viewport may navigate.
    ///
    /// Rust's answer, from the complete retained source and the same
    /// admissibility the scientific figure uses. Deliberately not derivable
    /// here: `mz`/`intensity` are bounded for transfer, `mz_low`/`mz_high` are
    /// the backend's separately reported pair which the export renderer refuses
    /// as a domain, and neither can settle the question for a spectrum whose
    /// arrays arrived truncated.
    ///
    /// A refusal is a fact about drawability, never about the source: a
    /// spectrum with no viewport domain is still valid data and still exports
    /// as CSV and TSV.
    pub viewport_domain: SpectrumViewportDomainDto,
}

/// Whether a viewport domain could be established, and what it is.
///
/// Tagged rather than a nullable pair, so "refused" is a state the webview must
/// handle rather than a sentinel it could mistake for a range.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SpectrumViewportDomainDto {
    /// The scientific contract established this domain over the complete
    /// retained source. Finite and forward; `low == high` for a spectrum of one
    /// point, and for one of none.
    #[serde(rename_all = "camelCase")]
    Admitted { low: f64, high: f64 },
    /// No domain could be established without altering the source.
    #[serde(rename_all = "camelCase")]
    Refused { reason: SpectrumDomainRefusalDto },
}

/// Why no viewport domain exists for a spectrum.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SpectrumDomainRefusalDto {
    /// The m/z array is not non-decreasing. mzML permits this; nothing sorts it.
    SourceNotOrdered,
    /// A coordinate cannot be placed on an axis.
    NotFinite,
    /// The two arrays disagree about how many points there are.
    AxisLengthMismatch,
    /// The endpoints do not form a domain the contract accepts.
    DomainUnusable,
}

/// One bounded drawing of one committed m/z window.
///
/// A screen representation and nothing more. Every value came out of the
/// complete retained source, `source_points` says how many observations the
/// window actually holds, and `reduced` says whether fewer are drawn than were
/// measured -- so a reader can see both numbers rather than take the drawing
/// for the measurement. No scientific export is ever taken from one.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumProjectionDto {
    /// The window this drawing answers, echoed back so a late result can be
    /// told from the one the viewport is now committed to.
    pub low: f64,
    pub high: f64,
    pub mz: Vec<f64>,
    pub intensity: Vec<f64>,
    /// How many source observations the window holds. Zero is a real answer.
    pub source_points: usize,
    /// Whether fewer points are drawn than the window measured.
    pub reduced: bool,
}

/// What one selected-spectrum export did.
///
/// Cancelling is one of the outcomes rather than an error: the user was offered
/// a save dialog and closed it, nothing was created, and the spectrum on screen
/// is exactly as it was.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SpectrumExportOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Saved {
        /// `svg`, `png`, `csv` or `tsv`.
        format: String,
        /// The name the file was given, and nothing about where it went.
        file_name: String,
        /// What the figure was rendered as, for the formats that are figures.
        /// `None` for the data documents, which no figure setting reaches.
        figure: Option<ExportedFigureDto>,
        /// How many source points the document carries.
        ///
        /// The complete count. A reader comparing it against the panel's own
        /// `point_count` is comparing two readings of the same spectrum, and a
        /// truncated transfer cannot make them disagree, because this one did
        /// not come from the transfer.
        point_count: usize,
    },
}

/// How much of a run one chromatogram export covers.
///
/// `scope` is `full` or `current`. The two numbers are the committed viewport
/// for a current-range request that has one, and are absent both for a full-run
/// request and for a current-range request whose viewer has committed nothing
/// narrower than the whole run -- a real state, and one Rust resolves rather
/// than the interface inventing a range to fill it.
///
/// Nothing here is a viewport authority. It is a request, checked against the
/// run this session holds before any of it is believed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChromatogramRangeDto {
    pub scope: String,
    pub low: Option<f64>,
    pub high: Option<f64>,
}

/// Which measured traces a chromatogram figure draws.
///
/// The figure shows what is on screen. A data export carries both columns
/// whatever this says, because hiding a trace is a presentation choice about a
/// plot rather than a decision to leave measured science out of a file.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChromatogramTracesDto {
    pub tic: bool,
    pub bpc: bool,
}

/// What one chromatogram export did, in facts a user can be told.
///
/// No path, no dataset handle and no source file name. The range is the one
/// that was resolved when the export began, so a viewport that moved while the
/// dialog was open cannot make this sentence describe a different file.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ChromatogramExportOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Saved {
        /// `svg`, `png`, `csv` or `tsv`.
        format: String,
        /// The name the file was given, and nothing about where it went.
        file_name: String,
        /// What the figure was rendered as, for the formats that are figures.
        figure: Option<ExportedFigureDto>,
        /// The traces the figure drew. `None` for the data documents, which
        /// carry both columns whatever is on screen.
        traces: Option<ChromatogramTracesDto>,
        /// `full` or `current`, as asked for rather than as it resolved. A
        /// current-range export of a viewer that committed nothing writes the
        /// whole run and is still a current-range export.
        range_scope: String,
        /// The retention-time range actually exported over.
        range_low: f64,
        range_high: f64,
        /// How many scans the run holds, from the facts Rust retained rather
        /// than from the rows the webview received.
        source_scan_count: usize,
        /// How many source scans the data document carries. `None` for a
        /// figure, which draws the complete series and declares a window.
        ///
        /// Zero is a successful export: a range can legitimately contain no
        /// scans while the figure still draws a segment crossing it.
        row_count: Option<usize>,
    },
}

/// What a chromatogram figure put on the clipboard was.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ChromatogramCopyOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Copied {
        figure: CopiedFigureDto,
        traces: ChromatogramTracesDto,
        range_scope: String,
        range_low: f64,
        range_high: f64,
        source_scan_count: usize,
    },
}

/// What one linked two-panel figure export did.
///
/// Path-free like every export outcome, and it says which pair it drew: the
/// chromatogram's scope and resolved range, the traces that were on screen, and
/// the selected spectrum by index and retention time. Those last two are the
/// link, so a reader can tell one linked figure from another without opening it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum LinkedFigureExportOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Saved {
        /// `svg` or `png`. A linked figure has no data document.
        format: String,
        /// The name the file was given, and nothing about where it went.
        file_name: String,
        figure: ExportedFigureDto,
        traces: ChromatogramTracesDto,
        /// `full` or `current`, as asked for rather than as it resolved.
        range_scope: String,
        range_low: f64,
        range_high: f64,
        source_scan_count: usize,
        /// Which spectrum the marker names, by its zero-based index in the run.
        selected_index: u64,
        /// Where that scan sits, from the retained table row rather than from
        /// anything the interface reported.
        selected_retention_time: f64,
    },
}

/// What a linked figure put on the clipboard was.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum LinkedFigureCopyOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Copied {
        figure: CopiedFigureDto,
        traces: ChromatogramTracesDto,
        range_scope: String,
        range_low: f64,
        range_high: f64,
        source_scan_count: usize,
        selected_index: u64,
        selected_retention_time: f64,
    },
}

/// The figure settings the interface asked for, as they cross the boundary.
///
/// Integers because these are counts of pixels and a fractional pixel is not
/// something a user asked for. Nothing is trusted here: the boundary reads this
/// into a validated typed value or refuses it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FigureSettingsDto {
    pub width_px: u32,
    pub height_px: u32,
    pub png_dpi: u32,
    /// `light` or `dark`.
    pub theme: String,
}

/// What a figure output was rendered as.
///
/// Reported back so the interface can say what it produced rather than what it
/// requested -- the two are the same here, and saying so is how a reader knows
/// the setting took effect. Never a path.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedFigureDto {
    pub width: u32,
    pub height: u32,
    /// The physical resolution recorded in the file, for the formats that
    /// record one. `None` for SVG, which has no pixels to describe.
    pub dpi: Option<u32>,
    /// `light` or `dark`.
    pub theme: String,
}

/// What a figure put on the clipboard was.
///
/// Size and theme, and **no resolution**. The clipboard receives RGBA, a width
/// and a height; there is no `pHYs` chunk and nowhere for one, so a field for a
/// DPI here would be a field describing a property the artifact does not have.
/// Its own type rather than the export one with a `None` in it, because a shape
/// that cannot express the false claim is better than one that merely does not
/// make it today.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopiedFigureDto {
    pub width: u32,
    pub height: u32,
    /// `light` or `dark`.
    pub theme: String,
}

/// A copy-to-clipboard either put an image on the clipboard or it did not.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SpectrumCopyOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Copied {
        /// What was copied, so the interface can say it in the same words the
        /// figure settings use.
        figure: CopiedFigureDto,
        /// How many source points the copied figure was drawn from.
        point_count: usize,
    },
}

/// The interface asked for a figure that is not one.
///
/// Retryable in the only sense that matters: the correction is a number the
/// user can change, and the message says which one.
#[must_use]
pub fn figure_settings_refused(detail: &'static str) -> PreviewErrorDto {
    PreviewErrorDto::new("figure_settings_refused", detail, true)
}

/// No font on this machine can draw the figure's text.
///
/// A raster figure needs a real typeface to draw a label with; a vector one
/// keeps the text as text and needs none. So this refuses the pixel formats and
/// says what still works, rather than producing an image with the words missing
/// -- which would look finished and would not be.
#[must_use]
pub fn figure_font_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "figure_font_unavailable",
        "MSCanvas could not find a font on this computer to draw the figure's labels with, so \
         no image was produced. Export the figure as SVG, which keeps the text as text.",
        false,
    )
}

/// The figure could not be turned into pixels.
#[must_use]
pub fn figure_not_rasterizable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "figure_not_rasterizable",
        "MSCanvas could not draw this figure at the size you chose, so no image was produced. \
         Try a smaller width and height.",
        true,
    )
}

/// The system clipboard would not take the image.
#[must_use]
pub fn figure_clipboard_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "figure_clipboard_unavailable",
        "MSCanvas could not put the plot on the clipboard. Nothing was copied.",
        true,
    )
    .with_detail(
        "Another program is holding the clipboard. This is usually a clipboard manager \
         or a remote-desktop session, and it usually clears in a moment -- copy the \
         plot again.",
    )
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
///
/// Which shapes count is the conversion boundary's rule rather than a second
/// copy of it. A diagnostics export applies the same test to decide whether to
/// withhold an excerpt, and two rules that could drift would mean a shape this
/// screen hides and that file reports.
#[must_use]
pub fn redact_absolute_paths(value: &str) -> String {
    value.split_inclusive('\n').map(redact_line).collect()
}

fn redact_line(line: &str) -> String {
    let body = line.strip_suffix('\n').unwrap_or(line);
    let terminator = if body.len() == line.len() { "" } else { "\n" };
    match mscanvas_proteowizard::absolute_path_start(body) {
        Some(start) => format!("{}<path>{terminator}", &body[..start]),
        None => line.to_owned(),
    }
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
