//! A viewing-only mzML 1.1 reader, owned by the project (ADR 0056).
//!
//! A sibling of the conversion-integrity inspector in `mzml.rs`, not a part of
//! it. It reuses that module's byte-counting reader, limits and refusal of a
//! `DOCTYPE` or a custom entity, and the inspector stays decode-free: only this
//! module ever base64-decodes or inflates an array, and only the m/z and
//! intensity arrays of one selected spectrum.
//!
//! Two reads, and nothing else:
//!
//! - [`read_spectrum_table`] reads every spectrum's metadata, decodes no array,
//!   and records each spectrum's byte offset. No `indexList` is trusted. The
//!   same pass keeps the run-level metadata ([`MzmlMetadata`]) and counts the
//!   stored chromatograms, so [`MzmlSpectrumTable::run_summary`] needs no
//!   second read.
//! - [`read_selected_spectrum`] reads one spectrum from the offset its table
//!   recorded, checks that it landed on the spectrum the table describes, and
//!   decodes its two arrays under absolute caps checked before any buffer is
//!   reserved.
//!
//! Names resolve by namespace, never by literal qualified name, so a
//! namespace-prefixed document reads like its unprefixed form. Every refusal is
//! typed, and nothing is skipped, guessed or computed from the arrays.
//!
//! Polarity, charge and the run-level metadata are read without refusing, and
//! the open stands as it did before they were read. A polarity or charge
//! stated two ways, or in a form that cannot be read, is not reported.
//! Metadata parameters are carried as stated, in document order, and never
//! judged, so conflicting ones are all kept.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use flate2::{Decompress, FlushDecompress, Status};
use quick_xml::NsReader;
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::name::{Namespace, NamespaceResolver, PrefixDeclaration, ResolveResult};
use thiserror::Error;

use crate::fs_guard;
use crate::mzml::{
    BoundedReader, CapturedAttributes, MzmlLimitKind, MzmlMalformedKind, MzmlScanError,
    MzmlScanLimits, UnsafeXmlKind, attribute_value, capture_attributes, is_predefined_reference,
    map_xml_error, parse_u64_decimal,
};
use crate::preview::{MsLevelBucket, MsLevelCount, SpectrumIdentity};

/// The most points one decoded array may hold, whatever the file declares.
pub const MAX_DECODED_ARRAY_POINTS: u64 = 1 << 23;
/// The most decoded bytes one array may hold, at its stored width.
pub const MAX_DECODED_ARRAY_BYTES: u64 = 64 * 1024 * 1024;
/// The most decoded bytes one spectrum may hold, across its two arrays.
pub const MAX_DECODED_SPECTRUM_BYTES: u64 = 128 * 1024 * 1024;
/// The most bytes the run-level metadata may keep, counting every param
/// group's parameters and 64 bytes for each kept item. Above it the metadata
/// is not reported; the table stands.
pub const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
/// What each kept metadata element, attribute and parameter costs on top of
/// its text, so that many small items are bounded as well as a few long ones.
const METADATA_ITEM_BYTES: usize = 64;

const MZML_NAMESPACE: &[u8] = b"http://psi.hupo.org/ms/mzml";
const XSI_NAMESPACE: &[u8] = b"http://www.w3.org/2001/XMLSchema-instance";

// Retained by identity for the whole table, so bounded rather than streamed.
// Real documents declare a handful of groups with a few terms each.
const MAX_PARAM_GROUPS: usize = 1024;
const MAX_TERMS_PER_PARAM_GROUP: usize = 1024;
// One selected spectrum keeps every precursor; MSX acquisitions carry about ten.
const MAX_PRECURSORS_PER_SPECTRUM: u32 = 4096;

/// A limit of this reader beyond the inspector's [`MzmlScanLimits`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderLimitKind {
    ParamGroups,
    TermsPerParamGroup,
    PrecursorsPerSpectrum,
}

impl ReaderLimitKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::ParamGroups => "param_groups",
            Self::TermsPerParamGroup => "terms_per_param_group",
            Self::PrecursorsPerSpectrum => "precursors_per_spectrum",
        }
    }
}

/// A value every table row requires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequiredValue {
    Index,
    NativeId,
    MsLevel,
    ScanStartTime,
    BasePeakMz,
    BasePeakIntensity,
    TotalIonCurrent,
}

impl RequiredValue {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Index => "index",
            Self::NativeId => "native_id",
            Self::MsLevel => "ms_level",
            Self::ScanStartTime => "scan_start_time",
            Self::BasePeakMz => "base_peak_mz",
            Self::BasePeakIntensity => "base_peak_intensity",
            Self::TotalIonCurrent => "total_ion_current",
        }
    }
}

/// Why the whole spectrum table, and with it the open, was refused. No variant
/// contains a path or document text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum MzmlOpenError {
    #[error("the mzML document could not be read: {0}")]
    Scan(#[from] MzmlScanError),
    #[error("the document is not mzML 1.1")]
    NotMzml11,
    #[error("the document does not declare UTF-8")]
    NotUtf8,
    #[error("a referenceableParamGroupRef names a group the document does not define")]
    UndefinedParamGroup,
    #[error("a referenceableParamGroup has no id or repeats one")]
    AmbiguousParamGroup,
    #[error("a spectrum has more than one scan")]
    MultipleScans,
    #[error("a scan start time declares a unit other than seconds or minutes")]
    UnsupportedRetentionTimeUnit,
    #[error("one term is stated twice with different values")]
    ConflictingTerm,
    #[error("a spectrum states both centroid and profile")]
    ConflictingRepresentation,
    #[error("a spectrum is missing a value the table requires")]
    MissingRequiredValue(RequiredValue),
    #[error("spectrum indices do not run consecutively from zero")]
    IndexOutOfSequence,
    #[error("the document exceeded a reader limit")]
    ReaderLimit(ReaderLimitKind),
}

impl MzmlOpenError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Scan(error) => error.stable_id(),
            Self::NotMzml11 => "not_mzml_1_1",
            Self::NotUtf8 => "not_utf8",
            Self::UndefinedParamGroup => "undefined_param_group",
            Self::AmbiguousParamGroup => "ambiguous_param_group",
            Self::MultipleScans => "multiple_scans",
            Self::UnsupportedRetentionTimeUnit => "unsupported_retention_time_unit",
            Self::ConflictingTerm => "conflicting_term",
            Self::ConflictingRepresentation => "conflicting_representation",
            Self::MissingRequiredValue(_) => "missing_required_value",
            Self::IndexOutOfSequence => "index_out_of_sequence",
            Self::ReaderLimit(kind) => kind.stable_id(),
        }
    }
}

/// The two arrays a selected spectrum decodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrayRole {
    /// The array carrying MS:1000514.
    Mz,
    /// The array carrying MS:1000515.
    Intensity,
}

impl ArrayRole {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Mz => "mz",
            Self::Intensity => "intensity",
        }
    }
}

/// Why one array of a selected spectrum was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrayProblem {
    DataTypeMissing,
    DataTypeStatedTwice,
    /// A 16-bit float or a string array.
    DataTypeUnsupported,
    CompressionMissing,
    CompressionStatedTwice,
    /// MS-Numpress, with or without zlib (MS:1002312–1002314, MS:1002746–1002748).
    Numpress,
    /// Truncation and prediction (MS:1003088–1003090).
    TruncationOrPrediction,
    /// A compression term this reader does not know.
    CompressionUnrecognized,
    ConflictingTerm,
    LengthNotDeclared,
    /// The declared length is above [`MAX_DECODED_ARRAY_POINTS`].
    PointCapExceeded,
    /// The declared bytes are above [`MAX_DECODED_ARRAY_BYTES`].
    ArrayByteCapExceeded,
    /// The spectrum's declared bytes are above [`MAX_DECODED_SPECTRUM_BYTES`].
    SpectrumByteCapExceeded,
    /// The base64 text is longer than the declared length allows.
    EncodedTextOverBound,
    CorruptBase64,
    CorruptZlib,
    DecodedLongerThanDeclared,
    DecodedShorterThanDeclared,
    NonFiniteValue,
    /// A 64-bit integer that `f64` cannot hold exactly.
    IntegerNotExact,
    /// The allocator refused a reservation the caps allowed.
    AllocationRefused,
    /// The role term's `unitAccession` is not an accession.
    UnitNotAnAccession,
}

impl ArrayProblem {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::DataTypeMissing => "data_type_missing",
            Self::DataTypeStatedTwice => "data_type_stated_twice",
            Self::DataTypeUnsupported => "data_type_unsupported",
            Self::CompressionMissing => "compression_missing",
            Self::CompressionStatedTwice => "compression_stated_twice",
            Self::Numpress => "numpress",
            Self::TruncationOrPrediction => "truncation_or_prediction",
            Self::CompressionUnrecognized => "compression_unrecognized",
            Self::ConflictingTerm => "conflicting_term",
            Self::LengthNotDeclared => "length_not_declared",
            Self::PointCapExceeded => "point_cap_exceeded",
            Self::ArrayByteCapExceeded => "array_byte_cap_exceeded",
            Self::SpectrumByteCapExceeded => "spectrum_byte_cap_exceeded",
            Self::EncodedTextOverBound => "encoded_text_over_bound",
            Self::CorruptBase64 => "corrupt_base64",
            Self::CorruptZlib => "corrupt_zlib",
            Self::DecodedLongerThanDeclared => "decoded_longer_than_declared",
            Self::DecodedShorterThanDeclared => "decoded_shorter_than_declared",
            Self::NonFiniteValue => "non_finite_value",
            Self::IntegerNotExact => "integer_not_exact",
            Self::AllocationRefused => "allocation_refused",
            Self::UnitNotAnAccession => "unit_not_an_accession",
        }
    }
}

/// Why one selected spectrum was refused. The open and every other spectrum
/// stand.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum MzmlSpectrumError {
    #[error("the table has no spectrum at that index")]
    NotInTable,
    #[error("the spectrum could not be read: {0}")]
    Document(MzmlScanError),
    #[error("the spectrum at the recorded offset is not the one the table recorded")]
    NotAsRecorded,
    #[error("the spectrum's {} array is missing", .0.stable_id())]
    MissingArray(ArrayRole),
    #[error("the spectrum has more than one {} array", .0.stable_id())]
    DuplicateArray(ArrayRole),
    #[error("one array carries both the m/z and the intensity term")]
    ArrayWithBothRoles,
    #[error("an array states a term after its payload")]
    TermAfterPayload,
    #[error("the m/z and intensity arrays have different lengths")]
    ArrayLengthsDiffer,
    #[error("the {} array was refused: {}", role.stable_id(), problem.stable_id())]
    Array {
        role: ArrayRole,
        problem: ArrayProblem,
    },
}

impl MzmlSpectrumError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotInTable => "not_in_table",
            Self::Document(error) => error.stable_id(),
            Self::NotAsRecorded => "not_as_recorded",
            Self::MissingArray(_) => "missing_array",
            Self::DuplicateArray(_) => "duplicate_array",
            Self::ArrayWithBothRoles => "array_with_both_roles",
            Self::TermAfterPayload => "term_after_payload",
            Self::ArrayLengthsDiffer => "array_lengths_differ",
            Self::Array { problem, .. } => problem.stable_id(),
        }
    }
}

/// The representation a spectrum declares (MS:1000127 / MS:1000128).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzmlRepresentation {
    Centroid,
    Profile,
    NotDeclared,
}

/// The unit a scan start time declares. Nothing converts between them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionTimeUnit {
    /// UO:0000010.
    Second,
    /// UO:0000031 or MS:1000038.
    Minute,
    NotDeclared,
}

/// A scan start time with the unit it was stated in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MzmlRetentionTime {
    value: f64,
    unit: RetentionTimeUnit,
}

impl MzmlRetentionTime {
    #[must_use]
    pub const fn value(self) -> f64 {
        self.value
    }

    #[must_use]
    pub const fn unit(self) -> RetentionTimeUnit {
        self.unit
    }
}

/// A fact a spectrum may declare, read without refusing. Only `Value` carries
/// one; every other state is not reported, with its reason, and nothing is
/// guessed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MzmlDeclared<T> {
    Value(T),
    #[default]
    NotDeclared,
    /// Stated more than once, counting param groups, with values that differ.
    Conflicting,
    /// Stated in a form this reader cannot read, such as a charge that is not
    /// an integer. It wins over `Conflicting`, so the reason does not depend
    /// on the order of the statements.
    Unreadable,
}

impl<T: PartialEq> MzmlDeclared<T> {
    /// Both statements of one fact together.
    fn and(self, other: Self) -> Self {
        match (self, other) {
            (Self::NotDeclared, other) | (other, Self::NotDeclared) => other,
            (Self::Unreadable, _) | (_, Self::Unreadable) => Self::Unreadable,
            (Self::Conflicting, _) | (_, Self::Conflicting) => Self::Conflicting,
            (Self::Value(left), Self::Value(right)) if left == right => Self::Value(left),
            (Self::Value(_), Self::Value(_)) => Self::Conflicting,
        }
    }
}

/// The scan polarity a spectrum declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzmlPolarity {
    /// MS:1000130.
    Positive,
    /// MS:1000129.
    Negative,
}

/// One precursor's first selected ion. Either value may be unstated, and an
/// unstated value is never zero.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MzmlPrecursor {
    selected_ion_mz: Option<f64>,
    selected_ion_intensity: Option<f64>,
    charge: MzmlDeclared<i32>,
}

impl MzmlPrecursor {
    #[must_use]
    pub const fn selected_ion_mz(self) -> Option<f64> {
        self.selected_ion_mz
    }

    #[must_use]
    pub const fn selected_ion_intensity(self) -> Option<f64> {
        self.selected_ion_intensity
    }

    /// MS:1000041 on the first selected ion, as the file states it.
    #[must_use]
    pub const fn charge(self) -> MzmlDeclared<i32> {
        self.charge
    }
}

/// One spectrum's metadata, as a table row and as a selected spectrum states
/// it. Read from the spectrum's own terms and its param groups; nothing is
/// derived from an array.
#[derive(Debug, Clone, PartialEq)]
pub struct MzmlSpectrumRow {
    identity: SpectrumIdentity,
    ms_level: u32,
    representation: MzmlRepresentation,
    polarity: MzmlDeclared<MzmlPolarity>,
    retention_time: MzmlRetentionTime,
    base_peak_mz: f64,
    base_peak_intensity: f64,
    total_ion_current: f64,
    lowest_observed_mz: Option<f64>,
    highest_observed_mz: Option<f64>,
    default_array_length: Option<u64>,
    precursor_count: u32,
    first_precursor: Option<MzmlPrecursor>,
}

impl MzmlSpectrumRow {
    /// Index, native ID (sensitive), and a scan number taken only from `scan=N`.
    #[must_use]
    pub const fn identity(&self) -> &SpectrumIdentity {
        &self.identity
    }

    #[must_use]
    pub const fn ms_level(&self) -> u32 {
        self.ms_level
    }

    #[must_use]
    pub const fn representation(&self) -> MzmlRepresentation {
        self.representation
    }

    /// From the spectrum's own terms and its param groups; a polarity stated
    /// only inside its scan is not the spectrum's, and reads as `NotDeclared`.
    #[must_use]
    pub const fn polarity(&self) -> MzmlDeclared<MzmlPolarity> {
        self.polarity
    }

    #[must_use]
    pub const fn retention_time(&self) -> MzmlRetentionTime {
        self.retention_time
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

    /// MS:1000528, when the spectrum states it.
    #[must_use]
    pub const fn lowest_observed_mz(&self) -> Option<f64> {
        self.lowest_observed_mz
    }

    /// MS:1000527, when the spectrum states it.
    #[must_use]
    pub const fn highest_observed_mz(&self) -> Option<f64> {
        self.highest_observed_mz
    }

    /// `defaultArrayLength`, when the spectrum states it.
    #[must_use]
    pub const fn default_array_length(&self) -> Option<u64> {
        self.default_array_length
    }

    #[must_use]
    pub const fn precursor_count(&self) -> u32 {
        self.precursor_count
    }

    /// The first precursor, which is what the table's one precursor column shows.
    #[must_use]
    pub const fn first_precursor(&self) -> Option<MzmlPrecursor> {
        self.first_precursor
    }

    fn native_id(&self) -> Option<&str> {
        self.identity
            .representations()
            .first()
            .map(|representation| representation.sensitive_raw())
    }
}

/// The unit an array's role term declares, by accession.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArrayUnit {
    Declared(String),
    NotDeclared,
}

/// A stored binary data type. Every one widens to `f64` exactly, or is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryDataType {
    Float32,
    Float64,
    Integer32,
    Integer64,
}

impl BinaryDataType {
    const fn width(self) -> usize {
        match self {
            Self::Float32 | Self::Integer32 => 4,
            Self::Float64 | Self::Integer64 => 8,
        }
    }
}

/// One decoded array: the stored values widened to `f64`, with the unit and
/// width they were stored with.
#[derive(Clone, PartialEq)]
pub struct MzmlArray {
    pub(crate) values: Vec<f64>,
    pub(crate) unit: ArrayUnit,
    pub(crate) stored_as: Option<BinaryDataType>,
}

impl MzmlArray {
    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    #[must_use]
    pub const fn unit(&self) -> &ArrayUnit {
        &self.unit
    }

    /// `None` only for an array the spectrum omits at declared length zero.
    #[must_use]
    pub const fn stored_as(&self) -> Option<BinaryDataType> {
        self.stored_as
    }

    fn absent() -> Self {
        Self {
            values: Vec::new(),
            unit: ArrayUnit::NotDeclared,
            stored_as: None,
        }
    }
}

impl fmt::Debug for MzmlArray {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MzmlArray")
            .field("len", &self.values.len())
            .field("unit", &self.unit)
            .field("stored_as", &self.stored_as)
            .finish()
    }
}

/// One selected spectrum: its metadata, every precursor, and its two arrays.
#[derive(Debug, Clone, PartialEq)]
pub struct MzmlSelectedSpectrum {
    pub(crate) row: MzmlSpectrumRow,
    pub(crate) precursors: Vec<MzmlPrecursor>,
    pub(crate) mz: MzmlArray,
    pub(crate) intensity: MzmlArray,
}

impl MzmlSelectedSpectrum {
    #[must_use]
    pub const fn row(&self) -> &MzmlSpectrumRow {
        &self.row
    }

    #[must_use]
    pub fn precursors(&self) -> &[MzmlPrecursor] {
        &self.precursors
    }

    #[must_use]
    pub const fn mz(&self) -> &MzmlArray {
        &self.mz
    }

    #[must_use]
    pub const fn intensity(&self) -> &MzmlArray {
        &self.intensity
    }
}

/// The mzML element a metadata element was read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzmlMetadataKind {
    /// `fileDescription/fileContent`.
    FileContent,
    /// `fileDescription/sourceFileList/sourceFile`.
    SourceFile,
    /// `fileDescription/contact`.
    Contact,
    /// `sampleList/sample`.
    Sample,
    /// `softwareList/software`.
    Software,
    /// `instrumentConfigurationList/instrumentConfiguration`.
    InstrumentConfiguration,
    /// A `componentList/source` of the instrument configuration before it.
    Source,
    /// A `componentList/analyzer` of the instrument configuration before it.
    Analyzer,
    /// A `componentList/detector` of the instrument configuration before it.
    Detector,
    /// `dataProcessingList/dataProcessing`.
    DataProcessing,
    /// A `processingMethod` of the data processing before it.
    ProcessingMethod,
    /// The `run` element: its own attributes and parameters.
    Run,
}

/// One parameter as a metadata element states it: a `cvParam` or a
/// `userParam`. The accession and unit accession are kept only as `PREFIX:ID`
/// (the rule an array's unit follows); any other text, and an empty value, is
/// not reported. The name and value are the file's, unchecked, and may be
/// sensitive. `unitName`, `unitCvRef` and `type` are not kept.
#[derive(Clone, PartialEq, Eq)]
pub struct MzmlParam {
    cv: bool,
    accession: Option<String>,
    name: Option<String>,
    value: Option<String>,
    unit_accession: Option<String>,
}

impl MzmlParam {
    /// Whether the document states it as a `cvParam`, whatever its accession.
    #[must_use]
    pub const fn is_cv_param(&self) -> bool {
        self.cv
    }

    #[must_use]
    pub fn accession(&self) -> Option<&str> {
        self.accession.as_deref()
    }

    #[must_use]
    pub fn sensitive_name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    #[must_use]
    pub fn sensitive_value(&self) -> Option<&str> {
        self.value.as_deref()
    }

    #[must_use]
    pub fn unit_accession(&self) -> Option<&str> {
        self.unit_accession.as_deref()
    }

    fn byte_len(&self) -> usize {
        [
            &self.accession,
            &self.name,
            &self.value,
            &self.unit_accession,
        ]
        .into_iter()
        .flatten()
        .map(String::len)
        .sum()
    }
}

impl fmt::Debug for MzmlParam {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MzmlParam")
            .field("cv", &self.cv)
            .field("value_stated", &self.value.is_some())
            .finish_non_exhaustive()
    }
}

/// One metadata element, in document order: its kind, the unprefixed
/// attributes it states, and its parameters, each referenced param group's
/// parameters in place of the reference. An instrument configuration's
/// `softwareRef` child is kept as its `softwareRef` attribute. Paths, sample
/// names and other sensitive text can be among the values, so `Debug` shows
/// only counts.
#[derive(Clone, PartialEq, Eq)]
pub struct MzmlMetadataElement {
    kind: MzmlMetadataKind,
    attributes: Vec<(String, String)>,
    params: Vec<MzmlParam>,
}

impl MzmlMetadataElement {
    #[must_use]
    pub const fn kind(&self) -> MzmlMetadataKind {
        self.kind
    }

    /// Every unprefixed attribute, by local name, in document order.
    #[must_use]
    pub fn sensitive_attributes(&self) -> &[(String, String)] {
        &self.attributes
    }

    /// One attribute, or `None` when the element does not state it.
    #[must_use]
    pub fn sensitive_attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    #[must_use]
    pub fn params(&self) -> &[MzmlParam] {
        &self.params
    }
}

impl fmt::Debug for MzmlMetadataElement {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MzmlMetadataElement")
            .field("kind", &self.kind)
            .field("attribute_count", &self.attributes.len())
            .field("param_count", &self.params.len())
            .finish()
    }
}

/// The run-level metadata: file description, samples, software, instrument
/// configurations, data processing and the run element.
#[derive(Clone, PartialEq, Eq)]
pub enum MzmlMetadata {
    /// Every metadata element, in document order. A section the document does
    /// not state has no element, and is not reported.
    Read(Vec<MzmlMetadataElement>),
    /// Above [`MAX_METADATA_BYTES`], so none of it is reported rather than a
    /// part of it. The table stands.
    OverBound,
}

impl fmt::Debug for MzmlMetadata {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read(elements) => formatter
                .debug_struct("Read")
                .field("element_count", &elements.len())
                .finish(),
            Self::OverBound => formatter.write_str("OverBound"),
        }
    }
}

/// The lowest and highest scan start time of a run's spectra. Selected from
/// read values, never converted or interpolated.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MzmlRetentionTimeRange {
    /// Every spectrum states `unit`, or every one leaves it undeclared.
    Reported {
        minimum: f64,
        maximum: f64,
        unit: RetentionTimeUnit,
    },
    NoSpectra,
    /// Spectra state different units, or only some state one.
    MixedUnits,
}

/// What the table pass itself says about the run. It carries no retention
/// time at a share of cumulative base-peak intensity, which is a computation
/// (ADR 0056, decision 7).
#[derive(Debug, Clone, PartialEq)]
pub struct MzmlRunSummary {
    spectrum_count: u64,
    chromatogram_count: u64,
    counts_by_ms_level: Vec<MsLevelCount>,
    retention_time_range: MzmlRetentionTimeRange,
}

impl MzmlRunSummary {
    /// The spectra the pass read, not `spectrumList/@count`.
    #[must_use]
    pub const fn spectrum_count(&self) -> u64 {
        self.spectrum_count
    }

    /// The `chromatogram` elements the pass counted, none of them decoded.
    #[must_use]
    pub const fn chromatogram_count(&self) -> u64 {
        self.chromatogram_count
    }

    /// One bucket per MS level the spectra declare, lowest level first.
    #[must_use]
    pub fn counts_by_ms_level(&self) -> &[MsLevelCount] {
        &self.counts_by_ms_level
    }

    #[must_use]
    pub const fn retention_time_range(&self) -> MzmlRetentionTimeRange {
        self.retention_time_range
    }
}

/// Every spectrum's row, with what a later selected read needs: each row's
/// byte offset, the param groups, and the namespace bindings in scope for the
/// spectra.
#[derive(Clone)]
pub struct MzmlSpectrumTable {
    rows: Vec<MzmlSpectrumRow>,
    offsets: Vec<u64>,
    declared_spectrum_count: Option<u64>,
    chromatogram_count: u64,
    metadata: MzmlMetadata,
    groups: ParamGroups,
    bindings: Vec<(Option<Vec<u8>>, Vec<u8>)>,
    limits: MzmlScanLimits,
}

impl MzmlSpectrumTable {
    #[must_use]
    pub fn rows(&self) -> &[MzmlSpectrumRow] {
        &self.rows
    }

    /// `spectrumList/@count`, a second reading the rows are not checked against.
    #[must_use]
    pub const fn declared_spectrum_count(&self) -> Option<u64> {
        self.declared_spectrum_count
    }

    #[must_use]
    pub const fn metadata(&self) -> &MzmlMetadata {
        &self.metadata
    }

    #[must_use]
    pub fn run_summary(&self) -> MzmlRunSummary {
        let mut levels = BTreeMap::<u32, u64>::new();
        for row in &self.rows {
            *levels.entry(row.ms_level).or_default() += 1;
        }
        MzmlRunSummary {
            spectrum_count: self.rows.len() as u64,
            chromatogram_count: self.chromatogram_count,
            counts_by_ms_level: levels
                .into_iter()
                .map(|(level, count)| MsLevelCount::new(MsLevelBucket::Level(level), count))
                .collect(),
            retention_time_range: retention_time_range(&self.rows),
        }
    }
}

fn retention_time_range(rows: &[MzmlSpectrumRow]) -> MzmlRetentionTimeRange {
    let Some(first) = rows.first() else {
        return MzmlRetentionTimeRange::NoSpectra;
    };
    let unit = first.retention_time.unit;
    let (mut minimum, mut maximum) = (f64::INFINITY, f64::NEG_INFINITY);
    for row in rows {
        if row.retention_time.unit != unit {
            return MzmlRetentionTimeRange::MixedUnits;
        }
        minimum = minimum.min(row.retention_time.value);
        maximum = maximum.max(row.retention_time.value);
    }
    MzmlRetentionTimeRange::Reported {
        minimum,
        maximum,
        unit,
    }
}

impl fmt::Debug for MzmlSpectrumTable {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MzmlSpectrumTable")
            .field("rows", &self.rows.len())
            .field("declared_spectrum_count", &self.declared_spectrum_count)
            .field("chromatogram_count", &self.chromatogram_count)
            .field("metadata", &self.metadata)
            .field("param_groups", &self.groups.len())
            .finish_non_exhaustive()
    }
}

/// Reads every spectrum's metadata from an mzML file after refusing any
/// non-regular, symlinked or reparse-point path. Decodes no array.
pub fn read_spectrum_table(
    path: &Path,
    limits: MzmlScanLimits,
) -> Result<MzmlSpectrumTable, MzmlOpenError> {
    let (file, _length) = fs_guard::open_regular_file(path).map_err(MzmlScanError::from)?;
    read_spectrum_table_from(BufReader::with_capacity(64 * 1024, file), limits)
}

/// Reads every spectrum's metadata from any buffered reader positioned at the
/// start of the document.
pub fn read_spectrum_table_from<R: BufRead>(
    reader: R,
    limits: MzmlScanLimits,
) -> Result<MzmlSpectrumTable, MzmlOpenError> {
    let mut pass = Pass::new(limits, None);
    match drive(reader, limits, &[], &mut pass) {
        Ok(()) => {}
        Err(Fail::Scan(error)) => return Err(MzmlOpenError::Scan(error)),
        Err(Fail::Open(error)) => return Err(error),
        // The table pass decodes no array, so no array refusal can arise; it
        // is refused as malformed rather than unwrapped.
        Err(Fail::Spectrum(_)) => {
            return Err(MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed).into());
        }
    }
    if !pass.root_seen {
        return Err(MzmlScanError::Malformed(MzmlMalformedKind::MissingRootElement).into());
    }
    if !pass.stack.is_empty() {
        return Err(MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed).into());
    }
    if !pass.version_seen {
        return Err(MzmlOpenError::NotMzml11);
    }
    Ok(MzmlSpectrumTable {
        rows: pass.rows,
        offsets: pass.offsets,
        declared_spectrum_count: pass.declared_spectrum_count,
        chromatogram_count: pass.chromatograms,
        metadata: pass.metadata.finish(),
        groups: pass.groups.into_owned(),
        bindings: pass.bindings,
        limits,
    })
}

/// Reads and decodes the spectrum at table position `index` from the file the
/// table was read from. Holds no handle after it returns.
pub fn read_selected_spectrum(
    path: &Path,
    table: &MzmlSpectrumTable,
    index: u64,
) -> Result<MzmlSelectedSpectrum, MzmlSpectrumError> {
    let (file, _length) = fs_guard::open_regular_file(path)
        .map_err(|error| MzmlSpectrumError::Document(error.into()))?;
    read_selected_spectrum_from(BufReader::with_capacity(64 * 1024, file), table, index)
}

/// Reads and decodes the spectrum at table position `index` from a seekable
/// reader over the document the table was read from.
pub fn read_selected_spectrum_from<R: BufRead + Seek>(
    mut reader: R,
    table: &MzmlSpectrumTable,
    index: u64,
) -> Result<MzmlSelectedSpectrum, MzmlSpectrumError> {
    let position = usize::try_from(index)
        .ok()
        .filter(|position| *position < table.rows.len())
        .ok_or(MzmlSpectrumError::NotInTable)?;
    let offset = table
        .offsets
        .get(position)
        .copied()
        .ok_or(MzmlSpectrumError::NotInTable)?;
    reader
        .seek(SeekFrom::Start(offset))
        .map_err(|error| MzmlSpectrumError::Document(MzmlScanError::Io { kind: error.kind() }))?;

    let mut pass = Pass::new(table.limits, Some((table, position)));
    pass.groups = Cow::Borrowed(&table.groups);
    match drive(reader, table.limits, &table.bindings, &mut pass) {
        Ok(()) => {}
        Err(Fail::Scan(error)) => return Err(MzmlSpectrumError::Document(error)),
        // The table pass accepted this spectrum, so an open-level refusal now
        // means the bytes at the offset are no longer what it read.
        Err(Fail::Open(_)) => return Err(MzmlSpectrumError::NotAsRecorded),
        Err(Fail::Spectrum(error)) => return Err(error),
    }
    pass.selected.ok_or(MzmlSpectrumError::NotAsRecorded)
}

// ---------------------------------------------------------------------------
// One pass over events, shared by the table and the selected read.
// ---------------------------------------------------------------------------

enum Fail {
    Scan(MzmlScanError),
    Open(MzmlOpenError),
    Spectrum(MzmlSpectrumError),
}

impl From<MzmlScanError> for Fail {
    fn from(error: MzmlScanError) -> Self {
        Self::Scan(error)
    }
}

impl From<MzmlOpenError> for Fail {
    fn from(error: MzmlOpenError) -> Self {
        match error {
            MzmlOpenError::Scan(error) => Self::Scan(error),
            other => Self::Open(other),
        }
    }
}

const fn array_fail(role: ArrayRole, problem: ArrayProblem) -> Fail {
    Fail::Spectrum(MzmlSpectrumError::Array { role, problem })
}

const fn malformed(kind: MzmlMalformedKind) -> Fail {
    Fail::Scan(MzmlScanError::Malformed(kind))
}

fn drive<R: BufRead>(
    reader: R,
    limits: MzmlScanLimits,
    seed: &[(Option<Vec<u8>>, Vec<u8>)],
    pass: &mut Pass<'_>,
) -> Result<(), Fail> {
    let mut xml = NsReader::from_reader(BoundedReader::new(
        reader,
        limits.max_document_bytes,
        limits.max_text_run_bytes,
    ));
    let config = xml.config_mut();
    config.check_end_names = true;
    config.allow_unmatched_ends = false;
    config.allow_dangling_amp = false;
    config.expand_empty_elements = false;
    // A selected read starts at its spectrum, below the declarations that bind
    // its prefixes, so the table hands over the bindings in scope there.
    for (prefix, namespace) in seed {
        let declaration = match prefix {
            Some(prefix) => PrefixDeclaration::Named(prefix),
            None => PrefixDeclaration::Default,
        };
        xml.resolver_mut()
            .add(declaration, Namespace(namespace))
            .map_err(|_| malformed(MzmlMalformedKind::NotWellFormed))?;
    }

    let mut buffer = Vec::new();
    while !pass.done {
        buffer.clear();
        // The byte-counting reader's count, not quick-xml's position, which
        // leaves out a byte-order mark.
        let offset = xml.get_mut().consumed();
        let (resolved, event) = match xml.read_resolved_event_into(&mut buffer) {
            Ok(read) => read,
            Err(error) => {
                let tripped = xml.get_mut().tripped;
                return Err(pass
                    .over_bound(tripped)
                    .unwrap_or_else(|| Fail::Scan(map_xml_error(tripped, error))));
            }
        };
        let in_mzml =
            matches!(resolved, ResolveResult::Bound(Namespace(ns)) if ns == MZML_NAMESPACE);
        // Strict after a seek: the recorded offset must be the spectrum's own
        // start tag, not whitespace or anything else before it.
        if pass.decoding() && !pass.root_seen && !matches!(event, Event::Start(_) | Event::Empty(_))
        {
            return Err(Fail::Spectrum(MzmlSpectrumError::NotAsRecorded));
        }
        match event {
            Event::Eof => break,
            Event::Start(start) => pass.start(&start, in_mzml, offset, false, xml.resolver())?,
            Event::Empty(start) => pass.start(&start, in_mzml, offset, true, xml.resolver())?,
            Event::End(_) => pass.end()?,
            Event::Text(text) => pass.text(&text)?,
            Event::CData(data) => pass.text(&data)?,
            Event::GeneralRef(reference) => {
                let name = reference
                    .decode()
                    .map_err(|_| malformed(MzmlMalformedKind::InvalidUtf8))?;
                if !is_predefined_reference(&name) {
                    return Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity).into());
                }
                pass.reference(&reference)?;
            }
            Event::DocType(_) => {
                return Err(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration).into());
            }
            Event::Decl(declaration) => {
                if let Some(encoding) = declaration.encoding() {
                    let encoding =
                        encoding.map_err(|_| malformed(MzmlMalformedKind::NotWellFormed))?;
                    if !encoding.eq_ignore_ascii_case(b"utf-8") {
                        return Err(MzmlOpenError::NotUtf8.into());
                    }
                }
            }
            Event::Comment(_) | Event::PI(_) => {}
        }
        let bounded = xml.get_mut();
        if let Some(kind) = bounded.finish_event() {
            return Err(pass
                .over_bound(Some(kind))
                .unwrap_or(Fail::Scan(MzmlScanError::LimitExceeded(kind))));
        }
        // Only a decoded array's payload runs under its own, tighter bound.
        bounded.max_text_run_bytes = pass
            .payload_bound()
            .map_or(limits.max_text_run_bytes, |bound| {
                bound.min(limits.max_text_run_bytes)
            });
    }
    Ok(())
}

/// The mzML elements this reader distinguishes. Anything else, and any element
/// outside the mzML namespace, is `Other`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum El {
    IndexedMzml,
    Mzml,
    ParamGroupList,
    ParamGroup,
    ParamGroupRef,
    CvParam,
    Run,
    SpectrumList,
    Spectrum,
    ScanList,
    Scan,
    PrecursorList,
    Precursor,
    SelectedIonList,
    SelectedIon,
    BinaryDataArrayList,
    BinaryDataArray,
    Binary,
    UserParam,
    ChromatogramList,
    Chromatogram,
    // Run-level metadata.
    FileDescription,
    FileContent,
    SourceFileList,
    SourceFile,
    Contact,
    SampleList,
    Sample,
    SoftwareList,
    Software,
    InstrumentConfigurationList,
    InstrumentConfiguration,
    ComponentList,
    Source,
    Analyzer,
    Detector,
    SoftwareRef,
    DataProcessingList,
    DataProcessing,
    ProcessingMethod,
    Other,
}

fn element(in_mzml: bool, local: &[u8]) -> El {
    if !in_mzml {
        return El::Other;
    }
    match local {
        b"userParam" => El::UserParam,
        b"chromatogramList" => El::ChromatogramList,
        b"chromatogram" => El::Chromatogram,
        b"fileDescription" => El::FileDescription,
        b"fileContent" => El::FileContent,
        b"sourceFileList" => El::SourceFileList,
        b"sourceFile" => El::SourceFile,
        b"contact" => El::Contact,
        b"sampleList" => El::SampleList,
        b"sample" => El::Sample,
        b"softwareList" => El::SoftwareList,
        b"software" => El::Software,
        b"instrumentConfigurationList" => El::InstrumentConfigurationList,
        b"instrumentConfiguration" => El::InstrumentConfiguration,
        b"componentList" => El::ComponentList,
        b"source" => El::Source,
        b"analyzer" => El::Analyzer,
        b"detector" => El::Detector,
        b"softwareRef" => El::SoftwareRef,
        b"dataProcessingList" => El::DataProcessingList,
        b"dataProcessing" => El::DataProcessing,
        b"processingMethod" => El::ProcessingMethod,
        b"indexedmzML" => El::IndexedMzml,
        b"mzML" => El::Mzml,
        b"referenceableParamGroupList" => El::ParamGroupList,
        b"referenceableParamGroup" => El::ParamGroup,
        b"referenceableParamGroupRef" => El::ParamGroupRef,
        b"cvParam" => El::CvParam,
        b"run" => El::Run,
        b"spectrumList" => El::SpectrumList,
        b"spectrum" => El::Spectrum,
        b"scanList" => El::ScanList,
        b"scan" => El::Scan,
        b"precursorList" => El::PrecursorList,
        b"precursor" => El::Precursor,
        b"selectedIonList" => El::SelectedIonList,
        b"selectedIon" => El::SelectedIon,
        b"binaryDataArrayList" => El::BinaryDataArrayList,
        b"binaryDataArray" => El::BinaryDataArray,
        b"binary" => El::Binary,
        _ => El::Other,
    }
}

/// ADR 0056 decision 1: a stated `version` alone decides, and must be 1.1.x.
/// Without one, the mzML schema that `xsi:schemaLocation` names decides, read
/// from its file name as ProteoWizard reads it (`mzML1.1.0.xsd` is 1.1.0).
fn check_version(
    start: &BytesStart<'_>,
    attributes: &CapturedAttributes<'_>,
    resolver: &NamespaceResolver,
) -> Result<(), Fail> {
    let supported = match attributes.version.as_deref() {
        Some(version) => is_mzml_1_1(version),
        None => schema_location(start, resolver)?.is_some_and(|value| names_mzml_1_1(&value)),
    };
    if supported {
        Ok(())
    } else {
        Err(MzmlOpenError::NotMzml11.into())
    }
}

fn is_mzml_1_1(version: &str) -> bool {
    version
        .strip_prefix("1.1.")
        .is_some_and(|patch| !patch.is_empty() && patch.bytes().all(|b| b.is_ascii_digit()))
}

/// The `schemaLocation` attribute in the XML Schema instance namespace, found
/// by its resolved namespace rather than its prefix.
fn schema_location<'a>(
    start: &'a BytesStart<'_>,
    resolver: &NamespaceResolver,
) -> Result<Option<Cow<'a, str>>, Fail> {
    let mut found = None;
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| malformed(MzmlMalformedKind::NotWellFormed))?;
        let (namespace, local) = resolver.resolve_attribute(attribute.key);
        let xsi = matches!(namespace, ResolveResult::Bound(Namespace(ns)) if ns == XSI_NAMESPACE);
        if !xsi || local.as_ref() != b"schemaLocation" {
            continue;
        }
        // Two prefixes bound to one namespace state the same attribute twice.
        if found.is_some() {
            return Err(malformed(MzmlMalformedKind::DuplicateAttribute));
        }
        found = Some(attribute_value(&attribute)?);
    }
    Ok(found)
}

/// Whether a schema location pairs the mzML namespace with exactly one schema,
/// and that schema's file name is `mzML1.1.<n>.xsd`. The index wrapper's
/// `mzML1.1.<n>_idx.xsd` is not the `<mzML>` element's schema, so it does not
/// count.
fn names_mzml_1_1(value: &str) -> bool {
    let tokens: Vec<&str> = value.split_ascii_whitespace().collect();
    if !tokens.len().is_multiple_of(2) {
        return false;
    }
    let mut locations = tokens
        .chunks(2)
        .filter(|pair| pair[0].as_bytes() == MZML_NAMESPACE)
        .map(|pair| pair[1]);
    let (Some(location), None) = (locations.next(), locations.next()) else {
        return false;
    };
    location
        .rsplit(['/', '\\'])
        .next()
        .and_then(|file| file.strip_prefix("mzML"))
        .and_then(|rest| rest.strip_suffix(".xsd"))
        .is_some_and(is_mzml_1_1)
}

const SPECTRUM_SCAN: &[El] = &[El::Spectrum, El::ScanList, El::Scan];
const SPECTRUM_SELECTED_ION: &[El] = &[
    El::Spectrum,
    El::PrecursorList,
    El::Precursor,
    El::SelectedIonList,
    El::SelectedIon,
];
const SPECTRUM_ARRAY: &[El] = &[El::Spectrum, El::BinaryDataArrayList, El::BinaryDataArray];
const INSTRUMENT_COMPONENT: &[El] = &[
    El::InstrumentConfigurationList,
    El::InstrumentConfiguration,
    El::ComponentList,
];

/// Which metadata element `el` is, when it sits where the schema puts one.
fn metadata_kind(stack: &[El], el: El) -> Option<MzmlMetadataKind> {
    use MzmlMetadataKind as Kind;
    let under = |path: &[El]| stack.ends_with(path);
    Some(match el {
        El::FileContent if under(&[El::Mzml, El::FileDescription]) => Kind::FileContent,
        El::SourceFile if under(&[El::Mzml, El::FileDescription, El::SourceFileList]) => {
            Kind::SourceFile
        }
        El::Contact if under(&[El::Mzml, El::FileDescription]) => Kind::Contact,
        El::Sample if under(&[El::Mzml, El::SampleList]) => Kind::Sample,
        El::Software if under(&[El::Mzml, El::SoftwareList]) => Kind::Software,
        El::InstrumentConfiguration if under(&[El::Mzml, El::InstrumentConfigurationList]) => {
            Kind::InstrumentConfiguration
        }
        El::Source if under(INSTRUMENT_COMPONENT) => Kind::Source,
        El::Analyzer if under(INSTRUMENT_COMPONENT) => Kind::Analyzer,
        El::Detector if under(INSTRUMENT_COMPONENT) => Kind::Detector,
        El::DataProcessing if under(&[El::Mzml, El::DataProcessingList]) => Kind::DataProcessing,
        El::ProcessingMethod if under(&[El::DataProcessingList, El::DataProcessing]) => {
            Kind::ProcessingMethod
        }
        El::Run if under(&[El::Mzml]) => Kind::Run,
        _ => return None,
    })
}

/// A metadata element's unprefixed attributes. Read here rather than through
/// the shared attribute capture, so no attribute that capture skips is newly
/// normalized for the inspector; one that does not normalize is not reported.
fn metadata_attributes(start: &BytesStart<'_>) -> Vec<(String, String)> {
    start
        .attributes()
        .filter_map(Result::ok)
        .filter(|attribute| {
            attribute.key.prefix().is_none() && attribute.key.as_namespace_binding().is_none()
        })
        .filter_map(|attribute| {
            let key = std::str::from_utf8(attribute.key.local_name().as_ref())
                .ok()?
                .to_owned();
            let value = attribute_value(&attribute).ok()?.into_owned();
            Some((key, value))
        })
        .collect()
}

/// The controlled-vocabulary terms this reader interprets. Every other term is
/// not read, so it can neither conflict nor be shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Term {
    MsLevel,
    Centroid,
    Profile,
    TotalIonCurrent,
    BasePeakMz,
    BasePeakIntensity,
    LowestObservedMz,
    HighestObservedMz,
    ScanStartTime,
    SelectedIonMz,
    PeakIntensity,
    MzArray,
    IntensityArray,
    DataType(Option<BinaryDataType>),
    Zlib,
    NoCompression,
    Numpress,
    TruncationOrPrediction,
    UnrecognizedCompression,
}

fn term(accession: &str, name: Option<&str>) -> Option<Term> {
    Some(match accession {
        "MS:1000511" => Term::MsLevel,
        "MS:1000127" => Term::Centroid,
        "MS:1000128" => Term::Profile,
        "MS:1000285" => Term::TotalIonCurrent,
        "MS:1000504" => Term::BasePeakMz,
        "MS:1000505" => Term::BasePeakIntensity,
        "MS:1000528" => Term::LowestObservedMz,
        "MS:1000527" => Term::HighestObservedMz,
        "MS:1000016" => Term::ScanStartTime,
        "MS:1000744" => Term::SelectedIonMz,
        "MS:1000042" => Term::PeakIntensity,
        "MS:1000514" => Term::MzArray,
        "MS:1000515" => Term::IntensityArray,
        "MS:1000521" => Term::DataType(Some(BinaryDataType::Float32)),
        "MS:1000523" => Term::DataType(Some(BinaryDataType::Float64)),
        "MS:1000519" => Term::DataType(Some(BinaryDataType::Integer32)),
        "MS:1000522" => Term::DataType(Some(BinaryDataType::Integer64)),
        // 16-bit float and null-terminated ASCII string: data types, refused.
        "MS:1000520" | "MS:1001479" => Term::DataType(None),
        "MS:1000574" => Term::Zlib,
        "MS:1000576" => Term::NoCompression,
        "MS:1002312" | "MS:1002313" | "MS:1002314" | "MS:1002746" | "MS:1002747" | "MS:1002748" => {
            Term::Numpress
        }
        "MS:1003088" | "MS:1003089" | "MS:1003090" => Term::TruncationOrPrediction,
        // Without the ontology an unknown compression term is recognized only by
        // its stated name. It must refuse the array rather than read as absent.
        _ if name.is_some_and(|name| name.to_ascii_lowercase().contains("compression")) => {
            Term::UnrecognizedCompression
        }
        _ => return None,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stated {
    term: Term,
    value: String,
    unit: Option<String>,
}

/// The facts read without refusing. They stay out of [`Term`], whose
/// restatement with a different value refuses the open, and out of a param
/// group's term count.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Facts {
    polarity: MzmlDeclared<MzmlPolarity>,
    charge: MzmlDeclared<i32>,
}

impl Facts {
    fn and(self, other: Self) -> Self {
        Self {
            polarity: self.polarity.and(other.polarity),
            charge: self.charge.and(other.charge),
        }
    }
}

/// The fact one term states, if it is one. A polarity term's value is not
/// read, so restating it never disagrees with itself.
fn fact(accession: &str, value: &str) -> Option<Facts> {
    let mut facts = Facts::default();
    match accession {
        "MS:1000130" => facts.polarity = MzmlDeclared::Value(MzmlPolarity::Positive),
        "MS:1000129" => facts.polarity = MzmlDeclared::Value(MzmlPolarity::Negative),
        "MS:1000041" => {
            facts.charge = value
                .trim()
                .parse()
                .map_or(MzmlDeclared::Unreadable, MzmlDeclared::Value);
        }
        _ => return None,
    }
    Some(facts)
}

#[derive(Debug, Clone, Default)]
struct Group {
    stated: Vec<Stated>,
    facts: Facts,
}

type ParamGroups = BTreeMap<String, Group>;

/// The terms one element states, its param groups included. A term stated
/// twice must state the same value and unit.
#[derive(Debug, Default)]
struct Terms {
    stated: Vec<Stated>,
    facts: Facts,
}

struct Conflict;

impl Terms {
    fn add(&mut self, stated: Stated) -> Result<(), Conflict> {
        match self
            .stated
            .iter()
            .find(|existing| existing.term == stated.term)
        {
            Some(existing) if *existing == stated => Ok(()),
            Some(_) => Err(Conflict),
            None => {
                self.stated.push(stated);
                Ok(())
            }
        }
    }

    fn get(&self, term: Term) -> Option<&Stated> {
        self.stated.iter().find(|stated| stated.term == term)
    }

    fn has(&self, term: Term) -> bool {
        self.get(term).is_some()
    }

    fn count(&self, matches: impl Fn(Term) -> bool) -> usize {
        self.stated
            .iter()
            .filter(|stated| matches(stated.term))
            .count()
    }
}

/// The run-level metadata kept by the table pass, under
/// [`MAX_METADATA_BYTES`]. Nothing here refuses.
#[derive(Default)]
struct MetadataCapture {
    elements: Vec<MzmlMetadataElement>,
    /// Each open metadata element's index, with the stack depth of its
    /// children.
    open: Vec<(usize, usize)>,
    /// Every param group's own parameters, which a metadata element may
    /// reference. Not kept past the pass.
    groups: BTreeMap<String, Vec<MzmlParam>>,
    group: Vec<MzmlParam>,
    bytes: usize,
    over_bound: bool,
}

impl MetadataCapture {
    /// Counts `bytes` and one item against the bound. Once it is crossed,
    /// everything kept is dropped and nothing more is.
    fn spend(&mut self, bytes: usize) -> bool {
        self.bytes = self
            .bytes
            .saturating_add(bytes)
            .saturating_add(METADATA_ITEM_BYTES);
        if self.bytes > MAX_METADATA_BYTES && !self.over_bound {
            self.over_bound = true;
            self.elements = Vec::new();
            self.groups = BTreeMap::new();
            self.group = Vec::new();
        }
        !self.over_bound
    }

    /// The element whose children sit at `depth`.
    fn element_at(&mut self, depth: usize) -> Option<&mut MzmlMetadataElement> {
        match self.open.last() {
            Some(&(open, index)) if open == depth => self.elements.get_mut(index),
            _ => None,
        }
    }

    fn finish(self) -> MzmlMetadata {
        if self.over_bound {
            MzmlMetadata::OverBound
        } else {
            MzmlMetadata::Read(self.elements)
        }
    }
}

/// A param's text, or `None` for an empty one.
fn param_text(value: Option<&Cow<'_, str>>) -> Option<String> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.as_ref().to_owned())
}

#[derive(Debug, Default)]
struct PrecursorParse {
    selected_ions: u32,
    terms: Terms,
}

#[derive(Debug, Default)]
struct ArrayParse {
    array_length: Option<u64>,
    terms: Terms,
    /// A term stated twice with different values. Judged only if the array
    /// turns out to be one this reader decodes.
    conflict: bool,
    /// A term stated after the payload began, judged the same way.
    late_term: bool,
    prepared: Option<Prepared>,
    payload_started: bool,
    encoded: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
struct Prepared {
    role: ArrayRole,
    data_type: BinaryDataType,
    zlib: bool,
    bytes: u64,
    bound: u64,
}

#[derive(Debug, Default)]
struct SpectrumParse {
    offset: u64,
    index: Option<u64>,
    id: Option<String>,
    default_array_length: Option<u64>,
    terms: Terms,
    scans: u32,
    scan_terms: Terms,
    precursors: Vec<PrecursorParse>,
    precursor_count: u32,
    array: Option<ArrayParse>,
    decoded_bytes: u64,
    mz: Option<MzmlArray>,
    intensity: Option<MzmlArray>,
}

struct Pass<'t> {
    limits: MzmlScanLimits,
    /// The table and the row position of a selected read; `None` for the table.
    selecting: Option<(&'t MzmlSpectrumTable, usize)>,
    stack: Vec<El>,
    elements: u64,
    root_seen: bool,
    version_seen: bool,
    groups: Cow<'t, ParamGroups>,
    group: Option<(Option<String>, Group)>,
    bindings: Vec<(Option<Vec<u8>>, Vec<u8>)>,
    declared_spectrum_count: Option<u64>,
    chromatograms: u64,
    metadata: MetadataCapture,
    rows: Vec<MzmlSpectrumRow>,
    offsets: Vec<u64>,
    spectrum: Option<SpectrumParse>,
    selected: Option<MzmlSelectedSpectrum>,
    done: bool,
}

impl<'t> Pass<'t> {
    fn new(limits: MzmlScanLimits, selecting: Option<(&'t MzmlSpectrumTable, usize)>) -> Self {
        Self {
            limits,
            selecting,
            stack: Vec::new(),
            elements: 0,
            root_seen: false,
            version_seen: false,
            groups: Cow::Owned(ParamGroups::new()),
            group: None,
            bindings: Vec::new(),
            declared_spectrum_count: None,
            chromatograms: 0,
            metadata: MetadataCapture::default(),
            rows: Vec::new(),
            offsets: Vec::new(),
            spectrum: None,
            selected: None,
            done: false,
        }
    }

    const fn decoding(&self) -> bool {
        self.selecting.is_some()
    }

    fn open_array(&mut self) -> Option<&mut ArrayParse> {
        self.spectrum
            .as_mut()
            .and_then(|spectrum| spectrum.array.as_mut())
    }

    /// The bound on the payload being read, while a decoded array's payload is
    /// open.
    fn payload_bound(&self) -> Option<u64> {
        if self.stack.last() != Some(&El::Binary) {
            return None;
        }
        let spectrum = self.spectrum.as_ref()?;
        spectrum
            .array
            .as_ref()?
            .prepared
            .map(|prepared| prepared.bound)
    }

    /// A text-run limit tripped inside a decoded payload is that array's
    /// refusal, not the document's.
    fn over_bound(&self, tripped: Option<MzmlLimitKind>) -> Option<Fail> {
        if tripped != Some(MzmlLimitKind::TextRunBytes) {
            return None;
        }
        let prepared = self.spectrum.as_ref()?.array.as_ref()?.prepared?;
        (self.stack.last() == Some(&El::Binary))
            .then(|| array_fail(prepared.role, ArrayProblem::EncodedTextOverBound))
    }

    fn start(
        &mut self,
        start: &BytesStart<'_>,
        in_mzml: bool,
        offset: u64,
        empty: bool,
        resolver: &NamespaceResolver,
    ) -> Result<(), Fail> {
        self.elements += 1;
        if self.elements > self.limits.max_elements {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Elements).into());
        }
        if start.name().as_ref().len() > self.limits.max_name_bytes {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::NameBytes).into());
        }
        if !empty && self.stack.len() >= self.limits.max_depth {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Depth).into());
        }
        let attributes = capture_attributes(start, self.limits)?;
        let el = element(in_mzml, start.local_name().as_ref());
        let el = self.begin(el, start, &attributes, offset, resolver)?;
        self.stack.push(el);
        if empty {
            self.end()?;
        }
        Ok(())
    }

    fn begin(
        &mut self,
        el: El,
        start: &BytesStart<'_>,
        attributes: &CapturedAttributes<'_>,
        offset: u64,
        resolver: &NamespaceResolver,
    ) -> Result<El, Fail> {
        if self.stack.is_empty() {
            self.begin_root(el, start, attributes, offset, resolver)?;
            return Ok(el);
        }
        if !self.decoding()
            && let Some(kind) = metadata_kind(&self.stack, el)
        {
            self.begin_metadata(kind, start);
        }
        let parent = self.stack.last().copied();
        match el {
            El::Mzml if self.stack == [El::IndexedMzml] => {
                check_version(start, attributes, resolver)?;
                self.version_seen = true;
            }
            El::ParamGroup if parent == Some(El::ParamGroupList) => {
                if self.groups.len() >= MAX_PARAM_GROUPS {
                    return Err(MzmlOpenError::ReaderLimit(ReaderLimitKind::ParamGroups).into());
                }
                self.group = Some((
                    attributes.id.as_deref().map(str::to_owned),
                    Group::default(),
                ));
                self.metadata.group.clear();
            }
            El::SpectrumList if parent == Some(El::Run) => {
                self.declared_spectrum_count = attributes
                    .count
                    .as_deref()
                    .map(parse_u64_decimal)
                    .transpose()?;
                self.bindings = resolver
                    .bindings()
                    .map(|(prefix, namespace)| {
                        let prefix = match prefix {
                            PrefixDeclaration::Default => None,
                            PrefixDeclaration::Named(name) => Some(name.to_vec()),
                        };
                        (prefix, namespace.0.to_vec())
                    })
                    .collect();
            }
            El::Spectrum if parent == Some(El::SpectrumList) && !self.decoding() => {
                if self.rows.len() as u64 >= self.limits.max_spectra {
                    return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Spectra).into());
                }
                self.begin_spectrum(attributes, offset)?;
            }
            El::Scan if self.stack.ends_with(&SPECTRUM_SCAN[..2]) => {
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.scans += 1;
                    if spectrum.scans > 1 {
                        return Err(MzmlOpenError::MultipleScans.into());
                    }
                }
            }
            El::Precursor if self.stack.ends_with(&[El::Spectrum, El::PrecursorList]) => {
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.precursor_count += 1;
                    if spectrum.precursor_count > MAX_PRECURSORS_PER_SPECTRUM {
                        return Err(MzmlOpenError::ReaderLimit(
                            ReaderLimitKind::PrecursorsPerSpectrum,
                        )
                        .into());
                    }
                    // Both passes read every precursor, so the table refuses
                    // what a selected read would; a row keeps only the first.
                    spectrum.precursors.push(PrecursorParse::default());
                }
            }
            El::SelectedIon if self.stack.ends_with(&SPECTRUM_SELECTED_ION[..4]) => {
                if let Some(precursor) = self
                    .spectrum
                    .as_mut()
                    .and_then(|spectrum| spectrum.precursors.last_mut())
                {
                    precursor.selected_ions += 1;
                }
            }
            El::BinaryDataArray
                if self.decoding() && self.stack.ends_with(&SPECTRUM_ARRAY[..2]) =>
            {
                let array_length = attributes
                    .array_length
                    .as_deref()
                    .map(parse_u64_decimal)
                    .transpose()?;
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.array = Some(ArrayParse {
                        array_length,
                        ..ArrayParse::default()
                    });
                }
            }
            El::Binary if self.decoding() && self.stack.ends_with(SPECTRUM_ARRAY) => {
                self.begin_payload()?;
            }
            El::Chromatogram if self.stack.ends_with(&[El::Run, El::ChromatogramList]) => {
                self.chromatograms += 1;
            }
            El::SoftwareRef if parent == Some(El::InstrumentConfiguration) => {
                if let Some(reference) = attributes.reference.as_deref() {
                    self.metadata_attribute("softwareRef", reference);
                }
            }
            // A spectrum anywhere else is not a row, and must not close one.
            El::Spectrum => return Ok(El::Other),
            El::CvParam => self.cv_param(attributes)?,
            El::UserParam => self.capture_param(attributes, false),
            El::ParamGroupRef => self.group_ref(attributes)?,
            _ => {}
        }
        Ok(el)
    }

    fn begin_metadata(&mut self, kind: MzmlMetadataKind, start: &BytesStart<'_>) {
        let depth = self.stack.len() + 1;
        let index = self.metadata.elements.len();
        self.metadata.open.push((depth, index));
        let attributes = metadata_attributes(start);
        let bytes = attributes
            .iter()
            .map(|(key, value)| key.len() + value.len() + METADATA_ITEM_BYTES)
            .sum();
        if self.metadata.spend(bytes) {
            self.metadata.elements.push(MzmlMetadataElement {
                kind,
                attributes,
                params: Vec::new(),
            });
        }
    }

    /// An attribute the open metadata element states through a child.
    fn metadata_attribute(&mut self, key: &str, value: &str) {
        let depth = self.stack.len();
        if self.metadata.element_at(depth).is_none()
            || !self.metadata.spend(key.len() + value.len())
        {
            return;
        }
        if let Some(element) = self.metadata.element_at(depth) {
            element.attributes.push((key.to_owned(), value.to_owned()));
        }
    }

    /// Keeps a `cvParam` or `userParam` of a param group or of an open metadata
    /// element. Only the table pass keeps metadata.
    fn capture_param(&mut self, attributes: &CapturedAttributes<'_>, cv: bool) {
        if self.decoding() {
            return;
        }
        let in_group =
            self.group.is_some() && self.stack.ends_with(&[El::ParamGroupList, El::ParamGroup]);
        let depth = self.stack.len();
        if !in_group && self.metadata.element_at(depth).is_none() {
            return;
        }
        let accession = |value: Option<&Cow<'_, str>>| {
            value
                .filter(|value| is_accession(value))
                .map(|value| value.as_ref().to_owned())
        };
        let param = MzmlParam {
            cv,
            accession: if cv {
                accession(attributes.accession.as_ref())
            } else {
                None
            },
            name: param_text(attributes.name.as_ref()),
            value: param_text(attributes.value.as_ref()),
            unit_accession: accession(attributes.unit_accession.as_ref()),
        };
        if !self.metadata.spend(param.byte_len()) {
            return;
        }
        if in_group {
            self.metadata.group.push(param);
        } else if let Some(element) = self.metadata.element_at(depth) {
            element.params.push(param);
        }
    }

    fn begin_root(
        &mut self,
        el: El,
        start: &BytesStart<'_>,
        attributes: &CapturedAttributes<'_>,
        offset: u64,
        resolver: &NamespaceResolver,
    ) -> Result<(), Fail> {
        if self.root_seen {
            return Err(malformed(MzmlMalformedKind::NotWellFormed));
        }
        self.root_seen = true;
        if let Some((table, position)) = self.selecting {
            // Strict after a seek: the first element must be the recorded
            // spectrum, with its index and native ID.
            let row = table
                .rows
                .get(position)
                .ok_or(Fail::Spectrum(MzmlSpectrumError::NotInTable))?;
            let index = attributes
                .index
                .as_deref()
                .map(parse_u64_decimal)
                .transpose()
                .ok()
                .flatten();
            if el != El::Spectrum
                || index != Some(row.identity.index())
                || attributes.id.as_deref() != row.native_id()
            {
                return Err(Fail::Spectrum(MzmlSpectrumError::NotAsRecorded));
            }
            return self.begin_spectrum(attributes, offset);
        }
        match el {
            El::IndexedMzml => Ok(()),
            El::Mzml => {
                check_version(start, attributes, resolver)?;
                self.version_seen = true;
                Ok(())
            }
            _ => Err(malformed(MzmlMalformedKind::UnexpectedRoot)),
        }
    }

    fn begin_spectrum(
        &mut self,
        attributes: &CapturedAttributes<'_>,
        offset: u64,
    ) -> Result<(), Fail> {
        self.spectrum = Some(SpectrumParse {
            offset,
            index: attributes
                .index
                .as_deref()
                .map(parse_u64_decimal)
                .transpose()?,
            id: attributes.id.as_deref().map(str::to_owned),
            default_array_length: attributes
                .default_array_length
                .as_deref()
                .map(parse_u64_decimal)
                .transpose()?,
            ..SpectrumParse::default()
        });
        Ok(())
    }

    fn target(&mut self) -> Option<Target<'_>> {
        terms_target(&self.stack, &mut self.group, &mut self.spectrum)
    }

    fn cv_param(&mut self, attributes: &CapturedAttributes<'_>) -> Result<(), Fail> {
        self.capture_param(attributes, true);
        let Some(accession) = attributes.accession.as_deref() else {
            return Ok(());
        };
        if let Some(facts) = fact(accession, attributes.value.as_deref().unwrap_or_default()) {
            // An array's terms are judged for its payload; a fact is not one.
            return match self.target() {
                Some(Target::Array(_)) | None => Ok(()),
                Some(target) => target.add(&[], facts),
            };
        }
        let Some(term) = term(accession, attributes.name.as_deref()) else {
            return Ok(());
        };
        let stated = Stated {
            term,
            value: attributes.value.as_deref().unwrap_or_default().to_owned(),
            unit: attributes
                .unit_accession
                .as_deref()
                .filter(|unit| !unit.trim().is_empty())
                .map(str::to_owned),
        };
        match self.target() {
            Some(target) => target.add(std::slice::from_ref(&stated), Facts::default()),
            None => Ok(()),
        }
    }

    fn group_ref(&mut self, attributes: &CapturedAttributes<'_>) -> Result<(), Fail> {
        // Every reference is checked, wherever it sits.
        let reference = attributes.reference.as_deref().unwrap_or_default();
        let group = self
            .groups
            .get(reference)
            .ok_or(Fail::Open(MzmlOpenError::UndefinedParamGroup))?;
        match terms_target(&self.stack, &mut self.group, &mut self.spectrum) {
            // A group referring to a group is not mzML.
            Some(Target::Group(_)) => return Err(malformed(MzmlMalformedKind::NotWellFormed)),
            Some(target) => target.add(&group.stated, group.facts)?,
            None => {}
        }
        self.resolve_metadata_group(reference);
        Ok(())
    }

    /// An open metadata element takes a referenced group's parameters in place
    /// of the reference.
    fn resolve_metadata_group(&mut self, reference: &str) {
        let depth = self.stack.len();
        if self.decoding() || self.metadata.element_at(depth).is_none() {
            return;
        }
        let params = self
            .metadata
            .groups
            .get(reference)
            .cloned()
            .unwrap_or_default();
        for param in params {
            if !self.metadata.spend(param.byte_len()) {
                return;
            }
            if let Some(element) = self.metadata.element_at(depth) {
                element.params.push(param);
            }
        }
    }

    fn begin_payload(&mut self) -> Result<(), Fail> {
        let Some(spectrum) = self.spectrum.as_mut() else {
            return Ok(());
        };
        let default_length = spectrum.default_array_length;
        let decoded_bytes = spectrum.decoded_bytes;
        let (has_mz, has_intensity) = (spectrum.mz.is_some(), spectrum.intensity.is_some());
        let Some(array) = spectrum.array.as_mut() else {
            return Ok(());
        };
        array.payload_started = true;
        let Some(prepared) = prepare(array, default_length, decoded_bytes, has_mz, has_intensity)?
        else {
            return Ok(());
        };
        array.prepared = Some(prepared);
        spectrum.decoded_bytes += prepared.bytes;
        Ok(())
    }

    fn text(&mut self, bytes: &[u8]) -> Result<(), Fail> {
        if self.stack.last() != Some(&El::Binary) {
            return Ok(());
        }
        let Some(array) = self.open_array() else {
            return Ok(());
        };
        let Some(prepared) = array.prepared else {
            return Ok(());
        };
        let total = (array.encoded.len() as u64).saturating_add(bytes.len() as u64);
        if total > prepared.bound {
            return Err(array_fail(
                prepared.role,
                ArrayProblem::EncodedTextOverBound,
            ));
        }
        array
            .encoded
            .try_reserve(bytes.len())
            .map_err(|_| array_fail(prepared.role, ArrayProblem::AllocationRefused))?;
        array.encoded.extend_from_slice(bytes);
        Ok(())
    }

    /// A character reference inside a decoded payload is the character it
    /// names, and joins the payload like any other text, under the same bound.
    /// A predefined entity names `&`, `<`, `>`, `"` or `'`, none of which is
    /// base64.
    fn reference(&mut self, reference: &BytesRef<'_>) -> Result<(), Fail> {
        if self.stack.last() != Some(&El::Binary) {
            return Ok(());
        }
        let Some(prepared) = self.open_array().and_then(|array| array.prepared) else {
            return Ok(());
        };
        match reference.resolve_char_ref() {
            Ok(Some(character)) => self.text(character.encode_utf8(&mut [0; 4]).as_bytes()),
            _ => Err(array_fail(prepared.role, ArrayProblem::CorruptBase64)),
        }
    }

    fn end(&mut self) -> Result<(), Fail> {
        let el = self
            .stack
            .pop()
            .ok_or(malformed(MzmlMalformedKind::NotWellFormed))?;
        if self
            .metadata
            .open
            .last()
            .is_some_and(|&(depth, _)| depth == self.stack.len() + 1)
        {
            self.metadata.open.pop();
        }
        match el {
            El::ParamGroup if self.stack.last() == Some(&El::ParamGroupList) => {
                let Some((id, group)) = self.group.take() else {
                    return Ok(());
                };
                let id = id.ok_or(Fail::Open(MzmlOpenError::AmbiguousParamGroup))?;
                if self.groups.to_mut().insert(id.clone(), group).is_some() {
                    return Err(MzmlOpenError::AmbiguousParamGroup.into());
                }
                let params = std::mem::take(&mut self.metadata.group);
                if !self.metadata.over_bound {
                    self.metadata.groups.insert(id, params);
                }
            }
            El::BinaryDataArray if self.stack.ends_with(&SPECTRUM_ARRAY[..2]) => {
                self.finish_array()?;
            }
            El::Spectrum if self.spectrum.is_some() => self.finish_spectrum()?,
            _ => {}
        }
        Ok(())
    }

    fn finish_array(&mut self) -> Result<(), Fail> {
        let Some(spectrum) = self.spectrum.as_mut() else {
            return Ok(());
        };
        let Some(mut array) = spectrum.array.take() else {
            return Ok(());
        };
        // An array with no `binary` element is an empty payload, checked the
        // same way.
        let decoded_role = array.terms.has(Term::MzArray) || array.terms.has(Term::IntensityArray);
        if array.late_term && decoded_role {
            return Err(Fail::Spectrum(MzmlSpectrumError::TermAfterPayload));
        }
        let prepared = match array.prepared {
            Some(prepared) => prepared,
            None if array.payload_started => return Ok(()),
            None => {
                let prepared = prepare(
                    &array,
                    spectrum.default_array_length,
                    spectrum.decoded_bytes,
                    spectrum.mz.is_some(),
                    spectrum.intensity.is_some(),
                )?;
                let Some(prepared) = prepared else {
                    return Ok(());
                };
                spectrum.decoded_bytes += prepared.bytes;
                prepared
            }
        };
        let unit = match array
            .terms
            .get(match prepared.role {
                ArrayRole::Mz => Term::MzArray,
                ArrayRole::Intensity => Term::IntensityArray,
            })
            .and_then(|stated| stated.unit.clone())
        {
            None => ArrayUnit::NotDeclared,
            Some(accession) if is_accession(&accession) => ArrayUnit::Declared(accession),
            Some(_) => return Err(array_fail(prepared.role, ArrayProblem::UnitNotAnAccession)),
        };
        let encoded = std::mem::take(&mut array.encoded);
        let values =
            decode(prepared, encoded).map_err(|problem| array_fail(prepared.role, problem))?;
        let decoded = MzmlArray {
            values,
            unit,
            stored_as: Some(prepared.data_type),
        };
        match prepared.role {
            ArrayRole::Mz => spectrum.mz = Some(decoded),
            ArrayRole::Intensity => spectrum.intensity = Some(decoded),
        }
        Ok(())
    }

    fn finish_spectrum(&mut self) -> Result<(), Fail> {
        let Some(mut spectrum) = self.spectrum.take() else {
            return Ok(());
        };
        let row = spectrum_row(&mut spectrum)?;
        match self.selecting {
            None => {
                if row.identity.index() != self.rows.len() as u64 {
                    return Err(MzmlOpenError::IndexOutOfSequence.into());
                }
                self.rows.push(row);
                self.offsets.push(spectrum.offset);
            }
            Some(_) => {
                self.selected = Some(selected_spectrum(row, spectrum)?);
                self.done = true;
            }
        }
        Ok(())
    }
}

enum Target<'a> {
    Group(&'a mut Group),
    Terms(&'a mut Terms),
    Array(&'a mut ArrayParse),
}

impl Target<'_> {
    /// Adds terms, which may refuse, and facts, which never do.
    fn add(self, stated: &[Stated], facts: Facts) -> Result<(), Fail> {
        match self {
            Self::Group(group) => {
                if group.stated.len().saturating_add(stated.len()) > MAX_TERMS_PER_PARAM_GROUP {
                    return Err(
                        MzmlOpenError::ReaderLimit(ReaderLimitKind::TermsPerParamGroup).into(),
                    );
                }
                group.stated.extend_from_slice(stated);
                group.facts = group.facts.and(facts);
                Ok(())
            }
            Self::Terms(terms) => {
                for stated in stated {
                    terms
                        .add(stated.clone())
                        .map_err(|Conflict| Fail::Open(MzmlOpenError::ConflictingTerm))?;
                }
                terms.facts = terms.facts.and(facts);
                Ok(())
            }
            Self::Array(array) => {
                // Every term must be known when the payload starts, because the
                // payload's bound depends on them.
                array.late_term |= array.payload_started;
                for stated in stated {
                    array.conflict |= array.terms.add(stated.clone()).is_err();
                }
                Ok(())
            }
        }
    }
}

/// Where a term inside the open element belongs, if this reader reads it.
fn terms_target<'a>(
    stack: &[El],
    group: &'a mut Option<(Option<String>, Group)>,
    spectrum: &'a mut Option<SpectrumParse>,
) -> Option<Target<'a>> {
    if stack.ends_with(&[El::ParamGroupList, El::ParamGroup]) {
        return group.as_mut().map(|(_, group)| Target::Group(group));
    }
    let spectrum = spectrum.as_mut()?;
    if stack.ends_with(SPECTRUM_ARRAY) {
        return spectrum.array.as_mut().map(Target::Array);
    }
    if stack.ends_with(SPECTRUM_SELECTED_ION) {
        let precursor = spectrum.precursors.last_mut()?;
        // A precursor's values come from its first selected ion.
        return (precursor.selected_ions == 1).then_some(Target::Terms(&mut precursor.terms));
    }
    if stack.ends_with(SPECTRUM_SCAN) {
        return Some(Target::Terms(&mut spectrum.scan_terms));
    }
    (stack.last() == Some(&El::Spectrum)).then_some(Target::Terms(&mut spectrum.terms))
}

/// Validates one array's terms and checks the caps, in ADR 0056's order,
/// before anything is reserved. `None` for an array that is neither m/z nor
/// intensity, which is not decoded.
fn prepare(
    array: &ArrayParse,
    default_length: Option<u64>,
    decoded_bytes: u64,
    has_mz: bool,
    has_intensity: bool,
) -> Result<Option<Prepared>, Fail> {
    let role = match (
        array.terms.has(Term::MzArray),
        array.terms.has(Term::IntensityArray),
    ) {
        (true, true) => return Err(Fail::Spectrum(MzmlSpectrumError::ArrayWithBothRoles)),
        (true, false) => ArrayRole::Mz,
        (false, true) => ArrayRole::Intensity,
        (false, false) => return Ok(None),
    };
    if (role == ArrayRole::Mz && has_mz) || (role == ArrayRole::Intensity && has_intensity) {
        return Err(Fail::Spectrum(MzmlSpectrumError::DuplicateArray(role)));
    }
    let fail = |problem| array_fail(role, problem);
    if array.conflict {
        return Err(fail(ArrayProblem::ConflictingTerm));
    }

    let terms = &array.terms;
    let data_type = match terms.count(|term| matches!(term, Term::DataType(_))) {
        0 => return Err(fail(ArrayProblem::DataTypeMissing)),
        1 => terms
            .stated
            .iter()
            .find_map(|stated| match stated.term {
                Term::DataType(data_type) => Some(data_type),
                _ => None,
            })
            .flatten()
            .ok_or_else(|| fail(ArrayProblem::DataTypeUnsupported))?,
        _ => return Err(fail(ArrayProblem::DataTypeStatedTwice)),
    };
    if terms.has(Term::Numpress) {
        return Err(fail(ArrayProblem::Numpress));
    }
    if terms.has(Term::TruncationOrPrediction) {
        return Err(fail(ArrayProblem::TruncationOrPrediction));
    }
    if terms.has(Term::UnrecognizedCompression) {
        return Err(fail(ArrayProblem::CompressionUnrecognized));
    }
    let zlib = match (terms.has(Term::Zlib), terms.has(Term::NoCompression)) {
        (true, true) => return Err(fail(ArrayProblem::CompressionStatedTwice)),
        (false, false) => return Err(fail(ArrayProblem::CompressionMissing)),
        (zlib, _) => zlib,
    };

    let points = array
        .array_length
        .or(default_length)
        .ok_or_else(|| fail(ArrayProblem::LengthNotDeclared))?;
    if points > MAX_DECODED_ARRAY_POINTS {
        return Err(fail(ArrayProblem::PointCapExceeded));
    }
    let bytes = points
        .checked_mul(data_type.width() as u64)
        .filter(|bytes| *bytes <= MAX_DECODED_ARRAY_BYTES)
        .ok_or_else(|| fail(ArrayProblem::ArrayByteCapExceeded))?;
    decoded_bytes
        .checked_add(bytes)
        .filter(|total| *total <= MAX_DECODED_SPECTRUM_BYTES)
        .ok_or_else(|| fail(ArrayProblem::SpectrumByteCapExceeded))?;

    Ok(Some(Prepared {
        role,
        data_type,
        zlib,
        bytes,
        bound: encoded_bound(bytes, zlib)
            .ok_or_else(|| fail(ArrayProblem::ArrayByteCapExceeded))?,
    }))
}

/// The longest base64 text an array of `bytes` decoded bytes may arrive as.
///
/// Room for zlib's stored blocks (5 bytes per block, plus the header and the
/// checksum), for line breaks, and for surrounding whitespace. The caps bound
/// `bytes`, so this stays far below the inspector's text-run limit.
fn encoded_bound(bytes: u64, zlib: bool) -> Option<u64> {
    let payload = if zlib {
        bytes.checked_add(bytes / 64)?.checked_add(1024)?
    } else {
        bytes
    };
    let base64 = payload.div_ceil(3).checked_mul(4)?;
    base64.checked_add(base64 / 32)?.checked_add(1024)
}

fn decode(prepared: Prepared, mut encoded: Vec<u8>) -> Result<Vec<f64>, ArrayProblem> {
    encoded.retain(|byte| !byte.is_ascii_whitespace());
    let declared =
        usize::try_from(prepared.bytes).map_err(|_| ArrayProblem::ArrayByteCapExceeded)?;
    let raw = if encoded.is_empty() {
        Vec::new()
    } else {
        decode_base64(&encoded)?
    };
    drop(encoded);
    // An empty payload holds no bytes under either compression; whether that is
    // what was declared is the length check's to say.
    let bytes = if prepared.zlib && !raw.is_empty() {
        inflate(&raw, declared)?
    } else {
        raw
    };
    match bytes.len().cmp(&declared) {
        std::cmp::Ordering::Greater => return Err(ArrayProblem::DecodedLongerThanDeclared),
        std::cmp::Ordering::Less => return Err(ArrayProblem::DecodedShorterThanDeclared),
        std::cmp::Ordering::Equal => {}
    }
    widen(&bytes, prepared.data_type)
}

fn decode_base64(encoded: &[u8]) -> Result<Vec<u8>, ArrayProblem> {
    let estimate = base64::decoded_len_estimate(encoded.len());
    let mut raw = Vec::new();
    raw.try_reserve_exact(estimate)
        .map_err(|_| ArrayProblem::AllocationRefused)?;
    raw.resize(estimate, 0);
    let written = STANDARD
        .decode_slice(encoded, &mut raw)
        .map_err(|_| ArrayProblem::CorruptBase64)?;
    raw.truncate(written);
    Ok(raw)
}

/// Inflates into a buffer of the declared length + 1, so a stream that would
/// produce more stops one byte past what was declared.
fn inflate(compressed: &[u8], declared: usize) -> Result<Vec<u8>, ArrayProblem> {
    let limit = declared
        .checked_add(1)
        .ok_or(ArrayProblem::ArrayByteCapExceeded)?;
    let mut out = Vec::new();
    out.try_reserve_exact(limit)
        .map_err(|_| ArrayProblem::AllocationRefused)?;
    let mut stream = Decompress::new(true);
    loop {
        let consumed = usize::try_from(stream.total_in()).map_err(|_| ArrayProblem::CorruptZlib)?;
        let input = compressed
            .get(consumed..)
            .ok_or(ArrayProblem::CorruptZlib)?;
        let produced = out.len();
        let status = stream
            .decompress_vec(input, &mut out, FlushDecompress::Finish)
            .map_err(|_| ArrayProblem::CorruptZlib)?;
        if out.len() > declared {
            return Err(ArrayProblem::DecodedLongerThanDeclared);
        }
        match status {
            Status::StreamEnd => break,
            Status::Ok | Status::BufError => {
                let progressed = out.len() != produced
                    || usize::try_from(stream.total_in()).ok() != Some(consumed);
                if !progressed {
                    // The input ended before the stream did.
                    return Err(ArrayProblem::CorruptZlib);
                }
            }
        }
    }
    if usize::try_from(stream.total_in()).ok() != Some(compressed.len()) {
        // Bytes after the end of the stream are not part of the array.
        return Err(ArrayProblem::CorruptZlib);
    }
    Ok(out)
}

/// Widens stored little-endian values to `f64`, refusing any value that does
/// not widen exactly or is not finite.
fn widen(bytes: &[u8], data_type: BinaryDataType) -> Result<Vec<f64>, ArrayProblem> {
    let width = data_type.width();
    let mut values = Vec::new();
    values
        .try_reserve_exact(bytes.len() / width)
        .map_err(|_| ArrayProblem::AllocationRefused)?;
    for chunk in bytes.chunks_exact(width) {
        let value = match data_type {
            BinaryDataType::Float32 => {
                let mut stored = [0_u8; 4];
                stored.copy_from_slice(chunk);
                f64::from(f32::from_le_bytes(stored))
            }
            BinaryDataType::Float64 => {
                let mut stored = [0_u8; 8];
                stored.copy_from_slice(chunk);
                f64::from_le_bytes(stored)
            }
            BinaryDataType::Integer32 => {
                let mut stored = [0_u8; 4];
                stored.copy_from_slice(chunk);
                f64::from(i32::from_le_bytes(stored))
            }
            BinaryDataType::Integer64 => {
                let mut stored = [0_u8; 8];
                stored.copy_from_slice(chunk);
                exact_f64(i64::from_le_bytes(stored)).ok_or(ArrayProblem::IntegerNotExact)?
            }
        };
        if !value.is_finite() {
            return Err(ArrayProblem::NonFiniteValue);
        }
        values.push(value);
    }
    Ok(values)
}

/// Whether a declared unit is an accession, `PREFIX:ID` with each part 1 to 32
/// ASCII letters or digits. A unit reaches export documents and figure labels,
/// which admit no delimiter, line break or markup, so anything else is refused
/// rather than carried. A metadata parameter's accession or unit accession
/// that fails it is not reported instead.
fn is_accession(value: &str) -> bool {
    let part = |part: &str| {
        (1..=32).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
    };
    value
        .split_once(':')
        .is_some_and(|(prefix, id)| part(prefix) && part(id))
}

/// `value` as `f64`, when `f64` holds it exactly.
fn exact_f64(value: i64) -> Option<f64> {
    // 2^63 is the one rounding result that casts back, saturated, to
    // `i64::MAX`, and so would pass the round trip without being equal.
    const TWO_POW_63: f64 = 9_223_372_036_854_775_808.0;
    let widened = value as f64;
    (widened < TWO_POW_63 && widened as i64 == value).then_some(widened)
}

/// One row from a finished spectrum's terms, under the open's rules.
fn spectrum_row(spectrum: &mut SpectrumParse) -> Result<MzmlSpectrumRow, Fail> {
    let missing = |value| Fail::Open(MzmlOpenError::MissingRequiredValue(value));
    let index = spectrum
        .index
        .ok_or_else(|| missing(RequiredValue::Index))?;
    let id = spectrum
        .id
        .take()
        .ok_or_else(|| missing(RequiredValue::NativeId))?;
    let terms = &spectrum.terms;

    let ms_level = terms
        .get(Term::MsLevel)
        .ok_or_else(|| missing(RequiredValue::MsLevel))
        .and_then(|stated| {
            u32::try_from(parse_u64_decimal(&stated.value)?)
                .map_err(|_| malformed(MzmlMalformedKind::InvalidNumber))
        })?;
    let representation = match (terms.has(Term::Centroid), terms.has(Term::Profile)) {
        (true, true) => return Err(MzmlOpenError::ConflictingRepresentation.into()),
        (true, false) => MzmlRepresentation::Centroid,
        (false, true) => MzmlRepresentation::Profile,
        (false, false) => MzmlRepresentation::NotDeclared,
    };
    let start_time = spectrum
        .scan_terms
        .get(Term::ScanStartTime)
        .ok_or_else(|| missing(RequiredValue::ScanStartTime))?;
    let retention_time = MzmlRetentionTime {
        value: finite(&start_time.value)?,
        unit: match start_time.unit.as_deref() {
            None => RetentionTimeUnit::NotDeclared,
            Some("UO:0000010") => RetentionTimeUnit::Second,
            Some("UO:0000031" | "MS:1000038") => RetentionTimeUnit::Minute,
            Some(_) => return Err(MzmlOpenError::UnsupportedRetentionTimeUnit.into()),
        },
    };
    let required = |term, value| {
        terms
            .get(term)
            .ok_or_else(|| missing(value))
            .and_then(|stated| finite(&stated.value))
    };
    // Every precursor's values are checked; the row keeps the first.
    let mut precursors = spectrum.precursors.iter().map(precursor_values);
    let first_precursor = precursors.next().transpose()?;
    precursors.try_for_each(|precursor| precursor.map(drop))?;

    Ok(MzmlSpectrumRow {
        identity: SpectrumIdentity::from_native_identifier(index, id),
        ms_level,
        representation,
        // The spectrum's own terms and groups; the scan's facts are not read.
        polarity: terms.facts.polarity,
        retention_time,
        base_peak_mz: required(Term::BasePeakMz, RequiredValue::BasePeakMz)?,
        base_peak_intensity: required(Term::BasePeakIntensity, RequiredValue::BasePeakIntensity)?,
        total_ion_current: required(Term::TotalIonCurrent, RequiredValue::TotalIonCurrent)?,
        lowest_observed_mz: optional_finite(terms, Term::LowestObservedMz)?,
        highest_observed_mz: optional_finite(terms, Term::HighestObservedMz)?,
        default_array_length: spectrum.default_array_length,
        precursor_count: spectrum.precursor_count,
        first_precursor,
    })
}

fn precursor_values(precursor: &PrecursorParse) -> Result<MzmlPrecursor, Fail> {
    Ok(MzmlPrecursor {
        selected_ion_mz: optional_finite(&precursor.terms, Term::SelectedIonMz)?,
        selected_ion_intensity: optional_finite(&precursor.terms, Term::PeakIntensity)?,
        charge: precursor.terms.facts.charge,
    })
}

fn optional_finite(terms: &Terms, term: Term) -> Result<Option<f64>, Fail> {
    terms
        .get(term)
        .map(|stated| finite(&stated.value))
        .transpose()
}

fn selected_spectrum(
    row: MzmlSpectrumRow,
    spectrum: SpectrumParse,
) -> Result<MzmlSelectedSpectrum, Fail> {
    let precursors = spectrum
        .precursors
        .iter()
        .map(precursor_values)
        .collect::<Result<Vec<_>, _>>()?;
    // An array may be absent only when the spectrum declares no points.
    let absent = |role| {
        if spectrum.default_array_length == Some(0) {
            Ok(MzmlArray::absent())
        } else {
            Err(Fail::Spectrum(MzmlSpectrumError::MissingArray(role)))
        }
    };
    let mz = spectrum.mz.map_or_else(|| absent(ArrayRole::Mz), Ok)?;
    let intensity = spectrum
        .intensity
        .map_or_else(|| absent(ArrayRole::Intensity), Ok)?;
    if mz.values.len() != intensity.values.len() {
        return Err(Fail::Spectrum(MzmlSpectrumError::ArrayLengthsDiffer));
    }
    Ok(MzmlSelectedSpectrum {
        row,
        precursors,
        mz,
        intensity,
    })
}

fn finite(value: &str) -> Result<f64, Fail> {
    let parsed = value
        .trim()
        .parse::<f64>()
        .map_err(|_| malformed(MzmlMalformedKind::InvalidNumber))?;
    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(malformed(MzmlMalformedKind::NonFiniteNumber))
    }
}

#[cfg(test)]
mod tests;
