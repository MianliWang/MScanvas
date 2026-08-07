//! Typed conversion output inspection and source/output integrity comparison.
//!
//! Process exit status, preview interpretation and conversion integrity are
//! three separate judgements. This module owns the third one and never consults
//! the first two: an exit code of zero is not evidence that a conversion
//! produced a usable, semantically equivalent mzML document.
//!
//! The comparison is deliberately conservative about what it claims. It does
//! not assert byte-for-byte equivalence, general losslessness or vendor
//! fidelity, and it never fails a conversion merely because the output uses a
//! different but legal mzML serialization.

use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs::File;
use std::io::{self, BufReader, Seek, SeekFrom};
use std::path::Path;

use thiserror::Error;

use crate::capability::Sha256Digest;
use crate::command::{OpenFormat, SourceIdentity};
use crate::fs_guard::{
    self, OutputDirectoryEntry, OutputDirectorySnapshot, OutputEntryKind, RegularFileError,
};
use crate::mzml::{
    self, ArrayKind, CompressionMarker, MzmlFacts, MzmlLimitKind, MzmlMalformedKind, MzmlScanError,
    MzmlScanLimits, MzmlSpectrumRecord, RepresentationMarker, UnsafeXmlKind,
};

/// The compression the typed conversion plan requested. This is MSCanvas policy,
/// not a scientific property of the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CompressionPolicy {
    /// Every binary array in the output must carry a zlib compression marker.
    #[default]
    Zlib,
}

impl CompressionPolicy {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Zlib => "zlib",
        }
    }
}

/// The typed conversion intent an integrity check is allowed to assume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ConversionPolicy {
    compression: CompressionPolicy,
}

impl ConversionPolicy {
    #[must_use]
    pub const fn new(compression: CompressionPolicy) -> Self {
        Self { compression }
    }

    #[must_use]
    pub const fn compression(self) -> CompressionPolicy {
        self.compression
    }
}

/// Typed facts about a conversion output, established without consulting the
/// backend's exit status.
#[derive(Debug, Clone, PartialEq)]
pub struct ConversionOutputInspection {
    byte_length: u64,
    sha256: Sha256Digest,
    facts: MzmlFacts,
}

impl ConversionOutputInspection {
    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.sha256
    }

    #[must_use]
    pub const fn facts(&self) -> &MzmlFacts {
        &self.facts
    }
}

/// Why an output directory does not hold one usable conversion output. No
/// variant contains a path or backend text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionOutputRejection {
    #[error("the conversion produced no output")]
    Missing,
    #[error("the conversion output is empty")]
    Empty,
    #[error("the conversion output is not a regular file")]
    NonRegularOutput,
    #[error("the conversion output changed while it was being inspected")]
    ChangedDuringInspection,
    #[error("the conversion produced an unexpected output set")]
    UnexpectedExtraOutput { observed: usize },
    #[error("the conversion output does not carry the planned name")]
    UnexpectedOutputName,
    #[error("the conversion output does not carry the planned extension")]
    ExtensionMismatch,
    #[error("the conversion left partial output behind")]
    PartialOutput,
    #[error("the conversion output could not be inspected as mzML")]
    Scan(MzmlScanError),
    #[error("the conversion output could not be hashed")]
    NotHashed,
    #[error("the output directory could not be inspected: {kind}")]
    DirectoryInspectionFailed { kind: io::ErrorKind },
}

impl ConversionOutputRejection {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Missing => "missing_output",
            Self::Empty => "zero_byte_output",
            Self::NonRegularOutput => "non_regular_output",
            Self::ChangedDuringInspection => "output_changed_during_inspection",
            Self::UnexpectedExtraOutput { .. } => "unexpected_output",
            Self::UnexpectedOutputName => "unexpected_output_name",
            Self::ExtensionMismatch => "output_extension_mismatch",
            Self::PartialOutput => "partial_output",
            Self::Scan(_) => "malformed_output",
            Self::NotHashed => "output_not_hashed",
            Self::DirectoryInspectionFailed { .. } => "output_directory_inspection_failed",
        }
    }
}

impl From<RegularFileError> for ConversionOutputRejection {
    fn from(error: RegularFileError) -> Self {
        match error {
            RegularFileError::NotRegularFile
            | RegularFileError::Symlink
            | RegularFileError::ReparsePoint => Self::NonRegularOutput,
            // A file replaced or resized between the snapshot and the read is a
            // concurrency observation, not a claim that the entry is unusable.
            RegularFileError::ChangedDuringOpen => Self::ChangedDuringInspection,
            RegularFileError::Io { kind } => Self::DirectoryInspectionFailed { kind },
        }
    }
}

/// Derives the planned conversion output file name from a source path.
///
/// The stem is preserved so a converted file stays recognizable next to its
/// acquisition; the extension always comes from the requested format.
#[must_use]
pub fn conversion_output_file_name(input: &Path, format: OpenFormat) -> Option<OsString> {
    let stem = input.file_stem().filter(|stem| !stem.is_empty())?;
    let mut name = stem.to_os_string();
    name.push(".");
    name.push(format.extension());
    Some(name)
}

/// Inspects the output directory of a completed conversion.
///
/// This establishes the filesystem postconditions and the typed mzML facts of
/// the output alone. It performs no source comparison and reads no process
/// state.
pub fn inspect_conversion_output(
    output_directory: &Path,
    expected_file_name: &OsStr,
    format: OpenFormat,
    limits: MzmlScanLimits,
) -> Result<ConversionOutputInspection, ConversionOutputRejection> {
    open_and_inspect_output(
        output_directory,
        expected_file_name,
        format,
        limits,
        OutputRetention::Release,
    )
    .map(|(_, inspection)| inspection)
}

/// Whether the object read is kept open afterwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputRetention {
    /// Read the output and let it go. The caller wants facts, not the object.
    Release,
    /// Read the output through a handle that can also rename it, and keep that
    /// handle. This is what makes a later finalization address the object that
    /// was judged rather than whatever the name resolves to next.
    Retain,
}

fn open_and_inspect_output(
    output_directory: &Path,
    expected_file_name: &OsStr,
    format: OpenFormat,
    limits: MzmlScanLimits,
    retention: OutputRetention,
) -> Result<(File, ConversionOutputInspection), ConversionOutputRejection> {
    let snapshot = fs_guard::snapshot_output_directory(output_directory)?;
    let entry = require_single_planned_entry(&snapshot, expected_file_name, format)?;

    let path = output_directory.join(expected_file_name);
    let (file, observed_byte_length) = match retention {
        OutputRetention::Release => fs_guard::open_regular_file(&path)?,
        OutputRetention::Retain => fs_guard::open_regular_file_renameable(&path)?,
    };
    // The length the directory listing reported and the length the opened
    // object reports must agree, exactly as the ordinary guard requires.
    if observed_byte_length != entry.byte_length() {
        return Err(ConversionOutputRejection::ChangedDuringInspection);
    }
    // The scanned handle is threaded through by ownership rather than merely
    // sitting beside the reading: what comes back is the object that was read,
    // and a caller cannot substitute another without visibly discarding this one.
    inspect_open_output(file, observed_byte_length, limits)
}

fn require_single_planned_entry<'a>(
    snapshot: &'a OutputDirectorySnapshot,
    expected_file_name: &OsStr,
    format: OpenFormat,
) -> Result<&'a OutputDirectoryEntry, ConversionOutputRejection> {
    if snapshot.is_empty() {
        return Err(ConversionOutputRejection::Missing);
    }
    // Partial output is reported before an entry count so an interrupted write
    // is never described as a merely unexpected output set.
    if snapshot.contains_partial_output() {
        return Err(ConversionOutputRejection::PartialOutput);
    }
    let [entry] = snapshot.entries() else {
        return Err(ConversionOutputRejection::UnexpectedExtraOutput {
            observed: snapshot.len(),
        });
    };
    if !entry.has_name(expected_file_name) {
        return Err(ConversionOutputRejection::UnexpectedOutputName);
    }
    if !entry.has_extension(format.extension()) {
        return Err(ConversionOutputRejection::ExtensionMismatch);
    }
    if entry.kind() != OutputEntryKind::RegularFile {
        return Err(ConversionOutputRejection::NonRegularOutput);
    }
    if entry.byte_length() == 0 {
        return Err(ConversionOutputRejection::Empty);
    }
    Ok(entry)
}

/// Reads the facts and the digest of one already-open output.
///
/// Both readings come from the same handle. Reopening the name for the digest
/// would mean the hash could describe a different object than the scan did, and
/// neither would be provably the object a later finalization moves.
fn inspect_open_output(
    mut file: File,
    observed_byte_length: u64,
    limits: MzmlScanLimits,
) -> Result<(File, ConversionOutputInspection), ConversionOutputRejection> {
    // The structural scan runs first so an unusable output reports its precise
    // structural reason rather than a hashing failure that merely happened to
    // occur on the way there.
    let facts = mzml::inspect_reader(BufReader::with_capacity(64 * 1024, &mut file), limits)
        .map_err(ConversionOutputRejection::Scan)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| ConversionOutputRejection::NotHashed)?;
    let sha256 = Sha256Digest::calculate_reader(&mut file)
        .map_err(|_| ConversionOutputRejection::NotHashed)?;
    Ok((
        file,
        ConversionOutputInspection {
            byte_length: observed_byte_length,
            sha256,
            facts,
        },
    ))
}

/// A conversion output that passed the integrity contract, still held open
/// through the exact handle its bytes and mzML facts were read with.
///
/// This is the object a finalization must move. Holding it is what makes the
/// claim "the file that received the final name is the file that was judged"
/// true by construction rather than by a recheck that only narrows a race.
/// There is no `Clone`: one validated reading owns one object.
pub(crate) struct ValidatedConversionOutput {
    file: File,
    valid: ValidConversion,
}

impl ValidatedConversionOutput {
    /// What was established about the object. Only a test reads this without
    /// finalizing: production consumes the whole value.
    #[cfg(test)]
    #[must_use]
    pub(crate) const fn valid(&self) -> &ValidConversion {
        &self.valid
    }

    /// Consumes the validated reading, yielding the handle that read it.
    ///
    /// Consuming is the point: an object can be finalized once, and the handle
    /// is released either way so cleanup is never blocked by this reading.
    pub(crate) fn into_parts(self) -> (File, ValidConversion) {
        (self.file, self.valid)
    }
}

impl fmt::Debug for ValidatedConversionOutput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ValidatedConversionOutput")
            .field("object", &"<opaque-validated-output>")
            .field("fully_verified", &self.valid.is_fully_verified())
            .finish_non_exhaustive()
    }
}

/// What verifying a conversion established, with the judged object retained
/// when it passed.
#[derive(Debug)]
pub(crate) enum VerifiedConversion {
    /// The output passed. The exact object read is held open inside.
    Valid(Box<ValidatedConversionOutput>),
    /// The output did not pass. Nothing is retained, so cleanup is unblocked.
    Rejected(ConversionIntegrityOutcome),
}

/// What was established about the source *object*, independently of what could
/// be read out of it.
///
/// Every source has these three, whatever format it is in, and they are what a
/// run rechecks to prove the acquisition it converts is the one it admitted.
/// Nothing here says the bytes are comparable to anything.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceObjectFacts {
    identity: SourceIdentity,
    byte_length: u64,
    sha256: Sha256Digest,
}

impl SourceObjectFacts {
    #[must_use]
    pub const fn identity(&self) -> &SourceIdentity {
        &self.identity
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.sha256
    }

    /// Assembles facts a caller established from one opened object.
    ///
    /// Exists so a posture that must also read something out of the object —
    /// a file signature, say — can do it through the same handle the digest is
    /// computed from, instead of reopening the name and describing bytes the
    /// digest may not cover.
    pub(crate) const fn from_parts(
        identity: SourceIdentity,
        byte_length: u64,
        sha256: Sha256Digest,
    ) -> Self {
        Self {
            identity,
            byte_length,
            sha256,
        }
    }

    /// Binds a path to the object it currently names, its length and its
    /// contents. No format is assumed and nothing is parsed.
    pub(crate) fn capture(input: &Path) -> Result<Self, ConversionSourceError> {
        let identity = SourceIdentity::capture(input)
            .map_err(|error| ConversionSourceError::NotResolved { kind: error.kind() })?;
        let path = identity.canonical_path();
        let byte_length = std::fs::symlink_metadata(path)
            .map_err(|error| ConversionSourceError::NotResolved { kind: error.kind() })?
            .len();
        let sha256 =
            Sha256Digest::calculate_file(path).map_err(|_| ConversionSourceError::NotHashed)?;
        Ok(Self {
            identity,
            byte_length,
            sha256,
        })
    }
}

/// The canonical source facts an integrity comparison is measured against.
///
/// This is the object facts *plus* a reading of the source as mzML, and the
/// second half is what makes a source/output comparison meaningful. A source
/// that cannot be read that way carries [`SourceObjectFacts`] alone.
#[derive(Debug, Clone, PartialEq)]
pub struct ConversionSourceFacts {
    object: SourceObjectFacts,
    facts: MzmlFacts,
}

impl ConversionSourceFacts {
    #[must_use]
    pub const fn identity(&self) -> &SourceIdentity {
        self.object.identity()
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.object.byte_length()
    }

    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.object.sha256()
    }

    #[must_use]
    pub const fn object(&self) -> &SourceObjectFacts {
        &self.object
    }

    #[must_use]
    pub const fn facts(&self) -> &MzmlFacts {
        &self.facts
    }
}

/// Why source facts could not be captured before a conversion.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionSourceError {
    #[error("the conversion source could not be resolved: {kind}")]
    NotResolved { kind: io::ErrorKind },
    #[error("the conversion source could not be hashed")]
    NotHashed,
    #[error("the conversion source could not be inspected as mzML")]
    Scan(MzmlScanError),
}

impl ConversionSourceError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotResolved { .. } => "source_not_resolved",
            Self::NotHashed => "source_not_hashed",
            Self::Scan(_) => "source_scan_failed",
        }
    }
}

/// Captures the source identity, size, hash and typed mzML facts a conversion
/// is measured against.
///
/// Recapturing all four afterwards is what makes a source replaced or rewritten
/// during the conversion observable instead of silently changing the baseline.
pub fn capture_conversion_source(
    input: &Path,
    limits: MzmlScanLimits,
) -> Result<ConversionSourceFacts, ConversionSourceError> {
    let object = SourceObjectFacts::capture(input)?;
    let facts = mzml::inspect_file(object.identity().canonical_path(), limits)
        .map_err(ConversionSourceError::Scan)?;
    Ok(ConversionSourceFacts { object, facts })
}

/// Which document a structural observation belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DocumentSide {
    Source,
    Output,
}

impl DocumentSide {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Output => "output",
        }
    }
}

/// Which list a structural observation belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DocumentPart {
    Spectrum,
    Chromatogram,
}

impl DocumentPart {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Spectrum => "spectrum",
            Self::Chromatogram => "chromatogram",
        }
    }
}

/// How a binary-array comparison diverged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BinaryArrayMismatchKind {
    /// The number of binary arrays differs.
    Count,
    /// The set of recognized array roles differs.
    Kinds,
    /// The declared point count differs.
    Length,
    /// One side carries a binary payload the other lost. Presence is observed
    /// without decoding, so this catches an array whose scientific data went
    /// missing while its metadata still matched.
    PayloadPresence,
}

impl BinaryArrayMismatchKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Count => "binary_array_count",
            Self::Kinds => "binary_array_kinds",
            Self::Length => "binary_array_length",
            Self::PayloadPresence => "binary_array_payload_presence",
        }
    }
}

/// A property an integrity comparison either established or could not establish.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum IntegrityProperty {
    SourceUnchanged,
    /// The output's own declared list counts agree with what it contains. A
    /// structural property about the output alone, so an output-only validation
    /// can establish it.
    OutputDeclaredCounts,
    /// Every record in the output that holds binary arrays declares how many
    /// points they hold. About the output alone, and separate from the
    /// comparison of those lengths against a source, which asks a different
    /// question and is not always available.
    OutputDeclaredArrayLengths,
    /// Every array the output declares non-empty carries a payload. Observed
    /// without decoding, so an array whose scientific data went missing while
    /// its metadata still described peaks is caught with no source to compare
    /// against.
    OutputArrayPayloadPresence,
    /// A record's arrays, taken together, name the roles the record needs: m/z
    /// and intensity for a spectrum, time and intensity for a chromatogram.
    ///
    /// Record-level, and deliberately not claimed to be more. The scanner
    /// records the union of the roles a record's arrays declared, not which
    /// array declared which, so this establishes that the roles are present and
    /// cannot establish that each array carries exactly one. A record whose
    /// first array claims both roles while its second claims none satisfies it.
    /// Closing that needs a per-array fact the scanner does not keep.
    OutputArrayRoles,
    /// A record says something about how its arrays are encoded, and does not
    /// contradict itself about how they are compressed.
    ///
    /// Record-level for the same reason and with the same limit: the scanner
    /// keeps the union of the numeric encodings a record's arrays declared, so
    /// this establishes that an encoding was stated somewhere in the record and
    /// cannot establish that every array stated one, or that none stated two.
    OutputArrayEncoding,
    /// Every spectrum in the output says which MS level it is, and none claims
    /// to be both profile and centroid. Two facts about a spectrum's own
    /// metadata, both recorded by the scanner and both readable without a
    /// source.
    OutputSpectrumMetadata,
    SpectrumCount,
    ChromatogramCount,
    IndexSequences,
    MsLevelDistribution,
    BinaryArrayCounts,
    BinaryArrayKinds,
    BinaryArrayLengths,
    BinaryArrayPayloadPresence,
    PrecursorCounts,
    SpectrumNativeIdentity,
    SpectrumRepresentation,
    CompressionPolicy,
    RetentionTimeUnitMarkers,
}

impl IntegrityProperty {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::SourceUnchanged => "source_unchanged",
            Self::OutputDeclaredCounts => "output_declared_counts",
            Self::OutputDeclaredArrayLengths => "output_declared_array_lengths",
            Self::OutputArrayPayloadPresence => "output_array_payload_presence",
            Self::OutputArrayRoles => "output_array_roles",
            Self::OutputArrayEncoding => "output_array_encoding",
            Self::OutputSpectrumMetadata => "output_spectrum_metadata",
            Self::SpectrumCount => "spectrum_count",
            Self::ChromatogramCount => "chromatogram_count",
            Self::IndexSequences => "index_sequences",
            Self::MsLevelDistribution => "ms_level_distribution",
            Self::BinaryArrayCounts => "binary_array_counts",
            Self::BinaryArrayKinds => "binary_array_kinds",
            Self::BinaryArrayLengths => "binary_array_lengths",
            Self::BinaryArrayPayloadPresence => "binary_array_payload_presence",
            Self::PrecursorCounts => "precursor_counts",
            Self::SpectrumNativeIdentity => "spectrum_native_identity",
            Self::SpectrumRepresentation => "spectrum_representation",
            Self::CompressionPolicy => "compression_policy",
            Self::RetentionTimeUnitMarkers => "retention_time_unit_markers",
        }
    }
}

/// A recorded difference that is descriptive only.
///
/// None of these fail a conversion. Each is a fact the measured evidence
/// already shows a faithful `msconvert` run can legitimately produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum AdvisoryObservation {
    /// One document uses the `indexedmzML` wrapper and the other does not.
    RootWrapperDiffers,
    /// The numeric-encoding markers differ, which is not a losslessness claim
    /// in either direction.
    NumericPrecisionDiffers,
    /// The output emitted a profile/centroid marker the source did not.
    RepresentationMarkerAdded,
    /// The source emitted a profile/centroid marker the output did not.
    RepresentationMarkerRemoved,
    /// The two documents differ in size, which is expected and not a defect.
    ByteLengthDiffers,
    /// The source's own declared list count disagrees with what it contains.
    SourceDeclaredCountInconsistent,
    /// The emitted retention-time unit accessions differ or are absent.
    RetentionTimeUnitDiffers,
}

impl AdvisoryObservation {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::RootWrapperDiffers => "root_wrapper_differs",
            Self::NumericPrecisionDiffers => "numeric_precision_differs",
            Self::RepresentationMarkerAdded => "representation_marker_added",
            Self::RepresentationMarkerRemoved => "representation_marker_removed",
            Self::ByteLengthDiffers => "byte_length_differs",
            Self::SourceDeclaredCountInconsistent => "source_declared_count_inconsistent",
            Self::RetentionTimeUnitDiffers => "retention_time_unit_differs",
        }
    }
}

/// How much of the integrity contract a conversion could even be asked.
///
/// This is a property of the *source*, decided when the source was admitted,
/// and it is carried into the result so no caller can read an output-only
/// judgement as a fidelity statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationMode {
    /// The source was read under the same model as the output, so the two were
    /// compared record by record.
    SourceComparison,
    /// The source could not be read under a comparable model. Only the output's
    /// own postconditions were established; nothing was compared, and no
    /// statement about what the source contained is available.
    OutputOnly,
}

impl ValidationMode {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::SourceComparison => "source_comparison",
            Self::OutputOnly => "output_only",
        }
    }

    /// Whether this mode can support a source-versus-output fidelity statement
    /// at all.
    #[must_use]
    pub const fn compares_against_source(self) -> bool {
        matches!(self, Self::SourceComparison)
    }
}

/// A conversion whose every evaluated invariant held.
///
/// Three sets, and the difference between them matters. `verified` is what was
/// established. `unverified` names properties this pair could have been asked
/// but genuinely could not establish — vocabulary facts reached through a
/// `referenceableParamGroup`, or a native identifier form the canonical identity
/// contract deliberately leaves opaque. `inapplicable` names properties that
/// were never a question at all, because the source could not be read under a
/// comparable model; they are not gaps in this run's evidence, they are outside
/// what an output-only validation is.
///
/// A gate that needs the strict statement asserts
/// [`ValidConversion::is_fully_verified`], which is false for every output-only
/// result whatever its sets contain.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidConversion {
    output: ConversionOutputInspection,
    mode: ValidationMode,
    verified: BTreeSet<IntegrityProperty>,
    unverified: BTreeSet<IntegrityProperty>,
    inapplicable: BTreeSet<IntegrityProperty>,
    advisory: BTreeSet<AdvisoryObservation>,
}

impl ValidConversion {
    #[must_use]
    pub const fn output(&self) -> &ConversionOutputInspection {
        &self.output
    }

    /// How much of the contract this conversion could be asked.
    #[must_use]
    pub const fn validation_mode(&self) -> ValidationMode {
        self.mode
    }

    #[must_use]
    pub const fn verified(&self) -> &BTreeSet<IntegrityProperty> {
        &self.verified
    }

    #[must_use]
    pub const fn unverified(&self) -> &BTreeSet<IntegrityProperty> {
        &self.unverified
    }

    /// Properties that were not a question this source and output could be
    /// asked. Always empty under [`ValidationMode::SourceComparison`].
    #[must_use]
    pub const fn inapplicable(&self) -> &BTreeSet<IntegrityProperty> {
        &self.inapplicable
    }

    #[must_use]
    pub const fn advisory(&self) -> &BTreeSet<AdvisoryObservation> {
        &self.advisory
    }

    /// Whether every integrity property was actually evaluated, not merely left
    /// unviolated.
    ///
    /// An output-only validation answers `false` unconditionally. It is not a
    /// weaker comparison; it is not a comparison, and a caller asking this
    /// question is asking for the statement only a comparison can make.
    #[must_use]
    pub fn is_fully_verified(&self) -> bool {
        self.mode.compares_against_source() && self.unverified.is_empty()
    }
}

/// The complete result of comparing one conversion against its source.
#[derive(Debug, Clone, PartialEq)]
pub enum ConversionIntegrityOutcome {
    Valid(Box<ValidConversion>),
    MissingOutput,
    EmptyOutput,
    NonRegularOutput,
    OutputChangedDuringInspection,
    PartialOutput,
    UnexpectedExtraOutput {
        observed: usize,
    },
    UnexpectedOutputName,
    OutputExtensionMismatch,
    WrongRootFormat,
    UnsafeXml {
        kind: UnsafeXmlKind,
    },
    MalformedXml {
        kind: MzmlMalformedKind,
    },
    LimitExceeded {
        kind: MzmlLimitKind,
    },
    OutputNotInspected {
        kind: io::ErrorKind,
    },
    OutputNotHashed,
    SourceChangedDuringConversion,
    SourceNotRevalidated {
        kind: io::ErrorKind,
    },
    SourceNotRehashed,
    OutputDeclaredCountInconsistent {
        part: DocumentPart,
    },
    /// A record declares a non-empty binary array and carries no payload for
    /// it. Unlike a `BinaryArrayMismatch`, no second document is involved: the
    /// output contradicts itself.
    OutputDeclaredArrayWithoutPayload {
        part: DocumentPart,
        index: u64,
    },
    /// A record does not say what its arrays are, so nothing downstream can
    /// read it as a spectrum or a chromatogram.
    OutputArrayRoleMissing {
        part: DocumentPart,
        index: u64,
    },
    /// A record does not say how its arrays are encoded, so nothing downstream
    /// can decode them.
    OutputArrayEncodingMissing {
        part: DocumentPart,
        index: u64,
    },
    /// A record says its arrays are both compressed and not compressed.
    OutputCompressionContradictory {
        part: DocumentPart,
        index: u64,
    },
    /// A spectrum in the output does not say which MS level it is, so nothing
    /// downstream can tell a survey scan from a fragmentation scan.
    OutputMsLevelMissing,
    /// A spectrum claims to be both profile and centroid.
    OutputRepresentationConflicting {
        index: u64,
    },
    /// A record holds binary arrays and does not declare how many points they
    /// hold, so the output does not state its own point counts.
    OutputArrayLengthMissing {
        part: DocumentPart,
        index: u64,
    },
    /// The output is a well-formed document holding no spectra and no
    /// chromatograms. Only reachable where there is no source to compare
    /// against, because a comparison would already have found the counts
    /// disagreeing.
    OutputContainsNoRecords,
    SpectrumCountMismatch {
        source: u64,
        output: u64,
    },
    ChromatogramCountMismatch {
        source: u64,
        output: u64,
    },
    IndexSequenceNotConsecutive {
        side: DocumentSide,
        part: DocumentPart,
    },
    MsLevelDistributionMismatch,
    BinaryArrayMismatch {
        part: DocumentPart,
        first_divergent_index: u64,
        kind: BinaryArrayMismatchKind,
    },
    PrecursorCountMismatch {
        first_divergent_index: u64,
    },
    IdentityConflict {
        first_divergent_index: u64,
    },
    RepresentationChange {
        first_divergent_index: u64,
        source: RepresentationMarker,
        output: RepresentationMarker,
    },
    CompressionPolicyMismatch {
        requested: CompressionPolicy,
        uncompressed_array_count: u64,
    },
}

impl ConversionIntegrityOutcome {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::Valid(_) => "valid",
            Self::MissingOutput => "missing_output",
            Self::EmptyOutput => "zero_byte_output",
            Self::NonRegularOutput => "non_regular_output",
            Self::OutputChangedDuringInspection => "output_changed_during_inspection",
            Self::PartialOutput => "partial_output",
            Self::UnexpectedExtraOutput { .. } => "unexpected_output",
            Self::UnexpectedOutputName => "unexpected_output_name",
            Self::OutputExtensionMismatch => "output_extension_mismatch",
            Self::WrongRootFormat => "wrong_root_format",
            Self::UnsafeXml { .. } => "unsafe_xml",
            Self::MalformedXml { .. } => "malformed_xml",
            Self::LimitExceeded { .. } => "limit_exceeded",
            Self::OutputNotInspected { .. } => "output_not_inspected",
            Self::OutputNotHashed => "output_not_hashed",
            Self::SourceChangedDuringConversion => "source_changed_during_conversion",
            Self::SourceNotRevalidated { .. } => "source_not_revalidated",
            Self::SourceNotRehashed => "source_not_rehashed",
            Self::OutputDeclaredCountInconsistent { .. } => "output_declared_count_inconsistent",
            Self::OutputDeclaredArrayWithoutPayload { .. } => {
                "output_declared_array_without_payload"
            }
            Self::OutputContainsNoRecords => "output_contains_no_records",
            Self::OutputArrayRoleMissing { .. } => "output_array_role_missing",
            Self::OutputArrayEncodingMissing { .. } => "output_array_encoding_missing",
            Self::OutputCompressionContradictory { .. } => "output_compression_contradictory",
            Self::OutputMsLevelMissing => "output_ms_level_missing",
            Self::OutputRepresentationConflicting { .. } => "output_representation_conflicting",
            Self::OutputArrayLengthMissing { .. } => "output_array_length_missing",
            Self::SpectrumCountMismatch { .. } => "spectrum_count_mismatch",
            Self::ChromatogramCountMismatch { .. } => "chromatogram_count_mismatch",
            Self::IndexSequenceNotConsecutive { .. } => "index_sequence_not_consecutive",
            Self::MsLevelDistributionMismatch => "ms_level_distribution_mismatch",
            Self::BinaryArrayMismatch { .. } => "binary_array_mismatch",
            Self::PrecursorCountMismatch { .. } => "precursor_count_mismatch",
            Self::IdentityConflict { .. } => "identity_conflict",
            Self::RepresentationChange { .. } => "representation_change",
            Self::CompressionPolicyMismatch { .. } => "compression_policy_mismatch",
        }
    }

    /// Whether the conversion may be treated as a usable mzML result.
    #[must_use]
    pub const fn is_valid(&self) -> bool {
        matches!(self, Self::Valid(_))
    }

    #[must_use]
    pub const fn valid(&self) -> Option<&ValidConversion> {
        match self {
            Self::Valid(valid) => Some(valid),
            _ => None,
        }
    }
}

impl From<ConversionOutputRejection> for ConversionIntegrityOutcome {
    fn from(rejection: ConversionOutputRejection) -> Self {
        match rejection {
            ConversionOutputRejection::Missing => Self::MissingOutput,
            ConversionOutputRejection::Empty => Self::EmptyOutput,
            ConversionOutputRejection::NonRegularOutput => Self::NonRegularOutput,
            ConversionOutputRejection::ChangedDuringInspection => {
                Self::OutputChangedDuringInspection
            }
            ConversionOutputRejection::UnexpectedExtraOutput { observed } => {
                Self::UnexpectedExtraOutput { observed }
            }
            ConversionOutputRejection::UnexpectedOutputName => Self::UnexpectedOutputName,
            ConversionOutputRejection::ExtensionMismatch => Self::OutputExtensionMismatch,
            ConversionOutputRejection::PartialOutput => Self::PartialOutput,
            ConversionOutputRejection::NotHashed => Self::OutputNotHashed,
            ConversionOutputRejection::DirectoryInspectionFailed { kind } => {
                Self::OutputNotInspected { kind }
            }
            ConversionOutputRejection::Scan(error) => match error {
                MzmlScanError::Unsafe(kind) => Self::UnsafeXml { kind },
                MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot) => {
                    Self::WrongRootFormat
                }
                MzmlScanError::Malformed(kind) => Self::MalformedXml { kind },
                MzmlScanError::LimitExceeded(kind) => Self::LimitExceeded { kind },
                MzmlScanError::Source(RegularFileError::ChangedDuringOpen) => {
                    Self::OutputChangedDuringInspection
                }
                MzmlScanError::Source(RegularFileError::Io { kind }) => {
                    Self::OutputNotInspected { kind }
                }
                MzmlScanError::Source(_) => Self::NonRegularOutput,
                MzmlScanError::Io { kind } => Self::OutputNotInspected { kind },
            },
        }
    }
}

/// Compares one completed mzML conversion against the source it was measured
/// against.
///
/// This deliberately does not claim byte-for-byte equivalence, general
/// losslessness or vendor fidelity, and it never fails a conversion for a legal
/// serialization difference: attribute order, `cvParam` order, whitespace, the
/// `indexedmzML` wrapper, numeric-encoding markers and identifier spelling are
/// all excluded from the invariants.
#[must_use]
pub fn verify_mzml_conversion(
    source: &ConversionSourceFacts,
    output_directory: &Path,
    expected_file_name: &OsStr,
    policy: ConversionPolicy,
    limits: MzmlScanLimits,
) -> ConversionIntegrityOutcome {
    let (file, output) = match open_and_inspect_output(
        output_directory,
        expected_file_name,
        OpenFormat::MzMl,
        limits,
        OutputRetention::Release,
    ) {
        Ok(opened) => opened,
        Err(rejection) => return rejection.into(),
    };
    // Released as soon as it has been read: a caller of this entry point asked
    // for facts, not for the object, and holding their file open for the
    // source revalidation below would be a change they did not ask for.
    drop(file);
    judge_against_source(source, output, policy)
}

/// Verifies a conversion and, when it passes, retains the exact object judged.
///
/// The judgement is identical to [`verify_mzml_conversion`] — same directory
/// postconditions, same scan limits, same required, advisory and unverifiable
/// classifications. The difference is what survives the call: a validated
/// output that still holds open the object its facts came from, so finalization
/// can move that object rather than resolve the name again.
#[must_use]
pub(crate) fn verify_mzml_conversion_retaining_output(
    source: &ConversionSourceFacts,
    output_directory: &Path,
    expected_file_name: &OsStr,
    policy: ConversionPolicy,
    limits: MzmlScanLimits,
) -> VerifiedConversion {
    let (file, output) = match open_and_inspect_output(
        output_directory,
        expected_file_name,
        OpenFormat::MzMl,
        limits,
        OutputRetention::Retain,
    ) {
        Ok(opened) => opened,
        Err(rejection) => return VerifiedConversion::Rejected(rejection.into()),
    };

    match judge_against_source(source, output, policy) {
        ConversionIntegrityOutcome::Valid(valid) => {
            VerifiedConversion::Valid(Box::new(ValidatedConversionOutput {
                file,
                valid: *valid,
            }))
        }
        rejected => VerifiedConversion::Rejected(rejected),
    }
}

/// Verifies a conversion whose source could not be read as mzML, retaining the
/// exact object judged when it passes.
///
/// The filesystem postconditions are identical to the comparing entry points —
/// the same single-planned-entry rule, the same scan limits, the same fail-closed
/// scanner, the same retained handle. What is absent is the comparison, because
/// there is nothing on the source side to compare against, and the result says
/// so through [`ValidationMode::OutputOnly`] rather than by quietly reporting a
/// smaller set of verified properties.
///
/// The source is still revalidated. Identity, length and content are rechecked
/// exactly as they are for an mzML source: a vendor acquisition rewritten while
/// the backend read it invalidates the run whether or not anything about its
/// contents is comparable.
#[must_use]
pub(crate) fn verify_vendor_conversion_retaining_output(
    source: &SourceObjectFacts,
    output_directory: &Path,
    expected_file_name: &OsStr,
    policy: ConversionPolicy,
    limits: MzmlScanLimits,
) -> VerifiedConversion {
    let (file, output) = match open_and_inspect_output(
        output_directory,
        expected_file_name,
        OpenFormat::MzMl,
        limits,
        OutputRetention::Retain,
    ) {
        Ok(opened) => opened,
        Err(rejection) => return VerifiedConversion::Rejected(rejection.into()),
    };

    match judge_output_alone(source, output, policy) {
        ConversionIntegrityOutcome::Valid(valid) => {
            VerifiedConversion::Valid(Box::new(ValidatedConversionOutput {
                file,
                valid: *valid,
            }))
        }
        rejected => VerifiedConversion::Rejected(rejected),
    }
}

/// Every property that is a statement about a source and an output together.
///
/// An output-only validation records these as inapplicable rather than
/// unverified: they were not questions this pair could be asked. Listing them
/// explicitly, rather than deriving the set by subtraction, is what makes adding
/// a new comparison property a compile-time decision about which bucket it
/// belongs in.
const COMPARISON_PROPERTIES: [IntegrityProperty; 11] = [
    IntegrityProperty::SpectrumCount,
    IntegrityProperty::ChromatogramCount,
    IntegrityProperty::MsLevelDistribution,
    IntegrityProperty::BinaryArrayCounts,
    IntegrityProperty::BinaryArrayKinds,
    IntegrityProperty::BinaryArrayLengths,
    IntegrityProperty::BinaryArrayPayloadPresence,
    IntegrityProperty::PrecursorCounts,
    IntegrityProperty::SpectrumNativeIdentity,
    IntegrityProperty::SpectrumRepresentation,
    IntegrityProperty::RetentionTimeUnitMarkers,
];

/// Judges an output on its own terms.
///
/// Three things are established and no more: the source object is still the one
/// that was admitted, the output is internally consistent, and it honours the
/// compression the plan asked for. Everything else a conversion result can say
/// is a comparison, and this function is reached precisely because there is
/// nothing to compare against.
fn judge_output_alone(
    source: &SourceObjectFacts,
    output: ConversionOutputInspection,
    policy: ConversionPolicy,
) -> ConversionIntegrityOutcome {
    match revalidate_source(source) {
        Ok(true) => {}
        Ok(false) => return ConversionIntegrityOutcome::SourceChangedDuringConversion,
        Err(outcome) => return outcome,
    }

    let after = output.facts();
    let mut report = IntegrityReport::default();
    report.verified.insert(IntegrityProperty::SourceUnchanged);

    // Every structural check below is a statement about records, and every one
    // of them passes vacuously over a document that has none. A well-formed
    // shell — no `spectrumList`, an empty one, or a `run` holding nothing — would
    // otherwise satisfy the whole contract and be finalized as a result. A
    // comparison never reaches this because the source's counts would already
    // disagree; with no source, refusing an output that converted nothing is
    // what takes its place.
    //
    // This does not distinguish an absent list from a present one declaring
    // `count="0"`. Telling those apart needs the scanner to record whether the
    // element and its attribute appeared at all, which is a fact it does not
    // carry today, and both are refused here anyway.
    if after.observed_spectrum_count() == 0 && after.observed_chromatogram_count() == 0 {
        return ConversionIntegrityOutcome::OutputContainsNoRecords;
    }

    // A list that holds records and declares no count has omitted an attribute
    // its schema requires. Under a comparison that is survivable, because the
    // observed counts on both sides still answer the question. Here there is no
    // other side, so recording the property as verified would be asserting
    // something the document declined to state.
    if after.declared_spectrum_count().is_none() && after.observed_spectrum_count() > 0 {
        return ConversionIntegrityOutcome::OutputDeclaredCountInconsistent {
            part: DocumentPart::Spectrum,
        };
    }
    if after.declared_chromatogram_count().is_none() && after.observed_chromatogram_count() > 0 {
        return ConversionIntegrityOutcome::OutputDeclaredCountInconsistent {
            part: DocumentPart::Chromatogram,
        };
    }
    if let Some(outcome) = check_output_declared_counts(after, &mut report) {
        return outcome;
    }
    // Declared array lengths are readable from the output alone, so their
    // absence is recorded rather than passed over in silence. It is not a
    // rejection: the comparison path already treats an absent length as
    // unestablishable rather than as a defect, and this keeps the two agreeing
    // about what the fact is worth.
    if let Some(outcome) = check_output_declared_array_lengths(after) {
        return outcome;
    }
    report
        .verified
        .insert(IntegrityProperty::OutputDeclaredArrayLengths);
    if !after.spectrum_index_sequence_is_consecutive() {
        return ConversionIntegrityOutcome::IndexSequenceNotConsecutive {
            side: DocumentSide::Output,
            part: DocumentPart::Spectrum,
        };
    }
    if !after.chromatogram_index_sequence_is_consecutive() {
        return ConversionIntegrityOutcome::IndexSequenceNotConsecutive {
            side: DocumentSide::Output,
            part: DocumentPart::Chromatogram,
        };
    }
    report.verified.insert(IntegrityProperty::IndexSequences);

    // A document that says it holds peaks and holds none is unusable, and it
    // says so entirely by itself. The comparison path catches this by finding
    // the source's payloads where the output has none; with no source, the
    // contradiction between a declared length and an absent payload is what
    // remains, and it is enough.
    if let Some(outcome) = check_output_payload_presence(after) {
        return outcome;
    }
    report
        .verified
        .insert(IntegrityProperty::OutputArrayPayloadPresence);

    let vocabulary_readable = !after.parameter_group_reference_observed();

    // What the arrays *are* is readable from the output alone whenever the
    // vocabulary is, and an output that does not say is one nothing downstream
    // can read as a spectrum. Comparing those roles against a source is a
    // different question and stays inapplicable; this is the output answering
    // for itself.
    if vocabulary_readable {
        if let Some(outcome) = check_output_array_roles(after) {
            return outcome;
        }
        report.verified.insert(IntegrityProperty::OutputArrayRoles);

        // Saying what an array is does not say how to read it. A payload with
        // no numeric encoding leaves its width and type unstated, and a record
        // claiming its arrays are both compressed and uncompressed is worse
        // than wrong: it is two answers to one question, and the compressed
        // count alone cannot see it because that count is satisfied.
        if let Some(outcome) = check_output_array_encoding(after, policy) {
            return outcome;
        }
        report
            .verified
            .insert(IntegrityProperty::OutputArrayEncoding);

        // A spectrum that does not say which MS level it is cannot be told from
        // any other, and one claiming to be both profile and centroid says two
        // incompatible things about the same peaks. Both are its own metadata,
        // both are recorded, and neither needs a source to notice.
        if let Some(outcome) = check_output_spectrum_metadata(after) {
            return outcome;
        }
        report
            .verified
            .insert(IntegrityProperty::OutputSpectrumMetadata);
    } else {
        report
            .unverified
            .insert(IntegrityProperty::OutputArrayRoles);
        report
            .unverified
            .insert(IntegrityProperty::OutputArrayEncoding);
        report
            .unverified
            .insert(IntegrityProperty::OutputSpectrumMetadata);
    }

    // The compression policy is the one requested property that is readable from
    // the output alone, and it degrades for the same reason it degrades in a
    // comparison: an indirected controlled vocabulary is not a fact this scanner
    // will assert.
    if let Some(outcome) = check_compression_policy(after, policy, vocabulary_readable, &mut report)
    {
        return outcome;
    }

    ConversionIntegrityOutcome::Valid(Box::new(ValidConversion {
        output,
        mode: ValidationMode::OutputOnly,
        verified: report.verified,
        unverified: report.unverified,
        inapplicable: COMPARISON_PROPERTIES.into_iter().collect(),
        advisory: report.advisory,
    }))
}

/// Refuses an output whose metadata describes peaks it does not carry.
///
/// A record that declares points has to hold arrays, and those arrays have to
/// hold something. Both halves matter and they fail differently: an array
/// present with an empty payload, and no array at all. The second is the
/// quieter one — with no arrays there is nothing for a payload check to look at
/// and nothing for a compression check to find uncompressed, so a document
/// declaring four points and carrying no binary data would satisfy every other
/// rule here.
///
/// A declared length of zero carries nothing legitimately: a peakless record is
/// a real one, and the M0 evidence corrected an earlier contract for rejecting
/// exactly that on ProteoWizard's own reference fixture.
fn check_output_payload_presence(after: &MzmlFacts) -> Option<ConversionIntegrityOutcome> {
    fn declares_peaks_without_data(
        default_array_length: Option<u64>,
        binary_array_count: u32,
        empty_binary_payload_count: u32,
    ) -> bool {
        match default_array_length {
            // Declared non-empty: arrays are required, and they must hold
            // something.
            Some(1..) => binary_array_count == 0 || empty_binary_payload_count > 0,
            // Declared empty: a peakless record, which is legitimate.
            Some(0) => false,
            // Not declared at all. The point count cannot be determined, so an
            // empty payload can no longer be excused as peakless — that excuse
            // rests on a declaration this record did not make. Fail closed
            // rather than let a missing attribute route around the check.
            None => binary_array_count > 0 && empty_binary_payload_count > 0,
        }
    }

    for (position, record) in after.spectra().iter().enumerate() {
        if declares_peaks_without_data(
            record.default_array_length(),
            record.binary_array_count(),
            record.empty_binary_payload_count(),
        ) {
            return Some(
                ConversionIntegrityOutcome::OutputDeclaredArrayWithoutPayload {
                    part: DocumentPart::Spectrum,
                    index: position as u64,
                },
            );
        }
    }
    for (position, record) in after.chromatograms().iter().enumerate() {
        if declares_peaks_without_data(
            record.default_array_length(),
            record.binary_array_count(),
            record.empty_binary_payload_count(),
        ) {
            return Some(
                ConversionIntegrityOutcome::OutputDeclaredArrayWithoutPayload {
                    part: DocumentPart::Chromatogram,
                    index: position as u64,
                },
            );
        }
    }
    None
}

/// Refuses an output whose records do not say what their arrays are.
///
/// A spectrum that carries arrays without an m/z role and an intensity role
/// cannot be read as a spectrum by anything downstream, and neither can a
/// chromatogram without a time role and an intensity role. The roles are
/// already recorded by the scanner and are readable from the output alone;
/// only *comparing* them against a source needs the source.
///
/// What this cannot see is which array carried which role, because the scanner
/// keeps the union rather than the assignment. A record whose first array
/// declares both roles and whose second declares none passes here. That is a
/// real residual gap, it is recorded as one, and closing it is a scanner change
/// rather than a stronger predicate over the same facts.
///
/// Records carrying no arrays at all are not judged here — a peakless record is
/// legitimate, and one that declares points without arrays was already refused.
fn check_output_array_roles(after: &MzmlFacts) -> Option<ConversionIntegrityOutcome> {
    for (position, record) in after.spectra().iter().enumerate() {
        if record.binary_array_count() > 0
            && !(record.array_kinds().contains(ArrayKind::Mz)
                && record.array_kinds().contains(ArrayKind::Intensity))
        {
            return Some(ConversionIntegrityOutcome::OutputArrayRoleMissing {
                part: DocumentPart::Spectrum,
                index: position as u64,
            });
        }
    }
    for (position, record) in after.chromatograms().iter().enumerate() {
        if record.binary_array_count() > 0
            && !(record.array_kinds().contains(ArrayKind::Time)
                && record.array_kinds().contains(ArrayKind::Intensity))
        {
            return Some(ConversionIntegrityOutcome::OutputArrayRoleMissing {
                part: DocumentPart::Chromatogram,
                index: position as u64,
            });
        }
    }
    None
}

/// Refuses a record that does not say how many points its arrays hold.
///
/// Every record, including one carrying no arrays: a legitimately peakless
/// record says so by declaring zero, and one that declares nothing has omitted
/// an attribute its schema requires whether or not it happens to carry arrays.
/// Measured on the evidence fixture, every spectrum and every chromatogram the
/// backend produced declares it.
///
/// This boundary already refuses a list that holds records and declares no
/// count; treating an absent `defaultArrayLength` as merely unestablished was an
/// inconsistency in these rules rather than a considered distinction. It does
/// not contradict the comparison path degrading an absent length to unverified:
/// that gate answers *can these two documents be compared*, and this one answers
/// *is this document a usable result*. Only the second is available with no
/// source, and only the second is being asked here.
fn check_output_declared_array_lengths(after: &MzmlFacts) -> Option<ConversionIntegrityOutcome> {
    for (position, record) in after.spectra().iter().enumerate() {
        if record.default_array_length().is_none() {
            return Some(ConversionIntegrityOutcome::OutputArrayLengthMissing {
                part: DocumentPart::Spectrum,
                index: position as u64,
            });
        }
    }
    for (position, record) in after.chromatograms().iter().enumerate() {
        if record.default_array_length().is_none() {
            return Some(ConversionIntegrityOutcome::OutputArrayLengthMissing {
                part: DocumentPart::Chromatogram,
                index: position as u64,
            });
        }
    }
    None
}

/// Refuses an output whose spectra do not describe themselves.
///
/// The MS level check is document-wide because the scanner records the
/// distribution rather than the per-spectrum value, and a spectrum that omitted
/// the term lands in the `None` bucket — which is exactly the fact needed here.
/// The representation check is per record, because that one is kept per record.
fn check_output_spectrum_metadata(after: &MzmlFacts) -> Option<ConversionIntegrityOutcome> {
    // An absent MS level and one written as zero are the same defect wearing
    // different clothes: MS levels start at one, so neither says which stage a
    // spectrum came from, and both leave a downstream reader guessing.
    if after
        .ms_level_distribution()
        .keys()
        .any(|level| !matches!(level, Some(1..)))
    {
        return Some(ConversionIntegrityOutcome::OutputMsLevelMissing);
    }
    for (position, record) in after.spectra().iter().enumerate() {
        if record.representation() == RepresentationMarker::Conflicting {
            return Some(
                ConversionIntegrityOutcome::OutputRepresentationConflicting {
                    index: position as u64,
                },
            );
        }
    }
    None
}

/// Refuses an output nothing could decode.
///
/// Bounded the same way as the role check, and worth stating rather than
/// implying: the numeric encodings are a per-record union, so this refuses a
/// record that states no encoding at all and cannot refuse one where a single
/// array omitted its own, or declared two.
fn check_output_array_encoding(
    after: &MzmlFacts,
    policy: ConversionPolicy,
) -> Option<ConversionIntegrityOutcome> {
    let compression_matters = matches!(policy.compression(), CompressionPolicy::Zlib);
    for (position, record) in after.spectra().iter().enumerate() {
        if let Some(outcome) = judge_record_encoding(
            DocumentPart::Spectrum,
            position as u64,
            record.binary_array_count(),
            record.precision().is_empty(),
            compression_matters
                && record
                    .compression()
                    .contains(CompressionMarker::NoCompression),
        ) {
            return Some(outcome);
        }
    }
    for (position, record) in after.chromatograms().iter().enumerate() {
        if let Some(outcome) = judge_record_encoding(
            DocumentPart::Chromatogram,
            position as u64,
            record.binary_array_count(),
            record.precision().is_empty(),
            compression_matters
                && record
                    .compression()
                    .contains(CompressionMarker::NoCompression),
        ) {
            return Some(outcome);
        }
    }
    None
}

/// Whether one record's arrays can be decoded at all.
///
/// A record with no arrays is not judged: a peakless record is legitimate, and
/// one declaring points without arrays was already refused.
fn judge_record_encoding(
    part: DocumentPart,
    index: u64,
    binary_array_count: u32,
    precision_absent: bool,
    compression_contradictory: bool,
) -> Option<ConversionIntegrityOutcome> {
    if binary_array_count == 0 {
        return None;
    }
    if precision_absent {
        return Some(ConversionIntegrityOutcome::OutputArrayEncodingMissing { part, index });
    }
    if compression_contradictory {
        return Some(ConversionIntegrityOutcome::OutputCompressionContradictory { part, index });
    }
    None
}

/// The output is this boundary's own product, so it must agree with itself.
fn check_output_declared_counts(
    after: &MzmlFacts,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    if after
        .declared_spectrum_count()
        .is_some_and(|declared| declared != after.observed_spectrum_count())
    {
        return Some(
            ConversionIntegrityOutcome::OutputDeclaredCountInconsistent {
                part: DocumentPart::Spectrum,
            },
        );
    }
    if after
        .declared_chromatogram_count()
        .is_some_and(|declared| declared != after.observed_chromatogram_count())
    {
        return Some(
            ConversionIntegrityOutcome::OutputDeclaredCountInconsistent {
                part: DocumentPart::Chromatogram,
            },
        );
    }
    report
        .verified
        .insert(IntegrityProperty::OutputDeclaredCounts);
    None
}

/// The judgement itself, shared by both entry points so retention cannot change
/// what a conversion is found to be.
fn judge_against_source(
    source: &ConversionSourceFacts,
    output: ConversionOutputInspection,
    policy: ConversionPolicy,
) -> ConversionIntegrityOutcome {
    match revalidate_source(source.object()) {
        Ok(true) => {}
        Ok(false) => return ConversionIntegrityOutcome::SourceChangedDuringConversion,
        Err(outcome) => return outcome,
    }
    compare_documents(source, output, policy)
}

/// Whether the source object is still the one that was admitted.
///
/// Identity, length and content, in that order, and it is deliberately the same
/// three for every source posture: a vendor acquisition rewritten under a run is
/// exactly as invalidating as an mzML one, whatever else about it is readable.
fn revalidate_source(source: &SourceObjectFacts) -> Result<bool, ConversionIntegrityOutcome> {
    let unchanged_identity = source
        .identity
        .matches_current()
        .map_err(|error| ConversionIntegrityOutcome::SourceNotRevalidated { kind: error.kind() })?;
    if !unchanged_identity {
        return Ok(false);
    }
    let path = source.identity.canonical_path();
    let byte_length = std::fs::symlink_metadata(path)
        .map_err(|error| ConversionIntegrityOutcome::SourceNotRevalidated { kind: error.kind() })?
        .len();
    if byte_length != source.byte_length {
        return Ok(false);
    }
    let sha256 = Sha256Digest::calculate_file(path)
        .map_err(|_| ConversionIntegrityOutcome::SourceNotRehashed)?;
    Ok(sha256 == source.sha256)
}

fn compare_documents(
    source: &ConversionSourceFacts,
    output: ConversionOutputInspection,
    policy: ConversionPolicy,
) -> ConversionIntegrityOutcome {
    let before = source.facts();
    let after = output.facts();
    let mut report = IntegrityReport::default();
    report.verified.insert(IntegrityProperty::SourceUnchanged);

    if let Some(outcome) = compare_counts(before, after, &mut report) {
        return outcome;
    }
    if let Some(outcome) = compare_index_sequences(before, after, &mut report) {
        return outcome;
    }

    // A `referenceableParamGroup` can supply controlled-vocabulary facts
    // indirectly. Comparing an absent marker against a present one would then
    // be a parser artifact, so every vocabulary-derived property degrades to
    // unverified instead of being asserted.
    let vocabulary_comparable =
        !before.parameter_group_reference_observed() && !after.parameter_group_reference_observed();

    if vocabulary_comparable {
        if before.ms_level_distribution() != after.ms_level_distribution() {
            return ConversionIntegrityOutcome::MsLevelDistributionMismatch;
        }
        report
            .verified
            .insert(IntegrityProperty::MsLevelDistribution);
    } else {
        report
            .unverified
            .insert(IntegrityProperty::MsLevelDistribution);
    }

    // One declared point count missing anywhere makes the whole point-count
    // property unverifiable, so it is decided once for both lists.
    let lengths_comparable =
        declared_lengths_are_complete(before) && declared_lengths_are_complete(after);
    if let Some(outcome) = compare_spectra(
        before,
        after,
        vocabulary_comparable,
        lengths_comparable,
        &mut report,
    ) {
        return outcome;
    }
    if let Some(outcome) = compare_chromatograms(
        before,
        after,
        vocabulary_comparable,
        lengths_comparable,
        &mut report,
    ) {
        return outcome;
    }
    insert_property(
        &mut report,
        IntegrityProperty::BinaryArrayLengths,
        lengths_comparable,
    );
    // Array roles are vocabulary-derived, and both lists are now compared, so
    // the property is recorded once for the whole document pair.
    insert_property(
        &mut report,
        IntegrityProperty::BinaryArrayKinds,
        vocabulary_comparable,
    );
    if let Some(outcome) =
        check_compression_policy(after, policy, vocabulary_comparable, &mut report)
    {
        return outcome;
    }

    if before.root() != after.root() {
        report
            .advisory
            .insert(AdvisoryObservation::RootWrapperDiffers);
    }
    if source.byte_length() != output.byte_length() {
        report
            .advisory
            .insert(AdvisoryObservation::ByteLengthDiffers);
    }
    compare_retention_time_units(before, after, &mut report);

    ConversionIntegrityOutcome::Valid(Box::new(ValidConversion {
        output,
        mode: ValidationMode::SourceComparison,
        verified: report.verified,
        unverified: report.unverified,
        // A comparison was available, so nothing was outside the question.
        inapplicable: BTreeSet::new(),
        advisory: report.advisory,
    }))
}

#[derive(Default)]
struct IntegrityReport {
    verified: BTreeSet<IntegrityProperty>,
    unverified: BTreeSet<IntegrityProperty>,
    advisory: BTreeSet<AdvisoryObservation>,
}

fn declared_lengths_are_complete(facts: &MzmlFacts) -> bool {
    facts
        .spectra()
        .iter()
        .all(|record| record.default_array_length().is_some())
        && facts
            .chromatograms()
            .iter()
            .all(|record| record.default_array_length().is_some())
}

fn compare_counts(
    before: &MzmlFacts,
    after: &MzmlFacts,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    // The output is ours, so it must be internally consistent. A source that
    // disagrees with its own declared count is recorded, not rejected, because
    // every comparison below uses observed counts on both sides.
    if let Some(outcome) = check_output_declared_counts(after, report) {
        return Some(outcome);
    }
    if before
        .declared_spectrum_count()
        .is_some_and(|declared| declared != before.observed_spectrum_count())
        || before
            .declared_chromatogram_count()
            .is_some_and(|declared| declared != before.observed_chromatogram_count())
    {
        report
            .advisory
            .insert(AdvisoryObservation::SourceDeclaredCountInconsistent);
    }

    if before.observed_spectrum_count() != after.observed_spectrum_count() {
        return Some(ConversionIntegrityOutcome::SpectrumCountMismatch {
            source: before.observed_spectrum_count(),
            output: after.observed_spectrum_count(),
        });
    }
    report.verified.insert(IntegrityProperty::SpectrumCount);

    if before.observed_chromatogram_count() != after.observed_chromatogram_count() {
        return Some(ConversionIntegrityOutcome::ChromatogramCountMismatch {
            source: before.observed_chromatogram_count(),
            output: after.observed_chromatogram_count(),
        });
    }
    report.verified.insert(IntegrityProperty::ChromatogramCount);
    None
}

fn compare_index_sequences(
    before: &MzmlFacts,
    after: &MzmlFacts,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    for (side, facts) in [
        (DocumentSide::Source, before),
        (DocumentSide::Output, after),
    ] {
        if !facts.spectrum_index_sequence_is_consecutive() {
            return Some(ConversionIntegrityOutcome::IndexSequenceNotConsecutive {
                side,
                part: DocumentPart::Spectrum,
            });
        }
        if !facts.chromatogram_index_sequence_is_consecutive() {
            return Some(ConversionIntegrityOutcome::IndexSequenceNotConsecutive {
                side,
                part: DocumentPart::Chromatogram,
            });
        }
    }
    report.verified.insert(IntegrityProperty::IndexSequences);
    None
}

fn compare_spectra(
    before: &MzmlFacts,
    after: &MzmlFacts,
    vocabulary_comparable: bool,
    lengths_comparable: bool,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    let mut identity_comparable = true;

    for (position, (source, output)) in before.spectra().iter().zip(after.spectra()).enumerate() {
        let index = position as u64;
        if source.binary_array_count() != output.binary_array_count() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::Count,
            });
        }
        if lengths_comparable && source.default_array_length() != output.default_array_length() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::Length,
            });
        }
        if source.empty_binary_payload_count() != output.empty_binary_payload_count() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::PayloadPresence,
            });
        }
        if vocabulary_comparable && source.array_kinds() != output.array_kinds() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::Kinds,
            });
        }
        if source.precursor_count() != output.precursor_count() {
            return Some(ConversionIntegrityOutcome::PrecursorCountMismatch {
                first_divergent_index: index,
            });
        }
        match (source.scan_number(), output.scan_number()) {
            (Some(left), Some(right)) if left != right => {
                return Some(ConversionIntegrityOutcome::IdentityConflict {
                    first_divergent_index: index,
                });
            }
            (Some(_), Some(_)) => {}
            _ => identity_comparable = false,
        }
        if vocabulary_comparable
            && let Some(outcome) = compare_representation(index, source, output, report)
        {
            return Some(outcome);
        }
        if source.precision() != output.precision() {
            report
                .advisory
                .insert(AdvisoryObservation::NumericPrecisionDiffers);
        }
    }

    report.verified.insert(IntegrityProperty::BinaryArrayCounts);
    report.verified.insert(IntegrityProperty::PrecursorCounts);
    report
        .verified
        .insert(IntegrityProperty::BinaryArrayPayloadPresence);
    insert_property(
        report,
        IntegrityProperty::SpectrumRepresentation,
        vocabulary_comparable,
    );
    insert_property(
        report,
        IntegrityProperty::SpectrumNativeIdentity,
        identity_comparable,
    );
    None
}

fn compare_representation(
    index: u64,
    source: &MzmlSpectrumRecord,
    output: &MzmlSpectrumRecord,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    match (source.representation(), output.representation()) {
        (RepresentationMarker::Profile, RepresentationMarker::Centroid)
        | (RepresentationMarker::Centroid, RepresentationMarker::Profile) => {
            Some(ConversionIntegrityOutcome::RepresentationChange {
                first_divergent_index: index,
                source: source.representation(),
                output: output.representation(),
            })
        }
        (RepresentationMarker::NotEmitted, RepresentationMarker::NotEmitted) => None,
        (RepresentationMarker::NotEmitted, _) => {
            report
                .advisory
                .insert(AdvisoryObservation::RepresentationMarkerAdded);
            None
        }
        (_, RepresentationMarker::NotEmitted) => {
            report
                .advisory
                .insert(AdvisoryObservation::RepresentationMarkerRemoved);
            None
        }
        _ => None,
    }
}

fn compare_chromatograms(
    before: &MzmlFacts,
    after: &MzmlFacts,
    vocabulary_comparable: bool,
    lengths_comparable: bool,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    for (position, (source, output)) in before
        .chromatograms()
        .iter()
        .zip(after.chromatograms())
        .enumerate()
    {
        let index = position as u64;
        if source.binary_array_count() != output.binary_array_count() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Chromatogram,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::Count,
            });
        }
        if lengths_comparable && source.default_array_length() != output.default_array_length() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Chromatogram,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::Length,
            });
        }
        if source.empty_binary_payload_count() != output.empty_binary_payload_count() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Chromatogram,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::PayloadPresence,
            });
        }
        // A chromatogram that keeps its array count and length but swaps a time
        // array for an m/z array is corrupted, so roles are compared here too.
        if vocabulary_comparable && source.array_kinds() != output.array_kinds() {
            return Some(ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Chromatogram,
                first_divergent_index: index,
                kind: BinaryArrayMismatchKind::Kinds,
            });
        }
        if source.precision() != output.precision() {
            report
                .advisory
                .insert(AdvisoryObservation::NumericPrecisionDiffers);
        }
    }
    None
}

fn check_compression_policy(
    after: &MzmlFacts,
    policy: ConversionPolicy,
    vocabulary_comparable: bool,
    report: &mut IntegrityReport,
) -> Option<ConversionIntegrityOutcome> {
    if !vocabulary_comparable {
        report
            .unverified
            .insert(IntegrityProperty::CompressionPolicy);
        return None;
    }

    let uncompressed = after
        .spectra()
        .iter()
        .map(|record| {
            u64::from(
                record
                    .binary_array_count()
                    .saturating_sub(record.zlib_compressed_array_count()),
            )
        })
        .chain(after.chromatograms().iter().map(|record| {
            u64::from(
                record
                    .binary_array_count()
                    .saturating_sub(record.zlib_compressed_array_count()),
            )
        }))
        .sum::<u64>();
    if uncompressed > 0 {
        return Some(ConversionIntegrityOutcome::CompressionPolicyMismatch {
            requested: policy.compression(),
            uncompressed_array_count: uncompressed,
        });
    }
    report.verified.insert(IntegrityProperty::CompressionPolicy);
    None
}

/// The verified statement is "the set of emitted retention-time unit markers is
/// unchanged", which holds when neither document emitted one. This never claims
/// that an absent unit became known.
fn compare_retention_time_units(
    before: &MzmlFacts,
    after: &MzmlFacts,
    report: &mut IntegrityReport,
) {
    let unchanged = before.retention_time_units() == after.retention_time_units();
    if !unchanged {
        report
            .advisory
            .insert(AdvisoryObservation::RetentionTimeUnitDiffers);
    }
    insert_property(
        report,
        IntegrityProperty::RetentionTimeUnitMarkers,
        unchanged,
    );
}

fn insert_property(report: &mut IntegrityReport, property: IntegrityProperty, verified: bool) {
    if verified {
        report.verified.insert(property);
    } else {
        report.unverified.insert(property);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::mzml::MzmlRoot;

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    const VALID_OUTPUT: &str = concat!(
        r#"<indexedmzML><mzML><run><spectrumList count="1">"#,
        r#"<spectrum index="0" id="scan=1" defaultArrayLength="2">"#,
        r#"<cvParam accession="MS:1000511" name="ms level" value="1"/>"#,
        r#"<binaryDataArrayList count="1"><binaryDataArray encodedLength="8">"#,
        r#"<cvParam accession="MS:1000514" name="m/z array"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<binary>AA==</binary>"#,
        r#"</binaryDataArray></binaryDataArrayList></spectrum>"#,
        r#"</spectrumList></run></mzML></indexedmzML>"#,
    );

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mscanvas-conversion-tests-{}-{timestamp}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create conversion test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn inspect(directory: &Path) -> Result<ConversionOutputInspection, ConversionOutputRejection> {
        inspect_conversion_output(
            directory,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
            MzmlScanLimits::default(),
        )
    }

    #[test]
    fn conversion_output_file_name_preserves_the_stem_and_forces_the_format_extension() {
        assert_eq!(
            conversion_output_file_name(Path::new("/data/样本 01.raw"), OpenFormat::MzMl),
            Some(OsString::from("样本 01.mzML"))
        );
        assert_eq!(
            conversion_output_file_name(Path::new("/data/sample.mzML"), OpenFormat::MzXml),
            Some(OsString::from("sample.mzXML"))
        );
        // A trailing separator still names the directory, so it keeps a stem.
        assert_eq!(
            conversion_output_file_name(Path::new("/data/"), OpenFormat::MzMl),
            Some(OsString::from("data.mzML"))
        );
        // A path with no final component has nothing to preserve.
        assert_eq!(
            conversion_output_file_name(Path::new("/"), OpenFormat::MzMl),
            None
        );
        assert_eq!(
            conversion_output_file_name(Path::new(".."), OpenFormat::MzMl),
            None
        );
    }

    #[test]
    fn missing_partial_extra_and_nonregular_outputs_are_distinct_outcomes() {
        let directory = TestDirectory::new();
        assert_eq!(
            inspect(directory.path()),
            Err(ConversionOutputRejection::Missing)
        );

        let partial = TestDirectory::new();
        fs::write(partial.path().join("sample.mzML.partial"), b"incomplete")
            .expect("write partial output");
        assert_eq!(
            inspect(partial.path()),
            Err(ConversionOutputRejection::PartialOutput)
        );

        let extra = TestDirectory::new();
        fs::write(extra.path().join("sample.mzML"), VALID_OUTPUT).expect("write planned output");
        fs::write(extra.path().join("other.mzML"), VALID_OUTPUT).expect("write extra output");
        assert_eq!(
            inspect(extra.path()),
            Err(ConversionOutputRejection::UnexpectedExtraOutput { observed: 2 })
        );

        let non_regular = TestDirectory::new();
        fs::create_dir(non_regular.path().join("sample.mzML")).expect("create directory output");
        assert_eq!(
            inspect(non_regular.path()),
            Err(ConversionOutputRejection::NonRegularOutput)
        );

        let empty = TestDirectory::new();
        fs::write(empty.path().join("sample.mzML"), b"").expect("write empty output");
        assert_eq!(inspect(empty.path()), Err(ConversionOutputRejection::Empty));
    }

    #[test]
    fn the_output_must_carry_the_planned_name_and_extension() {
        let renamed = TestDirectory::new();
        fs::write(renamed.path().join("unplanned.mzML"), VALID_OUTPUT).expect("write output");
        assert_eq!(
            inspect(renamed.path()),
            Err(ConversionOutputRejection::UnexpectedOutputName)
        );

        let wrong_extension = TestDirectory::new();
        fs::write(wrong_extension.path().join("sample.mzXML"), VALID_OUTPUT).expect("write output");
        assert_eq!(
            inspect_conversion_output(
                wrong_extension.path(),
                OsStr::new("sample.mzXML"),
                OpenFormat::MzMl,
                MzmlScanLimits::default(),
            ),
            Err(ConversionOutputRejection::ExtensionMismatch)
        );
    }

    #[test]
    fn a_structurally_unusable_output_reports_its_scan_reason_before_any_hash() {
        let malformed = TestDirectory::new();
        fs::write(malformed.path().join("sample.mzML"), b"<mzML><run>")
            .expect("write malformed output");
        assert!(matches!(
            inspect(malformed.path()),
            Err(ConversionOutputRejection::Scan(_))
        ));

        let unsafe_output = TestDirectory::new();
        fs::write(
            unsafe_output.path().join("sample.mzML"),
            br#"<!DOCTYPE mzML><mzML><run/></mzML>"#,
        )
        .expect("write unsafe output");
        assert_eq!(
            inspect(unsafe_output.path()),
            Err(ConversionOutputRejection::Scan(MzmlScanError::Unsafe(
                crate::mzml::UnsafeXmlKind::DoctypeDeclaration
            )))
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_planned_output_reports_bytes_hash_and_typed_facts() {
        let directory = TestDirectory::new();
        fs::write(directory.path().join("sample.mzML"), VALID_OUTPUT).expect("write output");

        let inspection = inspect(directory.path()).expect("the planned output inspects cleanly");

        assert_eq!(inspection.byte_length(), VALID_OUTPUT.len() as u64);
        assert_eq!(
            inspection.sha256(),
            Sha256Digest::calculate(VALID_OUTPUT.as_bytes()).expect("hash the fixture")
        );
        assert_eq!(inspection.facts().root(), MzmlRoot::IndexedMzml);
        assert_eq!(inspection.facts().observed_spectrum_count(), 1);
    }

    #[test]
    fn output_rejections_expose_distinct_stable_ids_and_path_free_debug_output() {
        let ids = [
            ConversionOutputRejection::Missing.stable_id(),
            ConversionOutputRejection::Empty.stable_id(),
            ConversionOutputRejection::NonRegularOutput.stable_id(),
            ConversionOutputRejection::ChangedDuringInspection.stable_id(),
            ConversionOutputRejection::UnexpectedExtraOutput { observed: 2 }.stable_id(),
            ConversionOutputRejection::UnexpectedOutputName.stable_id(),
            ConversionOutputRejection::ExtensionMismatch.stable_id(),
            ConversionOutputRejection::PartialOutput.stable_id(),
            ConversionOutputRejection::Scan(MzmlScanError::Io {
                kind: io::ErrorKind::NotFound,
            })
            .stable_id(),
            ConversionOutputRejection::NotHashed.stable_id(),
            ConversionOutputRejection::DirectoryInspectionFailed {
                kind: io::ErrorKind::PermissionDenied,
            }
            .stable_id(),
        ];
        assert_eq!(
            ids.iter().collect::<std::collections::BTreeSet<_>>().len(),
            ids.len()
        );

        let directory = TestDirectory::new();
        fs::write(directory.path().join("sample.mzML.tmp"), b"incomplete").expect("write partial");
        let snapshot =
            fs_guard::snapshot_output_directory(directory.path()).expect("snapshot the directory");
        let rendered = format!("{snapshot:?}");
        assert!(rendered.contains("<opaque-sensitive>"));
        assert!(!rendered.contains("sample"));
    }

    /// A source and an output that differ only in legal serialization detail.
    fn source_document(spectra: &[SpectrumFixture], chromatograms: usize) -> String {
        document(spectra, chromatograms, Serialization::Source)
    }

    fn output_document(spectra: &[SpectrumFixture], chromatograms: usize) -> String {
        document(spectra, chromatograms, Serialization::Output)
    }

    #[derive(Clone, Copy)]
    enum Serialization {
        Source,
        Output,
    }

    #[derive(Clone, Copy)]
    struct SpectrumFixture {
        ms_level: u32,
        array_length: u64,
        arrays: &'static str,
        representation: &'static str,
        precursors: usize,
    }

    impl SpectrumFixture {
        const fn ms1(array_length: u64) -> Self {
            Self {
                ms_level: 1,
                array_length,
                arrays: "mz+intensity",
                representation: "profile",
                precursors: 0,
            }
        }

        const fn ms2(array_length: u64) -> Self {
            Self {
                ms_level: 2,
                array_length,
                arrays: "mz+intensity",
                representation: "centroid",
                precursors: 1,
            }
        }
    }

    fn document(
        spectra: &[SpectrumFixture],
        chromatograms: usize,
        serialization: Serialization,
    ) -> String {
        let mut body = String::new();
        for (index, spectrum) in spectra.iter().enumerate() {
            body.push_str(&format!(
                r#"<spectrum index="{index}" id="scan={}" defaultArrayLength="{}">"#,
                index + 1,
                spectrum.array_length
            ));
            body.push_str(&format!(
                r#"<cvParam accession="MS:1000511" name="ms level" value="{}"/>"#,
                spectrum.ms_level
            ));
            match spectrum.representation {
                "profile" => {
                    body.push_str(r#"<cvParam accession="MS:1000128" name="profile spectrum"/>"#);
                }
                "centroid" => {
                    body.push_str(r#"<cvParam accession="MS:1000127" name="centroid spectrum"/>"#);
                }
                _ => {}
            }
            body.push_str(
                r#"<scanList count="1"><scan><cvParam accession="MS:1000016" name="scan start time" value="5.9" unitAccession="UO:0000031" unitName="minute"/></scan></scanList>"#,
            );
            if spectrum.precursors > 0 {
                body.push_str(&format!(
                    r#"<precursorList count="{}">"#,
                    spectrum.precursors
                ));
                for _ in 0..spectrum.precursors {
                    body.push_str(r#"<precursor spectrumRef="scan=1"><isolationWindow><cvParam accession="MS:1000827" name="isolation window target m/z" value="445.12"/></isolationWindow></precursor>"#);
                }
                body.push_str("</precursorList>");
            }
            let arrays: &[&str] = match spectrum.arrays {
                "mz-only" => &["MS:1000514"],
                _ => &["MS:1000514", "MS:1000515"],
            };
            body.push_str(&format!(
                r#"<binaryDataArrayList count="{}">"#,
                arrays.len()
            ));
            for accession in arrays {
                // The two serializations deliberately disagree on numeric
                // encoding and cvParam order, which must never fail a check.
                let precision = match serialization {
                    Serialization::Source => "MS:1000523",
                    Serialization::Output => "MS:1000521",
                };
                body.push_str(r#"<binaryDataArray encodedLength="8">"#);
                match serialization {
                    Serialization::Source => body.push_str(&format!(
                        r#"<cvParam accession="{precision}"/><cvParam accession="MS:1000574"/><cvParam accession="{accession}"/>"#
                    )),
                    Serialization::Output => body.push_str(&format!(
                        r#"<cvParam accession="{accession}"/><cvParam accession="MS:1000574"/><cvParam accession="{precision}"/>"#
                    )),
                }
                body.push_str("<binary>AA==</binary></binaryDataArray>");
            }
            body.push_str("</binaryDataArrayList></spectrum>");
        }

        let mut chromatogram_body = String::new();
        for index in 0..chromatograms {
            chromatogram_body.push_str(&format!(
                r#"<chromatogram index="{index}" id="TIC{index}" defaultArrayLength="4"><binaryDataArrayList count="1"><binaryDataArray encodedLength="8"><cvParam accession="MS:1000595"/><cvParam accession="MS:1000574"/><binary>AA==</binary></binaryDataArray></binaryDataArrayList></chromatogram>"#
            ));
        }

        let run = format!(
            r#"<run id="R1"><spectrumList count="{}">{body}</spectrumList><chromatogramList count="{chromatograms}">{chromatogram_body}</chromatogramList></run>"#,
            spectra.len()
        );
        match serialization {
            // The source is a plain mzML root; the output adds the index
            // wrapper, exactly as msconvert does.
            Serialization::Source => format!(r#"<mzML version="1.1.0">{run}</mzML>"#),
            Serialization::Output => {
                format!(r#"<indexedmzML><mzML version="1.1.0">{run}</mzML></indexedmzML>"#)
            }
        }
    }

    #[cfg(windows)]
    fn verify(source_body: &str, output_body: &str) -> ConversionIntegrityOutcome {
        let directory = TestDirectory::new();
        let source_path = directory.path().join("source.mzML");
        let output_directory = directory.path().join("converted");
        fs::write(&source_path, source_body).expect("write source");
        fs::create_dir(&output_directory).expect("create output directory");
        fs::write(output_directory.join("source.mzML"), output_body).expect("write output");

        let source = capture_conversion_source(&source_path, MzmlScanLimits::default())
            .expect("capture source facts");
        verify_mzml_conversion(
            &source,
            &output_directory,
            OsStr::new("source.mzML"),
            ConversionPolicy::default(),
            MzmlScanLimits::default(),
        )
    }

    #[cfg(windows)]
    const TWO_SPECTRA: [SpectrumFixture; 2] = [SpectrumFixture::ms1(15), SpectrumFixture::ms2(8)];

    #[cfg(windows)]
    #[test]
    fn legal_serialization_differences_never_fail_a_conversion() {
        let outcome = verify(
            &source_document(&TWO_SPECTRA, 1),
            &output_document(&TWO_SPECTRA, 1),
        );

        let valid = outcome.valid().expect("the conversion is valid");
        assert!(
            valid.is_fully_verified(),
            "unverified: {:?}",
            valid.unverified()
        );
        // The index wrapper and the numeric-encoding change are recorded as
        // observations, never as failures.
        assert!(
            valid
                .advisory()
                .contains(&AdvisoryObservation::RootWrapperDiffers)
        );
        assert!(
            valid
                .advisory()
                .contains(&AdvisoryObservation::NumericPrecisionDiffers)
        );
        assert!(
            valid
                .verified()
                .contains(&IntegrityProperty::SourceUnchanged)
        );
        assert!(
            valid
                .verified()
                .contains(&IntegrityProperty::CompressionPolicy)
        );
    }

    #[cfg(windows)]
    #[test]
    fn spectrum_and_chromatogram_count_loss_are_distinct_failures() {
        let dropped_spectrum = [SpectrumFixture::ms1(15)];
        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&dropped_spectrum, 1)
            ),
            ConversionIntegrityOutcome::SpectrumCountMismatch {
                source: 2,
                output: 1
            }
        );

        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&TWO_SPECTRA, 0)
            ),
            ConversionIntegrityOutcome::ChromatogramCountMismatch {
                source: 1,
                output: 0
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn ms_level_distribution_change_fails() {
        let relabelled = [SpectrumFixture::ms1(15), SpectrumFixture::ms1(8)];
        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&relabelled, 1)
            ),
            ConversionIntegrityOutcome::MsLevelDistributionMismatch
        );
    }

    #[cfg(windows)]
    #[test]
    fn array_length_kind_and_count_divergence_report_the_first_index() {
        let truncated = [SpectrumFixture::ms1(15), SpectrumFixture::ms2(4)];
        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&truncated, 1)
            ),
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: 1,
                kind: BinaryArrayMismatchKind::Length,
            }
        );

        let mut dropped_array = TWO_SPECTRA;
        dropped_array[0].arrays = "mz-only";
        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&dropped_array, 1)
            ),
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: 0,
                kind: BinaryArrayMismatchKind::Count,
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_chromatogram_array_role_change_fails() {
        // Same array count, same declared length, different role.
        let output = output_document(&TWO_SPECTRA, 1).replace(
            r#"<chromatogram index="0" id="TIC0" defaultArrayLength="4"><binaryDataArrayList count="1"><binaryDataArray encodedLength="8"><cvParam accession="MS:1000595"/>"#,
            r#"<chromatogram index="0" id="TIC0" defaultArrayLength="4"><binaryDataArrayList count="1"><binaryDataArray encodedLength="8"><cvParam accession="MS:1000514"/>"#,
        );

        assert_eq!(
            verify(&source_document(&TWO_SPECTRA, 1), &output),
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Chromatogram,
                first_divergent_index: 0,
                kind: BinaryArrayMismatchKind::Kinds,
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_output_array_that_lost_its_payload_fails() {
        // Metadata is untouched; only the scientific payload is gone.
        let emptied = output_document(&TWO_SPECTRA, 1).replacen(
            "<binary>AA==</binary>",
            "<binary></binary>",
            1,
        );
        assert_eq!(
            verify(&source_document(&TWO_SPECTRA, 1), &emptied),
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: 0,
                kind: BinaryArrayMismatchKind::PayloadPresence,
            }
        );

        // Whitespace is not a payload either.
        let whitespace_only = output_document(&TWO_SPECTRA, 1).replacen(
            "<binary>AA==</binary>",
            "<binary>\n   </binary>",
            1,
        );
        assert_eq!(
            verify(&source_document(&TWO_SPECTRA, 1), &whitespace_only),
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: 0,
                kind: BinaryArrayMismatchKind::PayloadPresence,
            }
        );

        let chromatogram_loss = output_document(&TWO_SPECTRA, 1)
            .replace(r#"<cvParam accession="MS:1000595"/><cvParam accession="MS:1000574"/><binary>AA==</binary>"#, r#"<cvParam accession="MS:1000595"/><cvParam accession="MS:1000574"/><binary/>"#);
        assert_eq!(
            verify(&source_document(&TWO_SPECTRA, 1), &chromatogram_loss),
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Chromatogram,
                first_divergent_index: 0,
                kind: BinaryArrayMismatchKind::PayloadPresence,
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_valid_conversion_records_every_required_property_it_verified() {
        let outcome = verify(
            &source_document(&TWO_SPECTRA, 1),
            &output_document(&TWO_SPECTRA, 1),
        );
        let valid = outcome.valid().expect("the conversion is valid");

        for property in [
            IntegrityProperty::SourceUnchanged,
            IntegrityProperty::SpectrumCount,
            IntegrityProperty::ChromatogramCount,
            IntegrityProperty::IndexSequences,
            IntegrityProperty::MsLevelDistribution,
            IntegrityProperty::BinaryArrayCounts,
            IntegrityProperty::BinaryArrayKinds,
            IntegrityProperty::BinaryArrayLengths,
            IntegrityProperty::BinaryArrayPayloadPresence,
            IntegrityProperty::PrecursorCounts,
            IntegrityProperty::SpectrumNativeIdentity,
            IntegrityProperty::SpectrumRepresentation,
            IntegrityProperty::CompressionPolicy,
            IntegrityProperty::RetentionTimeUnitMarkers,
        ] {
            assert!(
                valid.verified().contains(&property),
                "{property:?} was not recorded as verified"
            );
        }
        assert!(valid.unverified().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn precursor_loss_and_representation_reversal_fail() {
        let mut without_precursor = TWO_SPECTRA;
        without_precursor[1].precursors = 0;
        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&without_precursor, 1)
            ),
            ConversionIntegrityOutcome::PrecursorCountMismatch {
                first_divergent_index: 1
            }
        );

        let mut centroided = TWO_SPECTRA;
        centroided[0].representation = "centroid";
        assert_eq!(
            verify(
                &source_document(&TWO_SPECTRA, 1),
                &output_document(&centroided, 1)
            ),
            ConversionIntegrityOutcome::RepresentationChange {
                first_divergent_index: 0,
                source: RepresentationMarker::Profile,
                output: RepresentationMarker::Centroid,
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_absent_source_representation_marker_stays_advisory() {
        let mut unmarked = TWO_SPECTRA;
        unmarked[0].representation = "none";
        unmarked[1].representation = "none";
        let outcome = verify(
            &document(&unmarked, 1, Serialization::Source),
            &output_document(&TWO_SPECTRA, 1),
        );

        let valid = outcome.valid().expect("the conversion stays valid");
        assert!(
            valid
                .advisory()
                .contains(&AdvisoryObservation::RepresentationMarkerAdded)
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_uncompressed_output_array_violates_the_requested_zlib_policy() {
        let output = output_document(&TWO_SPECTRA, 1).replace(
            r#"<cvParam accession="MS:1000574"/>"#,
            r#"<cvParam accession="MS:1000576"/>"#,
        );

        assert_eq!(
            verify(&source_document(&TWO_SPECTRA, 1), &output),
            ConversionIntegrityOutcome::CompressionPolicyMismatch {
                requested: CompressionPolicy::Zlib,
                uncompressed_array_count: 5,
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_opaque_native_identifier_leaves_identity_unverified_without_failing() {
        let source = source_document(&TWO_SPECTRA, 1)
            .replace(r#"id="scan=1""#, r#"id="controllerType=0 scan=1""#);
        let output = output_document(&TWO_SPECTRA, 1)
            .replace(r#"id="scan=1""#, r#"id="controllerType=0 scan=1""#);

        let outcome = verify(&source, &output);
        let valid = outcome
            .valid()
            .expect("an opaque identifier is not a failure");
        assert!(
            valid
                .unverified()
                .contains(&IntegrityProperty::SpectrumNativeIdentity)
        );
        assert!(!valid.is_fully_verified());
    }

    #[cfg(windows)]
    #[test]
    fn a_changed_retention_time_unit_marker_is_advisory_and_unverified() {
        let output = output_document(&TWO_SPECTRA, 1).replace(
            r#"unitAccession="UO:0000031""#,
            r#"unitAccession="UO:0000010""#,
        );

        let outcome = verify(&source_document(&TWO_SPECTRA, 1), &output);
        let valid = outcome
            .valid()
            .expect("a unit marker change is recorded, not failed");
        assert!(
            valid
                .advisory()
                .contains(&AdvisoryObservation::RetentionTimeUnitDiffers)
        );
        assert!(
            valid
                .unverified()
                .contains(&IntegrityProperty::RetentionTimeUnitMarkers)
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_conflicting_scan_number_fails() {
        let output = output_document(&TWO_SPECTRA, 1).replace(r#"id="scan=2""#, r#"id="scan=99""#);

        assert_eq!(
            verify(&source_document(&TWO_SPECTRA, 1), &output),
            ConversionIntegrityOutcome::IdentityConflict {
                first_divergent_index: 1
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_parameter_group_reference_degrades_vocabulary_properties_to_unverified() {
        let source = source_document(&TWO_SPECTRA, 1).replace(
            r#"<cvParam accession="MS:1000511" name="ms level" value="1"/>"#,
            r#"<referenceableParamGroupRef ref="CommonParams"/><cvParam accession="MS:1000511" name="ms level" value="1"/>"#,
        );

        let outcome = verify(&source, &output_document(&TWO_SPECTRA, 1));
        let valid = outcome
            .valid()
            .expect("an indirect vocabulary is not a failure");
        for property in [
            IntegrityProperty::MsLevelDistribution,
            IntegrityProperty::BinaryArrayKinds,
            IntegrityProperty::SpectrumRepresentation,
            IntegrityProperty::CompressionPolicy,
        ] {
            assert!(
                valid.unverified().contains(&property),
                "{property:?} should not be claimed as verified"
            );
        }
        assert!(!valid.is_fully_verified());
    }

    #[cfg(windows)]
    #[test]
    fn a_source_replaced_during_conversion_is_detected() {
        let directory = TestDirectory::new();
        let source_path = directory.path().join("source.mzML");
        let output_directory = directory.path().join("converted");
        fs::write(&source_path, source_document(&TWO_SPECTRA, 1)).expect("write source");
        fs::create_dir(&output_directory).expect("create output directory");
        fs::write(
            output_directory.join("source.mzML"),
            output_document(&TWO_SPECTRA, 1),
        )
        .expect("write output");

        let source = capture_conversion_source(&source_path, MzmlScanLimits::default())
            .expect("capture source facts");
        // Same length, different bytes: only the content hash can see this.
        let rewritten = source_document(&TWO_SPECTRA, 1).replace(r#"id="R1""#, r#"id="R2""#);
        assert_eq!(rewritten.len(), source_document(&TWO_SPECTRA, 1).len());
        fs::write(&source_path, &rewritten).expect("rewrite source in place");

        assert_eq!(
            verify_mzml_conversion(
                &source,
                &output_directory,
                OsStr::new("source.mzML"),
                ConversionPolicy::default(),
                MzmlScanLimits::default(),
            ),
            ConversionIntegrityOutcome::SourceChangedDuringConversion
        );
    }

    #[cfg(windows)]
    #[test]
    fn output_rejections_become_named_integrity_outcomes() {
        let directory = TestDirectory::new();
        let source_path = directory.path().join("source.mzML");
        fs::write(&source_path, source_document(&TWO_SPECTRA, 1)).expect("write source");
        let source = capture_conversion_source(&source_path, MzmlScanLimits::default())
            .expect("capture source facts");

        let empty_output = TestDirectory::new();
        assert_eq!(
            verify_mzml_conversion(
                &source,
                empty_output.path(),
                OsStr::new("source.mzML"),
                ConversionPolicy::default(),
                MzmlScanLimits::default(),
            ),
            ConversionIntegrityOutcome::MissingOutput
        );

        let wrong_root = TestDirectory::new();
        fs::write(
            wrong_root.path().join("source.mzML"),
            b"<notMzML><spectrum/></notMzML>",
        )
        .expect("write wrong-root output");
        assert_eq!(
            verify_mzml_conversion(
                &source,
                wrong_root.path(),
                OsStr::new("source.mzML"),
                ConversionPolicy::default(),
                MzmlScanLimits::default(),
            ),
            ConversionIntegrityOutcome::WrongRootFormat
        );

        let unsafe_output = TestDirectory::new();
        fs::write(
            unsafe_output.path().join("source.mzML"),
            br#"<!DOCTYPE mzML><mzML><run/></mzML>"#,
        )
        .expect("write unsafe output");
        assert_eq!(
            verify_mzml_conversion(
                &source,
                unsafe_output.path(),
                OsStr::new("source.mzML"),
                ConversionPolicy::default(),
                MzmlScanLimits::default(),
            ),
            ConversionIntegrityOutcome::UnsafeXml {
                kind: crate::mzml::UnsafeXmlKind::DoctypeDeclaration
            }
        );
    }

    #[test]
    fn integrity_outcomes_expose_distinct_stable_ids_and_path_free_debug_output() {
        let outcomes = [
            ConversionIntegrityOutcome::MissingOutput,
            ConversionIntegrityOutcome::EmptyOutput,
            ConversionIntegrityOutcome::NonRegularOutput,
            ConversionIntegrityOutcome::OutputChangedDuringInspection,
            ConversionIntegrityOutcome::PartialOutput,
            ConversionIntegrityOutcome::UnexpectedExtraOutput { observed: 2 },
            ConversionIntegrityOutcome::UnexpectedOutputName,
            ConversionIntegrityOutcome::OutputExtensionMismatch,
            ConversionIntegrityOutcome::WrongRootFormat,
            ConversionIntegrityOutcome::UnsafeXml {
                kind: crate::mzml::UnsafeXmlKind::UndeclaredEntity,
            },
            ConversionIntegrityOutcome::MalformedXml {
                kind: MzmlMalformedKind::NotWellFormed,
            },
            ConversionIntegrityOutcome::LimitExceeded {
                kind: MzmlLimitKind::Depth,
            },
            ConversionIntegrityOutcome::OutputNotInspected {
                kind: io::ErrorKind::NotFound,
            },
            ConversionIntegrityOutcome::OutputNotHashed,
            ConversionIntegrityOutcome::SourceChangedDuringConversion,
            ConversionIntegrityOutcome::SourceNotRevalidated {
                kind: io::ErrorKind::PermissionDenied,
            },
            ConversionIntegrityOutcome::SourceNotRehashed,
            ConversionIntegrityOutcome::OutputDeclaredCountInconsistent {
                part: DocumentPart::Spectrum,
            },
            ConversionIntegrityOutcome::SpectrumCountMismatch {
                source: 4,
                output: 3,
            },
            ConversionIntegrityOutcome::ChromatogramCountMismatch {
                source: 2,
                output: 0,
            },
            ConversionIntegrityOutcome::IndexSequenceNotConsecutive {
                side: DocumentSide::Output,
                part: DocumentPart::Spectrum,
            },
            ConversionIntegrityOutcome::MsLevelDistributionMismatch,
            ConversionIntegrityOutcome::BinaryArrayMismatch {
                part: DocumentPart::Spectrum,
                first_divergent_index: 0,
                kind: BinaryArrayMismatchKind::Length,
            },
            ConversionIntegrityOutcome::PrecursorCountMismatch {
                first_divergent_index: 0,
            },
            ConversionIntegrityOutcome::IdentityConflict {
                first_divergent_index: 0,
            },
            ConversionIntegrityOutcome::RepresentationChange {
                first_divergent_index: 0,
                source: RepresentationMarker::Profile,
                output: RepresentationMarker::Centroid,
            },
            ConversionIntegrityOutcome::CompressionPolicyMismatch {
                requested: CompressionPolicy::Zlib,
                uncompressed_array_count: 1,
            },
        ];

        let ids = outcomes
            .iter()
            .map(ConversionIntegrityOutcome::stable_id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), outcomes.len());
        assert!(!ids.contains("valid"));

        for outcome in &outcomes {
            let rendered = format!("{outcome:?}");
            assert!(!rendered.contains('/'), "{rendered}");
            assert!(!rendered.contains('\\'), "{rendered}");
            assert!(!outcome.is_valid());
        }
    }

    #[test]
    fn a_missing_output_directory_reports_a_bounded_io_kind() {
        let directory = TestDirectory::new();
        let missing = directory.path().join("absent");

        assert_eq!(
            inspect(&missing),
            Err(ConversionOutputRejection::DirectoryInspectionFailed {
                kind: io::ErrorKind::NotFound
            })
        );
    }
}
