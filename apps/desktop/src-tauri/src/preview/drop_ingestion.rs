//! Private native Explorer-drop boundary.
//!
//! Paths enter here from Tauri's native window event and never become an IPC
//! value. This module normalizes that event, classifies and expands a bounded
//! mixed batch, and owns the one path-free channel subscriber. Acceptance and
//! authoritative workspace mutation remain in `service`.

use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::Channel;
use tauri::{DragDropEvent, WindowEvent};

use super::discovery::{
    DiscoveryBudget, DiscoveryError, DiscoveryErrorKind, DiscoveryLimit, DiscoveryResult,
    DiscoveryUsage, DropRootInspection, MAX_DISCOVERY_CANDIDATES, MAX_DISCOVERY_DEPTH,
    MAX_DISCOVERY_DIRECTORIES, MAX_DISCOVERY_ENTRIES, discover_mzml_candidates, inspect_drop_root,
};
use super::dto::{
    DropIngestionSummaryDto, DropRejectionReasonDto, DropScanLimitDto, PreviewErrorDto,
    WorkspaceDropStateDto, WorkspaceDropSubscriptionReservationDto, WorkspaceDropUpdateDto,
    invalid_workspace_drop_subscription,
};
use super::selection::FileIdentity;

pub(super) const MAX_DROP_ROOTS: usize = 1_024;

/// The native event reduced to the only facts product behavior consumes.
pub(crate) enum NativeDropSignal<'a> {
    Enter { item_count: usize },
    Over,
    Leave,
    Drop { paths: &'a [PathBuf] },
}

impl fmt::Debug for NativeDropSignal<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Enter { item_count } => formatter
                .debug_struct("Enter")
                .field("item_count", item_count)
                .finish(),
            Self::Over => formatter.write_str("Over"),
            Self::Leave => formatter.write_str("Leave"),
            Self::Drop { paths } => formatter
                .debug_struct("Drop")
                .field("item_count", &paths.len())
                .finish(),
        }
    }
}

/// Normalizes only Tauri's native drag event. The locked stable runtime creates
/// the configured main WebviewWindow as `WindowContent`, for which
/// tauri-runtime-wry 2.11.4 synthesizes `WindowEvent::DragDrop`; the composition
/// root separately enforces the `main` label before calling this adapter.
pub(crate) fn normalize_window_drop_event(event: &WindowEvent) -> Option<NativeDropSignal<'_>> {
    match event {
        WindowEvent::DragDrop(event) => match event {
            DragDropEvent::Enter { paths, .. } => Some(NativeDropSignal::Enter {
                item_count: paths.len(),
            }),
            DragDropEvent::Over { .. } => Some(NativeDropSignal::Over),
            DragDropEvent::Drop { paths, .. } => Some(NativeDropSignal::Drop { paths }),
            DragDropEvent::Leave => Some(NativeDropSignal::Leave),
            _ => None,
        },
        _ => None,
    }
}

/// Accepted native-drop work. Its operation claim and bounded path prefix are
/// deliberately opaque and never serializable; a worker consumes both once.
pub(crate) struct NativeDropWork {
    pub(super) operation_id: DropOperationId,
    pub(super) paths: Vec<PathBuf>,
    pub(super) top_level_item_count: usize,
}

impl NativeDropWork {
    pub(crate) const fn operation_id(&self) -> DropOperationId {
        self.operation_id
    }

    pub(super) fn into_parts(self) -> (DropOperationId, Vec<PathBuf>, usize) {
        (self.operation_id, self.paths, self.top_level_item_count)
    }
}

/// Owned work for the background side of the native callback boundary.
///
/// Hover, leave, and busy messages carry only the atomic claim they observed.
/// That lets the worker discard a stale UI event without ever retaining a
/// rejected drop's paths. Only `Start` owns paths, exactly once, after winning
/// the compare/exchange reservation.
pub(crate) enum NativeDropDispatch {
    Enter {
        item_count: usize,
        event_ticket: u64,
        observed_operation: Option<DropOperationId>,
    },
    Leave {
        event_ticket: u64,
        observed_operation: Option<DropOperationId>,
    },
    Busy {
        observed_claim: DropOperationId,
    },
    Start(NativeDropWork),
}

impl NativeDropDispatch {
    pub(crate) const fn operation_id(&self) -> Option<DropOperationId> {
        match self {
            Self::Start(work) => Some(work.operation_id()),
            Self::Enter { .. } | Self::Leave { .. } | Self::Busy { .. } => None,
        }
    }
}

impl fmt::Debug for NativeDropDispatch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Enter { item_count, .. } => formatter
                .debug_struct("Enter")
                .field("item_count", item_count)
                .finish(),
            Self::Leave { .. } => formatter.write_str("Leave"),
            Self::Busy { .. } => formatter.write_str("Busy"),
            Self::Start(work) => formatter
                .debug_struct("Start")
                .field("item_count", &work.top_level_item_count)
                .finish(),
        }
    }
}

impl fmt::Debug for NativeDropWork {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NativeDropWork")
            .field("item_count", &self.top_level_item_count)
            .finish()
    }
}

/// A decimal, session-scoped correlation value with no filesystem authority.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct DropOperationId(pub(super) u64);

impl DropOperationId {
    pub(super) fn handle(self) -> String {
        self.0.to_string()
    }
}

impl fmt::Debug for DropOperationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<drop-operation-id>")
    }
}

/// One accepted drop's private claim on a workspace generation.
pub(super) struct DropImportToken {
    pub(super) generation: u64,
    pub(super) operation_id: DropOperationId,
    pub(super) workspace_was_empty: bool,
}

impl fmt::Debug for DropImportToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<drop-import-token>")
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct ActiveDrop {
    pub(super) generation: u64,
    pub(super) operation_id: DropOperationId,
}

impl fmt::Debug for ActiveDrop {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<active-drop>")
    }
}

/// Where one candidate came from. Paths remain private in both cases.
pub(super) enum DropCandidateOrigin {
    Direct,
    Folder { relative_parents: Vec<OsString> },
}

impl fmt::Debug for DropCandidateOrigin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Direct => formatter.write_str("Direct"),
            Self::Folder { relative_parents } => formatter
                .debug_struct("Folder")
                .field("relative_depth", &relative_parents.len())
                .finish(),
        }
    }
}

/// One private proposal for acceptance.
pub(super) struct DropCandidate {
    pub(super) path: PathBuf,
    pub(super) observed_identity: FileIdentity,
    pub(super) origin: DropCandidateOrigin,
}

impl fmt::Debug for DropCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-drop-candidate>")
    }
}

pub(super) struct DropBatch {
    pub(super) candidates: Vec<DropCandidate>,
    pub(super) summary: DropIngestionSummary,
}

impl fmt::Debug for DropBatch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DropBatch")
            .field("candidate_count", &self.candidates.len())
            .field("summary", &self.summary)
            .finish()
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct DropIngestionSummary {
    pub(super) top_level_item_count: usize,
    pub(super) skipped_reparse_root_count: u64,
    pub(super) inaccessible_root_count: u64,
    pub(super) remote_root_count: u64,
    pub(super) unsupported_root_count: u64,
    pub(super) skipped_reparse_entry_count: u64,
    pub(super) inaccessible_entry_count: u64,
    limits_reached: Vec<DropScanLimitDto>,
}

impl DropIngestionSummary {
    pub(super) fn record_limit(&mut self, limit: DropScanLimitDto) {
        if !self.limits_reached.contains(&limit) {
            self.limits_reached.push(limit);
            self.limits_reached.sort_unstable();
        }
    }

    pub(super) fn into_dto(self, workspace_was_empty: bool) -> DropIngestionSummaryDto {
        let complete = self.limits_reached.is_empty()
            && self.skipped_reparse_root_count == 0
            && self.inaccessible_root_count == 0
            && self.remote_root_count == 0
            && self.unsupported_root_count == 0
            && self.skipped_reparse_entry_count == 0
            && self.inaccessible_entry_count == 0;
        DropIngestionSummaryDto {
            workspace_was_empty,
            complete,
            top_level_item_count: self.top_level_item_count,
            skipped_reparse_root_count: self.skipped_reparse_root_count,
            inaccessible_root_count: self.inaccessible_root_count,
            remote_root_count: self.remote_root_count,
            unsupported_root_count: self.unsupported_root_count,
            skipped_reparse_entry_count: self.skipped_reparse_entry_count,
            inaccessible_entry_count: self.inaccessible_entry_count,
            limits_reached: self.limits_reached,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct DropBudget {
    pub(super) max_roots: usize,
    pub(super) max_depth: u32,
    pub(super) max_entries: u64,
    pub(super) max_directories: u64,
    pub(super) max_candidates: usize,
}

impl Default for DropBudget {
    fn default() -> Self {
        Self {
            max_roots: MAX_DROP_ROOTS,
            max_depth: MAX_DISCOVERY_DEPTH,
            max_entries: MAX_DISCOVERY_ENTRIES,
            max_directories: MAX_DISCOVERY_DIRECTORIES,
            max_candidates: MAX_DISCOVERY_CANDIDATES,
        }
    }
}

/// Expands a mixed batch in native root order under one shared ledger.
pub(super) fn expand_drop_paths(paths: Vec<PathBuf>) -> Result<DropBatch, PreviewErrorDto> {
    expand_drop_paths_with_budget(paths, DropBudget::default())
}

pub(super) fn expand_drop_paths_with_budget(
    paths: Vec<PathBuf>,
    budget: DropBudget,
) -> Result<DropBatch, PreviewErrorDto> {
    expand_drop_paths_with_budget_using(paths, budget, inspect_drop_root, discover_mzml_candidates)
}

/// Testable seam for proving that all roots share one traversal ledger even
/// when a source fails after doing bounded work. Neither callback crosses the
/// application boundary; production supplies the two native adapters above.
pub(super) fn expand_drop_paths_with_budget_using<I, D>(
    paths: Vec<PathBuf>,
    budget: DropBudget,
    mut inspect_root: I,
    mut discover_root: D,
) -> Result<DropBatch, PreviewErrorDto>
where
    I: FnMut(&Path) -> DropRootInspection,
    D: FnMut(&Path, DiscoveryBudget) -> Result<DiscoveryResult, DiscoveryError>,
{
    let mut summary = DropIngestionSummary {
        top_level_item_count: paths.len(),
        ..DropIngestionSummary::default()
    };
    if paths.len() > budget.max_roots {
        summary.record_limit(DropScanLimitDto::Roots);
    }

    let process_count = paths.len().min(budget.max_roots);
    let mut remaining_entries = budget.max_entries;
    let mut remaining_directories = budget.max_directories;
    let mut remaining_candidates = budget.max_candidates;
    let mut candidates = Vec::with_capacity(remaining_candidates.min(process_count));

    for root in paths.into_iter().take(process_count) {
        if remaining_candidates == 0 {
            summary.record_limit(DropScanLimitDto::Candidates);
            break;
        }

        match inspect_root(&root) {
            DropRootInspection::RegularFile { identity } => {
                candidates.push(DropCandidate {
                    path: root,
                    observed_identity: identity,
                    origin: DropCandidateOrigin::Direct,
                });
                remaining_candidates -= 1;
            }
            DropRootInspection::Directory => {
                if remaining_directories == 0 {
                    summary.record_limit(DropScanLimitDto::Directories);
                    continue;
                }
                if remaining_entries == 0 {
                    summary.record_limit(DropScanLimitDto::Entries);
                    continue;
                }
                let discovered = match discover_root(
                    &root,
                    DiscoveryBudget {
                        max_depth: budget.max_depth,
                        max_entries: remaining_entries,
                        max_directories: remaining_directories,
                        max_candidates: remaining_candidates,
                    },
                ) {
                    Ok(discovered) => discovered,
                    Err(error) => {
                        debit_discovery_usage(
                            error.usage(),
                            &mut remaining_entries,
                            &mut remaining_directories,
                            &mut remaining_candidates,
                        );
                        record_root_error(&mut summary, error.kind())?;
                        continue;
                    }
                };
                let (discovered, discovered_summary, limits) = discovered.into_parts();
                debit_discovery_usage(
                    discovered_summary.usage(),
                    &mut remaining_entries,
                    &mut remaining_directories,
                    &mut remaining_candidates,
                );
                summary.skipped_reparse_entry_count = summary
                    .skipped_reparse_entry_count
                    .checked_add(discovered_summary.skipped_reparse_count)
                    .expect("a bounded drop cannot count more than u64::MAX reparse entries");
                summary.inaccessible_entry_count = summary
                    .inaccessible_entry_count
                    .checked_add(discovered_summary.inaccessible_entry_count)
                    .expect("a bounded drop cannot count more than u64::MAX inaccessible entries");
                for limit in limits {
                    summary.record_limit(discovery_limit_dto(limit));
                }
                candidates.extend(discovered.into_iter().map(|candidate| {
                    let (path, relative, observed_identity) = candidate.into_parts();
                    let relative_parents = relative
                        .split_last()
                        .map(|(_, parents)| parents.to_vec())
                        .unwrap_or_default();
                    DropCandidate {
                        path,
                        observed_identity,
                        origin: DropCandidateOrigin::Folder { relative_parents },
                    }
                }));
            }
            DropRootInspection::Reparse => {
                checked_increment(&mut summary.skipped_reparse_root_count, "reparse roots")
            }
            DropRootInspection::Remote => {
                checked_increment(&mut summary.remote_root_count, "remote roots")
            }
            DropRootInspection::Inaccessible => {
                checked_increment(&mut summary.inaccessible_root_count, "inaccessible roots")
            }
            DropRootInspection::Unsupported => {
                checked_increment(&mut summary.unsupported_root_count, "unsupported roots")
            }
            DropRootInspection::PlatformUnavailable => {
                return Err(drop_ingestion_unavailable());
            }
        }
    }

    Ok(DropBatch {
        candidates,
        summary,
    })
}

fn debit_discovery_usage(
    usage: DiscoveryUsage,
    remaining_entries: &mut u64,
    remaining_directories: &mut u64,
    remaining_candidates: &mut usize,
) {
    *remaining_entries = remaining_entries.saturating_sub(usage.entries_inspected);
    *remaining_directories = remaining_directories.saturating_sub(usage.directories_entered);
    *remaining_candidates = remaining_candidates.saturating_sub(usage.candidates_collected);
}

fn checked_increment(value: &mut u64, noun: &str) {
    *value = value
        .checked_add(1)
        .unwrap_or_else(|| panic!("a bounded drop cannot count more than u64::MAX {noun}"));
}

fn record_root_error(
    summary: &mut DropIngestionSummary,
    kind: DiscoveryErrorKind,
) -> Result<(), PreviewErrorDto> {
    match kind {
        DiscoveryErrorKind::PlatformUnavailable => Err(drop_ingestion_unavailable()),
        DiscoveryErrorKind::RootReparsePoint => {
            checked_increment(&mut summary.skipped_reparse_root_count, "reparse roots");
            Ok(())
        }
        DiscoveryErrorKind::RemoteRootUnsupported => {
            checked_increment(&mut summary.remote_root_count, "remote roots");
            Ok(())
        }
        DiscoveryErrorKind::RootNotDirectory => {
            checked_increment(&mut summary.unsupported_root_count, "unsupported roots");
            Ok(())
        }
        DiscoveryErrorKind::RootUnavailable
        | DiscoveryErrorKind::RootEnumerationFailed
        | DiscoveryErrorKind::FilesystemInvariantFailed => {
            checked_increment(&mut summary.inaccessible_root_count, "inaccessible roots");
            Ok(())
        }
    }
}

fn discovery_limit_dto(limit: DiscoveryLimit) -> DropScanLimitDto {
    match limit {
        DiscoveryLimit::Depth => DropScanLimitDto::Depth,
        DiscoveryLimit::Entries => DropScanLimitDto::Entries,
        DiscoveryLimit::Directories => DropScanLimitDto::Directories,
        DiscoveryLimit::Candidates => DropScanLimitDto::Candidates,
    }
}

fn drop_ingestion_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "drop_ingestion_unavailable",
        "Adding dropped files and folders is available on Windows in this version.",
        false,
    )
}

/// Serializes update publication while allowing every workspace lock to be
/// released before `Channel::send` runs.
pub(super) type DropDeliveryGuard<'a> = MutexGuard<'a, ()>;

pub(super) struct DropUpdateHub {
    delivery: Mutex<()>,
    state: Mutex<DropUpdateState>,
}

impl Default for DropUpdateHub {
    fn default() -> Self {
        Self {
            delivery: Mutex::new(()),
            state: Mutex::new(DropUpdateState::default()),
        }
    }
}

impl fmt::Debug for DropUpdateHub {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<drop-update-hub>")
    }
}

#[derive(Clone)]
struct DropSubscriber {
    id: u64,
    channel: Channel<WorkspaceDropUpdateDto>,
}

impl fmt::Debug for DropSubscriber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<drop-subscriber>")
    }
}

const DROP_SUBSCRIPTION_RESERVATION_PREFIX: &str = "drop-subscription-reservation-";

#[derive(Clone, Copy, PartialEq, Eq)]
struct DropSubscriptionReservationId(u64);

impl DropSubscriptionReservationId {
    fn handle(self) -> String {
        format!("{DROP_SUBSCRIPTION_RESERVATION_PREFIX}{}", self.0)
    }

    fn parse(handle: &str) -> Option<Self> {
        let id = Self(
            handle
                .strip_prefix(DROP_SUBSCRIPTION_RESERVATION_PREFIX)?
                .parse()
                .ok()?,
        );
        (id.handle() == handle).then_some(id)
    }
}

impl fmt::Debug for DropSubscriptionReservationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<drop-subscription-reservation-id>")
    }
}

struct PendingDropSubscription {
    reservation_id: DropSubscriptionReservationId,
    document_epoch: u64,
}

impl fmt::Debug for PendingDropSubscription {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<pending-drop-subscription>")
    }
}

struct DropUpdateState {
    next_sequence: u64,
    next_subscriber_id: u64,
    next_subscription_reservation: u64,
    document_epoch: u64,
    current: WorkspaceDropStateDto,
    pending_subscription: Option<PendingDropSubscription>,
    subscriber: Option<DropSubscriber>,
}

impl Default for DropUpdateState {
    fn default() -> Self {
        Self {
            next_sequence: 0,
            next_subscriber_id: 0,
            next_subscription_reservation: 0,
            document_epoch: 0,
            current: WorkspaceDropStateDto::Idle,
            pending_subscription: None,
            subscriber: None,
        }
    }
}

impl DropUpdateHub {
    pub(super) fn begin_delivery(&self) -> DropDeliveryGuard<'_> {
        self.delivery
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Begins one bounded, current-document subscription claim without
    /// accepting a Channel. Repeating Begin before Claim returns the same
    /// reservation, so an old delayed Begin cannot replace a newer pending
    /// claim from the same document epoch.
    pub(super) fn begin_subscription(&self) -> WorkspaceDropSubscriptionReservationDto {
        let _delivery = self.begin_delivery();
        let mut state = self.state();
        if let Some(reservation_id) = state
            .pending_subscription
            .as_ref()
            .filter(|pending| pending.document_epoch == state.document_epoch)
            .map(|pending| pending.reservation_id)
        {
            return WorkspaceDropSubscriptionReservationDto {
                reservation_id: reservation_id.handle(),
            };
        }

        let reservation_id = state.allocate_subscription_reservation();
        let document_epoch = state.document_epoch;
        state.pending_subscription = Some(PendingDropSubscription {
            reservation_id,
            document_epoch,
        });
        WorkspaceDropSubscriptionReservationDto {
            reservation_id: reservation_id.handle(),
        }
    }

    /// Consumes one exact current-document reservation before replacing the
    /// subscriber. A wrong, replayed or old-document handle neither installs a
    /// Channel nor consumes the one valid pending slot.
    pub(super) fn claim_subscription(
        &self,
        reservation_id: &str,
        channel: Channel<WorkspaceDropUpdateDto>,
    ) -> Result<(), PreviewErrorDto> {
        let requested = DropSubscriptionReservationId::parse(reservation_id)
            .ok_or_else(invalid_workspace_drop_subscription)?;
        let delivery = self.begin_delivery();
        let subscriber = {
            let mut state = self.state();
            let matches = state.pending_subscription.as_ref().is_some_and(|pending| {
                pending.reservation_id == requested
                    && pending.document_epoch == state.document_epoch
            });
            if !matches {
                return Err(invalid_workspace_drop_subscription());
            }
            state.pending_subscription = None;
            let id = state.next_subscriber_id;
            state.next_subscriber_id = state
                .next_subscriber_id
                .checked_add(1)
                .expect("a session cannot install more than u64::MAX drop subscribers");
            let subscriber = DropSubscriber { id, channel };
            state.subscriber = Some(subscriber.clone());
            subscriber
        };
        self.publish_current_to(delivery, subscriber);
        Ok(())
    }

    pub(super) fn publish_persistent(
        &self,
        delivery: DropDeliveryGuard<'_>,
        state: WorkspaceDropStateDto,
    ) {
        self.publish_persistent_locked(&delivery, state);
    }

    /// Publishes importing before any busy notices registered while its worker
    /// was waiting to establish that replayable state.
    pub(super) fn publish_importing_with_busy(
        &self,
        delivery: DropDeliveryGuard<'_>,
        state: WorkspaceDropStateDto,
        pending_busy: bool,
    ) {
        self.publish_persistent_locked(&delivery, state);
        if pending_busy {
            self.publish_transient_locked(&delivery, drop_busy_state());
        }
    }

    /// Drains the bounded, coalesced rejection before the operation's terminal
    /// lifecycle state, all under one delivery order.
    pub(super) fn publish_terminal_with_busy(
        &self,
        delivery: DropDeliveryGuard<'_>,
        pending_busy: bool,
        state: WorkspaceDropStateDto,
    ) {
        if pending_busy {
            self.publish_transient_locked(&delivery, drop_busy_state());
        }
        self.publish_persistent_locked(&delivery, state);
    }

    fn publish_persistent_locked(
        &self,
        delivery: &DropDeliveryGuard<'_>,
        state: WorkspaceDropStateDto,
    ) {
        let subscriber = {
            let mut current = self.state();
            current.current = state.clone();
            let update = current.next_update(state);
            current
                .subscriber
                .clone()
                .map(|subscriber| (subscriber, update, current.document_epoch))
        };
        self.send(delivery, subscriber);
    }

    /// Sends a one-shot notice without replacing the replayable lifecycle
    /// snapshot. In particular, `drop_busy` never hides the active importing
    /// state from a replacement subscriber.
    pub(super) fn publish_transient(
        &self,
        delivery: DropDeliveryGuard<'_>,
        state: WorkspaceDropStateDto,
    ) {
        self.publish_transient_locked(&delivery, state);
    }

    fn publish_transient_locked(
        &self,
        delivery: &DropDeliveryGuard<'_>,
        state: WorkspaceDropStateDto,
    ) {
        let subscriber = {
            let mut current = self.state();
            let update = current.next_update(state);
            current
                .subscriber
                .clone()
                .map(|subscriber| (subscriber, update, current.document_epoch))
        };
        self.send(delivery, subscriber);
    }

    pub(super) fn reset_document(&self, _delivery: DropDeliveryGuard<'_>) {
        let mut state = self.state();
        state.document_epoch = state
            .document_epoch
            .checked_add(1)
            .expect("a session cannot load more than u64::MAX webview documents");
        state.current = WorkspaceDropStateDto::Idle;
        state.pending_subscription = None;
        state.subscriber = None;
    }

    fn publish_current_to(&self, delivery: DropDeliveryGuard<'_>, subscriber: DropSubscriber) {
        let message = {
            let mut state = self.state();
            let current = state.current.clone();
            let update = state.next_update(current);
            Some((subscriber, update, state.document_epoch))
        };
        self.send(&delivery, message);
    }

    fn send(
        &self,
        _delivery: &DropDeliveryGuard<'_>,
        message: Option<(DropSubscriber, WorkspaceDropUpdateDto, u64)>,
    ) {
        let Some((subscriber, update, document_epoch)) = message else {
            return;
        };
        if subscriber.channel.send(update).is_err() {
            let mut state = self.state();
            if state.document_epoch == document_epoch
                && state
                    .subscriber
                    .as_ref()
                    .is_some_and(|current| current.id == subscriber.id)
            {
                state.subscriber = None;
            }
        }
    }

    fn state(&self) -> MutexGuard<'_, DropUpdateState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl DropUpdateState {
    fn allocate_subscription_reservation(&mut self) -> DropSubscriptionReservationId {
        let reservation = DropSubscriptionReservationId(self.next_subscription_reservation);
        self.next_subscription_reservation = self
            .next_subscription_reservation
            .checked_add(1)
            .expect("a session cannot begin more than u64::MAX drop subscriptions");
        reservation
    }

    fn next_update(&mut self, state: WorkspaceDropStateDto) -> WorkspaceDropUpdateDto {
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .expect("a session cannot publish more than u64::MAX drop updates");
        WorkspaceDropUpdateDto {
            sequence: self.next_sequence,
            state,
        }
    }
}

pub(super) const fn drop_busy_state() -> WorkspaceDropStateDto {
    WorkspaceDropStateDto::Rejected {
        reason: DropRejectionReasonDto::DropBusy,
    }
}
