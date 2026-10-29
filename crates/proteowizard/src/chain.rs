//! The ordered filter chains of ADR 0055 decision 4.
//!
//! One variant per msconvert filter step, each carrying only its own typed
//! parameters, so a parameter a step does not read has no field to be set in.
//! Three of decision 4's rules are structural rather than checked:
//!
//! - **`peakPicking cwt` has no variant.** M6.2 measured it returning one of
//!   three peaks in silence, and aborting with an unterminated document.
//! - **`snr` and `peakSpace` exist nowhere**, because the only picker that reads
//!   them is `cwt`. `msLevel=` exists only on the vendor picker, which consumes
//!   it; the bare picker has no field, because M6.2 measured its scope being
//!   discarded.
//! - **The deprecated `analyzerType` spelling has no variant**: `analyzer`
//!   covers it.
//!
//! The rest are checked when a [`StructuredIntent`](crate::StructuredIntent) is
//! built, so no chain reaches argv without them: the vendor picker only first,
//! ordered ranges, non-empty lists, and an integer set that is not a step's
//! whole argument limited to one interval.
//!
//! **The spellings are help-derived, not measured.** Every rendering below
//! follows the msconvert 3.0.26013 help and none was run. That is what the
//! advanced tier is, and why it carries the "not verified by MSCanvas" label.
//!
//! Not here yet: `mzRefiner` and `diaUmpire` take files, which arrive in
//! delivery slice 4 through a Rust-owned picker and staged copies.

use std::fmt;
use std::num::NonZeroU32;

use thiserror::Error;

/// Why a value, a step or an intent could not be built.
///
/// Every refusal happens before a [`StructuredIntent`](crate::StructuredIntent)
/// exists, so there is no partly valid intent to lower.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum StructuredIntentError {
    #[error("a number is not finite")]
    NotFinite,
    #[error("a number that must be above 0 is not")]
    NotPositive,
    #[error("a number that must not be negative is")]
    Negative,
    #[error("a fraction is outside 0 to 1")]
    NotAFraction,
    #[error("a set or list is empty")]
    Empty,
    #[error("a range ends before it starts")]
    UnorderedRange,
    #[error("an integer set that is not a step's whole argument has more than one interval")]
    SetNotOneInterval,
    #[error("a text field is empty")]
    EmptyText,
    #[error("a text field contains a character it refuses")]
    ForbiddenCharacter,
    #[error("the vendor peakPicking step is not first in the spectrum chain")]
    VendorPickerNotFirst,
    #[error("the mzMLb compression level is above 9")]
    CompressionLevelOutOfRange,
    #[error("mzMLb compression level 0 needs zlib off; with zlib on the build raises it to 4")]
    CompressionLevelZeroWithZlib,
    #[error("truncation drops more mantissa bits than the array's precision holds")]
    TruncationExceedsMantissa,
}

impl StructuredIntentError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotFinite => "not_finite",
            Self::NotPositive => "not_positive",
            Self::Negative => "negative",
            Self::NotAFraction => "not_a_fraction",
            Self::Empty => "empty",
            Self::UnorderedRange => "unordered_range",
            Self::SetNotOneInterval => "set_not_one_interval",
            Self::EmptyText => "empty_text",
            Self::ForbiddenCharacter => "forbidden_character",
            Self::VendorPickerNotFirst => "vendor_picker_not_first",
            Self::CompressionLevelOutOfRange => "compression_level_out_of_range",
            Self::CompressionLevelZeroWithZlib => "compression_level_zero_with_zlib",
            Self::TruncationExceedsMantissa => "truncation_exceeds_mantissa",
        }
    }
}

use StructuredIntentError as E;

/// A finite number, with `-0.0` folded into `0.0` so one value has one
/// spelling and equality can compare bits.
fn finite(value: f64) -> Result<f64, E> {
    if !value.is_finite() {
        return Err(E::NotFinite);
    }
    Ok(if value == 0.0 { 0.0 } else { value })
}

macro_rules! real_newtype {
    ($(#[$meta:meta])* $name:ident, |$value:ident| $check:expr) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy)]
        pub struct $name(f64);

        impl $name {
            pub fn new(value: f64) -> Result<Self, StructuredIntentError> {
                let $value = finite(value)?;
                $check.map(|()| Self($value))
            }

            #[must_use]
            pub const fn get(self) -> f64 {
                self.0
            }
        }

        // Bitwise, which is exact because the constructor refuses NaN and folds
        // the two zeros.
        impl PartialEq for $name {
            fn eq(&self, other: &Self) -> bool {
                self.0.to_bits() == other.0.to_bits()
            }
        }

        impl Eq for $name {}

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

real_newtype!(
    /// Any finite number.
    Real,
    |value| Ok::<(), E>(())
);
real_newtype!(
    /// A finite number above 0.
    Positive,
    |value| if value > 0.0 { Ok(()) } else { Err(E::NotPositive) }
);
real_newtype!(
    /// A finite number at or above 0.
    NonNegative,
    |value| if value >= 0.0 { Ok(()) } else { Err(E::Negative) }
);
real_newtype!(
    /// A finite number from 0 to 1, as the help states its percentages.
    Fraction,
    |value| if (0.0..=1.0).contains(&value) { Ok(()) } else { Err(E::NotAFraction) }
);

/// The help's `int_set`: a union of intervals, each closed or open-ended.
///
/// Canonical by construction: sorted, with overlapping and adjacent intervals
/// merged, so one set has one value and one spelling. That is what lets the
/// verified lookup compare structurally: `1-1` from a control is `1`, which is
/// what the L1 row lowers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntSet {
    /// `(start, None)` is open-ended: `start-`.
    intervals: Vec<(u32, Option<u32>)>,
}

impl IntSet {
    pub fn new(intervals: impl IntoIterator<Item = (u32, Option<u32>)>) -> Result<Self, E> {
        let mut intervals: Vec<_> = intervals.into_iter().collect();
        if intervals.is_empty() {
            return Err(E::Empty);
        }
        if intervals
            .iter()
            .any(|(start, end)| end.is_some_and(|end| end < *start))
        {
            return Err(E::UnorderedRange);
        }
        intervals.sort_unstable();
        let mut merged: Vec<(u32, Option<u32>)> = Vec::with_capacity(intervals.len());
        for (start, end) in intervals {
            if let Some(last) = merged.last_mut() {
                match last.1 {
                    // An open interval already holds everything after it.
                    None => continue,
                    Some(last_end) if start <= last_end.saturating_add(1) => {
                        last.1 = end.map(|end| end.max(last_end));
                        continue;
                    }
                    Some(_) => {}
                }
            }
            merged.push((start, end));
        }
        Ok(Self { intervals: merged })
    }

    #[must_use]
    pub fn single(value: u32) -> Self {
        Self {
            intervals: vec![(value, Some(value))],
        }
    }

    #[must_use]
    pub fn intervals(&self) -> &[(u32, Option<u32>)] {
        &self.intervals
    }

    /// Several intervals are spelled with spaces between them, so a set that is
    /// a `name=` value, or followed by nothing the help says consumes the rest,
    /// must be one interval to stay one token.
    fn require_one_interval(&self) -> Result<(), E> {
        if self.intervals.len() == 1 {
            Ok(())
        } else {
            Err(E::SetNotOneInterval)
        }
    }
}

impl fmt::Display for IntSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (position, (start, end)) in self.intervals.iter().enumerate() {
            if position > 0 {
                f.write_str(" ")?;
            }
            match end {
                Some(end) if end == start => write!(f, "{start}")?,
                Some(end) => write!(f, "{start}-{end}")?,
                None => write!(f, "{start}-")?,
            }
        }
        Ok(())
    }
}

/// One line of text that the provider reads up to the end of the argument.
///
/// Single spaces only: no control character, no other whitespace, no space at
/// either end and no run of spaces, so the provider cannot read a different
/// string from the one the user saw.
fn one_line(text: String, forbidden: &[char]) -> Result<String, E> {
    if text.is_empty() {
        return Err(E::EmptyText);
    }
    let bad_char = text
        .chars()
        .any(|c| c.is_control() || (c.is_whitespace() && c != ' ') || forbidden.contains(&c));
    if bad_char || text.starts_with(' ') || text.ends_with(' ') || text.contains("  ") {
        return Err(E::ForbiddenCharacter);
    }
    Ok(text)
}

/// One native ID for the `id` filter. `;` separates IDs there, so it is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeId(String);

impl NativeId {
    pub fn new(text: impl Into<String>) -> Result<Self, E> {
        one_line(text.into(), &[';']).map(Self)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The match string of `thermoScanFilter`, which the help says may contain
/// spaces and which is the step's last argument.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanFilterText(String);

impl ScanFilterText {
    pub fn new(text: impl Into<String>) -> Result<Self, E> {
        one_line(text.into(), &[]).map(Self)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Literal text in a `titleMaker` template.
///
/// No whitespace, and no `<` or `>`, which would make a keyword the user did
/// not choose. ponytail: whitespace is refused because nothing read shows the
/// filter consuming the rest of its argument; allow it when the source says so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleLiteral(String);

impl TitleLiteral {
    pub fn new(text: impl Into<String>) -> Result<Self, E> {
        let text = one_line(text.into(), &['<', '>'])?;
        if text.contains(' ') {
            return Err(E::ForbiddenCharacter);
        }
        Ok(Self(text))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The keywords `titleMaker` recognizes (help lines 262-289).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleKeyword {
    RunId,
    Index,
    Id,
    SourcePath,
    ScanNumber,
    IonMobility,
    ActivationType,
    IsolationMz,
    PrecursorSpectrumId,
    SelectedIonMz,
    ChargeState,
    SpectrumType,
    ScanStartTimeInSeconds,
    ScanStartTimeInMinutes,
    BasePeakMz,
    BasePeakIntensity,
    TotalIonCurrent,
    MsLevel,
}

impl TitleKeyword {
    #[must_use]
    pub const fn spelling(self) -> &'static str {
        match self {
            Self::RunId => "<RunId>",
            Self::Index => "<Index>",
            Self::Id => "<Id>",
            Self::SourcePath => "<SourcePath>",
            Self::ScanNumber => "<ScanNumber>",
            Self::IonMobility => "<IonMobility>",
            Self::ActivationType => "<ActivationType>",
            Self::IsolationMz => "<IsolationMz>",
            Self::PrecursorSpectrumId => "<PrecursorSpectrumId>",
            Self::SelectedIonMz => "<SelectedIonMz>",
            Self::ChargeState => "<ChargeState>",
            Self::SpectrumType => "<SpectrumType>",
            Self::ScanStartTimeInSeconds => "<ScanStartTimeInSeconds>",
            Self::ScanStartTimeInMinutes => "<ScanStartTimeInMinutes>",
            Self::BasePeakMz => "<BasePeakMz>",
            Self::BasePeakIntensity => "<BasePeakIntensity>",
            Self::TotalIonCurrent => "<TotalIonCurrent>",
            Self::MsLevel => "<MsLevel>",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TitlePart {
    Keyword(TitleKeyword),
    Literal(TitleLiteral),
}

/// A `titleMaker` template: keywords and literal text, never a free string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleTemplate(Vec<TitlePart>);

impl TitleTemplate {
    pub fn new(parts: Vec<TitlePart>) -> Result<Self, E> {
        if parts.is_empty() {
            return Err(E::Empty);
        }
        Ok(Self(parts))
    }

    #[must_use]
    pub fn parts(&self) -> &[TitlePart] {
        &self.0
    }
}

impl fmt::Display for TitleTemplate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for part in &self.0 {
            match part {
                TitlePart::Keyword(keyword) => f.write_str(keyword.spelling())?,
                TitlePart::Literal(literal) => f.write_str(literal.as_str())?,
            }
        }
        Ok(())
    }
}

/// `include` or `exclude`, the help's `mode=` for selecting filters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionMode {
    Include,
    Exclude,
}

impl SelectionMode {
    const fn spelling(self) -> &'static str {
        match self {
            Self::Include => "include",
            Self::Exclude => "exclude",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Orientation {
    MostIntense,
    LeastIntense,
}

impl Orientation {
    const fn spelling(self) -> &'static str {
        match self {
            Self::MostIntense => "most-intense",
            Self::LeastIntense => "least-intense",
        }
    }
}

/// A `threshold` type with the value that type takes (help lines 296-312).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThresholdCriterion {
    Count(NonZeroU32),
    CountAfterTies(NonZeroU32),
    Absolute(NonNegative),
    BpiRelative(Fraction),
    TicRelative(Fraction),
    TicCutoff(Fraction),
}

impl ThresholdCriterion {
    const fn type_spelling(self) -> &'static str {
        match self {
            Self::Count(_) => "count",
            Self::CountAfterTies(_) => "count-after-ties",
            Self::Absolute(_) => "absolute",
            Self::BpiRelative(_) => "bpi-relative",
            Self::TicRelative(_) => "tic-relative",
            Self::TicCutoff(_) => "tic-cutoff",
        }
    }

    fn value(self) -> String {
        match self {
            Self::Count(count) | Self::CountAfterTies(count) => count.to_string(),
            Self::Absolute(value) => value.to_string(),
            Self::BpiRelative(value) | Self::TicRelative(value) | Self::TicCutoff(value) => {
                value.to_string()
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzToleranceUnit {
    Ppm,
    Mz,
}

/// An m/z tolerance, spelled as the help states it ("PPM or MZ") with no space,
/// so it stays one token inside a `name=` value. Help-derived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzTolerance {
    pub value: Positive,
    pub unit: MzToleranceUnit,
}

impl fmt::Display for MzTolerance {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let unit = match self.unit {
            MzToleranceUnit::Ppm => "PPM",
            MzToleranceUnit::Mz => "MZ",
        };
        write!(f, "{}{unit}", self.value)
    }
}

/// `ppm` or `Da`, as `mzShift` and `demultiplex` spell them ("10ppm or 1Da").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MassUnit {
    Ppm,
    Da,
}

impl MassUnit {
    const fn spelling(self) -> &'static str {
        match self {
            Self::Ppm => "ppm",
            Self::Da => "Da",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrecursorTarget {
    Selected,
    Isolated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZeroSampleMode {
    RemoveExtra,
    /// `addMissing`, or `addMissing=<n>` to cap the flanking zeros.
    AddMissing {
        flanking_zero_count: Option<NonZeroU32>,
    },
}

/// `MS2Deisotope`'s methods, each with only its own fields (help lines 469-479).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeisotopeMethod {
    /// The Markey method at low resolution, with its default tolerance.
    Markey,
    /// `hi_res [mzTol=]`: the grammar nests the tolerance under `hi_res`.
    MarkeyHighResolution { mz_tolerance: Positive },
    Poisson {
        min_charge: NonZeroU32,
        max_charge: NonZeroU32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivationType {
    Etd,
    Cid,
    Sa,
    Hcd,
    Hecid,
    Bird,
    Ecd,
    Irmpd,
    Pd,
    Psd,
    Pqd,
    Sid,
    Sori,
}

impl ActivationType {
    const fn spelling(self) -> &'static str {
        match self {
            Self::Etd => "ETD",
            Self::Cid => "CID",
            Self::Sa => "SA",
            Self::Hcd => "HCD",
            Self::Hecid => "HECID",
            Self::Bird => "BIRD",
            Self::Ecd => "ECD",
            Self::Irmpd => "IRMPD",
            Self::Pd => "PD",
            Self::Psd => "PSD",
            Self::Pqd => "PQD",
            Self::Sid => "SID",
            Self::Sori => "SORI",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalyzerKind {
    Quad,
    Orbi,
    Ft,
    It,
    Tof,
}

impl AnalyzerKind {
    const fn spelling(self) -> &'static str {
        match self {
            Self::Quad => "quad",
            Self::Orbi => "orbi",
            Self::Ft => "FT",
            Self::It => "IT",
            Self::Tof => "TOF",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Polarity {
    Positive,
    Negative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanFilterMatch {
    Exact,
    Contains,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DemultiplexOptimization {
    None,
    OverlapOnly,
}

/// `lockmassRefiner`'s three values, the same in both chains. All three are
/// emitted: the help's defaults (`mzNegIons` = `mz`, `tol` = 1.0) are for the
/// control to prefill, not for the lowering to assume.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lockmass {
    pub mz: Positive,
    pub mz_negative_ions: Positive,
    pub tolerance: Positive,
}

/// The `demultiplex` parameters, every one emitted (help lines 495-499).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Demultiplex {
    pub mass_error: Positive,
    pub mass_error_unit: MassUnit,
    pub nnls_max_iter: NonZeroU32,
    pub nnls_eps: Positive,
    pub no_weighting: bool,
    pub demux_block_extra: NonNegative,
    pub variable_fill: bool,
    pub no_sum_normalize: bool,
    pub optimization: DemultiplexOptimization,
    pub interpolate_rt: bool,
    pub min_window_size: Positive,
    pub remove_non_overlapping_edges: bool,
}

/// The `chargeStatePredictor` parameters (help lines 504-524).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChargeStatePredictor {
    pub override_existing_charge: bool,
    pub max_multiple_charge: u32,
    pub min_multiple_charge: u32,
    pub single_charge_fraction_tic: Fraction,
    /// 0 means no maximum.
    pub max_known_charge: u32,
    pub make_ms2: bool,
}

/// The `turbocharger` parameters (help lines 526-542).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Turbocharger {
    pub min_charge: u32,
    pub max_charge: u32,
    pub precursors_before: u32,
    pub precursors_after: u32,
    pub half_isolation_width: Positive,
    pub default_min_charge: u32,
    pub default_max_charge: u32,
    pub use_vendor_peaks: bool,
}

/// One `--filter` step, in the help's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpectrumStep {
    Index(IntSet),
    Id(Vec<NativeId>),
    MsLevel(IntSet),
    /// 0 means "no charge state" (help line 169).
    ChargeState(IntSet),
    PrecursorRecalculation,
    LockmassRefiner(Lockmass),
    PrecursorRefine,
    /// Bare `peakPicking`: the build's default picker, which no parameter
    /// scopes. Blocked on Thermo RAW, where the same argv runs the vendor
    /// picker (M6.10 S1).
    PeakPickingDefault,
    /// `peakPicking vendor [msLevel=]`. Only first in the chain (help lines
    /// 207-208), and blocked on mzML sources, where it was measured running
    /// the local-maximum picker instead (M6.2).
    PeakPickingVendor {
        ms_levels: Option<IntSet>,
    },
    ScanNumber(IntSet),
    ScanEvent(IntSet),
    /// Emitted in seconds, as the help states the range.
    ScanTime {
        start_seconds: NonNegative,
        end_seconds: NonNegative,
    },
    SortByScanTime,
    StripIt,
    MetadataFixer,
    TitleMaker(TitleTemplate),
    Threshold {
        criterion: ThresholdCriterion,
        orientation: Orientation,
        ms_levels: Option<IntSet>,
    },
    MzWindow {
        low: NonNegative,
        high: NonNegative,
    },
    /// Drops MS1 unless 0.0 is listed (help).
    MzPrecursors {
        mzs: Vec<NonNegative>,
        tolerance: MzTolerance,
        target: PrecursorTarget,
        mode: SelectionMode,
    },
    /// Drops MS1 unless `[0,0]` is listed (help).
    IsolationWindows {
        windows: Vec<(NonNegative, NonNegative)>,
        tolerance: MzTolerance,
        mode: SelectionMode,
    },
    /// Drops MS1 unless 0.0 is listed (help).
    IsolationWidth {
        widths: Vec<NonNegative>,
        tolerance: MzTolerance,
        mode: SelectionMode,
    },
    DefaultArrayLength(IntSet),
    ZeroSamples {
        mode: ZeroSampleMode,
        ms_levels: Option<IntSet>,
    },
    MzPresent {
        mzs: Vec<NonNegative>,
        tolerance: MzTolerance,
        criterion: ThresholdCriterion,
        orientation: Orientation,
        mode: SelectionMode,
    },
    ScanSumming {
        precursor_tolerance: Positive,
        scan_time_tolerance_seconds: Positive,
        ion_mobility_tolerance: Positive,
    },
    ThermoScanFilter {
        match_kind: ScanFilterMatch,
        mode: SelectionMode,
        text: ScanFilterText,
    },
    MzShift {
        shift: Real,
        unit: MassUnit,
        ms_levels: IntSet,
    },
    Ms2Denoise {
        peaks_in_window: NonZeroU32,
        /// 0 means the highest observed mass (help line 460).
        window_width_da: NonNegative,
        multicharge_fragment_relaxation: bool,
    },
    Ms2Deisotope(DeisotopeMethod),
    EtdFilter {
        remove_precursor: bool,
        remove_charge_reduced: bool,
        remove_neutral_loss: bool,
        blanket_removal: bool,
        matching_tolerance: MzTolerance,
    },
    Demultiplex(Demultiplex),
    ChargeStatePredictor(ChargeStatePredictor),
    Turbocharger(Turbocharger),
    Activation {
        kind: ActivationType,
        mode: SelectionMode,
    },
    CollisionEnergy {
        low: NonNegative,
        high: NonNegative,
        mode: SelectionMode,
        accept_non_cid: bool,
        accept_missing_ce: bool,
    },
    Analyzer(AnalyzerKind),
    Polarity(Polarity),
}

/// One `--chromatogramFilter` step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChromatogramStep {
    Index(IntSet),
    LockmassRefiner(Lockmass),
}

/// What a filter step's lowering asks the installed help to declare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterRequirement {
    pub name: &'static str,
    /// Positional slots the argument fills, as the grammar counts them: a list
    /// spelled `[a,b] [c,d]` fills one.
    pub positional_arguments: usize,
    pub named_arguments: Vec<&'static str>,
}

/// One step lowered: the single argv element after `--filter`, and what it needs.
pub(crate) struct LoweredFilter {
    pub(crate) argument: String,
    pub(crate) requirement: FilterRequirement,
}

fn lowered(
    name: &'static str,
    positionals: &[String],
    named: &[(&'static str, String)],
) -> LoweredFilter {
    let mut argument = name.to_owned();
    for positional in positionals {
        argument.push(' ');
        argument.push_str(positional);
    }
    for (key, value) in named {
        argument.push(' ');
        argument.push_str(key);
        argument.push('=');
        argument.push_str(value);
    }
    LoweredFilter {
        argument,
        requirement: FilterRequirement {
            name,
            positional_arguments: positionals.len(),
            named_arguments: named.iter().map(|(key, _)| *key).collect(),
        },
    }
}

fn bracketed<T: fmt::Display>(values: &[T]) -> String {
    let joined: Vec<String> = values.iter().map(ToString::to_string).collect();
    format!("[{}]", joined.join(","))
}

fn ordered(low: impl Into<f64>, high: impl Into<f64>) -> Result<(), E> {
    if low.into() <= high.into() {
        Ok(())
    } else {
        Err(E::UnorderedRange)
    }
}

fn non_empty<T>(values: &[T]) -> Result<(), E> {
    if values.is_empty() {
        Err(E::Empty)
    } else {
        Ok(())
    }
}

fn lockmass(lockmass: &Lockmass) -> LoweredFilter {
    lowered(
        "lockmassRefiner",
        &[],
        &[
            ("mz", lockmass.mz.to_string()),
            ("mzNegIons", lockmass.mz_negative_ions.to_string()),
            ("tol", lockmass.tolerance.to_string()),
        ],
    )
}

impl SpectrumStep {
    /// The checks that need more than one field. Called by
    /// [`StructuredIntent::new`](crate::StructuredIntent::new) for every step,
    /// and public so a caller can attribute a refusal to the step it came from.
    pub fn validate(&self) -> Result<(), E> {
        match self {
            Self::Id(ids) => non_empty(ids),
            Self::PeakPickingVendor {
                ms_levels: Some(levels),
            }
            | Self::Threshold {
                ms_levels: Some(levels),
                ..
            }
            | Self::ZeroSamples {
                ms_levels: Some(levels),
                ..
            }
            | Self::MzShift {
                ms_levels: levels, ..
            } => levels.require_one_interval(),
            Self::ScanTime {
                start_seconds,
                end_seconds,
            } => ordered(start_seconds.get(), end_seconds.get()),
            Self::MzWindow { low, high } => ordered(low.get(), high.get()),
            Self::MzPrecursors { mzs, .. } | Self::MzPresent { mzs, .. } => non_empty(mzs),
            Self::IsolationWindows { windows, .. } => {
                non_empty(windows)?;
                windows
                    .iter()
                    .try_for_each(|(low, high)| ordered(low.get(), high.get()))
            }
            Self::IsolationWidth { widths, .. } => non_empty(widths),
            Self::Ms2Deisotope(DeisotopeMethod::Poisson {
                min_charge,
                max_charge,
            }) => ordered(min_charge.get(), max_charge.get()),
            Self::ChargeStatePredictor(predictor) => {
                ordered(predictor.min_multiple_charge, predictor.max_multiple_charge)
            }
            Self::Turbocharger(turbo) => {
                ordered(turbo.min_charge, turbo.max_charge)?;
                ordered(turbo.default_min_charge, turbo.default_max_charge)
            }
            Self::CollisionEnergy { low, high, .. } => ordered(low.get(), high.get()),
            _ => Ok(()),
        }
    }

    /// The one argv element this step contributes after `--filter`.
    pub(crate) fn lower(&self) -> LoweredFilter {
        match self {
            Self::Index(set) => lowered("index", &[set.to_string()], &[]),
            Self::Id(ids) => {
                let joined: Vec<&str> = ids.iter().map(NativeId::as_str).collect();
                lowered("id", &[joined.join(";")], &[])
            }
            Self::MsLevel(set) => lowered("msLevel", &[set.to_string()], &[]),
            Self::ChargeState(set) => lowered("chargeState", &[set.to_string()], &[]),
            Self::PrecursorRecalculation => lowered("precursorRecalculation", &[], &[]),
            Self::LockmassRefiner(values) => lockmass(values),
            Self::PrecursorRefine => lowered("precursorRefine", &[], &[]),
            Self::PeakPickingDefault => lowered("peakPicking", &[], &[]),
            Self::PeakPickingVendor { ms_levels } => {
                let named: Vec<(&'static str, String)> = ms_levels
                    .iter()
                    .map(|levels| ("msLevel", levels.to_string()))
                    .collect();
                lowered("peakPicking", &["vendor".to_owned()], &named)
            }
            Self::ScanNumber(set) => lowered("scanNumber", &[set.to_string()], &[]),
            Self::ScanEvent(set) => lowered("scanEvent", &[set.to_string()], &[]),
            Self::ScanTime {
                start_seconds,
                end_seconds,
            } => lowered(
                "scanTime",
                &[format!("[{start_seconds},{end_seconds}]")],
                &[],
            ),
            Self::SortByScanTime => lowered("sortByScanTime", &[], &[]),
            Self::StripIt => lowered("stripIT", &[], &[]),
            Self::MetadataFixer => lowered("metadataFixer", &[], &[]),
            Self::TitleMaker(template) => lowered("titleMaker", &[template.to_string()], &[]),
            Self::Threshold {
                criterion,
                orientation,
                ms_levels,
            } => {
                let mut positionals = vec![
                    criterion.type_spelling().to_owned(),
                    criterion.value(),
                    orientation.spelling().to_owned(),
                ];
                positionals.extend(ms_levels.iter().map(ToString::to_string));
                lowered("threshold", &positionals, &[])
            }
            Self::MzWindow { low, high } => lowered("mzWindow", &[format!("[{low},{high}]")], &[]),
            Self::MzPrecursors {
                mzs,
                tolerance,
                target,
                mode,
            } => lowered(
                "mzPrecursors",
                &[bracketed(mzs)],
                &[
                    ("mzTol", tolerance.to_string()),
                    (
                        "target",
                        match target {
                            PrecursorTarget::Selected => "selected",
                            PrecursorTarget::Isolated => "isolated",
                        }
                        .to_owned(),
                    ),
                    ("mode", mode.spelling().to_owned()),
                ],
            ),
            Self::IsolationWindows {
                windows,
                tolerance,
                mode,
            } => {
                let list: Vec<String> = windows
                    .iter()
                    .map(|(low, high)| format!("[{low},{high}]"))
                    .collect();
                lowered(
                    "isolationWindows",
                    &[list.join(" ")],
                    &[
                        ("mzTol", tolerance.to_string()),
                        ("mode", mode.spelling().to_owned()),
                    ],
                )
            }
            Self::IsolationWidth {
                widths,
                tolerance,
                mode,
            } => lowered(
                "isolationWidth",
                &[bracketed(widths)],
                &[
                    ("mzTol", tolerance.to_string()),
                    ("mode", mode.spelling().to_owned()),
                ],
            ),
            Self::DefaultArrayLength(set) => lowered("defaultArrayLength", &[set.to_string()], &[]),
            Self::ZeroSamples { mode, ms_levels } => {
                let mut positionals = vec![match mode {
                    ZeroSampleMode::RemoveExtra => "removeExtra".to_owned(),
                    ZeroSampleMode::AddMissing {
                        flanking_zero_count: None,
                    } => "addMissing".to_owned(),
                    ZeroSampleMode::AddMissing {
                        flanking_zero_count: Some(count),
                    } => format!("addMissing={count}"),
                }];
                positionals.extend(ms_levels.iter().map(ToString::to_string));
                lowered("zeroSamples", &positionals, &[])
            }
            Self::MzPresent {
                mzs,
                tolerance,
                criterion,
                orientation,
                mode,
            } => lowered(
                "mzPresent",
                &[bracketed(mzs)],
                &[
                    ("mzTol", tolerance.to_string()),
                    ("type", criterion.type_spelling().to_owned()),
                    ("threshold", criterion.value()),
                    ("orientation", orientation.spelling().to_owned()),
                    ("mode", mode.spelling().to_owned()),
                ],
            ),
            Self::ScanSumming {
                precursor_tolerance,
                scan_time_tolerance_seconds,
                ion_mobility_tolerance,
            } => lowered(
                "scanSumming",
                &[],
                &[
                    ("precursorTol", precursor_tolerance.to_string()),
                    ("scanTimeTol", scan_time_tolerance_seconds.to_string()),
                    ("ionMobilityTol", ion_mobility_tolerance.to_string()),
                ],
            ),
            Self::ThermoScanFilter {
                match_kind,
                mode,
                text,
            } => lowered(
                "thermoScanFilter",
                &[
                    match match_kind {
                        ScanFilterMatch::Exact => "exact",
                        ScanFilterMatch::Contains => "contains",
                    }
                    .to_owned(),
                    mode.spelling().to_owned(),
                    text.as_str().to_owned(),
                ],
                &[],
            ),
            Self::MzShift {
                shift,
                unit,
                ms_levels,
            } => lowered(
                "mzShift",
                &[format!("{shift}{}", unit.spelling())],
                &[("msLevels", ms_levels.to_string())],
            ),
            Self::Ms2Denoise {
                peaks_in_window,
                window_width_da,
                multicharge_fragment_relaxation,
            } => lowered(
                "MS2Denoise",
                &[
                    peaks_in_window.to_string(),
                    window_width_da.to_string(),
                    multicharge_fragment_relaxation.to_string(),
                ],
                &[],
            ),
            Self::Ms2Deisotope(method) => match method {
                DeisotopeMethod::Markey => lowered("MS2Deisotope", &[], &[]),
                DeisotopeMethod::MarkeyHighResolution { mz_tolerance } => lowered(
                    "MS2Deisotope",
                    &["hi_res".to_owned()],
                    &[("mzTol", mz_tolerance.to_string())],
                ),
                DeisotopeMethod::Poisson {
                    min_charge,
                    max_charge,
                } => lowered(
                    "MS2Deisotope",
                    &["Poisson".to_owned()],
                    &[
                        ("minCharge", min_charge.to_string()),
                        ("maxCharge", max_charge.to_string()),
                    ],
                ),
            },
            Self::EtdFilter {
                remove_precursor,
                remove_charge_reduced,
                remove_neutral_loss,
                blanket_removal,
                matching_tolerance,
            } => lowered(
                "ETDFilter",
                &[
                    remove_precursor.to_string(),
                    remove_charge_reduced.to_string(),
                    remove_neutral_loss.to_string(),
                    blanket_removal.to_string(),
                    matching_tolerance.to_string(),
                ],
                &[],
            ),
            Self::Demultiplex(demux) => lowered(
                "demultiplex",
                &[],
                &[
                    (
                        "massError",
                        format!("{}{}", demux.mass_error, demux.mass_error_unit.spelling()),
                    ),
                    ("nnlsMaxIter", demux.nnls_max_iter.to_string()),
                    ("nnlsEps", demux.nnls_eps.to_string()),
                    ("noWeighting", demux.no_weighting.to_string()),
                    ("demuxBlockExtra", demux.demux_block_extra.to_string()),
                    ("variableFill", demux.variable_fill.to_string()),
                    ("noSumNormalize", demux.no_sum_normalize.to_string()),
                    (
                        "optimization",
                        match demux.optimization {
                            DemultiplexOptimization::None => "none",
                            DemultiplexOptimization::OverlapOnly => "overlap_only",
                        }
                        .to_owned(),
                    ),
                    ("interpolateRT", demux.interpolate_rt.to_string()),
                    ("minWindowSize", demux.min_window_size.to_string()),
                    (
                        "removeNonOverlappingEdges",
                        demux.remove_non_overlapping_edges.to_string(),
                    ),
                ],
            ),
            Self::ChargeStatePredictor(predictor) => lowered(
                "chargeStatePredictor",
                &[],
                &[
                    (
                        "overrideExistingCharge",
                        predictor.override_existing_charge.to_string(),
                    ),
                    (
                        "maxMultipleCharge",
                        predictor.max_multiple_charge.to_string(),
                    ),
                    (
                        "minMultipleCharge",
                        predictor.min_multiple_charge.to_string(),
                    ),
                    (
                        "singleChargeFractionTIC",
                        predictor.single_charge_fraction_tic.to_string(),
                    ),
                    ("maxKnownCharge", predictor.max_known_charge.to_string()),
                    ("makeMS2", predictor.make_ms2.to_string()),
                ],
            ),
            Self::Turbocharger(turbo) => lowered(
                "turbocharger",
                &[],
                &[
                    ("minCharge", turbo.min_charge.to_string()),
                    ("maxCharge", turbo.max_charge.to_string()),
                    ("precursorsBefore", turbo.precursors_before.to_string()),
                    ("precursorsAfter", turbo.precursors_after.to_string()),
                    ("halfIsoWidth", turbo.half_isolation_width.to_string()),
                    ("defaultMinCharge", turbo.default_min_charge.to_string()),
                    ("defaultMaxCharge", turbo.default_max_charge.to_string()),
                    ("useVendorPeaks", turbo.use_vendor_peaks.to_string()),
                ],
            ),
            Self::Activation { kind, mode } => lowered(
                "activation",
                &[kind.spelling().to_owned()],
                &[("mode", mode.spelling().to_owned())],
            ),
            Self::CollisionEnergy {
                low,
                high,
                mode,
                accept_non_cid,
                accept_missing_ce,
            } => lowered(
                "collisionEnergy",
                &[],
                &[
                    ("low", low.to_string()),
                    ("high", high.to_string()),
                    ("mode", mode.spelling().to_owned()),
                    ("acceptNonCID", accept_non_cid.to_string()),
                    ("acceptMissingCE", accept_missing_ce.to_string()),
                ],
            ),
            Self::Analyzer(kind) => lowered("analyzer", &[kind.spelling().to_owned()], &[]),
            Self::Polarity(polarity) => lowered(
                "polarity",
                &[match polarity {
                    Polarity::Positive => "positive",
                    Polarity::Negative => "negative",
                }
                .to_owned()],
                &[],
            ),
        }
    }
}

impl ChromatogramStep {
    pub fn validate(&self) -> Result<(), E> {
        match self {
            Self::Index(_) | Self::LockmassRefiner(_) => Ok(()),
        }
    }

    pub(crate) fn lower(&self) -> LoweredFilter {
        match self {
            Self::Index(set) => lowered("index", &[set.to_string()], &[]),
            Self::LockmassRefiner(values) => lockmass(values),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(intervals: &[(u32, Option<u32>)]) -> IntSet {
        IntSet::new(intervals.iter().copied()).expect("valid set")
    }

    #[test]
    fn an_integer_set_has_one_canonical_spelling() {
        assert_eq!(set(&[(1, Some(1))]), IntSet::single(1));
        assert_eq!(set(&[(1, Some(1))]).to_string(), "1");
        assert_eq!(
            set(&[(7, None), (5, Some(5)), (1, Some(2)), (3, Some(3))]).to_string(),
            "1-3 5 7-"
        );
        // Overlap, containment and an open interval absorbing what follows.
        assert_eq!(set(&[(1, Some(10)), (2, Some(3))]).to_string(), "1-10");
        assert_eq!(
            set(&[(2, None), (4, Some(9)), (2, Some(3))]).to_string(),
            "2-"
        );
        assert_eq!(
            set(&[(0, Some(u32::MAX)), (5, Some(6))]).intervals().len(),
            1
        );
    }

    #[test]
    fn an_integer_set_refuses_emptiness_and_reversed_intervals() {
        assert_eq!(IntSet::new([]), Err(E::Empty));
        assert_eq!(IntSet::new([(3, Some(2))]), Err(E::UnorderedRange));
    }

    #[test]
    fn numbers_are_finite_and_their_bounds_are_held() {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(Real::new(bad), Err(E::NotFinite));
            assert_eq!(Positive::new(bad), Err(E::NotFinite));
        }
        assert_eq!(Positive::new(0.0), Err(E::NotPositive));
        assert_eq!(Positive::new(-1.0), Err(E::NotPositive));
        assert_eq!(NonNegative::new(-0.1), Err(E::Negative));
        assert_eq!(Fraction::new(1.5), Err(E::NotAFraction));
        assert_eq!(Fraction::new(1.0).map(Fraction::get), Ok(1.0));
        // The two zeros are one value and one spelling.
        assert_eq!(NonNegative::new(-0.0), NonNegative::new(0.0));
        assert_eq!(Real::new(-0.0).expect("zero").to_string(), "0");
        assert_eq!(
            Positive::new(1e-10).expect("small").to_string(),
            "0.0000000001"
        );
    }

    #[test]
    fn text_fields_refuse_what_would_split_or_change_them() {
        assert!(NativeId::new("controllerType=0 controllerNumber=1 scan=1").is_ok());
        for bad in [
            "",
            "a;b",
            " a",
            "a ",
            "a\u{20}\u{20}b",
            "a\tb",
            "a\nb",
            "a\u{a0}b",
        ] {
            assert!(NativeId::new(bad).is_err(), "{bad:?}");
        }
        assert!(ScanFilterText::new("FTMS + p NSI Full ms [350.00-1800.00]").is_ok());
        assert_eq!(ScanFilterText::new("a\u{7}b"), Err(E::ForbiddenCharacter));
        assert!(TitleLiteral::new(".").is_ok());
        for bad in ["a b", "<Index>", "a>", ""] {
            assert!(TitleLiteral::new(bad).is_err(), "{bad:?}");
        }
        assert_eq!(TitleTemplate::new(Vec::new()), Err(E::Empty));
    }

    #[test]
    fn a_title_template_renders_keywords_and_literals_in_order() {
        let dot = || TitlePart::Literal(TitleLiteral::new(".").expect("literal"));
        let template = TitleTemplate::new(vec![
            TitlePart::Keyword(TitleKeyword::RunId),
            dot(),
            TitlePart::Keyword(TitleKeyword::ScanNumber),
            dot(),
            TitlePart::Keyword(TitleKeyword::ChargeState),
        ])
        .expect("template");
        assert_eq!(
            SpectrumStep::TitleMaker(template).lower().argument,
            "titleMaker <RunId>.<ScanNumber>.<ChargeState>"
        );
    }

    #[test]
    fn a_set_inside_a_named_or_trailing_value_is_one_interval() {
        let two = set(&[(1, Some(1)), (3, Some(3))]);
        for step in [
            SpectrumStep::PeakPickingVendor {
                ms_levels: Some(two.clone()),
            },
            SpectrumStep::MzShift {
                shift: Real::new(5.0).expect("real"),
                unit: MassUnit::Ppm,
                ms_levels: two.clone(),
            },
            SpectrumStep::Threshold {
                criterion: ThresholdCriterion::Count(NonZeroU32::MIN),
                orientation: Orientation::MostIntense,
                ms_levels: Some(two.clone()),
            },
            SpectrumStep::ZeroSamples {
                mode: ZeroSampleMode::RemoveExtra,
                ms_levels: Some(two.clone()),
            },
        ] {
            assert_eq!(step.validate(), Err(E::SetNotOneInterval), "{step:?}");
        }
        // As a step's whole argument, several intervals are the help's own form.
        assert_eq!(SpectrumStep::ScanEvent(two.clone()).validate(), Ok(()));
        assert_eq!(
            SpectrumStep::ScanEvent(two).lower().argument,
            "scanEvent 1 3"
        );
    }

    #[test]
    fn ranges_are_ordered_and_lists_are_not_empty() {
        let n = |value: f64| NonNegative::new(value).expect("non-negative");
        let tolerance = MzTolerance {
            value: Positive::new(10.0).expect("positive"),
            unit: MzToleranceUnit::Ppm,
        };
        for step in [
            SpectrumStep::MzWindow {
                low: n(300.0),
                high: n(100.0),
            },
            SpectrumStep::ScanTime {
                start_seconds: n(2.0),
                end_seconds: n(1.0),
            },
            SpectrumStep::IsolationWindows {
                windows: vec![(n(5.0), n(4.0))],
                tolerance,
                mode: SelectionMode::Include,
            },
            SpectrumStep::CollisionEnergy {
                low: n(30.0),
                high: n(20.0),
                mode: SelectionMode::Include,
                accept_non_cid: true,
                accept_missing_ce: false,
            },
            SpectrumStep::Ms2Deisotope(DeisotopeMethod::Poisson {
                min_charge: NonZeroU32::new(3).expect("3"),
                max_charge: NonZeroU32::MIN,
            }),
        ] {
            assert_eq!(step.validate(), Err(E::UnorderedRange), "{step:?}");
        }
        for step in [
            SpectrumStep::Id(Vec::new()),
            SpectrumStep::MzPrecursors {
                mzs: Vec::new(),
                tolerance,
                target: PrecursorTarget::Selected,
                mode: SelectionMode::Include,
            },
            SpectrumStep::IsolationWidth {
                widths: Vec::new(),
                tolerance,
                mode: SelectionMode::Include,
            },
        ] {
            assert_eq!(step.validate(), Err(E::Empty), "{step:?}");
        }
        // Equal ends are a range of one: `[0,0]` is how isolationWindows keeps MS1.
        assert_eq!(
            SpectrumStep::IsolationWindows {
                windows: vec![(n(0.0), n(0.0)), (n(400.0), n(425.0))],
                tolerance,
                mode: SelectionMode::Include,
            }
            .lower()
            .argument,
            "isolationWindows [0,0] [400,425] mzTol=10PPM mode=include"
        );
    }

    /// Every named value renders without whitespace, so the provider's split on
    /// whitespace leaves each `name=value` one token.
    #[test]
    fn named_values_never_contain_whitespace() {
        let p = |value: f64| Positive::new(value).expect("positive");
        let n = |value: f64| NonNegative::new(value).expect("non-negative");
        let tolerance = MzTolerance {
            value: p(0.5),
            unit: MzToleranceUnit::Mz,
        };
        let steps = [
            SpectrumStep::PeakPickingVendor {
                ms_levels: Some(set(&[(1, Some(2))])),
            },
            SpectrumStep::MzPresent {
                mzs: vec![n(100.0), n(405.6)],
                tolerance,
                criterion: ThresholdCriterion::Count(NonZeroU32::new(10_000).expect("count")),
                orientation: Orientation::MostIntense,
                mode: SelectionMode::Exclude,
            },
            SpectrumStep::Demultiplex(Demultiplex {
                mass_error: p(10.0),
                mass_error_unit: MassUnit::Ppm,
                nnls_max_iter: NonZeroU32::new(50).expect("50"),
                nnls_eps: p(1e-10),
                no_weighting: false,
                demux_block_extra: n(0.0),
                variable_fill: false,
                no_sum_normalize: false,
                optimization: DemultiplexOptimization::OverlapOnly,
                interpolate_rt: true,
                min_window_size: p(0.2),
                remove_non_overlapping_edges: false,
            }),
            SpectrumStep::MzShift {
                shift: Real::new(-5.0).expect("real"),
                unit: MassUnit::Ppm,
                ms_levels: set(&[(2, None)]),
            },
        ];
        for step in steps {
            let lowered = step.lower();
            let named_tokens: Vec<&str> = lowered
                .argument
                .split(' ')
                .filter(|token| {
                    token
                        .split_once('=')
                        .is_some_and(|(key, _)| lowered.requirement.named_arguments.contains(&key))
                })
                .collect();
            assert_eq!(
                named_tokens.len(),
                lowered.requirement.named_arguments.len(),
                "{}",
                lowered.argument
            );
        }
    }

    #[test]
    fn steps_lower_to_the_help_spelling() {
        let p = |value: f64| Positive::new(value).expect("positive");
        let n = |value: f64| NonNegative::new(value).expect("non-negative");
        let cases: Vec<(SpectrumStep, &str)> = vec![
            (SpectrumStep::PeakPickingDefault, "peakPicking"),
            (
                SpectrumStep::PeakPickingVendor { ms_levels: None },
                "peakPicking vendor",
            ),
            (
                SpectrumStep::PeakPickingVendor {
                    ms_levels: Some(set(&[(2, None)])),
                },
                "peakPicking vendor msLevel=2-",
            ),
            (
                SpectrumStep::Threshold {
                    criterion: ThresholdCriterion::BpiRelative(
                        Fraction::new(0.75).expect("fraction"),
                    ),
                    orientation: Orientation::MostIntense,
                    ms_levels: Some(set(&[(2, Some(3))])),
                },
                "threshold bpi-relative 0.75 most-intense 2-3",
            ),
            (
                SpectrumStep::ZeroSamples {
                    mode: ZeroSampleMode::AddMissing {
                        flanking_zero_count: NonZeroU32::new(5),
                    },
                    ms_levels: None,
                },
                "zeroSamples addMissing=5",
            ),
            (
                SpectrumStep::ThermoScanFilter {
                    match_kind: ScanFilterMatch::Contains,
                    mode: SelectionMode::Exclude,
                    text: ScanFilterText::new("ITMS + c NSI").expect("text"),
                },
                "thermoScanFilter contains exclude ITMS + c NSI",
            ),
            (
                SpectrumStep::Id(vec![
                    NativeId::new("scan=1").expect("id"),
                    NativeId::new("scan=7").expect("id"),
                ]),
                "id scan=1;scan=7",
            ),
            (
                SpectrumStep::MzPrecursors {
                    mzs: vec![n(0.0), n(123.4)],
                    tolerance: MzTolerance {
                        value: p(5.0),
                        unit: MzToleranceUnit::Ppm,
                    },
                    target: PrecursorTarget::Isolated,
                    mode: SelectionMode::Include,
                },
                "mzPrecursors [0,123.4] mzTol=5PPM target=isolated mode=include",
            ),
            (
                SpectrumStep::Ms2Deisotope(DeisotopeMethod::MarkeyHighResolution {
                    mz_tolerance: p(0.01),
                }),
                "MS2Deisotope hi_res mzTol=0.01",
            ),
            (
                SpectrumStep::LockmassRefiner(Lockmass {
                    mz: p(556.2771),
                    mz_negative_ions: p(554.2615),
                    tolerance: p(1.0),
                }),
                "lockmassRefiner mz=556.2771 mzNegIons=554.2615 tol=1",
            ),
            (SpectrumStep::Analyzer(AnalyzerKind::Ft), "analyzer FT"),
            (SpectrumStep::StripIt, "stripIT"),
        ];
        for (step, expected) in cases {
            assert_eq!(step.validate(), Ok(()), "{step:?}");
            assert_eq!(step.lower().argument, expected);
        }
        assert_eq!(
            ChromatogramStep::Index(set(&[(0, Some(4))]))
                .lower()
                .argument,
            "index 0-4"
        );
    }
}
