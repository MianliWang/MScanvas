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

/// The longest bounded diagnostic detail attached to an error.
pub const MAX_ERROR_DETAIL_CHARS: usize = 400;

/// Whether a user-installed ProteoWizard backend is usable.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvailabilityDto {
    /// `available` or `unavailable`. MSCanvas never bundles or installs a
    /// backend, so unavailability is an ordinary user-facing state.
    pub state: String,
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

/// One accepted local file. The absolute path stays in Rust; the webview
/// receives an opaque handle and the display name only.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFileDto {
    pub handle: String,
    pub file_name: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSectionDto {
    pub id: String,
    pub title: String,
    pub entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataDto {
    pub sections: Vec<MetadataSectionDto>,
    pub leading_entry_count: usize,
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

        if after_boundary
            && line[index..].len() >= 5
            && line[index..index + 5].eq_ignore_ascii_case("file:")
        {
            return Some(index);
        }

        // A UNC or POSIX-absolute root, but not the `//` inside a URL scheme
        // such as `http://`, whose useful text is worth keeping.
        if matches!(
            (bytes.get(index), bytes.get(index + 1)),
            (Some(b'\\'), Some(b'\\')) | (Some(b'/'), Some(b'/'))
        ) && preceding
            .is_none_or(|byte| byte.is_ascii_whitespace() || matches!(byte, b'=' | b'"' | b'\''))
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
