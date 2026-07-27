//! The application service the Tauri commands adapt.
//!
//! This is where typed backend results become transfer objects. It is the only
//! place allowed to decide what the webview may see, and it is unit-testable
//! without a WebView or a local ProteoWizard installation.

use std::path::Path;

use mscanvas_proteowizard::{
    MetadataResult, MetadataSectionKind, MsLevelBucket, PreviewNoResult, PreviewOutcome,
    PreviewValue, Redactor, RunSummaryResult, SelectedSpectrumResult, SpectrumTableResult,
};

use super::backend::{
    PreviewProvider, open_operations, reporting_redactor, selected_spectrum_operation,
};
use super::dto::{
    BackendAvailabilityDto, MAX_METADATA_LINE_CHARS, MAX_SPECTRUM_POINTS, MAX_SPECTRUM_TABLE_ROWS,
    MetadataDto, MetadataSectionDto, MsLevelCountDto, PrecursorDto, PreviewDto, PreviewErrorDto,
    RetentionTimeDto, RetentionTimeRangeDto, RunSummaryDto, SelectedFileDto, SelectedSpectrumDto,
    SelectedSpectrumOutcomeDto, SpectrumRowDto, SpectrumTableDto, bounded_text,
    redact_absolute_paths, require_finite, require_finite_option,
};
use super::selection::{AcceptedFile, FileRegistry, accept_mzml_file};

/// The narrow set of operations the desktop application exposes.
pub struct PreviewService {
    provider: Box<dyn PreviewProvider>,
    files: FileRegistry,
}

impl PreviewService {
    #[must_use]
    pub fn new(provider: Box<dyn PreviewProvider>) -> Self {
        Self {
            provider,
            files: FileRegistry::new(),
        }
    }

    pub fn inspect_backend(&self) -> BackendAvailabilityDto {
        self.provider.availability()
    }

    /// Accepts one already-chosen path and registers it for later operations.
    pub fn accept_file(&self, path: &Path) -> Result<SelectedFileDto, PreviewErrorDto> {
        let accepted = accept_mzml_file(path)?;
        Ok(self.files.register(accepted))
    }

    /// Loads metadata, run summary and the spectrum table for one open action.
    ///
    /// All three share a single discovery and capability probe, so opening a
    /// file resolves the backend once rather than once per panel.
    pub fn open_preview(&self, handle: &str) -> Result<PreviewDto, PreviewErrorDto> {
        let file = self.files.resolve(handle)?;
        let redactor = reporting_redactor(file.path());
        let operations = open_operations();
        // The three operations read the file separately. If it is rewritten
        // between them, their results describe different generations of the
        // run, and combining those into one preview would present an
        // acquisition that never existed.
        let before = SourceGeneration::capture(file.path());
        let results = self.provider.run_batch(file.path(), &operations)?;
        if SourceGeneration::capture(file.path()) != before {
            return Err(PreviewErrorDto::new(
                "source_changed_during_preview",
                "The file changed while it was being read, so the preview was discarded rather \
                 than combining results from before and after the change.",
                true,
            ));
        }
        if results.len() != operations.len() {
            return Err(PreviewErrorDto::new(
                "incomplete_preview_result",
                "The preview did not return every requested result.",
                true,
            ));
        }

        let mut metadata = None;
        let mut run_summary = None;
        let mut spectrum_table = None;
        for result in results {
            match result.outcome {
                PreviewOutcome::Value(value) => match *value {
                    PreviewValue::Metadata(result) => {
                        metadata = Some(metadata_dto(&result, &redactor));
                    }
                    PreviewValue::RunSummary(result) => {
                        run_summary = Some(run_summary_dto(&result)?);
                    }
                    PreviewValue::SpectrumTable(result) => {
                        spectrum_table = Some(spectrum_table_dto(&result, &redactor)?);
                    }
                    PreviewValue::Tic(_) | PreviewValue::SelectedSpectrum(_) => {
                        return Err(PreviewErrorDto::new(
                            "unexpected_preview_result",
                            "The preview returned a result MSCanvas did not request.",
                            false,
                        ));
                    }
                },
                PreviewOutcome::NoResult(_) => {
                    return Err(PreviewErrorDto::new(
                        "preview_result_missing",
                        "The preview did not produce one of its required results.",
                        true,
                    ));
                }
            }
        }

        Ok(PreviewDto {
            file: file_dto(handle, &file),
            metadata: metadata.ok_or_else(|| missing("metadata"))?,
            run_summary: run_summary.ok_or_else(|| missing("run summary"))?,
            spectrum_table: spectrum_table.ok_or_else(|| missing("spectrum table"))?,
        })
    }

    /// Loads exactly one spectrum by zero-based index. Requests stay direct and
    /// uncached in this slice.
    pub fn load_spectrum(
        &self,
        handle: &str,
        index: u64,
    ) -> Result<SelectedSpectrumOutcomeDto, PreviewErrorDto> {
        let file = self.files.resolve(handle)?;
        let redactor = reporting_redactor(file.path());
        let operation = selected_spectrum_operation(index);
        let result = self.provider.run(file.path(), &operation)?;
        match result.outcome {
            PreviewOutcome::Value(value) => match *value {
                PreviewValue::SelectedSpectrum(spectrum) => {
                    Ok(SelectedSpectrumOutcomeDto::Spectrum {
                        spectrum: Box::new(selected_spectrum_dto(&spectrum, &redactor)?),
                    })
                }
                _ => Err(PreviewErrorDto::new(
                    "unexpected_preview_result",
                    "The preview returned a result MSCanvas did not request.",
                    false,
                )),
            },
            PreviewOutcome::NoResult(PreviewNoResult::SpectrumUnavailable { requested_index }) => {
                Ok(SelectedSpectrumOutcomeDto::Unavailable { requested_index })
            }
        }
    }
}

/// A cheap stamp of which generation of a file was read.
///
/// Length and modification time, not a digest: the representative acquisition
/// is 208 MB and hashing it around every preview would cost more than the
/// preview. `None` on either field means the platform did not report it, and
/// two `None`s compare equal, so this narrows the window rather than closing
/// it. The crate revalidates filesystem identity at each spawn independently.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceGeneration {
    byte_length: Option<u64>,
    modified: Option<std::time::SystemTime>,
}

impl SourceGeneration {
    fn capture(path: &Path) -> Self {
        let metadata = std::fs::symlink_metadata(path).ok();
        Self {
            byte_length: metadata.as_ref().map(std::fs::Metadata::len),
            modified: metadata.and_then(|metadata| metadata.modified().ok()),
        }
    }
}

fn missing(what: &str) -> PreviewErrorDto {
    PreviewErrorDto::new(
        "preview_result_missing",
        format!("The preview did not return its {what} result."),
        true,
    )
}

fn file_dto(handle: &str, file: &AcceptedFile) -> SelectedFileDto {
    SelectedFileDto {
        handle: handle.to_owned(),
        file_name: file.file_name().to_owned(),
        byte_length: file.byte_length(),
    }
}

fn section_title(kind: MetadataSectionKind) -> &'static str {
    match kind {
        MetadataSectionKind::FileDescription => "File description",
        MetadataSectionKind::SampleList => "Samples",
        MetadataSectionKind::InstrumentConfigurationList => "Instrument configuration",
        MetadataSectionKind::SoftwareList => "Software",
        MetadataSectionKind::DataProcessingList => "Data processing",
    }
}

/// Metadata lines are backend output that can contain the opened path, so every
/// line is redacted and bounded before it becomes visible.
fn metadata_dto(result: &MetadataResult, redactor: &Redactor) -> MetadataDto {
    MetadataDto {
        sections: result
            .sections()
            .iter()
            .map(|section| MetadataSectionDto {
                id: section.kind().stable_id().to_owned(),
                title: section_title(section.kind()).to_owned(),
                entries: section
                    .entries()
                    .iter()
                    .map(|entry| {
                        // Session redaction first, then any remaining
                        // path-shaped token the document itself recorded.
                        let redacted =
                            redact_absolute_paths(&redactor.redact(entry.sensitive_text()));
                        bounded_text(&redacted, MAX_METADATA_LINE_CHARS)
                    })
                    .collect(),
            })
            .collect(),
        leading_entry_count: result.leading_entries().len(),
    }
}

fn retention_time_dto(
    value: mscanvas_proteowizard::RetentionTime,
) -> Result<RetentionTimeDto, PreviewErrorDto> {
    Ok(RetentionTimeDto {
        value: require_finite(value.value())?,
        // The measured formatter emits no unit, so none is claimed.
        unit_known: false,
    })
}

fn run_summary_dto(result: &RunSummaryResult) -> Result<RunSummaryDto, PreviewErrorDto> {
    let retention_time_range = result
        .retention_time_range()
        .map(|range| {
            Ok::<_, PreviewErrorDto>(RetentionTimeRangeDto {
                minimum: retention_time_dto(range.minimum())?,
                maximum: retention_time_dto(range.maximum())?,
            })
        })
        .transpose()?;

    Ok(RunSummaryDto {
        total_spectrum_count: result.total_spectrum_count(),
        ms_levels: result
            .counts_by_ms_level()
            .iter()
            .map(|count| MsLevelCountDto {
                ms_level: match count.bucket() {
                    MsLevelBucket::Level(level) => Some(level),
                    MsLevelBucket::Other => None,
                },
                spectrum_count: count.spectrum_count(),
            })
            .collect(),
        chromatogram_count: result.chromatogram_count(),
        retention_time_range,
    })
}

fn spectrum_table_dto(
    result: &SpectrumTableResult,
    redactor: &Redactor,
) -> Result<SpectrumTableDto, PreviewErrorDto> {
    let total_row_count = result.rows().len();
    let truncated = total_row_count > MAX_SPECTRUM_TABLE_ROWS;
    let mut rows = Vec::with_capacity(total_row_count.min(MAX_SPECTRUM_TABLE_ROWS));
    for row in result.rows().iter().take(MAX_SPECTRUM_TABLE_ROWS) {
        let identity = row.identity();
        rows.push(SpectrumRowDto {
            index: identity.index(),
            identifier: identity.representations().first().map_or_else(
                || identity.index().to_string(),
                |representation| redactor.redact(representation.sensitive_raw()),
            ),
            scan_number: identity.scan_number(),
            ms_level: row.ms_level(),
            retention_time: retention_time_dto(row.retention_time())?,
            base_peak_mz: require_finite(row.base_peak_mz())?,
            base_peak_intensity: require_finite(row.base_peak_intensity())?,
            total_ion_current: require_finite(row.total_ion_current())?,
            precursor_mz: require_finite_option(row.precursor_mz())?,
        });
    }
    Ok(SpectrumTableDto {
        rows,
        total_row_count,
        truncated,
    })
}

fn selected_spectrum_dto(
    spectrum: &SelectedSpectrumResult,
    redactor: &Redactor,
) -> Result<SelectedSpectrumDto, PreviewErrorDto> {
    let point_count = spectrum.mz_values().len();
    let truncated = point_count > MAX_SPECTRUM_POINTS;
    let transferred = point_count.min(MAX_SPECTRUM_POINTS);

    let mut mz = Vec::with_capacity(transferred);
    for value in spectrum.mz_values().iter().take(transferred) {
        mz.push(require_finite(*value)?);
    }
    let mut intensity = Vec::with_capacity(transferred);
    for value in spectrum.intensity_values().iter().take(transferred) {
        intensity.push(require_finite(*value)?);
    }

    let mut precursors = Vec::with_capacity(spectrum.precursors().len());
    for precursor in spectrum.precursors() {
        precursors.push(PrecursorDto {
            index: precursor.index(),
            mz: require_finite(precursor.mz())?,
            intensity: require_finite(precursor.intensity())?,
        });
    }

    let identity = spectrum.identity();
    Ok(SelectedSpectrumDto {
        index: identity.index(),
        scan_number: identity.scan_number(),
        identifiers: identity
            .representations()
            .iter()
            .map(|representation| redactor.redact(representation.sensitive_raw()))
            .collect(),
        ms_level: spectrum.ms_level(),
        retention_time: retention_time_dto(spectrum.retention_time())?,
        point_count,
        mz,
        intensity,
        mz_low: require_finite(spectrum.mz_low())?,
        mz_high: require_finite(spectrum.mz_high())?,
        base_peak_mz: require_finite(spectrum.base_peak_mz())?,
        base_peak_intensity: require_finite(spectrum.base_peak_intensity())?,
        total_ion_current: require_finite(spectrum.total_ion_current())?,
        precursors,
        // The measured selected-spectrum formatter emits neither a
        // profile/centroid marker nor array units, so both stay unknown.
        representation_known: false,
        value_units_known: false,
        truncated,
    })
}
