//! The provider boundary the preview service talks to.
//!
//! Production work goes through a user-installed ProteoWizard. MSCanvas never
//! bundles, downloads or installs it. Tests substitute a deterministic provider
//! at this boundary so no test needs a local installation.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use mscanvas_proteowizard::{
    AvailabilityState, ConfiguredLocation, DiscoveryRequest, InstalledHelpCapabilities,
    LaunchFailureKind, MAX_PREVIEW_TEXT_BYTES, OpenFormat, OutputEntryKind, PreviewInterpretError,
    PreviewOperation, PreviewOutcome, PreviewOutputEntry, PreviewOutputManifest, ProcessError,
    ProcessRunner, Redactor, SystemProcessRunner, build_msaccess_command_with_capabilities,
    discover, execute, interpret_preview, snapshot_output_directory,
};

use super::dto::{
    BackendAvailabilityDto, BackendFailureDto, MAX_BACKEND_LABEL_CHARS, PreviewErrorDto,
    bounded_text, redact_absolute_paths,
};
use super::installation::{InstallationIdentity, classify_chosen_folder};

/// One attempt at an operation: which installation ran it, and how it went.
///
/// The two are kept together because they answer different questions and only
/// one of them survives a `?`. An operation can fail for reasons that say
/// nothing about which backend ran it -- a launch that was refused, a wait that
/// was interrupted, output that could not be captured -- and a caller that
/// propagated the error would lose the one fact that says whether the failure
/// even came from the installation it thinks it is using.
///
/// `installation` is `None` only where resolution itself never got far enough
/// to name one.
pub struct OperationAttempt {
    pub installation: Option<InstallationIdentity>,
    pub outcome: Result<PreviewOutcome, PreviewErrorDto>,
}

/// What a provider must be able to do for this slice. Nothing here accepts a
/// command string or returns raw process output.
pub trait PreviewProvider: Send + Sync {
    /// Reports whether a usable backend pair is installed, and which one that
    /// resolved to.
    ///
    /// The identity is returned beside the transfer object rather than inside
    /// it, because it is made of absolute paths and filesystem identities that
    /// must not reach the webview. It is `None` when nothing resolved, which a
    /// comparison must read as different from any installation rather than as
    /// a match.
    ///
    /// Both come from one resolution on purpose: asking twice would let the
    /// verdict describe one installation and the identity another.
    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>);

    /// Runs one preview operation against one already-validated source file.
    ///
    /// Implementations perform their own discovery, so an operation is always
    /// self-contained; callers must not assume state carries between calls.
    ///
    /// `Err` is reserved for a failure that happened before any installation
    /// could be named. Everything after that is an attempt: it says which
    /// backend ran, and separately how the run went.
    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto>;

    /// Runs several operations for one explicit user action, reusing a single
    /// discovery and capability probe across all of them.
    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationAttempt>, PreviewErrorDto> {
        operations
            .iter()
            .map(|operation| self.run(source, operation))
            .collect()
    }

    /// Points this provider at one installation folder, or back at automatic
    /// discovery when given `None`.
    ///
    /// No default implementation. A provider that silently ignored this would
    /// keep answering from the old installation while the user believes they
    /// changed it, and that is precisely the state this entry point exists to
    /// make impossible.
    fn use_installation(&self, home: Option<PathBuf>);

    /// Binds what one conversion needs from the currently installed backend.
    ///
    /// Not a [`PreviewOperation`], deliberately. A conversion reads a different
    /// tool's help, writes a file rather than answering a question, and is
    /// gated on evidence recorded for one exact build. Folding it into the
    /// operation enum would also enrol it in `required_operations`, which
    /// decides whether an installation is reported *available at all* -- so an
    /// installation that could preview perfectly well would stop being usable
    /// because it could not convert.
    ///
    /// One method rather than three accessors because the three answers have to
    /// describe one binding. Capabilities read from one resolution, an identity
    /// from another and a runner belonging to neither would let a conversion be
    /// gated on the evidence of a build it did not run on.
    ///
    /// The default refuses. A provider that has not been taught to convert must
    /// say so, because the alternative -- inheriting some other provider's
    /// backend -- is how a test double ends up launching a real process.
    fn conversion_backend(&self) -> Result<ConversionBackend<'_>, PreviewErrorDto> {
        Err(PreviewErrorDto::new(
            "conversion_unsupported",
            "This backend cannot convert acquisitions.",
            false,
        ))
    }
}

/// One binding of the installed backend, for one conversion.
///
/// The runner is borrowed from the provider rather than constructed here, so
/// the process a conversion launches is the one its provider owns: production
/// runs the reviewed system runner, and a test double runs whatever it was
/// built with, without either being able to reach the other's.
pub struct ConversionBackend<'a> {
    /// Capability evidence read from the installed `msconvert`'s own help.
    ///
    /// From `msconvert` and not `msaccess`, which is what every other operation
    /// binds. The two are separate executables with separate option grammars,
    /// and the build evidence a conversion is gated on is a statement about
    /// this one.
    pub capabilities: InstalledHelpCapabilities,
    /// Which installation the capabilities above were read from.
    pub installation: Option<InstallationIdentity>,
    /// The execution boundary the conversion's process goes through.
    pub runner: &'a dyn ProcessRunner,
}

/// Which installed executable a capability binding reads its help from.
#[derive(Clone, Copy)]
enum BoundTool {
    /// Answers preview questions.
    Msaccess,
    /// Performs conversions.
    Msconvert,
}

/// The production provider: a user-installed ProteoWizard `msaccess`.
#[derive(Debug, Default)]
pub struct ProteoWizardProvider {
    /// The folder the user chose, for this session only.
    ///
    /// Never written to disk. A stored path would go on applying after the
    /// session that chose it, to a folder whose contents MSCanvas has no way to
    /// vouch for: automatic discovery searches `PATH` and the locations an
    /// installer writes, and this deliberately looks wherever it is told.
    /// Making the user say so again next time is what keeps it narrower than
    /// either, and is the cost of that.
    chosen: RwLock<Option<PathBuf>>,
}

impl ProteoWizardProvider {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            chosen: RwLock::new(None),
        }
    }

    /// What to hand discovery: the chosen folder, or nothing at all.
    fn request(&self) -> DiscoveryRequest {
        DiscoveryRequest {
            configured: self
                .chosen
                .read()
                .ok()
                .and_then(|chosen| chosen.clone())
                .map(ConfiguredLocation::Home),
        }
    }

    /// Resolves the installation and binds its complete installed help once.
    ///
    /// Discovery is deliberately per explicit user operation rather than per
    /// rendered component, and the resulting capability evidence is reused for
    /// every operation in that same action.
    /// Also reports which installation this resolution found, so the work done
    /// with these capabilities can be attributed to it rather than to whatever
    /// a later look happens to resolve.
    fn bind_capabilities(
        &self,
    ) -> Result<(InstalledHelpCapabilities, Option<InstallationIdentity>), PreviewErrorDto> {
        self.bind_help_of(BoundTool::Msaccess)
    }

    /// The shared body of every binding: resolve the installation once, then
    /// read one tool's complete installed help from that same resolution.
    ///
    /// Which tool is a parameter because preview and conversion are answered by
    /// different executables with different option grammars. Reading one's help
    /// and planning against the other is the mistake this makes unspellable.
    fn bind_help_of(
        &self,
        tool: BoundTool,
    ) -> Result<(InstalledHelpCapabilities, Option<InstallationIdentity>), PreviewErrorDto> {
        let request = self.request();
        let configured = configured_home(&request);
        let discovery = discover(&request);
        if discovery.availability != AvailabilityState::Available {
            return Err(unavailable_error(configured.as_deref(), &discovery.failure));
        }
        let identity = InstallationIdentity::of(&discovery);
        let discovered = match tool {
            BoundTool::Msaccess => &discovery.msaccess,
            BoundTool::Msconvert => &discovery.msconvert,
        };
        let capabilities =
            InstalledHelpCapabilities::from_discovered_tool(discovered).map_err(|_| {
                PreviewErrorDto::new(
                    "capability_evidence_unavailable",
                    "The installed ProteoWizard did not describe the commands MSCanvas needs.",
                    false,
                )
            })?;
        Ok((capabilities, identity))
    }

    /// The operation as an attempt, so a failure still names what ran it.
    fn run_bound(
        capabilities: &InstalledHelpCapabilities,
        installation: Option<&InstallationIdentity>,
        source: &Path,
        operation: &PreviewOperation,
    ) -> OperationAttempt {
        OperationAttempt {
            installation: installation.cloned(),
            outcome: Self::execute_bound(capabilities, source, operation),
        }
    }

    fn execute_bound(
        capabilities: &InstalledHelpCapabilities,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<PreviewOutcome, PreviewErrorDto> {
        let output_root = TemporaryOutputDirectory::create()?;
        let command = build_msaccess_command_with_capabilities(
            capabilities,
            source,
            output_root.path(),
            operation.clone(),
        )
        .map_err(|_| {
            PreviewErrorDto::new(
                "preview_not_plannable",
                "MSCanvas could not prepare that preview request.",
                false,
            )
        })?;

        let process = execute(&command).map_err(process_error)?;

        let manifest = capture_manifest(output_root.path(), operation)?;
        interpret_preview(operation, &process, &manifest).map_err(interpretation_error)
    }
}

impl PreviewProvider for ProteoWizardProvider {
    fn use_installation(&self, home: Option<PathBuf>) {
        if let Ok(mut chosen) = self.chosen.write() {
            *chosen = home;
        }
    }

    fn conversion_backend(&self) -> Result<ConversionBackend<'_>, PreviewErrorDto> {
        let (capabilities, installation) = self.bind_help_of(BoundTool::Msconvert)?;
        // The option grammar the plan will be built against, required here so a
        // build that cannot express the conversion is refused while nothing has
        // been created yet. Planning against absent options would otherwise fail
        // after a staging directory existed, which is a worse place to find out
        // and a harder one to describe.
        capabilities
            .require_conversion(OpenFormat::MzMl)
            .map_err(|_| {
                PreviewErrorDto::new(
                    "conversion_capability_unavailable",
                    "The installed ProteoWizard cannot convert to mzML.",
                    false,
                )
            })?;
        Ok(ConversionBackend {
            capabilities,
            installation,
            // A unit value with no state to carry, so one shared reference is
            // the whole of it.
            runner: &SystemProcessRunner,
        })
    }

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        let request = self.request();
        let configured = configured_home(&request);
        let chosen = configured.is_some();
        let discovery = discover(&request);
        let discovered = discovery.availability == AvailabilityState::Available;
        // Availability answers "can this installation produce a preview", not
        // "does an executable exist" and not "does its help parse". Reading the
        // help is not enough: the exact query grammars MSCanvas plans against
        // are what a file actually needs, so every operation it will ask for is
        // required here rather than failing one file at a time later.
        let usable = discovered
            && InstalledHelpCapabilities::from_discovered_tool(&discovery.msaccess).is_ok_and(
                |capabilities| {
                    required_operations()
                        .iter()
                        .all(|operation| capabilities.require_preview_operation(operation).is_ok())
                },
            );
        // Only what actually resolved counts as an identity. An unusable
        // installation is not one this preview could have come from, so it must
        // not compare equal to anything.
        let identity = usable
            .then(|| InstallationIdentity::of(&discovery))
            .flatten();
        let availability = BackendAvailabilityDto {
            state: if usable { "available" } else { "unavailable" }.to_owned(),
            // Which installation this verdict is about, so nothing downstream
            // has to remember what was asked. A verdict shown beside the wrong
            // origin is worse than no verdict: it reports on an installation the
            // user is no longer using.
            origin: if chosen { "chosen" } else { "automatic" }.to_owned(),
            // Stamped by the service, which owns the gate this was served
            // under and so is the only place that knows the sequence.
            installation_generation: 0,
            release: discovery.release.as_deref().map(backend_label),
            build_date: discovery.build_date.as_deref().map(backend_label),
            same_installation: discovery.same_installation,
            failure: discovery.failure.as_ref().map_or_else(
                || {
                    (!usable).then(|| BackendFailureDto {
                        kind: "capability_evidence_unavailable".to_owned(),
                        summary: "ProteoWizard was found, but it does not describe the commands \
                             MSCanvas needs."
                            .to_owned(),
                        corrective_action: if chosen {
                            "Choose a folder holding a ProteoWizard release that provides \
                             msaccess help, or go back to searching automatically."
                        } else {
                            "Install a ProteoWizard release that provides msaccess help, then \
                             check again. If one is already installed somewhere MSCanvas does \
                             not search, choose its folder."
                        }
                        .to_owned(),
                    })
                },
                |failure| Some(failure_dto(configured.as_deref(), failure)),
            ),
        };
        (availability, identity)
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        let (capabilities, installation) = self.bind_capabilities()?;
        Ok(Self::run_bound(
            &capabilities,
            installation.as_ref(),
            source,
            operation,
        ))
    }

    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationAttempt>, PreviewErrorDto> {
        let (capabilities, installation) = self.bind_capabilities()?;
        let mut attempts = Vec::with_capacity(operations.len());
        for operation in operations {
            let attempt = Self::run_bound(&capabilities, installation.as_ref(), source, operation);
            let failed = attempt.outcome.is_err();
            // The failed attempt is kept, because it still names the backend
            // that ran -- but nothing after it is started. Every operation here
            // is a ProteoWizard process, and the failures that stop the first
            // one are the ones that would stop the rest as well: a launch that
            // was refused, a workspace that could not be made. Running them
            // anyway spends two more launches to learn the same thing and
            // delays the error the user is waiting for.
            attempts.push(attempt);
            if failed {
                break;
            }
        }
        Ok(attempts)
    }
}

/// Every operation this boundary will ever ask an installation to perform.
///
/// Availability is judged against exactly this list, so a backend reported as
/// available can serve both an open action and a spectrum selection.
fn required_operations() -> Vec<PreviewOperation> {
    let mut operations = open_operations();
    operations.push(selected_spectrum_operation(0));
    operations
}

/// Names what a failing operation was reading, so a size message says which
/// part of the file was too large rather than only that something was.
const fn describe_operation_subject(operation: &PreviewOperation) -> &'static str {
    match operation {
        PreviewOperation::Metadata => "This file's metadata",
        PreviewOperation::RunSummary => "This run's summary",
        PreviewOperation::SpectrumTable => "The spectrum list for this run",
        PreviewOperation::SpectrumByIndex { .. } => "That spectrum",
        PreviewOperation::Tic { .. } => "That chromatogram",
    }
}

/// Bounds and redacts a label lifted from the installed tool's help text.
///
/// The release and build-date lines are whatever that installation prints, so
/// they can carry an absolute path or an unbounded run of text just as any
/// other backend output can.
pub(super) fn backend_label(value: &str) -> String {
    bounded_text(&redact_absolute_paths(value), MAX_BACKEND_LABEL_CHARS)
}

/// Maps a typed process failure to a displayable error.
///
/// The crate already distinguishes a launch failure from a file that changed
/// underneath the read, from a backend binary that changed after its probe.
/// Flattening those into one message would tell the user the wrong thing and
/// offer a retry that cannot help. Only the variant identity crosses this
/// boundary; the attached detail strings can name paths and are dropped.
pub fn process_error(error: ProcessError) -> PreviewErrorDto {
    match error {
        ProcessError::SourceIdentityChanged => PreviewErrorDto::new(
            "source_changed_during_read",
            "The file changed while MSCanvas was reading it, so the read was abandoned.",
            true,
        ),
        ProcessError::SourceIdentityInspectionFailed { .. } => PreviewErrorDto::new(
            "source_not_inspectable",
            "MSCanvas could not confirm the file was still the one it opened, so it did not read it.",
            true,
        ),
        ProcessError::ExecutableIdentityChanged => PreviewErrorDto::new(
            "backend_changed_after_check",
            "The ProteoWizard program changed after MSCanvas checked it, so it was not run.",
            false,
        ),
        ProcessError::ExecutableIdentityInspectionFailed { .. } => PreviewErrorDto::new(
            "backend_not_inspectable",
            "MSCanvas could not confirm the ProteoWizard program it checked, so it did not run it.",
            true,
        ),
        ProcessError::OutputDestinationExists
        | ProcessError::OutputDestinationInspectionFailed { .. }
        | ProcessError::OutputDirectoryNotEmpty
        | ProcessError::OutputDirectoryInspectionFailed { .. }
        | ProcessError::OutputDirectoryInsideDirectoryInput => PreviewErrorDto::new(
            "preview_workspace_unusable",
            "MSCanvas could not prepare a private place for this preview's output.",
            true,
        ),
        ProcessError::Launch { kind, .. } => match kind {
            LaunchFailureKind::NotFound => PreviewErrorDto::new(
                "backend_not_found_at_launch",
                "The ProteoWizard program was not there when MSCanvas tried to run it.",
                false,
            ),
            LaunchFailureKind::PermissionDenied => PreviewErrorDto::new(
                "backend_launch_denied",
                "Windows refused to run the ProteoWizard program.",
                false,
            ),
            LaunchFailureKind::Other => PreviewErrorDto::new(
                "backend_launch_failed",
                "The ProteoWizard preview tool could not be started.",
                true,
            ),
        },
        ProcessError::InvalidEnvironment { .. } => PreviewErrorDto::new(
            "backend_environment_invalid",
            "MSCanvas could not build a safe environment for the ProteoWizard program.",
            false,
        ),
        ProcessError::AssignToOwnedJob { .. } => PreviewErrorDto::new(
            "backend_supervision_failed",
            "MSCanvas could not keep the ProteoWizard program under its own supervision, \
             so it did not use its output.",
            true,
        ),
        ProcessError::Wait { .. } => PreviewErrorDto::new(
            "backend_wait_failed",
            "MSCanvas lost track of the ProteoWizard program while it was running.",
            true,
        ),
        ProcessError::Capture { .. } => PreviewErrorDto::new(
            "backend_output_capture_failed",
            "MSCanvas could not read what the ProteoWizard program produced.",
            true,
        ),
        ProcessError::Terminate { .. } => PreviewErrorDto::new(
            "backend_termination_failed",
            "MSCanvas could not stop the ProteoWizard program cleanly.",
            true,
        ),
    }
}

/// Maps a typed interpretation failure to a displayable error.
///
/// Only stable identifiers cross this boundary: no English backend text is
/// inspected and none is forwarded.
pub fn interpretation_error(error: PreviewInterpretError) -> PreviewErrorDto {
    let identifier = error.stable_id();
    match error {
        PreviewInterpretError::MalformedOutput { kind, .. } => PreviewErrorDto::new(
            identifier,
            "That preview result could not be interpreted.",
            false,
        )
        .with_detail(kind.stable_id()),
        // The parser requires the whole output, and this boundary reads at
        // most `MAX_PREVIEW_TEXT_BYTES`. A run above that is refused rather
        // than shown from a prefix, because a spectrum list cut mid-file would
        // read as a shorter acquisition. Saying so plainly is the point: the
        // limit is a named limit of this version, not a defect in the file.
        PreviewInterpretError::IncompleteParserInput {
            operation,
            captured_bytes,
            total_bytes,
            ..
        } => PreviewErrorDto::new(
            identifier,
            format!(
                "{} is larger than MSCanvas reads in one piece, so it was refused \
                 rather than shown incomplete.",
                describe_operation_subject(&operation)
            ),
            false,
        )
        .with_detail(format!(
            "read {captured_bytes} of {total_bytes} bytes; the limit is {MAX_PREVIEW_TEXT_BYTES}"
        )),
        _ => PreviewErrorDto::new(
            identifier,
            "That preview result could not be interpreted.",
            false,
        ),
    }
}

/// The folder the request names, if it names one.
///
/// Only a home is a folder the user chose through the picker. A configured
/// executable is not something this application can produce, so it is not
/// something whose folder it should explain.
fn configured_home(request: &DiscoveryRequest) -> Option<PathBuf> {
    match request.configured.as_ref() {
        Some(ConfiguredLocation::Home(home)) => Some(home.clone()),
        Some(ConfiguredLocation::Executable(_)) | None => None,
    }
}

/// What to tell the user about a discovery failure.
///
/// A chosen folder is explained by the folder rather than by the crate. The
/// crate speaks to every caller: its summary for a configured location is the
/// single sentence "not usable" whatever the cause, and its advice offers
/// naming an exact `msconvert.exe`/`msaccess.exe` path, which this application
/// has neither a command nor a picker for. Both are replaced here with the
/// cause established from the folder and the recoveries this application
/// actually has.
fn failure_dto(
    configured: Option<&Path>,
    failure: &mscanvas_proteowizard::DiscoveryFailure,
) -> BackendFailureDto {
    if let Some(home) = configured {
        let problem = classify_chosen_folder(home, Some(failure));
        return BackendFailureDto {
            kind: problem.kind().to_owned(),
            summary: problem.summary().to_owned(),
            corrective_action: "Choose a different folder, or go back to searching automatically."
                .to_owned(),
        };
    }
    BackendFailureDto {
        kind: failure.kind().to_owned(),
        summary: failure.summary().to_owned(),
        corrective_action: failure.corrective_action().to_owned(),
    }
}

fn unavailable_error(
    configured: Option<&Path>,
    failure: &Option<mscanvas_proteowizard::DiscoveryFailure>,
) -> PreviewErrorDto {
    failure.as_ref().map_or_else(
        || PreviewErrorDto::new("backend_not_found", "ProteoWizard was not found.", false),
        |failure| {
            let reported = failure_dto(configured, failure);
            PreviewErrorDto::new(&reported.kind, &reported.summary, false)
        },
    )
}

/// A fresh, self-cleaning output directory for exactly one operation.
///
/// The backend contract requires an empty directory, and the source file is
/// never written to, so preview output lives entirely under the OS temporary
/// root and is removed when the operation ends.
struct TemporaryOutputDirectory {
    path: PathBuf,
}

impl TemporaryOutputDirectory {
    fn create() -> Result<Self, PreviewErrorDto> {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("mscanvas-preview-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&path).map_err(|_| {
            PreviewErrorDto::new(
                "preview_workspace_unavailable",
                "MSCanvas could not prepare a temporary location for this preview.",
                true,
            )
        })?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryOutputDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Reads one operation's generated output into the path-free manifest the typed
/// interpreter consumes.
fn capture_manifest(
    output_root: &Path,
    operation: &PreviewOperation,
) -> Result<PreviewOutputManifest, PreviewErrorDto> {
    let snapshot = snapshot_output_directory(output_root).map_err(|_| {
        PreviewErrorDto::new(
            "preview_output_not_inspectable",
            "The preview result could not be read.",
            true,
        )
    })?;
    // The run summary is delivered on stdout, so any generated file there would
    // be unexpected output rather than a payload to read.
    let needs_bytes = *operation != PreviewOperation::RunSummary && snapshot.len() == 1;

    let mut entries = Vec::with_capacity(snapshot.len());
    for entry in snapshot.entries() {
        match entry.kind() {
            OutputEntryKind::Directory => {
                entries.push(PreviewOutputEntry::Directory);
                continue;
            }
            OutputEntryKind::RegularFile => {}
            OutputEntryKind::Symlink | OutputEntryKind::ReparsePoint | OutputEntryKind::Other => {
                entries.push(PreviewOutputEntry::Other);
                continue;
            }
        }
        let observed = entry.byte_length();
        if !needs_bytes || observed > MAX_PREVIEW_TEXT_BYTES {
            entries.push(PreviewOutputEntry::incomplete_file(0, observed));
            continue;
        }
        let Ok((file, opened_length)) = entry.open_in(output_root) else {
            entries.push(PreviewOutputEntry::incomplete_file(0, observed));
            continue;
        };
        if opened_length > MAX_PREVIEW_TEXT_BYTES {
            entries.push(PreviewOutputEntry::incomplete_file(
                0,
                opened_length.max(observed),
            ));
            continue;
        }
        let mut bytes = Vec::new();
        let mut reader = std::io::Read::take(file, MAX_PREVIEW_TEXT_BYTES + 1);
        if std::io::Read::read_to_end(&mut reader, &mut bytes).is_err() {
            entries.push(PreviewOutputEntry::incomplete_file(0, observed));
            continue;
        }
        let captured = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if captured != observed || captured != opened_length {
            entries.push(PreviewOutputEntry::incomplete_file(
                captured.min(MAX_PREVIEW_TEXT_BYTES),
                observed.max(opened_length).max(captured),
            ));
            continue;
        }
        entries.push(PreviewOutputEntry::complete_file(bytes));
    }
    Ok(PreviewOutputManifest::new(entries))
}

/// Builds the redactor that keeps the opened source path out of anything the
/// webview can see.
pub fn reporting_redactor(source: &Path) -> Redactor {
    let mut redactor = Redactor::new();
    redactor.add_path(source, "<file>");
    if let Some(parent) = source.parent() {
        redactor.add_path(parent, "<folder>");
    }
    redactor
}

/// The preview operations one explicit open action performs, in display order.
#[must_use]
pub fn open_operations() -> Vec<PreviewOperation> {
    vec![
        PreviewOperation::Metadata,
        PreviewOperation::RunSummary,
        PreviewOperation::SpectrumTable,
    ]
}

/// The fixed formatter precision MSCanvas requests for a selected spectrum.
pub const SELECTED_SPECTRUM_PRECISION: u8 = 8;

#[must_use]
pub fn selected_spectrum_operation(index: u64) -> PreviewOperation {
    PreviewOperation::SpectrumByIndex {
        index,
        precision: SELECTED_SPECTRUM_PRECISION,
    }
}
