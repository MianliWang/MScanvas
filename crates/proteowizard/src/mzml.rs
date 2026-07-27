//! Bounded, fail-closed structural inspection of mzML documents.
//!
//! This module extracts the typed facts that conversion integrity compares. It
//! is deliberately narrow:
//!
//! - no document type declaration and no undeclared entity is accepted;
//! - no external reference of any kind is resolved;
//! - no binary array is ever base64-decoded or decompressed, so array point
//!   counts come from the declarative `defaultArrayLength` attribute and the
//!   decompression-bomb class is removed by construction. `encodedLength` is
//!   deliberately not read: it changes legitimately with encoding and
//!   compression, so it is not a comparable fact;
//! - every document is read through a byte-counting reader, so one text node
//!   and the whole document both stay inside explicit limits;
//! - controlled-vocabulary facts are recognized by accession only and are
//!   scoped to their immediate parent element, so an aggregate `fileContent`
//!   marker is never mistaken for a per-spectrum marker.
//!
//! Facts are recorded rather than judged. A document that parses safely but
//! violates a scientific expectation is reported through
//! [`crate::conversion`], not rejected here.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

use quick_xml::errors::Error as XmlError;
use quick_xml::events::attributes::AttrError;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use thiserror::Error;

use crate::fs_guard::{self, RegularFileError};
use crate::preview::SpectrumIdentity;

const MS_LEVEL: &[u8] = b"MS:1000511";
const CENTROID_SPECTRUM: &[u8] = b"MS:1000127";
const PROFILE_SPECTRUM: &[u8] = b"MS:1000128";
const MZ_ARRAY: &[u8] = b"MS:1000514";
const INTENSITY_ARRAY: &[u8] = b"MS:1000515";
const TIME_ARRAY: &[u8] = b"MS:1000595";
const FLOAT_32: &[u8] = b"MS:1000521";
const FLOAT_64: &[u8] = b"MS:1000523";
const INTEGER_32: &[u8] = b"MS:1000519";
const INTEGER_64: &[u8] = b"MS:1000522";
const ZLIB_COMPRESSION: &[u8] = b"MS:1000574";
const NO_COMPRESSION: &[u8] = b"MS:1000576";
const SCAN_START_TIME: &[u8] = b"MS:1000016";
const UNIT_SECOND: &[u8] = b"UO:0000010";
const UNIT_MINUTE: &[u8] = b"UO:0000031";

/// The accepted mzML document roots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MzmlRoot {
    Mzml,
    IndexedMzml,
}

impl MzmlRoot {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Mzml => "mzml",
            Self::IndexedMzml => "indexed_mzml",
        }
    }
}

/// A recognized binary-array role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum ArrayKind {
    Mz = 0,
    Intensity = 1,
    Time = 2,
    /// A binary array whose accession set contained no recognized role.
    Unrecognized = 3,
}

/// A recognized numeric-encoding marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum NumericPrecisionMarker {
    Float32 = 0,
    Float64 = 1,
    Integer32 = 2,
    Integer64 = 3,
}

/// A recognized compression marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum CompressionMarker {
    Zlib = 0,
    NoCompression = 1,
}

/// Whether a unit accession was emitted for `scan start time`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RetentionTimeUnitMarker {
    Second,
    Minute,
    /// A unit accession was emitted but is not one this contract recognizes.
    Unrecognized,
    /// No unit accession was emitted, so the unit stays unknown.
    NotEmitted,
}

/// Whether an explicit profile/centroid marker was emitted for one spectrum.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum RepresentationMarker {
    #[default]
    NotEmitted,
    Profile,
    Centroid,
    /// Both markers were emitted for the same spectrum.
    Conflicting,
}

impl RepresentationMarker {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotEmitted => "not_emitted",
            Self::Profile => "profile",
            Self::Centroid => "centroid",
            Self::Conflicting => "conflicting",
        }
    }

    const fn combine(self, observed: Self) -> Self {
        match (self, observed) {
            (Self::NotEmitted, other) | (other, Self::NotEmitted) => other,
            (Self::Profile, Self::Profile) => Self::Profile,
            (Self::Centroid, Self::Centroid) => Self::Centroid,
            _ => Self::Conflicting,
        }
    }
}

macro_rules! marker_set {
    ($name:ident, $marker:ty, $doc:literal) => {
        #[doc = $doc]
        #[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
        pub struct $name(u8);

        impl $name {
            #[must_use]
            pub const fn is_empty(self) -> bool {
                self.0 == 0
            }

            #[must_use]
            pub const fn contains(self, marker: $marker) -> bool {
                self.0 & (1 << marker as u8) != 0
            }

            #[must_use]
            pub const fn bits(self) -> u8 {
                self.0
            }

            fn insert(&mut self, marker: $marker) {
                self.0 |= 1 << marker as u8;
            }

            fn merge(&mut self, other: Self) {
                self.0 |= other.0;
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(formatter, "{}(0b{:04b})", stringify!($name), self.0)
            }
        }
    };
}

marker_set!(
    ArrayKindSet,
    ArrayKind,
    "The set of binary-array roles observed for one record. An empty set means no array was observed."
);
marker_set!(
    NumericPrecisionSet,
    NumericPrecisionMarker,
    "The set of numeric-encoding markers observed. An empty set means none was emitted."
);
marker_set!(
    CompressionSet,
    CompressionMarker,
    "The set of compression markers observed. An empty set means none was emitted."
);

/// Compact per-spectrum facts. No raw scientific value is retained.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzmlSpectrumRecord {
    index: Option<u64>,
    ms_level: Option<u32>,
    default_array_length: Option<u64>,
    binary_array_count: u32,
    zlib_compressed_array_count: u32,
    precursor_count: u32,
    scan_number: Option<u64>,
    native_identifier_recognized: bool,
    array_kinds: ArrayKindSet,
    precision: NumericPrecisionSet,
    compression: CompressionSet,
    representation: RepresentationMarker,
}

impl MzmlSpectrumRecord {
    /// The declared zero-based `index` attribute, if the writer emitted one.
    #[must_use]
    pub const fn index(&self) -> Option<u64> {
        self.index
    }

    #[must_use]
    pub const fn ms_level(&self) -> Option<u32> {
        self.ms_level
    }

    /// The declared point count of every binary array in this spectrum.
    #[must_use]
    pub const fn default_array_length(&self) -> Option<u64> {
        self.default_array_length
    }

    #[must_use]
    pub const fn binary_array_count(&self) -> u32 {
        self.binary_array_count
    }

    /// How many of this spectrum's binary arrays individually carried a zlib
    /// compression marker. A union of compression markers cannot answer this,
    /// because an array that emits no marker contributes nothing to the union.
    #[must_use]
    pub const fn zlib_compressed_array_count(&self) -> u32 {
        self.zlib_compressed_array_count
    }

    #[must_use]
    pub const fn precursor_count(&self) -> u32 {
        self.precursor_count
    }

    /// The scan number recovered from a recognized native identifier form.
    #[must_use]
    pub const fn scan_number(&self) -> Option<u64> {
        self.scan_number
    }

    /// Whether the native identifier matched a form this contract compares.
    /// An unrecognized form stays opaque instead of being coerced or rejected.
    #[must_use]
    pub const fn native_identifier_recognized(&self) -> bool {
        self.native_identifier_recognized
    }

    #[must_use]
    pub const fn array_kinds(&self) -> ArrayKindSet {
        self.array_kinds
    }

    #[must_use]
    pub const fn precision(&self) -> NumericPrecisionSet {
        self.precision
    }

    #[must_use]
    pub const fn compression(&self) -> CompressionSet {
        self.compression
    }

    #[must_use]
    pub const fn representation(&self) -> RepresentationMarker {
        self.representation
    }
}

/// Compact per-chromatogram facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzmlChromatogramRecord {
    index: Option<u64>,
    default_array_length: Option<u64>,
    binary_array_count: u32,
    zlib_compressed_array_count: u32,
    array_kinds: ArrayKindSet,
    precision: NumericPrecisionSet,
    compression: CompressionSet,
}

impl MzmlChromatogramRecord {
    #[must_use]
    pub const fn index(&self) -> Option<u64> {
        self.index
    }

    #[must_use]
    pub const fn default_array_length(&self) -> Option<u64> {
        self.default_array_length
    }

    #[must_use]
    pub const fn binary_array_count(&self) -> u32 {
        self.binary_array_count
    }

    /// How many of this chromatogram's binary arrays individually carried a
    /// zlib compression marker.
    #[must_use]
    pub const fn zlib_compressed_array_count(&self) -> u32 {
        self.zlib_compressed_array_count
    }

    #[must_use]
    pub const fn array_kinds(&self) -> ArrayKindSet {
        self.array_kinds
    }

    #[must_use]
    pub const fn precision(&self) -> NumericPrecisionSet {
        self.precision
    }

    #[must_use]
    pub const fn compression(&self) -> CompressionSet {
        self.compression
    }
}

/// Explicit inspection limits. Every limit fails closed rather than truncating.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzmlScanLimits {
    max_document_bytes: u64,
    max_text_run_bytes: u64,
    max_depth: usize,
    max_elements: u64,
    max_attributes_per_element: usize,
    max_name_bytes: usize,
    max_attribute_value_bytes: usize,
    max_spectra: u64,
    max_chromatograms: u64,
    identity_sample_limit: usize,
}

impl Default for MzmlScanLimits {
    fn default() -> Self {
        Self {
            max_document_bytes: 4 * 1024 * 1024 * 1024,
            max_text_run_bytes: 256 * 1024 * 1024,
            max_depth: 64,
            max_elements: 200_000_000,
            max_attributes_per_element: 64,
            max_name_bytes: 256,
            max_attribute_value_bytes: 64 * 1024,
            max_spectra: 1_000_000,
            max_chromatograms: 100_000,
            identity_sample_limit: 256,
        }
    }
}

macro_rules! limit_setters {
    ($($setter:ident: $field:ident: $kind:ty),* $(,)?) => {
        impl MzmlScanLimits {
            $(
                /// Overrides one inspection limit.
                #[must_use]
                pub const fn $setter(mut self, value: $kind) -> Self {
                    self.$field = value;
                    self
                }
            )*
        }
    };
}

limit_setters!(
    with_max_document_bytes: max_document_bytes: u64,
    with_max_text_run_bytes: max_text_run_bytes: u64,
    with_max_depth: max_depth: usize,
    with_max_elements: max_elements: u64,
    with_max_attributes_per_element: max_attributes_per_element: usize,
    with_max_name_bytes: max_name_bytes: usize,
    with_max_attribute_value_bytes: max_attribute_value_bytes: usize,
    with_max_spectra: max_spectra: u64,
    with_max_chromatograms: max_chromatograms: u64,
    with_identity_sample_limit: identity_sample_limit: usize,
);

/// An XML construct that is refused before any fact is trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsafeXmlKind {
    /// A `<!DOCTYPE ...>` declaration was present.
    DoctypeDeclaration,
    /// A general reference other than a predefined entity or a numeric
    /// character reference was present.
    UndeclaredEntity,
}

impl UnsafeXmlKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::DoctypeDeclaration => "doctype_declaration",
            Self::UndeclaredEntity => "undeclared_entity",
        }
    }
}

/// A structural reason the document cannot be inspected as mzML.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzmlMalformedKind {
    NotWellFormed,
    DuplicateAttribute,
    InvalidUtf8,
    MissingRootElement,
    UnexpectedRoot,
    InvalidNumber,
    NonFiniteNumber,
}

impl MzmlMalformedKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotWellFormed => "not_well_formed",
            Self::DuplicateAttribute => "duplicate_attribute",
            Self::InvalidUtf8 => "invalid_utf8",
            Self::MissingRootElement => "missing_root_element",
            Self::UnexpectedRoot => "unexpected_root",
            Self::InvalidNumber => "invalid_number",
            Self::NonFiniteNumber => "non_finite_number",
        }
    }
}

/// Which explicit inspection limit the document exceeded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzmlLimitKind {
    DocumentBytes,
    TextRunBytes,
    Depth,
    Elements,
    AttributesPerElement,
    NameBytes,
    AttributeValueBytes,
    Spectra,
    Chromatograms,
}

impl MzmlLimitKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::DocumentBytes => "document_bytes",
            Self::TextRunBytes => "text_run_bytes",
            Self::Depth => "depth",
            Self::Elements => "elements",
            Self::AttributesPerElement => "attributes_per_element",
            Self::NameBytes => "name_bytes",
            Self::AttributeValueBytes => "attribute_value_bytes",
            Self::Spectra => "spectra",
            Self::Chromatograms => "chromatograms",
        }
    }
}

/// Why an mzML document could not be inspected. No variant contains a path or
/// raw document text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum MzmlScanError {
    #[error("the mzML source could not be opened safely: {0}")]
    Source(#[from] RegularFileError),
    #[error("the document uses an unsafe XML construct")]
    Unsafe(UnsafeXmlKind),
    #[error("the document is not usable mzML")]
    Malformed(MzmlMalformedKind),
    #[error("the document exceeded an explicit inspection limit")]
    LimitExceeded(MzmlLimitKind),
    #[error("the mzML source could not be read: {kind}")]
    Io { kind: io::ErrorKind },
}

impl MzmlScanError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Source(error) => error.stable_id(),
            Self::Unsafe(kind) => kind.stable_id(),
            Self::Malformed(kind) => kind.stable_id(),
            Self::LimitExceeded(kind) => kind.stable_id(),
            Self::Io { .. } => "io_error",
        }
    }
}

/// Typed structural facts extracted from one mzML document.
#[derive(Clone, PartialEq)]
pub struct MzmlFacts {
    root: MzmlRoot,
    declared_spectrum_count: Option<u64>,
    declared_chromatogram_count: Option<u64>,
    spectra: Vec<MzmlSpectrumRecord>,
    chromatograms: Vec<MzmlChromatogramRecord>,
    ms_level_distribution: BTreeMap<Option<u32>, u64>,
    retention_time_units: BTreeSet<RetentionTimeUnitMarker>,
    parameter_group_reference_observed: bool,
    first_identities: Vec<SpectrumIdentity>,
    last_identity: Option<SpectrumIdentity>,
    scanned_bytes: u64,
}

impl fmt::Debug for MzmlFacts {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MzmlFacts")
            .field("root", &self.root)
            .field("declared_spectrum_count", &self.declared_spectrum_count)
            .field("observed_spectrum_count", &self.spectra.len())
            .field(
                "declared_chromatogram_count",
                &self.declared_chromatogram_count,
            )
            .field("observed_chromatogram_count", &self.chromatograms.len())
            .field("ms_level_bucket_count", &self.ms_level_distribution.len())
            .field("retention_time_units", &self.retention_time_units)
            .field(
                "parameter_group_reference_observed",
                &self.parameter_group_reference_observed,
            )
            .field("retained_identity_count", &self.first_identities.len())
            .field("scanned_bytes", &self.scanned_bytes)
            .finish()
    }
}

impl MzmlFacts {
    #[must_use]
    pub const fn root(&self) -> MzmlRoot {
        self.root
    }

    /// The `spectrumList/@count` attribute when the writer emitted one.
    #[must_use]
    pub const fn declared_spectrum_count(&self) -> Option<u64> {
        self.declared_spectrum_count
    }

    #[must_use]
    pub fn observed_spectrum_count(&self) -> u64 {
        self.spectra.len() as u64
    }

    #[must_use]
    pub const fn declared_chromatogram_count(&self) -> Option<u64> {
        self.declared_chromatogram_count
    }

    #[must_use]
    pub fn observed_chromatogram_count(&self) -> u64 {
        self.chromatograms.len() as u64
    }

    #[must_use]
    pub fn spectra(&self) -> &[MzmlSpectrumRecord] {
        &self.spectra
    }

    #[must_use]
    pub fn chromatograms(&self) -> &[MzmlChromatogramRecord] {
        &self.chromatograms
    }

    /// Spectrum counts per MS level. `None` collects spectra whose MS level was
    /// not emitted.
    #[must_use]
    pub const fn ms_level_distribution(&self) -> &BTreeMap<Option<u32>, u64> {
        &self.ms_level_distribution
    }

    #[must_use]
    pub const fn retention_time_units(&self) -> &BTreeSet<RetentionTimeUnitMarker> {
        &self.retention_time_units
    }

    /// Whether any spectrum, scan or binary array referenced a
    /// `referenceableParamGroup`. When it did, controlled-vocabulary facts may
    /// be indirect, so integrity comparison degrades them to unverified rather
    /// than treating an absent marker as an emitted absence.
    #[must_use]
    pub const fn parameter_group_reference_observed(&self) -> bool {
        self.parameter_group_reference_observed
    }

    /// Whether every spectrum emitted an `index` forming a contiguous
    /// `0..observed_spectrum_count` sequence.
    #[must_use]
    pub fn spectrum_index_sequence_is_consecutive(&self) -> bool {
        indices_are_consecutive(self.spectra.iter().map(MzmlSpectrumRecord::index))
    }

    /// Whether every chromatogram emitted an `index` forming a contiguous
    /// `0..observed_chromatogram_count` sequence.
    #[must_use]
    pub fn chromatogram_index_sequence_is_consecutive(&self) -> bool {
        indices_are_consecutive(self.chromatograms.iter().map(MzmlChromatogramRecord::index))
    }

    /// A bounded sample of leading raw spectrum identities, kept for diagnosis
    /// of unrecognized identifier forms. Treat the raw values as sensitive.
    #[must_use]
    pub fn retained_leading_identities(&self) -> &[SpectrumIdentity] {
        &self.first_identities
    }

    /// The final raw spectrum identity. Treat the raw value as sensitive.
    #[must_use]
    pub const fn retained_final_identity(&self) -> Option<&SpectrumIdentity> {
        self.last_identity.as_ref()
    }

    /// Bytes consumed while inspecting the document.
    #[must_use]
    pub const fn scanned_bytes(&self) -> u64 {
        self.scanned_bytes
    }
}

fn indices_are_consecutive(indices: impl Iterator<Item = Option<u64>>) -> bool {
    indices
        .enumerate()
        .all(|(position, index)| index == Some(position as u64))
}

/// Inspects an mzML file after refusing any non-regular, symlinked or
/// reparse-point path.
pub fn inspect_file(path: &Path, limits: MzmlScanLimits) -> Result<MzmlFacts, MzmlScanError> {
    let (file, _length) = fs_guard::open_regular_file(path)?;
    inspect_reader(BufReader::with_capacity(64 * 1024, file), limits)
}

/// Inspects an mzML document from any buffered reader.
pub fn inspect_reader<R: BufRead>(
    reader: R,
    limits: MzmlScanLimits,
) -> Result<MzmlFacts, MzmlScanError> {
    let mut xml = Reader::from_reader(BoundedReader::new(
        reader,
        limits.max_document_bytes,
        limits.max_text_run_bytes,
    ));
    let config = xml.config_mut();
    config.check_end_names = true;
    config.allow_unmatched_ends = false;
    config.allow_dangling_amp = false;
    config.expand_empty_elements = false;

    let mut state = ScanState::new(limits);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match xml.read_event_into(&mut buffer) {
            Ok(Event::Eof) => break,
            Ok(event) => state.handle(event)?,
            Err(error) => return Err(map_xml_error(xml.get_mut().tripped, error)),
        }
        xml.get_mut().mark_event_boundary();
    }

    state.finish(xml.get_mut().consumed())
}

fn map_xml_error(tripped: Option<MzmlLimitKind>, error: XmlError) -> MzmlScanError {
    if let Some(kind) = tripped {
        return MzmlScanError::LimitExceeded(kind);
    }
    match error {
        XmlError::Io(source) => MzmlScanError::Io {
            kind: source.kind(),
        },
        XmlError::Encoding(_) => MzmlScanError::Malformed(MzmlMalformedKind::InvalidUtf8),
        XmlError::Escape(_) => MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity),
        XmlError::InvalidAttr(AttrError::Duplicated(_, _)) => {
            MzmlScanError::Malformed(MzmlMalformedKind::DuplicateAttribute)
        }
        XmlError::Syntax(_)
        | XmlError::IllFormed(_)
        | XmlError::InvalidAttr(_)
        | XmlError::Namespace(_) => MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed),
    }
}

/// A buffered reader that refuses to hand out more bytes once the document or a
/// single text run exceeds its limit. Tripping is recorded before the error is
/// returned so a limit is never reported as an ordinary I/O failure.
struct BoundedReader<R> {
    inner: R,
    consumed: u64,
    event_start: u64,
    max_document_bytes: u64,
    max_text_run_bytes: u64,
    tripped: Option<MzmlLimitKind>,
}

impl<R> BoundedReader<R> {
    const fn new(inner: R, max_document_bytes: u64, max_text_run_bytes: u64) -> Self {
        Self {
            inner,
            consumed: 0,
            event_start: 0,
            max_document_bytes,
            max_text_run_bytes,
            tripped: None,
        }
    }

    const fn consumed(&self) -> u64 {
        self.consumed
    }

    const fn mark_event_boundary(&mut self) {
        self.event_start = self.consumed;
    }

    fn trip(&mut self, kind: MzmlLimitKind) -> io::Error {
        self.tripped = Some(kind);
        io::Error::new(io::ErrorKind::OutOfMemory, "inspection limit exceeded")
    }
}

impl<R: BufRead> io::Read for BoundedReader<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let available = self.fill_buf()?;
        let count = available.len().min(out.len());
        out[..count].copy_from_slice(&available[..count]);
        self.consume(count);
        Ok(count)
    }
}

impl<R: BufRead> BufRead for BoundedReader<R> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        if self.consumed > self.max_document_bytes {
            return Err(self.trip(MzmlLimitKind::DocumentBytes));
        }
        if self.consumed - self.event_start > self.max_text_run_bytes {
            return Err(self.trip(MzmlLimitKind::TextRunBytes));
        }
        self.inner.fill_buf()
    }

    fn consume(&mut self, amount: usize) {
        self.consumed = self.consumed.saturating_add(amount as u64);
        self.inner.consume(amount);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scope {
    SpectrumList,
    Spectrum,
    ChromatogramList,
    Chromatogram,
    BinaryDataArray,
    PrecursorList,
    Scan,
    Other,
}

#[derive(Debug, Default)]
struct SpectrumBuilder {
    index: Option<u64>,
    ms_level: Option<u32>,
    default_array_length: Option<u64>,
    binary_array_count: u32,
    zlib_compressed_array_count: u32,
    precursor_count: u32,
    scan_number: Option<u64>,
    native_identifier_recognized: bool,
    array_kinds: ArrayKindSet,
    precision: NumericPrecisionSet,
    compression: CompressionSet,
    representation: RepresentationMarker,
}

#[derive(Debug, Default)]
struct ChromatogramBuilder {
    index: Option<u64>,
    default_array_length: Option<u64>,
    binary_array_count: u32,
    zlib_compressed_array_count: u32,
    array_kinds: ArrayKindSet,
    precision: NumericPrecisionSet,
    compression: CompressionSet,
}

#[derive(Debug, Default)]
struct ArrayBuilder {
    kinds: ArrayKindSet,
    precision: NumericPrecisionSet,
    compression: CompressionSet,
}

struct ScanState {
    limits: MzmlScanLimits,
    stack: Vec<Scope>,
    element_count: u64,
    root: Option<MzmlRoot>,
    declared_spectrum_count: Option<u64>,
    declared_chromatogram_count: Option<u64>,
    spectra: Vec<MzmlSpectrumRecord>,
    chromatograms: Vec<MzmlChromatogramRecord>,
    ms_level_distribution: BTreeMap<Option<u32>, u64>,
    retention_time_units: BTreeSet<RetentionTimeUnitMarker>,
    parameter_group_reference_observed: bool,
    first_identities: Vec<SpectrumIdentity>,
    last_identity: Option<SpectrumIdentity>,
    spectrum: Option<SpectrumBuilder>,
    chromatogram: Option<ChromatogramBuilder>,
    array: Option<ArrayBuilder>,
}

impl ScanState {
    fn new(limits: MzmlScanLimits) -> Self {
        Self {
            limits,
            stack: Vec::new(),
            element_count: 0,
            root: None,
            declared_spectrum_count: None,
            declared_chromatogram_count: None,
            spectra: Vec::new(),
            chromatograms: Vec::new(),
            ms_level_distribution: BTreeMap::new(),
            retention_time_units: BTreeSet::new(),
            parameter_group_reference_observed: false,
            first_identities: Vec::new(),
            last_identity: None,
            spectrum: None,
            chromatogram: None,
            array: None,
        }
    }

    fn handle(&mut self, event: Event<'_>) -> Result<(), MzmlScanError> {
        match event {
            Event::DocType(_) => Err(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration)),
            Event::GeneralRef(reference) => {
                let name = reference
                    .decode()
                    .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::InvalidUtf8))?;
                if is_predefined_reference(&name) {
                    Ok(())
                } else {
                    Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity))
                }
            }
            Event::Start(start) => {
                let scope = self.begin(&start)?;
                if self.stack.len() >= self.limits.max_depth {
                    return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Depth));
                }
                self.stack.push(scope);
                Ok(())
            }
            Event::Empty(start) => {
                let scope = self.begin(&start)?;
                self.end(scope);
                Ok(())
            }
            Event::End(_) => {
                let scope = self
                    .stack
                    .pop()
                    .ok_or(MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed))?;
                self.end(scope);
                Ok(())
            }
            Event::Text(_)
            | Event::CData(_)
            | Event::Comment(_)
            | Event::Decl(_)
            | Event::PI(_) => Ok(()),
            Event::Eof => Ok(()),
        }
    }

    fn begin(&mut self, start: &BytesStart<'_>) -> Result<Scope, MzmlScanError> {
        self.element_count += 1;
        if self.element_count > self.limits.max_elements {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Elements));
        }
        let qualified_name = start.name();
        if qualified_name.as_ref().len() > self.limits.max_name_bytes {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::NameBytes));
        }
        let local_name = start.local_name();
        let local = local_name.as_ref();
        let attributes = capture_attributes(start, self.limits)?;

        if self.root.is_none() {
            self.root = Some(match local {
                b"mzML" => MzmlRoot::Mzml,
                b"indexedmzML" => MzmlRoot::IndexedMzml,
                _ => return Err(MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot)),
            });
            return Ok(Scope::Other);
        }

        let parent = self.stack.last().copied();

        match local {
            b"spectrumList" => {
                self.declared_spectrum_count = optional_u64(attributes.count.as_deref())?;
                Ok(Scope::SpectrumList)
            }
            b"chromatogramList" => {
                self.declared_chromatogram_count = optional_u64(attributes.count.as_deref())?;
                Ok(Scope::ChromatogramList)
            }
            b"spectrum" if parent == Some(Scope::SpectrumList) => {
                if self.spectra.len() as u64 >= self.limits.max_spectra {
                    return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Spectra));
                }
                self.begin_spectrum(&attributes)?;
                Ok(Scope::Spectrum)
            }
            b"chromatogram" if parent == Some(Scope::ChromatogramList) => {
                if self.chromatograms.len() as u64 >= self.limits.max_chromatograms {
                    return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Chromatograms));
                }
                self.chromatogram = Some(ChromatogramBuilder {
                    index: optional_u64(attributes.index.as_deref())?,
                    default_array_length: optional_u64(attributes.default_array_length.as_deref())?,
                    ..ChromatogramBuilder::default()
                });
                Ok(Scope::Chromatogram)
            }
            b"binaryDataArray" => {
                if self.spectrum.is_some() || self.chromatogram.is_some() {
                    self.array = Some(ArrayBuilder::default());
                    Ok(Scope::BinaryDataArray)
                } else {
                    Ok(Scope::Other)
                }
            }
            b"precursorList" => Ok(Scope::PrecursorList),
            b"precursor" if parent == Some(Scope::PrecursorList) => {
                if let Some(spectrum) = self.spectrum.as_mut() {
                    spectrum.precursor_count = spectrum.precursor_count.saturating_add(1);
                }
                Ok(Scope::Other)
            }
            b"scan" => Ok(Scope::Scan),
            b"referenceableParamGroupRef" => {
                if matches!(
                    parent,
                    Some(Scope::Spectrum | Scope::BinaryDataArray | Scope::Scan)
                ) {
                    self.parameter_group_reference_observed = true;
                }
                Ok(Scope::Other)
            }
            b"cvParam" => {
                self.apply_cv_param(parent, &attributes)?;
                Ok(Scope::Other)
            }
            _ => Ok(Scope::Other),
        }
    }

    fn begin_spectrum(&mut self, attributes: &CapturedAttributes<'_>) -> Result<(), MzmlScanError> {
        let index = optional_u64(attributes.index.as_deref())?;
        // A document that omits the schema-required `index` still yields a usable
        // identity sample; its missing index is reported through the record and
        // fails the consecutive-index property rather than being invented here.
        let identity = attributes
            .id
            .as_deref()
            .map(|raw| SpectrumIdentity::from_native_identifier(index.unwrap_or_default(), raw));
        let scan_number = identity.as_ref().and_then(SpectrumIdentity::scan_number);
        if let Some(identity) = identity {
            if self.first_identities.len() < self.limits.identity_sample_limit {
                self.first_identities.push(identity.clone());
            }
            self.last_identity = Some(identity);
        }

        self.spectrum = Some(SpectrumBuilder {
            index,
            default_array_length: optional_u64(attributes.default_array_length.as_deref())?,
            scan_number,
            native_identifier_recognized: scan_number.is_some(),
            ..SpectrumBuilder::default()
        });
        Ok(())
    }

    fn apply_cv_param(
        &mut self,
        parent: Option<Scope>,
        attributes: &CapturedAttributes<'_>,
    ) -> Result<(), MzmlScanError> {
        let Some(accession) = attributes.accession.as_deref() else {
            return Ok(());
        };
        let accession = accession.as_bytes();

        match parent {
            Some(Scope::Spectrum) => {
                let Some(spectrum) = self.spectrum.as_mut() else {
                    return Ok(());
                };
                if accession == MS_LEVEL {
                    spectrum.ms_level = optional_u64(attributes.value.as_deref())?
                        .map(u32::try_from)
                        .transpose()
                        .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber))?;
                } else if accession == PROFILE_SPECTRUM {
                    spectrum.representation = spectrum
                        .representation
                        .combine(RepresentationMarker::Profile);
                } else if accession == CENTROID_SPECTRUM {
                    spectrum.representation = spectrum
                        .representation
                        .combine(RepresentationMarker::Centroid);
                }
                Ok(())
            }
            Some(Scope::BinaryDataArray) => {
                let Some(array) = self.array.as_mut() else {
                    return Ok(());
                };
                match accession {
                    MZ_ARRAY => array.kinds.insert(ArrayKind::Mz),
                    INTENSITY_ARRAY => array.kinds.insert(ArrayKind::Intensity),
                    TIME_ARRAY => array.kinds.insert(ArrayKind::Time),
                    FLOAT_32 => array.precision.insert(NumericPrecisionMarker::Float32),
                    FLOAT_64 => array.precision.insert(NumericPrecisionMarker::Float64),
                    INTEGER_32 => array.precision.insert(NumericPrecisionMarker::Integer32),
                    INTEGER_64 => array.precision.insert(NumericPrecisionMarker::Integer64),
                    ZLIB_COMPRESSION => array.compression.insert(CompressionMarker::Zlib),
                    NO_COMPRESSION => array.compression.insert(CompressionMarker::NoCompression),
                    _ => {}
                }
                Ok(())
            }
            Some(Scope::Scan) if accession == SCAN_START_TIME => {
                if let Some(value) = attributes.value.as_deref() {
                    require_finite(value)?;
                }
                self.retention_time_units
                    .insert(match attributes.unit_accession.as_deref() {
                        Some(unit) if unit.as_bytes() == UNIT_SECOND => {
                            RetentionTimeUnitMarker::Second
                        }
                        Some(unit) if unit.as_bytes() == UNIT_MINUTE => {
                            RetentionTimeUnitMarker::Minute
                        }
                        Some(unit) if !unit.trim().is_empty() => {
                            RetentionTimeUnitMarker::Unrecognized
                        }
                        _ => RetentionTimeUnitMarker::NotEmitted,
                    });
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn end(&mut self, scope: Scope) {
        match scope {
            Scope::Spectrum => self.finish_spectrum(),
            Scope::Chromatogram => self.finish_chromatogram(),
            Scope::BinaryDataArray => self.finish_array(),
            Scope::SpectrumList
            | Scope::ChromatogramList
            | Scope::PrecursorList
            | Scope::Scan
            | Scope::Other => {}
        }
    }

    fn finish_array(&mut self) {
        let Some(array) = self.array.take() else {
            return;
        };
        let kinds = if array.kinds.is_empty() {
            let mut kinds = ArrayKindSet::default();
            kinds.insert(ArrayKind::Unrecognized);
            kinds
        } else {
            array.kinds
        };

        let zlib = u32::from(array.compression.contains(CompressionMarker::Zlib));
        if let Some(spectrum) = self.spectrum.as_mut() {
            spectrum.binary_array_count = spectrum.binary_array_count.saturating_add(1);
            spectrum.zlib_compressed_array_count =
                spectrum.zlib_compressed_array_count.saturating_add(zlib);
            spectrum.array_kinds.merge(kinds);
            spectrum.precision.merge(array.precision);
            spectrum.compression.merge(array.compression);
        } else if let Some(chromatogram) = self.chromatogram.as_mut() {
            chromatogram.binary_array_count = chromatogram.binary_array_count.saturating_add(1);
            chromatogram.zlib_compressed_array_count = chromatogram
                .zlib_compressed_array_count
                .saturating_add(zlib);
            chromatogram.array_kinds.merge(kinds);
            chromatogram.precision.merge(array.precision);
            chromatogram.compression.merge(array.compression);
        }
    }

    fn finish_spectrum(&mut self) {
        let Some(spectrum) = self.spectrum.take() else {
            return;
        };
        *self
            .ms_level_distribution
            .entry(spectrum.ms_level)
            .or_default() += 1;
        self.spectra.push(MzmlSpectrumRecord {
            index: spectrum.index,
            ms_level: spectrum.ms_level,
            default_array_length: spectrum.default_array_length,
            binary_array_count: spectrum.binary_array_count,
            zlib_compressed_array_count: spectrum.zlib_compressed_array_count,
            precursor_count: spectrum.precursor_count,
            scan_number: spectrum.scan_number,
            native_identifier_recognized: spectrum.native_identifier_recognized,
            array_kinds: spectrum.array_kinds,
            precision: spectrum.precision,
            compression: spectrum.compression,
            representation: spectrum.representation,
        });
    }

    fn finish_chromatogram(&mut self) {
        let Some(chromatogram) = self.chromatogram.take() else {
            return;
        };
        self.chromatograms.push(MzmlChromatogramRecord {
            index: chromatogram.index,
            default_array_length: chromatogram.default_array_length,
            binary_array_count: chromatogram.binary_array_count,
            zlib_compressed_array_count: chromatogram.zlib_compressed_array_count,
            array_kinds: chromatogram.array_kinds,
            precision: chromatogram.precision,
            compression: chromatogram.compression,
        });
    }

    fn finish(self, scanned_bytes: u64) -> Result<MzmlFacts, MzmlScanError> {
        let root = self.root.ok_or(MzmlScanError::Malformed(
            MzmlMalformedKind::MissingRootElement,
        ))?;
        if !self.stack.is_empty() {
            return Err(MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed));
        }
        Ok(MzmlFacts {
            root,
            declared_spectrum_count: self.declared_spectrum_count,
            declared_chromatogram_count: self.declared_chromatogram_count,
            spectra: self.spectra,
            chromatograms: self.chromatograms,
            ms_level_distribution: self.ms_level_distribution,
            retention_time_units: self.retention_time_units,
            parameter_group_reference_observed: self.parameter_group_reference_observed,
            first_identities: self.first_identities,
            last_identity: self.last_identity,
            scanned_bytes,
        })
    }
}

fn is_predefined_reference(name: &str) -> bool {
    match name {
        "amp" | "lt" | "gt" | "quot" | "apos" => true,
        _ => match name.strip_prefix('#') {
            Some(digits) => match digits.strip_prefix(['x', 'X']) {
                Some(hex) => !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()),
                None => !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()),
            },
            None => false,
        },
    }
}

#[derive(Debug, Default)]
struct CapturedAttributes<'a> {
    index: Option<Cow<'a, str>>,
    id: Option<Cow<'a, str>>,
    default_array_length: Option<Cow<'a, str>>,
    count: Option<Cow<'a, str>>,
    accession: Option<Cow<'a, str>>,
    value: Option<Cow<'a, str>>,
    unit_accession: Option<Cow<'a, str>>,
}

fn capture_attributes<'a>(
    start: &'a BytesStart<'_>,
    limits: MzmlScanLimits,
) -> Result<CapturedAttributes<'a>, MzmlScanError> {
    let mut captured = CapturedAttributes::default();
    let mut attributes = start.attributes();
    attributes.with_checks(true);

    let mut observed = 0_usize;
    for attribute in attributes {
        let attribute = attribute.map_err(|error| match error {
            AttrError::Duplicated(_, _) => {
                MzmlScanError::Malformed(MzmlMalformedKind::DuplicateAttribute)
            }
            _ => MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed),
        })?;
        observed += 1;
        if observed > limits.max_attributes_per_element {
            return Err(MzmlScanError::LimitExceeded(
                MzmlLimitKind::AttributesPerElement,
            ));
        }
        if attribute.key.as_ref().len() > limits.max_name_bytes {
            return Err(MzmlScanError::LimitExceeded(MzmlLimitKind::NameBytes));
        }
        if attribute.value.len() > limits.max_attribute_value_bytes {
            return Err(MzmlScanError::LimitExceeded(
                MzmlLimitKind::AttributeValueBytes,
            ));
        }

        let slot = match attribute.key.local_name().as_ref() {
            b"index" => &mut captured.index,
            b"id" => &mut captured.id,
            b"defaultArrayLength" => &mut captured.default_array_length,
            b"count" => &mut captured.count,
            b"accession" => &mut captured.accession,
            b"value" => &mut captured.value,
            b"unitAccession" => &mut captured.unit_accession,
            _ => continue,
        };
        // Normalization resolves only the five predefined entities, so any other
        // general reference in an attribute value fails closed here.
        let value = attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|error| match error {
                XmlError::Escape(_) => MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity),
                XmlError::Encoding(_) => MzmlScanError::Malformed(MzmlMalformedKind::InvalidUtf8),
                _ => MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed),
            })?;
        *slot = Some(value);
    }
    Ok(captured)
}

fn optional_u64(value: Option<&str>) -> Result<Option<u64>, MzmlScanError> {
    value.map(parse_u64_decimal).transpose()
}

fn parse_u64_decimal(value: &str) -> Result<u64, MzmlScanError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber));
    }
    trimmed
        .parse()
        .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber))
}

fn require_finite(value: &str) -> Result<(), MzmlScanError> {
    let parsed = value
        .trim()
        .parse::<f64>()
        .map_err(|_| MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber))?;
    if parsed.is_finite() {
        Ok(())
    } else {
        Err(MzmlScanError::Malformed(MzmlMalformedKind::NonFiniteNumber))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two spectra (MS1 profile, MS2 centroid) and one chromatogram, with the
    /// aggregate profile *and* centroid markers that real mzML puts in
    /// `fileContent` so parent scoping stays under test.
    const TINY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<indexedmzML xmlns="http://psi.hupo.org/ms/mzml">
  <mzML version="1.1.0">
    <fileDescription>
      <fileContent>
        <cvParam cvRef="MS" accession="MS:1000128" name="profile spectrum" value=""/>
        <cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/>
      </fileContent>
    </fileDescription>
    <run id="R1">
      <spectrumList count="2" defaultDataProcessingRef="dp1">
        <spectrum index="0" id="scan=19" defaultArrayLength="15">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/>
          <cvParam cvRef="MS" accession="MS:1000128" name="profile spectrum" value=""/>
          <scanList count="1">
            <scan>
              <cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="5.9" unitAccession="UO:0000031" unitName="minute"/>
              <scanWindowList count="1">
                <scanWindow>
                  <cvParam cvRef="MS" accession="MS:1000501" name="scan window lower limit" value="400"/>
                </scanWindow>
              </scanWindowList>
            </scan>
          </scanList>
          <binaryDataArrayList count="2">
            <binaryDataArray encodedLength="160">
              <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
              <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
              <cvParam cvRef="MS" accession="MS:1000514" name="m/z array" value=""/>
              <binary>AAAA</binary>
            </binaryDataArray>
            <binaryDataArray encodedLength="160">
              <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
              <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
              <cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value=""/>
              <binary>AAAA</binary>
            </binaryDataArray>
          </binaryDataArrayList>
        </spectrum>
        <spectrum index="1" id="scan=20" defaultArrayLength="8">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="2"/>
          <cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/>
          <precursorList count="1">
            <precursor spectrumRef="scan=19">
              <isolationWindow>
                <cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="445.12"/>
              </isolationWindow>
            </precursor>
          </precursorList>
          <binaryDataArrayList count="2">
            <binaryDataArray encodedLength="80">
              <cvParam cvRef="MS" accession="MS:1000521" name="32-bit float" value=""/>
              <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
              <cvParam cvRef="MS" accession="MS:1000514" name="m/z array" value=""/>
              <binary>AA==</binary>
            </binaryDataArray>
            <binaryDataArray encodedLength="80">
              <cvParam cvRef="MS" accession="MS:1000521" name="32-bit float" value=""/>
              <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
              <cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value=""/>
              <binary>AA==</binary>
            </binaryDataArray>
          </binaryDataArrayList>
        </spectrum>
      </spectrumList>
      <chromatogramList count="1" defaultDataProcessingRef="dp1">
        <chromatogram index="0" id="TIC" defaultArrayLength="2">
          <binaryDataArrayList count="2">
            <binaryDataArray encodedLength="16">
              <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
              <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
              <cvParam cvRef="MS" accession="MS:1000595" name="time array" value=""/>
              <binary>AA==</binary>
            </binaryDataArray>
            <binaryDataArray encodedLength="16">
              <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
              <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
              <cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value=""/>
              <binary>AA==</binary>
            </binaryDataArray>
          </binaryDataArrayList>
        </chromatogram>
      </chromatogramList>
    </run>
  </mzML>
  <indexList count="1">
    <index name="spectrum">
      <offset idRef="scan=19">100</offset>
      <offset idRef="scan=20">200</offset>
    </index>
  </indexList>
</indexedmzML>"#;

    /// The same document re-serialized: `mzML` root instead of the indexed
    /// wrapper, different attribute order, reversed `cvParam` order, paired
    /// instead of self-closing elements, a comment, a processing instruction
    /// and no indentation.
    const TINY_RESERIALIZED: &str = concat!(
        r#"<?xml version="1.0"?><!-- regenerated --><?display mode="compact"?>"#,
        r#"<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">"#,
        r#"<fileDescription><fileContent>"#,
        r#"<cvParam accession="MS:1000127" cvRef="MS" name="centroid spectrum"></cvParam>"#,
        r#"<cvParam accession="MS:1000128" cvRef="MS" name="profile spectrum"></cvParam>"#,
        r#"</fileContent></fileDescription>"#,
        r#"<run id="R1"><spectrumList defaultDataProcessingRef="dp1" count="2">"#,
        r#"<spectrum defaultArrayLength="15" id="scan=19" index="0">"#,
        r#"<cvParam name="profile spectrum" accession="MS:1000128" cvRef="MS"></cvParam>"#,
        r#"<cvParam value="1" name="ms level" accession="MS:1000511" cvRef="MS"></cvParam>"#,
        r#"<scanList count="1"><scan><scanWindowList count="1"><scanWindow>"#,
        r#"<cvParam accession="MS:1000501" name="scan window lower limit" value="400"/>"#,
        r#"</scanWindow></scanWindowList>"#,
        r#"<cvParam unitName="minute" unitAccession="UO:0000031" value="5.9" name="scan start time" accession="MS:1000016"/>"#,
        r#"</scan></scanList>"#,
        r#"<binaryDataArrayList count="2">"#,
        r#"<binaryDataArray encodedLength="160">"#,
        r#"<cvParam accession="MS:1000514" name="m/z array"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<cvParam accession="MS:1000523" name="64-bit float"/>"#,
        r#"<binary>AAAA</binary></binaryDataArray>"#,
        r#"<binaryDataArray encodedLength="160">"#,
        r#"<cvParam accession="MS:1000515" name="intensity array"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<cvParam accession="MS:1000523" name="64-bit float"/>"#,
        r#"<binary>AAAA</binary></binaryDataArray>"#,
        r#"</binaryDataArrayList></spectrum>"#,
        r#"<spectrum id="scan=20" defaultArrayLength="8" index="1">"#,
        r#"<cvParam accession="MS:1000127" name="centroid spectrum"/>"#,
        r#"<cvParam accession="MS:1000511" name="ms level" value="2"/>"#,
        r#"<precursorList count="1"><precursor spectrumRef="scan=19"><isolationWindow>"#,
        r#"<cvParam accession="MS:1000827" name="isolation window target m/z" value="445.12"/>"#,
        r#"</isolationWindow></precursor></precursorList>"#,
        r#"<binaryDataArrayList count="2">"#,
        r#"<binaryDataArray encodedLength="80">"#,
        r#"<cvParam accession="MS:1000521" name="32-bit float"/>"#,
        r#"<cvParam accession="MS:1000514" name="m/z array"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<binary>AA==</binary></binaryDataArray>"#,
        r#"<binaryDataArray encodedLength="80">"#,
        r#"<cvParam accession="MS:1000521" name="32-bit float"/>"#,
        r#"<cvParam accession="MS:1000515" name="intensity array"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<binary>AA==</binary></binaryDataArray>"#,
        r#"</binaryDataArrayList></spectrum></spectrumList>"#,
        r#"<chromatogramList count="1" defaultDataProcessingRef="dp1">"#,
        r#"<chromatogram defaultArrayLength="2" id="TIC" index="0">"#,
        r#"<binaryDataArrayList count="2">"#,
        r#"<binaryDataArray encodedLength="16">"#,
        r#"<cvParam accession="MS:1000595" name="time array"/>"#,
        r#"<cvParam accession="MS:1000523" name="64-bit float"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<binary>AA==</binary></binaryDataArray>"#,
        r#"<binaryDataArray encodedLength="16">"#,
        r#"<cvParam accession="MS:1000515" name="intensity array"/>"#,
        r#"<cvParam accession="MS:1000523" name="64-bit float"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<binary>AA==</binary></binaryDataArray>"#,
        r#"</binaryDataArrayList></chromatogram></chromatogramList>"#,
        r#"</run></mzML>"#,
    );

    fn scan(document: &str) -> Result<MzmlFacts, MzmlScanError> {
        inspect_reader(document.as_bytes(), MzmlScanLimits::default())
    }

    fn scan_ok(document: &str) -> MzmlFacts {
        scan(document).expect("the document inspects cleanly")
    }

    fn minimal(body: &str) -> String {
        format!(r#"<mzML><run><spectrumList count="1">{body}</spectrumList></run></mzML>"#)
    }

    #[test]
    fn mzml_and_indexedmzml_roots_are_both_accepted() {
        assert_eq!(scan_ok(TINY).root(), MzmlRoot::IndexedMzml);
        assert_eq!(scan_ok(TINY_RESERIALIZED).root(), MzmlRoot::Mzml);
    }

    #[test]
    fn wrong_root_is_rejected() {
        assert_eq!(
            scan("<notMzML><spectrum/></notMzML>"),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot))
        );
        assert_eq!(
            scan("<?xml version=\"1.0\"?>"),
            Err(MzmlScanError::Malformed(
                MzmlMalformedKind::MissingRootElement
            ))
        );
    }

    #[test]
    fn declared_and_observed_counts_are_both_recorded() {
        let facts = scan_ok(TINY);

        assert_eq!(facts.declared_spectrum_count(), Some(2));
        assert_eq!(facts.observed_spectrum_count(), 2);
        assert_eq!(facts.declared_chromatogram_count(), Some(1));
        assert_eq!(facts.observed_chromatogram_count(), 1);
        assert!(facts.spectrum_index_sequence_is_consecutive());
        assert!(facts.chromatogram_index_sequence_is_consecutive());
        assert_eq!(
            facts.ms_level_distribution(),
            &BTreeMap::from([(Some(1), 1), (Some(2), 1)])
        );
    }

    #[test]
    fn spectrum_and_chromatogram_arrays_are_recorded_without_decoding() {
        let facts = scan_ok(TINY);
        let first = facts.spectra()[0];
        let second = facts.spectra()[1];
        let chromatogram = facts.chromatograms()[0];

        assert_eq!(first.default_array_length(), Some(15));
        assert_eq!(first.binary_array_count(), 2);
        assert_eq!(first.precursor_count(), 0);
        assert!(first.array_kinds().contains(ArrayKind::Mz));
        assert!(first.array_kinds().contains(ArrayKind::Intensity));
        assert!(first.precision().contains(NumericPrecisionMarker::Float64));
        assert!(first.compression().contains(CompressionMarker::Zlib));

        assert_eq!(second.default_array_length(), Some(8));
        assert_eq!(second.precursor_count(), 1);
        assert!(second.precision().contains(NumericPrecisionMarker::Float32));

        assert_eq!(chromatogram.default_array_length(), Some(2));
        assert_eq!(chromatogram.binary_array_count(), 2);
        assert!(chromatogram.array_kinds().contains(ArrayKind::Time));
    }

    #[test]
    fn binary_payload_is_never_decoded_or_decompressed() {
        // A payload that is neither valid base64 nor a valid zlib stream still
        // inspects cleanly, which is only possible because no decode path exists.
        let document = minimal(concat!(
            r#"<spectrum index="0" id="scan=1" defaultArrayLength="3">"#,
            r#"<binaryDataArrayList count="1"><binaryDataArray encodedLength="9">"#,
            r#"<cvParam accession="MS:1000514" name="m/z array"/>"#,
            r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
            r#"<binary>!!! not base64 !!!</binary>"#,
            r#"</binaryDataArray></binaryDataArrayList></spectrum>"#,
        ));
        let facts = scan_ok(&document);

        assert_eq!(facts.observed_spectrum_count(), 1);
        assert_eq!(facts.spectra()[0].binary_array_count(), 1);
        assert_eq!(facts.spectra()[0].default_array_length(), Some(3));
    }

    #[test]
    fn aggregate_file_content_markers_never_become_spectrum_markers() {
        let facts = scan_ok(TINY);

        // fileContent declares both markers; each spectrum declares exactly one.
        assert_eq!(
            facts.spectra()[0].representation(),
            RepresentationMarker::Profile
        );
        assert_eq!(
            facts.spectra()[1].representation(),
            RepresentationMarker::Centroid
        );
    }

    #[test]
    fn contradictory_spectrum_markers_are_reported_as_conflicting() {
        let document = minimal(concat!(
            r#"<spectrum index="0" id="scan=1" defaultArrayLength="1">"#,
            r#"<cvParam accession="MS:1000128" name="profile spectrum"/>"#,
            r#"<cvParam accession="MS:1000127" name="centroid spectrum"/>"#,
            r#"</spectrum>"#,
        ));

        assert_eq!(
            scan_ok(&document).spectra()[0].representation(),
            RepresentationMarker::Conflicting
        );
    }

    #[test]
    fn retention_time_units_are_recorded_without_retaining_values() {
        assert_eq!(
            scan_ok(TINY).retention_time_units(),
            &BTreeSet::from([RetentionTimeUnitMarker::Minute])
        );

        let without_unit = minimal(concat!(
            r#"<spectrum index="0" id="scan=1" defaultArrayLength="1"><scanList count="1"><scan>"#,
            r#"<cvParam accession="MS:1000016" name="scan start time" value="12.5"/>"#,
            r#"</scan></scanList></spectrum>"#,
        ));
        assert_eq!(
            scan_ok(&without_unit).retention_time_units(),
            &BTreeSet::from([RetentionTimeUnitMarker::NotEmitted])
        );
    }

    #[test]
    fn recognized_and_opaque_native_identifiers_are_distinguished() {
        let facts = scan_ok(TINY);
        assert_eq!(facts.spectra()[0].scan_number(), Some(19));
        assert!(facts.spectra()[0].native_identifier_recognized());

        let opaque = minimal(
            r#"<spectrum index="0" id="controllerType=0 controllerNumber=1 scan=5" defaultArrayLength="1"/>"#,
        );
        let facts = scan_ok(&opaque);
        assert_eq!(facts.spectra()[0].scan_number(), None);
        assert!(!facts.spectra()[0].native_identifier_recognized());
        assert_eq!(facts.retained_leading_identities().len(), 1);
    }

    #[test]
    fn parameter_group_references_are_recorded_for_degraded_verification() {
        assert!(!scan_ok(TINY).parameter_group_reference_observed());

        let referenced = minimal(concat!(
            r#"<spectrum index="0" id="scan=1" defaultArrayLength="1">"#,
            r#"<referenceableParamGroupRef ref="CommonSpectrumParams"/>"#,
            r#"</spectrum>"#,
        ));
        assert!(scan_ok(&referenced).parameter_group_reference_observed());
    }

    #[test]
    fn serialization_differences_produce_identical_comparable_facts() {
        let pretty = scan_ok(TINY);
        let compact = scan_ok(TINY_RESERIALIZED);

        assert_ne!(pretty.root(), compact.root());
        assert_eq!(pretty.spectra(), compact.spectra());
        assert_eq!(pretty.chromatograms(), compact.chromatograms());
        assert_eq!(
            pretty.ms_level_distribution(),
            compact.ms_level_distribution()
        );
        assert_eq!(
            pretty.retention_time_units(),
            compact.retention_time_units()
        );
        assert_eq!(
            pretty.declared_spectrum_count(),
            compact.declared_spectrum_count()
        );
        assert_eq!(
            pretty.declared_chromatogram_count(),
            compact.declared_chromatogram_count()
        );
    }

    #[test]
    fn doctype_declaration_is_rejected_as_unsafe() {
        let document = concat!(
            r#"<!DOCTYPE mzML [<!ENTITY payload SYSTEM "file:///etc/passwd">]>"#,
            r#"<mzML><run><spectrumList count="0"/></run></mzML>"#,
        );

        assert_eq!(
            scan(document),
            Err(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration))
        );
    }

    #[test]
    fn undeclared_entities_are_rejected_as_unsafe() {
        let in_text = "<mzML><run>&payload;</run></mzML>";
        assert_eq!(
            scan(in_text),
            Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity))
        );

        let in_attribute = minimal(r#"<spectrum index="0" id="&payload;"/>"#);
        assert_eq!(
            scan(&in_attribute),
            Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity))
        );

        // Predefined entities and numeric character references stay accepted.
        let allowed = minimal(r#"<spectrum index="0" id="scan=1&amp;&#65;&#x42;"/>"#);
        assert_eq!(scan_ok(&allowed).observed_spectrum_count(), 1);
    }

    #[test]
    fn malformed_documents_report_distinct_structural_reasons() {
        assert_eq!(
            scan("<mzML><run></mzML>"),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed))
        );
        assert_eq!(
            scan(&minimal(r#"<spectrum index="0" index="1"/>"#)),
            Err(MzmlScanError::Malformed(
                MzmlMalformedKind::DuplicateAttribute
            ))
        );

        let mut invalid_utf8 = minimal(r#"<spectrum index="0" id="PLACEHOLDER"/>"#).into_bytes();
        let position = invalid_utf8
            .windows(11)
            .position(|window| window == b"PLACEHOLDER")
            .expect("placeholder is present");
        invalid_utf8[position] = 0xFF;
        assert_eq!(
            inspect_reader(invalid_utf8.as_slice(), MzmlScanLimits::default()),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::InvalidUtf8))
        );
    }

    #[test]
    fn non_finite_and_invalid_numeric_attributes_are_malformed() {
        let non_finite = minimal(concat!(
            r#"<spectrum index="0" id="scan=1"><scanList count="1"><scan>"#,
            r#"<cvParam accession="MS:1000016" name="scan start time" value="NaN"/>"#,
            r#"</scan></scanList></spectrum>"#,
        ));
        assert_eq!(
            scan(&non_finite),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::NonFiniteNumber))
        );

        let infinite = non_finite.replace("\"NaN\"", "\"inf\"");
        assert_eq!(
            scan(&infinite),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::NonFiniteNumber))
        );

        let overflowing = minimal(
            r#"<spectrum index="0" id="scan=1" defaultArrayLength="99999999999999999999999"/>"#,
        );
        assert_eq!(
            scan(&overflowing),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber))
        );

        let negative = minimal(r#"<spectrum index="-1" id="scan=1"/>"#);
        assert_eq!(
            scan(&negative),
            Err(MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber))
        );
    }

    #[test]
    fn every_explicit_limit_fails_closed() {
        let cases: [(MzmlScanLimits, MzmlLimitKind); 8] = [
            (
                MzmlScanLimits::default().with_max_depth(3),
                MzmlLimitKind::Depth,
            ),
            (
                MzmlScanLimits::default().with_max_elements(5),
                MzmlLimitKind::Elements,
            ),
            (
                MzmlScanLimits::default().with_max_attributes_per_element(1),
                MzmlLimitKind::AttributesPerElement,
            ),
            (
                MzmlScanLimits::default().with_max_name_bytes(4),
                MzmlLimitKind::NameBytes,
            ),
            (
                MzmlScanLimits::default().with_max_attribute_value_bytes(1),
                MzmlLimitKind::AttributeValueBytes,
            ),
            (
                MzmlScanLimits::default().with_max_document_bytes(64),
                MzmlLimitKind::DocumentBytes,
            ),
            (
                MzmlScanLimits::default().with_max_spectra(1),
                MzmlLimitKind::Spectra,
            ),
            (
                MzmlScanLimits::default().with_max_chromatograms(0),
                MzmlLimitKind::Chromatograms,
            ),
        ];

        for (limits, expected) in cases {
            assert_eq!(
                inspect_reader(TINY.as_bytes(), limits),
                Err(MzmlScanError::LimitExceeded(expected)),
                "limit {expected:?} did not fail closed"
            );
        }
    }

    #[test]
    fn one_oversized_text_node_fails_closed_before_it_is_buffered() {
        let payload = "A".repeat(8 * 1024);
        let document = minimal(&format!(
            concat!(
                r#"<spectrum index="0" id="scan=1" defaultArrayLength="1">"#,
                r#"<binaryDataArrayList count="1"><binaryDataArray encodedLength="1">"#,
                r#"<cvParam accession="MS:1000514" name="m/z array"/>"#,
                r#"<binary>{}</binary>"#,
                r#"</binaryDataArray></binaryDataArrayList></spectrum>"#,
            ),
            payload
        ));

        // A small refill capacity is what a real file-backed reader also has, so
        // the run is observed while it is still being consumed.
        let reader = BufReader::with_capacity(64, document.as_bytes());
        assert_eq!(
            inspect_reader(
                reader,
                MzmlScanLimits::default().with_max_text_run_bytes(256)
            ),
            Err(MzmlScanError::LimitExceeded(MzmlLimitKind::TextRunBytes))
        );

        let reader = BufReader::with_capacity(64, document.as_bytes());
        assert!(inspect_reader(reader, MzmlScanLimits::default()).is_ok());
    }

    #[test]
    fn scan_errors_expose_distinct_stable_ids_and_path_free_debug_output() {
        let ids = [
            MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration).stable_id(),
            MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity).stable_id(),
            MzmlScanError::Malformed(MzmlMalformedKind::NotWellFormed).stable_id(),
            MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot).stable_id(),
            MzmlScanError::LimitExceeded(MzmlLimitKind::Depth).stable_id(),
            MzmlScanError::LimitExceeded(MzmlLimitKind::TextRunBytes).stable_id(),
            MzmlScanError::Io {
                kind: io::ErrorKind::PermissionDenied,
            }
            .stable_id(),
        ];
        assert_eq!(ids.iter().collect::<BTreeSet<_>>().len(), ids.len());

        let facts = scan_ok(TINY);
        let rendered = format!("{facts:?}");
        assert!(rendered.contains("observed_spectrum_count: 2"));
        assert!(rendered.contains("retained_identity_count: 2"));
        // Raw scientific identifiers never reach a debug projection.
        assert!(!rendered.contains("scan="));
        assert!(!rendered.contains("TIC"));
    }

    #[test]
    fn inspecting_a_directory_is_refused_before_any_read() {
        let directory = std::env::current_dir().expect("test current directory");

        assert_eq!(
            inspect_file(&directory, MzmlScanLimits::default()),
            Err(MzmlScanError::Source(RegularFileError::NotRegularFile))
        );
    }
}
