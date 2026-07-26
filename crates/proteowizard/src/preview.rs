//! Typed interpretation of bounded `msaccess` preview output.
//!
//! Process execution and output interpretation are intentionally separate.
//! This module consumes already-captured process facts and a path-free output
//! manifest. It does not spawn a backend, mutate the filesystem, infer
//! unsupported inputs from English diagnostics, or assign scientific meaning
//! to values that the measured formatter did not describe.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use thiserror::Error;

use crate::{PreviewOperation, ProcessOutput, Termination};

const MAX_COMPLETE_TEXT_BYTES: u64 = 8 * 1024 * 1024;

/// Whether a unit was explicitly emitted by the preview formatter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitState {
    /// The formatter emitted a numeric value without a unit.
    NotEmitted,
}

/// Retention time as emitted by ProteoWizard, without an inferred unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RetentionTime {
    value: f64,
    unit: UnitState,
}

impl RetentionTime {
    #[must_use]
    pub const fn value(self) -> f64 {
        self.value
    }

    #[must_use]
    pub const fn unit(self) -> UnitState {
        self.unit
    }
}

/// The five metadata section markers established by the M0 evidence parser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MetadataSectionKind {
    FileDescription,
    SampleList,
    InstrumentConfigurationList,
    SoftwareList,
    DataProcessingList,
}

impl MetadataSectionKind {
    const ALL: [Self; 5] = [
        Self::FileDescription,
        Self::SampleList,
        Self::InstrumentConfigurationList,
        Self::SoftwareList,
        Self::DataProcessingList,
    ];

    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::FileDescription => "file_description",
            Self::SampleList => "sample_list",
            Self::InstrumentConfigurationList => "instrument_configuration_list",
            Self::SoftwareList => "software_list",
            Self::DataProcessingList => "data_processing_list",
        }
    }
}

/// One unparsed metadata line. Its text may contain sensitive local values.
#[derive(Clone, PartialEq, Eq)]
pub struct MetadataEntry {
    sensitive_text: String,
}

impl MetadataEntry {
    /// Returns the exact line content retained by the parser.
    ///
    /// The value is sensitive backend output. It must not be logged or placed
    /// in reportable diagnostics without an explicit privacy review.
    #[must_use]
    pub fn sensitive_text(&self) -> &str {
        &self.sensitive_text
    }
}

impl fmt::Debug for MetadataEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MetadataEntry")
            .field("sensitive_text", &"<opaque-sensitive>")
            .field("byte_count", &self.sensitive_text.len())
            .finish()
    }
}

/// An ordered metadata section containing only opaque, ordered lines.
#[derive(Clone, PartialEq, Eq)]
pub struct MetadataSection {
    kind: MetadataSectionKind,
    entries: Vec<MetadataEntry>,
}

impl fmt::Debug for MetadataSection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MetadataSection")
            .field("kind", &self.kind)
            .field("entry_count", &self.entries.len())
            .finish()
    }
}

impl MetadataSection {
    #[must_use]
    pub const fn kind(&self) -> MetadataSectionKind {
        self.kind
    }

    #[must_use]
    pub fn entries(&self) -> &[MetadataEntry] {
        &self.entries
    }
}

/// Structurally parsed metadata with source section and field order preserved.
#[derive(Clone, PartialEq, Eq)]
pub struct MetadataResult {
    leading_entries: Vec<MetadataEntry>,
    sections: Vec<MetadataSection>,
}

impl fmt::Debug for MetadataResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MetadataResult")
            .field("leading_entry_count", &self.leading_entries.len())
            .field("section_count", &self.sections.len())
            .finish()
    }
}

impl MetadataResult {
    #[must_use]
    pub fn leading_entries(&self) -> &[MetadataEntry] {
        &self.leading_entries
    }

    #[must_use]
    pub fn sections(&self) -> &[MetadataSection] {
        &self.sections
    }
}

/// A spectrum-count bucket emitted by the run summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MsLevelBucket {
    Level(u32),
    Other,
}

/// One ordered MS-level count from the run summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MsLevelCount {
    bucket: MsLevelBucket,
    spectrum_count: u64,
}

impl MsLevelCount {
    #[must_use]
    pub const fn bucket(self) -> MsLevelBucket {
        self.bucket
    }

    #[must_use]
    pub const fn spectrum_count(self) -> u64 {
        self.spectrum_count
    }
}

/// Retention-time fields emitted by `run_summary delimiter=tab`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunRetentionTimeRange {
    minimum: RetentionTime,
    at_25_percent_base_peak_intensity: RetentionTime,
    at_50_percent_base_peak_intensity: RetentionTime,
    at_75_percent_base_peak_intensity: RetentionTime,
    maximum: RetentionTime,
}

impl RunRetentionTimeRange {
    #[must_use]
    pub const fn minimum(self) -> RetentionTime {
        self.minimum
    }

    #[must_use]
    pub const fn at_25_percent_base_peak_intensity(self) -> RetentionTime {
        self.at_25_percent_base_peak_intensity
    }

    #[must_use]
    pub const fn at_50_percent_base_peak_intensity(self) -> RetentionTime {
        self.at_50_percent_base_peak_intensity
    }

    #[must_use]
    pub const fn at_75_percent_base_peak_intensity(self) -> RetentionTime {
        self.at_75_percent_base_peak_intensity
    }

    #[must_use]
    pub const fn maximum(self) -> RetentionTime {
        self.maximum
    }
}

/// Typed facts established by the run-summary formatter.
#[derive(Clone, PartialEq)]
pub struct RunSummaryResult {
    total_spectrum_count: u64,
    counts_by_ms_level: Vec<MsLevelCount>,
    chromatogram_count: Option<u64>,
    retention_time_range: Option<RunRetentionTimeRange>,
}

impl fmt::Debug for RunSummaryResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RunSummaryResult")
            .field("total_spectrum_count", &self.total_spectrum_count)
            .field("ms_level_bucket_count", &self.counts_by_ms_level.len())
            .field("chromatogram_count", &self.chromatogram_count)
            .field(
                "retention_time_range_emitted",
                &self.retention_time_range.is_some(),
            )
            .finish()
    }
}

impl RunSummaryResult {
    #[must_use]
    pub const fn total_spectrum_count(&self) -> u64 {
        self.total_spectrum_count
    }

    #[must_use]
    pub fn counts_by_ms_level(&self) -> &[MsLevelCount] {
        &self.counts_by_ms_level
    }

    /// Returns `None` because the measured run-summary format did not emit a
    /// chromatogram count.
    #[must_use]
    pub const fn chromatogram_count(&self) -> Option<u64> {
        self.chromatogram_count
    }

    #[must_use]
    pub const fn retention_time_range(&self) -> Option<RunRetentionTimeRange> {
        self.retention_time_range
    }
}

/// The formatter role of a raw spectrum identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumIdentifierKind {
    Display,
    Native,
}

/// One raw spectrum identifier retained without vendor-specific inference.
#[derive(Clone, PartialEq, Eq)]
pub struct SpectrumIdentifier {
    kind: SpectrumIdentifierKind,
    sensitive_raw: String,
}

impl SpectrumIdentifier {
    #[must_use]
    pub const fn kind(&self) -> SpectrumIdentifierKind {
        self.kind
    }

    /// Returns the exact formatter identifier.
    ///
    /// Treat this as sensitive backend output when creating diagnostics.
    #[must_use]
    pub fn sensitive_raw(&self) -> &str {
        &self.sensitive_raw
    }
}

impl fmt::Debug for SpectrumIdentifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SpectrumIdentifier")
            .field("kind", &self.kind)
            .field("sensitive_raw", &"<opaque-sensitive>")
            .field("byte_count", &self.sensitive_raw.len())
            .finish()
    }
}

/// Canonical identity that always retains the zero-based spectrum index.
#[derive(Clone, PartialEq, Eq)]
pub struct SpectrumIdentity {
    index: u64,
    representations: Vec<SpectrumIdentifier>,
    scan_number: Option<u64>,
}

impl SpectrumIdentity {
    #[must_use]
    pub const fn index(&self) -> u64 {
        self.index
    }

    #[must_use]
    pub fn representations(&self) -> &[SpectrumIdentifier] {
        &self.representations
    }

    #[must_use]
    pub const fn scan_number(&self) -> Option<u64> {
        self.scan_number
    }

    /// Reconciles table and selected-spectrum identities without discarding
    /// either raw representation.
    pub fn reconcile(&self, other: &Self) -> Result<Self, SpectrumIdentityConflict> {
        if self.index != other.index {
            return Err(SpectrumIdentityConflict::Index);
        }
        if let (Some(left), Some(right)) = (self.scan_number, other.scan_number)
            && left != right
        {
            return Err(SpectrumIdentityConflict::ScanNumber);
        }

        let mut representations = self.representations.clone();
        for representation in &other.representations {
            if !representations.contains(representation) {
                representations.push(representation.clone());
            }
        }
        Ok(Self {
            index: self.index,
            representations,
            scan_number: self.scan_number.or(other.scan_number),
        })
    }

    fn from_raw(
        index: u64,
        kind: SpectrumIdentifierKind,
        raw: String,
        reported_scan_number: Option<u64>,
    ) -> Result<Self, SpectrumIdentityConflict> {
        let parsed_scan_number = recognized_scan_number(kind, &raw);
        if let (Some(parsed), Some(reported)) = (parsed_scan_number, reported_scan_number)
            && parsed != reported
        {
            return Err(SpectrumIdentityConflict::ScanNumber);
        }
        Ok(Self {
            index,
            representations: vec![SpectrumIdentifier {
                kind,
                sensitive_raw: raw,
            }],
            scan_number: parsed_scan_number.or(reported_scan_number),
        })
    }
}

impl fmt::Debug for SpectrumIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SpectrumIdentity")
            .field("index", &self.index)
            .field("scan_number", &self.scan_number)
            .field("representation_count", &self.representations.len())
            .finish()
    }
}

/// A conflict between independently emitted identity facts.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumIdentityConflict {
    #[error("spectrum indices conflict")]
    Index,
    #[error("recognized spectrum scan numbers conflict")]
    ScanNumber,
}

/// One exact row from `spectrum_table delimiter=tab`.
#[derive(Clone, PartialEq)]
pub struct SpectrumTableRow {
    identity: SpectrumIdentity,
    event: String,
    analyzer: String,
    ms_level: u32,
    retention_time: RetentionTime,
    mz_low: f64,
    mz_high: f64,
    base_peak_mz: f64,
    base_peak_intensity: f64,
    total_ion_current: f64,
    charge: Option<f64>,
    precursor_mz: Option<f64>,
    thermo_mono_mz: Option<f64>,
    filter_string_mz: Option<f64>,
    ion_injection_time: Option<f64>,
}

impl fmt::Debug for SpectrumTableRow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SpectrumTableRow")
            .field("identity", &self.identity)
            .field("event_emitted", &!self.event.is_empty())
            .field("analyzer_emitted", &!self.analyzer.is_empty())
            .field("ms_level", &self.ms_level)
            .field("retention_time_unit", &self.retention_time.unit)
            .field("charge_emitted", &self.charge.is_some())
            .field("precursor_mz_emitted", &self.precursor_mz.is_some())
            .field("thermo_mono_mz_emitted", &self.thermo_mono_mz.is_some())
            .field("filter_string_mz_emitted", &self.filter_string_mz.is_some())
            .field(
                "ion_injection_time_emitted",
                &self.ion_injection_time.is_some(),
            )
            .finish()
    }
}

impl SpectrumTableRow {
    #[must_use]
    pub const fn identity(&self) -> &SpectrumIdentity {
        &self.identity
    }

    #[must_use]
    pub fn event(&self) -> &str {
        &self.event
    }

    #[must_use]
    pub fn analyzer(&self) -> &str {
        &self.analyzer
    }

    #[must_use]
    pub const fn ms_level(&self) -> u32 {
        self.ms_level
    }

    #[must_use]
    pub const fn retention_time(&self) -> RetentionTime {
        self.retention_time
    }

    #[must_use]
    pub const fn mz_low(&self) -> f64 {
        self.mz_low
    }

    #[must_use]
    pub const fn mz_high(&self) -> f64 {
        self.mz_high
    }

    #[must_use]
    pub const fn base_peak_mz(&self) -> f64 {
        self.base_peak_mz
    }

    #[must_use]
    pub const fn base_peak_intensity(&self) -> f64 {
        self.base_peak_intensity
    }

    #[must_use]
    pub const fn total_ion_current(&self) -> f64 {
        self.total_ion_current
    }

    #[must_use]
    pub const fn charge(&self) -> Option<f64> {
        self.charge
    }

    #[must_use]
    pub const fn precursor_mz(&self) -> Option<f64> {
        self.precursor_mz
    }

    #[must_use]
    pub const fn thermo_mono_mz(&self) -> Option<f64> {
        self.thermo_mono_mz
    }

    #[must_use]
    pub const fn filter_string_mz(&self) -> Option<f64> {
        self.filter_string_mz
    }

    #[must_use]
    pub const fn ion_injection_time(&self) -> Option<f64> {
        self.ion_injection_time
    }
}

/// Spectrum-table rows in backend/source order.
#[derive(Clone, PartialEq)]
pub struct SpectrumTableResult {
    rows: Vec<SpectrumTableRow>,
}

impl fmt::Debug for SpectrumTableResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SpectrumTableResult")
            .field("row_count", &self.rows.len())
            .finish()
    }
}

impl SpectrumTableResult {
    #[must_use]
    pub fn rows(&self) -> &[SpectrumTableRow] {
        &self.rows
    }
}

/// Scientific origin of a TIC intensity value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TicIntensityOrigin {
    RecomputedSummedIntensity,
}

/// Ordering supplied by the TIC formatter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TicSourceOrder {
    SpectrumIndex,
}

/// One TIC point in backend/source order.
#[derive(Clone, PartialEq)]
pub struct TicPoint {
    identity: SpectrumIdentity,
    ms_level: u32,
    retention_time: RetentionTime,
    summed_intensity: f64,
    source_ordinal: usize,
}

impl fmt::Debug for TicPoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TicPoint")
            .field("identity", &self.identity)
            .field("ms_level", &self.ms_level)
            .field("retention_time_unit", &self.retention_time.unit)
            .field("source_ordinal", &self.source_ordinal)
            .finish()
    }
}

impl TicPoint {
    #[must_use]
    pub const fn identity(&self) -> &SpectrumIdentity {
        &self.identity
    }

    #[must_use]
    pub const fn ms_level(&self) -> u32 {
        self.ms_level
    }

    #[must_use]
    pub const fn retention_time(&self) -> RetentionTime {
        self.retention_time
    }

    #[must_use]
    pub const fn summed_intensity(&self) -> f64 {
        self.summed_intensity
    }

    #[must_use]
    pub const fn source_ordinal(&self) -> usize {
        self.source_ordinal
    }
}

/// A derived TIC trace that retains the backend's spectrum-index order.
#[derive(Clone, PartialEq)]
pub struct TicResult {
    points: Vec<TicPoint>,
    ms_level_filter: Option<u8>,
    intensity_origin: TicIntensityOrigin,
    source_order: TicSourceOrder,
}

impl fmt::Debug for TicResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TicResult")
            .field("point_count", &self.points.len())
            .field("ms_level_filter", &self.ms_level_filter)
            .field("intensity_origin", &self.intensity_origin)
            .field("source_order", &self.source_order)
            .finish()
    }
}

impl TicResult {
    #[must_use]
    pub fn points(&self) -> &[TicPoint] {
        &self.points
    }

    #[must_use]
    pub const fn ms_level_filter(&self) -> Option<u8> {
        self.ms_level_filter
    }

    #[must_use]
    pub const fn intensity_origin(&self) -> TicIntensityOrigin {
        self.intensity_origin
    }

    #[must_use]
    pub const fn source_order(&self) -> TicSourceOrder {
        self.source_order
    }

    /// Returns a stable retention-time-ordered view without mutating source
    /// order or discarding source indices/ordinals.
    #[must_use]
    pub fn points_by_retention_time(&self) -> Vec<&TicPoint> {
        let mut points = self.points.iter().collect::<Vec<_>>();
        points.sort_by(|left, right| {
            left.retention_time
                .value
                .total_cmp(&right.retention_time.value)
                .then(left.source_ordinal.cmp(&right.source_ordinal))
        });
        points
    }
}

/// One precursor record emitted by the binary formatter.
#[derive(Clone, Copy, PartialEq)]
pub struct SpectrumPrecursor {
    index: u64,
    mz: f64,
    intensity: f64,
}

impl fmt::Debug for SpectrumPrecursor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SpectrumPrecursor")
            .field("index", &self.index)
            .finish()
    }
}

impl SpectrumPrecursor {
    #[must_use]
    pub const fn index(self) -> u64 {
        self.index
    }

    #[must_use]
    pub const fn mz(self) -> f64 {
        self.mz
    }

    #[must_use]
    pub const fn intensity(self) -> f64 {
        self.intensity
    }
}

/// Formatter precision requested and observed for selected-spectrum arrays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NumericPrecisionEvidence {
    requested_fraction_digits: u8,
    observed_maximum_fraction_digits: u8,
}

impl NumericPrecisionEvidence {
    #[must_use]
    pub const fn requested_fraction_digits(self) -> u8 {
        self.requested_fraction_digits
    }

    #[must_use]
    pub const fn observed_maximum_fraction_digits(self) -> u8 {
        self.observed_maximum_fraction_digits
    }
}

/// Selected-spectrum facts emitted by `binary index=... precision=...`.
#[derive(Clone, PartialEq)]
pub struct SelectedSpectrumResult {
    identity: SpectrumIdentity,
    ms_level: u32,
    retention_time: RetentionTime,
    mz_values: Vec<f64>,
    intensity_values: Vec<f64>,
    precursors: Vec<SpectrumPrecursor>,
    mass_analyzer_type: Option<String>,
    scan_event: Option<String>,
    filter_string: Option<String>,
    mz_low: f64,
    mz_high: f64,
    base_peak_mz: f64,
    base_peak_intensity: f64,
    total_ion_current: f64,
    precision: NumericPrecisionEvidence,
    value_units: UnitState,
    representation: SpectrumRepresentationState,
}

impl fmt::Debug for SelectedSpectrumResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SelectedSpectrumResult")
            .field("identity", &self.identity)
            .field("ms_level", &self.ms_level)
            .field("retention_time_unit", &self.retention_time.unit)
            .field("point_count", &self.mz_values.len())
            .field("precursor_count", &self.precursors.len())
            .field(
                "mass_analyzer_type_emitted",
                &self.mass_analyzer_type.is_some(),
            )
            .field("scan_event_emitted", &self.scan_event.is_some())
            .field("filter_string_emitted", &self.filter_string.is_some())
            .field("precision", &self.precision)
            .field("value_units", &self.value_units)
            .field("representation", &self.representation)
            .finish()
    }
}

impl SelectedSpectrumResult {
    #[must_use]
    pub const fn identity(&self) -> &SpectrumIdentity {
        &self.identity
    }

    #[must_use]
    pub const fn ms_level(&self) -> u32 {
        self.ms_level
    }

    #[must_use]
    pub const fn retention_time(&self) -> RetentionTime {
        self.retention_time
    }

    #[must_use]
    pub fn mz_values(&self) -> &[f64] {
        &self.mz_values
    }

    #[must_use]
    pub fn intensity_values(&self) -> &[f64] {
        &self.intensity_values
    }

    #[must_use]
    pub fn precursors(&self) -> &[SpectrumPrecursor] {
        &self.precursors
    }

    #[must_use]
    pub fn mass_analyzer_type(&self) -> Option<&str> {
        self.mass_analyzer_type.as_deref()
    }

    #[must_use]
    pub fn scan_event(&self) -> Option<&str> {
        self.scan_event.as_deref()
    }

    #[must_use]
    pub fn filter_string(&self) -> Option<&str> {
        self.filter_string.as_deref()
    }

    #[must_use]
    pub const fn mz_low(&self) -> f64 {
        self.mz_low
    }

    #[must_use]
    pub const fn mz_high(&self) -> f64 {
        self.mz_high
    }

    #[must_use]
    pub const fn base_peak_mz(&self) -> f64 {
        self.base_peak_mz
    }

    #[must_use]
    pub const fn base_peak_intensity(&self) -> f64 {
        self.base_peak_intensity
    }

    #[must_use]
    pub const fn total_ion_current(&self) -> f64 {
        self.total_ion_current
    }

    #[must_use]
    pub const fn precision(&self) -> NumericPrecisionEvidence {
        self.precision
    }

    #[must_use]
    pub const fn value_units(&self) -> UnitState {
        self.value_units
    }

    #[must_use]
    pub const fn representation(&self) -> SpectrumRepresentationState {
        self.representation
    }
}

/// Whether profile/centroid representation was emitted for a selected spectrum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumRepresentationState {
    NotEmitted,
}

/// A successful typed preview value.
#[derive(Debug, Clone, PartialEq)]
pub enum PreviewValue {
    Metadata(MetadataResult),
    RunSummary(RunSummaryResult),
    SpectrumTable(SpectrumTableResult),
    Tic(TicResult),
    SelectedSpectrum(SelectedSpectrumResult),
}

/// The only measured valid no-result state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewNoResult {
    SpectrumUnavailable { requested_index: u64 },
}

/// A successful typed value or an operation-specific valid no-result.
#[derive(Debug, Clone, PartialEq)]
pub enum PreviewOutcome {
    Value(Box<PreviewValue>),
    NoResult(PreviewNoResult),
}

/// Source whose complete bytes are required by an operation parser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewInputSource {
    Stdout,
    OutputFile,
}

/// Stable structural reason why otherwise-present output was malformed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewMalformedKind {
    Empty,
    InvalidShape,
    InvalidHeader,
    MissingRequiredSection,
    DuplicateRequiredSection,
    InvalidField,
    InvalidRowWidth,
    InvalidIndex,
    InvalidIndexOrder,
    InvalidMsLevel,
    NonFiniteNumber,
    CountMismatch,
    IdentityConflict,
    PrecisionExceeded,
}

impl PreviewMalformedKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::InvalidShape => "invalid_shape",
            Self::InvalidHeader => "invalid_header",
            Self::MissingRequiredSection => "missing_required_section",
            Self::DuplicateRequiredSection => "duplicate_required_section",
            Self::InvalidField => "invalid_field",
            Self::InvalidRowWidth => "invalid_row_width",
            Self::InvalidIndex => "invalid_index",
            Self::InvalidIndexOrder => "invalid_index_order",
            Self::InvalidMsLevel => "invalid_ms_level",
            Self::NonFiniteNumber => "non_finite_number",
            Self::CountMismatch => "count_mismatch",
            Self::IdentityConflict => "identity_conflict",
            Self::PrecisionExceeded => "precision_exceeded",
        }
    }
}

/// Semantic interpretation failure. No variant contains raw backend text or paths.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PreviewInterpretError {
    #[error("the preview operation was cancelled")]
    Cancelled,
    #[error("the preview backend exited with code {exit_code}")]
    BackendNonZeroExit { exit_code: i32 },
    #[error("the preview backend exited without a classifiable exit code")]
    UnclassifiedBackendBehavior,
    #[error("the requested preview operation is outside the validated command contract")]
    InvalidOperation { operation: PreviewOperation },
    #[error("the preview operation did not produce its required output")]
    MissingRequiredOutput { operation: PreviewOperation },
    #[error("the preview operation produced an unexpected output count")]
    UnexpectedOutputCount {
        operation: PreviewOperation,
        expected: usize,
        actual: usize,
    },
    #[error("the preview operation produced a non-regular output entry")]
    UnexpectedOutputType { operation: PreviewOperation },
    #[error("the complete preview parser input was not captured")]
    IncompleteParserInput {
        operation: PreviewOperation,
        input_source: PreviewInputSource,
        captured_bytes: u64,
        total_bytes: u64,
    },
    #[error("the preview parser input is not strict UTF-8")]
    InvalidUtf8 {
        operation: PreviewOperation,
        input_source: PreviewInputSource,
    },
    #[error("the preview output is structurally malformed: {kind:?}")]
    MalformedOutput {
        operation: PreviewOperation,
        kind: PreviewMalformedKind,
    },
}

impl PreviewInterpretError {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::BackendNonZeroExit { .. } => "backend_non_zero_exit",
            Self::UnclassifiedBackendBehavior => "unclassified_backend_behavior",
            Self::InvalidOperation { .. } => "invalid_operation",
            Self::MissingRequiredOutput { .. } => "missing_required_output",
            Self::UnexpectedOutputCount { .. } => "unexpected_output_count",
            Self::UnexpectedOutputType { .. } => "unexpected_output_type",
            Self::IncompleteParserInput { .. } => "incomplete_parser_input",
            Self::InvalidUtf8 { .. } => "invalid_utf8",
            Self::MalformedOutput { .. } => "malformed_output",
        }
    }
}

/// One path-free captured output-directory entry.
#[derive(Clone, PartialEq, Eq)]
pub enum PreviewOutputEntry {
    CompleteFile(Vec<u8>),
    IncompleteFile {
        captured_bytes: u64,
        total_bytes: u64,
    },
    Directory,
    Other,
}

impl PreviewOutputEntry {
    #[must_use]
    pub fn complete_file(bytes: impl Into<Vec<u8>>) -> Self {
        Self::CompleteFile(bytes.into())
    }

    #[must_use]
    pub const fn incomplete_file(captured_bytes: u64, total_bytes: u64) -> Self {
        Self::IncompleteFile {
            captured_bytes,
            total_bytes,
        }
    }
}

impl fmt::Debug for PreviewOutputEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CompleteFile(bytes) => formatter
                .debug_struct("CompleteFile")
                .field("byte_count", &bytes.len())
                .field("contents", &"<opaque-sensitive>")
                .finish(),
            Self::IncompleteFile {
                captured_bytes,
                total_bytes,
            } => formatter
                .debug_struct("IncompleteFile")
                .field("captured_bytes", captured_bytes)
                .field("total_bytes", total_bytes)
                .finish(),
            Self::Directory => formatter.write_str("Directory"),
            Self::Other => formatter.write_str("Other"),
        }
    }
}

/// A path-free snapshot of preview output entries.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct PreviewOutputManifest {
    entries: Vec<PreviewOutputEntry>,
}

impl PreviewOutputManifest {
    #[must_use]
    pub const fn empty() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    #[must_use]
    pub fn new(entries: Vec<PreviewOutputEntry>) -> Self {
        Self { entries }
    }

    #[must_use]
    pub fn single_complete_file(bytes: impl Into<Vec<u8>>) -> Self {
        Self::new(vec![PreviewOutputEntry::complete_file(bytes)])
    }

    #[must_use]
    pub fn entries(&self) -> &[PreviewOutputEntry] {
        &self.entries
    }
}

impl fmt::Debug for PreviewOutputManifest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreviewOutputManifest")
            .field("entries", &self.entries)
            .finish()
    }
}

/// Interprets one completed preview process and its captured output manifest.
///
/// Launch and supervision failures remain represented by [`crate::ProcessError`]
/// before this boundary. This function gives cancellation and backend exit
/// status precedence over semantic parsing, then applies operation-specific
/// output postconditions. It never classifies English stderr.
pub fn interpret_preview(
    operation: &PreviewOperation,
    process: &ProcessOutput,
    manifest: &PreviewOutputManifest,
) -> Result<PreviewOutcome, PreviewInterpretError> {
    if process.termination == Termination::Cancelled {
        return Err(PreviewInterpretError::Cancelled);
    }
    match process.exit_code {
        Some(0) => {}
        Some(exit_code) => {
            return Err(PreviewInterpretError::BackendNonZeroExit { exit_code });
        }
        None => return Err(PreviewInterpretError::UnclassifiedBackendBehavior),
    }
    if matches!(operation, PreviewOperation::Tic { ms_level: Some(0) })
        || matches!(
            operation,
            PreviewOperation::SpectrumByIndex { precision, .. } if *precision > 15
        )
    {
        return Err(PreviewInterpretError::InvalidOperation {
            operation: operation.clone(),
        });
    }

    let value = match operation {
        PreviewOperation::RunSummary => {
            if !manifest.entries.is_empty() {
                return Err(PreviewInterpretError::UnexpectedOutputCount {
                    operation: operation.clone(),
                    expected: 0,
                    actual: manifest.entries.len(),
                });
            }
            let captured_bytes = u64::try_from(process.stdout.len()).unwrap_or(u64::MAX);
            if process.stdout_truncated
                || process.stdout_total_bytes != captured_bytes
                || process.stdout_total_bytes > MAX_COMPLETE_TEXT_BYTES
            {
                return Err(PreviewInterpretError::IncompleteParserInput {
                    operation: operation.clone(),
                    input_source: PreviewInputSource::Stdout,
                    captured_bytes,
                    total_bytes: process.stdout_total_bytes,
                });
            }
            if process.stdout.is_empty() {
                return Err(PreviewInterpretError::MissingRequiredOutput {
                    operation: operation.clone(),
                });
            }
            let text = strict_text(operation, PreviewInputSource::Stdout, &process.stdout)?;
            PreviewValue::RunSummary(
                parse_run_summary(text).map_err(|kind| malformed(operation, kind))?,
            )
        }
        PreviewOperation::SpectrumByIndex { index, precision } => {
            if manifest.entries.is_empty() {
                return Ok(PreviewOutcome::NoResult(
                    PreviewNoResult::SpectrumUnavailable {
                        requested_index: *index,
                    },
                ));
            }
            let bytes = required_file(operation, manifest)?;
            let text = strict_text(operation, PreviewInputSource::OutputFile, bytes)?;
            PreviewValue::SelectedSpectrum(
                parse_selected_spectrum(text, *index, *precision)
                    .map_err(|kind| malformed(operation, kind))?,
            )
        }
        PreviewOperation::Metadata => {
            let bytes = required_file(operation, manifest)?;
            let text = strict_text(operation, PreviewInputSource::OutputFile, bytes)?;
            PreviewValue::Metadata(parse_metadata(text).map_err(|kind| malformed(operation, kind))?)
        }
        PreviewOperation::SpectrumTable => {
            let bytes = required_file(operation, manifest)?;
            let text = strict_text(operation, PreviewInputSource::OutputFile, bytes)?;
            PreviewValue::SpectrumTable(
                parse_spectrum_table(text).map_err(|kind| malformed(operation, kind))?,
            )
        }
        PreviewOperation::Tic { ms_level } => {
            let bytes = required_file(operation, manifest)?;
            let text = strict_text(operation, PreviewInputSource::OutputFile, bytes)?;
            PreviewValue::Tic(
                parse_tic(text, *ms_level).map_err(|kind| malformed(operation, kind))?,
            )
        }
    };
    Ok(PreviewOutcome::Value(Box::new(value)))
}

fn malformed(operation: &PreviewOperation, kind: PreviewMalformedKind) -> PreviewInterpretError {
    PreviewInterpretError::MalformedOutput {
        operation: operation.clone(),
        kind,
    }
}

fn required_file<'a>(
    operation: &PreviewOperation,
    manifest: &'a PreviewOutputManifest,
) -> Result<&'a [u8], PreviewInterpretError> {
    match manifest.entries.as_slice() {
        [] => Err(PreviewInterpretError::MissingRequiredOutput {
            operation: operation.clone(),
        }),
        [PreviewOutputEntry::CompleteFile(bytes)] => {
            if bytes.is_empty() {
                return Err(malformed(operation, PreviewMalformedKind::Empty));
            }
            let total_bytes = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
            if total_bytes > MAX_COMPLETE_TEXT_BYTES {
                return Err(PreviewInterpretError::IncompleteParserInput {
                    operation: operation.clone(),
                    input_source: PreviewInputSource::OutputFile,
                    captured_bytes: total_bytes,
                    total_bytes,
                });
            }
            Ok(bytes)
        }
        [
            PreviewOutputEntry::IncompleteFile {
                captured_bytes,
                total_bytes,
            },
        ] => Err(PreviewInterpretError::IncompleteParserInput {
            operation: operation.clone(),
            input_source: PreviewInputSource::OutputFile,
            captured_bytes: *captured_bytes,
            total_bytes: *total_bytes,
        }),
        [PreviewOutputEntry::Directory | PreviewOutputEntry::Other] => {
            Err(PreviewInterpretError::UnexpectedOutputType {
                operation: operation.clone(),
            })
        }
        entries => Err(PreviewInterpretError::UnexpectedOutputCount {
            operation: operation.clone(),
            expected: 1,
            actual: entries.len(),
        }),
    }
}

fn strict_text<'a>(
    operation: &PreviewOperation,
    source: PreviewInputSource,
    bytes: &'a [u8],
) -> Result<&'a str, PreviewInterpretError> {
    std::str::from_utf8(bytes).map_err(|_| PreviewInterpretError::InvalidUtf8 {
        operation: operation.clone(),
        input_source: source,
    })
}

fn parse_metadata(text: &str) -> Result<MetadataResult, PreviewMalformedKind> {
    let mut leading_entries = Vec::new();
    let mut sections: Vec<MetadataSection> = Vec::new();
    let mut seen = BTreeSet::new();

    for line in scientific_lines(text) {
        if let Some(kind) = metadata_section_marker(line) {
            if !seen.insert(kind) {
                return Err(PreviewMalformedKind::DuplicateRequiredSection);
            }
            sections.push(MetadataSection {
                kind,
                entries: Vec::new(),
            });
        } else {
            let entry = MetadataEntry {
                sensitive_text: line.to_owned(),
            };
            if let Some(section) = sections.last_mut() {
                section.entries.push(entry);
            } else {
                leading_entries.push(entry);
            }
        }
    }

    if MetadataSectionKind::ALL
        .iter()
        .any(|required| !seen.contains(required))
    {
        return Err(PreviewMalformedKind::MissingRequiredSection);
    }

    Ok(MetadataResult {
        leading_entries,
        sections,
    })
}

fn metadata_section_marker(line: &str) -> Option<MetadataSectionKind> {
    match line.trim() {
        "fileDescription:" => Some(MetadataSectionKind::FileDescription),
        "sampleList:" => Some(MetadataSectionKind::SampleList),
        "instrumentConfigurationList:" => Some(MetadataSectionKind::InstrumentConfigurationList),
        "softwareList:" => Some(MetadataSectionKind::SoftwareList),
        "dataProcessingList" => Some(MetadataSectionKind::DataProcessingList),
        _ => None,
    }
}

fn parse_run_summary(text: &str) -> Result<RunSummaryResult, PreviewMalformedKind> {
    let lines = nonempty_scientific_lines(text);
    if lines.len() != 2 {
        return Err(PreviewMalformedKind::InvalidShape);
    }
    let headers = split_tsv(lines[0]);
    let values = split_tsv(lines[1]);
    if headers.len() != values.len() || headers.len() < 12 {
        return Err(PreviewMalformedKind::InvalidRowWidth);
    }

    let mut seen_headers = BTreeSet::new();
    if headers
        .iter()
        .any(|header| header.trim().is_empty() || !seen_headers.insert(*header))
    {
        return Err(PreviewMalformedKind::InvalidHeader);
    }
    if headers[..5] != ["Filename", "Timestamp", "Vendor", "Model", "Serial#"]
        || headers[headers.len() - 5..] != ["MinRT", "RT@25%BPI", "RT@50%BPI", "RT@75%BPI", "MaxRT"]
    {
        return Err(PreviewMalformedKind::InvalidHeader);
    }

    let mut counts_by_ms_level = Vec::new();
    let mut total_spectrum_count = 0_u64;
    let mut saw_zooms = false;
    let mut saw_charges = false;
    let mut point_statistics = BTreeMap::<u32, u8>::new();

    for index in 5..headers.len() - 5 {
        let header = headers[index];
        let value = values[index];
        if let Some(level) = parse_count_ms_level_header(header) {
            let count = parse_nonnegative_i64(value)?;
            total_spectrum_count = total_spectrum_count
                .checked_add(count)
                .ok_or(PreviewMalformedKind::CountMismatch)?;
            counts_by_ms_level.push(MsLevelCount {
                bucket: MsLevelBucket::Level(level),
                spectrum_count: count,
            });
        } else if header == "MS(others)" {
            let count = parse_nonnegative_i64(value)?;
            total_spectrum_count = total_spectrum_count
                .checked_add(count)
                .ok_or(PreviewMalformedKind::CountMismatch)?;
            counts_by_ms_level.push(MsLevelCount {
                bucket: MsLevelBucket::Other,
                spectrum_count: count,
            });
        } else if header == "Zooms" {
            if saw_zooms {
                return Err(PreviewMalformedKind::InvalidHeader);
            }
            parse_nonnegative_i64(value)?;
            saw_zooms = true;
        } else if header == "Charges" {
            if saw_charges {
                return Err(PreviewMalformedKind::InvalidHeader);
            }
            parse_nonnegative_i64(value)?;
            saw_charges = true;
        } else if is_charge_count_header(header) {
            parse_nonnegative_i64(value)?;
        } else if let Some((level, statistic_bit)) = parse_point_statistic_header(header) {
            parse_finite(value)?;
            let mask = point_statistics.entry(level).or_default();
            if *mask & statistic_bit != 0 {
                return Err(PreviewMalformedKind::InvalidHeader);
            }
            *mask |= statistic_bit;
        } else {
            return Err(PreviewMalformedKind::InvalidHeader);
        }
    }

    if counts_by_ms_level.is_empty() || total_spectrum_count == 0 || !saw_zooms || !saw_charges {
        return Err(PreviewMalformedKind::CountMismatch);
    }
    for entry in &counts_by_ms_level {
        if let MsLevelBucket::Level(level) = entry.bucket
            && point_statistics.get(&level) != Some(&0b11_1111)
        {
            return Err(PreviewMalformedKind::CountMismatch);
        }
    }

    let rt_values = &values[values.len() - 5..];
    let minimum = parse_finite(rt_values[0])?;
    let at_25 = parse_finite(rt_values[1])?;
    let at_50 = parse_finite(rt_values[2])?;
    let at_75 = parse_finite(rt_values[3])?;
    let maximum = parse_finite(rt_values[4])?;
    if minimum > maximum {
        return Err(PreviewMalformedKind::InvalidField);
    }
    let retention_time = |value| RetentionTime {
        value,
        unit: UnitState::NotEmitted,
    };

    Ok(RunSummaryResult {
        total_spectrum_count,
        counts_by_ms_level,
        chromatogram_count: None,
        retention_time_range: Some(RunRetentionTimeRange {
            minimum: retention_time(minimum),
            at_25_percent_base_peak_intensity: retention_time(at_25),
            at_50_percent_base_peak_intensity: retention_time(at_50),
            at_75_percent_base_peak_intensity: retention_time(at_75),
            maximum: retention_time(maximum),
        }),
    })
}

fn parse_spectrum_table(text: &str) -> Result<SpectrumTableResult, PreviewMalformedKind> {
    const HEADERS: [&str; 16] = [
        "index",
        "id",
        "event",
        "analyzer",
        "msLevel",
        "rt",
        "mzLow",
        "mzHigh",
        "basePeakMZ",
        "basePeakInt",
        "TIC",
        "charge",
        "precursorMZ",
        "thermo_monoMZ",
        "filterStringMZ",
        "ionInjectionTime",
    ];

    let lines = nonempty_scientific_lines(text);
    if lines.len() < 3 || !is_source_comment(lines[0]) {
        return Err(PreviewMalformedKind::InvalidShape);
    }
    if split_tsv(lines[1]).as_slice() != HEADERS {
        return Err(PreviewMalformedKind::InvalidHeader);
    }

    let mut rows = Vec::with_capacity(lines.len() - 2);
    let mut seen_indices = BTreeSet::new();
    for (source_ordinal, line) in lines[2..].iter().enumerate() {
        let fields = split_tsv(line);
        if fields.len() != HEADERS.len() {
            return Err(PreviewMalformedKind::InvalidRowWidth);
        }
        let index = parse_index(fields[0])?;
        let expected_index =
            u64::try_from(source_ordinal).map_err(|_| PreviewMalformedKind::InvalidIndex)?;
        if index != expected_index {
            return Err(PreviewMalformedKind::InvalidIndexOrder);
        }
        if !seen_indices.insert(index) {
            return Err(PreviewMalformedKind::InvalidIndexOrder);
        }
        if fields[1].trim().is_empty() {
            return Err(PreviewMalformedKind::InvalidField);
        }
        let ms_level = parse_ms_level_label(fields[4])?;
        let retention_time = RetentionTime {
            value: parse_finite(fields[5])?,
            unit: UnitState::NotEmitted,
        };
        let identity = SpectrumIdentity::from_raw(
            index,
            SpectrumIdentifierKind::Display,
            fields[1].to_owned(),
            None,
        )
        .map_err(|_| PreviewMalformedKind::IdentityConflict)?;

        rows.push(SpectrumTableRow {
            identity,
            event: fields[2].to_owned(),
            analyzer: fields[3].to_owned(),
            ms_level,
            retention_time,
            mz_low: parse_finite(fields[6])?,
            mz_high: parse_finite(fields[7])?,
            base_peak_mz: parse_finite(fields[8])?,
            base_peak_intensity: parse_finite(fields[9])?,
            total_ion_current: parse_finite(fields[10])?,
            charge: parse_optional_finite(fields[11])?,
            precursor_mz: parse_optional_finite(fields[12])?,
            thermo_mono_mz: parse_optional_finite(fields[13])?,
            filter_string_mz: parse_optional_finite(fields[14])?,
            ion_injection_time: parse_optional_finite(fields[15])?,
        });
    }
    Ok(SpectrumTableResult { rows })
}

fn parse_tic(text: &str, ms_level_filter: Option<u8>) -> Result<TicResult, PreviewMalformedKind> {
    const HEADERS: [&str; 7] = [
        "# index",
        "id",
        "event",
        "analyzer",
        "msLevel",
        "rt",
        "sumIntensity",
    ];

    let lines = nonempty_scientific_lines(text);
    if lines.len() < 2 || !is_source_comment(lines[0]) {
        return Err(PreviewMalformedKind::InvalidShape);
    }
    if split_tsv(lines[1]).as_slice() != HEADERS {
        return Err(PreviewMalformedKind::InvalidHeader);
    }

    let mut points = Vec::with_capacity(lines.len().saturating_sub(2));
    let mut seen_indices = BTreeSet::new();
    let mut previous_index = None;
    for (source_ordinal, line) in lines[2..].iter().enumerate() {
        let fields = split_tsv(line);
        if fields.len() != HEADERS.len() {
            return Err(PreviewMalformedKind::InvalidRowWidth);
        }
        let index = parse_index(fields[0])?;
        if ms_level_filter.is_none()
            && index
                != u64::try_from(source_ordinal).map_err(|_| PreviewMalformedKind::InvalidIndex)?
        {
            return Err(PreviewMalformedKind::InvalidIndexOrder);
        }
        if previous_index.is_some_and(|previous| index <= previous) {
            return Err(PreviewMalformedKind::InvalidIndexOrder);
        }
        previous_index = Some(index);
        if !seen_indices.insert(index) {
            return Err(PreviewMalformedKind::InvalidIndexOrder);
        }
        if fields[1].trim().is_empty() {
            return Err(PreviewMalformedKind::InvalidField);
        }
        let ms_level = parse_ms_level_label(fields[4])?;
        if ms_level_filter.is_some_and(|filter| ms_level != u32::from(filter)) {
            return Err(PreviewMalformedKind::InvalidField);
        }
        let identity = SpectrumIdentity::from_raw(
            index,
            SpectrumIdentifierKind::Display,
            fields[1].to_owned(),
            None,
        )
        .map_err(|_| PreviewMalformedKind::IdentityConflict)?;
        points.push(TicPoint {
            identity,
            ms_level,
            retention_time: RetentionTime {
                value: parse_finite(fields[5])?,
                unit: UnitState::NotEmitted,
            },
            summed_intensity: parse_finite(fields[6])?,
            source_ordinal,
        });
    }

    Ok(TicResult {
        points,
        ms_level_filter,
        intensity_origin: TicIntensityOrigin::RecomputedSummedIntensity,
        source_order: TicSourceOrder::SpectrumIndex,
    })
}

fn parse_selected_spectrum(
    text: &str,
    requested_index: u64,
    requested_precision: u8,
) -> Result<SelectedSpectrumResult, PreviewMalformedKind> {
    const HEADERS: [&str; 14] = [
        "index",
        "id",
        "scanNumber",
        "massAnalyzerType",
        "scanEvent",
        "msLevel",
        "retentionTime",
        "filterString",
        "mzLow",
        "mzHigh",
        "basePeakMZ",
        "basePeakIntensity",
        "totalIonCurrent",
        "precursorCount",
    ];

    let lines = nonempty_scientific_lines(text);
    if lines.len() < 18 || !is_source_comment(lines[0]) || lines[1] != "#" {
        return Err(PreviewMalformedKind::InvalidShape);
    }

    let mut headers = BTreeMap::<String, String>::new();
    let mut header_order = Vec::new();
    let mut precursors = Vec::new();
    let mut binary_marker = None;
    let mut binary_count = None;

    for (line_index, line) in lines.iter().enumerate().skip(2) {
        if line.starts_with("# binary") {
            binary_count = Some(parse_binary_marker(line)?);
            binary_marker = Some(line_index);
            break;
        }
        if line.starts_with("# precursor ") {
            precursors.push(parse_precursor_line(line)?);
            continue;
        }
        let (name, value) = parse_binary_header_line(line)?;
        if headers.insert(name.to_owned(), value.to_owned()).is_some() {
            return Err(PreviewMalformedKind::InvalidHeader);
        }
        header_order.push(name);
    }

    let binary_marker = binary_marker.ok_or(PreviewMalformedKind::InvalidShape)?;
    let binary_count = binary_count.ok_or(PreviewMalformedKind::InvalidShape)?;
    if binary_count == 0 {
        // The exercised evidence parser rejected `binary (0)`. A present empty
        // payload is therefore malformed, never the selected-only no-result.
        return Err(PreviewMalformedKind::Empty);
    }
    if header_order.as_slice() != HEADERS {
        return Err(PreviewMalformedKind::InvalidHeader);
    }

    let header = |name: &str| {
        headers
            .get(name)
            .map(String::as_str)
            .ok_or(PreviewMalformedKind::InvalidHeader)
    };
    let reported_index = parse_index(header("index")?)?;
    if reported_index != requested_index {
        return Err(PreviewMalformedKind::IdentityConflict);
    }
    let raw_identifier = header("id")?;
    if raw_identifier.trim().is_empty() {
        return Err(PreviewMalformedKind::InvalidField);
    }
    let reported_scan_number = parse_nonnegative_i64(header("scanNumber")?)?;
    let identity = SpectrumIdentity::from_raw(
        reported_index,
        SpectrumIdentifierKind::Native,
        raw_identifier.to_owned(),
        Some(reported_scan_number),
    )
    .map_err(|_| PreviewMalformedKind::IdentityConflict)?;
    let ms_level_u64 = parse_nonnegative_i64(header("msLevel")?)?;
    let ms_level = u32::try_from(ms_level_u64)
        .ok()
        .filter(|level| *level > 0)
        .ok_or(PreviewMalformedKind::InvalidMsLevel)?;

    let retention_time = RetentionTime {
        value: parse_finite(header("retentionTime")?)?,
        unit: UnitState::NotEmitted,
    };
    let mz_low = parse_finite(header("mzLow")?)?;
    let mz_high = parse_finite(header("mzHigh")?)?;
    let base_peak_mz = parse_finite(header("basePeakMZ")?)?;
    let base_peak_intensity = parse_finite(header("basePeakIntensity")?)?;
    let total_ion_current = parse_finite(header("totalIonCurrent")?)?;

    let precursor_count = parse_nonnegative_i64(header("precursorCount")?)?;
    if u64::try_from(precursors.len()).unwrap_or(u64::MAX) != precursor_count {
        return Err(PreviewMalformedKind::CountMismatch);
    }
    for (expected_index, precursor) in precursors.iter().enumerate() {
        if precursor.index
            != u64::try_from(expected_index).map_err(|_| PreviewMalformedKind::InvalidIndex)?
        {
            return Err(PreviewMalformedKind::InvalidIndexOrder);
        }
    }

    let data_lines = &lines[binary_marker + 1..];
    if u64::try_from(data_lines.len()).unwrap_or(u64::MAX) != binary_count {
        return Err(PreviewMalformedKind::CountMismatch);
    }
    let mut mz_values = Vec::with_capacity(data_lines.len());
    let mut intensity_values = Vec::with_capacity(data_lines.len());
    let mut maximum_fraction_digits = 0_usize;
    for line in data_lines {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 2 {
            return Err(PreviewMalformedKind::InvalidRowWidth);
        }
        mz_values.push(parse_finite(fields[0])?);
        intensity_values.push(parse_finite(fields[1])?);
        maximum_fraction_digits = maximum_fraction_digits
            .max(observed_fraction_digits(fields[0]))
            .max(observed_fraction_digits(fields[1]));
    }
    if mz_values.len() != intensity_values.len()
        || u64::try_from(mz_values.len()).unwrap_or(u64::MAX) != binary_count
    {
        return Err(PreviewMalformedKind::CountMismatch);
    }
    if maximum_fraction_digits > usize::from(requested_precision) {
        return Err(PreviewMalformedKind::PrecisionExceeded);
    }
    let observed_maximum_fraction_digits = u8::try_from(maximum_fraction_digits)
        .map_err(|_| PreviewMalformedKind::PrecisionExceeded)?;

    Ok(SelectedSpectrumResult {
        identity,
        ms_level,
        retention_time,
        mz_values,
        intensity_values,
        precursors,
        mass_analyzer_type: emitted_text(header("massAnalyzerType")?),
        scan_event: emitted_text(header("scanEvent")?),
        filter_string: emitted_text(header("filterString")?),
        mz_low,
        mz_high,
        base_peak_mz,
        base_peak_intensity,
        total_ion_current,
        precision: NumericPrecisionEvidence {
            requested_fraction_digits: requested_precision,
            observed_maximum_fraction_digits,
        },
        value_units: UnitState::NotEmitted,
        representation: SpectrumRepresentationState::NotEmitted,
    })
}

fn parse_binary_marker(line: &str) -> Result<u64, PreviewMalformedKind> {
    let trimmed = line.trim_end();
    let count = trimmed
        .strip_prefix("# binary (")
        .and_then(|value| value.strip_suffix("):"))
        .ok_or(PreviewMalformedKind::InvalidShape)?;
    parse_nonnegative_i64(count)
}

fn parse_precursor_line(line: &str) -> Result<SpectrumPrecursor, PreviewMalformedKind> {
    if line.chars().last().is_some_and(char::is_whitespace) {
        return Err(PreviewMalformedKind::InvalidField);
    }
    let remainder = line
        .strip_prefix("# precursor ")
        .ok_or(PreviewMalformedKind::InvalidField)?;
    let (index, values) = remainder
        .split_once(':')
        .ok_or(PreviewMalformedKind::InvalidField)?;
    if !values.chars().next().is_some_and(char::is_whitespace) {
        return Err(PreviewMalformedKind::InvalidField);
    }
    let values = values.split_whitespace().collect::<Vec<_>>();
    if values.len() != 2 {
        return Err(PreviewMalformedKind::InvalidRowWidth);
    }
    Ok(SpectrumPrecursor {
        index: parse_index(index)?,
        mz: parse_finite(values[0])?,
        intensity: parse_finite(values[1])?,
    })
}

fn parse_binary_header_line(line: &str) -> Result<(&str, &str), PreviewMalformedKind> {
    let remainder = line
        .strip_prefix("# ")
        .ok_or(PreviewMalformedKind::InvalidHeader)?;
    let (name, value) = remainder
        .split_once(':')
        .ok_or(PreviewMalformedKind::InvalidHeader)?;
    let mut name_chars = name.chars();
    if !name_chars
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        || name_chars.any(|character| !character.is_ascii_alphanumeric())
    {
        return Err(PreviewMalformedKind::InvalidHeader);
    }
    let value = value
        .char_indices()
        .next()
        .filter(|(_, character)| character.is_whitespace())
        .map_or(value, |(index, character)| {
            &value[index + character.len_utf8()..]
        });
    Ok((name, value))
}

fn emitted_text(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_owned())
}

fn scientific_lines(text: &str) -> impl Iterator<Item = &str> {
    text.split_terminator('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
}

fn nonempty_scientific_lines(text: &str) -> Vec<&str> {
    scientific_lines(text)
        .filter(|line| !line.is_empty())
        .collect()
}

fn split_tsv(line: &str) -> Vec<&str> {
    line.split('\t').collect()
}

fn is_source_comment(line: &str) -> bool {
    line.strip_prefix('#').is_some_and(|remainder| {
        remainder.chars().next().is_some_and(char::is_whitespace)
            && remainder.split_whitespace().next().is_some()
    })
}

fn parse_nonnegative_i64(value: &str) -> Result<u64, PreviewMalformedKind> {
    if value.is_empty() || !value.as_bytes().iter().all(u8::is_ascii_digit) {
        return Err(PreviewMalformedKind::InvalidField);
    }
    value
        .parse::<i64>()
        .ok()
        .filter(|parsed| *parsed >= 0)
        .map(|parsed| parsed as u64)
        .ok_or(PreviewMalformedKind::InvalidField)
}

fn parse_index(value: &str) -> Result<u64, PreviewMalformedKind> {
    parse_nonnegative_i64(value).map_err(|_| PreviewMalformedKind::InvalidIndex)
}

fn parse_finite(value: &str) -> Result<f64, PreviewMalformedKind> {
    let parsed = value
        .trim()
        .parse::<f64>()
        .map_err(|_| PreviewMalformedKind::InvalidField)?;
    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(PreviewMalformedKind::NonFiniteNumber)
    }
}

fn parse_optional_finite(value: &str) -> Result<Option<f64>, PreviewMalformedKind> {
    if value.trim().is_empty() {
        Ok(None)
    } else {
        parse_finite(value).map(Some)
    }
}

fn parse_positive_decimal(value: &str) -> Option<u32> {
    if !is_positive_decimal_syntax(value) {
        return None;
    }
    value
        .parse::<i32>()
        .ok()
        .filter(|parsed| *parsed > 0)
        .map(|parsed| parsed as u32)
}

fn is_positive_decimal_syntax(value: &str) -> bool {
    !value.is_empty() && value.as_bytes().iter().all(u8::is_ascii_digit) && !value.starts_with('0')
}

fn parse_count_ms_level_header(header: &str) -> Option<u32> {
    header
        .strip_prefix("MS")
        .and_then(|value| value.strip_suffix('s'))
        .and_then(parse_positive_decimal)
}

fn is_charge_count_header(header: &str) -> bool {
    header
        .strip_prefix('+')
        .and_then(|value| value.strip_suffix('s'))
        .is_some_and(is_positive_decimal_syntax)
}

fn parse_point_statistic_header(header: &str) -> Option<(u32, u8)> {
    let remainder = header.strip_prefix("MS")?;
    let (level, statistic) = remainder.split_once(" Pts")?;
    let level = parse_positive_decimal(level)?;
    let bit = match statistic {
        "Mean" => 1 << 0,
        "Min" => 1 << 1,
        "Q1" => 1 << 2,
        "Q2" => 1 << 3,
        "Q3" => 1 << 4,
        "Max" => 1 << 5,
        _ => return None,
    };
    Some((level, bit))
}

fn parse_ms_level_label(value: &str) -> Result<u32, PreviewMalformedKind> {
    value
        .strip_prefix("ms")
        .and_then(parse_positive_decimal)
        .ok_or(PreviewMalformedKind::InvalidMsLevel)
}

fn observed_fraction_digits(value: &str) -> usize {
    let Some((_, fraction)) = value.split_once('.') else {
        return 0;
    };
    fraction.bytes().take_while(u8::is_ascii_digit).count()
}

fn recognized_scan_number(kind: SpectrumIdentifierKind, raw: &str) -> Option<u64> {
    let candidate = match kind {
        SpectrumIdentifierKind::Display => raw,
        SpectrumIdentifierKind::Native => raw.strip_prefix("scan=")?,
    };
    if !is_canonical_unsigned_decimal(candidate) {
        return None;
    }
    candidate.parse().ok()
}

fn is_canonical_unsigned_decimal(value: &str) -> bool {
    !value.is_empty()
        && value.as_bytes().iter().all(u8::is_ascii_digit)
        && (value == "0" || !value.starts_with('0'))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    // These small test-only protocol fixtures use the exact structures from
    // the self-test strings committed and exercised at f0d7957. The explicitly
    // named unknown metadata entries are minimal synthetic protocol fields
    // added only to prove opaque preservation. None of these strings is
    // scientific evidence or an acquisition payload.
    const METADATA_FIXTURE: &str = concat!(
        "fileDescription:\n",
        "unknownFileEntry: opaque-value\n",
        "sampleList:\n",
        "unknownSampleEntry\n",
        "instrumentConfigurationList:\n",
        "softwareList:\n",
        "dataProcessingList\n",
        "unknownProcessingEntry: retained\n",
    );

    const SPECTRUM_TABLE_FIXTURE: &str = concat!(
        "# tiny.mzML\n",
        "index\tid\tevent\tanalyzer\tmsLevel\trt\tmzLow\tmzHigh\tbasePeakMZ\tbasePeakInt\tTIC\tcharge\tprecursorMZ\tthermo_monoMZ\tfilterStringMZ\tionInjectionTime\n",
        "0\tscan=1\t1\tFTMS\tms1\t0.1\t100\t1000\t500\t50\t100\t\t\t\t\t\n",
        "1\tscan=2\t2\tITMS\tms2\t0.2\t50\t500\t250\t25\t75\t2\t445.3\t445.3\t445.3\t10\n",
    );

    const TIC_FIXTURE: &str = concat!(
        "# tiny.mzML\n",
        "# index\tid\tevent\tanalyzer\tmsLevel\trt\tsumIntensity\n",
        "0\tscan=1\t1\tFTMS\tms1\t0.1\t100\n",
        "1\tscan=2\t2\tITMS\tms2\t0.2\t75\n",
    );

    const BINARY_FIXTURE: &str = concat!(
        "# tiny.mzML\n",
        "#\n",
        "# index: 0\n",
        "# id: scan=1\n",
        "# scanNumber: 1\n",
        "# massAnalyzerType: FTMS\n",
        "# scanEvent: 1\n",
        "# msLevel: 1\n",
        "# retentionTime: 0.1\n",
        "# filterString: synthetic\n",
        "# mzLow: 100\n",
        "# mzHigh: 1000\n",
        "# basePeakMZ: 500\n",
        "# basePeakIntensity: 50\n",
        "# totalIonCurrent: 100\n",
        "# precursorCount: 1\n",
        "# precursor 0: 445.30000000 12.00000000\n",
        "# binary (2):\n",
        "100.12345678 10.00000000\n",
        "200.12345678 20.00000000\n",
    );

    fn run_summary_fixture() -> String {
        let mut headers = vec![
            "Filename".to_owned(),
            "Timestamp".to_owned(),
            "Vendor".to_owned(),
            "Model".to_owned(),
            "Serial#".to_owned(),
            "MS1s".to_owned(),
            "MS2s".to_owned(),
            "Zooms".to_owned(),
            "Charges".to_owned(),
            "+2s".to_owned(),
        ];
        let mut values = [
            "tiny.mzML",
            "2026-01-01",
            "synthetic",
            "model",
            "serial",
            "1",
            "1",
            "0",
            "1",
            "1",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        for level in 1..=2 {
            for statistic in ["Mean", "Min", "Q1", "Q2", "Q3", "Max"] {
                headers.push(format!("MS{level} Pts{statistic}"));
                values.push("2.5".to_owned());
            }
        }
        headers.extend(
            ["MinRT", "RT@25%BPI", "RT@50%BPI", "RT@75%BPI", "MaxRT"]
                .into_iter()
                .map(str::to_owned),
        );
        values.extend(
            ["0.1", "0.2", "0.3", "0.4", "0.5"]
                .into_iter()
                .map(str::to_owned),
        );
        format!("{}\n{}\n", headers.join("\t"), values.join("\t"))
    }

    fn completed_process(stdout: impl Into<Vec<u8>>) -> ProcessOutput {
        let stdout = stdout.into();
        ProcessOutput {
            stdout_total_bytes: u64::try_from(stdout.len()).expect("fixture length fits u64"),
            stdout,
            stderr: Vec::new(),
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(0),
            elapsed: Duration::from_millis(1),
            termination: Termination::Exited,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
        }
    }

    fn malformed_kind(
        operation: PreviewOperation,
        process: &ProcessOutput,
        manifest: &PreviewOutputManifest,
    ) -> PreviewMalformedKind {
        match interpret_preview(&operation, process, manifest).expect_err("fixture must fail") {
            PreviewInterpretError::MalformedOutput { kind, .. } => kind,
            other => panic!("expected malformed output, got {other:?}"),
        }
    }

    #[test]
    fn metadata_preserves_required_section_and_opaque_entry_order() {
        let metadata = parse_metadata(METADATA_FIXTURE).expect("metadata fixture is valid");
        assert_eq!(
            metadata
                .sections()
                .iter()
                .map(MetadataSection::kind)
                .collect::<Vec<_>>(),
            MetadataSectionKind::ALL
        );
        assert_eq!(
            metadata.sections()[0].entries()[0].sensitive_text(),
            "unknownFileEntry: opaque-value"
        );
        assert_eq!(
            metadata.sections()[4].entries()[0].sensitive_text(),
            "unknownProcessingEntry: retained"
        );
        let debug = format!("{metadata:?}");
        assert!(!debug.contains("opaque-value"));
        assert!(!debug.contains("retained"));
        assert!(!debug.contains("MetadataEntry"));
        assert!(debug.contains("section_count: 5"));
    }

    #[test]
    fn metadata_rejects_missing_and_duplicate_required_sections() {
        let missing = METADATA_FIXTURE.replace("softwareList:\n", "");
        assert_eq!(
            parse_metadata(&missing),
            Err(PreviewMalformedKind::MissingRequiredSection)
        );
        let duplicate = format!("{METADATA_FIXTURE}softwareList:\n");
        assert_eq!(
            parse_metadata(&duplicate),
            Err(PreviewMalformedKind::DuplicateRequiredSection)
        );
    }

    #[test]
    fn metadata_preserves_observed_section_order_without_inventing_a_canonical_order_gate() {
        let fixture = concat!(
            "softwareList:\n",
            "fileDescription:\n",
            "dataProcessingList\n",
            "sampleList:\n",
            "instrumentConfigurationList:\n",
        );
        let metadata = parse_metadata(fixture).expect("all required sections are present once");
        assert_eq!(
            metadata
                .sections()
                .iter()
                .map(MetadataSection::kind)
                .collect::<Vec<_>>(),
            [
                MetadataSectionKind::SoftwareList,
                MetadataSectionKind::FileDescription,
                MetadataSectionKind::DataProcessingList,
                MetadataSectionKind::SampleList,
                MetadataSectionKind::InstrumentConfigurationList,
            ]
        );
    }

    #[test]
    fn run_summary_promotes_counts_and_keeps_units_and_chromatograms_unreported() {
        let summary = parse_run_summary(&run_summary_fixture()).expect("summary fixture is valid");
        assert_eq!(summary.total_spectrum_count(), 2);
        assert_eq!(
            summary.counts_by_ms_level(),
            [
                MsLevelCount {
                    bucket: MsLevelBucket::Level(1),
                    spectrum_count: 1,
                },
                MsLevelCount {
                    bucket: MsLevelBucket::Level(2),
                    spectrum_count: 1,
                },
            ]
        );
        assert_eq!(summary.chromatogram_count(), None);
        let range = summary.retention_time_range().expect("range is emitted");
        assert_eq!(range.minimum().value(), 0.1);
        assert_eq!(range.maximum().value(), 0.5);
        assert_eq!(range.minimum().unit(), UnitState::NotEmitted);
    }

    #[test]
    fn run_summary_rejects_bad_header_width_incomplete_stats_and_nonfinite_values() {
        let fixture = run_summary_fixture();
        assert_eq!(
            parse_run_summary(&fixture.replace("Filename", "filename")),
            Err(PreviewMalformedKind::InvalidHeader)
        );
        let mut lines = fixture.lines();
        let headers = lines.next().expect("header");
        let values = lines.next().expect("values");
        assert_eq!(
            parse_run_summary(&format!("{headers}\n{values}\nextra\n")),
            Err(PreviewMalformedKind::InvalidShape)
        );
        let incomplete_stats = fixture.replace("\tMS2 PtsMax", "\tunknown");
        assert_eq!(
            parse_run_summary(&incomplete_stats),
            Err(PreviewMalformedKind::InvalidHeader)
        );
        let nonfinite = fixture.replacen("\t2.5", "\tNaN", 1);
        assert_eq!(
            parse_run_summary(&nonfinite),
            Err(PreviewMalformedKind::NonFiniteNumber)
        );
    }

    #[test]
    fn spectrum_table_parses_all_established_fields_and_optional_values() {
        let table = parse_spectrum_table(SPECTRUM_TABLE_FIXTURE).expect("table fixture is valid");
        assert_eq!(table.rows().len(), 2);
        let first = &table.rows()[0];
        assert_eq!(first.identity().index(), 0);
        assert_eq!(
            first.identity().representations()[0].sensitive_raw(),
            "scan=1"
        );
        assert_eq!(first.identity().scan_number(), None);
        assert_eq!(first.ms_level(), 1);
        assert_eq!(first.retention_time().unit(), UnitState::NotEmitted);
        assert_eq!(first.mz_low(), 100.0);
        assert_eq!(first.charge(), None);
        let second = &table.rows()[1];
        assert_eq!(second.charge(), Some(2.0));
        assert_eq!(second.ion_injection_time(), Some(10.0));
    }

    #[test]
    fn spectrum_table_rejects_malformed_headers_rows_indices_ms_levels_and_numbers() {
        assert_eq!(
            parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replace("basePeakMZ", "basepeakMZ")),
            Err(PreviewMalformedKind::InvalidHeader)
        );
        let short = format!("{SPECTRUM_TABLE_FIXTURE}2\ttoo-short\n");
        assert_eq!(
            parse_spectrum_table(&short),
            Err(PreviewMalformedKind::InvalidRowWidth)
        );
        assert_eq!(
            parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replacen("1\tscan=2", "0\tscan=2", 1)),
            Err(PreviewMalformedKind::InvalidIndexOrder)
        );
        assert_eq!(
            parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replacen("\tms1\t", "\tms0\t", 1)),
            Err(PreviewMalformedKind::InvalidMsLevel)
        );
        assert_eq!(
            parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replacen("\t0.1\t", "\tNaN\t", 1)),
            Err(PreviewMalformedKind::NonFiniteNumber)
        );
        assert_eq!(
            parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replacen("0\tscan=1", "+0\tscan=1", 1)),
            Err(PreviewMalformedKind::InvalidIndex)
        );
    }

    #[test]
    fn tic_preserves_source_order_and_exposes_a_stable_rt_ordered_view() {
        let fixture = TIC_FIXTURE.replace("\t0.1\t100", "\t0.3\t100");
        let tic = parse_tic(&fixture, None).expect("TIC fixture is valid");
        assert_eq!(
            tic.intensity_origin(),
            TicIntensityOrigin::RecomputedSummedIntensity
        );
        assert_eq!(tic.source_order(), TicSourceOrder::SpectrumIndex);
        assert_eq!(tic.points()[0].identity().index(), 0);
        assert_eq!(tic.points()[1].identity().index(), 1);
        let ordered = tic.points_by_retention_time();
        assert_eq!(ordered[0].identity().index(), 1);
        assert_eq!(ordered[1].identity().index(), 0);
        assert_eq!(tic.points()[0].identity().index(), 0);
    }

    #[test]
    fn tic_rt_view_preserves_source_order_for_equal_retention_times() {
        let fixture = TIC_FIXTURE.replace("\t0.2\t75", "\t0.1\t75");
        let tic = parse_tic(&fixture, None).expect("TIC fixture is valid");
        let ordered = tic.points_by_retention_time();
        assert_eq!(ordered[0].source_ordinal(), 0);
        assert_eq!(ordered[1].source_ordinal(), 1);
    }

    #[test]
    fn filtered_tic_accepts_index_gaps_but_requires_the_requested_ms_level() {
        let fixture = TIC_FIXTURE
            .replace("0\tscan=1\t1\tFTMS\tms1\t0.1\t100\n", "")
            .replace("1\tscan=2", "7\tscan=2");
        let tic = parse_tic(&fixture, Some(2)).expect("filtered TIC permits index gaps");
        assert_eq!(tic.points()[0].identity().index(), 7);
        assert_eq!(tic.ms_level_filter(), Some(2));
        assert_eq!(
            parse_tic(&fixture, Some(1)),
            Err(PreviewMalformedKind::InvalidField)
        );
    }

    #[test]
    fn tic_rejects_bad_headers_rows_duplicate_indices_and_nonfinite_values() {
        assert_eq!(
            parse_tic(&TIC_FIXTURE.replace("sumIntensity", "intensity"), None),
            Err(PreviewMalformedKind::InvalidHeader)
        );
        assert_eq!(
            parse_tic(&format!("{TIC_FIXTURE}2\ttoo-short\n"), None),
            Err(PreviewMalformedKind::InvalidRowWidth)
        );
        assert_eq!(
            parse_tic(&TIC_FIXTURE.replacen("1\tscan=2", "0\tscan=2", 1), None),
            Err(PreviewMalformedKind::InvalidIndexOrder)
        );
        assert_eq!(
            parse_tic(&TIC_FIXTURE.replacen("\t100\n", "\tinf\n", 1), None),
            Err(PreviewMalformedKind::NonFiniteNumber)
        );
        let negative = TIC_FIXTURE.replacen("\t100\n", "\t-1\n", 1);
        assert_eq!(
            parse_tic(&negative, None)
                .expect("finite negative is not scientifically rejected")
                .points()[0]
                .summed_intensity(),
            -1.0
        );
    }

    #[test]
    fn selected_spectrum_parses_aligned_arrays_and_emitted_facts() {
        let spectrum =
            parse_selected_spectrum(BINARY_FIXTURE, 0, 8).expect("binary fixture is valid");
        assert_eq!(spectrum.identity().index(), 0);
        assert_eq!(spectrum.identity().scan_number(), Some(1));
        assert_eq!(spectrum.ms_level(), 1);
        assert_eq!(spectrum.mz_values(), [100.12345678, 200.12345678]);
        assert_eq!(spectrum.intensity_values(), [10.0, 20.0]);
        assert_eq!(spectrum.precursors().len(), 1);
        assert_eq!(spectrum.precision().requested_fraction_digits(), 8);
        assert_eq!(spectrum.precision().observed_maximum_fraction_digits(), 8);
        assert_eq!(spectrum.value_units(), UnitState::NotEmitted);
        assert_eq!(
            spectrum.representation(),
            SpectrumRepresentationState::NotEmitted
        );
    }

    #[test]
    fn selected_spectrum_rejects_header_count_array_number_and_precision_failures() {
        assert_eq!(
            parse_selected_spectrum(&BINARY_FIXTURE.replace("# msLevel", "# mslevel"), 0, 8),
            Err(PreviewMalformedKind::InvalidHeader)
        );
        assert_eq!(
            parse_selected_spectrum(
                &BINARY_FIXTURE.replace("# binary (2):", "# binary (3):"),
                0,
                8
            ),
            Err(PreviewMalformedKind::CountMismatch)
        );
        assert_eq!(
            parse_selected_spectrum(
                &BINARY_FIXTURE.replace("100.12345678 10.00000000", "100.12345678"),
                0,
                8
            ),
            Err(PreviewMalformedKind::InvalidRowWidth)
        );
        assert_eq!(
            parse_selected_spectrum(&BINARY_FIXTURE.replace("20.00000000", "NaN"), 0, 8),
            Err(PreviewMalformedKind::NonFiniteNumber)
        );
        assert_eq!(
            parse_selected_spectrum(BINARY_FIXTURE, 0, 7),
            Err(PreviewMalformedKind::PrecisionExceeded)
        );
        assert_eq!(
            parse_selected_spectrum(
                &BINARY_FIXTURE.replace(
                    "# binary (2):\n100.12345678 10.00000000\n200.12345678 20.00000000",
                    "# binary (0):"
                ),
                0,
                8
            ),
            Err(PreviewMalformedKind::Empty)
        );
    }

    #[test]
    fn selected_spectrum_rejects_precursor_index_and_identity_conflicts() {
        assert_eq!(
            parse_selected_spectrum(
                &BINARY_FIXTURE.replace("# precursorCount: 1", "# precursorCount: 2"),
                0,
                8
            ),
            Err(PreviewMalformedKind::CountMismatch)
        );
        assert_eq!(
            parse_selected_spectrum(
                &BINARY_FIXTURE.replace("# precursor 0:", "# precursor 1:"),
                0,
                8
            ),
            Err(PreviewMalformedKind::InvalidIndexOrder)
        );
        assert_eq!(
            parse_selected_spectrum(BINARY_FIXTURE, 1, 8),
            Err(PreviewMalformedKind::IdentityConflict)
        );
        assert_eq!(
            parse_selected_spectrum(
                &BINARY_FIXTURE.replace("# id: scan=1", "# id: scan=2"),
                0,
                8
            ),
            Err(PreviewMalformedKind::IdentityConflict)
        );
    }

    #[test]
    fn canonical_identity_reconciles_numeric_and_native_forms_and_preserves_both() {
        let table = parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replacen("scan=1", "19", 1))
            .expect("table fixture is valid");
        let binary = BINARY_FIXTURE
            .replace("# id: scan=1", "# id: scan=19")
            .replace("# scanNumber: 1", "# scanNumber: 19");
        let selected = parse_selected_spectrum(&binary, 0, 8).expect("binary fixture is valid");
        let identity = table.rows()[0]
            .identity()
            .reconcile(selected.identity())
            .expect("identities are compatible");
        assert_eq!(identity.index(), 0);
        assert_eq!(identity.scan_number(), Some(19));
        assert_eq!(identity.representations().len(), 2);
        assert_eq!(identity.representations()[0].sensitive_raw(), "19");
        assert_eq!(identity.representations()[1].sensitive_raw(), "scan=19");
    }

    #[test]
    fn canonical_identity_fails_closed_on_scan_or_index_conflicts() {
        let table = parse_spectrum_table(&SPECTRUM_TABLE_FIXTURE.replacen("scan=1", "19", 1))
            .expect("table fixture is valid");
        let binary = BINARY_FIXTURE
            .replace("# id: scan=1", "# id: scan=20")
            .replace("# scanNumber: 1", "# scanNumber: 20");
        let selected = parse_selected_spectrum(&binary, 0, 8).expect("binary fixture is valid");
        assert_eq!(
            table.rows()[0].identity().reconcile(selected.identity()),
            Err(SpectrumIdentityConflict::ScanNumber)
        );
        assert_eq!(
            table.rows()[0]
                .identity()
                .reconcile(table.rows()[1].identity()),
            Err(SpectrumIdentityConflict::Index)
        );
    }

    #[test]
    fn unknown_native_identifier_is_preserved_as_opaque() {
        let raw = "controllerType=0 controllerNumber=1 scan=1";
        let fixture = BINARY_FIXTURE.replace("# id: scan=1", &format!("# id: {raw}"));
        let selected = parse_selected_spectrum(&fixture, 0, 8).expect("unknown ID is valid");
        assert_eq!(selected.identity().scan_number(), Some(1));
        assert_eq!(
            selected.identity().representations()[0].sensitive_raw(),
            raw
        );
    }

    #[test]
    fn interpreter_returns_typed_values_for_every_valid_operation() {
        let no_stdout = completed_process(Vec::new());
        let cases = [
            (
                PreviewOperation::Metadata,
                PreviewOutputManifest::single_complete_file(METADATA_FIXTURE),
            ),
            (
                PreviewOperation::SpectrumTable,
                PreviewOutputManifest::single_complete_file(SPECTRUM_TABLE_FIXTURE),
            ),
            (
                PreviewOperation::Tic { ms_level: None },
                PreviewOutputManifest::single_complete_file(TIC_FIXTURE),
            ),
            (
                PreviewOperation::SpectrumByIndex {
                    index: 0,
                    precision: 8,
                },
                PreviewOutputManifest::single_complete_file(BINARY_FIXTURE),
            ),
        ];
        for (operation, manifest) in cases {
            assert!(matches!(
                interpret_preview(&operation, &no_stdout, &manifest),
                Ok(PreviewOutcome::Value(_))
            ));
        }

        let summary = run_summary_fixture();
        let summary_process = completed_process(summary.into_bytes());
        let outcome = interpret_preview(
            &PreviewOperation::RunSummary,
            &summary_process,
            &PreviewOutputManifest::empty(),
        )
        .expect("valid summary is interpreted");
        let PreviewOutcome::Value(value) = outcome else {
            panic!("run summary must produce a value");
        };
        let PreviewValue::RunSummary(summary) = *value else {
            panic!("run summary must produce typed counts");
        };
        assert_eq!(summary.total_spectrum_count(), 2);
        assert_eq!(summary.counts_by_ms_level().len(), 2);
    }

    #[test]
    fn interpreter_only_allows_no_output_for_selected_spectrum() {
        let process = completed_process(Vec::new());
        let selected = PreviewOperation::SpectrumByIndex {
            index: 42,
            precision: 8,
        };
        assert_eq!(
            interpret_preview(&selected, &process, &PreviewOutputManifest::empty()),
            Ok(PreviewOutcome::NoResult(
                PreviewNoResult::SpectrumUnavailable {
                    requested_index: 42
                }
            ))
        );
        let present_empty_arrays = BINARY_FIXTURE.replace(
            "# binary (2):\n100.12345678 10.00000000\n200.12345678 20.00000000",
            "# binary (0):",
        );
        assert_eq!(
            interpret_preview(
                &selected,
                &process,
                &PreviewOutputManifest::single_complete_file(present_empty_arrays)
            ),
            Err(PreviewInterpretError::MalformedOutput {
                operation: selected.clone(),
                kind: PreviewMalformedKind::Empty
            })
        );

        for operation in [
            PreviewOperation::Metadata,
            PreviewOperation::SpectrumTable,
            PreviewOperation::Tic { ms_level: None },
        ] {
            assert_eq!(
                interpret_preview(&operation, &process, &PreviewOutputManifest::empty()),
                Err(PreviewInterpretError::MissingRequiredOutput { operation })
            );
        }
        assert_eq!(
            interpret_preview(
                &PreviewOperation::RunSummary,
                &process,
                &PreviewOutputManifest::empty()
            ),
            Err(PreviewInterpretError::MissingRequiredOutput {
                operation: PreviewOperation::RunSummary
            })
        );
    }

    #[test]
    fn interpreter_values_reconcile_table_and_binary_identity_and_fail_on_conflict() {
        let process = completed_process(Vec::new());
        let table_fixture = SPECTRUM_TABLE_FIXTURE.replacen("scan=1", "19", 1);
        let table_outcome = interpret_preview(
            &PreviewOperation::SpectrumTable,
            &process,
            &PreviewOutputManifest::single_complete_file(table_fixture),
        )
        .expect("valid table is interpreted");
        let PreviewOutcome::Value(table_value) = table_outcome else {
            panic!("table must produce a value");
        };
        let PreviewValue::SpectrumTable(table) = *table_value else {
            panic!("table must produce typed rows");
        };

        let selected_operation = PreviewOperation::SpectrumByIndex {
            index: 0,
            precision: 8,
        };
        let compatible = BINARY_FIXTURE
            .replace("# id: scan=1", "# id: scan=19")
            .replace("# scanNumber: 1", "# scanNumber: 19");
        let selected_outcome = interpret_preview(
            &selected_operation,
            &process,
            &PreviewOutputManifest::single_complete_file(compatible),
        )
        .expect("valid selected spectrum is interpreted");
        let PreviewOutcome::Value(selected_value) = selected_outcome else {
            panic!("selected spectrum must produce a value");
        };
        let PreviewValue::SelectedSpectrum(selected) = *selected_value else {
            panic!("selected spectrum must produce typed arrays");
        };
        assert_eq!(
            table.rows()[0]
                .identity()
                .reconcile(selected.identity())
                .expect("compatible identities reconcile")
                .scan_number(),
            Some(19)
        );

        let conflicting = BINARY_FIXTURE
            .replace("# id: scan=1", "# id: scan=20")
            .replace("# scanNumber: 1", "# scanNumber: 20");
        let conflicting_outcome = interpret_preview(
            &selected_operation,
            &process,
            &PreviewOutputManifest::single_complete_file(conflicting),
        )
        .expect("the selected output is internally valid");
        let PreviewOutcome::Value(conflicting_value) = conflicting_outcome else {
            panic!("selected spectrum must produce a value");
        };
        let PreviewValue::SelectedSpectrum(conflicting_selected) = *conflicting_value else {
            panic!("selected spectrum must produce typed arrays");
        };
        assert_eq!(
            table.rows()[0]
                .identity()
                .reconcile(conflicting_selected.identity()),
            Err(SpectrumIdentityConflict::ScanNumber)
        );
    }

    #[test]
    fn interpreter_tic_value_retains_source_order_origin_and_rt_projection() {
        let process = completed_process(Vec::new());
        let fixture = TIC_FIXTURE.replace("\t0.1\t100", "\t0.3\t100");
        let outcome = interpret_preview(
            &PreviewOperation::Tic { ms_level: None },
            &process,
            &PreviewOutputManifest::single_complete_file(fixture),
        )
        .expect("valid TIC is interpreted");
        let PreviewOutcome::Value(value) = outcome else {
            panic!("TIC must produce a value");
        };
        let PreviewValue::Tic(tic) = *value else {
            panic!("TIC must produce typed points");
        };
        assert_eq!(
            tic.intensity_origin(),
            TicIntensityOrigin::RecomputedSummedIntensity
        );
        assert_eq!(tic.source_order(), TicSourceOrder::SpectrumIndex);
        assert_eq!(tic.points()[0].identity().index(), 0);
        assert_eq!(tic.points()[1].identity().index(), 1);
        let rt_ordered = tic.points_by_retention_time();
        assert_eq!(rt_ordered[0].identity().index(), 1);
        assert_eq!(rt_ordered[1].identity().index(), 0);
    }

    #[test]
    fn interpreter_classifies_mismatched_selected_arrays_as_malformed() {
        let process = completed_process(Vec::new());
        let operation = PreviewOperation::SpectrumByIndex {
            index: 0,
            precision: 8,
        };
        let malformed = BINARY_FIXTURE.replace("100.12345678 10.00000000", "100.12345678");
        assert_eq!(
            interpret_preview(
                &operation,
                &process,
                &PreviewOutputManifest::single_complete_file(malformed)
            ),
            Err(PreviewInterpretError::MalformedOutput {
                operation,
                kind: PreviewMalformedKind::InvalidRowWidth
            })
        );
    }

    #[test]
    fn interpreter_rejects_operations_outside_the_validated_command_contract() {
        let process = completed_process(Vec::new());
        let zero_filter = PreviewOperation::Tic { ms_level: Some(0) };
        assert_eq!(
            interpret_preview(
                &zero_filter,
                &process,
                &PreviewOutputManifest::single_complete_file(TIC_FIXTURE)
            ),
            Err(PreviewInterpretError::InvalidOperation {
                operation: zero_filter
            })
        );
        let mut failed_process = process.clone();
        failed_process.exit_code = Some(9);
        assert_eq!(
            interpret_preview(
                &PreviewOperation::Tic { ms_level: Some(0) },
                &failed_process,
                &PreviewOutputManifest::empty()
            ),
            Err(PreviewInterpretError::BackendNonZeroExit { exit_code: 9 })
        );

        let excessive_precision = PreviewOperation::SpectrumByIndex {
            index: 0,
            precision: 16,
        };
        assert_eq!(
            interpret_preview(
                &excessive_precision,
                &process,
                &PreviewOutputManifest::single_complete_file(BINARY_FIXTURE)
            ),
            Err(PreviewInterpretError::InvalidOperation {
                operation: excessive_precision
            })
        );
    }

    #[test]
    fn unsupported_like_stderr_does_not_turn_missing_metadata_into_success_or_unsupported() {
        let mut process = completed_process(Vec::new());
        process.stderr = b"locale-specific backend prose".to_vec();
        process.stderr_total_bytes = process.stderr.len() as u64;
        assert_eq!(
            interpret_preview(
                &PreviewOperation::Metadata,
                &process,
                &PreviewOutputManifest::empty()
            ),
            Err(PreviewInterpretError::MissingRequiredOutput {
                operation: PreviewOperation::Metadata
            })
        );
    }

    #[test]
    fn interpreter_rejects_empty_malformed_extra_and_nonregular_file_output() {
        let process = completed_process(Vec::new());
        assert_eq!(
            malformed_kind(
                PreviewOperation::Metadata,
                &process,
                &PreviewOutputManifest::single_complete_file(Vec::new())
            ),
            PreviewMalformedKind::Empty
        );
        assert_eq!(
            malformed_kind(
                PreviewOperation::Metadata,
                &process,
                &PreviewOutputManifest::single_complete_file("fileDescription:\n")
            ),
            PreviewMalformedKind::MissingRequiredSection
        );
        let operation = PreviewOperation::Metadata;
        assert_eq!(
            interpret_preview(
                &operation,
                &process,
                &PreviewOutputManifest::new(vec![
                    PreviewOutputEntry::complete_file(METADATA_FIXTURE),
                    PreviewOutputEntry::complete_file(b"extra"),
                ])
            ),
            Err(PreviewInterpretError::UnexpectedOutputCount {
                operation: operation.clone(),
                expected: 1,
                actual: 2
            })
        );
        assert_eq!(
            interpret_preview(
                &operation,
                &process,
                &PreviewOutputManifest::new(vec![PreviewOutputEntry::Directory])
            ),
            Err(PreviewInterpretError::UnexpectedOutputType { operation })
        );
    }

    #[test]
    fn every_file_backed_operation_rejects_empty_and_extra_output() {
        let process = completed_process(Vec::new());
        for operation in [
            PreviewOperation::Metadata,
            PreviewOperation::SpectrumTable,
            PreviewOperation::Tic { ms_level: None },
            PreviewOperation::SpectrumByIndex {
                index: 0,
                precision: 8,
            },
        ] {
            assert_eq!(
                interpret_preview(
                    &operation,
                    &process,
                    &PreviewOutputManifest::single_complete_file(Vec::new())
                ),
                Err(PreviewInterpretError::MalformedOutput {
                    operation: operation.clone(),
                    kind: PreviewMalformedKind::Empty
                })
            );
            assert_eq!(
                interpret_preview(
                    &operation,
                    &process,
                    &PreviewOutputManifest::new(vec![
                        PreviewOutputEntry::complete_file(b"first"),
                        PreviewOutputEntry::complete_file(b"second"),
                    ])
                ),
                Err(PreviewInterpretError::UnexpectedOutputCount {
                    operation: operation.clone(),
                    expected: 1,
                    actual: 2
                })
            );
        }
    }

    #[test]
    fn run_summary_rejects_any_generated_file_as_extra_output() {
        let fixture = run_summary_fixture();
        let process = completed_process(fixture.into_bytes());
        assert_eq!(
            interpret_preview(
                &PreviewOperation::RunSummary,
                &process,
                &PreviewOutputManifest::single_complete_file(b"unexpected")
            ),
            Err(PreviewInterpretError::UnexpectedOutputCount {
                operation: PreviewOperation::RunSummary,
                expected: 0,
                actual: 1
            })
        );
    }

    #[test]
    fn interpreter_rejects_incomplete_or_non_utf8_parser_input() {
        let process = completed_process(Vec::new());
        let operation = PreviewOperation::Metadata;
        assert_eq!(
            interpret_preview(
                &operation,
                &process,
                &PreviewOutputManifest::new(vec![PreviewOutputEntry::incomplete_file(32, 129)])
            ),
            Err(PreviewInterpretError::IncompleteParserInput {
                operation: operation.clone(),
                input_source: PreviewInputSource::OutputFile,
                captured_bytes: 32,
                total_bytes: 129
            })
        );
        assert_eq!(
            interpret_preview(
                &operation,
                &process,
                &PreviewOutputManifest::single_complete_file(vec![0xff])
            ),
            Err(PreviewInterpretError::InvalidUtf8 {
                operation,
                input_source: PreviewInputSource::OutputFile
            })
        );
    }

    #[test]
    fn truncated_or_length_mismatched_stdout_cannot_feed_the_run_summary_parser() {
        let fixture = run_summary_fixture().into_bytes();
        let mut process = completed_process(fixture);
        process.stdout_truncated = true;
        process.stdout_total_bytes += 1;
        let captured_bytes = process.stdout.len() as u64;
        assert_eq!(
            interpret_preview(
                &PreviewOperation::RunSummary,
                &process,
                &PreviewOutputManifest::empty()
            ),
            Err(PreviewInterpretError::IncompleteParserInput {
                operation: PreviewOperation::RunSummary,
                input_source: PreviewInputSource::Stdout,
                captured_bytes,
                total_bytes: captured_bytes + 1
            })
        );

        process.stdout_truncated = false;
        assert!(matches!(
            interpret_preview(
                &PreviewOperation::RunSummary,
                &process,
                &PreviewOutputManifest::empty()
            ),
            Err(PreviewInterpretError::IncompleteParserInput { .. })
        ));
    }

    #[test]
    fn cancellation_and_nonzero_exit_precede_semantic_output_interpretation() {
        let operation = PreviewOperation::Metadata;
        let malformed = PreviewOutputManifest::single_complete_file(b"not metadata");
        let mut process = completed_process(Vec::new());
        process.exit_code = Some(7);
        assert_eq!(
            interpret_preview(&operation, &process, &malformed),
            Err(PreviewInterpretError::BackendNonZeroExit { exit_code: 7 })
        );
        process.termination = Termination::Cancelled;
        assert_eq!(
            interpret_preview(&operation, &process, &malformed),
            Err(PreviewInterpretError::Cancelled)
        );
        process.termination = Termination::Exited;
        process.exit_code = None;
        assert_eq!(
            interpret_preview(&operation, &process, &malformed),
            Err(PreviewInterpretError::UnclassifiedBackendBehavior)
        );
    }

    #[test]
    fn reportable_preview_debug_output_uses_bounded_redacted_projections() {
        let manifest = PreviewOutputManifest::single_complete_file(b"sensitive payload");
        let manifest_debug = format!("{manifest:?}");
        assert!(!manifest_debug.contains("sensitive payload"));
        assert!(manifest_debug.contains("<opaque-sensitive>"));

        let process = completed_process(Vec::new());
        let metadata_outcome = interpret_preview(
            &PreviewOperation::Metadata,
            &process,
            &PreviewOutputManifest::single_complete_file(METADATA_FIXTURE),
        )
        .expect("metadata fixture is valid");
        let metadata_debug = format!("{metadata_outcome:?}");
        assert!(!metadata_debug.contains("MetadataEntry"));
        assert!(!metadata_debug.contains("opaque-value"));
        assert!(metadata_debug.contains("leading_entry_count: 0"));
        assert!(metadata_debug.contains("section_count: 5"));

        let metadata = parse_metadata(METADATA_FIXTURE).expect("metadata fixture is valid");
        let section_debug = format!("{:?}", metadata.sections()[0]);
        assert!(!section_debug.contains("MetadataEntry"));
        assert!(!section_debug.contains("opaque-value"));
        assert!(section_debug.contains("entry_count: 1"));

        let summary_process = completed_process(run_summary_fixture().into_bytes());
        let summary_outcome = interpret_preview(
            &PreviewOperation::RunSummary,
            &summary_process,
            &PreviewOutputManifest::empty(),
        )
        .expect("run-summary fixture is valid");
        let summary_debug = format!("{summary_outcome:?}");
        assert!(!summary_debug.contains("RetentionTime"));
        assert!(!summary_debug.contains("0.1"));
        assert!(summary_debug.contains("total_spectrum_count: 2"));
        assert!(summary_debug.contains("ms_level_bucket_count:"));

        let identity = SpectrumIdentity::from_raw(
            0,
            SpectrumIdentifierKind::Native,
            "scan=19".to_owned(),
            Some(19),
        )
        .expect("identity is valid");
        let debug = format!("{identity:?}");
        assert!(!debug.contains("scan=19"));

        let outcome = interpret_preview(
            &PreviewOperation::SpectrumByIndex {
                index: 0,
                precision: 8,
            },
            &process,
            &PreviewOutputManifest::single_complete_file(BINARY_FIXTURE),
        )
        .expect("selected-spectrum fixture is valid");
        let selected_debug = format!("{outcome:?}");
        for sensitive_value in [
            "scan=1",
            "synthetic",
            "445.3",
            "100.12345678",
            "200.12345678",
        ] {
            assert!(!selected_debug.contains(sensitive_value));
        }
        assert!(selected_debug.contains("point_count: 2"));
        assert!(selected_debug.contains("precursor_count: 1"));

        let table_outcome = interpret_preview(
            &PreviewOperation::SpectrumTable,
            &process,
            &PreviewOutputManifest::single_complete_file(SPECTRUM_TABLE_FIXTURE),
        )
        .expect("spectrum-table fixture is valid");
        let table_debug = format!("{table_outcome:?}");
        for sensitive_value in ["FTMS", "ITMS", "445.3", "500.0"] {
            assert!(!table_debug.contains(sensitive_value));
        }
        assert!(table_debug.contains("row_count: 2"));

        let table =
            parse_spectrum_table(SPECTRUM_TABLE_FIXTURE).expect("spectrum-table fixture is valid");
        let row_debug = format!("{:?}", table.rows()[1]);
        for sensitive_value in ["ITMS", "445.3", "250.0", "75.0"] {
            assert!(!row_debug.contains(sensitive_value));
        }
        assert!(row_debug.contains("precursor_mz_emitted: true"));

        let tic_outcome = interpret_preview(
            &PreviewOperation::Tic { ms_level: None },
            &process,
            &PreviewOutputManifest::single_complete_file(TIC_FIXTURE),
        )
        .expect("TIC fixture is valid");
        let tic_debug = format!("{tic_outcome:?}");
        for sensitive_value in ["0.1", "0.2", "100.0", "75.0"] {
            assert!(!tic_debug.contains(sensitive_value));
        }
        assert!(tic_debug.contains("point_count: 2"));
        assert!(tic_debug.contains("RecomputedSummedIntensity"));
        assert!(tic_debug.contains("SpectrumIndex"));

        let tic = parse_tic(TIC_FIXTURE, None).expect("TIC fixture is valid");
        let point_debug = format!("{:?}", tic.points()[0]);
        for sensitive_value in ["0.1", "100.0"] {
            assert!(!point_debug.contains(sensitive_value));
        }
        assert!(point_debug.contains("source_ordinal: 0"));

        let selected = parse_selected_spectrum(BINARY_FIXTURE, 0, 8)
            .expect("selected-spectrum fixture is valid");
        let precursor_debug = format!("{:?}", selected.precursors()[0]);
        for sensitive_value in ["445.3", "12.0"] {
            assert!(!precursor_debug.contains(sensitive_value));
        }
        assert!(precursor_debug.contains("index: 0"));
    }
}
