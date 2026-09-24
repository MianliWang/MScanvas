//! A stored targeted MS1 result as scientific output.
//!
//! Two documents come out of one result: a figure of one target's evidence,
//! through the same plot contract every other figure here uses, and a table of
//! every target's row. Both are drawn from exactly two things -- the result's
//! validated managed payload and the plan the document recorded -- and from
//! nothing else. Nothing here reads the source, starts a worker, re-extracts a
//! trace, fits a peak or decides an outcome: a stored result is history, and an
//! export of it is a copy of that history in another shape.
//!
//! Absent is empty, never zero. A value the row does not carry is an empty
//! cell and an undrawn interval, because a zero would be a measurement nobody
//! made, and a failed target's missing area is exactly that.

use mscanvas_core::ArtifactId;
use mscanvas_plot_spec::spec::{
    AxisSpec, Caption, DataScope, Domain, FigureSize, FigureSpec, FigureTheme, IntervalRole,
    IntervalSpec, Label, MAX_CAPTION_CHARS, MAX_LABEL_CHARS, Marker, PanelSpec, PlotKind,
    SeriesSpec, StyleRole, UnitState,
};

use super::payload::{
    EvidenceLine, IntensitySource, PayloadRow, RowCandidate, RowFailure, RowFeature, RowOutcome,
};
use super::record::{
    RunId, TargetDefinition, TargetId, TargetedMs1Execution, TargetedMs1Plan, TargetedMs1ResultV1,
};

/// The table format this build writes, named in every table's preamble.
pub const TABLE_FORMAT_ID: &str = "mscanvas_targeted_ms1_results";

/// The table's own schema version. Its column contract, frozen at 1.
pub const TABLE_SCHEMA_VERSION: u32 = 1;

/// One stored result, whole and checked: what it was produced by, from what,
/// and every row in plan order.
///
/// Built only by the project store, after the payload has been read against
/// its record and every row checked the way it was checked before it was
/// published.
#[derive(Debug, Clone)]
pub struct StoredResult {
    pub artifact: ArtifactId,
    pub run: RunId,
    pub plan: TargetedMs1Plan,
    pub execution: TargetedMs1Execution,
    pub result: TargetedMs1ResultV1,
    /// One per plan target, in plan order.
    pub rows: Vec<PayloadRow>,
}

impl StoredResult {
    /// The plan's definition of one target and its row, with its position.
    #[must_use]
    pub fn target(&self, target: TargetId) -> Option<(usize, &TargetDefinition, &PayloadRow)> {
        self.plan
            .targets
            .iter()
            .zip(&self.rows)
            .enumerate()
            .find(|(_, (definition, _))| definition.target_id == target)
            .map(|(index, (definition, row))| (index, definition, row))
    }
}

/// Whether one candidate is the one the engine kept as the feature.
///
/// The one rule, used by every reader of a stored result. The payload records
/// the feature's bounds and every candidate's, and the kept candidate is the one
/// whose bounds are the feature's, exactly: the adapter copies both from the
/// same engine fields. Compared bit for bit, so no tolerance decides it.
#[must_use]
pub fn is_selected_candidate(feature: &RowFeature, candidate: &RowCandidate) -> bool {
    feature.left_s.to_bits() == candidate.left_s.to_bits()
        && feature.right_s.to_bits() == candidate.right_s.to_bits()
}

// ---------------------------------------------------------------------------
// Text a figure may carry
// ---------------------------------------------------------------------------

/// Whether XML 1.0 permits this character, as the plot contract asks.
const fn is_xml_character(character: char) -> bool {
    matches!(character,
        '\u{20}'..='\u{D7FF}'
        | '\u{E000}'..='\u{FFFD}'
        | '\u{10000}'..='\u{10FFFF}')
}

/// One piece of user text, made something a figure can carry.
///
/// A plan label may be 200 characters and may hold a character no XML
/// document can; a figure label may be neither. So every user string that
/// reaches a figure comes through here: a character the document cannot carry
/// becomes U+FFFD, and a string too long is cut with an ellipsis. Both are
/// visible, and neither pretends the text was something else.
#[must_use]
pub fn figure_text(value: &str, limit: usize) -> String {
    let safe: String = value
        .chars()
        .map(|character| {
            if is_xml_character(character) && !character.is_control() {
                character
            } else {
                '\u{FFFD}'
            }
        })
        .collect();
    let safe = safe.trim();
    if safe.chars().count() <= limit {
        return safe.to_owned();
    }
    let mut cut: String = safe.chars().take(limit.saturating_sub(1)).collect();
    cut.push('\u{2026}');
    cut
}

/// An outcome as a figure's title names it.
#[must_use]
pub const fn outcome_words(outcome: RowOutcome) -> &'static str {
    match outcome {
        RowOutcome::Detected => "Detected",
        RowOutcome::DetectedAmbiguous => "Detected (ambiguous)",
        RowOutcome::Shared => "Shared",
        RowOutcome::SuppressedByOverlap => "Suppressed by overlap",
        RowOutcome::NotDetected => "Not detected",
        RowOutcome::Failed => "Failed",
    }
}

const fn failure_words(reason: RowFailure) -> &'static str {
    match reason {
        RowFailure::ExtractionAtSpectrumEdge => "extraction reached the spectrum edge",
        RowFailure::RelatedTargetAtSpectrumEdge => "a related target reached the spectrum edge",
        RowFailure::CandidatesWithoutFeature => {
            "the engine removed its candidates without reporting a feature"
        }
        RowFailure::EngineDiscardedNoValidFit => "the engine discarded its candidate: no valid fit",
        RowFailure::TargetAbsentFromEngineLibrary => {
            "the target did not reach the engine's library"
        }
        RowFailure::TargetUnaccounted => {
            "the engine's answer for this target could not be accounted for"
        }
        RowFailure::WindowWithoutMs1Peaks => "no MS1 spectrum with peaks lies in the window",
    }
}

// ---------------------------------------------------------------------------
// The evidence figure
// ---------------------------------------------------------------------------

/// Why one target's evidence cannot be drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceRefusal {
    /// The target never reached extraction, so there is nothing to draw.
    NotExtracted,
    /// The evidence does not match its row: a trace missing, or its points
    /// not the ones the row counts.
    Mismatch,
    /// The plot contract refused the figure.
    NotDrawable,
}

/// One target's evidence as a figure, from the stored result alone.
///
/// # Errors
///
/// [`EvidenceRefusal`].
pub fn evidence_figure(
    stored: &StoredResult,
    target: TargetId,
    evidence: &[EvidenceLine],
    size: FigureSize,
    theme: FigureTheme,
) -> Result<FigureSpec, EvidenceRefusal> {
    let (_, definition, row) = stored.target(target).ok_or(EvidenceRefusal::Mismatch)?;
    let (Some(ion), Some(windows), Some(signal)) = (&row.ion, &row.windows, &row.signal) else {
        return Err(EvidenceRefusal::NotExtracted);
    };
    let traces = ion.mz_theoretical.len();
    if evidence.len() != traces || evidence.iter().any(|line| line.target_id != target) {
        return Err(EvidenceRefusal::Mismatch);
    }
    let points = usize::try_from(signal.points).map_err(|_| EvidenceRefusal::Mismatch)?;
    let mut ordered: Vec<&EvidenceLine> = evidence.iter().collect();
    ordered.sort_by_key(|line| line.trace);
    if ordered
        .iter()
        .enumerate()
        .any(|(index, line)| usize::from(line.trace) != index || line.points.len() != points)
    {
        return Err(EvidenceRefusal::Mismatch);
    }

    // Everything the panel draws, so the domain is its hull: the points, the
    // window, the feature and every candidate. A bound outside the domain is
    // one the contract refuses, rightly -- it could never be drawn.
    let mut positions: Vec<f64> = Vec::new();
    positions.extend(windows.rt_closed_s);
    for line in &ordered {
        positions.extend(line.points.iter().map(|point| point.1));
    }
    if let Some(feature) = &row.feature {
        positions.extend([feature.left_s, feature.right_s, feature.apex_rt_s]);
    }
    for candidate in &row.candidates {
        positions.extend([candidate.left_s, candidate.right_s]);
    }
    let low = positions.iter().copied().fold(f64::INFINITY, f64::min);
    let high = positions.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let full_domain = Domain::new(low, high).map_err(|_| EvidenceRefusal::NotDrawable)?;
    let mut value_low = 0.0_f64;
    let mut value_high = 0.0_f64;
    for line in &ordered {
        for point in &line.points {
            value_low = value_low.min(point.2);
            value_high = value_high.max(point.2);
        }
    }
    let value_domain =
        Domain::new(value_low, value_high).map_err(|_| EvidenceRefusal::NotDrawable)?;

    let drawable = |_| EvidenceRefusal::NotDrawable;
    let series = ordered
        .iter()
        .map(|line| {
            let name = if line.trace == 0 {
                "M".to_owned()
            } else {
                format!("M+{}", line.trace)
            };
            let role = if line.trace == 0 {
                StyleRole::Measurement
            } else {
                StyleRole::SecondaryMeasurement
            };
            Ok(SeriesSpec::new(
                Label::new(format!("{name} (m/z {:.4})", line.mz_theoretical)).map_err(drawable)?,
                role,
                DataScope::FullSource,
                line.points.iter().map(|point| point.1).collect(),
                line.points.iter().map(|point| point.2).collect(),
            )
            .map_err(drawable)?
            .with_sample_marks())
        })
        .collect::<Result<Vec<_>, EvidenceRefusal>>()?;

    let mut intervals = vec![
        IntervalSpec::new(
            windows.rt_closed_s[0],
            windows.rt_closed_s[1],
            IntervalRole::Window,
            Some(Label::new("RT window").map_err(drawable)?),
        )
        .map_err(drawable)?,
    ];
    let mut markers = Vec::new();
    if let Some(feature) = &row.feature {
        let name = if row.outcome == RowOutcome::Shared {
            "Shared feature"
        } else {
            "Feature"
        };
        intervals.push(
            IntervalSpec::new(
                feature.left_s,
                feature.right_s,
                IntervalRole::Selected,
                Some(Label::new(name).map_err(drawable)?),
            )
            .map_err(drawable)?,
        );
        markers.push(
            Marker::new(
                feature.apex_rt_s,
                Some(Label::new("Apex").map_err(drawable)?),
            )
            .map_err(drawable)?,
        );
    }
    for candidate in &row.candidates {
        if row
            .feature
            .as_ref()
            .is_some_and(|feature| is_selected_candidate(feature, candidate))
        {
            continue;
        }
        intervals.push(
            IntervalSpec::new(
                candidate.left_s,
                candidate.right_s,
                IntervalRole::Considered,
                Some(Label::new("Candidate").map_err(drawable)?),
            )
            .map_err(drawable)?,
        );
    }

    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            Label::new("Retention time").map_err(drawable)?,
            UnitState::Known {
                unit: Label::new("s").map_err(drawable)?,
            },
        ),
        AxisSpec::new(
            Label::new("Intensity").map_err(drawable)?,
            UnitState::Unreported,
        ),
        full_domain,
        value_domain,
        series,
    )
    .map_err(drawable)?
    .with_intervals(intervals)
    .map_err(drawable)?
    .with_markers(markers)
    .map_err(drawable)?;

    let outcome = outcome_words(row.outcome);
    let title = format!(
        "{} \u{2014} {outcome}",
        figure_text(
            &definition.label,
            MAX_LABEL_CHARS.saturating_sub(outcome.chars().count() + 3)
        )
    );
    let caption = figure_caption(stored, definition, row);
    Ok(FigureSpec::new(theme, size, vec![panel])
        .map_err(drawable)?
        .with_title(Label::new(&title).map_err(drawable)?)
        .with_caption(Caption::new(&caption).map_err(drawable)?))
}

/// What the figure is of, and where it came from, within a caption's bound.
///
/// The outcome in words that keep its meaning -- an absence is not proof, a
/// failure claims nothing -- and the two identifiers a reader needs to find
/// the result again: the result and the plan it ran.
fn figure_caption(
    stored: &StoredResult,
    definition: &TargetDefinition,
    row: &PayloadRow,
) -> String {
    let clause = match row.outcome {
        RowOutcome::Detected => {
            "detected; the shaded band is the feature the engine selected, and the line labelled \
             Apex its apex"
                .to_owned()
        }
        RowOutcome::DetectedAmbiguous => format!(
            "detected, ambiguous: the engine selected the shaded feature from {} candidates, the \
             others outlined",
            row.candidates.len()
        ),
        RowOutcome::Shared => {
            let others = row.relations.shared_with.len();
            format!(
                "shared: the shaded feature is also the answer for {others} other target{} of \
                 this plan",
                if others == 1 { "" } else { "s" }
            )
        }
        RowOutcome::SuppressedByOverlap => {
            "suppressed by an overlapping target's feature; it has no feature of its own".to_owned()
        }
        RowOutcome::NotDetected => {
            "not detected: the engine reported no candidate inside the window, which is not proof \
             of absence"
                .to_owned()
        }
        RowOutcome::Failed => format!(
            "failed ({}); the figure shows what was extracted and claims no outcome",
            row.failure_reason
                .map_or("no reason recorded", failure_words)
        ),
    };
    let caption = format!(
        "Targeted MS1 lookup (experimental) of {}: {clause}. The points are the M and M+1 values \
         the engine extracted, as this stored result holds them; nothing was re-extracted. Result \
         {}; plan {}.",
        figure_text(&definition.formula, 100),
        stored.artifact,
        stored.plan.plan_sha256,
    );
    figure_text(&caption.replace('\n', " "), MAX_CAPTION_CHARS)
}

// ---------------------------------------------------------------------------
// The result table
// ---------------------------------------------------------------------------

/// Which delimited format a table is written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableFormat {
    Csv,
    Tsv,
}

impl TableFormat {
    /// The closed wire words.
    #[must_use]
    pub fn from_wire(format: &str) -> Option<Self> {
        match format {
            "csv" => Some(Self::Csv),
            "tsv" => Some(Self::Tsv),
            _ => None,
        }
    }

    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Tsv => "tsv",
        }
    }

    const fn delimiter(self) -> char {
        match self {
            Self::Csv => ',',
            Self::Tsv => '\t',
        }
    }
}

/// Why a table cannot be written as asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableRefusal {
    /// A field holds a tab or a line break, which a tab-separated file has no
    /// way to carry. CSV can quote it; TSV refuses rather than altering it.
    FieldNotRepresentable,
    /// A row carries a number of traces this contract has no columns for.
    UnexpectedTraceCount,
}

/// The columns, in order. The contract of `mscanvas_targeted_ms1_results`
/// schema 1, and nothing else may be written under that name.
pub const TABLE_COLUMNS: [&str; 40] = [
    "target_id",
    "target_position",
    "label",
    "formula",
    "neutral_mass",
    "planned_rt_s",
    "planned_rt_half_width_s",
    "outcome",
    "failure_reason",
    "adduct",
    "mz_theoretical_m",
    "mz_theoretical_m1",
    "mz_window_m_low",
    "mz_window_m_high",
    "mz_window_m1_low",
    "mz_window_m1_high",
    "rt_window_low_s",
    "rt_window_high_s",
    "extracted_points",
    "any_nonzero_point",
    "signal_sum_m",
    "signal_sum_m1",
    "signal_max_m",
    "signal_max_m1",
    "edge_trace_count",
    "candidate_count",
    "feature_apex_rt_s",
    "feature_left_s",
    "feature_right_s",
    "raw_area",
    "model_status",
    "model_area",
    "model_fwhm_s",
    "engine_intensity",
    "engine_intensity_source",
    "shared_with",
    "suppressed_by",
    "overlap_removed",
    "overlap_winner",
    "recovered_from_empty_selection",
];

/// One field, as the format carries it.
///
/// CSV quotes a field holding a delimiter, a quotation mark, a line break or
/// an edge space, and doubles its quotation marks (RFC 4180). TSV has no
/// quoting, so a field it cannot carry is refused rather than altered.
fn field(value: &str, format: TableFormat) -> Result<String, TableRefusal> {
    match format {
        TableFormat::Csv => {
            let needs_quotes = value.contains([',', '"', '\n', '\r'])
                || value.starts_with(' ')
                || value.ends_with(' ');
            Ok(if needs_quotes {
                format!("\"{}\"", value.replace('"', "\"\""))
            } else {
                value.to_owned()
            })
        }
        TableFormat::Tsv => {
            if value.contains(['\t', '\n', '\r']) {
                Err(TableRefusal::FieldNotRepresentable)
            } else {
                Ok(value.to_owned())
            }
        }
    }
}

fn line(values: &[String], format: TableFormat) -> Result<String, TableRefusal> {
    let fields = values
        .iter()
        .map(|value| field(value, format))
        .collect::<Result<Vec<_>, _>>()?;
    let mut line = fields.join(&format.delimiter().to_string());
    line.push('\n');
    Ok(line)
}

/// A number as every data document here writes one: `f64` `Display`, the
/// shortest form that reads back as the same value, with no locale.
fn number(value: f64) -> String {
    value.to_string()
}

fn optional(value: Option<f64>) -> String {
    value.map_or_else(String::new, number)
}

fn ids(values: &[TargetId]) -> String {
    values
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(";")
}

/// The whole result as one delimited table, with its provenance first.
///
/// Answers the table and its row count. One row per plan target, in plan
/// order; the preamble names what the result is, never where anything is.
///
/// # Errors
///
/// [`TableRefusal`].
pub fn result_table(
    stored: &StoredResult,
    format: TableFormat,
) -> Result<(String, usize), TableRefusal> {
    let execution = &stored.execution;
    let attempt = execution.attempt.as_ref();
    let report = attempt.and_then(|attempt| attempt.engine_report.as_ref());
    let source = execution.consumed_content.first();
    let text = |value: &str| value.to_owned();
    let preamble: Vec<(&str, String)> = vec![
        ("format", text(TABLE_FORMAT_ID)),
        ("schema_version", TABLE_SCHEMA_VERSION.to_string()),
        ("recipe", text("targetedMs1")),
        (
            "recipe_version",
            stored.plan.recipe.recipe_version.to_string(),
        ),
        ("artifact_id", stored.artifact.to_string()),
        ("run_id", stored.run.to_string()),
        ("plan_sha256", stored.plan.plan_sha256.clone()),
        ("target_list_sha256", stored.plan.target_list_sha256.clone()),
        (
            "mz_half_width_ppm",
            stored
                .plan
                .parameters
                .mz_half_width_ppm
                .as_text()
                .to_owned(),
        ),
        (
            "expected_peak_width_s",
            stored
                .plan
                .parameters
                .expected_peak_width_s
                .as_text()
                .to_owned(),
        ),
        (
            "source_byte_length",
            source.map_or_else(String::new, |member| member.byte_length.to_string()),
        ),
        (
            "source_sha256",
            source.map_or_else(String::new, |member| member.sha256.clone()),
        ),
        ("adapter_sha256", stored.plan.recipe.adapter_sha256.clone()),
        (
            "engine_profile_sha256",
            stored.plan.recipe.engine_profile_sha256.clone(),
        ),
        (
            "runtime_manifest_sha256",
            stored.plan.recipe.runtime_manifest_sha256.clone(),
        ),
        (
            "engine_pyopenms",
            report.map_or_else(String::new, |report| report.pyopenms.clone()),
        ),
        (
            "engine_openms",
            report.map_or_else(String::new, |report| report.openms.clone()),
        ),
        (
            "engine_openms_revision",
            report.map_or_else(String::new, |report| report.openms_revision.clone()),
        ),
        (
            "payload_manifest_sha256",
            stored.result.payload.manifest_sha256.clone(),
        ),
        ("target_count", stored.rows.len().to_string()),
        ("row_order", text("plan")),
        ("retention_time_unit", text("s")),
        ("intensity_unit", text("unreported")),
    ];

    let mut out = String::with_capacity(4_096 + stored.rows.len() * 512);
    for (key, value) in &preamble {
        // Every preamble line starts with `#`, the convention every reader of
        // this application's data documents already skips.
        let rest = line(std::slice::from_ref(value), format)?;
        out.push('#');
        out.push_str(key);
        out.push(format.delimiter());
        out.push_str(&rest);
    }
    out.push_str(&line(
        &TABLE_COLUMNS
            .iter()
            .map(|name| (*name).to_owned())
            .collect::<Vec<_>>(),
        format,
    )?);

    for (index, (definition, row)) in stored.plan.targets.iter().zip(&stored.rows).enumerate() {
        out.push_str(&line(&row_fields(index, definition, row)?, format)?);
    }
    Ok((out, stored.rows.len()))
}

fn row_fields(
    index: usize,
    definition: &TargetDefinition,
    row: &PayloadRow,
) -> Result<Vec<String>, TableRefusal> {
    let extracted = row.ion.is_some();
    let pair = |values: &[f64]| -> Result<[String; 2], TableRefusal> {
        match values {
            [first, second] => Ok([number(*first), number(*second)]),
            _ => Err(TableRefusal::UnexpectedTraceCount),
        }
    };
    let (mz_m, mz_m1) = match &row.ion {
        Some(ion) => {
            let [first, second] = pair(&ion.mz_theoretical)?;
            (first, second)
        }
        None => (String::new(), String::new()),
    };
    let windows = match &row.windows {
        Some(windows) => {
            let [m, m1] = match windows.mz_open.as_slice() {
                [m, m1] => [*m, *m1],
                _ => return Err(TableRefusal::UnexpectedTraceCount),
            };
            [
                number(m[0]),
                number(m[1]),
                number(m1[0]),
                number(m1[1]),
                number(windows.rt_closed_s[0]),
                number(windows.rt_closed_s[1]),
            ]
        }
        None => Default::default(),
    };
    let signal = match &row.signal {
        Some(signal) => {
            let [sum_m, sum_m1] = pair(&signal.sum)?;
            let [max_m, max_m1] = pair(&signal.max)?;
            [
                signal.points.to_string(),
                signal.any_nonzero_point.to_string(),
                sum_m,
                sum_m1,
                max_m,
                max_m1,
            ]
        }
        None => Default::default(),
    };
    let feature = row.feature.as_ref();
    let mut fields = vec![
        definition.target_id.to_string(),
        (index + 1).to_string(),
        definition.label.clone(),
        definition.formula.clone(),
        definition
            .neutral_mass
            .as_ref()
            .map_or_else(String::new, |mass| mass.as_text().to_owned()),
        definition.rt_s.as_text().to_owned(),
        definition.rt_half_width_s.as_text().to_owned(),
        row_outcome_word(row.outcome).to_owned(),
        row.failure_reason
            .map_or_else(String::new, |reason| row_failure_word(reason).to_owned()),
        row.ion
            .as_ref()
            .map_or_else(String::new, |ion| ion.adduct.clone()),
        mz_m,
        mz_m1,
    ];
    fields.extend(windows);
    fields.extend(signal);
    // Counts that only mean something where the target was extracted: a target
    // the engine never had has no candidate count of zero, it has none.
    fields.push(if extracted {
        row.edge_trace_count.to_string()
    } else {
        String::new()
    });
    fields.push(if extracted {
        row.candidates.len().to_string()
    } else {
        String::new()
    });
    fields.extend([
        optional(feature.map(|feature| feature.apex_rt_s)),
        optional(feature.map(|feature| feature.left_s)),
        optional(feature.map(|feature| feature.right_s)),
        optional(feature.map(|feature| feature.raw_area)),
        feature.map_or_else(String::new, |feature| feature.model_status.clone()),
        optional(feature.and_then(|feature| feature.model_area)),
        optional(feature.and_then(|feature| feature.model_fwhm_s)),
        optional(feature.and_then(|feature| feature.engine_intensity)),
        feature.map_or_else(String::new, |feature| {
            match feature.engine_intensity_source {
                IntensitySource::ModelArea => "modelArea",
                IntensitySource::ImputedFromRunRegression => "imputedFromRunRegression",
            }
            .to_owned()
        }),
        ids(&row.relations.shared_with),
        row.relations
            .suppressed_by
            .map_or_else(String::new, |id| id.to_string()),
        ids(&row.relations.overlap_removed),
        row.overlap_winner.to_string(),
        row.recovered_from_empty_selection.to_string(),
    ]);
    debug_assert_eq!(fields.len(), TABLE_COLUMNS.len());
    Ok(fields)
}

/// The payload's own outcome word, so the table and the stored rows agree.
const fn row_outcome_word(outcome: RowOutcome) -> &'static str {
    match outcome {
        RowOutcome::Detected => "DETECTED",
        RowOutcome::DetectedAmbiguous => "DETECTED_AMBIGUOUS",
        RowOutcome::Shared => "SHARED",
        RowOutcome::SuppressedByOverlap => "SUPPRESSED_BY_OVERLAP",
        RowOutcome::NotDetected => "NOT_DETECTED",
        RowOutcome::Failed => "FAILED",
    }
}

const fn row_failure_word(reason: RowFailure) -> &'static str {
    match reason {
        RowFailure::ExtractionAtSpectrumEdge => "EXTRACTION_AT_SPECTRUM_EDGE",
        RowFailure::RelatedTargetAtSpectrumEdge => "RELATED_TARGET_AT_SPECTRUM_EDGE",
        RowFailure::CandidatesWithoutFeature => "CANDIDATES_WITHOUT_FEATURE",
        RowFailure::EngineDiscardedNoValidFit => "ENGINE_DISCARDED_NO_VALID_FIT",
        RowFailure::TargetAbsentFromEngineLibrary => "TARGET_ABSENT_FROM_ENGINE_LIBRARY",
        RowFailure::TargetUnaccounted => "TARGET_UNACCOUNTED",
        RowFailure::WindowWithoutMs1Peaks => "WINDOW_WITHOUT_MS1_PEAKS",
    }
}
