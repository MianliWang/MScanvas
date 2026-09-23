//! The QC summary snapshot: copying what one retained preview established
//! into the project, as history.
//!
//! ## Why this is its own module
//!
//! The facts live in the workspace -- the run summary the latest preview open
//! retained, and the build that open's batch reported -- and the record lives
//! in the project. Like the M8.3 bridge, the crossing is a thing with a name
//! rather than a dependency either side grew.
//!
//! ## What it is, and is not
//!
//! A typed copy of facts the existing preview boundary already established:
//! the total spectrum count, the MS-level buckets in the order they were
//! reported, the chromatogram count or that none was reported, and the five
//! retention times or that none were, each with the unit state the formatter
//! left it in. Nothing is recalculated and nothing is judged: no threshold, no
//! grade, no pass or fail. It describes a run summary; it does not evaluate a
//! sample, a separation or an instrument.
//!
//! None of the preview's metadata is copied. Those lines are opaque backend
//! text that can carry local paths and other sensitive values, and recording
//! them is a privacy decision this snapshot does not make.
//!
//! It reads no file, hashes nothing, resolves no installation and starts no
//! process. A capture with no retained summary for the layer's source is
//! refused; it never starts a preview to get one.

#[cfg(test)]
mod tests;

use mscanvas_core::ArtifactId;
use mscanvas_proteowizard::{MsLevelBucket, RetentionTime, RunSummaryResult, UnitState};
use serde::Serialize;

use crate::preview::service::RetainedSummaryRefusal;
use crate::preview::{PreviewProducerFacts, PreviewService};
use crate::project::dto::ProjectStateDto;
use crate::project::record::{
    self, AcquisitionQcSnapshotV1, DocumentProblem, LayerId, MAX_MS_LEVEL_BUCKETS,
    MsLevelCountRecord, PreviewProducer, ProducerTool, RecordedRetentionTime, RecordedUnit,
    ReportedCount, RetentionTimeSummary,
};
use crate::project::{ProjectError, ProjectStore};

/// What one capture answers with: the project as it now is, and which record
/// the capture made, so the page can open it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QcCaptureDto {
    pub project: ProjectStateDto,
    pub artifact_id: String,
}

/// Records one QC summary snapshot of one layer's source.
///
/// `preview_token` names the run summary the page is showing. It is checked
/// against the one the session retains, and that one must be of the row the
/// project remembers for the layer's source -- so a summary of another row, an
/// older open's summary, and one whose row has left the workspace are each
/// refused rather than recorded under this layer.
///
/// # Errors
///
/// Whatever [`ProjectStore::capture_qc_snapshot`] refuses with, and
/// [`ProjectError::PreviewNotCurrent`], [`ProjectError::NotInWorkbench`] or
/// [`ProjectError::ProducerUnidentified`] for a summary that cannot be copied.
pub fn capture_qc_summary(
    projects: &ProjectStore,
    service: &PreviewService,
    layer: LayerId,
    preview_token: &str,
) -> Result<ArtifactId, ProjectError> {
    projects.capture_qc_snapshot(layer, |handle| {
        let (summary, producer) = service
            .retained_run_summary(handle, preview_token)
            .map_err(|refusal| match refusal {
                RetainedSummaryRefusal::NotCurrent => ProjectError::PreviewNotCurrent,
                RetainedSummaryRefusal::RowGone => ProjectError::NotInWorkbench,
                RetainedSummaryRefusal::ProducerUnidentified => ProjectError::ProducerUnidentified,
            })?;
        snapshot_of(&summary, producer)
    })
}

/// The snapshot of one run summary, exactly as it was established.
///
/// Buckets keep their reported order and `Other` stays `Other`; an absent
/// chromatogram count stays absent rather than becoming zero; absent retention
/// times stay absent; and every unit state is carried as the formatter left
/// it. More buckets than a snapshot holds is refused, not truncated.
fn snapshot_of(
    summary: &RunSummaryResult,
    producer: PreviewProducerFacts,
) -> Result<AcquisitionQcSnapshotV1, ProjectError> {
    let buckets = summary.counts_by_ms_level();
    if buckets.len() > MAX_MS_LEVEL_BUCKETS {
        return Err(ProjectError::Oversized);
    }
    let ms_level_counts = buckets
        .iter()
        .map(|count| match count.bucket() {
            MsLevelBucket::Level(ms_level) => MsLevelCountRecord::Level {
                ms_level,
                spectrum_count: count.spectrum_count(),
            },
            MsLevelBucket::Other => MsLevelCountRecord::Other {
                spectrum_count: count.spectrum_count(),
            },
        })
        .collect();
    let chromatogram_count = match summary.chromatogram_count() {
        Some(count) => ReportedCount::Reported { count },
        None => ReportedCount::NotReported {},
    };
    let retention_time = match summary.retention_time_range() {
        None => RetentionTimeSummary::NotReported {},
        Some(range) => RetentionTimeSummary::Reported {
            minimum: recorded(range.minimum())?,
            at_25_percent_base_peak_intensity: recorded(range.at_25_percent_base_peak_intensity())?,
            at_50_percent_base_peak_intensity: recorded(range.at_50_percent_base_peak_intensity())?,
            at_75_percent_base_peak_intensity: recorded(range.at_75_percent_base_peak_intensity())?,
            maximum: recorded(range.maximum())?,
        },
    };
    // A build label this document cannot state -- empty, too long, or holding
    // a control character -- leaves the producer unidentifiable rather than
    // quietly unreported: the build did report it.
    for label in [
        &producer.release,
        &producer.build_date,
        &producer.source_revision,
    ]
    .into_iter()
    .flatten()
    {
        if !record::storable_label(label) {
            return Err(ProjectError::ProducerUnidentified);
        }
    }
    Ok(AcquisitionQcSnapshotV1 {
        total_spectrum_count: summary.total_spectrum_count(),
        ms_level_counts,
        chromatogram_count,
        retention_time,
        producer: PreviewProducer {
            tool: ProducerTool::Msaccess,
            executable_sha256: producer.msaccess_sha256.to_string(),
            release: producer.release,
            build_date: producer.build_date,
            source_revision: producer.source_revision,
        },
    })
}

/// One retention time, with the unit state the formatter left it in.
///
/// Exhaustive, with no wildcard: a formatter that starts emitting a unit must
/// arrive here as a compile error and be mapped from that evidence.
fn recorded(value: RetentionTime) -> Result<RecordedRetentionTime, ProjectError> {
    let unit = match value.unit() {
        UnitState::NotEmitted => RecordedUnit::NotEmitted,
    };
    // The parser admits finite values only, so this refuses nothing it
    // produced; it is here so a non-finite value cannot become text.
    RecordedRetentionTime::of(value.value(), unit)
        .ok_or(ProjectError::Document(DocumentProblem::Malformed))
}
