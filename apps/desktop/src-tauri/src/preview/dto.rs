//! Serializable transfer objects for the mzML preview boundary.
//!
//! Every type here is what the webview is allowed to see. None of them carries
//! an absolute backend path, raw backend text, or a value the backend did not
//! actually emit. Unknown facts stay explicitly unknown rather than being
//! defaulted into something that looks measured.

use serde::Serialize;

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
