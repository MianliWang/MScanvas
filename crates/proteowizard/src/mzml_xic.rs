//! The extracted-ion chromatogram pass over one mzML document (ADR 0071, X1).
//!
//! A sibling of the viewing reader in `mzml_reader.rs`. It reuses that module's
//! tokenizer, `DOCTYPE` and entity refusal, namespace resolution, version rule,
//! caps, base64, inflate and exact widening. It applies ADR 0046's per-scan
//! state policy instead of the reader's viewing refusals: a file the viewer
//! refuses may be evaluated here, and the other way round.
//!
//! One streaming pass in source order. It decodes one spectrum's arrays at a
//! time, m/z before intensity whatever the document's order, and keeps only the
//! per-scan result, one row per spectrum. It computes the one quantity ADR 0071
//! decision 2 admits: the per-scan sum of stored intensities whose m/z lies in
//! a closed window. Nothing centroids, smooths, fits or interpolates.
//!
//! A refusal of the whole query is decided on the whole document, so its reason
//! does not depend on the order of the scans. Once one is certain, no further
//! array is decoded, and the rest of the document is still read for an earlier
//! reason. Malformed metadata comes first, then the run-wide unit rules, then
//! decision 4's rules over the in-scope scans.
//!
//! This is a library only. Nothing calls it, and VIEW-007 stays unavailable
//! until the X3 decision admits the candidate.

use std::collections::{BTreeMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;

use quick_xml::events::{BytesRef, BytesStart};
use quick_xml::name::NamespaceResolver;
use thiserror::Error;

use crate::fs_guard;
use crate::mzml::{
    CapturedAttributes, MzmlLimitKind, MzmlMalformedKind, MzmlScanError, MzmlScanLimits,
    attribute_value, capture_attributes, parse_u64_decimal,
};
use crate::mzml_reader::{
    ArrayParse, ArrayProblem, ArrayRole, El, EventPass, Facts, MAX_PARAM_GROUPS,
    MAX_TERMS_PER_PARAM_GROUP, MzmlDeclared, MzmlOpenError, MzmlPolarity, MzmlRepresentation,
    ReaderLimitKind, SPECTRUM_ARRAY, SPECTRUM_SCAN, check_element, check_version, drive, element,
    fact, parse_finite, prepare_array, stated_term, stored_bytes, term, widen_keeping_non_finite,
};
use crate::preview::SpectrumIdentity;

/// What every `Measured` observation is, on the wire. On profile data it is a
/// sum of points and never an integrated peak (ADR 0046 §1); the displayed name
/// is derived from the declared representation (ADR 0071 decision 5).
pub const XIC_QUANTITY: &str = "point_sum";

const MS_LEVEL: &str = "MS:1000511";
const CENTROID: &str = "MS:1000127";
const PROFILE: &str = "MS:1000128";
const SCAN_START_TIME: &str = "MS:1000016";
const MZ_ARRAY: &str = "MS:1000514";
const INTENSITY_ARRAY: &str = "MS:1000515";
const TIME_ARRAY: &str = "MS:1000595";
const FAIMS_COMPENSATION_VOLTAGE: &str = "MS:1001581";
const SCAN_WINDOW_LOWER: &str = "MS:1000501";
const SCAN_WINDOW_UPPER: &str = "MS:1000500";

const SPECTRUM_SCAN_WINDOW: &[El] = &[
    El::Spectrum,
    El::ScanList,
    El::Scan,
    El::ScanWindowList,
    El::ScanWindow,
];

/// The window as it was typed. It travels with the result and is no part of the
/// query's identity, which is its MS level and resolved bounds (ADR 0071,
/// decision 4, departure 1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum XicWindowInput {
    Bounds,
    /// A centre with an absolute half-width, in the m/z array's own unit.
    HalfWidth {
        centre: f64,
        half_width: f64,
    },
    Ppm {
        centre: f64,
        ppm: f64,
    },
}

/// One MS level and one closed `[low, high]`, both ends inclusive, compared
/// against stored values without rounding. There is no default level and no
/// "all levels".
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct XicQuery {
    ms_level: u32,
    low: f64,
    high: f64,
    input: XicWindowInput,
}

impl XicQuery {
    /// `low == high` is a legal zero-width window. A level of zero, a non-finite
    /// bound and `low > high` are refused, never an empty result.
    pub fn from_bounds(ms_level: u32, low: f64, high: f64) -> Result<Self, XicRefusal> {
        Self::resolved(ms_level, low, high, XicWindowInput::Bounds)
    }

    /// `[centre - half_width, centre + half_width]`. A negative half-width
    /// reverses the window and is refused with it.
    pub fn from_half_width(
        ms_level: u32,
        centre: f64,
        half_width: f64,
    ) -> Result<Self, XicRefusal> {
        Self::resolved(
            ms_level,
            centre - half_width,
            centre + half_width,
            XicWindowInput::HalfWidth { centre, half_width },
        )
    }

    /// `half = centre * ppm / 1e6`, then `low = centre - half` and
    /// `high = centre + half`, in binary64 and in that order.
    pub fn from_ppm(ms_level: u32, centre: f64, ppm: f64) -> Result<Self, XicRefusal> {
        let half = centre * ppm / 1e6;
        Self::resolved(
            ms_level,
            centre - half,
            centre + half,
            XicWindowInput::Ppm { centre, ppm },
        )
    }

    fn resolved(
        ms_level: u32,
        low: f64,
        high: f64,
        input: XicWindowInput,
    ) -> Result<Self, XicRefusal> {
        if ms_level == 0 || !low.is_finite() || !high.is_finite() || low > high {
            return Err(XicRefusal::InvalidQuery);
        }
        Ok(Self {
            ms_level,
            low,
            high,
            input,
        })
    }

    #[must_use]
    pub const fn ms_level(&self) -> u32 {
        self.ms_level
    }

    #[must_use]
    pub const fn low(&self) -> f64 {
        self.low
    }

    #[must_use]
    pub const fn high(&self) -> f64 {
        self.high
    }

    #[must_use]
    pub const fn input(&self) -> XicWindowInput {
        self.input
    }
}

/// The three axes the run-wide unit rules cover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XicAxis {
    Mz,
    Intensity,
    RetentionTime,
}

impl XicAxis {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Mz => "mz",
            Self::Intensity => "intensity",
            Self::RetentionTime => "retention_time",
        }
    }
}

/// A value this pass requires. Its own set, not the viewing table's: a base
/// peak, a TIC, an MS level and a scan start time are not among them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XicRequiredValue {
    Index,
    NativeId,
    DefaultArrayLength,
    SpectrumListCount,
    ScanListCount,
    ArrayListCount,
    /// An MS level term with no `value`.
    MsLevelValue,
    /// A scan start time term with no `value`.
    ScanStartTimeValue,
}

impl XicRequiredValue {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Index => "index",
            Self::NativeId => "native_id",
            Self::DefaultArrayLength => "default_array_length",
            Self::SpectrumListCount => "spectrum_list_count",
            Self::ScanListCount => "scan_list_count",
            Self::ArrayListCount => "array_list_count",
            Self::MsLevelValue => "ms_level_value",
            Self::ScanStartTimeValue => "scan_start_time_value",
        }
    }
}

/// Why the document's metadata cannot be evaluated at all.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum XicMetadataProblem {
    #[error("a value the pass requires is missing: {}", .0.stable_id())]
    Missing(XicRequiredValue),
    #[error("an index wrapper does not hold exactly one mzML element")]
    NotOneMzml,
    #[error("the run does not hold exactly one spectrum list")]
    NotOneSpectrumList,
    #[error("a spectrum holds more than one scan list")]
    MoreThanOneScanList,
    #[error("a spectrum holds more than one binary data array list")]
    MoreThanOneArrayList,
    #[error("a list's count disagrees with its members: {}", .0.stable_id())]
    CountDisagrees(XicRequiredValue),
    #[error("two spectra share an index or a native ID")]
    DuplicateIdentity,
    #[error("one term is stated twice with different attributes")]
    ConflictingTerm,
    #[error("a spectrum declares an MS level of zero")]
    MsLevelNotPositive,
    #[error("a spectrum has two arrays in one role")]
    DuplicateArrayRole,
}

impl XicMetadataProblem {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Missing(_) => "missing_required_value",
            Self::NotOneMzml => "not_one_mzml",
            Self::NotOneSpectrumList => "not_one_spectrum_list",
            Self::MoreThanOneScanList => "more_than_one_scan_list",
            Self::MoreThanOneArrayList => "more_than_one_array_list",
            Self::CountDisagrees(_) => "count_disagrees",
            Self::DuplicateIdentity => "duplicate_identity",
            Self::ConflictingTerm => "conflicting_term",
            Self::MsLevelNotPositive => "ms_level_not_positive",
            Self::DuplicateArrayRole => "duplicate_array_role",
        }
    }
}

/// Why the whole query was refused. No variant contains a path or document
/// text, and no refusal carries a partial result.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum XicRefusal {
    #[error("the query's operands are not a usable window at one MS level")]
    InvalidQuery,
    #[error("the document could not be read: {0}")]
    Document(#[from] MzmlOpenError),
    #[error("the document's metadata is malformed: {0}")]
    MalformedMetadata(XicMetadataProblem),
    #[error("a {} unit is declared incompletely", .0.stable_id())]
    IncompleteUnit(XicAxis),
    #[error("the run's scans disagree about the {} unit", .0.stable_id())]
    MixedUnit(XicAxis),
    /// ADR 0071 decision 4, departure 2: in-scope scans only.
    #[error("the in-scope scans do not state one polarity")]
    MixedPolarity,
    /// ADR 0071 decision 4, departure 3: in-scope scans only.
    #[error("the in-scope scans do not state one FAIMS compensation voltage")]
    MixedFaimsCompensationVoltage,
    /// ADR 0071 decision 4, departure 4: in-scope scans only.
    #[error("the in-scope scans do not state one representation")]
    MixedRepresentation,
    #[error("the pass was cancelled")]
    Cancelled,
    /// **Provisional, and not an owner decision (2026-11-03).** A 64-bit integer
    /// that `f64` cannot hold exactly, in an array the pass decoded. ADR 0071
    /// open question 2 is unanswered: this refusal maps to `Unreadable`, or the
    /// sum takes 64-bit integers exactly. This variant takes neither side. It
    /// maps to no ADR 0046 state, and it goes when the question is answered.
    #[error("the {} array holds an integer above 2^53, which waits on a decision", .0.stable_id())]
    IntegerNotExact(ArrayRole),
}

impl XicRefusal {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::InvalidQuery => "invalid_query",
            Self::Document(error) => error.stable_id(),
            Self::MalformedMetadata(problem) => problem.stable_id(),
            Self::IncompleteUnit(_) => "incomplete_unit",
            Self::MixedUnit(_) => "mixed_unit",
            Self::MixedPolarity => "mixed_polarity",
            Self::MixedFaimsCompensationVoltage => "mixed_faims_compensation_voltage",
            Self::MixedRepresentation => "mixed_representation",
            Self::Cancelled => "cancelled",
            Self::IntegerNotExact(_) => "integer_not_exact",
        }
    }
}

impl From<MzmlScanError> for XicRefusal {
    fn from(error: MzmlScanError) -> Self {
        Self::Document(error.into())
    }
}

impl From<XicMetadataProblem> for XicRefusal {
    fn from(problem: XicMetadataProblem) -> Self {
        Self::MalformedMetadata(problem)
    }
}

/// Why both arrays could be present and one still not be decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XicUnreadableReason {
    /// The reader's typed refusal of this array, such as numpress or corrupt
    /// zlib, carried as it stands.
    Array(ArrayProblem),
    /// The array has no `binary` element.
    PayloadAbsent,
    /// A term follows the payload, whose bound depends on the terms.
    TermAfterPayload,
    /// The stored bytes are not a whole number of values.
    NotWholeValues,
}

impl XicUnreadableReason {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Array(problem) => problem.stable_id(),
            Self::PayloadAbsent => "payload_absent",
            Self::TermAfterPayload => "term_after_payload",
            Self::NotWholeValues => "not_whole_values",
        }
    }
}

/// ADR 0046's eight per-scan states. The first that applies wins, in this
/// order: `Missing`, the MS-level operand on declared metadata without decoding
/// (`MsLevelUndeclared` or `ExcludedByMsLevel`), `NoUsableArrays`, `Unreadable`,
/// `NonFiniteIntensity`, `SumNotRepresentable`, `Measured`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum XicScanState {
    /// The scan was read and the window evaluated. A zero sum and zero points
    /// are measurements. The sum is never non-finite.
    Measured {
        sum: f64,
        points_in_window: u64,
    },
    ExcludedByMsLevel,
    MsLevelUndeclared,
    /// An array is absent, the lengths disagree, or the m/z array holds a NaN.
    NoUsableArrays,
    Unreadable {
        role: ArrayRole,
        reason: XicUnreadableReason,
    },
    /// "The run's index declares the scan and the reader could not obtain it."
    /// This pass trusts no `indexList` and reads in one pass, so it never meets
    /// that case and never produces this state (ADR 0071 decision 3).
    Missing,
    /// An in-window intensity is not finite. An out-of-window one does not fail
    /// the scan.
    NonFiniteIntensity,
    /// The final exact sum lies outside `[-f64::MAX, f64::MAX]` (XIC-S3).
    SumNotRepresentable,
}

impl XicScanState {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Measured { .. } => "measured",
            Self::ExcludedByMsLevel => "excluded_by_ms_level",
            Self::MsLevelUndeclared => "ms_level_undeclared",
            Self::NoUsableArrays => "no_usable_arrays",
            Self::Unreadable { .. } => "unreadable",
            Self::Missing => "missing",
            Self::NonFiniteIntensity => "non_finite_intensity",
            Self::SumNotRepresentable => "sum_not_representable",
        }
    }
}

/// One spectrum's result, in source order. Retention time is an attribute of
/// the scan, never its key, and is stated in the run's one declared unit.
#[derive(Debug, Clone, PartialEq)]
pub struct XicScan {
    identity: SpectrumIdentity,
    ms_level: Option<u32>,
    representation: MzmlRepresentation,
    retention_time: Option<f64>,
    state: XicScanState,
    decode_attempted: bool,
}

impl XicScan {
    #[must_use]
    pub const fn identity(&self) -> &SpectrumIdentity {
        &self.identity
    }

    #[must_use]
    pub const fn ms_level(&self) -> Option<u32> {
        self.ms_level
    }

    /// As declared and not verified.
    #[must_use]
    pub const fn representation(&self) -> MzmlRepresentation {
        self.representation
    }

    #[must_use]
    pub const fn retention_time(&self) -> Option<f64> {
        self.retention_time
    }

    #[must_use]
    pub const fn state(&self) -> XicScanState {
        self.state
    }

    /// Whether this spectrum's arrays were decoded, or tried.
    #[must_use]
    pub const fn decode_attempted(&self) -> bool {
        self.decode_attempted
    }

    /// Every state but `ExcludedByMsLevel` and `Measured` is a gap, and so is a
    /// measured scan with no retention time. A trace is never joined across one.
    #[must_use]
    pub const fn is_coverage_gap(&self) -> bool {
        match self.state {
            XicScanState::ExcludedByMsLevel => false,
            XicScanState::Measured { .. } => self.retention_time.is_none(),
            _ => true,
        }
    }
}

/// A unit as its declaration states it: presence and value of all three
/// attributes, nothing interpreted. An unrecognized accession is declared and
/// kept. All three absent is not reported, and nothing may be shown as a unit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct XicUnit {
    accession: Option<String>,
    name: Option<String>,
    cv_ref: Option<String>,
}

impl XicUnit {
    fn of(param: Option<&CvParam>) -> Self {
        let attribute = |key| param.and_then(|param| param.get(key)).map(str::to_owned);
        Self {
            accession: attribute("unitAccession"),
            name: attribute("unitName"),
            cv_ref: attribute("unitCvRef"),
        }
    }

    /// Some attribute is present, and the accession is absent or blank.
    fn is_incomplete(&self) -> bool {
        *self != Self::default()
            && self
                .accession
                .as_deref()
                .is_none_or(|accession| accession.trim().is_empty())
    }

    #[must_use]
    pub fn accession(&self) -> Option<&str> {
        self.accession.as_deref()
    }

    #[must_use]
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    #[must_use]
    pub fn cv_ref(&self) -> Option<&str> {
        self.cv_ref.as_deref()
    }
}

/// What the pass returns: every spectrum of the run in source order, with what
/// its rules leave uniform at the top level. It holds no array.
#[derive(Debug, Clone, PartialEq)]
pub struct XicResult {
    query: XicQuery,
    rows: Vec<XicScan>,
    coverage_gaps: u64,
    mz_unit: XicUnit,
    intensity_unit: XicUnit,
    retention_time_unit: XicUnit,
    representation: MzmlRepresentation,
    polarity: MzmlDeclared<MzmlPolarity>,
    faims_compensation_voltage: Option<f64>,
    scans_outside_scan_window: u64,
    scan_windows_differ: bool,
}

impl XicResult {
    /// The typed input and the resolved bounds travel with the result.
    #[must_use]
    pub const fn query(&self) -> &XicQuery {
        &self.query
    }

    /// One per spectrum of the run, in source order, excluded ones included.
    #[must_use]
    pub fn rows(&self) -> &[XicScan] {
        &self.rows
    }

    /// Counted over in-scope scans and undeclared levels only.
    #[must_use]
    pub const fn coverage_gaps(&self) -> u64 {
        self.coverage_gaps
    }

    /// No gaps. Zero in-scope scans is complete (ADR 0071 decision 3), and is
    /// never drawn or presented as a trace.
    #[must_use]
    pub const fn is_complete(&self) -> bool {
        self.coverage_gaps == 0
    }

    #[must_use]
    pub const fn mz_unit(&self) -> &XicUnit {
        &self.mz_unit
    }

    /// The unit every `Measured` sum is stated in, or its declared absence.
    #[must_use]
    pub const fn intensity_unit(&self) -> &XicUnit {
        &self.intensity_unit
    }

    #[must_use]
    pub const fn retention_time_unit(&self) -> &XicUnit {
        &self.retention_time_unit
    }

    /// What the in-scope scans declare. The displayed quantity name is derived
    /// from it. `NotDeclared` also when no scan is in scope.
    #[must_use]
    pub const fn representation(&self) -> MzmlRepresentation {
        self.representation
    }

    /// What the in-scope scans state: one value, or `NotDeclared`.
    #[must_use]
    pub const fn polarity(&self) -> MzmlDeclared<MzmlPolarity> {
        self.polarity
    }

    #[must_use]
    pub const fn faims_compensation_voltage(&self) -> Option<f64> {
        self.faims_compensation_voltage
    }

    /// In-scope scans that declare scan windows, none of which meets the query
    /// window. They read as measured zeros, although the instrument never looked
    /// there. A disclosure, not a state (ADR 0071 decision 4).
    #[must_use]
    pub const fn scans_outside_scan_window(&self) -> u64 {
        self.scans_outside_scan_window
    }

    /// In-scope scans declare different scan windows, or one beside none.
    #[must_use]
    pub const fn scan_windows_differ(&self) -> bool {
        self.scan_windows_differ
    }
}

/// Applied to each evaluated spectrum between decoding and the window sum.
///
/// The product instantiates only [`XicIdentity`], through [`read_xic`]. The
/// discrimination faults the evidence gate requires live in the package-scoped
/// example and never reach the product (ADR 0071 decision 8).
pub trait XicSpectrumTransform {
    fn apply(&mut self, retention_time: &mut Option<f64>, mz: &mut [f64], intensity: &mut [f64]);
}

/// Changes nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct XicIdentity;

impl XicSpectrumTransform for XicIdentity {
    #[inline]
    fn apply(&mut self, _: &mut Option<f64>, _: &mut [f64], _: &mut [f64]) {}
}

/// Evaluates `query` over the mzML file at `path`, after refusing any
/// non-regular, symlinked or reparse-point path. `cancelled` is asked before
/// each spectrum and once after the last. Holds no handle after it returns.
pub fn read_xic(
    path: &Path,
    query: &XicQuery,
    limits: MzmlScanLimits,
    cancelled: impl FnMut() -> bool,
) -> Result<XicResult, XicRefusal> {
    let (file, _length) = fs_guard::open_regular_file(path).map_err(MzmlScanError::from)?;
    read_xic_from(
        BufReader::with_capacity(64 * 1024, file),
        query,
        limits,
        &mut XicIdentity,
        cancelled,
    )
}

/// Evaluates `query` over any buffered reader positioned at the start of the
/// document.
pub fn read_xic_from<R: BufRead, T: XicSpectrumTransform>(
    reader: R,
    query: &XicQuery,
    limits: MzmlScanLimits,
    transform: &mut T,
    cancelled: impl FnMut() -> bool,
) -> Result<XicResult, XicRefusal> {
    let mut pass = XicPass::new(query, limits, transform, cancelled);
    drive(reader, limits, &[], &mut pass)?;
    pass.finish()
}

// ---------------------------------------------------------------------------
// What the pass reads
// ---------------------------------------------------------------------------

/// A `cvParam` this pass reads, with every attribute as stated, sorted by name.
/// Two statements of one term must agree on all of them.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CvParam(Vec<(String, String)>);

impl CvParam {
    fn read(start: &BytesStart<'_>) -> Result<Self, MzmlScanError> {
        let mut attributes = Vec::new();
        for attribute in start.attributes() {
            let attribute = attribute
                .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed))?;
            let key = std::str::from_utf8(attribute.key.as_ref())
                .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::InvalidUtf8))?
                .to_owned();
            attributes.push((key, attribute_value(&attribute)?.into_owned()));
        }
        attributes.sort_unstable();
        Ok(Self(attributes))
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }
}

fn is_read(accession: &str, name: Option<&str>) -> bool {
    matches!(
        accession,
        TIME_ARRAY | FAIMS_COMPENSATION_VOLTAGE | SCAN_WINDOW_LOWER | SCAN_WINDOW_UPPER
    ) || term(accession, name).is_some()
        || fact(accession, "").is_some()
}

/// Keeps the first statement of a term and refuses one that differs from it.
fn pick(slot: &mut Option<CvParam>, param: &CvParam) -> Result<(), XicRefusal> {
    match slot {
        Some(existing) if existing != param => Err(XicMetadataProblem::ConflictingTerm.into()),
        Some(_) => Ok(()),
        None => {
            *slot = Some(param.clone());
            Ok(())
        }
    }
}

/// One value across many scans.
struct Uniform<T> {
    first: Option<T>,
    differs: bool,
}

impl<T> Default for Uniform<T> {
    fn default() -> Self {
        Self {
            first: None,
            differs: false,
        }
    }
}

impl<T: PartialEq> Uniform<T> {
    fn observe(&mut self, value: T) {
        match &self.first {
            Some(first) => self.differs |= *first != value,
            None => self.first = Some(value),
        }
    }
}

impl<T> Uniform<MzmlDeclared<T>> {
    /// A statement that conflicts with itself, or cannot be read, is no one
    /// value, even when every scan states it the same way.
    fn refused(&self) -> bool {
        self.differs
            || matches!(
                self.first,
                Some(MzmlDeclared::Conflicting | MzmlDeclared::Unreadable)
            )
    }
}

/// One axis of the run-wide unit rules, over every scan at every MS level.
#[derive(Default)]
struct AxisUnits {
    declared: Uniform<XicUnit>,
    incomplete: bool,
}

impl AxisUnits {
    fn observe(&mut self, unit: XicUnit) {
        self.incomplete |= unit.is_incomplete();
        self.declared.observe(unit);
    }

    fn refused(&self) -> bool {
        self.incomplete || self.declared.differs
    }
}

#[derive(Default)]
struct OpenArray {
    parse: ArrayParse,
    role: Option<CvParam>,
    refused: Option<ArrayProblem>,
}

impl OpenArray {
    fn decoded_role(&self) -> Option<ArrayRole> {
        match self.role.as_ref()?.get("accession")? {
            MZ_ARRAY => Some(ArrayRole::Mz),
            INTENSITY_ARRAY => Some(ArrayRole::Intensity),
            _ => None,
        }
    }

    fn refuse(&mut self, problem: ArrayProblem) {
        self.refused = Some(problem);
        self.parse.encoded = Vec::new();
    }
}

struct OpenSpectrum {
    index: u64,
    id: String,
    default_array_length: u64,
    ms_level: Option<CvParam>,
    representation: Option<CvParam>,
    retention_time: Option<CvParam>,
    facts: Facts,
    faims: MzmlDeclared<f64>,
    scan_lists: u32,
    scan_list_count: u64,
    scans: u64,
    window_lower: Option<f64>,
    window_upper: Option<f64>,
    scan_windows: Vec<(f64, f64)>,
    array_lists: u32,
    array_list_count: u64,
    arrays: u64,
    array: Option<OpenArray>,
    decoded_bytes: u64,
    mz: Option<OpenArray>,
    intensity: Option<OpenArray>,
}

impl OpenSpectrum {
    /// Whether the spectrum has already stated a level other than `level`, so
    /// its payloads need not be kept. An unreadable level keeps them; the end of
    /// the spectrum refuses it.
    fn declares_other_level(&self, level: u32) -> bool {
        self.ms_level
            .as_ref()
            .and_then(|param| param.get("value"))
            .and_then(|value| parse_u64_decimal(value).ok())
            .is_some_and(|declared| declared != u64::from(level))
    }
}

#[derive(Clone, Copy)]
enum Scope {
    Group,
    Spectrum,
    Scan,
    ScanWindow,
    Array,
}

/// One term read in its scope, direct or from a param group.
fn apply(spectrum: &mut OpenSpectrum, scope: Scope, param: &CvParam) -> Result<(), XicRefusal> {
    let accession = param.get("accession").unwrap_or_default();
    let value = param.get("value").unwrap_or_default();
    match scope {
        Scope::Group => {}
        Scope::Spectrum => match accession {
            MS_LEVEL => pick(&mut spectrum.ms_level, param)?,
            CENTROID | PROFILE => pick(&mut spectrum.representation, param)?,
            FAIMS_COMPENSATION_VOLTAGE => {
                spectrum.faims = spectrum.faims.and(compensation_voltage(value));
            }
            // The reader's per-term rule, so a polarity stated two ways keeps
            // its meaning. A polarity stated only inside a scan is not the
            // spectrum's, there as here.
            _ => {
                if let Some(facts) = fact(accession, value) {
                    spectrum.facts = spectrum.facts.and(facts);
                }
            }
        },
        Scope::Scan => match accession {
            SCAN_START_TIME => pick(&mut spectrum.retention_time, param)?,
            FAIMS_COMPENSATION_VOLTAGE => {
                spectrum.faims = spectrum.faims.and(compensation_voltage(value));
            }
            _ => {}
        },
        // A limit that cannot be read leaves no window to disclose.
        Scope::ScanWindow => match accession {
            SCAN_WINDOW_LOWER => spectrum.window_lower = parse_finite(value).ok(),
            SCAN_WINDOW_UPPER => spectrum.window_upper = parse_finite(value).ok(),
            _ => {}
        },
        Scope::Array => {
            let Some(array) = spectrum.array.as_mut() else {
                return Ok(());
            };
            if matches!(accession, MZ_ARRAY | INTENSITY_ARRAY | TIME_ARRAY) {
                pick(&mut array.role, param)?;
            }
            if let Some(stated) = stated_term(
                accession,
                param.get("name"),
                param.get("value"),
                param.get("unitAccession"),
            ) {
                array.parse.add(std::slice::from_ref(&stated));
            }
        }
    }
    Ok(())
}

fn compensation_voltage(value: &str) -> MzmlDeclared<f64> {
    parse_finite(value).map_or(MzmlDeclared::Unreadable, MzmlDeclared::Value)
}

fn required_count(value: Option<&str>, which: XicRequiredValue) -> Result<u64, XicRefusal> {
    let value = value.ok_or(XicMetadataProblem::Missing(which))?;
    Ok(parse_u64_decimal(value)?)
}

fn not_well_formed() -> XicRefusal {
    MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed).into()
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

struct XicPass<'a, T, C> {
    query: &'a XicQuery,
    limits: MzmlScanLimits,
    transform: &'a mut T,
    cancelled: C,
    stack: Vec<El>,
    elements: u64,
    root_seen: bool,
    mzml_elements: u32,
    groups: BTreeMap<String, Vec<CvParam>>,
    group: Option<(Option<String>, Vec<CvParam>)>,
    spectrum_lists: u32,
    declared_spectra: u64,
    spectra_read: u64,
    spectrum: Option<OpenSpectrum>,
    rows: Vec<XicScan>,
    mz_units: AxisUnits,
    intensity_units: AxisUnits,
    retention_time_units: AxisUnits,
    polarity: Uniform<MzmlDeclared<MzmlPolarity>>,
    faims: Uniform<MzmlDeclared<f64>>,
    representation: Uniform<MzmlRepresentation>,
    scan_windows: Uniform<Vec<(f64, f64)>>,
    scans_outside_scan_window: u64,
}

impl<T: XicSpectrumTransform, C: FnMut() -> bool> EventPass for XicPass<'_, T, C> {
    type Fail = XicRefusal;

    fn start(
        &mut self,
        start: &BytesStart<'_>,
        in_mzml: bool,
        _offset: u64,
        empty: bool,
        resolver: &NamespaceResolver,
    ) -> Result<(), XicRefusal> {
        check_element(
            start,
            empty,
            &mut self.elements,
            self.stack.len(),
            self.limits,
        )?;
        let attributes = capture_attributes(start, self.limits)?;
        let el = element(in_mzml, start.local_name().as_ref());
        let el = self.begin(el, start, &attributes, resolver)?;
        self.stack.push(el);
        if empty {
            self.end()?;
        }
        Ok(())
    }

    fn end(&mut self) -> Result<(), XicRefusal> {
        let el = self.stack.pop().ok_or_else(not_well_formed)?;
        match el {
            El::ParamGroup if self.stack.ends_with(&[El::Mzml, El::ParamGroupList]) => {
                let Some((id, params)) = self.group.take() else {
                    return Ok(());
                };
                let id = id.ok_or(MzmlOpenError::AmbiguousParamGroup)?;
                if self.groups.insert(id, params).is_some() {
                    return Err(MzmlOpenError::AmbiguousParamGroup.into());
                }
            }
            El::SpectrumList if self.stack.ends_with(&[El::Mzml, El::Run]) => {
                if self.spectra_read != self.declared_spectra {
                    return Err(XicMetadataProblem::CountDisagrees(
                        XicRequiredValue::SpectrumListCount,
                    )
                    .into());
                }
            }
            El::Spectrum => self.finish_spectrum()?,
            El::ScanList if self.stack.last() == Some(&El::Spectrum) => {
                let count = self
                    .spectrum
                    .as_ref()
                    .is_some_and(|spectrum| spectrum.scans != spectrum.scan_list_count);
                if count {
                    return Err(XicMetadataProblem::CountDisagrees(
                        XicRequiredValue::ScanListCount,
                    )
                    .into());
                }
            }
            El::ScanWindow if self.stack.ends_with(&SPECTRUM_SCAN_WINDOW[..4]) => {
                if let Some(spectrum) = self.spectrum.as_mut()
                    && let (Some(lower), Some(upper)) =
                        (spectrum.window_lower.take(), spectrum.window_upper.take())
                {
                    spectrum.scan_windows.push((lower, upper));
                }
            }
            El::BinaryDataArrayList if self.stack.last() == Some(&El::Spectrum) => {
                let count = self
                    .spectrum
                    .as_ref()
                    .is_some_and(|spectrum| spectrum.arrays != spectrum.array_list_count);
                if count {
                    return Err(XicMetadataProblem::CountDisagrees(
                        XicRequiredValue::ArrayListCount,
                    )
                    .into());
                }
            }
            El::BinaryDataArray if self.stack.ends_with(&SPECTRUM_ARRAY[..2]) => {
                self.finish_array()?;
            }
            _ => {}
        }
        Ok(())
    }

    /// A payload over its bound is that array's refusal and the pass goes on:
    /// the tokenizer stays under the document's own text-run limit, and only
    /// what fits the declared length is kept.
    fn text(&mut self, bytes: &[u8]) -> Result<(), XicRefusal> {
        if self.stack.last() != Some(&El::Binary) {
            return Ok(());
        }
        let Some(array) = self.open_array() else {
            return Ok(());
        };
        let Some(prepared) = array.parse.prepared else {
            return Ok(());
        };
        if array.refused.is_some() {
            return Ok(());
        }
        let total = (array.parse.encoded.len() as u64).saturating_add(bytes.len() as u64);
        if total > prepared.bound {
            array.refuse(ArrayProblem::EncodedTextOverBound);
        } else if array.parse.encoded.try_reserve(bytes.len()).is_err() {
            array.refuse(ArrayProblem::AllocationRefused);
        } else {
            array.parse.encoded.extend_from_slice(bytes);
        }
        Ok(())
    }

    fn reference(&mut self, reference: &BytesRef<'_>) -> Result<(), XicRefusal> {
        if self.stack.last() != Some(&El::Binary) {
            return Ok(());
        }
        if let Ok(Some(character)) = reference.resolve_char_ref() {
            return self.text(character.encode_utf8(&mut [0; 4]).as_bytes());
        }
        if let Some(array) = self.open_array() {
            array.refuse(ArrayProblem::CorruptBase64);
        }
        Ok(())
    }
}

impl<'a, T: XicSpectrumTransform, C: FnMut() -> bool> XicPass<'a, T, C> {
    fn new(
        query: &'a XicQuery,
        limits: MzmlScanLimits,
        transform: &'a mut T,
        cancelled: C,
    ) -> Self {
        Self {
            query,
            limits,
            transform,
            cancelled,
            stack: Vec::new(),
            elements: 0,
            root_seen: false,
            mzml_elements: 0,
            groups: BTreeMap::new(),
            group: None,
            spectrum_lists: 0,
            declared_spectra: 0,
            spectra_read: 0,
            spectrum: None,
            rows: Vec::new(),
            mz_units: AxisUnits::default(),
            intensity_units: AxisUnits::default(),
            retention_time_units: AxisUnits::default(),
            polarity: Uniform::default(),
            faims: Uniform::default(),
            representation: Uniform::default(),
            scan_windows: Uniform::default(),
            scans_outside_scan_window: 0,
        }
    }

    fn open_array(&mut self) -> Option<&mut OpenArray> {
        self.spectrum.as_mut()?.array.as_mut()
    }

    /// Whether the query is already certain to be refused, whatever follows.
    fn refusal_is_certain(&self) -> bool {
        self.mz_units.refused()
            || self.intensity_units.refused()
            || self.retention_time_units.refused()
            || self.polarity.refused()
            || self.faims.refused()
            || self.representation.differs
    }

    fn begin(
        &mut self,
        el: El,
        start: &BytesStart<'_>,
        attributes: &CapturedAttributes<'_>,
        resolver: &NamespaceResolver,
    ) -> Result<El, XicRefusal> {
        if self.stack.is_empty() {
            if self.root_seen {
                return Err(not_well_formed());
            }
            self.root_seen = true;
            match el {
                El::IndexedMzml => {}
                El::Mzml => self.begin_mzml(start, attributes, resolver)?,
                _ => {
                    return Err(MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot).into());
                }
            }
            return Ok(el);
        }
        let in_spectrum = self.stack.last() == Some(&El::Spectrum);
        match el {
            El::Mzml if self.stack == [El::IndexedMzml] => {
                self.begin_mzml(start, attributes, resolver)?;
            }
            El::ParamGroup if self.stack.ends_with(&[El::Mzml, El::ParamGroupList]) => {
                if self.groups.len() >= MAX_PARAM_GROUPS {
                    return Err(MzmlOpenError::ReaderLimit(ReaderLimitKind::ParamGroups).into());
                }
                let id = attributes.id.as_deref().filter(|id| !id.is_empty());
                self.group = Some((id.map(str::to_owned), Vec::new()));
            }
            El::SpectrumList if self.stack.ends_with(&[El::Mzml, El::Run]) => {
                self.spectrum_lists += 1;
                if self.spectrum_lists > 1 {
                    return Err(XicMetadataProblem::NotOneSpectrumList.into());
                }
                self.declared_spectra = required_count(
                    attributes.count.as_deref(),
                    XicRequiredValue::SpectrumListCount,
                )?;
            }
            El::Spectrum if self.stack.ends_with(&[El::Mzml, El::Run, El::SpectrumList]) => {
                self.begin_spectrum(attributes)?;
            }
            // A spectrum anywhere else is not one of the run's, and must not
            // close one.
            El::Spectrum => return Ok(El::Other),
            El::ScanList if in_spectrum => {
                let count =
                    required_count(attributes.count.as_deref(), XicRequiredValue::ScanListCount)?;
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.scan_lists += 1;
                    if spectrum.scan_lists > 1 {
                        return Err(XicMetadataProblem::MoreThanOneScanList.into());
                    }
                    spectrum.scan_list_count = count;
                }
            }
            El::Scan if self.stack.ends_with(&SPECTRUM_SCAN[..2]) => {
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.scans += 1;
                }
            }
            El::BinaryDataArrayList if in_spectrum => {
                let count = required_count(
                    attributes.count.as_deref(),
                    XicRequiredValue::ArrayListCount,
                )?;
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.array_lists += 1;
                    if spectrum.array_lists > 1 {
                        return Err(XicMetadataProblem::MoreThanOneArrayList.into());
                    }
                    spectrum.array_list_count = count;
                }
            }
            El::BinaryDataArray if self.stack.ends_with(&SPECTRUM_ARRAY[..2]) => {
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.arrays += 1;
                    spectrum.array = Some(OpenArray::default());
                }
            }
            El::Binary if self.stack.ends_with(SPECTRUM_ARRAY) => self.begin_payload(),
            El::CvParam => self.cv_param(start, attributes)?,
            El::ParamGroupRef => self.group_ref(attributes)?,
            _ => {}
        }
        Ok(el)
    }

    fn begin_mzml(
        &mut self,
        start: &BytesStart<'_>,
        attributes: &CapturedAttributes<'_>,
        resolver: &NamespaceResolver,
    ) -> Result<(), XicRefusal> {
        self.mzml_elements += 1;
        if self.mzml_elements > 1 {
            return Err(XicMetadataProblem::NotOneMzml.into());
        }
        Ok(check_version(start, attributes, resolver)?)
    }

    fn begin_spectrum(&mut self, attributes: &CapturedAttributes<'_>) -> Result<(), XicRefusal> {
        if (self.cancelled)() {
            return Err(XicRefusal::Cancelled);
        }
        if self.spectra_read >= self.limits.max_spectra {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Spectra).into());
        }
        self.spectra_read += 1;
        let index = required_count(attributes.index.as_deref(), XicRequiredValue::Index)?;
        let id = attributes
            .id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or(XicMetadataProblem::Missing(XicRequiredValue::NativeId))?;
        let default_array_length = required_count(
            attributes.default_array_length.as_deref(),
            XicRequiredValue::DefaultArrayLength,
        )?;
        self.spectrum = Some(OpenSpectrum {
            index,
            id: id.to_owned(),
            default_array_length,
            ms_level: None,
            representation: None,
            retention_time: None,
            facts: Facts::default(),
            faims: MzmlDeclared::NotDeclared,
            scan_lists: 0,
            scan_list_count: 0,
            scans: 0,
            window_lower: None,
            window_upper: None,
            scan_windows: Vec::new(),
            array_lists: 0,
            array_list_count: 0,
            arrays: 0,
            array: None,
            decoded_bytes: 0,
            mz: None,
            intensity: None,
        });
        Ok(())
    }

    fn scope(&self) -> Option<Scope> {
        if self.stack.ends_with(&[El::ParamGroupList, El::ParamGroup]) {
            return self.group.is_some().then_some(Scope::Group);
        }
        self.spectrum.as_ref()?;
        if self.stack.last() == Some(&El::Spectrum) {
            Some(Scope::Spectrum)
        } else if self.stack.ends_with(SPECTRUM_SCAN) {
            Some(Scope::Scan)
        } else if self.stack.ends_with(SPECTRUM_SCAN_WINDOW) {
            Some(Scope::ScanWindow)
        } else if self.stack.ends_with(SPECTRUM_ARRAY) {
            Some(Scope::Array)
        } else {
            None
        }
    }

    fn cv_param(
        &mut self,
        start: &BytesStart<'_>,
        attributes: &CapturedAttributes<'_>,
    ) -> Result<(), XicRefusal> {
        let Some(scope) = self.scope() else {
            return Ok(());
        };
        let Some(accession) = attributes.accession.as_deref() else {
            return Ok(());
        };
        if !is_read(accession, attributes.name.as_deref()) {
            return Ok(());
        }
        let param = CvParam::read(start)?;
        if let Scope::Group = scope {
            if let Some((_, params)) = self.group.as_mut() {
                if params.len() >= MAX_TERMS_PER_PARAM_GROUP {
                    return Err(
                        MzmlOpenError::ReaderLimit(ReaderLimitKind::TermsPerParamGroup).into(),
                    );
                }
                params.push(param);
            }
            return Ok(());
        }
        match self.spectrum.as_mut() {
            Some(spectrum) => apply(spectrum, scope, &param),
            None => Ok(()),
        }
    }

    fn group_ref(&mut self, attributes: &CapturedAttributes<'_>) -> Result<(), XicRefusal> {
        // Every reference is checked, wherever it sits, as the reader does.
        let reference = attributes.reference.as_deref().unwrap_or_default();
        let scope = self.scope();
        let group = self
            .groups
            .get(reference)
            .ok_or(MzmlOpenError::UndefinedParamGroup)?;
        match (scope, self.spectrum.as_mut()) {
            // A group referring to a group is not mzML.
            (Some(Scope::Group), _) => Err(not_well_formed()),
            (Some(scope), Some(spectrum)) => group
                .iter()
                .try_for_each(|param| apply(spectrum, scope, param)),
            _ => Ok(()),
        }
    }

    /// Terms are judged and caps checked here, before any payload is kept. A
    /// refusal belongs to this array, and so to this scan's state.
    fn begin_payload(&mut self) {
        let certain = self.refusal_is_certain();
        let level = self.query.ms_level;
        let Some(spectrum) = self.spectrum.as_mut() else {
            return;
        };
        let skip = certain || spectrum.declares_other_level(level);
        let default_length = Some(spectrum.default_array_length);
        let decoded_bytes = spectrum.decoded_bytes;
        let Some(array) = spectrum.array.as_mut() else {
            return;
        };
        array.parse.payload_started = true;
        if skip {
            return;
        }
        let Some(role) = array.decoded_role() else {
            return;
        };
        // The array's own `arrayLength` is not read: the frozen rule is that
        // both arrays hold `defaultArrayLength` points.
        match prepare_array(&array.parse, role, default_length, decoded_bytes) {
            Ok(prepared) => {
                array.parse.prepared = Some(prepared);
                spectrum.decoded_bytes += prepared.bytes;
            }
            Err(problem) => array.refuse(problem),
        }
    }

    fn finish_array(&mut self) -> Result<(), XicRefusal> {
        let Some(spectrum) = self.spectrum.as_mut() else {
            return Ok(());
        };
        let Some(array) = spectrum.array.take() else {
            return Ok(());
        };
        // Any other array is not decoded and does not affect the usable pair.
        let slot = match array.decoded_role() {
            Some(ArrayRole::Mz) => &mut spectrum.mz,
            Some(ArrayRole::Intensity) => &mut spectrum.intensity,
            None => return Ok(()),
        };
        if slot.is_some() {
            return Err(XicMetadataProblem::DuplicateArrayRole.into());
        }
        *slot = Some(array);
        Ok(())
    }

    fn finish_spectrum(&mut self) -> Result<(), XicRefusal> {
        let Some(mut spectrum) = self.spectrum.take() else {
            return Ok(());
        };
        // Every scan's metadata is judged, at every MS level, before its state.
        let ms_level = spectrum.ms_level.as_ref().map(ms_level_of).transpose()?;
        let representation = match spectrum
            .representation
            .as_ref()
            .and_then(|param| param.get("accession"))
        {
            Some(CENTROID) => MzmlRepresentation::Centroid,
            Some(_) => MzmlRepresentation::Profile,
            None => MzmlRepresentation::NotDeclared,
        };
        let mut retention_time = spectrum
            .retention_time
            .as_ref()
            .map(retention_time_of)
            .transpose()?;

        let role_unit = |array: &OpenArray| XicUnit::of(array.role.as_ref());
        if let Some(mz) = &spectrum.mz {
            self.mz_units.observe(role_unit(mz));
        }
        if let Some(intensity) = &spectrum.intensity {
            self.intensity_units.observe(role_unit(intensity));
        }
        // A scan with no scan start time is an undeclared unit on this axis.
        self.retention_time_units
            .observe(XicUnit::of(spectrum.retention_time.as_ref()));

        let in_scope = ms_level == Some(self.query.ms_level);
        if in_scope {
            self.polarity.observe(spectrum.facts.polarity);
            self.faims.observe(spectrum.faims);
            self.representation.observe(representation);
            let outside = !spectrum.scan_windows.is_empty()
                && !spectrum
                    .scan_windows
                    .iter()
                    .any(|&(lower, upper)| lower <= self.query.high && self.query.low <= upper);
            self.scans_outside_scan_window += u64::from(outside);
            self.scan_windows
                .observe(std::mem::take(&mut spectrum.scan_windows));
        }
        if self.refusal_is_certain() {
            return Ok(());
        }

        let (state, decode_attempted) = match ms_level {
            None => (XicScanState::MsLevelUndeclared, false),
            Some(_) if !in_scope => (XicScanState::ExcludedByMsLevel, false),
            Some(_) => self.evaluate(&mut spectrum, &mut retention_time)?,
        };
        self.rows.push(XicScan {
            identity: SpectrumIdentity::from_native_identifier(spectrum.index, spectrum.id),
            ms_level,
            representation,
            retention_time,
            state,
            decode_attempted,
        });
        Ok(())
    }

    /// The oracle's order: an absent array first; m/z decoded, and a NaN or a
    /// wrong length there ends the scan without decoding intensity; then
    /// intensity; then the window.
    fn evaluate(
        &mut self,
        spectrum: &mut OpenSpectrum,
        retention_time: &mut Option<f64>,
    ) -> Result<(XicScanState, bool), XicRefusal> {
        let (Some(mz), Some(intensity)) = (spectrum.mz.take(), spectrum.intensity.take()) else {
            return Ok((XicScanState::NoUsableArrays, false));
        };
        let mut mz = match decode_array(mz, ArrayRole::Mz)? {
            Decoded::Values(values) if !values.iter().any(|value| value.is_nan()) => values,
            Decoded::Values(_) | Decoded::LengthDiffers => {
                return Ok((XicScanState::NoUsableArrays, true));
            }
            Decoded::Unreadable(reason) => {
                let role = ArrayRole::Mz;
                return Ok((XicScanState::Unreadable { role, reason }, true));
            }
        };
        let mut intensity = match decode_array(intensity, ArrayRole::Intensity)? {
            Decoded::Values(values) => values,
            Decoded::LengthDiffers => return Ok((XicScanState::NoUsableArrays, true)),
            Decoded::Unreadable(reason) => {
                let role = ArrayRole::Intensity;
                return Ok((XicScanState::Unreadable { role, reason }, true));
            }
        };
        self.transform
            .apply(retention_time, &mut mz, &mut intensity);
        Ok((window_sum(&mz, &intensity, self.query), true))
    }

    fn finish(mut self) -> Result<XicResult, XicRefusal> {
        if !self.root_seen {
            return Err(MzmlScanError::Malformed(MzmlMalformedKind::MissingRootElement).into());
        }
        if !self.stack.is_empty() {
            return Err(not_well_formed());
        }
        if self.mzml_elements == 0 {
            return Err(MzmlOpenError::NotMzml11.into());
        }
        if self.spectrum_lists != 1 {
            return Err(XicMetadataProblem::NotOneSpectrumList.into());
        }
        let mut indices = HashSet::with_capacity(self.rows.len());
        let mut ids = HashSet::with_capacity(self.rows.len());
        for row in &self.rows {
            let id = row.identity.representations().first();
            if !indices.insert(row.identity.index()) || !ids.insert(id.map(|id| id.sensitive_raw()))
            {
                return Err(XicMetadataProblem::DuplicateIdentity.into());
            }
        }
        for (axis, units) in [
            (XicAxis::Mz, &self.mz_units),
            (XicAxis::Intensity, &self.intensity_units),
            (XicAxis::RetentionTime, &self.retention_time_units),
        ] {
            if units.incomplete {
                return Err(XicRefusal::IncompleteUnit(axis));
            }
            if units.declared.differs {
                return Err(XicRefusal::MixedUnit(axis));
            }
        }
        if self.polarity.refused() {
            return Err(XicRefusal::MixedPolarity);
        }
        if self.faims.refused() {
            return Err(XicRefusal::MixedFaimsCompensationVoltage);
        }
        if self.representation.differs {
            return Err(XicRefusal::MixedRepresentation);
        }
        if (self.cancelled)() {
            return Err(XicRefusal::Cancelled);
        }
        let coverage_gaps = self.rows.iter().filter(|row| row.is_coverage_gap()).count() as u64;
        Ok(XicResult {
            query: *self.query,
            rows: self.rows,
            coverage_gaps,
            mz_unit: self.mz_units.declared.first.unwrap_or_default(),
            intensity_unit: self.intensity_units.declared.first.unwrap_or_default(),
            retention_time_unit: self.retention_time_units.declared.first.unwrap_or_default(),
            representation: self
                .representation
                .first
                .unwrap_or(MzmlRepresentation::NotDeclared),
            polarity: self.polarity.first.unwrap_or_default(),
            faims_compensation_voltage: match self.faims.first {
                Some(MzmlDeclared::Value(voltage)) => Some(voltage),
                _ => None,
            },
            scans_outside_scan_window: self.scans_outside_scan_window,
            scan_windows_differ: self.scan_windows.differs,
        })
    }
}

fn ms_level_of(param: &CvParam) -> Result<u32, XicRefusal> {
    let value = param
        .get("value")
        .ok_or(XicMetadataProblem::Missing(XicRequiredValue::MsLevelValue))?;
    let level = u32::try_from(parse_u64_decimal(value)?)
        .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber))?;
    if level == 0 {
        return Err(XicMetadataProblem::MsLevelNotPositive.into());
    }
    Ok(level)
}

fn retention_time_of(param: &CvParam) -> Result<f64, XicRefusal> {
    let value = param.get("value").ok_or(XicMetadataProblem::Missing(
        XicRequiredValue::ScanStartTimeValue,
    ))?;
    Ok(parse_finite(value)?)
}

enum Decoded {
    Values(Vec<f64>),
    LengthDiffers,
    Unreadable(XicUnreadableReason),
}

/// One array, through the reader's base64, inflate and exact widening, keeping
/// non-finite values for the state policy to judge. A length that differs from
/// the declared one is the scan's `NoUsableArrays`; the inflate that stops one
/// byte past it counts, since the bound leaves nothing more to measure.
fn decode_array(mut array: OpenArray, role: ArrayRole) -> Result<Decoded, XicRefusal> {
    use XicUnreadableReason as Reason;
    if array.parse.late_term {
        return Ok(Decoded::Unreadable(Reason::TermAfterPayload));
    }
    if let Some(problem) = array.refused {
        return Ok(Decoded::Unreadable(Reason::Array(problem)));
    }
    let Some(prepared) = array.parse.prepared else {
        return Ok(Decoded::Unreadable(Reason::PayloadAbsent));
    };
    let encoded = std::mem::take(&mut array.parse.encoded);
    let bytes = match stored_bytes(prepared, encoded) {
        Ok(bytes) => bytes,
        Err(ArrayProblem::DecodedLongerThanDeclared) => return Ok(Decoded::LengthDiffers),
        Err(problem) => return Ok(Decoded::Unreadable(Reason::Array(problem))),
    };
    if !bytes.len().is_multiple_of(prepared.data_type.width()) {
        return Ok(Decoded::Unreadable(Reason::NotWholeValues));
    }
    if bytes.len() as u64 != prepared.bytes {
        return Ok(Decoded::LengthDiffers);
    }
    match widen_keeping_non_finite(&bytes, prepared.data_type) {
        Ok(values) => Ok(Decoded::Values(values)),
        Err(ArrayProblem::IntegerNotExact) => Err(XicRefusal::IntegerNotExact(role)),
        Err(problem) => Ok(Decoded::Unreadable(Reason::Array(problem))),
    }
}

/// The per-scan sum over the closed window. An infinite m/z compares normally
/// and falls outside; unsorted m/z is legal, since the sum is over a set.
fn window_sum(mz: &[f64], intensity: &[f64], query: &XicQuery) -> XicScanState {
    let mut sum = ExactSum::default();
    let mut points_in_window = 0_u64;
    let mut non_finite = false;
    for (&position, &stored) in mz.iter().zip(intensity) {
        if query.low <= position && position <= query.high {
            points_in_window += 1;
            if stored.is_finite() {
                sum.add(stored);
            } else {
                non_finite = true;
            }
        }
    }
    if non_finite {
        return XicScanState::NonFiniteIntensity;
    }
    match sum.finish() {
        Some(sum) => XicScanState::Measured {
            sum,
            points_in_window,
        },
        None => XicScanState::SumNotRepresentable,
    }
}

// ---------------------------------------------------------------------------
// The exact sum (XIC-S3)
// ---------------------------------------------------------------------------

/// Limbs on the 2^-1074 grid. A finite binary64 is below 2^2098 grid units, and
/// 2^64 of them sum below 2^2162, so 34 limbs (2176 bits) cannot overflow. The
/// caps allow 2^23 points per spectrum.
const LIMBS: usize = 34;
const FRACTION_BITS: u32 = 52;
const FRACTION_MASK: u64 = (1 << FRACTION_BITS) - 1;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Magnitude([u64; LIMBS]);

impl Magnitude {
    const ZERO: Self = Self([0; LIMBS]);

    fn add_shifted(&mut self, mantissa: u64, shift: usize) {
        let mut carry = u128::from(mantissa) << (shift % 64);
        for limb in &mut self.0[shift / 64..] {
            if carry == 0 {
                return;
            }
            let sum = u128::from(*limb) + (carry & u128::from(u64::MAX));
            *limb = sum as u64;
            carry = (carry >> 64) + (sum >> 64);
        }
    }

    /// The value of a finite binary64's magnitude, in grid units.
    fn add_value(&mut self, value: f64) {
        let bits = value.to_bits();
        let exponent = ((bits >> FRACTION_BITS) & 0x7ff) as usize;
        let fraction = bits & FRACTION_MASK;
        if exponent == 0 {
            self.add_shifted(fraction, 0);
        } else {
            self.add_shifted(fraction | (1 << FRACTION_BITS), exponent - 1);
        }
    }

    /// `self - other`, where `self` is the greater.
    fn minus(&self, other: &Self) -> Self {
        let mut result = Self::ZERO;
        let mut borrow = false;
        for (limb, (&left, &right)) in result.0.iter_mut().zip(self.0.iter().zip(&other.0)) {
            let (difference, first) = left.overflowing_sub(right);
            let (difference, second) = difference.overflowing_sub(u64::from(borrow));
            *limb = difference;
            borrow = first || second;
        }
        result
    }

    fn compare(&self, other: &Self) -> std::cmp::Ordering {
        self.0.iter().rev().cmp(other.0.iter().rev())
    }

    /// The position of the highest set bit, or `None` for zero.
    fn highest_bit(&self) -> Option<usize> {
        let limb = self.0.iter().rposition(|&limb| limb != 0)?;
        Some(limb * 64 + 63 - self.0[limb].leading_zeros() as usize)
    }

    fn bit(&self, position: usize) -> bool {
        self.0[position / 64] >> (position % 64) & 1 == 1
    }

    fn any_bit_below(&self, position: usize) -> bool {
        let (limb, offset) = (position / 64, position % 64);
        self.0[..limb].iter().any(|&limb| limb != 0) || self.0[limb] & ((1_u64 << offset) - 1) != 0
    }

    /// 53 bits starting at `shift`. `shift` is at most 2045, so both limbs
    /// exist.
    fn mantissa_at(&self, shift: usize) -> u64 {
        let (limb, offset) = (shift / 64, shift % 64);
        let wide = (u128::from(self.0[limb + 1]) << 64) | u128::from(self.0[limb]);
        ((wide >> offset) as u64) & ((1 << (FRACTION_BITS + 1)) - 1)
    }
}

/// The exact dyadic sum of finite stored values, rounded once at the end.
struct ExactSum {
    positive: Magnitude,
    negative: Magnitude,
}

impl Default for ExactSum {
    fn default() -> Self {
        Self {
            positive: Magnitude::ZERO,
            negative: Magnitude::ZERO,
        }
    }
}

impl ExactSum {
    fn add(&mut self, value: f64) {
        if value.is_sign_negative() {
            self.negative.add_value(value);
        } else {
            self.positive.add_value(value);
        }
    }

    /// `None` when the final exact sum lies outside `[-f64::MAX, f64::MAX]`.
    /// Otherwise binary64, nearest with ties to even, and `+0` for exact zero.
    fn finish(self) -> Option<f64> {
        use std::cmp::Ordering;
        let (magnitude, sign) = match self.positive.compare(&self.negative) {
            Ordering::Equal => return Some(0.0),
            Ordering::Greater => (self.positive.minus(&self.negative), 0),
            Ordering::Less => (self.negative.minus(&self.positive), 1_u64 << 63),
        };
        let mut maximum = Magnitude::ZERO;
        maximum.add_value(f64::MAX);
        if magnitude.compare(&maximum) == Ordering::Greater {
            return None;
        }
        let mut high = magnitude.highest_bit()?;
        // Up to 53 bits are exact, and the grid unit is binary64's own: the
        // integer's bits are the subnormal's, or the lowest normal binade's.
        if high <= FRACTION_BITS as usize {
            return Some(f64::from_bits(sign | magnitude.0[0]));
        }
        let shift = high - FRACTION_BITS as usize;
        let mut mantissa = magnitude.mantissa_at(shift);
        let round_up =
            magnitude.bit(shift - 1) && (magnitude.any_bit_below(shift - 1) || mantissa & 1 == 1);
        if round_up {
            mantissa += 1;
        }
        if mantissa == 1 << (FRACTION_BITS + 1) {
            mantissa >>= 1;
            high += 1;
        }
        let exponent = (high - FRACTION_BITS as usize + 1) as u64;
        Some(f64::from_bits(
            sign | (exponent << FRACTION_BITS) | (mantissa & FRACTION_MASK),
        ))
    }
}

#[cfg(test)]
mod tests;
