//! The project document: what a saved project is, and every rule about it.
//!
//! A project is a private local working document. It records which local files
//! a user chose to reference, what those files contained when they were
//! registered, which operations were run over them, which references the user
//! made a layer from, and the run-summary facts a QC capture copied from a
//! preview that had already established them. It is not a workspace
//! serialization: no handle, no lease, no admission, no process ownership, no
//! `DatasetId` and no executable command is representable in these types at
//! all. The allowlist is the type, not a filter applied to a wider one.
//!
//! Everything here is parsed from a file a user could have edited, copied from
//! elsewhere or received. It is untrusted input, and [`parse`] is the boundary:
//! it either yields a whole document every rule below accepts, or it yields a
//! refusal and the caller's current project is left exactly as it was.

use std::fmt;
use std::path::{Component, Path, PathBuf};

use mscanvas_core::ArtifactId;
use mscanvas_proteowizard::Sha256Digest;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The only schema this build reads or writes.
///
/// A document carrying anything else is refused as unsupported, not migrated.
/// Schema 1 was the shape before layers existed, and schema 2 the shape before
/// a run could consume a layer and an artifact could hold a QC snapshot.
/// Neither was published outside development, so a document carrying either is
/// refused exactly as any other version is: a migration path would be code for
/// a format no user ever held. A later schema belongs to the build that wrote
/// it.
pub const SCHEMA_VERSION: u32 = 3;

/// The largest project document this build will read.
///
/// Four mebibytes against the bounds below, whose worst case is roughly a
/// quarter of that: it is a bound on what a reader will pull into memory and
/// parse, not a budget to grow into. A document over it is refused before it is
/// parsed, so an unusable file cannot become an unbounded read.
pub const MAX_DOCUMENT_BYTES: u64 = 4 * 1024 * 1024;

/// The most inputs one project may reference.
pub const MAX_INPUTS: usize = 512;

/// The most members one input may require.
///
/// A logical acquisition is a primary and the companions its family mandates.
/// Eight is far above every family this build knows and still a bound.
pub const MAX_MEMBERS: usize = 8;

/// The most artifacts one project may hold.
pub const MAX_ARTIFACTS: usize = 2048;

/// The most runs one project may record.
pub const MAX_RUNS: usize = 2048;

/// The most layers one project may hold.
///
/// One current default layer per input, so the input bound is the layer bound.
pub const MAX_LAYERS: usize = MAX_INPUTS;

/// The most MS-level buckets one QC snapshot may hold.
///
/// The bound the preview boundary already transfers to the page, and far above
/// the handful a real acquisition reports. A summary with more is refused at
/// capture rather than stored in part: a truncated distribution is not a
/// smaller distribution, it is a different one.
pub const MAX_MS_LEVEL_BUCKETS: usize = 64;

/// The longest user-visible label this document stores, in characters.
pub const MAX_LABEL_CHARS: usize = 200;

/// The longest locator this document stores, in characters.
///
/// Well under the extended path limit, and a bound the reader applies before
/// it ever touches the filesystem.
pub const MAX_LOCATOR_CHARS: usize = 1024;

/// The longest single path component this build will join.
///
/// Windows allows 255 characters in one name, so this is that and not the
/// label bound beside it. A file is not less real for having a long name, and
/// refusing one would make a legitimate acquisition unregisterable -- a
/// refusal with no remedy, because a user cannot shorten the name their
/// instrument wrote. A *label* is something this application renders and may
/// bound; a *name* is something the filesystem decided and this build repeats.
pub const MAX_NAME_CHARS: usize = 255;

/// A durable identifier for one project.
///
/// A UUID, like [`ArtifactId`] beside it, because the identity of a record must
/// not be a path, a digest, a filesystem object or a session counter. Those are
/// facts *about* what a record points at; this is what the record *is*.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectId(Uuid);

/// A durable identifier for one recorded input reference.
///
/// Survives a relink: the file may move, and the logical input a run recorded
/// is still the same input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct InputId(Uuid);

/// A durable identifier for one recorded run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RunId(Uuid);

/// A durable identifier for one layer.
///
/// Survives a save, a reopen and a relink of its source, and is never a
/// `DatasetId`: a workspace row belongs to one run of the application, and a
/// layer is what the project keeps once that row is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LayerId(Uuid);

macro_rules! fresh_identifier {
    ($name:ident) => {
        impl $name {
            /// A new identifier, for a record that did not exist before.
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            /// The wire form the interface addresses a record by. A random
            /// UUID: it correlates nothing about the user's machine or files.
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(formatter, "{}", self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = ();

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(value).map(Self).map_err(|_| ())
            }
        }
    };
}

fresh_identifier!(ProjectId);
fresh_identifier!(InputId);
fresh_identifier!(RunId);
fresh_identifier!(LayerId);

/// What one member is to the input it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemberRole {
    /// The file the input is named after and selected as.
    Primary,
    /// A file the primary's family mandates. An input missing one of these is
    /// incomplete, not merely partly verified.
    RequiredCompanion,
}

/// Where a referenced object is, expressed so that moving a project and its
/// data together keeps working.
///
/// Two forms and no third. A locator is either inside the project's own
/// directory, in which case it travels with the project, or it is an external
/// object the user explicitly selected, in which case it is recorded as the
/// absolute reference it is and the interface says so. There is no URL, no UNC
/// form, no device form and no environment-variable form: not because they are
/// filtered out on read, but because there is no variant that could hold one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Locator {
    /// A path below the project document's own directory, stored with forward
    /// slashes so that it is one string on every reader.
    ProjectRelative { path: String },
    /// An absolute local path the user chose. Recorded verbatim, resolved
    /// verbatim, and never guessed at.
    LocalAbsolute { path: PathBuf },
}

/// What a record claims about one member's bytes, at the moment it was
/// registered.
///
/// History. A verification compares against it and never writes to it: the
/// record says what was registered, and what is on disk now is a separate
/// question with a separate answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentBaseline {
    pub byte_length: u64,
    /// Upper-case hexadecimal, which is what [`Sha256Digest`]'s own `Display`
    /// produces and what the conversion boundary already puts on the wire.
    pub sha256: String,
}

impl ContentBaseline {
    /// Builds a baseline from an observation.
    #[must_use]
    pub fn observed(byte_length: u64, digest: Sha256Digest) -> Self {
        Self {
            byte_length,
            sha256: digest.to_string(),
        }
    }

    /// Whether an observation matches what this baseline recorded.
    ///
    /// Length first, because it separates "rewritten" from "identical" without
    /// comparing anything else, and the digest second because it is the half
    /// that actually decides.
    ///
    /// Compared without regard to case. [`parse`] normalises every stored
    /// digest to the upper-case form this build writes, so both sides already
    /// agree -- but the cost of being wrong here is telling someone their data
    /// changed when it did not, and a hexadecimal digest has no case to carry
    /// meaning in.
    #[must_use]
    pub fn matches(&self, byte_length: u64, digest: Sha256Digest) -> bool {
        self.byte_length == byte_length && self.sha256.eq_ignore_ascii_case(&digest.to_string())
    }
}

/// One file inside one logical input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberRecord {
    pub role: MemberRole,
    /// A companion's file name, in the same directory as the primary. Empty for
    /// the primary itself, which is what the input's locator names.
    ///
    /// One name, never a path: a companion is beside its primary, and a
    /// member that could carry a subpath would be a second way to reach
    /// somewhere the locator rules already decided.
    pub relative_name: String,
    pub baseline: ContentBaseline,
}

/// One referenced local input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputRecord {
    pub id: InputId,
    /// What the interface calls it. A display name, never a path.
    pub label: String,
    pub locator: Locator,
    pub members: Vec<MemberRecord>,
}

/// What one member's bytes actually were when an operation looked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedMember {
    pub role: MemberRole,
    pub relative_name: String,
    pub byte_length: u64,
    pub sha256: String,
}

/// Every member of one input, as one operation observed them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedInput {
    pub input_id: InputId,
    pub members: Vec<ObservedMember>,
}

/// The file-facts artifact: what `CaptureFileFactsV1` produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileFactsV1 {
    pub observations: Vec<ObservedInput>,
}

/// Whether a unit was reported for one recorded value.
///
/// One variant, because the run-summary formatter this build reads emits none:
/// the value is a number and its unit is not stated. A unit is never inferred
/// from a value's magnitude, so there is no variant that could hold a guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordedUnit {
    NotEmitted,
}

/// One retention time exactly as the run summary reported it.
///
/// The value is stored as the shortest decimal text that reads back to the same
/// `f64`, rather than as a JSON number. Counts are integers and survive a JSON
/// number exactly; a float read back by this build's JSON parser, whose exact
/// float mode is not enabled, can land one unit in the last place away from
/// what was written. A snapshot that changed on reopen would not be a snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordedRetentionTime {
    pub value: String,
    pub unit: RecordedUnit,
}

impl RecordedRetentionTime {
    /// Records one finite value in its one canonical spelling.
    #[must_use]
    pub fn of(value: f64, unit: RecordedUnit) -> Option<Self> {
        value.is_finite().then(|| Self {
            value: value.to_string(),
            unit,
        })
    }

    /// The value, where the stored text is a finite number in the canonical
    /// spelling this build writes. Anything else is not a value it recorded.
    #[must_use]
    pub fn number(&self) -> Option<f64> {
        let parsed: f64 = self.value.parse().ok()?;
        (parsed.is_finite() && parsed.to_string() == self.value).then_some(parsed)
    }
}

/// The five retention times the run summary reported, or that it reported none.
///
/// The three middle positions are named for what the formatter printed --
/// the retention time at 25, 50 and 75 percent of the base-peak intensity --
/// and not as quartiles of anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum RetentionTimeSummary {
    #[serde(rename_all = "camelCase")]
    Reported {
        minimum: RecordedRetentionTime,
        at_25_percent_base_peak_intensity: RecordedRetentionTime,
        at_50_percent_base_peak_intensity: RecordedRetentionTime,
        at_75_percent_base_peak_intensity: RecordedRetentionTime,
        maximum: RecordedRetentionTime,
    },
    /// An empty struct variant rather than a unit one, so that a field beside
    /// the tag is refused rather than silently dropped.
    NotReported {},
}

/// A count the run summary may or may not have reported.
///
/// Explicit rather than an optional number, because an absent count and a
/// count of zero are different facts, and a field that is merely missing from
/// a hand-edited document must not read as either.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum ReportedCount {
    Reported { count: u64 },
    NotReported {},
}

/// One MS-level bucket, in the order the run summary reported it.
///
/// `Other` is the formatter's own bucket for spectra it did not attribute to a
/// numbered level. It is not turned into a guessed level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum MsLevelCountRecord {
    #[serde(rename_all = "camelCase")]
    Level { ms_level: u32, spectrum_count: u64 },
    #[serde(rename_all = "camelCase")]
    Other { spectrum_count: u64 },
}

impl MsLevelCountRecord {
    #[must_use]
    pub const fn spectrum_count(self) -> u64 {
        match self {
            Self::Level { spectrum_count, .. } | Self::Other { spectrum_count } => spectrum_count,
        }
    }
}

/// Which executable produced the preview a snapshot was taken from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProducerTool {
    /// ProteoWizard's `msaccess`, the one tool a preview runs.
    Msaccess,
}

/// What the application had established about the executable that produced
/// the preview, at the time it produced it.
///
/// Stable, path-free facts about software, never where it is installed. The
/// digest is the one discovery took of the executable around its help probe,
/// in the resolution the preview's batch ran under; the release, build date
/// and source revision are that installation's reported build identity. Each
/// of the last three is explicit `null` where the build did not report it:
/// the field must be present, so an omitted one is refused rather than read as
/// unreported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewProducer {
    pub tool: ProducerTool,
    /// Upper-case hexadecimal, like every other digest this document holds.
    pub executable_sha256: String,
    #[serde(deserialize_with = "Option::deserialize")]
    pub release: Option<String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub build_date: Option<String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub source_revision: Option<String>,
}

/// The QC summary snapshot: what `CaptureAcquisitionQcSnapshotV1` recorded.
///
/// Facts one retained run summary had already established, copied and nothing
/// more: no threshold, no grade and no derived quantity. It names no record
/// either. Which run produced it, which layer that run consumed and which
/// reference that layer is sourced from are all relationships the run and the
/// layer already state, resolved by identifier rather than repeated here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcquisitionQcSnapshotV1 {
    pub total_spectrum_count: u64,
    pub ms_level_counts: Vec<MsLevelCountRecord>,
    pub chromatogram_count: ReportedCount,
    pub retention_time: RetentionTimeSummary,
    pub producer: PreviewProducer,
}

/// What one artifact holds. Exactly one typed payload, named by its kind and
/// version, and nothing a reader could treat as a free-form bag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum ArtifactPayload {
    #[serde(rename = "fileFactsV1")]
    FileFactsV1(FileFactsV1),
    #[serde(rename = "acquisitionQcSnapshotV1")]
    /// Boxed so a file-facts record does not carry a snapshot-sized hole.
    AcquisitionQcSnapshotV1(Box<AcquisitionQcSnapshotV1>),
}

impl ArtifactPayload {
    /// The file facts, where this is a file-facts artifact.
    #[must_use]
    pub const fn file_facts(&self) -> Option<&FileFactsV1> {
        match self {
            Self::FileFactsV1(facts) => Some(facts),
            Self::AcquisitionQcSnapshotV1(_) => None,
        }
    }

    /// The operation that produces this kind of payload, and no other.
    #[must_use]
    pub const fn produced_by(&self) -> RecordedOperation {
        match self {
            Self::FileFactsV1(_) => RecordedOperation::CaptureFileFactsV1,
            Self::AcquisitionQcSnapshotV1(_) => RecordedOperation::CaptureAcquisitionQcSnapshotV1,
        }
    }
}

/// One recorded artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactRecord {
    pub id: ArtifactId,
    pub label: String,
    pub payload: ArtifactPayload,
}

/// The operations this schema can have recorded.
///
/// An enumeration rather than a free string precisely because the document is
/// untrusted: an operation name this build does not implement is a refusal to
/// open, not a row to render. Neither takes a parameter, so neither variant
/// carries one -- a closed operation with nothing to configure, not an empty
/// property bag waiting to be filled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordedOperation {
    #[serde(rename = "captureFileFactsV1")]
    CaptureFileFactsV1,
    /// Records the run summary a retained preview already established. Reads
    /// no file and starts no process.
    #[serde(rename = "captureAcquisitionQcSnapshotV1")]
    CaptureAcquisitionQcSnapshotV1,
}

impl RecordedOperation {
    /// The stable wire identifier, exactly as the document stores it.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::CaptureFileFactsV1 => "captureFileFactsV1",
            Self::CaptureAcquisitionQcSnapshotV1 => "captureAcquisitionQcSnapshotV1",
        }
    }
}

/// One thing a run consumed.
///
/// Two kinds, because two now have consumers: a file-facts capture observes
/// references, and a QC capture consumes a layer. Not a general object
/// reference -- an artifact or a run cannot be named here, because nothing
/// consumes one yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum RunInput {
    #[serde(rename_all = "camelCase")]
    Input { input_id: InputId },
    #[serde(rename_all = "camelCase")]
    Layer { layer_id: LayerId },
}

/// How a run ended. Terminal states only.
///
/// A saved run is history. `Ready`, `Queued` and `Running` are live states, so
/// a document claiming one would be a document claiming to own a worker, which
/// is the thing this schema exists not to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalOutcome {
    Completed,
    Failed,
    Cancelled,
}

/// One recorded run.
///
/// There is no parameter field. Neither operation consumes variable
/// parameters, and a field for parameters that do not exist is where an opaque
/// blob gets in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRecord {
    pub id: RunId,
    pub operation: RecordedOperation,
    /// What this run was asked to consume. Present even when the run failed,
    /// which is the case an artifact cannot record.
    pub inputs: Vec<RunInput>,
    /// What it produced. Empty unless the outcome is `Completed`.
    pub output_artifact_ids: Vec<ArtifactId>,
    pub outcome: TerminalOutcome,
    /// The application version that actually ran it, not the one reading it.
    pub application_version: String,
    /// RFC 3339, from the system clock at the time. Bounds, not a measurement.
    pub started_at: String,
    pub finished_at: String,
}

impl RunRecord {
    /// Whether this run consumed one reference directly.
    #[must_use]
    pub fn consumes_input(&self, id: InputId) -> bool {
        self.inputs.contains(&RunInput::Input { input_id: id })
    }

    /// Whether this run consumed one layer.
    #[must_use]
    pub fn consumes_layer(&self, id: LayerId) -> bool {
        self.inputs.contains(&RunInput::Layer { layer_id: id })
    }
}

/// Which project record a layer is sourced from. One variant, because one
/// current consumer exists: a reference that the Workbench has admitted.
///
/// Unknown fields are refused here as well as on the record around it. This
/// object is exactly where a later build, or a hand edit, would put a handle,
/// a path or a style, and a reader that dropped one silently and wrote the
/// document back without it would be neither refusing nor preserving it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum LayerSource {
    #[serde(rename_all = "camelCase")]
    Input { input_id: InputId },
}

impl LayerSource {
    /// The reference this source names.
    #[must_use]
    pub const fn input_id(self) -> InputId {
        match self {
            Self::Input { input_id } => input_id,
        }
    }
}

/// One layer: an identity and where it came from, and nothing else.
///
/// No label, because its name is its source's label; no style, visibility or
/// order, because those are comparison semantics this schema does not hold;
/// and no `DatasetId`, because a workspace row is a session fact and this is a
/// document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerRecord {
    pub id: LayerId,
    pub source: LayerSource,
}

/// One whole project document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectDocument {
    pub schema_version: u32,
    pub project_id: ProjectId,
    /// Increments on every accepted publish. What a Save compares against to
    /// know it is replacing the document it loaded rather than someone else's.
    pub revision: u64,
    pub name: String,
    pub inputs: Vec<InputRecord>,
    pub artifacts: Vec<ArtifactRecord>,
    pub runs: Vec<RunRecord>,
    pub layers: Vec<LayerRecord>,
}

impl ProjectDocument {
    /// An empty project, ready to have references registered into it.
    #[must_use]
    pub fn new(name: String) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            project_id: ProjectId::new(),
            revision: 0,
            name,
            inputs: Vec::new(),
            artifacts: Vec::new(),
            runs: Vec::new(),
            layers: Vec::new(),
        }
    }

    /// The input with this identifier, if the document has one.
    #[must_use]
    pub fn input(&self, id: InputId) -> Option<&InputRecord> {
        self.inputs.iter().find(|input| input.id == id)
    }

    /// The layer with this identifier, if the document has one.
    #[must_use]
    pub fn layer(&self, id: LayerId) -> Option<&LayerRecord> {
        self.layers.iter().find(|layer| layer.id == id)
    }

    /// The layer sourced from this input, if the document has one.
    ///
    /// Never two: a document with two is refused by [`validate`], so the first
    /// match is the only match.
    #[must_use]
    pub fn layer_of_input(&self, input: InputId) -> Option<&LayerRecord> {
        self.layers
            .iter()
            .find(|layer| layer.source.input_id() == input)
    }
}

/// Why a document could not be used.
///
/// Each leaves the file exactly as it was found and the caller's current
/// project exactly as it was. `UnsupportedVersion` matters most: the bytes are
/// probably fine and this build is the wrong reader, so replacing them would
/// discard a newer build's work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentProblem {
    /// Not JSON, not this shape, an unknown field, or a value outside its
    /// domain.
    Malformed,
    /// Readable enough to find a `schemaVersion`, and it is not this one.
    UnsupportedVersion,
    /// Longer than [`MAX_DOCUMENT_BYTES`], or over one of the count bounds.
    /// Never fully parsed, never partly loaded.
    Oversized,
    /// Two records share an identifier, or two layers name one source.
    DuplicateIdentifier,
    /// A run names an input, a layer or an artifact the document does not
    /// contain, an artifact observes one, or a layer is sourced from one.
    DanglingReference,
    /// Two runs claim to have produced one artifact, so "what produced this"
    /// has two answers. Refused rather than resolved: picking one would be
    /// inventing provenance, and dropping the edge would be hiding that the
    /// document disagrees with itself.
    AmbiguousProducer,
    /// A locator is not a form this build resolves: empty, escaping its root,
    /// absolute where it must be relative, relative where it must be absolute,
    /// or a UNC or device reference.
    InvalidLocator,
    /// A record is internally inconsistent: no primary member, two primaries,
    /// a failed run carrying outputs, a completed run carrying none, a run
    /// consuming or producing a kind its operation does not, a QC snapshot no
    /// QC run claims, or snapshot values that contradict each other.
    InconsistentRecord,
    /// The file is there and this process could not read it.
    Unreadable,
    /// The name is not an ordinary file -- a link, a reparse point, a directory
    /// or a device.
    UnsafeTarget,
}

impl DocumentProblem {
    /// The stable wire identifier. Owned, enumerated, and never a message.
    ///
    /// Deliberately carries nothing from the document: no path, no offset, no
    /// field name and no excerpt. A refusal is not a place to echo the contents
    /// of a file back into a log.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Malformed => "malformed",
            Self::UnsupportedVersion => "unsupportedVersion",
            Self::Oversized => "oversized",
            Self::DuplicateIdentifier => "duplicateIdentifier",
            Self::DanglingReference => "danglingReference",
            Self::AmbiguousProducer => "ambiguousProducer",
            Self::InvalidLocator => "invalidLocator",
            Self::InconsistentRecord => "inconsistentRecord",
            Self::Unreadable => "unreadable",
            Self::UnsafeTarget => "unsafeTarget",
        }
    }
}

/// Reads one project document from its bytes, or says why it cannot be used.
///
/// The version is read first, from a probe that tolerates every other field:
/// doing it the other way round would report a document written by a later
/// build as malformed, which is both untrue and the wrong thing to offer to
/// replace.
///
/// Nothing in here touches the filesystem. Validation is entirely structural,
/// which is what lets the caller replace live state only after the whole
/// document has been accepted.
///
/// # Errors
///
/// A [`DocumentProblem`] naming the first rule the document broke.
pub fn parse(bytes: &[u8]) -> Result<ProjectDocument, DocumentProblem> {
    /// Tolerant on purpose: this exists only to find the version, so a document
    /// full of fields from another build must still get past it.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionProbe {
        schema_version: Option<u32>,
    }

    let probe: VersionProbe =
        serde_json::from_slice(bytes).map_err(|_| DocumentProblem::Malformed)?;
    match probe.schema_version {
        Some(SCHEMA_VERSION) => {}
        Some(_) => return Err(DocumentProblem::UnsupportedVersion),
        None => return Err(DocumentProblem::Malformed),
    }
    let mut document: ProjectDocument =
        serde_json::from_slice(bytes).map_err(|_| DocumentProblem::Malformed)?;
    // One spelling for a digest, from here on.
    //
    // `valid_digest` accepts either case, because a hexadecimal digest written
    // by `sha256sum`, by a hand edit or by another tool is the same digest.
    // Comparisons downstream would then be comparing spellings rather than
    // values, and would report byte-identical files as changed forever.
    // Normalised once, at the boundary, to the form this build writes.
    normalize_digests(&mut document);
    // Defence in depth rather than a second opinion: the strict deserialization
    // above cannot admit another version, and a document whose version
    // disagrees with the fields beside it is exactly the thing not to load.
    if document.schema_version != SCHEMA_VERSION {
        return Err(DocumentProblem::UnsupportedVersion);
    }
    validate(&document)?;
    Ok(document)
}

/// Rewrites every stored digest in the one spelling this build produces.
fn normalize_digests(document: &mut ProjectDocument) {
    for input in &mut document.inputs {
        for member in &mut input.members {
            member.baseline.sha256 = member.baseline.sha256.to_ascii_uppercase();
        }
    }
    for artifact in &mut document.artifacts {
        match &mut artifact.payload {
            ArtifactPayload::FileFactsV1(facts) => {
                for observation in &mut facts.observations {
                    for member in &mut observation.members {
                        member.sha256 = member.sha256.to_ascii_uppercase();
                    }
                }
            }
            ArtifactPayload::AcquisitionQcSnapshotV1(snapshot) => {
                snapshot.producer.executable_sha256 =
                    snapshot.producer.executable_sha256.to_ascii_uppercase();
            }
        }
    }
}

/// The bytes one validated document is stored as.
///
/// Pretty-printed and newline-terminated. This is a document a user may open in
/// an editor to see what their project references -- the S3 disclosure is that
/// it is readable, and making it unreadable would not make it private.
///
/// Answers `None` only if serializing a validated document fails, which the
/// type system makes unreachable and which is still not something to unwrap in
/// a writer.
#[must_use]
pub fn serialize(document: &ProjectDocument) -> Option<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(document).ok()?;
    bytes.push(b'\n');
    Some(bytes)
}

/// Every rule a document must satisfy before it becomes live project state.
///
/// Also applied to a document this build is about to write, so that a bug here
/// cannot publish something this same reader would refuse to open.
///
/// # Errors
///
/// A [`DocumentProblem`] naming the first rule broken.
pub fn validate(document: &ProjectDocument) -> Result<(), DocumentProblem> {
    if document.inputs.len() > MAX_INPUTS
        || document.artifacts.len() > MAX_ARTIFACTS
        || document.runs.len() > MAX_RUNS
        || document.layers.len() > MAX_LAYERS
    {
        return Err(DocumentProblem::Oversized);
    }
    bounded_label(&document.name)?;

    let mut input_ids = Vec::with_capacity(document.inputs.len());
    for input in &document.inputs {
        if input_ids.contains(&input.id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        input_ids.push(input.id);
        validate_input(input)?;
    }

    // Layers before runs, because a run may now consume one.
    let mut layer_ids = Vec::with_capacity(document.layers.len());
    // Which inputs already have a layer, across the whole document.
    let mut layered: Vec<InputId> = Vec::with_capacity(document.layers.len());
    for layer in &document.layers {
        if layer_ids.contains(&layer.id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        layer_ids.push(layer.id);
        let source = layer.source.input_id();
        if !input_ids.contains(&source) {
            return Err(DocumentProblem::DanglingReference);
        }
        // One current default layer per input. A document with two is refused,
        // not normalised: as with a run that consumes one input twice, it is a
        // relationship the document states twice, and choosing which layer is
        // "the" layer of that input would be inventing an answer.
        if layered.contains(&source) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        layered.push(source);
    }

    let mut artifact_ids = Vec::with_capacity(document.artifacts.len());
    for artifact in &document.artifacts {
        if artifact_ids.contains(&artifact.id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        artifact_ids.push(artifact.id);
        bounded_label(&artifact.label)?;
        match &artifact.payload {
            ArtifactPayload::FileFactsV1(facts) => validate_file_facts(facts, &input_ids)?,
            ArtifactPayload::AcquisitionQcSnapshotV1(snapshot) => validate_qc_snapshot(snapshot)?,
        }
    }

    let mut run_ids = Vec::with_capacity(document.runs.len());
    // Which artifacts a run has already claimed, across the whole document.
    let mut claimed: Vec<ArtifactId> = Vec::with_capacity(document.artifacts.len());
    for run in &document.runs {
        if run_ids.contains(&run.id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        run_ids.push(run.id);
        if run.inputs.is_empty() || run.inputs.len() > MAX_INPUTS {
            return Err(DocumentProblem::InconsistentRecord);
        }
        if run.output_artifact_ids.len() > MAX_ARTIFACTS {
            return Err(DocumentProblem::Oversized);
        }
        // A run consumes each record once and produces each artifact once. A
        // repeated identifier in either list is a relationship the document
        // states twice, and lineage counted from it would be wrong in a way
        // nothing on screen could reveal.
        let mut consumed = Vec::with_capacity(run.inputs.len());
        for consumed_input in &run.inputs {
            let exists = match consumed_input {
                RunInput::Input { input_id } => input_ids.contains(input_id),
                RunInput::Layer { layer_id } => layer_ids.contains(layer_id),
            };
            if !exists {
                return Err(DocumentProblem::DanglingReference);
            }
            if consumed.contains(consumed_input) {
                return Err(DocumentProblem::DuplicateIdentifier);
            }
            consumed.push(*consumed_input);
        }
        for id in &run.output_artifact_ids {
            if !artifact_ids.contains(id) {
                return Err(DocumentProblem::DanglingReference);
            }
            // Across every run, not only within this one: the artifact is
            // claimed by exactly one producer or the document is refused.
            if claimed.contains(id) {
                return Err(DocumentProblem::AmbiguousProducer);
            }
            claimed.push(*id);
        }
        // The rule that stops a document from claiming a result it never
        // produced. A failed or cancelled observation has no artifact, and a
        // completed one that produced nothing is not a completed capture.
        match run.outcome {
            TerminalOutcome::Completed if run.output_artifact_ids.is_empty() => {
                return Err(DocumentProblem::InconsistentRecord);
            }
            TerminalOutcome::Failed | TerminalOutcome::Cancelled
                if !run.output_artifact_ids.is_empty() =>
            {
                return Err(DocumentProblem::InconsistentRecord);
            }
            _ => {}
        }
        validate_run_shape(run, &document.artifacts)?;
        bounded_label(&run.application_version)?;
        bounded_label(&run.started_at)?;
        bounded_label(&run.finished_at)?;
    }

    // A QC snapshot names no record of its own, so the run that produced it is
    // the whole of its lineage: which layer, and through it which reference.
    // One nobody claims has lost that, and is refused rather than shown as a
    // report of nothing in particular. A file-facts record keeps the rule it
    // always had -- its observations say what it is about -- so it may stand
    // unclaimed.
    for artifact in &document.artifacts {
        if matches!(
            artifact.payload,
            ArtifactPayload::AcquisitionQcSnapshotV1(_)
        ) && !claimed.contains(&artifact.id)
        {
            return Err(DocumentProblem::InconsistentRecord);
        }
    }
    Ok(())
}

/// What one operation may consume and produce.
///
/// A file-facts capture observes references and produces file facts. A QC
/// capture consumes exactly one layer and, because it records nothing when it
/// is refused, is only ever a completed run producing exactly one snapshot. A
/// run that crosses those lines states lineage its operation cannot have.
fn validate_run_shape(
    run: &RunRecord,
    artifacts: &[ArtifactRecord],
) -> Result<(), DocumentProblem> {
    let produces_only_its_own_kind = run.output_artifact_ids.iter().all(|id| {
        artifacts
            .iter()
            .find(|artifact| artifact.id == *id)
            .is_some_and(|artifact| artifact.payload.produced_by() == run.operation)
    });
    let shaped = match run.operation {
        RecordedOperation::CaptureFileFactsV1 => run
            .inputs
            .iter()
            .all(|consumed| matches!(consumed, RunInput::Input { .. })),
        RecordedOperation::CaptureAcquisitionQcSnapshotV1 => {
            matches!(run.inputs.as_slice(), [RunInput::Layer { .. }])
                && run.outcome == TerminalOutcome::Completed
                && run.output_artifact_ids.len() == 1
        }
    };
    if shaped && produces_only_its_own_kind {
        Ok(())
    } else {
        Err(DocumentProblem::InconsistentRecord)
    }
}

fn validate_file_facts(facts: &FileFactsV1, input_ids: &[InputId]) -> Result<(), DocumentProblem> {
    if facts.observations.len() > MAX_INPUTS {
        return Err(DocumentProblem::Oversized);
    }
    // One observation per input. Two observations of one input would give the
    // artifact two accounts of the same file with no rule for which is the
    // artifact's answer.
    let mut observed_ids = Vec::with_capacity(facts.observations.len());
    for observation in &facts.observations {
        if !input_ids.contains(&observation.input_id) {
            return Err(DocumentProblem::DanglingReference);
        }
        if observed_ids.contains(&observation.input_id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        observed_ids.push(observation.input_id);
        if observation.members.is_empty() || observation.members.len() > MAX_MEMBERS {
            return Err(DocumentProblem::InconsistentRecord);
        }
        for member in &observation.members {
            bounded_member_name(&member.relative_name)?;
            valid_digest(&member.sha256)?;
        }
    }
    Ok(())
}

/// Every rule one QC snapshot must satisfy, in a document or about to enter one.
///
/// The invariants the run-summary contract itself states, and no others: at
/// least one bucket and a total that is exactly their sum, each numbered level
/// once and one `Other` at most, finite retention times in the spelling this
/// build writes with the minimum not above the maximum, and a producer this
/// document can state. The buckets are checked in place, never sorted or
/// merged.
///
/// Public because a capture applies it before committing, so that nothing this
/// build records can be a document it would then refuse to save.
///
/// # Errors
///
/// A [`DocumentProblem`] naming the first rule broken.
pub fn validate_qc_snapshot(snapshot: &AcquisitionQcSnapshotV1) -> Result<(), DocumentProblem> {
    let buckets = &snapshot.ms_level_counts;
    if buckets.len() > MAX_MS_LEVEL_BUCKETS {
        return Err(DocumentProblem::Oversized);
    }
    if buckets.is_empty() {
        return Err(DocumentProblem::InconsistentRecord);
    }
    let mut seen = Vec::with_capacity(buckets.len());
    let mut total = 0_u64;
    for bucket in buckets {
        let key = match bucket {
            MsLevelCountRecord::Level { ms_level, .. } => Some(*ms_level),
            MsLevelCountRecord::Other { .. } => None,
        };
        if seen.contains(&key) {
            return Err(DocumentProblem::InconsistentRecord);
        }
        seen.push(key);
        total = total
            .checked_add(bucket.spectrum_count())
            .ok_or(DocumentProblem::InconsistentRecord)?;
    }
    if total != snapshot.total_spectrum_count {
        return Err(DocumentProblem::InconsistentRecord);
    }
    if let RetentionTimeSummary::Reported {
        minimum,
        at_25_percent_base_peak_intensity,
        at_50_percent_base_peak_intensity,
        at_75_percent_base_peak_intensity,
        maximum,
    } = &snapshot.retention_time
    {
        for value in [
            at_25_percent_base_peak_intensity,
            at_50_percent_base_peak_intensity,
            at_75_percent_base_peak_intensity,
        ] {
            value.number().ok_or(DocumentProblem::Malformed)?;
        }
        let low = minimum.number().ok_or(DocumentProblem::Malformed)?;
        let high = maximum.number().ok_or(DocumentProblem::Malformed)?;
        if low > high {
            return Err(DocumentProblem::InconsistentRecord);
        }
    }
    let producer = &snapshot.producer;
    valid_digest(&producer.executable_sha256)?;
    for label in [
        &producer.release,
        &producer.build_date,
        &producer.source_revision,
    ]
    .into_iter()
    .flatten()
    {
        bounded_label(label)?;
    }
    Ok(())
}

fn validate_input(input: &InputRecord) -> Result<(), DocumentProblem> {
    bounded_label(&input.label)?;
    validate_locator(&input.locator)?;
    if input.members.is_empty() || input.members.len() > MAX_MEMBERS {
        return Err(DocumentProblem::InconsistentRecord);
    }
    let primaries = input
        .members
        .iter()
        .filter(|member| member.role == MemberRole::Primary)
        .count();
    if primaries != 1 {
        return Err(DocumentProblem::InconsistentRecord);
    }
    let mut names = Vec::with_capacity(input.members.len());
    for member in &input.members {
        bounded_member_name(&member.relative_name)?;
        // The locator names the primary, so the primary names nothing further;
        // every companion must name a distinct file beside it. Together these
        // make "where is this member" a question with exactly one answer.
        match member.role {
            MemberRole::Primary if !member.relative_name.is_empty() => {
                return Err(DocumentProblem::InconsistentRecord);
            }
            MemberRole::RequiredCompanion if member.relative_name.is_empty() => {
                return Err(DocumentProblem::InconsistentRecord);
            }
            _ => {}
        }
        if names.contains(&member.relative_name.as_str()) {
            return Err(DocumentProblem::InconsistentRecord);
        }
        names.push(member.relative_name.as_str());
        valid_digest(&member.baseline.sha256)?;
    }
    Ok(())
}

/// Whether this document can store one label as it is.
#[must_use]
pub fn storable_label(value: &str) -> bool {
    bounded_label(value).is_ok()
}

fn bounded_label(value: &str) -> Result<(), DocumentProblem> {
    if value.is_empty() || value.chars().count() > MAX_LABEL_CHARS {
        return Err(DocumentProblem::Malformed);
    }
    // Control characters in a label are what turns a rendered row or a log line
    // into something other than what it reads as.
    if value.chars().any(char::is_control) {
        return Err(DocumentProblem::Malformed);
    }
    Ok(())
}

fn valid_digest(value: &str) -> Result<(), DocumentProblem> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DocumentProblem::Malformed);
    }
    Ok(())
}

/// Whether one string is a plain file name this build will join onto a
/// directory.
///
/// One `Component::Normal` is necessary and is **not** sufficient on Windows,
/// which is the trap this exists for. `Path` parses each of the following as a
/// single normal component, and each is something other than the ordinary file
/// the name appears to be:
///
/// - `sample.txt:payload` names an *alternate data stream* of `sample.txt`. It
///   opens, reports itself as an ordinary file and has its own length, so a
///   document carrying one would have MSCanvas measure and record content that
///   does not appear in any directory listing, labelled as the file beside it.
///   The same colon spells a drive in `C:`.
/// - `sample.txt ` and `sample.txt.` resolve to `sample.txt`, because Win32
///   strips trailing spaces and dots. Two members spelled that way are one file
///   and would pass the duplicate-member check as two.
/// - `NUL`, `CON`, `COM1` and the rest are device names in every directory.
///
/// So the rule is the stricter one: one normal component, and no character or
/// shape that makes the name mean something other than a file in that
/// directory. The remaining characters Win32 reserves are refused with them,
/// because a name that cannot be created is not a name a record can describe.
fn ordinary_file_name(value: &str) -> bool {
    /// Device names, which are reserved in every directory, with or without an
    /// extension.
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    if value.is_empty() || value.chars().count() > MAX_NAME_CHARS {
        return false;
    }
    if value.chars().any(char::is_control) {
        return false;
    }
    if value.contains([':', '<', '>', '"', '|', '?', '*', '/', '\\']) {
        return false;
    }
    if value.ends_with(' ') || value.ends_with('.') {
        return false;
    }
    let stem = value.split('.').next().unwrap_or(value);
    if RESERVED
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return false;
    }
    // And after all of that, it must still be exactly one ordinary component:
    // the checks above describe the characters, this one describes the shape.
    let mut components = Path::new(value).components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    )
}

/// Whether a member\'s name beside its input is one this build will join.
///
/// The empty name is the single-file case and is allowed, because the locator
/// names the primary itself. Anything else must be one ordinary file name by
/// [`ordinary_file_name`].
fn bounded_member_name(value: &str) -> Result<(), DocumentProblem> {
    if value.is_empty() || ordinary_file_name(value) {
        return Ok(());
    }
    Err(DocumentProblem::InvalidLocator)
}

/// Whether a locator is a form this build resolves.
///
/// Structural only. Nothing here asks whether the object exists -- that is what
/// a verification is for, and a parse that touched the filesystem would be a
/// parse that read a path before the user authorised reading anything.
///
/// # Errors
///
/// [`DocumentProblem::InvalidLocator`] for any form outside the two this
/// document has variants for.
pub fn validate_locator(locator: &Locator) -> Result<(), DocumentProblem> {
    match locator {
        Locator::ProjectRelative { path } => {
            if path.is_empty() || path.chars().count() > MAX_LOCATOR_CHARS {
                return Err(DocumentProblem::InvalidLocator);
            }
            if path.chars().any(char::is_control) {
                return Err(DocumentProblem::InvalidLocator);
            }
            // Backslashes are refused rather than accepted as separators. One
            // stored spelling means one reading of the string, and `a\b` is a
            // legal single file name on the platforms this document travels to.
            if path.contains('\\') {
                return Err(DocumentProblem::InvalidLocator);
            }
            // Every component must be an ordinary name, by the same rule a
            // member name is held to. `..` escapes the root, `.` is noise, a
            // leading `/` is absolute and a `C:` prefix is a drive -- and a
            // component carrying a colon, a trailing dot or a device name is
            // not the directory entry it looks like. See
            // [`ordinary_file_name`].
            let candidate = Path::new(path);
            let mut components = candidate.components().peekable();
            if components.peek().is_none() {
                return Err(DocumentProblem::InvalidLocator);
            }
            for component in components {
                let Component::Normal(name) = component else {
                    return Err(DocumentProblem::InvalidLocator);
                };
                match name.to_str() {
                    Some(text) if ordinary_file_name(text) => {}
                    _ => return Err(DocumentProblem::InvalidLocator),
                }
            }
            Ok(())
        }
        Locator::LocalAbsolute { path } => {
            let Some(text) = path.to_str() else {
                return Err(DocumentProblem::InvalidLocator);
            };
            if text.is_empty() || text.chars().count() > MAX_LOCATOR_CHARS {
                return Err(DocumentProblem::InvalidLocator);
            }
            if text.chars().any(char::is_control) {
                return Err(DocumentProblem::InvalidLocator);
            }
            if !path.is_absolute() {
                return Err(DocumentProblem::InvalidLocator);
            }
            // UNC and device references. `\\server\share`, `\\?\C:\...` and
            // `\\.\PhysicalDrive0` are all absolute and none of them is a local
            // file this build opens: the first reaches the network, and the
            // other two bypass the very name parsing the checks above rely on.
            // Refused by shape, not by attempting them and seeing what happens.
            if text.starts_with("\\\\") || text.starts_with("//") {
                return Err(DocumentProblem::InvalidLocator);
            }
            // A `..` anywhere in an absolute locator means the stored string
            // and the object it reaches are two different things, which is
            // exactly what a stored reference may not be. Every named component
            // is held to the same rule as a relative one, so a stream, a
            // trailing dot or a device name cannot enter by this door either --
            // the prefix and the root are the two parts an absolute path is
            // allowed to have that a relative one is not.
            for component in path.components() {
                match component {
                    Component::Prefix(_) | Component::RootDir => {}
                    Component::Normal(name) => match name.to_str() {
                        Some(text) if ordinary_file_name(text) => {}
                        _ => return Err(DocumentProblem::InvalidLocator),
                    },
                    Component::CurDir | Component::ParentDir => {
                        return Err(DocumentProblem::InvalidLocator);
                    }
                }
            }
            Ok(())
        }
    }
}

/// Resolves a locator against the directory its project document lives in.
///
/// The only place a stored string becomes a path. A relative locator is joined
/// and then re-checked against the base, so a component that somehow survived
/// validation still cannot reach outside it. An absolute locator is used as it
/// is: it was explicitly chosen and there is nothing to rebase it against.
///
/// Environment variables are never expanded. There is no code here that would
/// expand one, which is the form of "never" that survives a refactor.
///
/// # Errors
///
/// [`DocumentProblem::InvalidLocator`] for a locator that does not validate, or
/// for a relative one whose join leaves the base directory.
pub fn resolve(locator: &Locator, base_directory: &Path) -> Result<PathBuf, DocumentProblem> {
    validate_locator(locator)?;
    match locator {
        Locator::ProjectRelative { path } => {
            let resolved = base_directory.join(path);
            // Belt and braces, on the string this function actually produced.
            if !resolved.starts_with(base_directory) {
                return Err(DocumentProblem::InvalidLocator);
            }
            Ok(resolved)
        }
        Locator::LocalAbsolute { path } => Ok(path.clone()),
    }
}

/// The locator that names `target` for a project stored in `base_directory`.
///
/// Relative where the object is inside the project's own directory, so that
/// copying the two together keeps the reference working; absolute otherwise,
/// because an external object is external and pretending otherwise with a
/// `../..` chain would make the reference depend on where the project happens
/// to sit.
///
/// This is what makes Save As a deliberate rebase: the caller resolves every
/// locator against the *old* base first, then calls this with the *new* one, so
/// which physical objects are referenced is preserved rather than reinterpreted
/// by reading old relative strings under a new directory.
#[must_use]
pub fn locator_for(target: &Path, base_directory: &Path) -> Locator {
    if let Ok(relative) = target.strip_prefix(base_directory) {
        let mut parts = Vec::new();
        let mut ordinary = true;
        for component in relative.components() {
            match component {
                // Held to the same rule the reader applies, so this can never
                // mint a relative locator that `validate_locator` would refuse
                // and that would make the document unsaveable.
                Component::Normal(part) => match part.to_str() {
                    Some(text) if ordinary_file_name(text) => parts.push(text.to_owned()),
                    _ => ordinary = false,
                },
                _ => ordinary = false,
            }
        }
        if ordinary && !parts.is_empty() {
            return Locator::ProjectRelative {
                path: parts.join("/"),
            };
        }
    }
    Locator::LocalAbsolute {
        path: target.to_path_buf(),
    }
}
