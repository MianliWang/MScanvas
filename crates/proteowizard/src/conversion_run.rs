//! The typed mzML conversion boundary: one immutable plan, one staged
//! execution, one atomic finalization.
//!
//! [`conversion`](crate::conversion) owns the judgement of whether a produced
//! document is a faithful conversion. This module owns everything around that
//! judgement: which sources may be converted at all, where the output is
//! allowed to land, and the rule that a name in the destination root is only
//! ever taken by a document that already passed the judgement.
//!
//! Three properties are load-bearing.
//!
//! A source is a validated object, never a path, a name or an extension. It is
//! opened, canonicalized, identity-bound, hashed and read as mzML before it can
//! become one, so nothing that merely looks like an acquisition can be planned.
//!
//! The backend writes into a private staging directory this module creates
//! inside the destination root, never into the destination root itself. That
//! keeps every output the run produced enclosed in a directory MSCanvas owns,
//! which is what lets the integrity contract insist on exactly one planned
//! entry, and it means a failed or rejected run leaves nothing next to the
//! user's own files unless the cleanup itself fails, which is reported.
//!
//! Finalization is a no-clobber move of the validated output onto its final
//! name. There is no overwrite policy to select: an existing destination fails
//! or is skipped, and a destination that appears while the run is in flight
//! fails the move rather than replacing what arrived.
//!
//! Cancellation is opt-in and private. [`run_conversion`] requests none and
//! behaves exactly as it always has; [`run_conversion_cancellable`] takes one
//! [`ConversionCancellation`] bound to that single attempt and reports a
//! distinct result when the owned process tree was confirmed gone. Nothing here
//! is reachable from the product: there is no command, transfer object, queue
//! semantics or surface for it.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs::File;
use std::io;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::time::Duration;

use thiserror::Error;

use crate::cancellation::{CancellationObservation, ConversionCancellation};
use crate::capability::{InstalledHelpCapabilities, Sha256Digest};
use crate::command::{
    InputSpelling, OpenFormat, PlanError, SourceIdentity, build_msconvert_command_for_source,
};
use crate::conversion::{
    ConversionIntegrityOutcome, ConversionPolicy, ConversionSourceError, ConversionSourceFacts,
    SourceObjectFacts, ValidConversion, VerifiedConversion, capture_conversion_source,
    conversion_output_file_name, verify_mzml_conversion_retaining_output,
    verify_vendor_conversion_retaining_output,
};
use crate::fs_guard::{self, OutputEntryKind, RegularFileError, snapshot_output_directory};
use crate::mzml::{MzmlFacts, MzmlScanError, MzmlScanLimits};
use crate::process::{LaunchFailureKind, ProcessError, ProcessOutput, ProcessRunner, Termination};

/// Appended to the planned output file name to name the staging directory.
///
/// It is deliberately not one of the partial-output suffixes the output
/// snapshot recognizes, so a staging directory is never mistaken for an
/// interrupted write, and it is deterministic so an already-present staging
/// target is a defined, refusable state rather than a name collision.
const STAGING_SUFFIX: &str = ".mscanvas-staging";

/// Written inside a staging area as it is created, and required before one is
/// ever removed on the strength of its name alone. A name is not ownership: the
/// staging name is deterministic, so a user may hold a directory there too.
const STAGING_OWNER_MARKER: &str = ".mscanvas-staging-owner";

/// The marker's content. It is a constant rather than a token because it proves
/// which program made the directory, not which run: a run that ended without
/// cleaning up is exactly the case reclamation exists for, and it cannot leave
/// a live token behind.
const STAGING_OWNER_MAGIC: &[u8] = b"mscanvas-conversion-staging-area\n";

/// The staging area's own subdirectory, which the backend writes into.
///
/// The marker cannot sit beside the output: the integrity contract requires the
/// output directory to hold exactly one planned entry, and that requirement is
/// the point of a private staging area. So the marker owns the staging root and
/// the backend owns one level below it.
const STAGING_OUTPUT_DIRECTORY: &str = "output";

/// The per-component name limit every filesystem this project targets shares.
/// It bounds the staging name, which is the output name plus a suffix.
const MAX_COMPONENT_UNITS: usize = 255;

/// How many units of a name a filesystem counts: UTF-16 code units on Windows,
/// bytes elsewhere. Measuring in the wrong unit would refuse names that fit.
#[cfg(windows)]
fn component_units(name: &OsStr) -> usize {
    use std::os::windows::ffi::OsStrExt;

    name.encode_wide().count()
}

#[cfg(not(windows))]
fn component_units(name: &OsStr) -> usize {
    name.as_encoded_bytes().len()
}

/// Which source kinds this boundary is allowed to convert.
///
/// Each variant names an exact family the repository has measured evidence for,
/// and there is no generic vendor or RAW variant: a family MSCanvas has not
/// converted with a lawful fixture on a tested provider build is not
/// expressible here, not even as an unconstructed variant. Directory-formatted
/// acquisitions remain outside all of it, behind the evidence list ADR 0007
/// records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversionSourceKind {
    /// A regular file that read as mzML before it became a source.
    MzmlFile,
    /// A regular file carrying the Thermo Scientific RAW file signature.
    ///
    /// Single-file, not a directory acquisition, which is why it fits the
    /// object model the mzML posture already established rather than needing a
    /// new one.
    ThermoRawFile,
}

impl ConversionSourceKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::MzmlFile => "mzml_file",
            Self::ThermoRawFile => "thermo_raw_file",
        }
    }

    /// Whether a conversion from this source can be compared against it.
    ///
    /// Only a source this boundary can read under the same model as the output
    /// can. Everything else is validated on its output alone, and saying so
    /// here is what keeps the two from being confused downstream.
    #[must_use]
    pub const fn supports_source_comparison(self) -> bool {
        matches!(self, Self::MzmlFile)
    }

    /// How this family's source object must be spelled in the backend's argv.
    ///
    /// Measured, and it differs by family rather than by platform. On this
    /// build, ProteoWizard's own open-format reader opens the Windows
    /// extended-length canonical path this crate binds identity to, and the
    /// Thermo vendor library does not: it answers `Corrupt RAW file` and exits
    /// non-zero for the very object it converts successfully under a plain
    /// spelling. Nothing about the file changes; only how it is named.
    #[must_use]
    pub const fn input_spelling(self) -> InputSpelling {
        match self {
            Self::MzmlFile => InputSpelling::Canonical,
            Self::ThermoRawFile => InputSpelling::PlainVerified,
        }
    }

    /// Whether this family needs its own recorded provider-build evidence
    /// before a run may use it.
    ///
    /// mzML is read by ProteoWizard's own open-format code and by this crate's
    /// scanner, and the repository has open-format evidence across builds. A
    /// vendor family is read by a vendor library whose behaviour this
    /// repository has measured on exactly the builds it has measured.
    #[must_use]
    pub const fn requires_provider_build_evidence(self) -> bool {
        matches!(self, Self::ThermoRawFile)
    }
}

/// The exact leading bytes of a Thermo Scientific RAW file: `0x01 0xA1`
/// followed by `Finnigan` in UTF-16LE.
///
/// This is the same 18-byte header ProteoWizard's own `Reader_Thermo` matches
/// on, and it matches on nothing else — the file name is not consulted there.
/// Measured against the evidence fixture, which begins with exactly these bytes.
const THERMO_RAW_SIGNATURE: [u8; 18] = [
    0x01, 0xA1, b'F', 0, b'i', 0, b'n', 0, b'n', 0, b'i', 0, b'g', 0, b'a', 0, b'n', 0,
];

/// One ProteoWizard build a vendor source family was actually converted on.
///
/// A row exists because a real acquisition of that family was converted on that
/// exact build through this boundary and the result was recorded. Widening
/// support is therefore adding a measured row, not relaxing a check.
struct EvidencedProviderBuild {
    kind: ConversionSourceKind,
    release: &'static str,
    source_revision: &'static str,
    /// The digest of the exact `msconvert.exe` the conversion ran against.
    ///
    /// Two strings out of a help banner say what a build calls itself, not what
    /// it is. An installation reporting the same release and revision with the
    /// vendor libraries missing or replaced answers identically, and the
    /// evidence was never about that installation. Discovery already hashes the
    /// executable either side of its probe, so binding the row to the artifact
    /// costs nothing and is the strongest single thing this crate has probed.
    ///
    /// It is not a check on the vendor libraries themselves, which this crate
    /// never opens; that remains an open gate.
    executable_sha256: &'static str,
}

/// Every build this repository has vendor-source evidence for.
///
/// Deliberately exact and deliberately short. One successful conversion is
/// evidence about the build it ran on; treating it as evidence about every
/// installation is the claim ADR 0002 and the M0 spike both refuse to make,
/// because a vendor family is read by a vendor library whose behaviour changes
/// between releases and whose availability is not uniform across builds.
const EVIDENCED_PROVIDER_BUILDS: [EvidencedProviderBuild; 1] = [EvidencedProviderBuild {
    kind: ConversionSourceKind::ThermoRawFile,
    release: "3.0.26013",
    source_revision: "47b13cf",
    executable_sha256: "9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD",
}];

/// Whether the installed build is one this family has been converted on.
///
/// Public because a caller that is about to build a staging directory and a
/// plan should be able to learn the answer before it does that work, and the
/// only safe way to offer it that is to hand it *this* predicate. A second
/// implementation of the same rule at the call site would be a second rule the
/// moment either changed. [`run_conversion`] applies this one regardless, so a
/// caller that skips the question is refused, not admitted.
#[must_use]
pub fn provider_build_is_evidenced(
    capabilities: &InstalledHelpCapabilities,
    kind: ConversionSourceKind,
) -> bool {
    if !kind.requires_provider_build_evidence() {
        return true;
    }
    let Some(build) = capabilities.provider_build() else {
        // A build that will not say which it is cannot be matched against
        // evidence recorded for a specific one.
        return false;
    };
    let executable = capabilities.executable_sha256().to_string();
    EVIDENCED_PROVIDER_BUILDS.iter().any(|evidenced| {
        evidenced.kind == kind
            && build.is(evidenced.release, evidenced.source_revision)
            && executable.eq_ignore_ascii_case(evidenced.executable_sha256)
    })
}

/// The extension the installed vendor reader requires, whatever the signature
/// says.
///
/// Measured: a file carrying the exact Thermo signature under a different
/// extension is refused by the vendor library itself with `Corrupt RAW file`
/// and exit 1, producing nothing. The signature is the authority for *what a
/// file is*; this is the separate, equally measured fact about what the
/// installed reader will open. Admitting a source the backend cannot read would
/// be a refusal deferred to a launched process rather than a stated one.
const THERMO_RAW_EXTENSION: &str = "raw";

/// Why a candidate path did not become a conversion source. No variant carries
/// a path or backend text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionSourceRejection {
    #[error("the conversion source could not be inspected: {kind}")]
    NotInspectable { kind: io::ErrorKind },
    #[error("the conversion source is not a regular file")]
    NotARegularFile,
    #[error("the conversion source could not be read as mzML")]
    NotReadableAsMzml(MzmlScanError),
    #[error("the conversion source could not be hashed")]
    NotHashed,
    /// The name does not carry the extension the family's installed reader
    /// requires. This is a filter, not the recognition: a name that passes it
    /// still has to prove what it is.
    #[error("the conversion source does not carry the required file extension")]
    UnsupportedExtension,
    /// The object does not begin with the family's documented file signature.
    /// This is the recognition, and nothing about the name can substitute for
    /// it.
    #[error("the conversion source does not carry the expected file signature")]
    SignatureMismatch,
}

impl ConversionSourceRejection {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotInspectable { .. } => "source_not_inspectable",
            Self::NotARegularFile => "source_not_a_regular_file",
            Self::NotReadableAsMzml(_) => "source_not_readable_as_mzml",
            Self::NotHashed => "source_not_hashed",
            Self::UnsupportedExtension => "source_unsupported_extension",
            Self::SignatureMismatch => "source_signature_mismatch",
        }
    }
}

impl From<ConversionSourceError> for ConversionSourceRejection {
    fn from(error: ConversionSourceError) -> Self {
        match error {
            ConversionSourceError::NotResolved { kind } => Self::NotInspectable { kind },
            ConversionSourceError::NotHashed => Self::NotHashed,
            ConversionSourceError::Scan(error) => Self::NotReadableAsMzml(error),
        }
    }
}

impl From<RegularFileError> for ConversionSourceRejection {
    fn from(error: RegularFileError) -> Self {
        match error {
            RegularFileError::NotRegularFile
            | RegularFileError::Symlink
            | RegularFileError::ReparsePoint => Self::NotARegularFile,
            RegularFileError::ChangedDuringOpen => Self::NotInspectable {
                kind: io::ErrorKind::Other,
            },
            RegularFileError::Io { kind } => Self::NotInspectable { kind },
        }
    }
}

/// An acquisition that may be converted, together with the baseline a later
/// integrity comparison is measured against.
///
/// The only way to obtain one is to open a real file and read it, so a file
/// name, an extension or a value that merely looks like a path never becomes
/// acquisition identity.
#[derive(Clone, PartialEq)]
pub struct ConversionSource {
    kind: ConversionSourceKind,
    limits: MzmlScanLimits,
    baseline: SourceBaseline,
}

/// What a source can be measured against afterwards.
///
/// The variants are not two ways of holding the same thing. One carries a
/// reading of the source under the model the output will be read under, and the
/// other carries only what is true of the object. Which one a source has is
/// decided when it is admitted and is never re-decided.
#[derive(Clone, PartialEq)]
enum SourceBaseline {
    /// The source was read as mzML, so the output can be compared to it. Boxed
    /// because a whole document's facts dwarf the object facts beside it, and a
    /// vendor source should not carry that weight for a reading it does not have.
    Mzml(Box<ConversionSourceFacts>),
    /// The source is a bound, hashed object and nothing more. There is no mzML
    /// reading of it and this boundary will not pretend there is one.
    ObjectOnly(SourceObjectFacts),
}

impl SourceBaseline {
    const fn object(&self) -> &SourceObjectFacts {
        match self {
            Self::Mzml(facts) => facts.object(),
            Self::ObjectOnly(object) => object,
        }
    }
}

impl ConversionSource {
    /// Opens a regular-file mzML acquisition as a conversion source.
    ///
    /// The file is inspected for posture, canonicalized, bound to its
    /// filesystem identity, hashed and scanned as mzML. The scan limits are
    /// retained so the same contract judges the source and the output it is
    /// later compared against.
    pub fn open_mzml_file(
        path: &Path,
        limits: MzmlScanLimits,
    ) -> Result<Self, ConversionSourceRejection> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|error| ConversionSourceRejection::NotInspectable { kind: error.kind() })?;
        fs_guard::require_regular_file(&metadata)?;
        let facts = capture_conversion_source(path, limits)?;
        Ok(Self {
            kind: ConversionSourceKind::MzmlFile,
            limits,
            baseline: SourceBaseline::Mzml(Box::new(facts)),
        })
    }

    /// Opens a regular-file Thermo Scientific RAW acquisition as a conversion
    /// source.
    ///
    /// Admission is in three steps and the order matters. The posture check
    /// refuses anything that is not a plain regular file. The extension is then
    /// a filter, because the installed vendor reader will not open the object
    /// without it. And the file signature is the recognition: the object is
    /// opened under the no-follow guard and its first bytes are read *through
    /// that handle*, so what is recognized is the object, not the name that
    /// reached it.
    ///
    /// The scan limits are the ones the output will be read with. They judge
    /// nothing on this side — a RAW file is not mzML and this boundary never
    /// pretends to read one — and are carried so the plan keeps one limit
    /// contract whatever the source is.
    pub fn open_thermo_raw_file(
        path: &Path,
        limits: MzmlScanLimits,
    ) -> Result<Self, ConversionSourceRejection> {
        Self::open_signed_object(
            path,
            limits,
            ConversionSourceKind::ThermoRawFile,
            THERMO_RAW_EXTENSION,
            &THERMO_RAW_SIGNATURE,
        )
    }

    /// The shared body of every signature-recognized single-file family.
    fn open_signed_object(
        path: &Path,
        limits: MzmlScanLimits,
        kind: ConversionSourceKind,
        extension: &str,
        signature: &[u8],
    ) -> Result<Self, ConversionSourceRejection> {
        if !has_extension(path, extension) {
            return Err(ConversionSourceRejection::UnsupportedExtension);
        }

        // Pinned before anything is judged about it, and the order carries the
        // whole no-link promise. Checking the posture on the path and then
        // capturing the identity would leave the interval between them, and
        // `SourceIdentity::capture` *follows* links: a link dropped in there
        // would be canonicalized to its target, and a different acquisition —
        // one carrying a perfectly valid signature — would be admitted as the
        // one the caller chose. The open below refuses to traverse a reparse
        // point and withholds delete sharing, so the name cannot be repointed
        // afterwards and every judgement that follows is about this object.
        let mut file = open_admission_candidate(path)
            .map_err(|error| ConversionSourceRejection::NotInspectable { kind: error.kind() })?;
        let metadata = file
            .metadata()
            .map_err(|error| ConversionSourceRejection::NotInspectable { kind: error.kind() })?;
        fs_guard::require_regular_file(&metadata)?;
        let byte_length = metadata.len();

        let identity = SourceIdentity::capture(path)
            .map_err(|error| ConversionSourceRejection::NotInspectable { kind: error.kind() })?;

        // Both readings come from that one pinned handle, which withholds write
        // sharing. Reopening the name for the digest would let the signature
        // describe one object and the hash another; sharing the handle with a
        // writer would let it describe one *snapshot* and the hash another,
        // which is the same defect a step further in. Either way the pre-run
        // recheck would carry forward a digest of content nothing had
        // recognized, and skip re-reading the signature on the strength of a
        // digest that no longer covers it.
        //
        // An acquisition somebody else is writing is therefore not admitted at
        // all, which is the right answer: it is not a finished acquisition.
        let mut head = vec![0_u8; signature.len()];
        match file.read_exact(&mut head) {
            Ok(()) => {}
            // A file shorter than the signature cannot be carrying it. That is
            // a mismatch, not an inspection failure.
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
                return Err(ConversionSourceRejection::SignatureMismatch);
            }
            Err(error) => {
                return Err(ConversionSourceRejection::NotInspectable { kind: error.kind() });
            }
        }
        if head != signature {
            return Err(ConversionSourceRejection::SignatureMismatch);
        }

        file.rewind()
            .map_err(|error| ConversionSourceRejection::NotInspectable { kind: error.kind() })?;
        let sha256 = Sha256Digest::calculate_reader(&mut file)
            .map_err(|_| ConversionSourceRejection::NotHashed)?;
        let object = SourceObjectFacts::from_parts(identity, byte_length, sha256);
        drop(file);

        Ok(Self {
            kind,
            limits,
            baseline: SourceBaseline::ObjectOnly(object),
        })
    }

    #[must_use]
    pub const fn kind(&self) -> ConversionSourceKind {
        self.kind
    }

    #[must_use]
    pub const fn scan_limits(&self) -> MzmlScanLimits {
        self.limits
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.baseline.object().byte_length()
    }

    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.baseline.object().sha256()
    }

    /// The typed mzML facts read from the source before any conversion ran, for
    /// the source postures that have them.
    ///
    /// `None` is not a gap in this run's evidence. It says the source was never
    /// read as mzML, which is the whole reason its conversion is validated on
    /// the output alone.
    #[must_use]
    pub const fn mzml_facts(&self) -> Option<&MzmlFacts> {
        match &self.baseline {
            SourceBaseline::Mzml(facts) => Some(facts.facts()),
            SourceBaseline::ObjectOnly(_) => None,
        }
    }

    /// The volume serial number and 128-bit file id the admitted object was
    /// bound to, where the platform names objects that way.
    ///
    /// This exists so a caller that admitted the same object under its own
    /// rules can prove the two admissions are one object before it hands this
    /// source to a run. It deliberately carries no path: the caller already
    /// has the name it chose, and what it lacks — and cannot obtain safely by
    /// comparing names — is the object behind it.
    #[must_use]
    pub const fn object_identity(&self) -> Option<(u64, [u8; 16])> {
        self.baseline.object().identity().volume_and_file_id()
    }

    fn canonical_path(&self) -> &Path {
        self.baseline.object().identity().canonical_path()
    }
}

/// Whether a path carries exactly this extension, ignoring ASCII case.
///
/// The same predicate the output snapshot uses, for the same reason: Windows
/// does not distinguish `.raw` from `.RAW`, and a rule that did would refuse
/// files the backend accepts.
fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension().is_some_and(|extension| {
        extension
            .as_encoded_bytes()
            .eq_ignore_ascii_case(expected.as_bytes())
    })
}

impl fmt::Debug for ConversionSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionSource")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

/// What to do when the planned destination already exists.
///
/// There is deliberately no overwrite variant. Replacing a file the user
/// already has is not a policy this boundary can be asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConflictPolicy {
    /// Report the existing destination as a failure.
    #[default]
    Fail,
    /// Report the existing destination as work that was not needed.
    Skip,
}

impl ConflictPolicy {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Fail => "fail",
            Self::Skip => "skip",
        }
    }
}

/// Why a conversion plan could not be formed. No variant carries a path.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionPlanError {
    #[error("the conversion source has no name an output can be derived from")]
    SourceHasNoConvertibleName,
    #[error("the derived output file name is not one safe file name")]
    UnsafeOutputFileName,
    #[error("the derived output file name leaves no room for a staging name")]
    OutputFileNameTooLongToStage,
    #[error("the destination root could not be inspected: {kind}")]
    DestinationRootNotInspectable { kind: io::ErrorKind },
    #[error("the destination root is not a directory")]
    DestinationRootNotADirectory,
}

impl ConversionPlanError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::SourceHasNoConvertibleName => "source_has_no_convertible_name",
            Self::UnsafeOutputFileName => "unsafe_output_file_name",
            Self::OutputFileNameTooLongToStage => "output_file_name_too_long_to_stage",
            Self::DestinationRootNotInspectable { .. } => "destination_root_not_inspectable",
            Self::DestinationRootNotADirectory => "destination_root_not_a_directory",
        }
    }
}

/// One immutable decision about one conversion.
///
/// A plan states only what the first safe slice needs: a Rust-owned source, an
/// mzML output, the destination root that output may land in, the deterministic
/// name it will take there, what happens if that name is taken, and the
/// compression the integrity contract is entitled to assume. Every one of them
/// is fixed when the plan is formed.
#[derive(Clone, PartialEq)]
pub struct ConversionPlan {
    source: ConversionSource,
    destination_root: PathBuf,
    /// The destination root is admitted as an object, not as a name. A plan can
    /// outlive the directory the caller chose — a queue makes that ordinary
    /// rather than exotic — and a path that now resolves somewhere else is not
    /// the root this plan accepted.
    destination_root_identity: SourceIdentity,
    output_file_name: OsString,
    conflict: ConflictPolicy,
    compression: ConversionPolicy,
}

impl ConversionPlan {
    /// Plans one mzML conversion of `source` into `destination_root`.
    ///
    /// The output name is derived from the source, never supplied: the stem is
    /// preserved and the extension always comes from the format. mzML is the
    /// only format this constructor can express, so no caller can select a
    /// format variant the repository has no integrity evidence for.
    pub fn to_mzml(
        source: ConversionSource,
        destination_root: &Path,
        conflict: ConflictPolicy,
    ) -> Result<Self, ConversionPlanError> {
        let output_file_name =
            conversion_output_file_name(source.canonical_path(), OpenFormat::MzMl)
                .ok_or(ConversionPlanError::SourceHasNoConvertibleName)?;
        crate::command::validate_output_file_name(&output_file_name, OpenFormat::MzMl)
            .map_err(|_| ConversionPlanError::UnsafeOutputFileName)?;
        // The staging area is named after the output, so a name the plan would
        // otherwise accept can still be one this boundary cannot stage. Deciding
        // that here makes it a stated refusal rather than an opaque failure from
        // the operating system once a run is already under way.
        if component_units(&output_file_name) + STAGING_SUFFIX.len() > MAX_COMPONENT_UNITS {
            return Err(ConversionPlanError::OutputFileNameTooLongToStage);
        }

        let destination_root = std::fs::canonicalize(destination_root).map_err(|error| {
            ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
        })?;
        let metadata = std::fs::metadata(&destination_root).map_err(|error| {
            ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
        })?;
        if !metadata.is_dir() {
            return Err(ConversionPlanError::DestinationRootNotADirectory);
        }
        let destination_root_identity =
            SourceIdentity::capture(&destination_root).map_err(|error| {
                ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
            })?;

        Ok(Self {
            source,
            destination_root,
            destination_root_identity,
            output_file_name,
            conflict,
            compression: ConversionPolicy::default(),
        })
    }

    /// Whether the destination root is still the directory object this plan
    /// admitted, rather than whatever now answers to its name.
    fn destination_root_is_current(&self) -> io::Result<bool> {
        self.destination_root_identity.matches_current()
    }

    #[must_use]
    pub const fn source(&self) -> &ConversionSource {
        &self.source
    }

    /// The only output format a plan can carry.
    #[must_use]
    pub const fn format(&self) -> OpenFormat {
        OpenFormat::MzMl
    }

    #[must_use]
    pub const fn conflict_policy(&self) -> ConflictPolicy {
        self.conflict
    }

    #[must_use]
    pub const fn compression_policy(&self) -> ConversionPolicy {
        self.compression
    }

    /// The scan limits that judge both the source baseline and the output.
    #[must_use]
    pub const fn scan_limits(&self) -> MzmlScanLimits {
        self.source.limits
    }

    /// The deterministic name the finalized output takes in the destination
    /// root. This is a display name, not a location.
    #[must_use]
    pub fn output_file_name(&self) -> &OsStr {
        &self.output_file_name
    }

    /// The canonical directory a finalized output lands in. Rust-side only: a
    /// path never reaches a transfer boundary, but the caller that chose this
    /// root needs the canonical form to find what the run produced.
    #[must_use]
    pub fn destination_root(&self) -> &Path {
        &self.destination_root
    }

    /// Removes a staging area an earlier run of this exact plan left behind.
    ///
    /// A run refuses an existing staging area rather than adopting it, because
    /// another run may still own it. That is the right default and it is also a
    /// trap: one cleanup failure — a transient lock from a scanner or a backup
    /// agent is enough — leaves a directory whose deterministic name makes every
    /// later run of this plan refuse, and the path-free failure cannot say which
    /// name to remove. This is the deliberate way out.
    ///
    /// It removes only a directory MSCanvas created, proved by the ownership
    /// marker written when the staging area was made. A directory that carries
    /// no marker is refused untouched, whatever its name: the deterministic name
    /// is a name a user may also have chosen, and deleting a tree on the
    /// strength of a name is how unrelated data gets destroyed.
    ///
    /// Calling it asserts that no run of this plan is in flight. Nothing here
    /// can check that, which is why it is the caller's decision and not a
    /// silent step inside the run.
    pub fn reclaim_staging_area(&self) -> Result<(), StagingReclaimError> {
        // A staging area under a root this plan no longer admits is not this
        // plan's to remove, whatever it is called.
        match self.destination_root_is_current() {
            Ok(true) => {}
            Ok(false) => return Err(StagingReclaimError::NotOwned),
            Err(error) => {
                return Err(StagingReclaimError::NotInspectable { kind: error.kind() });
            }
        }

        // The staging root is opened once and everything after this decides
        // about that object. Nothing re-resolves the name, so what is verified
        // and what is deleted cannot come apart.
        let staging = self.staging_directory();
        let root = match open_owned_directory(&staging) {
            Ok(root) => root,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotADirectory => {
                return Err(StagingReclaimError::NotOwned);
            }
            Err(error) => {
                return Err(StagingReclaimError::NotInspectable { kind: error.kind() });
            }
        };

        let marker = match cleanup::admit_staging_root(&root, &staging, STAGING_OWNER_MAGIC) {
            cleanup::StagingAdmission::Owned(marker) => Some(marker),
            cleanup::StagingAdmission::Empty => {
                // Emptiness is not proof of ownership; it makes ownership
                // irrelevant, because removing an empty directory destroys
                // nothing. Teardown removes the marker before the root, so this
                // is exactly what an interrupted cleanup leaves behind.
                return cleanup::dispose_empty_root(root, &staging)
                    .map_err(StagingReclaimError::from_residue);
            }
            cleanup::StagingAdmission::NotOwned => return Err(StagingReclaimError::NotOwned),
            cleanup::StagingAdmission::NotInspectable(residue) => {
                return Err(StagingReclaimError::NotAdmissible(residue));
            }
        };

        cleanup::tear_down_owned_staging(
            root,
            &staging,
            cleanup::RetainedStagingObjects {
                output: None,
                marker,
                authority: cleanup::TeardownAuthority::AdmittedMarker,
            },
        )
        .map_err(StagingReclaimError::from_residue)
    }

    fn destination(&self) -> PathBuf {
        self.destination_root.join(&self.output_file_name)
    }

    fn staging_directory(&self) -> PathBuf {
        let mut name = self.output_file_name.clone();
        name.push(STAGING_SUFFIX);
        self.destination_root.join(name)
    }
}

impl fmt::Debug for ConversionPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionPlan")
            .field("source", &self.source)
            .field("format", &OpenFormat::MzMl)
            .field("conflict", &self.conflict)
            .field("compression", &self.compression)
            .finish_non_exhaustive()
    }
}

/// Which captured backend stream a capture failure describes.
///
/// The process boundary names its streams with a `&'static str`. That is fine
/// where it is produced, but a substituted runner may set it to anything, and
/// copying an arbitrary string verbatim into a type whose whole purpose is to
/// be safe to render would hand that guarantee to the caller. The projection is
/// closed instead.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BackendStream {
    #[error("stdout")]
    Stdout,
    #[error("stderr")]
    Stderr,
    #[error("an unrecognized stream")]
    Unrecognized,
}

impl BackendStream {
    fn from_label(label: &str) -> Self {
        match label {
            "stdout" => Self::Stdout,
            "stderr" => Self::Stderr,
            _ => Self::Unrecognized,
        }
    }

    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Unrecognized => "unrecognized_stream",
        }
    }
}

/// Why the backend could not be run to a verdict. This is the path-free
/// projection of [`ProcessError`], which retains the executable name and raw
/// operating-system detail for local diagnostics.
///
/// The projection is total rather than trimmed to what an mzML conversion can
/// currently reach, so a new [`ProcessError`] variant fails the build here
/// instead of being folded into an existing meaning. Three variants are
/// therefore unreachable today: the two staging-directory ones describe the
/// fresh-directory obligation only a preview plan carries, and
/// `OutputInsideSource` needs a directory-formatted source this boundary cannot
/// express.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BackendExecutionFailure {
    #[error("the backend child environment is invalid")]
    EnvironmentInvalid,
    #[error("the staged output destination already exists")]
    StagedDestinationExists,
    #[error("the staged output destination could not be inspected: {kind}")]
    StagedDestinationNotInspectable { kind: io::ErrorKind },
    #[error("the staging directory is no longer empty")]
    StagingDirectoryNotEmpty,
    #[error("the staging directory could not be inspected: {kind}")]
    StagingDirectoryNotInspectable { kind: io::ErrorKind },
    #[error("the staging directory now resolves inside the conversion source")]
    OutputInsideSource,
    #[error("the backend executable could not be reverified: {kind}")]
    ExecutableNotReverified { kind: io::ErrorKind },
    #[error("the backend executable changed after its capability probe")]
    ExecutableChanged,
    #[error("the conversion source could not be reverified: {kind}")]
    SourceNotReverified { kind: io::ErrorKind },
    #[error("the conversion source changed after the command was planned")]
    SourceChanged,
    #[error("the backend could not be launched")]
    NotLaunched { kind: LaunchFailureKind },
    #[error("the backend could not be assigned to an owned process job")]
    NotSupervised,
    #[error("the backend process could not be awaited")]
    NotAwaited,
    #[error("backend {stream} could not be captured")]
    OutputNotCaptured { stream: BackendStream },
    #[error("the owned backend process job could not be terminated")]
    NotTerminated,
}

impl BackendExecutionFailure {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::EnvironmentInvalid => "backend_environment_invalid",
            Self::StagedDestinationExists => "staged_destination_exists",
            Self::StagedDestinationNotInspectable { .. } => "staged_destination_not_inspectable",
            Self::StagingDirectoryNotEmpty => "staging_directory_not_empty",
            Self::StagingDirectoryNotInspectable { .. } => "staging_directory_not_inspectable",
            Self::OutputInsideSource => "output_inside_source",
            Self::ExecutableNotReverified { .. } => "backend_executable_not_reverified",
            Self::ExecutableChanged => "backend_executable_changed",
            Self::SourceNotReverified { .. } => "source_not_reverified",
            Self::SourceChanged => "source_changed",
            Self::NotLaunched { .. } => "backend_not_launched",
            Self::NotSupervised => "backend_not_supervised",
            Self::NotAwaited => "backend_not_awaited",
            Self::OutputNotCaptured { .. } => "backend_output_not_captured",
            Self::NotTerminated => "backend_not_terminated",
        }
    }
}

impl From<&ProcessError> for BackendExecutionFailure {
    fn from(error: &ProcessError) -> Self {
        match error {
            ProcessError::InvalidEnvironment { .. } => Self::EnvironmentInvalid,
            ProcessError::OutputDestinationExists => Self::StagedDestinationExists,
            ProcessError::OutputDestinationInspectionFailed { kind } => {
                Self::StagedDestinationNotInspectable { kind: *kind }
            }
            ProcessError::OutputDirectoryNotEmpty => Self::StagingDirectoryNotEmpty,
            ProcessError::OutputDirectoryInspectionFailed { kind } => {
                Self::StagingDirectoryNotInspectable { kind: *kind }
            }
            ProcessError::OutputDirectoryInsideDirectoryInput => Self::OutputInsideSource,
            ProcessError::ExecutableIdentityInspectionFailed { kind } => {
                Self::ExecutableNotReverified { kind: *kind }
            }
            ProcessError::ExecutableIdentityChanged => Self::ExecutableChanged,
            ProcessError::SourceIdentityInspectionFailed { kind } => {
                Self::SourceNotReverified { kind: *kind }
            }
            ProcessError::SourceIdentityChanged => Self::SourceChanged,
            ProcessError::Launch { kind, .. } => Self::NotLaunched { kind: *kind },
            ProcessError::AssignToOwnedJob { .. } => Self::NotSupervised,
            ProcessError::Wait { .. } => Self::NotAwaited,
            ProcessError::Capture { stream, .. } => Self::OutputNotCaptured {
                stream: BackendStream::from_label(stream),
            },
            ProcessError::Terminate { .. } => Self::NotTerminated,
        }
    }
}

/// Why one planned conversion produced no finalized output. No variant carries
/// a path or backend text.
///
/// Each variant's identifier names the failure this boundary owns; the embedded
/// plan and integrity errors carry their own, so a caller that must not render
/// `Debug` can still say precisely what went wrong.
#[derive(Debug, Error, PartialEq)]
pub enum ConversionRunFailure {
    /// The planned destination already exists and the plan refuses to replace it.
    #[error("the planned destination already exists")]
    DestinationExists,
    /// The planned destination could not be inspected before the run started.
    #[error("the planned destination could not be inspected: {kind}")]
    DestinationNotInspectable { kind: io::ErrorKind },
    /// A staging area for this exact output already exists. It is left alone.
    #[error("a staging area for this output already exists")]
    StagingTargetExists,
    /// The staging area could not be created.
    #[error("the staging area could not be created: {kind}")]
    StagingNotCreated { kind: io::ErrorKind },
    /// The plan could no longer be turned into a backend command.
    #[error("the conversion could not be planned: {0}")]
    NotPlannable(PlanError),
    /// The backend could not be run to a verdict.
    #[error("the backend could not be run: {0}")]
    Backend(BackendExecutionFailure),
    /// The backend exited without reporting success.
    #[error("the backend exited without reporting success")]
    BackendRejected { exit_code: Option<i32> },
    /// The backend did not run to completion, and no cancellation explains it.
    /// [`run_conversion`] requests none, so only a substituted runner can
    /// report one to it; [`run_conversion_cancellable`] reaches this only when
    /// a runner reports a non-ordinary termination that nobody asked for.
    #[error("the backend did not run to completion")]
    BackendDidNotComplete,
    /// The produced document failed the mzML conversion-integrity contract and
    /// was discarded rather than finalized.
    #[error("the produced document failed the conversion-integrity contract")]
    OutputRejected(ConversionIntegrityOutcome),
    /// The destination was taken between validation and finalization. What
    /// arrived there was left exactly as it was.
    #[error("the destination was taken while the conversion was running")]
    DestinationAppearedDuringRun,
    /// The validated output could not be moved onto its final name.
    #[error("the validated output could not be finalized: {kind}")]
    NotFinalized { kind: io::ErrorKind },
    /// The source is no longer the acquisition the plan accepted, so nothing was
    /// converted.
    #[error("the source is not the acquisition this plan accepted")]
    SourceChangedBeforeRun,
    /// The source could not be rechecked against the plan, so nothing was
    /// converted.
    #[error("the source could not be rechecked against the plan: {kind}")]
    SourceNotRechecked { kind: io::ErrorKind },
    /// The source could not be rehashed, so nothing was converted.
    #[error("the source could not be rehashed")]
    SourceNotRehashed,
    /// The installed backend build is not one this source family has been
    /// converted on. Nothing was created, launched or removed.
    #[error("the installed backend build has no evidence for this source family")]
    SourceFamilyNotEvidenced,
    /// The destination root is no longer the directory the plan accepted, so
    /// nothing was created there.
    #[error("the destination root is not the directory this plan accepted")]
    DestinationRootChanged,
    /// The destination root could not be rechecked against the plan, so nothing
    /// was created there.
    #[error("the destination root could not be rechecked: {kind}")]
    DestinationRootNotRechecked { kind: io::ErrorKind },
    /// The admitted destination root could not be held open, so no finalization
    /// could be bound to it.
    #[error("the destination root could not be opened: {kind}")]
    DestinationRootNotOpened { kind: io::ErrorKind },
}

impl ConversionRunFailure {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::DestinationExists => "destination_exists",
            Self::DestinationNotInspectable { .. } => "destination_not_inspectable",
            Self::StagingTargetExists => "staging_target_exists",
            Self::StagingNotCreated { .. } => "staging_not_created",
            Self::NotPlannable(_) => "conversion_not_plannable",
            Self::Backend(_) => "backend_execution_failed",
            Self::BackendRejected { .. } => "backend_rejected",
            Self::BackendDidNotComplete => "backend_did_not_complete",
            Self::OutputRejected(_) => "output_rejected",
            Self::DestinationAppearedDuringRun => "destination_appeared_during_run",
            Self::NotFinalized { .. } => "output_not_finalized",
            Self::SourceChangedBeforeRun => "source_changed_before_run",
            Self::SourceNotRechecked { .. } => "source_not_rechecked",
            Self::SourceNotRehashed => "source_not_rehashed",
            Self::SourceFamilyNotEvidenced => "source_family_not_evidenced",
            Self::DestinationRootChanged => "destination_root_changed",
            Self::DestinationRootNotRechecked { .. } => "destination_root_not_rechecked",
            Self::DestinationRootNotOpened { .. } => "destination_root_not_opened",
        }
    }

    /// The precise identifier for this failure, reaching into the embedded plan
    /// or integrity error where one exists.
    #[must_use]
    pub const fn detailed_stable_id(&self) -> &'static str {
        match self {
            Self::NotPlannable(error) => error.stable_id(),
            Self::Backend(failure) => failure.stable_id(),
            Self::OutputRejected(outcome) => outcome.stable_id(),
            other => other.stable_id(),
        }
    }
}

/// What one planned conversion did.
#[derive(Debug, PartialEq)]
pub enum ConversionRunOutcome {
    /// The output passed the integrity contract and now holds its planned name.
    Finalized(Box<ValidConversion>),
    /// The planned destination name was already taken and the plan asked for it
    /// to be skipped. This says the name is occupied, not that a valid
    /// conversion holds it: what is there is deliberately not inspected, because
    /// this boundary's guarantee is that it never replaces it.
    SkippedExistingDestination,
    /// No output was finalized.
    Failed(ConversionRunFailure),
}

impl ConversionRunOutcome {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::Finalized(_) => "finalized",
            Self::SkippedExistingDestination => "skipped_existing_destination",
            Self::Failed(failure) => failure.stable_id(),
        }
    }

    /// The precise identifier, reaching into the embedded failure where one
    /// exists.
    #[must_use]
    pub const fn detailed_stable_id(&self) -> &'static str {
        match self {
            Self::Failed(failure) => failure.detailed_stable_id(),
            other => other.stable_id(),
        }
    }
}

/// Bounded, path-free facts about the backend process that ran. Raw stdout and
/// stderr are deliberately absent: they can name the acquisition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendRunFacts {
    exit_code: Option<i32>,
    termination: Termination,
    elapsed: Duration,
    stdout_truncated: bool,
    stderr_truncated: bool,
    peak_job_memory_bytes: Option<u64>,
}

impl BackendRunFacts {
    #[must_use]
    pub const fn exit_code(self) -> Option<i32> {
        self.exit_code
    }

    /// How the process ended.
    ///
    /// Carried beside the exit code rather than derived from it, because the
    /// two can disagree: a process terminated in the window between being
    /// observed running and the job termination landing reports an ordinary
    /// exit status and is still a termination. A caller that must say what
    /// happened needs the one that describes the ending, not the one the
    /// racing process happened to hand back.
    #[must_use]
    pub const fn termination(self) -> Termination {
        self.termination
    }

    #[must_use]
    pub const fn elapsed(self) -> Duration {
        self.elapsed
    }

    #[must_use]
    pub const fn stdout_truncated(self) -> bool {
        self.stdout_truncated
    }

    #[must_use]
    pub const fn stderr_truncated(self) -> bool {
        self.stderr_truncated
    }

    #[must_use]
    pub const fn peak_job_memory_bytes(self) -> Option<u64> {
        self.peak_job_memory_bytes
    }
}

impl From<&ProcessOutput> for BackendRunFacts {
    fn from(output: &ProcessOutput) -> Self {
        Self {
            exit_code: output.exit_code,
            termination: output.termination,
            elapsed: output.elapsed,
            stdout_truncated: output.stdout_truncated,
            stderr_truncated: output.stderr_truncated,
            peak_job_memory_bytes: output.peak_job_memory_bytes,
        }
    }
}

/// What the run could not clean up after itself. This never changes the
/// outcome: a finalized conversion stays finalized and a failure keeps its
/// primary cause.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum StagingResidue {
    /// An object MSCanvas owned could not be removed.
    #[error("the staging area could not be removed: {kind}")]
    NotRemoved { kind: io::ErrorKind },
    /// Something replaced an entry between the moment it was listed and the
    /// moment it was opened. Neither the object that was listed nor the one that
    /// arrived was touched.
    #[error("a staging entry changed identity before it could be removed")]
    IdentityChanged,
    /// A link was found where an owned object was expected. It is never
    /// followed and never removed.
    #[error("a staging entry is a reparse point")]
    ReparsePointEncountered,
    /// The staging root holds something this boundary did not put there.
    #[error("the staging area holds an entry MSCanvas did not create")]
    ForeignEntry,
    /// The owned tree is deeper or wider than teardown will walk.
    #[error("the staging area exceeds the traversal limit")]
    TraversalLimitReached,
    /// A directory listing could not be read as the records it must be.
    #[error("a staging directory could not be enumerated")]
    NotEnumerable,
}

impl StagingResidue {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotRemoved { .. } => "staging_not_removed",
            Self::IdentityChanged => "staging_identity_changed",
            Self::ReparsePointEncountered => "staging_reparse_point",
            Self::ForeignEntry => "staging_foreign_entry",
            Self::TraversalLimitReached => "staging_traversal_limit_reached",
            Self::NotEnumerable => "staging_not_enumerable",
        }
    }
}

/// Why a staging area left behind by an earlier run could not be reclaimed.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum StagingReclaimError {
    /// Something holds the staging name that MSCanvas did not create. It is left
    /// exactly as it is.
    #[error("the staging name is held by something MSCanvas did not create")]
    NotOwned,
    /// Ownership could not be established either way, so nothing was removed.
    #[error("the staging area could not be inspected: {kind}")]
    NotInspectable { kind: io::ErrorKind },
    /// Ownership was established and the removal still failed.
    #[error("the staging area could not be removed: {kind}")]
    NotRemoved { kind: io::ErrorKind },
    /// Ownership was established and teardown stopped part-way. The ownership
    /// evidence a later attempt needs is deliberately still there.
    #[error("the staging area was not fully removed: {0}")]
    NotFullyRemoved(StagingResidue),
    /// Ownership could not be decided, so nothing was removed at all. This is
    /// not a partial teardown; it is a refusal before one began.
    #[error("the staging area could not be admitted: {0}")]
    NotAdmissible(StagingResidue),
}

impl StagingReclaimError {
    /// Reports a residue as the reason a reclamation failed.
    ///
    /// An owned tree that a lock or a permission refused is the one case this
    /// crate has always reported, and it keeps the variant — and therefore the
    /// identifier — it was published with. `NotFullyRemoved` carries the
    /// reasons that had no equivalent before.
    fn from_residue(residue: StagingResidue) -> Self {
        match residue {
            StagingResidue::NotRemoved { kind } => Self::NotRemoved { kind },
            other => Self::NotFullyRemoved(other),
        }
    }

    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotOwned => "staging_not_owned",
            Self::NotInspectable { .. } => "staging_not_inspectable",
            Self::NotRemoved { .. } => "staging_not_removed",
            Self::NotFullyRemoved(_) => "staging_not_fully_removed",
            Self::NotAdmissible(_) => "staging_not_admissible",
        }
    }

    /// The precise reason, reaching into the residue where one exists.
    #[must_use]
    pub const fn detailed_stable_id(self) -> &'static str {
        match self {
            Self::NotFullyRemoved(residue) | Self::NotAdmissible(residue) => residue.stable_id(),
            other => other.stable_id(),
        }
    }
}

/// Creates the ownership marker exclusively, following nothing, and returns the
/// object without writing to it.
///
/// A plain write would follow a link. The staging directory is new, but it sits
/// in a root another process may write to, so an entry can appear at the marker's
/// name between the directory being created and the marker being written — and a
/// followed link would truncate whatever it pointed at, which could be an output
/// the user already had or the acquisition itself. Neither the guard nor
/// reclamation could put that back.
///
/// Creating and writing are separate so the caller can retain the object before
/// anything goes into it. A write that fails then leaves teardown holding the
/// very file this run created, rather than an entry it can only refuse.
fn create_owner_marker(marker: &Path) -> io::Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const DELETE: u32 = 0x0001_0000;
        const FILE_GENERIC_READ: u32 = 0x0012_0089;
        const FILE_GENERIC_WRITE: u32 = 0x0012_0116;
        const FILE_SHARE_READ: u32 = 0x0000_0001;
        /// Refuse a reparse point rather than traverse it.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

        // The marker is held for the run: delete sharing is withheld so it
        // cannot be replaced under the run, and DELETE access is taken now so
        // teardown can remove this exact object without reopening a name.
        options
            .access_mode(FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(marker)
}

/// Puts the magic into a marker object the caller already holds.
fn write_owner_magic(marker: &mut File) -> io::Result<()> {
    use std::io::Write;

    marker.write_all(STAGING_OWNER_MAGIC)
}

/// The typed result of one planned conversion.
#[derive(Debug, PartialEq)]
pub struct ConversionRunReport {
    outcome: ConversionRunOutcome,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
}

impl ConversionRunReport {
    #[must_use]
    pub const fn outcome(&self) -> &ConversionRunOutcome {
        &self.outcome
    }

    /// The backend process facts, when a process ran at all.
    #[must_use]
    pub const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    #[must_use]
    pub const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }

    #[must_use]
    pub const fn finalized(&self) -> Option<&ValidConversion> {
        match &self.outcome {
            ConversionRunOutcome::Finalized(valid) => Some(valid),
            ConversionRunOutcome::SkippedExistingDestination | ConversionRunOutcome::Failed(_) => {
                None
            }
        }
    }

    const fn settled(outcome: ConversionRunOutcome) -> Self {
        Self {
            outcome,
            backend: None,
            residue: None,
        }
    }
}

/// The bounded shape of what the private staging area held when a cancellation
/// was settled.
///
/// It is evidence and only evidence. Cleanup decides what to remove from the
/// objects it holds and the identities it proves, never from this, so an
/// observation that fails, races or reads a directory mid-write changes nothing
/// about what is deleted. Names are absent because a staged output name is
/// derived from the acquisition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StagedContentObservation {
    entry_count: usize,
    directory_count: usize,
    non_empty_file_observed: bool,
}

impl StagedContentObservation {
    #[must_use]
    pub const fn entry_count(self) -> usize {
        self.entry_count
    }

    #[must_use]
    pub const fn directory_count(self) -> usize {
        self.directory_count
    }

    /// Whether any ordinary staged file held bytes at the moment this was taken.
    /// This is the only partial-output claim a run itself makes.
    #[must_use]
    pub const fn non_empty_file_observed(self) -> bool {
        self.non_empty_file_observed
    }
}

/// Records the shape of the staging output directory without judging it.
///
/// A failure to read it produces `None` rather than an error: a run that has
/// already confirmed its process tree is gone does not become a different
/// outcome because an observation for the record could not be taken.
fn observe_staged_content(staging: &Path) -> Option<StagedContentObservation> {
    let snapshot = snapshot_output_directory(staging).ok()?;
    let mut directory_count = 0;
    let mut non_empty_file_observed = false;
    for entry in snapshot.entries() {
        // Only the two kinds this observation names are counted. A link or a
        // reparse point is neither an ordinary staged file nor a directory, and
        // reporting its length as a partial output would attribute bytes to a
        // document that may not be one; it is still in `entry_count`, which is
        // what says something unexpected was there.
        match entry.kind() {
            OutputEntryKind::Directory => directory_count += 1,
            OutputEntryKind::RegularFile if entry.byte_length() > 0 => {
                non_empty_file_observed = true;
            }
            _ => {}
        }
    }
    Some(StagedContentObservation {
        entry_count: snapshot.len(),
        directory_count,
        non_empty_file_observed,
    })
}

/// What a confirmed cancellation established. Path-free, name-free and
/// identifier-free by construction: no process identifier, job handle, source,
/// staging or destination path, and no raw backend stream.
///
/// This type exists only where the owned process tree was confirmed gone. A
/// request that could not be confirmed is [`CancellationFailure`], never this.
#[derive(Debug, PartialEq)]
pub struct CancellationReport {
    observation: CancellationObservation,
    backend: Option<BackendRunFacts>,
    surviving_processes: Option<u32>,
    staged: Option<StagedContentObservation>,
    residue: Option<StagingResidue>,
}

impl CancellationReport {
    /// When the request was observed relative to the attempt's own beginning.
    #[must_use]
    pub const fn observation(&self) -> CancellationObservation {
        self.observation
    }

    /// Whether a backend process was handed to the process boundary at all.
    #[must_use]
    pub const fn backend_was_run(&self) -> bool {
        self.backend.is_some()
    }

    /// Bounded facts about the supervised process, when one ran. The elapsed
    /// time is the whole supervised interval, from spawn to a reaped tree, not
    /// the interval from the request alone.
    #[must_use]
    pub const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    /// Active processes the owned job reported once the run had finished with
    /// it. `Some(0)` is the confirmation that no descendant survived; `None`
    /// means the platform exposes no equivalent bounded accounting, or that no
    /// process was launched.
    #[must_use]
    pub const fn surviving_processes(&self) -> Option<u32> {
        self.surviving_processes
    }

    /// What the staging area held when the cancellation settled.
    #[must_use]
    pub const fn staged_content(&self) -> Option<StagedContentObservation> {
        self.staged
    }

    /// What identity-bound cleanup could not remove, if anything. A cancelled
    /// run is still cancelled; this is reported beside it, never instead of it.
    #[must_use]
    pub const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }
}

/// A cancellation that was requested and could not be confirmed.
///
/// The distinction from [`CancellationReport`] is the whole point. "The tree is
/// gone" and "the tree may still be running" are different facts about the
/// user's machine, and collapsing the second into the first would let a caller
/// report a stopped conversion that is still writing.
#[derive(Debug, PartialEq)]
pub struct CancellationFailure {
    cause: BackendExecutionFailure,
    backend: Option<BackendRunFacts>,
    staged: Option<StagedContentObservation>,
    residue: Option<StagingResidue>,
}

impl CancellationFailure {
    /// Why the request could not be confirmed. It keeps the process boundary's
    /// own typed reason rather than a cancellation-specific restatement of it.
    #[must_use]
    pub const fn cause(&self) -> BackendExecutionFailure {
        self.cause
    }

    /// Bounded facts about the process, where the boundary got far enough to
    /// have any. This is the case those facts matter most in: a tree that may
    /// still be running is exactly what a reader needs elapsed time and peak
    /// accounting for, and dropping them here would leave the least diagnosable
    /// outcome the least described.
    #[must_use]
    pub const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    #[must_use]
    pub const fn staged_content(&self) -> Option<StagedContentObservation> {
        self.staged
    }

    /// Cleanup residue, kept separate from the primary failure above.
    #[must_use]
    pub const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }
}

/// What one cancellable conversion attempt did.
///
/// Deliberately not a widening of [`ConversionRunOutcome`]. That enum is what a
/// caller with no cancellation object can reach, and the queue and the desktop
/// boundary both match it exhaustively; a cancellation state added to it would
/// become a state they must classify before any product decision about
/// cancellation has been made.
#[derive(Debug, PartialEq)]
pub enum ConversionAttempt {
    /// The attempt ran to a verdict of its own. That verdict may be a success,
    /// a skip or a failure; cancellation simply did not decide it.
    Completed(ConversionRunReport),
    /// The request was confirmed: no process of the owned tree survived, and no
    /// output was finalized.
    Cancelled(CancellationReport),
    /// The request was made and could not be confirmed.
    CancellationFailed(CancellationFailure),
}

impl ConversionAttempt {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::Completed(report) => report.outcome.stable_id(),
            Self::Cancelled(report) => report.observation.stable_id(),
            Self::CancellationFailed(_) => "cancellation_failed",
        }
    }

    /// The precise identifier, reaching into the embedded failure where one
    /// exists.
    #[must_use]
    pub const fn detailed_stable_id(&self) -> &'static str {
        match self {
            Self::Completed(report) => report.outcome.detailed_stable_id(),
            Self::CancellationFailed(failure) => failure.cause.stable_id(),
            other => other.stable_id(),
        }
    }

    /// The finalized conversion, when the attempt produced one. A cancelled or
    /// unconfirmed attempt has none, by construction rather than by convention.
    #[must_use]
    pub const fn finalized(&self) -> Option<&ValidConversion> {
        match self {
            Self::Completed(report) => report.finalized(),
            Self::Cancelled(_) | Self::CancellationFailed(_) => None,
        }
    }
}

/// The staging area a run created, held as the objects it created.
///
/// The guarantee is a lifetime and an object, not a call and a name. The run
/// executes caller-supplied code, so an unwind through it must not leave the
/// backend's output in the user's destination root — and the teardown that
/// prevents that must not be a recursive delete of whatever the names resolve to
/// by then. This type therefore keeps the objects themselves from the moment it
/// makes them, and teardown deletes those objects.
///
/// The path is kept to reach children and for nothing else: every object opened
/// through it still has to prove its identity before anything is removed.
struct OwnedStagingArea {
    /// The staging root. `None` once teardown has consumed it.
    root: Option<File>,
    /// The directory the backend writes into, held from creation so teardown
    /// never has to find it by name.
    output: Option<File>,
    /// The ownership marker, held from creation for the same reason.
    marker: Option<File>,
    path: PathBuf,
    state: StagingState,
}

/// Where a staging area is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StagingState {
    /// Created and holding its objects; the run may still be using it.
    Active,
    /// The run has finished with it and teardown may proceed.
    Finished,
    /// Teardown removed every object it owned.
    Cleaned,
    /// Teardown stopped, and what it could not remove is still there.
    Residue(StagingResidue),
}

impl OwnedStagingArea {
    /// Creates the staging area exclusively, marks it as MSCanvas's, makes the
    /// subdirectory the backend will write into, and holds all three.
    ///
    /// `create_dir` fails rather than adopting an existing directory, so this
    /// type never owns — and never removes — a directory it did not create. A
    /// partially built area is torn down rather than left for a later run.
    fn create(path: PathBuf) -> Result<Self, ConversionRunFailure> {
        if let Err(error) = std::fs::create_dir(&path) {
            return Err(match error.kind() {
                io::ErrorKind::AlreadyExists => ConversionRunFailure::StagingTargetExists,
                kind => ConversionRunFailure::StagingNotCreated { kind },
            });
        }
        let mut area = Self {
            root: None,
            output: None,
            marker: None,
            path,
            state: StagingState::Active,
        };
        if let Err(error) = area.populate() {
            // `Drop` tears down what was built through the objects it holds, but
            // a failure on the very first step leaves it holding none — and the
            // directory this function just created would outlive it.
            let bare = area.root.is_none();
            let path = area.path.clone();
            drop(area);
            if bare {
                let _ = std::fs::remove_dir(&path);
            }
            return Err(ConversionRunFailure::StagingNotCreated { kind: error.kind() });
        }
        Ok(area)
    }

    /// Opens the root, writes and keeps the marker, and makes and keeps the
    /// output directory. Any failure leaves `area` to tear down what exists.
    fn populate(&mut self) -> io::Result<()> {
        self.root = Some(open_owned_directory(&self.path)?);
        let marker_path = self.path.join(STAGING_OWNER_MARKER);
        // Retained before it is written, so a write that fails part-way leaves
        // teardown holding this exact object. A marker created by this run but
        // never filled in is otherwise an entry cleanup must refuse and
        // reclamation cannot vouch for, which would block the staging name for
        // good.
        self.marker = Some(create_owner_marker(&marker_path)?);
        write_owner_magic(self.marker.as_mut().expect("the marker was just stored"))?;
        let output_path = self.output_directory();
        std::fs::create_dir(&output_path)?;
        self.output = Some(open_owned_directory(&output_path)?);
        Ok(())
    }

    /// Where the backend writes. Validation inspects this directory, so the
    /// ownership marker one level above never counts as an unexpected output.
    fn output_directory(&self) -> PathBuf {
        self.path.join(STAGING_OUTPUT_DIRECTORY)
    }

    /// Removes the staging area with whatever the backend left in it. Nothing
    /// outside it is touched, and a rejected or partial document is discarded
    /// here rather than left where it could be mistaken for a result.
    fn discard(mut self) -> Option<StagingResidue> {
        self.state = StagingState::Finished;
        let residue = self.tear_down();
        self.state = residue.map_or(StagingState::Cleaned, StagingState::Residue);
        residue
    }

    /// The one teardown, shared by the ordinary exit and by an unwind.
    ///
    /// It is idempotent: the objects are taken, so a second call has nothing to
    /// take and reports nothing.
    fn tear_down(&mut self) -> Option<StagingResidue> {
        self.tear_down_seamed(&mut || {})
    }

    fn tear_down_seamed(&mut self, after_enumeration: &mut dyn FnMut()) -> Option<StagingResidue> {
        let root = self.root.take()?;
        let retained = cleanup::RetainedStagingObjects {
            output: self.output.take(),
            marker: self.marker.take(),
            authority: cleanup::TeardownAuthority::RetainedObjectsOnly,
        };
        cleanup::tear_down_owned_staging_seamed(root, &self.path, retained, after_enumeration).err()
    }

    /// Releases only the output directory, which is the state a run is in when
    /// it never managed to create and hold one.
    #[cfg(test)]
    fn release_output(&mut self) {
        self.output.take();
    }

    /// Releases the objects without removing anything, which is what a process
    /// that died mid-run leaves behind: the tree is still there and no handle
    /// holds it.
    #[cfg(test)]
    fn abandon(mut self) {
        self.root.take();
        self.output.take();
        self.marker.take();
        self.state = StagingState::Residue(StagingResidue::NotRemoved {
            kind: io::ErrorKind::Interrupted,
        });
    }

    /// The same discard, with the seam a test uses to change what the names in
    /// an already-listed directory mean.
    #[cfg(test)]
    fn discard_seamed(mut self, after_enumeration: &mut dyn FnMut()) -> Option<StagingResidue> {
        self.state = StagingState::Finished;
        let residue = self.tear_down_seamed(after_enumeration);
        self.state = residue.map_or(StagingState::Cleaned, StagingState::Residue);
        residue
    }
}

impl Drop for OwnedStagingArea {
    fn drop(&mut self) {
        // An unwind reaches here. It performs the same object-bound teardown —
        // never the old path-recursive one — and cannot report what it finds,
        // which is exactly why it must not be the more dangerous form.
        if self.root.is_some() {
            self.state = self
                .tear_down()
                .map_or(StagingState::Cleaned, StagingState::Residue);
        }
    }
}

impl fmt::Debug for OwnedStagingArea {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnedStagingArea")
            .field("state", &self.state)
            .field("objects_held", &self.root.is_some())
            .finish_non_exhaustive()
    }
}

/// Opens a directory MSCanvas owns, following nothing and refusing to let it be
/// renamed or removed by anyone else while it is held.
fn open_owned_directory(path: &Path) -> io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        const FILE_LIST_DIRECTORY: u32 = 0x0000_0001;
        const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
        const DELETE: u32 = 0x0001_0000;
        const SYNCHRONIZE: u32 = 0x0010_0000;
        const FILE_SHARE_READ: u32 = 0x0000_0001;
        const FILE_SHARE_WRITE: u32 = 0x0000_0002;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

        // Delete sharing is withheld so this directory cannot be renamed or
        // removed by anyone else while the run depends on it. It costs the user
        // the ability to rename or remove this directory, and any ancestor of
        // it, for the duration of a run.
        let opened = std::fs::OpenOptions::new()
            .read(true)
            .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let metadata = opened.metadata()?;
        // The open refuses to traverse a link; this refuses to act on one. A
        // junction planted at the staging name would otherwise be a directory
        // whose contents belong to somebody else.
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "an owned staging entry is a reparse point",
            ));
        }
        if !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "an owned staging entry is not a directory",
            ));
        }
        Ok(opened)
    }
    #[cfg(not(windows))]
    {
        // No object-bound open exists here, so the link check is made before
        // the open rather than on the opened object. It is the same refusal the
        // path-based probe this replaced always made.
        let observed = std::fs::symlink_metadata(path)?;
        if observed.file_type().is_symlink() || !observed.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "an owned staging entry is not a plain directory",
            ));
        }
        let opened = File::open(path)?;
        if !opened.metadata()?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "an owned staging entry is not a directory",
            ));
        }
        Ok(opened)
    }
}

/// Runs one planned conversion and reports what it did.
///
/// The sequence is fixed: refuse or skip an existing destination, create a
/// private staging directory, plan the backend command into it, run it through
/// the reviewed execution boundary, judge the produced document against the
/// source baseline, and only then take the final name. The staging directory is
/// discarded on every exit, including the successful one and an unwind.
#[must_use]
pub fn run_conversion(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
) -> ConversionRunReport {
    run_admitted(plan, capabilities, runner, None, || {}).into_uncancellable_report()
}

/// Runs one planned conversion that the caller may ask to stop.
///
/// The cancellation object is taken by value and is not `Clone`, so it belongs
/// to this attempt and to no other: there is no way to reuse it, reset it or
/// aim it at a second run. The caller keeps a
/// [`CancellationRequest`](crate::CancellationRequest) taken from it before the
/// call.
///
/// Everything else is [`run_conversion`], unchanged. The sequence, the staging
/// area, the judgement, the finalization and the identity-bound cleanup are the
/// same ones, and an attempt nobody asks to stop reaches exactly the result
/// that function would have returned.
///
/// This is a private evidence primitive. Nothing about the visible conversion
/// queue is cancellable, and no product surface reaches this.
#[must_use]
pub fn run_conversion_cancellable(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    cancellation: ConversionCancellation,
) -> ConversionAttempt {
    // Before anything is opened, inspected, created, planned or launched. This
    // is what makes `BeforeRun` a statement that none of that happened rather
    // than a guess about how far a run got.
    if cancellation.is_requested() {
        return ConversionAttempt::Cancelled(CancellationReport {
            observation: CancellationObservation::BeforeRun,
            backend: None,
            surviving_processes: None,
            staged: None,
            residue: None,
        });
    }

    match run_admitted(plan, capabilities, runner, Some(&cancellation), || {}) {
        RunResult::Settled(report) => ConversionAttempt::Completed(report),
        RunResult::Cancelled(report) => ConversionAttempt::Cancelled(report),
        RunResult::CancellationFailed(failure) => ConversionAttempt::CancellationFailed(failure),
    }
}

/// What a run reached, before it is presented to a caller that may or may not
/// hold a cancellation object.
enum RunResult {
    Settled(ConversionRunReport),
    Cancelled(CancellationReport),
    CancellationFailed(CancellationFailure),
}

impl RunResult {
    /// The report a caller that supplied no cancellation object receives.
    ///
    /// Neither cancellation state is reachable for such a caller: both are
    /// decided from the cancellation object itself, not from what a runner
    /// reported. They are translated rather than asserted, because a boundary
    /// whose purpose is to survive a substituted runner must not acquire a
    /// panic that a substituted runner could aim at.
    fn into_uncancellable_report(self) -> ConversionRunReport {
        match self {
            Self::Settled(report) => report,
            Self::Cancelled(report) => ConversionRunReport {
                outcome: ConversionRunOutcome::Failed(ConversionRunFailure::BackendDidNotComplete),
                backend: report.backend,
                residue: report.residue,
            },
            Self::CancellationFailed(failure) => ConversionRunReport {
                outcome: ConversionRunOutcome::Failed(ConversionRunFailure::Backend(failure.cause)),
                backend: failure.backend,
                residue: failure.residue,
            },
        }
    }
}

/// The body a cancellable attempt enters after its own pre-run refusal.
///
/// A test reaches it directly so it can exercise the second refusal — the one
/// that belongs to the interval between the pre-run check and the launch
/// decision, which the whole source rehash sits inside and which no caller can
/// aim a request at from outside.
#[cfg(test)]
fn run_admitted_cancellable(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    cancellation: &ConversionCancellation,
) -> RunResult {
    run_admitted(plan, capabilities, runner, Some(cancellation), || {})
}

/// The uncancellable body, with the validation seam the boundary's central
/// claim is tested through.
#[cfg(test)]
fn run_admitted_seamed(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    after_validation: impl FnOnce(),
) -> ConversionRunReport {
    run_admitted(plan, capabilities, runner, None, after_validation).into_uncancellable_report()
}

/// The body of a run, with a seam at the one interval this boundary's central
/// claim is about: after the output has been judged and before it is given the
/// final name. Production passes an empty hook; a test uses it to replace the
/// staging path underneath a validated object.
fn run_admitted(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    cancellation: Option<&ConversionCancellation>,
    after_validation: impl FnOnce(),
) -> RunResult {
    // Order matters here. The root is held before it is judged, not after: a
    // pinned directory cannot be renamed or removed, so the identity check
    // below decides about the object this run will actually use. Checking first
    // and opening afterwards would leave a window, and the work between them
    // includes rehashing the whole source, which is not a moment.
    let destination_directory = match finalize::DestinationDirectory::open(plan.destination_root())
    {
        Ok(directory) => directory,
        Err(error) => {
            return settled_failure(ConversionRunFailure::DestinationRootNotOpened {
                kind: error.kind(),
            });
        }
    };

    // Nothing is inspected, created or launched under a root that is no longer
    // the directory this plan admitted.
    match plan.destination_root_is_current() {
        Ok(true) => {}
        Ok(false) => {
            return settled_failure(ConversionRunFailure::DestinationRootChanged);
        }
        Err(error) => {
            return settled_failure(ConversionRunFailure::DestinationRootNotRechecked {
                kind: error.kind(),
            });
        }
    }

    let destination = plan.destination();
    match std::fs::symlink_metadata(&destination) {
        Ok(_) => {
            return RunResult::Settled(ConversionRunReport::settled(match plan.conflict {
                ConflictPolicy::Fail => {
                    ConversionRunOutcome::Failed(ConversionRunFailure::DestinationExists)
                }
                ConflictPolicy::Skip => ConversionRunOutcome::SkippedExistingDestination,
            }));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return settled_failure(ConversionRunFailure::DestinationNotInspectable {
                kind: error.kind(),
            });
        }
    }

    // A source family this installation has no evidence for is refused before a
    // staging area exists, so an ungated build never gets as far as creating a
    // directory or launching anything.
    if !provider_build_is_evidenced(capabilities, plan.source.kind()) {
        return settled_failure(ConversionRunFailure::SourceFamilyNotEvidenced);
    }

    // The source is held for the whole run, not merely checked before it. A
    // pinned object cannot be rewritten or renamed away while the backend reads
    // it, which is what makes "the backend converted the acquisition that was
    // verified" a property rather than a hope. It matters most for a source
    // posture with no output-side comparison to fall back on: a source rewritten
    // during the run and restored before the recheck would otherwise satisfy
    // every identity, length and digest test while the document came from bytes
    // nothing ever admitted.
    let _pinned_source = match pin_planned_source(&plan.source) {
        Ok(pinned) => pinned,
        Err(failure) => return settled_failure(failure),
    };

    // Rehashing the whole source above is the longest thing this run does
    // before it creates anything, so a request that arrives during it is
    // answered here rather than by creating a directory only to remove it. It
    // is `DuringRun` and not `BeforeRun`: the attempt had begun, it opened and
    // read the acquisition, and only the launch is what did not happen.
    if let Some(cancellation) = cancellation
        && cancellation.is_requested()
    {
        return RunResult::Cancelled(CancellationReport {
            observation: CancellationObservation::DuringRun,
            backend: None,
            surviving_processes: None,
            staged: None,
            residue: None,
        });
    }

    let staging = match OwnedStagingArea::create(plan.staging_directory()) {
        Ok(staging) => staging,
        Err(failure) => return settled_failure(failure),
    };

    let staged = run_staged(
        plan,
        capabilities,
        runner,
        cancellation,
        &staging.output_directory(),
        &destination_directory,
        after_validation,
    );
    // Every handle this run held on anything inside the staging area is gone by
    // now: the validated output is consumed by finalization and dropped by every
    // other path, so cleanup is never blocked by this run's own reading. It runs
    // for a cancelled attempt exactly as for a completed one — the whole point
    // of a cancellation being safe is that whatever the terminated backend left
    // behind is removed by the same object-bound teardown.
    let residue = staging.discard();
    match staged {
        StagedResult::Settled(outcome, backend) => RunResult::Settled(ConversionRunReport {
            outcome,
            backend,
            residue,
        }),
        StagedResult::Cancelled {
            backend,
            surviving_processes,
            staged,
        } => RunResult::Cancelled(CancellationReport {
            observation: CancellationObservation::DuringRun,
            backend,
            surviving_processes,
            staged,
            residue,
        }),
        StagedResult::CancellationFailed {
            cause,
            backend,
            staged,
        } => RunResult::CancellationFailed(CancellationFailure {
            cause,
            backend,
            staged,
            residue,
        }),
    }
}

/// A settled failure that reached no backend and created no staging area.
fn settled_failure(failure: ConversionRunFailure) -> RunResult {
    RunResult::Settled(ConversionRunReport::settled(ConversionRunOutcome::Failed(
        failure,
    )))
}

/// Refuses a source that is no longer the acquisition the plan accepted.
///
/// The command builder captures the source's identity again from its path, so
/// without this the backend would be bound to whatever now holds that name
/// rather than to what was measured and admitted. The post-run comparison would
/// usually notice — but only by rejecting a conversion that should never have
/// been run, and only if the original is still displaced when it looks. Restore
/// the original first and the comparison agrees with itself while the backend
/// read something else entirely, which the integrity scanner cannot detect
/// because it never decodes an array payload.
///
/// This costs one full read of the source. A conversion already reads it twice;
/// binding the run to the bytes that were admitted is worth the third.
fn pin_planned_source(source: &ConversionSource) -> Result<File, ConversionRunFailure> {
    let object = source.baseline.object();

    // Held before it is judged, and the order is the whole point. Checking the
    // identity and then opening leaves the interval between them: a name
    // atomically replaced in there binds this handle to an object nothing
    // admitted, and a replacement carrying identical bytes would pass the
    // length and digest checks below and launch a conversion that can run for
    // minutes before the post-run revalidation notices. Once the handle exists
    // without delete sharing the name cannot be repointed, so the check that
    // follows describes the object this run will actually use.
    let path = source.canonical_path();
    // An open that fails says the recheck could not be made, which is the
    // reason this boundary has always given for a source it cannot reach. What
    // the source *became* is decided by the posture, length and digest checks
    // below, so reordering the open does not move a case from one reason to the
    // other.
    let mut pinned = open_pinned_source(path)
        .map_err(|error| ConversionRunFailure::SourceNotRechecked { kind: error.kind() })?;

    match object.identity().matches_current() {
        Ok(true) => {}
        Ok(false) => return Err(ConversionRunFailure::SourceChangedBeforeRun),
        Err(error) => {
            return Err(ConversionRunFailure::SourceNotRechecked { kind: error.kind() });
        }
    }

    let metadata = pinned
        .metadata()
        .map_err(|error| ConversionRunFailure::SourceNotRechecked { kind: error.kind() })?;
    fs_guard::require_regular_file(&metadata)
        .map_err(|_| ConversionRunFailure::SourceChangedBeforeRun)?;
    if metadata.len() != object.byte_length() {
        return Err(ConversionRunFailure::SourceChangedBeforeRun);
    }
    // Hashed through the handle that holds it, so the bytes this compares are
    // the bytes nothing can change for as long as the handle lives.
    let sha256 = Sha256Digest::calculate_reader(&mut pinned)
        .map_err(|_| ConversionRunFailure::SourceNotRehashed)?;
    if sha256 != object.sha256() {
        return Err(ConversionRunFailure::SourceChangedBeforeRun);
    }
    // A digest that still matches is also the family recognition still holding:
    // the signature is a prefix of the bytes this digest covers, so re-reading
    // it would re-derive a fact the hash has already settled.
    Ok(pinned)
}

/// Opens a candidate acquisition so it can be judged from the object itself.
///
/// The same posture as the run's own hold — no link is followed, and neither
/// write nor delete sharing is granted — with one difference: a directory is
/// allowed to open, so that a directory offered as a source is refused by the
/// posture check with the reason that is true of it rather than by the open
/// with an incidental one.
#[cfg(windows)]
fn open_admission_candidate(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

/// Opens a candidate acquisition. No platform outside Windows offers a
/// mandatory share mode through the standard library, so the guarantee is
/// narrower and the posture check after it is what remains.
#[cfg(not(windows))]
fn open_admission_candidate(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// Opens the acquisition so that nobody can change it while it is converted.
///
/// Read sharing is granted, because the backend has to open the same object by
/// name and a concurrent reader invalidates nothing. Write sharing is withheld,
/// so the bytes the digest above covers are the bytes the backend reads. Delete
/// sharing is withheld too, and that half is what stops the *name* being made to
/// mean something else: the backend resolves a path, so a source renamed away
/// and replaced would otherwise hand it an object this run never admitted.
///
/// The cost is real and belongs in the record: for the duration of a conversion
/// the user cannot modify, rename or delete the acquisition being converted.
#[cfg(windows)]
fn open_pinned_source(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

/// Opens the acquisition for reading.
///
/// No platform outside Windows offers a mandatory share mode through the
/// standard library, so this holds the object open without preventing anyone
/// from writing to it. The guarantee is correspondingly narrower and is not
/// described as equivalent.
#[cfg(not(windows))]
fn open_pinned_source(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// What the staged half of a run reached.
enum StagedResult {
    Settled(ConversionRunOutcome, Option<BackendRunFacts>),
    Cancelled {
        backend: Option<BackendRunFacts>,
        surviving_processes: Option<u32>,
        staged: Option<StagedContentObservation>,
    },
    CancellationFailed {
        cause: BackendExecutionFailure,
        backend: Option<BackendRunFacts>,
        staged: Option<StagedContentObservation>,
    },
}

impl StagedResult {
    fn failed(failure: ConversionRunFailure) -> Self {
        Self::Settled(ConversionRunOutcome::Failed(failure), None)
    }
}

fn run_staged(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    cancellation: Option<&ConversionCancellation>,
    staging: &Path,
    destination_directory: &finalize::DestinationDirectory,
    after_validation: impl FnOnce(),
) -> StagedResult {
    let command = match build_msconvert_command_for_source(
        capabilities,
        plan.source.canonical_path(),
        staging,
        plan.output_file_name(),
        OpenFormat::MzMl,
        plan.source.kind().input_spelling(),
    ) {
        Ok(command) => command,
        Err(error) => return StagedResult::failed(ConversionRunFailure::NotPlannable(error)),
    };

    // The one production runner stays the authority for child creation, the
    // environment, job assignment, stream capture, the wait and process-tree
    // teardown. This chooses which of its two entry points to use and nothing
    // else; there is no second subprocess implementation here.
    let result = match cancellation {
        Some(cancellation) => runner.run_cancellable(&command, cancellation.token()),
        None => runner.run(&command),
    };
    let requested = cancellation.is_some_and(ConversionCancellation::is_requested);

    let output = match result {
        Ok(output) => output,
        Err(error) => {
            let cause = BackendExecutionFailure::from(&error);
            // A request that was made and whose teardown could not be completed
            // is neither a cancellation nor an ordinary backend failure: what
            // it means is that this boundary cannot say the tree is gone. Only
            // the two failures that describe exactly that are reclassified, so
            // a launch or capture failure that happens to coincide with a
            // request keeps the reason that is true of it.
            if requested
                && matches!(
                    cause,
                    BackendExecutionFailure::NotTerminated | BackendExecutionFailure::NotAwaited
                )
            {
                return StagedResult::CancellationFailed {
                    cause,
                    // The runner returned an error rather than a result, so
                    // there are no process facts to report.
                    backend: None,
                    staged: observe_staged_content(staging),
                };
            }
            return StagedResult::failed(ConversionRunFailure::Backend(cause));
        }
    };
    let backend = Some(BackendRunFacts::from(&output));

    if output.termination != Termination::Exited {
        // A request must actually have been made on the object this attempt
        // holds. A runner that reports a non-ordinary termination nobody asked
        // for is reporting a run that did not complete, which is the meaning
        // this boundary has always given it.
        if !requested {
            return StagedResult::Settled(
                ConversionRunOutcome::Failed(ConversionRunFailure::BackendDidNotComplete),
                backend,
            );
        }
        let staged = observe_staged_content(staging);
        return match output.termination {
            // No process was created, so there are no process facts to report
            // and no tree whose disappearance could be confirmed. The staging
            // area exists — the run made it before it asked — and is reported
            // as what it is.
            Termination::NotStarted => StagedResult::Cancelled {
                backend: None,
                surviving_processes: None,
                staged,
            },
            // A tree existed, so `Cancelled` is a claim that it is gone, and
            // only the owned job saying so makes it one. `None` is not that
            // claim: it means no bounded accounting was available, which is
            // exactly the state in which a caller must not be told the
            // conversion stopped while it may still be writing.
            Termination::Cancelled if output.final_active_processes == Some(0) => {
                StagedResult::Cancelled {
                    backend,
                    surviving_processes: Some(0),
                    staged,
                }
            }
            _ => StagedResult::CancellationFailed {
                cause: BackendExecutionFailure::NotTerminated,
                backend,
                staged,
            },
        };
    }
    if !output.success() {
        return StagedResult::Settled(
            ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected {
                exit_code: output.exit_code,
            }),
            backend,
        );
    }

    // Exit status is not evidence of a usable document. The judgement below is
    // the only thing that may unlock the final name, and it hands back the very
    // object it judged rather than a description of one.
    //
    // Which judgement runs is decided by what the source is, not by what the
    // output turned out to contain: a source read as mzML is compared against,
    // and one that never was is validated on its output alone. Nothing here can
    // apply the comparison to a source it could not read that way.
    let verified = match &plan.source.baseline {
        SourceBaseline::Mzml(facts) => verify_mzml_conversion_retaining_output(
            facts,
            staging,
            plan.output_file_name(),
            plan.compression,
            plan.scan_limits(),
        ),
        SourceBaseline::ObjectOnly(object) => verify_vendor_conversion_retaining_output(
            object,
            staging,
            plan.output_file_name(),
            plan.compression,
            plan.scan_limits(),
        ),
    };
    let validated = match verified {
        VerifiedConversion::Valid(validated) => validated,
        VerifiedConversion::Rejected(rejected) => {
            return StagedResult::Settled(
                ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(rejected)),
                backend,
            );
        }
    };

    after_validation();

    // On Windows nothing here can name the staged output: the rename acts on the
    // handle the scanner read, so replacing the staging path in the interval
    // above cannot put unjudged bytes under the final name. Only the platform
    // with no object-bound rename is given that name at all.
    #[cfg(not(windows))]
    let finalized = finalize::finalize_validated(
        *validated,
        destination_directory,
        &staging.join(plan.output_file_name()),
        plan.output_file_name(),
    );
    #[cfg(windows)]
    let finalized =
        finalize::finalize_validated(*validated, destination_directory, plan.output_file_name());
    match finalized {
        Ok(valid) => {
            StagedResult::Settled(ConversionRunOutcome::Finalized(Box::new(valid)), backend)
        }
        Err(error) => StagedResult::Settled(
            ConversionRunOutcome::Failed(match error.kind() {
                io::ErrorKind::AlreadyExists => ConversionRunFailure::DestinationAppearedDuringRun,
                kind => ConversionRunFailure::NotFinalized { kind },
            }),
            backend,
        ),
    }
}

mod cleanup;
mod finalize;

#[cfg(test)]
mod tests;
