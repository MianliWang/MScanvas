//! The one-click view of a Thermo RAW row (ADR 0060, slice 2): the operation's
//! state as the conversion slot holds it, what crosses the boundary about it,
//! and the refusals it answers with.
//!
//! The work itself is `service/raw_view_run.rs`; the cache it fills is
//! `crate::view_cache`. Nothing here names a path, a cache key or an entry: the
//! webview learns a phase, byte counts, a typed code and whether a copy was
//! stored, and nothing else.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use mscanvas_proteowizard::CancellationRequest;
use serde::{Deserialize, Serialize};

use super::dto::PreviewErrorDto;
use super::selection::DatasetId;

/// Decision 9: a RAW larger than this is refused before any work. A
/// heuristic, not a bound: 4 GiB over the larger measured output ratio (2.30)
/// is 1.74 GiB, and the margin is there because two files were measured.
pub(super) const MAX_RAW_BYTES: u64 = 1_610_612_736;

/// Decision 9: a miss needs three times the RAW's size free on the cache's
/// volume, plus this reserve for everything else on it.
pub(super) const FREE_SPACE_RESERVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// The bytes free space must cover for a miss of a RAW this long.
pub(super) const fn bytes_needed_for(raw_bytes: u64) -> u64 {
    raw_bytes
        .saturating_mul(3)
        .saturating_add(FREE_SPACE_RESERVE_BYTES)
}

/// The phases of decision 3, as the running state names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RawViewPhaseDto {
    CheckingSource,
    CheckingCachedCopy,
    Converting,
    CheckingOutput,
    Storing,
}

/// What `get_raw_view_state`, `begin_raw_view` and `cancel_raw_view` answer
/// (decision 12). Polled: there is no event channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RawViewStateDto {
    Idle,
    Running {
        operation: u64,
        handle: String,
        file_name: String,
        phase: RawViewPhaseDto,
        elapsed_ms: u64,
        /// For a checking phase: MSCanvas's own read, so a measured fraction
        /// (decision 3 amends CNV-D8 for the view pane only). `None` while
        /// converting or storing.
        bytes_read: Option<u64>,
        bytes_total: Option<u64>,
        intent_id: String,
        /// Always `None` until ADR 0055's build gate (draft PR #156) lets an
        /// unmeasured build convert a vendor family; such a build is refused
        /// today.
        unverified_build_release: Option<String>,
        /// The cached copy was damaged and was removed, so this press converts
        /// again (decision 8).
        cached_copy_damaged: bool,
    },
    Ready {
        operation: u64,
        handle: String,
        intent_id: String,
        cache_hit: bool,
        unverified_build_release: Option<String>,
        /// Whether `open_raw_view` would open it: the row still holds the
        /// operation's pin. An open, a superseded or failed open, the row's
        /// removal and Clear workspace each end that (decision 12).
        openable: bool,
    },
    Failed {
        operation: u64,
        handle: String,
        intent_id: String,
        code: String,
        message: String,
        retryable: bool,
        /// For `view_cache_no_space`: the space a miss needs, and what was
        /// free, so the pane states both numbers without parsing a message.
        needed_bytes: Option<u64>,
        free_bytes: Option<u64>,
    },
    Cancelled {
        operation: u64,
        handle: String,
        /// Whether this operation published an entry before it ended
        /// (decision 10).
        stored: bool,
    },
}

/// `begin_raw_view`'s request. No intent field: View always converts with
/// `ConversionIntent::SHIPPED`, chosen in Rust (decision 2).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawViewBeginRequestDto {
    pub handle: String,
}

/// `cancel_raw_view`'s and `open_raw_view`'s request: the exact operation.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawViewOperationRequestDto {
    pub operation: u64,
}

/// The Settings row's summary (decision 9).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ViewCacheSummaryDto {
    #[serde(rename_all = "camelCase")]
    Available {
        available: bool,
        entries: usize,
        bytes: u64,
        cap_bytes: u64,
        in_use: usize,
        unrecognized: usize,
    },
    #[serde(rename_all = "camelCase")]
    Unavailable {
        available: bool,
        /// `rootUnresolved`, `rootUnrecognized` or `unreadable`.
        reason: &'static str,
    },
}

/// What Clear view cache did (decision 9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewCacheClearOutcomeDto {
    pub removed: usize,
    pub freed_bytes: u64,
    pub kept_in_use: usize,
    pub failed: usize,
    pub unrecognized_left: usize,
}

/// Where a view operation is, as the conversion slot holds it.
#[derive(Debug)]
pub(super) enum Progress {
    Running {
        phase: RawViewPhaseDto,
        bytes: Option<(u64, u64)>,
        cached_copy_damaged: bool,
    },
    Ready {
        cache_hit: bool,
        /// `open_raw_view` opens a ready operation once.
        opened: bool,
    },
    Failed {
        error: PreviewErrorDto,
        space: Option<(u64, u64)>,
    },
    Cancelled {
        stored: bool,
    },
}

/// One view operation. It holds the conversion slot while it is running
/// (decision 5), and its terminal state stays readable until the next one.
pub(super) struct RawView {
    pub(super) operation: u64,
    pub(super) dataset: DatasetId,
    pub(super) file_name: String,
    pub(super) progress: Progress,
    started: Instant,
    /// Cancel's flag, asked between chunks and between phases.
    cancel: Arc<AtomicBool>,
    /// The conversion's request-only handle while `msconvert` may run.
    conversion: Option<CancellationRequest>,
    /// The work reached a pinned entry with no Cancel before it, so a Cancel
    /// now is a late press (decision 10).
    settled: bool,
}

impl std::fmt::Debug for RawView {
    /// The file name is the user's; it is not rendered.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RawView")
            .field("operation", &self.operation)
            .field("progress", &self.progress)
            .finish_non_exhaustive()
    }
}

/// What a terminal operation reached, as the worker reports it.
pub(super) enum Ended {
    Ready { cache_hit: bool },
    Failed(PreviewErrorDto, Option<(u64, u64)>),
    Cancelled { stored: bool },
}

impl RawView {
    pub(super) fn new(operation: u64, dataset: DatasetId, file_name: String) -> Self {
        Self {
            operation,
            dataset,
            file_name,
            progress: Progress::Running {
                phase: RawViewPhaseDto::CheckingSource,
                bytes: None,
                cached_copy_damaged: false,
            },
            started: Instant::now(),
            cancel: Arc::new(AtomicBool::new(false)),
            conversion: None,
            settled: false,
        }
    }

    pub(super) const fn is_running(&self) -> bool {
        matches!(self.progress, Progress::Running { .. })
    }

    pub(super) fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }

    #[cfg(test)]
    pub(super) fn cancel_requested(&self) -> bool {
        self.cancel.load(Ordering::Acquire)
    }

    /// Records Cancel. A running conversion is asked to end at once; the
    /// worker's own reads stop at the next chunk. Storing is not interrupted:
    /// the worker reads the flag again once it has finished (decision 10).
    /// Once the operation has settled, Cancel changes nothing.
    pub(super) fn request_cancel(&self) {
        if self.settled {
            return;
        }
        self.cancel.store(true, Ordering::Release);
        if let Some(conversion) = &self.conversion {
            conversion.request();
        }
    }

    /// Binds the conversion's handle, asking it at once when Cancel came
    /// first, in the same lock that stores it.
    pub(super) fn bind_conversion(&mut self, request: CancellationRequest) {
        if self.cancel.load(Ordering::Acquire) {
            request.request();
        }
        self.conversion = Some(request);
    }

    pub(super) fn release_conversion(&mut self) {
        self.conversion = None;
    }

    pub(super) fn enter(&mut self, phase: RawViewPhaseDto) {
        if let Progress::Running {
            phase: current,
            bytes,
            ..
        } = &mut self.progress
        {
            *current = phase;
            *bytes = None;
        }
    }

    /// Enters Storing unless a Cancel was accepted first, asked under the slot
    /// lock that Cancel takes: a Cancel before Storing, also one after Checking
    /// output's last chunk, publishes nothing (decision 10).
    pub(super) fn enter_storing(&mut self) -> bool {
        if self.cancel.load(Ordering::Acquire) {
            return false;
        }
        self.enter(RawViewPhaseDto::Storing);
        true
    }

    pub(super) fn note_bytes(&mut self, read: u64, total: u64) {
        if let Progress::Running { bytes, .. } = &mut self.progress {
            *bytes = Some((read, total));
        }
    }

    pub(super) fn note_damaged_copy_removed(&mut self) {
        if let Progress::Running {
            cached_copy_damaged,
            ..
        } = &mut self.progress
        {
            *cached_copy_damaged = true;
        }
    }

    /// Asked under the slot lock once the work has reached a pinned entry:
    /// `false` when a Cancel was accepted first, which then ends the operation
    /// `cancelled` (decision 10); otherwise every later Cancel is a late press.
    pub(super) fn settle(&mut self) -> bool {
        self.settled = !self.cancel.load(Ordering::Acquire);
        self.settled
    }

    pub(super) fn finish(&mut self, ended: Ended) {
        self.conversion = None;
        self.progress = match ended {
            Ended::Ready { cache_hit } => Progress::Ready {
                cache_hit,
                opened: false,
            },
            Ended::Failed(error, space) => Progress::Failed { error, space },
            Ended::Cancelled { stored } => Progress::Cancelled { stored },
        };
    }

    pub(super) fn to_dto(&self) -> RawViewStateDto {
        let operation = self.operation;
        let handle = self.dataset.handle();
        let intent_id = view_intent_id();
        match &self.progress {
            Progress::Running {
                phase,
                bytes,
                cached_copy_damaged,
            } => RawViewStateDto::Running {
                operation,
                handle,
                file_name: self.file_name.clone(),
                phase: *phase,
                elapsed_ms: u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX),
                bytes_read: bytes.map(|(read, _)| read),
                bytes_total: bytes.map(|(_, total)| total),
                intent_id,
                unverified_build_release: None,
                cached_copy_damaged: *cached_copy_damaged,
            },
            // Whether the row still holds the pin is the service's to add.
            Progress::Ready { cache_hit, opened } => RawViewStateDto::Ready {
                operation,
                handle,
                intent_id,
                cache_hit: *cache_hit,
                unverified_build_release: None,
                openable: !*opened,
            },
            Progress::Failed { error, space } => RawViewStateDto::Failed {
                operation,
                handle,
                intent_id,
                code: error.kind.clone(),
                message: error.summary.clone(),
                retryable: error.retryable,
                needed_bytes: space.map(|(needed, _)| needed),
                free_bytes: space.map(|(_, free)| free),
            },
            Progress::Cancelled { stored } => RawViewStateDto::Cancelled {
                operation,
                handle,
                stored: *stored,
            },
        }
    }
}

/// The intent every View converts with, as its stable identifier: the
/// verified default, never a picker (decision 2).
///
/// ponytail: the cache key's intent line is this string, as decision 7 says
/// for today; once `be/integrate` (PR #161) merges, the key takes the
/// structured intent's canonical serialization and the key version changes.
pub(super) fn view_intent_id() -> String {
    mscanvas_proteowizard::ConversionIntent::SHIPPED.stable_id()
}

// ---------------------------------------------------------------------------
// Refusals and failures (decisions 4 and 10)
// ---------------------------------------------------------------------------

pub(super) fn raw_view_busy() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "raw_view_busy",
        "A Thermo RAW file is being prepared for viewing. Wait for it, or cancel it.",
        true,
    )
}

pub(super) fn raw_view_unsupported_source() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "raw_view_unsupported_source",
        "Only a Thermo RAW file can be viewed through the view cache.",
        false,
    )
}

pub(super) fn raw_view_not_ready() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "raw_view_not_ready",
        "That view is no longer ready to open. View the file again.",
        false,
    )
}

pub(super) fn raw_view_source_changed() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "raw_view_source_changed",
        "The RAW file changed while it was being prepared for viewing, so nothing was stored.",
        true,
    )
}

pub(super) fn view_cache_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_unavailable",
        "MSCanvas has no folder for its view cache on this computer.",
        false,
    )
}

pub(super) fn view_cache_root_unrecognized() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_root_unrecognized",
        "A view-cache folder that MSCanvas did not make is in its application data folder. \
         Move or rename it, then View again.",
        false,
    )
}

pub(super) fn view_cache_entry_too_large() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_entry_too_large",
        "This file is too large to view through the cache. Convert it to a folder instead.",
        false,
    )
}

pub(super) fn view_cache_no_space() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_no_space",
        "The drive that holds MSCanvas's application data does not have enough free space \
         to convert this file for viewing.",
        true,
    )
}

pub(super) fn view_cache_entry_unrecognized() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_entry_unrecognized",
        "Something MSCanvas did not make is where this file's cached copy belongs, so \
         MSCanvas left it alone.",
        false,
    )
}

pub(super) fn view_cache_not_stored() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_not_stored",
        "The converted copy could not be stored in the view cache. Nothing was added.",
        true,
    )
}

pub(super) fn view_cache_entry_lost() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_entry_lost",
        "The converted copy was removed from the view cache before it could be checked.",
        true,
    )
}

/// The cache's folders could not be listed, or the free space on its volume
/// could not be read: nothing was removed, and nothing says the disk is full.
pub(super) fn view_cache_unreadable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_unreadable",
        "The view cache could not be read just now. Try again.",
        true,
    )
}

/// What a failed run answers where decision 10 names its own code: the RAW
/// changed while the run used it, or the output is over the 4 GiB document
/// limit. `None` for every other failure, which is the conversion's own.
pub(super) fn run_failure_error(
    failure: &mscanvas_proteowizard::ConversionRunFailure,
) -> Option<PreviewErrorDto> {
    use mscanvas_proteowizard::{
        BackendExecutionFailure, ConversionIntegrityOutcome as Integrity, ConversionRunFailure,
        MzmlLimitKind,
    };
    match failure {
        ConversionRunFailure::SourceChangedBeforeRun
        | ConversionRunFailure::Backend(BackendExecutionFailure::SourceChanged)
        | ConversionRunFailure::OutputRejected(Integrity::SourceChangedDuringConversion) => {
            Some(raw_view_source_changed())
        }
        ConversionRunFailure::OutputRejected(Integrity::LimitExceeded {
            kind: MzmlLimitKind::DocumentBytes,
        }) => Some(view_cache_entry_too_large()),
        _ => None,
    }
}

/// The two cases slice 1 left open, ended before any conversion (dated note
/// of 2026-10-30 in ADR 0060, accepted by the owner): the cached
/// copy could not be checked, or a damaged one could not be removed. Neither
/// is a miss and neither is damage, so nothing is converted.
pub(super) fn view_cache_entry_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "view_cache_entry_unavailable",
        "The cached copy of this file could not be checked or removed just now. Try again.",
        true,
    )
}

#[cfg(test)]
mod tests {
    use mscanvas_proteowizard::{
        BackendExecutionFailure, ConversionIntegrityOutcome as Integrity, ConversionRunFailure,
        MzmlLimitKind,
    };

    use super::{MAX_RAW_BYTES, bytes_needed_for, run_failure_error};

    #[test]
    fn a_run_that_found_the_raw_changed_or_the_output_too_large_answers_decision_10s_codes() {
        let code = |failure: ConversionRunFailure| {
            run_failure_error(&failure).map(|error| (error.kind, error.retryable))
        };
        for changed in [
            ConversionRunFailure::SourceChangedBeforeRun,
            ConversionRunFailure::Backend(BackendExecutionFailure::SourceChanged),
            ConversionRunFailure::OutputRejected(Integrity::SourceChangedDuringConversion),
        ] {
            assert_eq!(
                code(changed),
                Some(("raw_view_source_changed".to_owned(), true))
            );
        }
        assert_eq!(
            code(ConversionRunFailure::OutputRejected(
                Integrity::LimitExceeded {
                    kind: MzmlLimitKind::DocumentBytes,
                }
            )),
            Some(("view_cache_entry_too_large".to_owned(), false))
        );
        // Everything else is the conversion's own failure.
        assert_eq!(
            code(ConversionRunFailure::BackendRejected { exit_code: Some(1) }),
            None
        );
        assert_eq!(
            code(ConversionRunFailure::OutputRejected(
                Integrity::MissingOutput
            )),
            None
        );
    }

    #[test]
    fn the_size_heuristic_and_the_space_rule_are_decision_9s_numbers() {
        assert_eq!(MAX_RAW_BYTES, 1_610_612_736, "1.5 GiB");
        assert_eq!(bytes_needed_for(0), 2 * 1024 * 1024 * 1024);
        assert_eq!(bytes_needed_for(1_000), 3_000 + 2 * 1024 * 1024 * 1024);
        assert_eq!(bytes_needed_for(u64::MAX), u64::MAX);
    }
}
