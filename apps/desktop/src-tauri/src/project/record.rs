//! The project document: what a saved project is, and every rule about it.
//!
//! A project is a private local working document. It records which local files
//! a user chose to reference, what those files contained when they were
//! registered, and which operations were run over them. It is not a workspace
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
/// No earlier schema was ever published, so a migration path would be code for
/// a format that never existed; a later one belongs to the build that wrote it.
pub const SCHEMA_VERSION: u32 = 1;

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

/// The longest user-visible label this document stores, in characters.
pub const MAX_LABEL_CHARS: usize = 200;

/// The longest locator this document stores, in characters.
///
/// Well under the extended path limit, and a bound the reader applies before
/// it ever touches the filesystem.
pub const MAX_LOCATOR_CHARS: usize = 1024;

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
    #[must_use]
    pub fn matches(&self, byte_length: u64, digest: Sha256Digest) -> bool {
        self.byte_length == byte_length && self.sha256 == digest.to_string()
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
///
/// A typed payload rather than an opaque blob, and the only artifact payload
/// this schema has. A second one is a schema change, which is what the version
/// is for -- it is not a reason to invent an extensible payload envelope before
/// there is a second thing to put in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileFactsV1 {
    pub observations: Vec<ObservedInput>,
}

/// One recorded artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactRecord {
    pub id: ArtifactId,
    pub label: String,
    pub file_facts: FileFactsV1,
}

/// The operations this schema can have recorded.
///
/// One variant, and it is the enumeration rather than a free string precisely
/// because the document is untrusted: an operation name this build does not
/// implement is a refusal to open, not a row to render.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordedOperation {
    #[serde(rename = "captureFileFactsV1")]
    CaptureFileFactsV1,
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
/// There is no parameter field. `CaptureFileFactsV1` consumes no variable
/// parameters, and a field for parameters that do not exist is where an opaque
/// blob gets in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRecord {
    pub id: RunId,
    pub operation: RecordedOperation,
    /// The inputs this run was asked to observe. Present even when the run
    /// failed, which is the case an artifact cannot record.
    pub input_ids: Vec<InputId>,
    /// What it produced. Empty unless the outcome is `Completed`.
    pub output_artifact_ids: Vec<ArtifactId>,
    pub outcome: TerminalOutcome,
    /// The application version that actually ran it, not the one reading it.
    pub application_version: String,
    /// RFC 3339, from the system clock at the time. Bounds, not a measurement.
    pub started_at: String,
    pub finished_at: String,
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
        }
    }

    /// The input with this identifier, if the document has one.
    #[must_use]
    pub fn input(&self, id: InputId) -> Option<&InputRecord> {
        self.inputs.iter().find(|input| input.id == id)
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
    /// Two records share an identifier.
    DuplicateIdentifier,
    /// A run names an input or an artifact the document does not contain, or an
    /// artifact observes one.
    DanglingReference,
    /// A locator is not a form this build resolves: empty, escaping its root,
    /// absolute where it must be relative, relative where it must be absolute,
    /// or a UNC or device reference.
    InvalidLocator,
    /// A record is internally inconsistent: no primary member, two primaries,
    /// a failed run carrying outputs, a completed run carrying none.
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
    let document: ProjectDocument =
        serde_json::from_slice(bytes).map_err(|_| DocumentProblem::Malformed)?;
    // Defence in depth rather than a second opinion: the strict deserialization
    // above cannot admit another version, and a document whose version
    // disagrees with the fields beside it is exactly the thing not to load.
    if document.schema_version != SCHEMA_VERSION {
        return Err(DocumentProblem::UnsupportedVersion);
    }
    validate(&document)?;
    Ok(document)
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

    let mut artifact_ids = Vec::with_capacity(document.artifacts.len());
    for artifact in &document.artifacts {
        if artifact_ids.contains(&artifact.id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        artifact_ids.push(artifact.id);
        bounded_label(&artifact.label)?;
        if artifact.file_facts.observations.len() > MAX_INPUTS {
            return Err(DocumentProblem::Oversized);
        }
        for observation in &artifact.file_facts.observations {
            if !input_ids.contains(&observation.input_id) {
                return Err(DocumentProblem::DanglingReference);
            }
            if observation.members.is_empty() || observation.members.len() > MAX_MEMBERS {
                return Err(DocumentProblem::InconsistentRecord);
            }
            for member in &observation.members {
                bounded_member_name(&member.relative_name)?;
                valid_digest(&member.sha256)?;
            }
        }
    }

    let mut run_ids = Vec::with_capacity(document.runs.len());
    for run in &document.runs {
        if run_ids.contains(&run.id) {
            return Err(DocumentProblem::DuplicateIdentifier);
        }
        run_ids.push(run.id);
        if run.input_ids.is_empty() || run.input_ids.len() > MAX_INPUTS {
            return Err(DocumentProblem::InconsistentRecord);
        }
        if run.output_artifact_ids.len() > MAX_ARTIFACTS {
            return Err(DocumentProblem::Oversized);
        }
        for id in &run.input_ids {
            if !input_ids.contains(id) {
                return Err(DocumentProblem::DanglingReference);
            }
        }
        for id in &run.output_artifact_ids {
            if !artifact_ids.contains(id) {
                return Err(DocumentProblem::DanglingReference);
            }
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
        bounded_label(&run.application_version)?;
        bounded_label(&run.started_at)?;
        bounded_label(&run.finished_at)?;
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

/// Whether a member's name beside its input is one this build will join.
///
/// The empty name is the single-file case and is allowed. Anything else must be
/// one ordinary file name: no separator, no traversal, no drive, no root.
/// Joining is the only thing this string is ever used for, so the rule is the
/// rule for what may be joined.
fn bounded_member_name(value: &str) -> Result<(), DocumentProblem> {
    if value.is_empty() {
        return Ok(());
    }
    if value.chars().count() > MAX_LABEL_CHARS {
        return Err(DocumentProblem::InvalidLocator);
    }
    if value.chars().any(char::is_control) {
        return Err(DocumentProblem::InvalidLocator);
    }
    let mut components = Path::new(value).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(DocumentProblem::InvalidLocator),
    }
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
            // Every component must be an ordinary name. `..` escapes the root,
            // `.` is noise, a leading `/` is absolute, and a `C:` prefix is a
            // drive -- none of which is a path below the project's directory.
            let candidate = Path::new(path);
            if candidate
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
            {
                return Err(DocumentProblem::InvalidLocator);
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
            // exactly what a stored reference may not be.
            if path
                .components()
                .any(|component| matches!(component, Component::ParentDir))
            {
                return Err(DocumentProblem::InvalidLocator);
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
                Component::Normal(part) => match part.to_str() {
                    Some(text) if !text.contains('\\') => parts.push(text.to_owned()),
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
