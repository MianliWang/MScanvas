use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::capability::{CapabilityRequirementError, InstalledHelpCapabilities, Sha256Digest};
use crate::intent::{ConversionIntent, OutputFormat};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendTool {
    MsConvert,
    MsAccess,
}

/// A provider-level output format.
///
/// The **argv spelling of a format lives with the lowering**, in
/// [`ConversionIntent::lower`], beside every other flag a conversion emits.
/// This enum is the capability and integrity layer's vocabulary: which formats
/// the installed help declares, and which extension each requires. mzXML stays
/// here, unreachable from a product intent, because closing or lifting its gate
/// is M6.10's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenFormat {
    MzMl,
    MzXml,
}

impl OpenFormat {
    /// The provider-level format a product intent asks for.
    ///
    /// One direction only, and deliberately. An intent cannot name mzXML at
    /// all -- M6.2 measured it dropping spectra silently -- so there is nothing
    /// to translate back, and the mzXML machinery below stays reachable from
    /// the capability layer for M6.10 rather than from a plan.
    pub(crate) const fn of_intent(format: OutputFormat) -> Self {
        match format {
            OutputFormat::MzMl => Self::MzMl,
        }
    }

    /// The exact output file extension this format requires.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::MzMl => "mzML",
            Self::MzXml => "mzXML",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewOperation {
    Metadata,
    RunSummary,
    SpectrumTable,
    Tic { ms_level: Option<u8> },
    SpectrumByIndex { index: u64, precision: u8 },
}

impl PreviewOperation {
    fn analysis_command(&self) -> String {
        match self {
            Self::Metadata => "metadata".to_owned(),
            Self::RunSummary => "run_summary delimiter=tab".to_owned(),
            Self::SpectrumTable => "spectrum_table delimiter=tab".to_owned(),
            Self::Tic { .. } => "tic delimiter=tab".to_owned(),
            Self::SpectrumByIndex { index, precision } => {
                format!("binary index={index} precision={precision}")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OutputSafety {
    None,
    FreshDirectory {
        output_directory: PathBuf,
        source_directory_boundary: Option<PathBuf>,
    },
    AbsentDestination {
        destination: PathBuf,
        source_directory_boundary: Option<PathBuf>,
    },
}

/// A canonical source path bound to the filesystem identity observed for it.
///
/// Comparing a captured identity against the current one is what makes a source
/// replaced between planning and use observable. Capture and comparison stay
/// crate-internal so no caller can construct an identity that was never
/// observed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceIdentity {
    canonical_path: PathBuf,
    is_directory: bool,
    platform: PlatformSourceIdentity,
}

impl SourceIdentity {
    pub(crate) fn capture(path: &Path) -> io::Result<Self> {
        let canonical_path = std::fs::canonicalize(path)?;
        let (platform, is_directory) = platform_source_identity(&canonical_path)?;
        if std::fs::canonicalize(&canonical_path)? != canonical_path {
            return Err(io::Error::other(
                "the source changed during identity inspection",
            ));
        }
        Ok(Self {
            canonical_path,
            is_directory,
            platform,
        })
    }

    pub(crate) fn matches_current(&self) -> io::Result<bool> {
        Ok(Self::capture(&self.canonical_path)? == *self)
    }

    /// The canonical absolute path the identity was captured from.
    #[must_use]
    pub fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }

    /// The volume serial number and 128-bit file id this object was bound to,
    /// on the platforms that express object identity that way.
    ///
    /// This is the whole identity minus the path, so a caller that already
    /// bound the same object by its own means can ask whether the two
    /// bindings name one object without ever being handed a path. Comparing
    /// the pair is exactly as strong as comparing the platform identity: it is
    /// the platform identity.
    ///
    /// `None` is not a missing measurement. It says this platform does not
    /// name objects by a volume and a file id, so no such comparison exists to
    /// be made and a caller must not invent one.
    #[must_use]
    pub const fn volume_and_file_id(&self) -> Option<(u64, [u8; 16])> {
        #[cfg(windows)]
        {
            Some((self.platform.volume_serial_number, self.platform.file_id))
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    const fn is_directory(&self) -> bool {
        self.is_directory
    }
}

/// The most objects one logical acquisition may be bound to.
///
/// The measured SCIEX bundle is two — a `.wiff` and its `.wiff.scan` — and the
/// bound is twice that, the same reasoning the output-set bound uses: room for
/// a family whose shape is a little larger than the one that has been measured,
/// and a hard stop well before "however many the caller passed". The number
/// this bound protects is not memory. It is how many objects a pre-spawn
/// recheck must confirm one at a time, in the moment before a process starts,
/// while nothing is holding them still.
pub(crate) const MAX_SOURCE_BUNDLE_MEMBERS: usize = 4;

/// Every filesystem object one logical acquisition is made of.
///
/// One primary and, for the families that have them, the companions the vendor
/// reader opens beside it. A single-object family is a set of one and takes the
/// identical path through every check, so there is one recheck rule rather than
/// one per cardinality.
///
/// The distinction the type keeps is between *the object the acquisition is
/// named by* and *the objects the run also depends on*. The primary is what the
/// argv names and what the plan derives from; a companion is never named to the
/// backend and is bound anyway, because the backend will open it regardless of
/// whether this boundary looked at it.
///
/// **Its debug projection carries paths, deliberately.** The crate's
/// path-free discipline is a rule about *errors, outcomes and reports* — the
/// values that leave this boundary — and this is none of those: it is plan
/// state, it appears in no report, and its members' paths are what a failing
/// plan assertion exists to show. `SourceIdentity` and [`CommandSpec`] itself
/// have printed their paths since before bundles existed, and `CommandSpec`
/// prints the executable, the working directory and the argv besides, so
/// redacting only this field would hide a companion path sitting next to the
/// primary path it was derived from and leave the projection no safer while
/// implying it was.
///
/// If the whole spec's projection should be path-free, that is one change to
/// `CommandSpec` and `SourceIdentity`, not a special case here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceIdentitySet {
    primary: SourceIdentity,
    companions: Vec<SourceIdentity>,
}

impl SourceIdentitySet {
    /// The set every single-object family has: the one it is named by.
    pub(crate) const fn single(primary: SourceIdentity) -> Self {
        Self {
            primary,
            companions: Vec::new(),
        }
    }

    /// The same set with load-bearing companions bound to it.
    ///
    /// `None` when the result would exceed [`MAX_SOURCE_BUNDLE_MEMBERS`] — a
    /// refusal, not a truncation. Binding some of an acquisition's objects and
    /// discarding the rest would leave the discarded ones unwatched while
    /// reporting that the source was checked.
    pub(crate) fn with_companions(mut self, companions: Vec<SourceIdentity>) -> Option<Self> {
        // Once, or not at all. A second call would silently replace the
        // companions the first one bound, which is the one way this could
        // leave a run watching fewer objects than it reads while reporting
        // that the acquisition was bound.
        if !self.companions.is_empty() {
            return None;
        }
        if companions.len() + 1 > MAX_SOURCE_BUNDLE_MEMBERS {
            return None;
        }
        self.companions = companions;
        Some(self)
    }

    /// The object the acquisition is named by.
    ///
    /// Production code reaches every member through [`Self::all_match_current`]
    /// rather than singling one out, so this exists for the tests that assert
    /// *which* object a built command was bound to.
    #[cfg(test)]
    pub(crate) const fn primary(&self) -> &SourceIdentity {
        &self.primary
    }

    /// Every bound object, primary first.
    pub(crate) fn members(&self) -> impl Iterator<Item = &SourceIdentity> {
        std::iter::once(&self.primary).chain(self.companions.iter())
    }

    /// Whether every bound object is still the object it was bound as.
    ///
    /// Short-circuits on the first member that is not, because the answer is
    /// already no and the remaining members' current state is not a fact this
    /// run needs. An inspection failure is neither a match nor a mismatch and
    /// is returned as itself.
    pub(crate) fn all_match_current(&self) -> io::Result<bool> {
        for member in self.members() {
            if !member.matches_current()? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlatformSourceIdentity {
    volume_serial_number: u64,
    file_id: [u8; 16],
}

#[cfg(windows)]
fn validated_windows_source_identity(
    volume_serial_number: u64,
    file_id: [u8; 16],
) -> io::Result<PlatformSourceIdentity> {
    if file_id == [0; 16] {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the source filesystem does not expose a stable 128-bit file identity",
        ));
    }
    Ok(PlatformSourceIdentity {
        volume_serial_number,
        file_id,
    })
}

#[cfg(windows)]
fn platform_source_identity(path: &Path) -> io::Result<(PlatformSourceIdentity, bool)> {
    use std::ffi::c_void;
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_ID_INFO_CLASS: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileId128 {
        identifier: [u8; 16],
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInformation {
        volume_serial_number: u64,
        file_id: FileId128,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information_by_handle(
            file: *mut c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;

        #[link_name = "GetFileInformationByHandleEx"]
        fn get_file_information_by_handle_ex(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let file = OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let mut information = ByHandleFileInformation::default();
    // SAFETY: `file` owns a live handle and `information` is the exact repr(C)
    // buffer required by GetFileInformationByHandle for the duration of the call.
    let inspected =
        unsafe { get_file_information_by_handle(file.as_raw_handle(), &raw mut information) };
    if inspected == 0 {
        return Err(io::Error::last_os_error());
    }

    let mut file_id_information = FileIdInformation::default();
    // SAFETY: `file` owns the same live handle inspected above and
    // `file_id_information` is the exact repr(C) FILE_ID_INFO buffer required
    // by GetFileInformationByHandleEx for the duration of the call.
    let identity_inspected = unsafe {
        get_file_information_by_handle_ex(
            file.as_raw_handle(),
            FILE_ID_INFO_CLASS,
            (&raw mut file_id_information).cast(),
            u32::try_from(std::mem::size_of::<FileIdInformation>())
                .expect("FILE_ID_INFO size fits in DWORD"),
        )
    };
    if identity_inspected == 0 {
        return Err(io::Error::last_os_error());
    }

    let platform = validated_windows_source_identity(
        file_id_information.volume_serial_number,
        file_id_information.file_id.identifier,
    )?;

    Ok((
        platform,
        information.file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    ))
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlatformSourceIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
fn platform_source_identity(path: &Path) -> io::Result<(PlatformSourceIdentity, bool)> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::File::open(path)?.metadata()?;
    Ok((
        PlatformSourceIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        },
        metadata.is_dir(),
    ))
}

#[cfg(not(any(windows, unix)))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlatformSourceIdentity;

#[cfg(not(any(windows, unix)))]
fn platform_source_identity(_path: &Path) -> io::Result<(PlatformSourceIdentity, bool)> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "the platform does not expose a stable source filesystem identity",
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub(crate) tool: BackendTool,
    pub(crate) executable: PathBuf,
    pub(crate) args: Vec<OsString>,
    pub(crate) working_directory: PathBuf,
    pub(crate) executable_sha256: Option<Sha256Digest>,
    /// Every object the run depends on, or `None` where the command has no
    /// source object to be about. One member for every single-object family;
    /// more only where a family's acquisition is measurably more than one file.
    pub(crate) source_identity: Option<SourceIdentitySet>,
    pub(crate) output_safety: OutputSafety,
}

impl CommandSpec {
    pub(crate) fn new(
        tool: BackendTool,
        executable: impl Into<PathBuf>,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        working_directory: impl Into<PathBuf>,
    ) -> Self {
        Self {
            tool,
            executable: executable.into(),
            args: args.into_iter().map(Into::into).collect(),
            working_directory: working_directory.into(),
            executable_sha256: None,
            source_identity: None,
            output_safety: OutputSafety::None,
        }
    }

    pub(crate) fn with_executable_identity(mut self, sha256: Sha256Digest) -> Self {
        self.executable_sha256 = Some(sha256);
        self
    }

    pub(crate) fn with_source_identity(mut self, source_identity: SourceIdentity) -> Self {
        self.source_identity = Some(SourceIdentitySet::single(source_identity));
        self
    }

    /// Binds the companions of a bundle acquisition to a spec that already
    /// carries its primary.
    ///
    /// Deliberately an extension rather than a second way to set the whole set.
    /// The builder that formed this spec is the one authority for which object
    /// the argv names, and a call that could replace the primary would be a
    /// second one — able to hand the pre-spawn recheck a different object from
    /// the one the command line points at, which is precisely the confusion the
    /// recheck exists to catch.
    ///
    /// `None` where the spec has no source object, or where the bundle would
    /// exceed [`MAX_SOURCE_BUNDLE_MEMBERS`].
    /// How many filesystem objects this command's run is bound to.
    ///
    /// Zero where the command has no source object. Exists so a test can assert
    /// that a bundle run spawns a command bound to the whole acquisition: the
    /// difference between binding one member and binding all of them is
    /// invisible until something is swapped, which is exactly the wrong time to
    /// find out.
    #[cfg(test)]
    pub(crate) fn bound_source_object_count(&self) -> usize {
        self.source_identity
            .as_ref()
            .map_or(0, |set| set.members().count())
    }

    pub(crate) fn with_source_companion_identities(
        mut self,
        companions: Vec<SourceIdentity>,
    ) -> Option<Self> {
        let set = self.source_identity.take()?;
        self.source_identity = Some(set.with_companions(companions)?);
        Some(self)
    }

    pub(crate) fn with_output_destination(
        mut self,
        destination: impl Into<PathBuf>,
        source_directory_boundary: Option<PathBuf>,
    ) -> Self {
        self.output_safety = OutputSafety::AbsentDestination {
            destination: destination.into(),
            source_directory_boundary,
        };
        self
    }

    pub(crate) fn with_fresh_output_directory(
        mut self,
        output_directory: impl Into<PathBuf>,
        source_directory_boundary: Option<PathBuf>,
    ) -> Self {
        self.output_safety = OutputSafety::FreshDirectory {
            output_directory: output_directory.into(),
            source_directory_boundary,
        };
        self
    }

    #[must_use]
    pub const fn tool(&self) -> BackendTool {
        self.tool
    }

    #[must_use]
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    #[must_use]
    pub fn args(&self) -> &[OsString] {
        &self.args
    }

    #[must_use]
    pub fn working_directory(&self) -> &Path {
        &self.working_directory
    }

    #[must_use]
    pub fn output_destination(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::AbsentDestination { destination, .. } => Some(destination),
            OutputSafety::None | OutputSafety::FreshDirectory { .. } => None,
        }
    }

    #[must_use]
    pub fn fresh_output_directory(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::FreshDirectory {
                output_directory, ..
            } => Some(output_directory),
            OutputSafety::None | OutputSafety::AbsentDestination { .. } => None,
        }
    }

    #[must_use]
    pub fn source_directory_boundary(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::FreshDirectory {
                source_directory_boundary,
                ..
            }
            | OutputSafety::AbsentDestination {
                source_directory_boundary,
                ..
            } => source_directory_boundary.as_deref(),
            OutputSafety::None => None,
        }
    }

    #[must_use]
    pub fn contains_argument(&self, argument: impl AsRef<OsStr>) -> bool {
        self.args.iter().any(|value| value == argument.as_ref())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("executable path must be absolute")]
    NonAbsoluteExecutable,
    #[error("input path must be absolute")]
    NonAbsoluteInput,
    #[error("output directory path must be absolute")]
    NonAbsoluteOutputDirectory,
    #[error("input path has no file name")]
    MissingInputName,
    #[error("input path could not be inspected: {kind}")]
    InputPathInspectionFailed { kind: io::ErrorKind },
    #[error("output directory must not be empty")]
    MissingOutputDirectory,
    #[error("output directory could not be inspected: {kind}")]
    OutputDirectoryInspectionFailed { kind: io::ErrorKind },
    #[error("output directory must be empty to prevent implicit overwrite")]
    OutputDirectoryNotEmpty,
    #[error("output directory must not equal or be nested inside a directory input")]
    OutputDirectoryInsideDirectoryInput,
    #[error("output file name must be one safe file name")]
    InvalidOutputFileName,
    #[error("output file extension must match the selected conversion format")]
    OutputFileExtensionMismatch,
    #[error("the requested output destination already exists")]
    OutputDestinationExists,
    #[error("the requested output destination could not be inspected: {kind}")]
    OutputDestinationInspectionFailed { kind: io::ErrorKind },
    #[error("spectrum precision must be between 0 and 15 decimal places")]
    InvalidSpectrumPrecision,
    #[error("MS-level TIC filter must be between 1 and 255")]
    InvalidMsLevelFilter,
    #[error("filtered TIC planning requires exact installed-help capability evidence")]
    FilteredTicCapabilityEvidenceRequired,
    #[error(
        "mzXML conversion is unavailable until source/output integrity validation is implemented"
    )]
    MzXmlIntegrityGateRequired,
    /// The source could not be named in a spelling the reader for its family
    /// accepts without also naming a different object.
    #[error("no verified backend spelling exists for the conversion source")]
    SourceSpellingNotEquivalent,
    #[error(transparent)]
    InstalledHelpCapability(#[from] CapabilityRequirementError),
}

impl PlanError {
    /// A stable structural identifier, so a caller that must not render backend
    /// prose can still say which planning rule refused.
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::NonAbsoluteExecutable => "non_absolute_executable",
            Self::NonAbsoluteInput => "non_absolute_input",
            Self::NonAbsoluteOutputDirectory => "non_absolute_output_directory",
            Self::MissingInputName => "missing_input_name",
            Self::InputPathInspectionFailed { .. } => "input_path_inspection_failed",
            Self::MissingOutputDirectory => "missing_output_directory",
            Self::OutputDirectoryInspectionFailed { .. } => "output_directory_inspection_failed",
            Self::OutputDirectoryNotEmpty => "output_directory_not_empty",
            Self::OutputDirectoryInsideDirectoryInput => "output_directory_inside_directory_input",
            Self::InvalidOutputFileName => "invalid_output_file_name",
            Self::OutputFileExtensionMismatch => "output_file_extension_mismatch",
            Self::OutputDestinationExists => "output_destination_exists",
            Self::OutputDestinationInspectionFailed { .. } => {
                "output_destination_inspection_failed"
            }
            Self::InvalidSpectrumPrecision => "invalid_spectrum_precision",
            Self::InvalidMsLevelFilter => "invalid_ms_level_filter",
            Self::FilteredTicCapabilityEvidenceRequired => {
                "filtered_tic_capability_evidence_required"
            }
            Self::MzXmlIntegrityGateRequired => "mzxml_integrity_gate_required",
            Self::SourceSpellingNotEquivalent => "source_spelling_not_equivalent",
            Self::InstalledHelpCapability(_) => "installed_help_capability_missing",
        }
    }
}

/// Lowers one conversion intent into one argv.
///
/// The argument order is fixed here and nowhere else: the source, then
/// everything the intent asks for, then the destination. What the intent
/// contributes is [`ConversionIntent::lower`]'s business and is deterministic
/// on its own, so this function cannot reorder a semantic and no caller can
/// hand it a format, a precision, a compression or a filter chosen apart from
/// the intent -- there is no parameter for one.
fn build_msconvert_command(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    intent: &ConversionIntent,
    source_directory_boundary: Option<PathBuf>,
) -> Result<CommandSpec, PlanError> {
    let executable = executable.into();
    validate_paths(&executable, input, output_directory)?;
    validate_output_file_name(output_file_name, OpenFormat::of_intent(intent.format()))?;

    let mut arguments = Vec::with_capacity(6 + intent.lower().len());
    arguments.push(input.as_os_str().to_owned());
    arguments.extend(intent.lower());
    arguments.push(OsString::from("--outdir"));
    arguments.push(output_directory.as_os_str().to_owned());
    arguments.push(OsString::from("--outfile"));
    arguments.push(output_file_name.to_owned());

    Ok(CommandSpec::new(
        BackendTool::MsConvert,
        executable,
        arguments,
        output_directory,
    )
    .with_output_destination(
        output_directory.join(output_file_name),
        source_directory_boundary,
    ))
}

/// Builds an mzML conversion command with **no** `--outfile`: the backend
/// names its outputs itself, inside the given output directory.
///
/// For the multi-output evidence lifecycle only. Every validation the
/// single-output builder applies to its inputs applies here — the confirmed
/// option grammar, the path rules, the safe-output-directory rule, the
/// measured per-family input spelling, the executable and source identities
/// retained for the pre-spawn rechecks. What is absent is the planned output
/// name, because for this topology there is none: the private staging
/// directory is inspected afterwards for what the backend actually produced,
/// and no `output_destination` is claimed on the command for the same reason.
pub(crate) fn build_msconvert_set_command_for_source(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    intent: &ConversionIntent,
    spelling: InputSpelling,
) -> Result<CommandSpec, PlanError> {
    capabilities.require_conversion(OpenFormat::of_intent(intent.format()))?;
    let executable = capabilities.executable().to_path_buf();
    validate_paths(&executable, input, output_directory)?;
    // Fresh, not merely safe. Discovery afterwards attributes every member of
    // this directory to the backend, so a file injected between the staging
    // area's creation and the spawn would be published as a conversion output.
    // The emptiness is established here and rechecked by the runner
    // immediately before the spawn, exactly as the preview commands do.
    let safe_output = require_fresh_output_directory(input, output_directory)?;
    let canonical_input = backend_input_spelling(&safe_output.source_identity, spelling)?;
    // The same lowering the single-output path uses, minus the planned output
    // name this topology does not have. One intent, one set of flags: a second
    // hand-written argument list here is how the two paths would come to
    // convert differently.
    let mut arguments = Vec::with_capacity(4 + intent.lower().len());
    arguments.push(canonical_input.as_os_str().to_owned());
    arguments.extend(intent.lower());
    arguments.push(OsString::from("--outdir"));
    arguments.push(safe_output.output_directory.as_os_str().to_owned());
    let command = CommandSpec::new(
        BackendTool::MsConvert,
        executable,
        arguments,
        &safe_output.output_directory,
    )
    .with_fresh_output_directory(
        safe_output.output_directory.clone(),
        safe_output.source_directory_boundary.clone(),
    );
    Ok(command
        .with_executable_identity(capabilities.executable_sha256())
        .with_source_identity(safe_output.source_identity))
}

/// Builds an mzML conversion command only after the complete installed help has
/// confirmed every option used by the typed plan and the exact output
/// destination is absent in an inspectable output root outside a directory
/// input. The plan retains the probed executable's SHA-256 and the source
/// filesystem identity for non-atomic pre-spawn rechecks. mzXML remains
/// unavailable until source/output integrity validation is implemented.
pub fn build_msconvert_command_with_capabilities(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    intent: &ConversionIntent,
) -> Result<CommandSpec, PlanError> {
    build_msconvert_command_for_source(
        capabilities,
        input,
        output_directory,
        output_file_name,
        intent,
        InputSpelling::Canonical,
    )
}

/// How the source path is spelled in the argv the backend receives.
///
/// The canonical path this crate binds identity to is a Windows extended-length
/// path, and which readers accept one is a measured fact rather than a matter of
/// taste. It is therefore a per-source-family decision, not a global one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputSpelling {
    /// Exactly the canonical path. What every measurement in this repository so
    /// far was recorded against.
    Canonical,
    /// The same object named without the `\\?\` prefix, and only when that
    /// spelling is proved to reach the same object. Required by readers that
    /// cannot open an extended-length path.
    PlainVerified,
}

/// Builds an mzML conversion command with an explicit source-path spelling.
pub fn build_msconvert_command_for_source(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    intent: &ConversionIntent,
    spelling: InputSpelling,
) -> Result<CommandSpec, PlanError> {
    // An intent cannot name mzXML, so the second arm is currently unreachable
    // from here. It stays because the gate it holds is M6.10's to lift or
    // close, and deleting a refusal because nothing can reach it today is how a
    // format returns without one.
    let format = OpenFormat::of_intent(intent.format());
    match format {
        OpenFormat::MzMl => {
            capabilities.require_conversion(format)?;
            let executable = capabilities.executable().to_path_buf();
            validate_paths(&executable, input, output_directory)?;
            validate_output_file_name(output_file_name, format)?;
            let safe_output = require_safe_output_directory(input, output_directory)?;
            let canonical_input = backend_input_spelling(&safe_output.source_identity, spelling)?;
            let command = build_msconvert_command(
                executable,
                &canonical_input,
                &safe_output.output_directory,
                output_file_name,
                intent,
                safe_output.source_directory_boundary,
            )?;
            require_output_destination_available(
                command
                    .output_destination()
                    .expect("conversion commands have an output destination"),
            )?;
            Ok(command
                .with_executable_identity(capabilities.executable_sha256())
                .with_source_identity(safe_output.source_identity))
        }
        OpenFormat::MzXml => Err(PlanError::MzXmlIntegrityGateRequired),
    }
}

#[cfg(test)]
fn build_msaccess_command(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    if matches!(operation, PreviewOperation::Tic { ms_level: Some(_) }) {
        return Err(PlanError::FilteredTicCapabilityEvidenceRequired);
    }
    build_msaccess_command_inner(executable, input, output_directory, operation)
}

/// Builds an msaccess command only after the complete installed help has
/// confirmed the exact option, query, parameter, and filter grammar used by
/// the typed plan and the output directory is a fresh, inspectable location
/// outside a directory input. The plan retains the probed executable's SHA-256
/// and the source filesystem identity for non-atomic pre-spawn rechecks.
pub fn build_msaccess_command_with_capabilities(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    if matches!(&operation, PreviewOperation::Tic { ms_level: Some(0) }) {
        return Err(PlanError::InvalidMsLevelFilter);
    }
    capabilities.require_preview_operation(&operation)?;
    let executable = capabilities.executable().to_path_buf();
    validate_msaccess_request(&executable, input, output_directory, &operation)?;
    let safe_output = require_fresh_output_directory(input, output_directory)?;
    let canonical_input = safe_output.source_identity.canonical_path().to_path_buf();
    Ok(build_msaccess_command_spec(
        executable,
        &canonical_input,
        &safe_output.output_directory,
        operation,
    )
    .with_fresh_output_directory(
        &safe_output.output_directory,
        safe_output.source_directory_boundary,
    )
    .with_executable_identity(capabilities.executable_sha256())
    .with_source_identity(safe_output.source_identity))
}

#[cfg(test)]
fn build_msaccess_command_inner(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    let executable = executable.into();
    validate_msaccess_request(&executable, input, output_directory, &operation)?;

    Ok(build_msaccess_command_spec(
        executable,
        input,
        output_directory,
        operation,
    ))
}

fn validate_msaccess_request(
    executable: &Path,
    input: &Path,
    output_directory: &Path,
    operation: &PreviewOperation,
) -> Result<(), PlanError> {
    validate_paths(executable, input, output_directory)?;
    if matches!(
        operation,
        PreviewOperation::SpectrumByIndex { precision, .. } if *precision > 15
    ) {
        return Err(PlanError::InvalidSpectrumPrecision);
    }
    Ok(())
}

fn build_msaccess_command_spec(
    executable: PathBuf,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> CommandSpec {
    let mut args = vec![
        input.as_os_str().to_owned(),
        OsString::from("--outdir"),
        output_directory.as_os_str().to_owned(),
        OsString::from("--exec"),
        OsString::from(operation.analysis_command()),
    ];
    if let PreviewOperation::Tic {
        ms_level: Some(ms_level),
    } = operation
    {
        args.push(OsString::from("--filter"));
        args.push(OsString::from(format!("msLevel {ms_level}")));
    }

    CommandSpec::new(BackendTool::MsAccess, executable, args, output_directory)
}

/// The Windows extended-length prefix `std::fs::canonicalize` produces.
const VERBATIM_PREFIX: &str = r"\\?\";

/// Decides how the admitted source object is named in the backend's argv.
///
/// A plain spelling is never assumed to reach the same file. It is derived,
/// resolved again, and required to have the identity that was admitted — the
/// same comparison this crate uses everywhere else a name has to be trusted. A
/// spelling that cannot be proved is refused rather than tried, because the
/// consequence of being wrong is a backend reading an object nobody verified.
fn backend_input_spelling(
    admitted: &SourceIdentity,
    spelling: InputSpelling,
) -> Result<PathBuf, PlanError> {
    let canonical = admitted.canonical_path();
    if spelling == InputSpelling::Canonical {
        return Ok(canonical.to_path_buf());
    }

    // Asked on the bytes, because a path this rule cannot decode is still a
    // path this rule can tell is already plain.
    if !canonical
        .as_os_str()
        .as_encoded_bytes()
        .starts_with(VERBATIM_PREFIX.as_bytes())
    {
        // Already a plain spelling, so there is nothing to derive and nothing
        // to prove. Every path on a platform without the prefix lands here.
        return Ok(canonical.to_path_buf());
    }

    // From here the canonical spelling is one the caller's reader cannot use,
    // so failing to derive an alternative is a refusal rather than a fallback.
    // Returning the canonical path anyway would defer a stateable refusal to an
    // opaque backend failure after a process had already run.
    let Some(plain) = canonical
        .to_str()
        .and_then(|text| text.strip_prefix(VERBATIM_PREFIX))
        .filter(|plain| !plain.starts_with("UNC\\"))
    else {
        return Err(PlanError::SourceSpellingNotEquivalent);
    };
    let plain = PathBuf::from(plain);
    let resolved = SourceIdentity::capture(&plain)
        .map_err(|error| PlanError::InputPathInspectionFailed { kind: error.kind() })?;
    if &resolved != admitted {
        return Err(PlanError::SourceSpellingNotEquivalent);
    }
    Ok(plain)
}

fn validate_paths(
    executable: &Path,
    input: &Path,
    output_directory: &Path,
) -> Result<(), PlanError> {
    if !executable.is_absolute() {
        return Err(PlanError::NonAbsoluteExecutable);
    }
    if !input.is_absolute() {
        return Err(PlanError::NonAbsoluteInput);
    }
    if !output_directory.is_absolute() {
        return Err(PlanError::NonAbsoluteOutputDirectory);
    }
    if input.file_name().is_none() {
        return Err(PlanError::MissingInputName);
    }
    if output_directory.as_os_str().is_empty() {
        return Err(PlanError::MissingOutputDirectory);
    }
    Ok(())
}

pub(crate) fn validate_output_file_name(
    output_file_name: &OsStr,
    format: OpenFormat,
) -> Result<(), PlanError> {
    let path = Path::new(output_file_name);
    let mut components = path.components();
    let is_single_normal_component = matches!(
        components.next(),
        Some(std::path::Component::Normal(component)) if component == output_file_name
    ) && components.next().is_none();
    let contains_backend_normalized_character = output_file_name
        .as_encoded_bytes()
        .iter()
        .any(|byte| *byte < 0x20 || *byte == 0x7f || b"\\/*:?<>|\"".contains(byte));
    if !is_single_normal_component || contains_backend_normalized_character {
        return Err(PlanError::InvalidOutputFileName);
    }
    if is_windows_device_name(path) {
        return Err(PlanError::InvalidOutputFileName);
    }
    if !path.extension().is_some_and(|extension| {
        extension
            .as_encoded_bytes()
            .eq_ignore_ascii_case(format.extension().as_bytes())
    }) {
        return Err(PlanError::OutputFileExtensionMismatch);
    }
    Ok(())
}

fn is_windows_device_name(path: &Path) -> bool {
    let Some(stem) = path.file_stem() else {
        return false;
    };
    let first_segment = stem
        .as_encoded_bytes()
        .split(|byte| *byte == b'.')
        .next()
        .unwrap_or_default();
    let trimmed_length = first_segment
        .iter()
        .rposition(|byte| !matches!(*byte, b' ' | b'.'))
        .map_or(0, |index| index + 1);
    let name = &first_segment[..trimmed_length];

    let suffix = name.get(3..).unwrap_or_default();
    let reserved_port = name.len() > 3
        && (name[..3].eq_ignore_ascii_case(b"COM") || name[..3].eq_ignore_ascii_case(b"LPT"))
        && (matches!(suffix, [b'1'..=b'9'])
            || suffix == "¹".as_bytes()
            || suffix == "²".as_bytes()
            || suffix == "³".as_bytes());

    [b"CON".as_slice(), b"PRN", b"AUX", b"NUL"]
        .iter()
        .any(|reserved| name.eq_ignore_ascii_case(reserved))
        || reserved_port
}

fn inspect_output_directory(output_directory: &Path) -> Result<PathBuf, PlanError> {
    let canonical_output = std::fs::canonicalize(output_directory)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    let _entries = std::fs::read_dir(&canonical_output)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    Ok(canonical_output)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SafeOutputDirectory {
    output_directory: PathBuf,
    source_identity: SourceIdentity,
    source_directory_boundary: Option<PathBuf>,
}

fn canonical_input_and_directory_boundary(
    input: &Path,
    canonical_output: &Path,
) -> Result<(SourceIdentity, Option<PathBuf>), PlanError> {
    let source_identity = SourceIdentity::capture(input)
        .map_err(|error| PlanError::InputPathInspectionFailed { kind: error.kind() })?;
    if source_identity.is_directory()
        && canonical_output.starts_with(source_identity.canonical_path())
    {
        return Err(PlanError::OutputDirectoryInsideDirectoryInput);
    }
    let source_directory_boundary = source_identity
        .is_directory()
        .then(|| source_identity.canonical_path().to_path_buf());
    Ok((source_identity, source_directory_boundary))
}

fn require_safe_output_directory(
    input: &Path,
    output_directory: &Path,
) -> Result<SafeOutputDirectory, PlanError> {
    let canonical_output = inspect_output_directory(output_directory)?;
    let (source_identity, source_directory_boundary) =
        canonical_input_and_directory_boundary(input, &canonical_output)?;
    Ok(SafeOutputDirectory {
        output_directory: canonical_output,
        source_identity,
        source_directory_boundary,
    })
}

fn require_fresh_output_directory(
    input: &Path,
    output_directory: &Path,
) -> Result<SafeOutputDirectory, PlanError> {
    let canonical_output = inspect_output_directory(output_directory)?;
    let mut entries = std::fs::read_dir(&canonical_output)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    match entries.next() {
        Some(Ok(_)) => Err(PlanError::OutputDirectoryNotEmpty),
        Some(Err(error)) => Err(PlanError::OutputDirectoryInspectionFailed { kind: error.kind() }),
        None => {
            let (source_identity, source_directory_boundary) =
                canonical_input_and_directory_boundary(input, &canonical_output)?;
            Ok(SafeOutputDirectory {
                output_directory: canonical_output,
                source_identity,
                source_directory_boundary,
            })
        }
    }
}

fn require_output_destination_available(destination: &Path) -> Result<(), PlanError> {
    match std::fs::symlink_metadata(destination) {
        Ok(_) => Err(PlanError::OutputDestinationExists),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PlanError::OutputDestinationInspectionFailed { kind: error.kind() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(relative: impl AsRef<Path>) -> PathBuf {
        std::env::current_dir()
            .expect("test current directory")
            .join(relative)
    }

    #[cfg(windows)]
    #[test]
    fn an_unsupported_zero_128_bit_source_identity_fails_closed() {
        let error = validated_windows_source_identity(42, [0; 16])
            .expect_err("an unavailable 128-bit file identity must not be accepted");

        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }

    #[test]
    fn paths_with_spaces_and_unicode_are_single_argv_values() {
        let executable = test_path("Program Files/ProteoWizard/msconvert.exe");
        let input = test_path("Mass Spec Data/样本 01.raw");
        let output = test_path("Mass Spec Data/converted");
        let command = build_msconvert_command(
            &executable,
            &input,
            &output,
            OsStr::new("样本 01.mzML"),
            &ConversionIntent::SHIPPED,
            None,
        )
        .expect("valid command");

        assert_eq!(command.args[0], input.as_os_str());
        assert_eq!(command.args[1], OsString::from("--mzML"));
        assert_eq!(command.args[3], OsString::from("--outdir"));
        assert_eq!(command.args[5], OsString::from("--outfile"));
        assert_eq!(command.args[6], OsString::from("样本 01.mzML"));
        assert_eq!(command.args.len(), 7);
        assert_eq!(
            command.output_destination(),
            Some(output.join("样本 01.mzML").as_path())
        );
    }

    /// mzXML has no argument spelling here any more, because it has no intent.
    ///
    /// This replaces a test that built an mzXML command and asserted it spelled
    /// `--mzXML`. The builder is driven by a `ConversionIntent` now and no
    /// intent names that format, so such a command is unconstructible rather
    /// than merely unused -- and what survives is the stronger claim: nothing
    /// the admitted table can produce reaches the legacy flag.
    #[test]
    fn no_admitted_intent_produces_a_legacy_format_argument() {
        for admitted in ConversionIntent::ADMITTED {
            let command = build_msconvert_command(
                test_path("msconvert.exe"),
                &test_path("sample.raw"),
                &test_path("converted"),
                OsStr::new("sample.mzML"),
                &admitted.intent(),
                None,
            )
            .expect("valid command");

            assert!(command.contains_argument("--mzML"));
            assert!(!command.contains_argument("--mzXML"));
        }
    }

    #[test]
    fn no_additional_centroiding_never_adds_a_peak_picking_filter() {
        let command = build_msconvert_command(
            test_path("msconvert.exe"),
            &test_path("sample.raw"),
            &test_path("converted"),
            OsStr::new("sample.mzML"),
            &ConversionIntent::SHIPPED,
            None,
        )
        .expect("valid command");

        assert!(!command.contains_argument("--filter"));
        assert!(
            command
                .args
                .iter()
                .all(|argument| !argument.to_string_lossy().contains("peakPicking"))
        );
    }

    #[test]
    fn filtered_tic_fails_closed_without_installed_help_evidence() {
        let error = build_msaccess_command(
            test_path("msaccess.exe"),
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::Tic { ms_level: Some(2) },
        )
        .expect_err("generic planning cannot establish installed filter grammar");

        assert_eq!(error, PlanError::FilteredTicCapabilityEvidenceRequired);
    }

    #[test]
    fn spectrum_index_and_precision_are_validated_and_typed() {
        let command = build_msaccess_command(
            test_path("msaccess.exe"),
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::SpectrumByIndex {
                index: 7,
                precision: 8,
            },
        )
        .expect("valid command");
        assert_eq!(
            command.args[4],
            OsString::from("binary index=7 precision=8")
        );

        let error = build_msaccess_command(
            test_path("msaccess.exe"),
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::SpectrumByIndex {
                index: 0,
                precision: 16,
            },
        )
        .expect_err("invalid precision");
        assert_eq!(error, PlanError::InvalidSpectrumPrecision);
    }

    #[test]
    fn relative_paths_are_rejected_before_working_directory_changes() {
        let executable = test_path("msconvert.exe");
        let input = test_path("sample.raw");
        let output = test_path("converted");

        assert_eq!(
            build_msconvert_command(
                "msconvert.exe",
                &input,
                &output,
                OsStr::new("sample.mzML"),
                &ConversionIntent::SHIPPED,
                None,
            ),
            Err(PlanError::NonAbsoluteExecutable)
        );
        assert_eq!(
            build_msconvert_command(
                &executable,
                Path::new("sample.raw"),
                &output,
                OsStr::new("sample.mzML"),
                &ConversionIntent::SHIPPED,
                None,
            ),
            Err(PlanError::NonAbsoluteInput)
        );
        assert_eq!(
            build_msconvert_command(
                &executable,
                &input,
                Path::new("converted"),
                OsStr::new("sample.mzML"),
                &ConversionIntent::SHIPPED,
                None,
            ),
            Err(PlanError::NonAbsoluteOutputDirectory)
        );
    }
}
