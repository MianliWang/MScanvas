use crate::{BackendTool, ProcessError, ProcessOutput};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    BackendNotFound,
    MsConvertMissing,
    MsAccessMissing,
    VersionProbeFailed,
    BackendLaunchFailed,
    UnsupportedInput,
    SourceValidationFailed,
    PermissionDenied,
    OutputConflict,
    UnwritableOutputDirectory,
    BackendNonZeroExit,
    MalformedParseOutput,
    Cancelled,
    PartialOutputPresent,
    UnexpectedInternalError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureCondition {
    PartialOutputPresent,
}

impl FailureKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::BackendNotFound => "backend_not_found",
            Self::MsConvertMissing => "msconvert_missing",
            Self::MsAccessMissing => "msaccess_missing",
            Self::VersionProbeFailed => "version_probe_failed",
            Self::BackendLaunchFailed => "backend_launch_failed",
            Self::UnsupportedInput => "unsupported_input",
            Self::SourceValidationFailed => "source_validation_failed",
            Self::PermissionDenied => "permission_denied",
            Self::OutputConflict => "output_conflict",
            Self::UnwritableOutputDirectory => "unwritable_output_directory",
            Self::BackendNonZeroExit => "backend_non_zero_exit",
            Self::MalformedParseOutput => "malformed_parse_output",
            Self::Cancelled => "cancelled",
            Self::PartialOutputPresent => "partial_output_present",
            Self::UnexpectedInternalError => "unexpected_internal_error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retryability {
    Retryable,
    AfterCorrection,
    NotRetryable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedFailure {
    pub kind: FailureKind,
    pub summary: &'static str,
    pub technical_detail: String,
    pub retryability: Retryability,
    pub suggested_action: &'static str,
    pub conditions: Vec<FailureCondition>,
}

impl NormalizedFailure {
    #[must_use]
    pub fn new(kind: FailureKind, technical_detail: impl Into<String>) -> Self {
        let (summary, retryability, suggested_action) = failure_contract(kind);
        Self {
            kind,
            summary,
            technical_detail: technical_detail.into(),
            retryability,
            suggested_action,
            conditions: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_condition(mut self, condition: FailureCondition) -> Self {
        if !self.conditions.contains(&condition) {
            self.conditions.push(condition);
        }
        self
    }
}

#[must_use]
pub fn classify_process_failure(
    tool: BackendTool,
    result: Result<&ProcessOutput, &ProcessError>,
    partial_output_present: bool,
) -> Option<NormalizedFailure> {
    let output = match result {
        Ok(output) => output,
        Err(error) => {
            let kind = match error {
                ProcessError::OutputDestinationExists
                | ProcessError::OutputDirectoryNotEmpty
                | ProcessError::OutputDirectoryInsideDirectoryInput => FailureKind::OutputConflict,
                ProcessError::OutputDestinationInspectionFailed {
                    kind: std::io::ErrorKind::PermissionDenied,
                }
                | ProcessError::OutputDirectoryInspectionFailed {
                    kind: std::io::ErrorKind::PermissionDenied,
                } => FailureKind::PermissionDenied,
                ProcessError::OutputDestinationInspectionFailed { .. }
                | ProcessError::OutputDirectoryInspectionFailed { .. } => {
                    FailureKind::UnwritableOutputDirectory
                }
                ProcessError::ExecutableIdentityInspectionFailed {
                    kind: std::io::ErrorKind::NotFound,
                } => match tool {
                    BackendTool::MsConvert => FailureKind::MsConvertMissing,
                    BackendTool::MsAccess => FailureKind::MsAccessMissing,
                },
                ProcessError::ExecutableIdentityInspectionFailed {
                    kind: std::io::ErrorKind::PermissionDenied,
                } => FailureKind::PermissionDenied,
                ProcessError::ExecutableIdentityInspectionFailed { .. }
                | ProcessError::ExecutableIdentityChanged => FailureKind::BackendLaunchFailed,
                ProcessError::SourceIdentityInspectionFailed {
                    kind: std::io::ErrorKind::PermissionDenied,
                } => FailureKind::PermissionDenied,
                ProcessError::SourceIdentityInspectionFailed { .. }
                | ProcessError::SourceIdentityChanged => FailureKind::SourceValidationFailed,
                ProcessError::Launch { kind, .. } if kind.is_not_found() => match tool {
                    BackendTool::MsConvert => FailureKind::MsConvertMissing,
                    BackendTool::MsAccess => FailureKind::MsAccessMissing,
                },
                ProcessError::Launch { kind, .. } if kind.is_permission_denied() => {
                    FailureKind::PermissionDenied
                }
                ProcessError::Launch { .. } => FailureKind::BackendLaunchFailed,
                _ => FailureKind::UnexpectedInternalError,
            };
            let failure = NormalizedFailure::new(kind, error.to_string());
            return Some(add_partial_condition(failure, partial_output_present));
        }
    };

    if output.termination.is_cancellation() {
        let failure = NormalizedFailure::new(
            FailureKind::Cancelled,
            "The owned backend process was terminated after cancellation.",
        );
        return Some(add_partial_condition(failure, partial_output_present));
    }
    if output.success() {
        return partial_output_present.then(|| {
            NormalizedFailure::new(
                FailureKind::PartialOutputPresent,
                "Output was present despite the operation not producing a finalized result.",
            )
            .with_condition(FailureCondition::PartialOutputPresent)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = format!("stdout: {stdout}\nstderr: {stderr}");
    // Installed stderr wording and locale have not yet been measured. Keep the
    // stable primary kind conservative instead of treating English fragments
    // as authoritative semantic classification.
    let failure = NormalizedFailure::new(FailureKind::BackendNonZeroExit, detail);
    Some(add_partial_condition(failure, partial_output_present))
}

fn add_partial_condition(
    failure: NormalizedFailure,
    partial_output_present: bool,
) -> NormalizedFailure {
    if partial_output_present {
        failure.with_condition(FailureCondition::PartialOutputPresent)
    } else {
        failure
    }
}

const fn failure_contract(kind: FailureKind) -> (&'static str, Retryability, &'static str) {
    match kind {
        FailureKind::BackendNotFound => (
            "ProteoWizard is not available.",
            Retryability::AfterCorrection,
            "Install a licensed ProteoWizard build or select its installation folder.",
        ),
        FailureKind::MsConvertMissing => (
            "The ProteoWizard converter is missing.",
            Retryability::AfterCorrection,
            "Select an installation containing msconvert and msaccess from the same build.",
        ),
        FailureKind::MsAccessMissing => (
            "The ProteoWizard preview tool is missing.",
            Retryability::AfterCorrection,
            "Select an installation containing msconvert and msaccess from the same build.",
        ),
        FailureKind::VersionProbeFailed => (
            "ProteoWizard did not complete its version self-test.",
            Retryability::AfterCorrection,
            "Check the selected installation and its vendor runtime prerequisites.",
        ),
        FailureKind::BackendLaunchFailed => (
            "ProteoWizard could not be started.",
            Retryability::AfterCorrection,
            "Check the executable, Windows runtime, and installation, then retry.",
        ),
        FailureKind::UnsupportedInput => (
            "ProteoWizard cannot read this input.",
            Retryability::NotRetryable,
            "Confirm the acquisition format and that the licensed vendor reader is installed.",
        ),
        FailureKind::SourceValidationFailed => (
            "The source acquisition changed after planning.",
            Retryability::AfterCorrection,
            "Reselect an unchanged readable source acquisition and create a fresh operation plan.",
        ),
        FailureKind::PermissionDenied => (
            "Windows denied access to a required path.",
            Retryability::AfterCorrection,
            "Choose readable input and a writable output folder, then retry.",
        ),
        FailureKind::OutputConflict => (
            "The requested output location conflicts with existing or source data.",
            Retryability::AfterCorrection,
            "Choose an unused output name or an empty output folder outside the source acquisition, then retry.",
        ),
        FailureKind::UnwritableOutputDirectory => (
            "ProteoWizard cannot write to the output folder.",
            Retryability::AfterCorrection,
            "Choose an existing writable output folder and retry.",
        ),
        FailureKind::BackendNonZeroExit => (
            "ProteoWizard stopped with an error.",
            Retryability::Retryable,
            "Review the technical detail, correct the input or settings, and retry.",
        ),
        FailureKind::MalformedParseOutput => (
            "ProteoWizard returned output that MSCanvas could not interpret.",
            Retryability::NotRetryable,
            "Keep the diagnostic detail and report the backend build and operation.",
        ),
        FailureKind::Cancelled => (
            "The operation was cancelled.",
            Retryability::Retryable,
            "Retry when ready; inspect any reported partial output first.",
        ),
        FailureKind::PartialOutputPresent => (
            "The operation left an incomplete output.",
            Retryability::AfterCorrection,
            "Keep source data unchanged and explicitly remove or relocate the partial output.",
        ),
        FailureKind::UnexpectedInternalError => (
            "MSCanvas could not supervise the backend operation.",
            Retryability::Retryable,
            "Keep the diagnostic detail and retry after checking the backend installation.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::Termination;

    fn failed_output(stderr: &str) -> ProcessOutput {
        ProcessOutput {
            stdout: Vec::new(),
            stderr: stderr.as_bytes().to_vec(),
            stdout_total_bytes: 0,
            stderr_total_bytes: stderr.len() as u64,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(1),
            elapsed: Duration::from_millis(4),
            termination: Termination::Exited,
            max_active_processes: None,
            final_active_processes: None,
            peak_job_memory_bytes: None,
        }
    }

    /// Both cancellation shapes classify the same way here.
    ///
    /// A run refused before it launched has no exit code, so a classifier that
    /// asked only about `Cancelled` would let it fall through to the exit-code
    /// path and report a backend failure for a backend that never ran.
    #[test]
    fn cancellation_is_not_classified_as_failure() {
        for termination in [Termination::Cancelled, Termination::NotStarted] {
            let output = ProcessOutput {
                termination,
                ..failed_output("")
            };
            let failure = classify_process_failure(BackendTool::MsConvert, Ok(&output), false)
                .expect("cancelled classification");
            assert_eq!(failure.kind, FailureKind::Cancelled, "{termination:?}");
            assert_eq!(
                failure.retryability,
                Retryability::Retryable,
                "{termination:?}"
            );
        }
    }

    #[test]
    fn unverified_stderr_wording_stays_a_generic_non_zero_exit() {
        let conflict = failed_output("output file already exists");
        assert_eq!(
            classify_process_failure(BackendTool::MsConvert, Ok(&conflict), false)
                .expect("conflict classification")
                .kind,
            FailureKind::BackendNonZeroExit
        );
    }

    #[test]
    fn failed_launch_has_a_stable_non_missing_category() {
        let error = ProcessError::Launch {
            executable: "<backend>".to_owned(),
            kind: crate::LaunchFailureKind::Other,
            detail: "runtime initialization failed".to_owned(),
        };
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("launch failure classification");
        assert_eq!(failure.kind, FailureKind::BackendLaunchFailed);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn changed_executable_identity_has_a_stable_launch_category() {
        let error = ProcessError::ExecutableIdentityChanged;
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("executable identity classification");

        assert_eq!(failure.kind, FailureKind::BackendLaunchFailed);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn missing_validated_executable_retains_the_tool_specific_category() {
        let error = ProcessError::ExecutableIdentityInspectionFailed {
            kind: std::io::ErrorKind::NotFound,
        };
        let failure = classify_process_failure(BackendTool::MsAccess, Err(&error), false)
            .expect("missing validated executable classification");

        assert_eq!(failure.kind, FailureKind::MsAccessMissing);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn changed_or_missing_sources_have_a_stable_validation_category() {
        for error in [
            ProcessError::SourceIdentityChanged,
            ProcessError::SourceIdentityInspectionFailed {
                kind: std::io::ErrorKind::NotFound,
            },
        ] {
            let failure = classify_process_failure(BackendTool::MsAccess, Err(&error), false)
                .expect("source validation classification");

            assert_eq!(failure.kind, FailureKind::SourceValidationFailed);
            assert_eq!(failure.retryability, Retryability::AfterCorrection);
        }
    }

    #[test]
    fn source_identity_permission_errors_remain_permission_denied() {
        let error = ProcessError::SourceIdentityInspectionFailed {
            kind: std::io::ErrorKind::PermissionDenied,
        };
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("source permission classification");

        assert_eq!(failure.kind, FailureKind::PermissionDenied);
    }

    #[test]
    fn exact_destination_conflicts_have_a_stable_output_category() {
        let error = ProcessError::OutputDestinationExists;
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("output conflict classification");

        assert_eq!(failure.kind, FailureKind::OutputConflict);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn stale_preview_directories_have_a_stable_output_category() {
        let error = ProcessError::OutputDirectoryNotEmpty;
        let failure = classify_process_failure(BackendTool::MsAccess, Err(&error), false)
            .expect("preview output conflict classification");

        assert_eq!(failure.kind, FailureKind::OutputConflict);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn unsafe_source_boundaries_have_a_stable_output_category() {
        let error = ProcessError::OutputDirectoryInsideDirectoryInput;
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("output boundary classification");

        assert_eq!(failure.kind, FailureKind::OutputConflict);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn destination_inspection_permission_errors_remain_permission_denied() {
        let error = ProcessError::OutputDestinationInspectionFailed {
            kind: std::io::ErrorKind::PermissionDenied,
        };
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("permission classification");

        assert_eq!(failure.kind, FailureKind::PermissionDenied);
    }

    #[test]
    fn preview_directory_permission_errors_remain_permission_denied() {
        let error = ProcessError::OutputDirectoryInspectionFailed {
            kind: std::io::ErrorKind::PermissionDenied,
        };
        let failure = classify_process_failure(BackendTool::MsAccess, Err(&error), false)
            .expect("preview permission classification");

        assert_eq!(failure.kind, FailureKind::PermissionDenied);
    }

    #[test]
    fn missing_destination_parents_are_recoverable_output_errors() {
        let error = ProcessError::OutputDestinationInspectionFailed {
            kind: std::io::ErrorKind::NotFound,
        };
        let failure = classify_process_failure(BackendTool::MsConvert, Err(&error), false)
            .expect("output inspection classification");

        assert_eq!(failure.kind, FailureKind::UnwritableOutputDirectory);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn missing_preview_output_roots_are_recoverable_output_errors() {
        let error = ProcessError::OutputDirectoryInspectionFailed {
            kind: std::io::ErrorKind::NotFound,
        };
        let failure = classify_process_failure(BackendTool::MsAccess, Err(&error), false)
            .expect("preview output inspection classification");

        assert_eq!(failure.kind, FailureKind::UnwritableOutputDirectory);
        assert_eq!(failure.retryability, Retryability::AfterCorrection);
    }

    #[test]
    fn every_spike_failure_kind_has_a_complete_user_contract() {
        let kinds = [
            FailureKind::BackendNotFound,
            FailureKind::MsConvertMissing,
            FailureKind::MsAccessMissing,
            FailureKind::VersionProbeFailed,
            FailureKind::BackendLaunchFailed,
            FailureKind::UnsupportedInput,
            FailureKind::SourceValidationFailed,
            FailureKind::PermissionDenied,
            FailureKind::OutputConflict,
            FailureKind::UnwritableOutputDirectory,
            FailureKind::BackendNonZeroExit,
            FailureKind::MalformedParseOutput,
            FailureKind::Cancelled,
            FailureKind::PartialOutputPresent,
            FailureKind::UnexpectedInternalError,
        ];

        for kind in kinds {
            let failure = NormalizedFailure::new(kind, "technical detail");
            assert!(!kind.stable_id().is_empty());
            assert!(!failure.summary.is_empty());
            assert!(!failure.technical_detail.is_empty());
            assert!(!failure.suggested_action.is_empty());
        }
    }

    #[test]
    fn partial_output_is_preserved_without_erasing_the_primary_cause() {
        let output = failed_output("unsupported format");
        let failure = classify_process_failure(BackendTool::MsConvert, Ok(&output), true)
            .expect("partial output classification");
        assert_eq!(failure.kind, FailureKind::BackendNonZeroExit);
        assert_eq!(
            failure.conditions,
            vec![FailureCondition::PartialOutputPresent]
        );
    }
}
