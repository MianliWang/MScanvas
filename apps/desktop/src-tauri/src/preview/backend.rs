//! The provider boundary the preview service talks to.
//!
//! Production work goes through a user-installed ProteoWizard. MSCanvas never
//! bundles, downloads or installs it. Tests substitute a deterministic provider
//! at this boundary so no test needs a local installation.

use std::path::{Path, PathBuf};

use mscanvas_proteowizard::{
    AvailabilityState, DiscoveryRequest, InstalledHelpCapabilities, LaunchFailureKind,
    OutputEntryKind, PreviewInterpretError, PreviewOperation, PreviewOutcome, PreviewOutputEntry,
    PreviewOutputManifest, ProcessError, Redactor, build_msaccess_command_with_capabilities,
    discover, execute, interpret_preview, snapshot_output_directory,
};

use super::dto::{
    BackendAvailabilityDto, BackendFailureDto, MAX_BACKEND_LABEL_CHARS, PreviewErrorDto,
    bounded_text, redact_absolute_paths,
};

/// The largest preview output this boundary will read into memory.
const MAX_PREVIEW_OUTPUT_BYTES: u64 = 8 * 1024 * 1024;

/// One preview operation's typed result plus the redactor that produced it.
pub struct OperationResult {
    pub outcome: PreviewOutcome,
}

/// What a provider must be able to do for this slice. Nothing here accepts a
/// command string or returns raw process output.
pub trait PreviewProvider: Send + Sync {
    /// Reports whether a usable backend pair is installed.
    fn availability(&self) -> BackendAvailabilityDto;

    /// Runs one preview operation against one already-validated source file.
    ///
    /// Implementations perform their own discovery, so an operation is always
    /// self-contained; callers must not assume state carries between calls.
    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationResult, PreviewErrorDto>;

    /// Runs several operations for one explicit user action, reusing a single
    /// discovery and capability probe across all of them.
    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationResult>, PreviewErrorDto> {
        operations
            .iter()
            .map(|operation| self.run(source, operation))
            .collect()
    }
}

/// The production provider: a user-installed ProteoWizard `msaccess`.
#[derive(Debug, Default)]
pub struct ProteoWizardProvider;

impl ProteoWizardProvider {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }

    /// Resolves the installation and binds its complete installed help once.
    ///
    /// Discovery is deliberately per explicit user operation rather than per
    /// rendered component, and the resulting capability evidence is reused for
    /// every operation in that same action.
    fn bind_capabilities(&self) -> Result<InstalledHelpCapabilities, PreviewErrorDto> {
        let discovery = discover(&DiscoveryRequest { configured: None });
        if discovery.availability != AvailabilityState::Available {
            return Err(unavailable_error(&discovery.failure));
        }
        InstalledHelpCapabilities::from_discovered_tool(&discovery.msaccess).map_err(|_| {
            PreviewErrorDto::new(
                "capability_evidence_unavailable",
                "The installed ProteoWizard did not describe the commands MSCanvas needs.",
                false,
            )
        })
    }

    fn run_bound(
        capabilities: &InstalledHelpCapabilities,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationResult, PreviewErrorDto> {
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
        let outcome =
            interpret_preview(operation, &process, &manifest).map_err(interpretation_error)?;
        Ok(OperationResult { outcome })
    }
}

impl PreviewProvider for ProteoWizardProvider {
    fn availability(&self) -> BackendAvailabilityDto {
        let discovery = discover(&DiscoveryRequest { configured: None });
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
        BackendAvailabilityDto {
            state: if usable { "available" } else { "unavailable" }.to_owned(),
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
                        // Only what this version can actually do. MSCanvas has
                        // no way to be pointed at a particular installation
                        // yet, so it does not suggest one.
                        corrective_action:
                            "Install a ProteoWizard release that provides msaccess help, then \
                             check again."
                                .to_owned(),
                    })
                },
                |failure| {
                    Some(BackendFailureDto {
                        kind: failure.kind().to_owned(),
                        summary: failure.summary().to_owned(),
                        corrective_action: failure.corrective_action().to_owned(),
                    })
                },
            ),
        }
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationResult, PreviewErrorDto> {
        let capabilities = self.bind_capabilities()?;
        Self::run_bound(&capabilities, source, operation)
    }

    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationResult>, PreviewErrorDto> {
        let capabilities = self.bind_capabilities()?;
        operations
            .iter()
            .map(|operation| Self::run_bound(&capabilities, source, operation))
            .collect()
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
        // most `MAX_PREVIEW_OUTPUT_BYTES`. A run above that is refused rather
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
            "read {captured_bytes} of {total_bytes} bytes; the limit is {MAX_PREVIEW_OUTPUT_BYTES}"
        )),
        _ => PreviewErrorDto::new(
            identifier,
            "That preview result could not be interpreted.",
            false,
        ),
    }
}

fn unavailable_error(failure: &Option<mscanvas_proteowizard::DiscoveryFailure>) -> PreviewErrorDto {
    failure.as_ref().map_or_else(
        || PreviewErrorDto::new("backend_not_found", "ProteoWizard was not found.", false),
        |failure| PreviewErrorDto::new(failure.kind(), failure.summary(), false),
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
        if !needs_bytes || observed > MAX_PREVIEW_OUTPUT_BYTES {
            entries.push(PreviewOutputEntry::incomplete_file(0, observed));
            continue;
        }
        let Ok((file, opened_length)) = entry.open_in(output_root) else {
            entries.push(PreviewOutputEntry::incomplete_file(0, observed));
            continue;
        };
        if opened_length > MAX_PREVIEW_OUTPUT_BYTES {
            entries.push(PreviewOutputEntry::incomplete_file(
                0,
                opened_length.max(observed),
            ));
            continue;
        }
        let mut bytes = Vec::new();
        let mut reader = std::io::Read::take(file, MAX_PREVIEW_OUTPUT_BYTES + 1);
        if std::io::Read::read_to_end(&mut reader, &mut bytes).is_err() {
            entries.push(PreviewOutputEntry::incomplete_file(0, observed));
            continue;
        }
        let captured = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if captured != observed || captured != opened_length {
            entries.push(PreviewOutputEntry::incomplete_file(
                captured.min(MAX_PREVIEW_OUTPUT_BYTES),
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
