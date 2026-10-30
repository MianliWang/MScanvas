//! Feeds the conversion run history (RUN-007, ADR 0065) from the queue.
//!
//! Every call here is made with no slot, workspace or mutation lock held, and
//! none of them can change what the conversion does: a run history that cannot
//! write says so on its own list and nothing else.

use std::sync::Arc;

use mscanvas_proteowizard::InstalledHelpCapabilities;

use super::super::backend::backend_label;
use super::super::conversion::{
    conversion_source_kind, settings_unverified, unverified_build_release,
};
use super::super::dto::{
    ConversionAttemptResultDto, ConversionQueueItemDto, ConversionQueueTerminalReasonDto,
    ConversionValidationDto, WorkspaceConversionStateDto, WorkspaceConversionUpdateDto,
};
use super::super::selection::source_kind_dto;
use super::PreviewService;
use crate::run_history::{
    ConversionHistory, ItemProgress, ItemSource, OutputChecks, RunOutput, RunProgress, RunSettings,
    RunStart, RunState, SourceMember,
};

impl PreviewService {
    /// Gives this session a run history. Set once, at start; a second call is
    /// ignored.
    pub(crate) fn attach_run_history(&self, history: Arc<ConversionHistory>) {
        let _ = self.run_history.set(history);
    }

    /// Starts the record of `operation`'s run, or reopens it for a retry pass,
    /// once the pass has bound a build. A queue refused before that ran
    /// nothing and is not recorded.
    pub(super) fn record_run_start(
        &self,
        operation: u64,
        capabilities: &InstalledHelpCapabilities,
    ) {
        let Some(history) = self.run_history.get() else {
            return;
        };
        let Some(queue) = self.conversion_slot().running(operation) else {
            return;
        };
        let update = self.conversion_state();
        let Some(progress) = run_progress(operation, &update) else {
            return;
        };
        let intent = queue.intent();
        let items = {
            let workspace = self.workspace();
            queue
                .items()
                .iter()
                .map(|item| {
                    let family = conversion_source_kind(item.kind());
                    // The row the queue was bound from, as admission recorded
                    // it. A queue holds its rows, so this is that object.
                    let members = workspace
                        .registry
                        .get(item.dataset())
                        .map(|dataset| {
                            let file = dataset.file();
                            std::iter::once(member(
                                file.path(),
                                file.byte_length(),
                                file.identity().as_pair(),
                            ))
                            .chain(file.companions().iter().map(|companion| {
                                member(
                                    companion.path(),
                                    companion.byte_length(),
                                    companion.identity().as_pair(),
                                )
                            }))
                            .collect::<Option<Vec<_>>>()
                            .unwrap_or_default()
                        })
                        .unwrap_or_default();
                    ItemSource {
                        family: wire_id(&source_kind_dto(item.kind())),
                        display_name: item.file_name().to_owned(),
                        members,
                        destination: queue
                            .destination_for(item.dataset())
                            .and_then(|admitted| admitted.root().to_str())
                            .map(str::to_owned),
                        settings_verified: !settings_unverified(intent, family, capabilities),
                        build_verified: unverified_build_release(capabilities, family).is_none(),
                    }
                })
                .collect()
        };
        let start = RunStart {
            settings: RunSettings {
                row: intent.row().map(|row| row.stable_id()),
                intent: serde_json::to_value(intent.canonical()).unwrap_or(serde_json::Value::Null),
            },
            build_release: capabilities
                .provider_build()
                .map(|build| backend_label(build.release())),
            conflict_policy: wire_id(&queue.conflict()),
            items,
        };
        history.begin(operation, start, progress);
    }

    /// Records what `update` says about `operation`'s run, if it is being
    /// recorded.
    pub(super) fn record_run_progress(
        &self,
        operation: u64,
        update: &WorkspaceConversionUpdateDto,
    ) {
        if let Some(history) = self.run_history.get()
            && let Some(progress) = run_progress(operation, update)
        {
            history.update(operation, progress);
        }
    }
}

/// A path that cannot be written down as itself is not written down at all.
fn member(
    path: &std::path::Path,
    byte_length: u64,
    identity: (u64, [u8; 16]),
) -> Option<SourceMember> {
    Some(SourceMember {
        path: path.to_str()?.to_owned(),
        byte_length,
        volume_serial: identity.0,
        file_id: identity
            .1
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    })
}

/// A closed enumeration's own wire spelling, so a record and the interface
/// never disagree about a name.
fn wire_id(value: &impl serde::Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// The run as the authoritative read describes it, if that read is about
/// `operation` and the queue has started.
fn run_progress(operation: u64, update: &WorkspaceConversionUpdateDto) -> Option<RunProgress> {
    let (id, queue, state) = match &update.state {
        WorkspaceConversionStateDto::Running {
            operation_id,
            queue,
        }
        | WorkspaceConversionStateDto::Stopping {
            operation_id,
            queue,
        } => (operation_id, queue, RunState::Running),
        WorkspaceConversionStateDto::Terminal {
            operation_id,
            reason,
            queue,
        } => (
            operation_id,
            queue,
            match reason {
                ConversionQueueTerminalReasonDto::Completed => RunState::Completed,
                ConversionQueueTerminalReasonDto::Stopped => RunState::Stopped,
                ConversionQueueTerminalReasonDto::StopFailed => RunState::StopFailed,
            },
        ),
        WorkspaceConversionStateDto::Idle
        | WorkspaceConversionStateDto::AwaitingDestination { .. } => return None,
    };
    if *id != operation.to_string() {
        return None;
    }
    Some(RunProgress {
        state,
        passes: queue.retry_round.saturating_add(1),
        failure: queue.error.as_ref().map(|error| error.kind.clone()),
        items: queue.items.iter().map(item_progress).collect(),
    })
}

/// Stable identifiers and measurements only: an error's `kind` and never its
/// sentences, and nothing a backend wrote.
fn item_progress(item: &ConversionQueueItemDto) -> ItemProgress {
    let (outcome, failure, outputs) = match &item.result {
        Some(ConversionAttemptResultDto::Single { report }) => (
            Some(report.outcome.clone()),
            report.detailed_outcome.clone(),
            report
                .output_file_name
                .iter()
                .map(|file_name| RunOutput {
                    file_name: file_name.clone(),
                    state: None,
                    byte_length: report.output.as_ref().map(|output| output.byte_length),
                    sha256: report.output.as_ref().map(|output| output.sha256.clone()),
                    checks: report.validation.as_ref().map(checks),
                })
                .collect(),
        ),
        Some(ConversionAttemptResultDto::OutputSet { report }) => (
            Some(report.group_outcome.clone()),
            report.detailed_outcome.clone(),
            report
                .members
                .iter()
                .map(|member| RunOutput {
                    file_name: member.file_name.clone(),
                    state: Some(member.state.to_owned()),
                    byte_length: member.output.as_ref().map(|output| output.byte_length),
                    sha256: member.output.as_ref().map(|output| output.sha256.clone()),
                    checks: member.validation.as_ref().map(checks),
                })
                .collect(),
        ),
        None => (None, None, Vec::new()),
    };
    ItemProgress {
        state: wire_id(&item.state),
        attempts: item.attempts,
        outcome,
        failure: item
            .error
            .as_ref()
            .map(|error| error.kind.clone())
            .or(failure),
        outputs,
    }
}

fn checks(validation: &ConversionValidationDto) -> OutputChecks {
    OutputChecks {
        mode: wire_id(&validation.mode),
        fully_verified: validation.fully_verified,
        verified: validation.verified.clone(),
        unverified: validation.unverified.clone(),
        inapplicable: validation.inapplicable.clone(),
        advisory: validation.advisory.clone(),
    }
}
