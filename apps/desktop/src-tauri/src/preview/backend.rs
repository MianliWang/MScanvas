//! The provider boundary the preview service talks to.
//!
//! Production work goes through a user-installed ProteoWizard. MSCanvas never
//! bundles, downloads or installs it. Tests substitute a deterministic provider
//! at this boundary so no test needs a local installation.

use std::path::{Path, PathBuf};

use mscanvas_proteowizard::{
    AvailabilityState, DiscoveryRequest, InstalledHelpCapabilities, OutputEntryKind,
    PreviewInterpretError, PreviewOperation, PreviewOutcome, PreviewOutputEntry,
    PreviewOutputManifest, Redactor, build_msaccess_command_with_capabilities, discover, execute,
    interpret_preview, snapshot_output_directory,
};

use super::dto::{BackendAvailabilityDto, BackendFailureDto, PreviewErrorDto};

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

        let process = execute(&command).map_err(|_| {
            PreviewErrorDto::new(
                "backend_launch_failed",
                "The ProteoWizard preview tool could not be started.",
                true,
            )
        })?;

        let manifest = capture_manifest(output_root.path(), operation)?;
        let outcome =
            interpret_preview(operation, &process, &manifest).map_err(interpretation_error)?;
        Ok(OperationResult { outcome })
    }
}

impl PreviewProvider for ProteoWizardProvider {
    fn availability(&self) -> BackendAvailabilityDto {
        let discovery = discover(&DiscoveryRequest { configured: None });
        let available = discovery.availability == AvailabilityState::Available;
        BackendAvailabilityDto {
            state: if available {
                "available"
            } else {
                "unavailable"
            }
            .to_owned(),
            release: discovery.release.clone(),
            build_date: discovery.build_date.clone(),
            same_installation: discovery.same_installation,
            failure: discovery.failure.as_ref().map(|failure| BackendFailureDto {
                kind: failure.kind().to_owned(),
                summary: failure.summary().to_owned(),
                corrective_action: failure.corrective_action().to_owned(),
            }),
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

/// Maps a typed interpretation failure to a displayable error.
///
/// Only stable identifiers cross this boundary: no English backend text is
/// inspected and none is forwarded.
pub fn interpretation_error(error: PreviewInterpretError) -> PreviewErrorDto {
    let described = PreviewErrorDto::new(
        error.stable_id(),
        "That preview result could not be interpreted.",
        false,
    );
    match error {
        PreviewInterpretError::MalformedOutput { kind, .. } => {
            described.with_detail(kind.stable_id())
        }
        _ => described,
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
