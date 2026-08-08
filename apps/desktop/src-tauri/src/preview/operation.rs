//! The session's one conversion queue.
//!
//! One queue, bounded and ordered, replacing the single slot this evolved from
//! rather than sitting beside it. A single-dataset conversion is a queue of one,
//! so there is one protocol and one state machine; a second queue asked for
//! while one is under way is refused, not appended to.
//!
//! It is not a job system and is shaped so it cannot become one. There is no
//! persistence, no scheduler and no priority. What it holds is one ordered list
//! of datasets, the destination they all go to, and the latest result of each —
//! replaced whole by the next queue.
//!
//! One queue-level stop was added on top of that, and deliberately nothing
//! narrower: it asks the running attempt to end and refuses to begin any item
//! after it. There is no per-item cancellation, no pause and no resume, because
//! each of those is a different promise about work already done.
//!
//! It exists because a conversion outlives the request that started it. The
//! webview can reload at any point, and Tauri dispatches Windows invokes as
//! independent fetches, so the reply to the command that started a queue is not
//! a reliable place to learn how it went. Rust holds the answer instead, and the
//! interface reads it — on mount, and again while something is running.

use std::fmt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use mscanvas_proteowizard::{
    CancellationFailure, CancellationReport, CancellationRequest, StagingResidue, Termination,
};

use super::destination::DestinationIdentity;
use super::dto::{
    ConversionCancellationDto, ConversionConflictPolicyDto, ConversionQueueDto,
    ConversionQueueItemDto, ConversionQueueItemStateDto, ConversionQueueTerminalReasonDto,
    MAX_CONVERSION_QUEUE_ITEMS, PreviewErrorDto, SelectedFileDto,
    WorkspaceConversionReservationDto, WorkspaceConversionStateDto, WorkspaceConversionUpdateDto,
    conversion_busy, conversion_not_stoppable, invalid_conversion_reservation,
    queue_duplicate_dataset, queue_installation_changed, queue_is_empty, queue_too_large,
};
use super::installation::InstallationIdentity;
use super::selection::{DatasetId, DatasetSourceKind};

const CONVERSION_RESERVATION_PREFIX: &str = "conversion-reservation-";

/// Correlates one reservation with exactly one later destination command.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct ConversionReservationId(u64);

impl ConversionReservationId {
    fn handle(self) -> String {
        format!("{CONVERSION_RESERVATION_PREFIX}{}", self.0)
    }

    /// Reads an identifier the webview sent back.
    ///
    /// Byte-equal or nothing, the same rule a dataset handle follows: without
    /// the round-trip, several spellings of one number would all reach the same
    /// reservation, and only one of them was ever issued.
    fn parse(handle: &str) -> Option<Self> {
        let id = Self(
            handle
                .strip_prefix(CONVERSION_RESERVATION_PREFIX)?
                .parse()
                .ok()?,
        );
        (id.handle() == handle).then_some(id)
    }
}

impl fmt::Debug for ConversionReservationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<conversion-reservation-id>")
    }
}

/// The folder a whole queue writes into, and the object it was admitted as.
///
/// Retained for the length of the queue so a retry runs against the same
/// directory without asking for it again — and so it can be *proved* to be the
/// same directory rather than assumed. The path never leaves this module.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct AdmittedDestination {
    root: PathBuf,
    /// The volume serial and file id the directory was admitted with, where the
    /// platform names objects that way. A path is not an object, and a queue
    /// that retried on a name alone could write into whatever had since taken
    /// it.
    identity: Option<DestinationIdentity>,
}

impl AdmittedDestination {
    pub(super) const fn new(root: PathBuf, identity: Option<DestinationIdentity>) -> Self {
        Self { root, identity }
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    /// Whether a fresh admission of the same name reached the same object.
    ///
    /// A platform that will not answer with an identity says so, and every
    /// caller here reads that as a refusal rather than as agreement: there is
    /// no weaker comparison to fall back to.
    pub(super) fn is_still(&self, other: &Self) -> bool {
        self.root == other.root && self.identity.is_some() && self.identity == other.identity
    }
}

impl fmt::Debug for AdmittedDestination {
    /// Deliberately opaque. This is the one absolute path a queue holds, and a
    /// `{:?}` of anything containing it would put a user's filesystem into a log.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<admitted-destination>")
    }
}

/// Where one item is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ItemState {
    Pending,
    Running,
    Finalized,
    Skipped,
    Failed,
    /// Stopped while running, with the owned process tree confirmed gone.
    Cancelled,
    /// A stopped queue never began it. Not a failure and not an attempt.
    NotRun,
    /// Stopped while running, and the termination could not be confirmed.
    CancellationFailed,
}

impl ItemState {
    const fn to_dto(self) -> ConversionQueueItemStateDto {
        match self {
            Self::Pending => ConversionQueueItemStateDto::Pending,
            Self::Running => ConversionQueueItemStateDto::Running,
            Self::Finalized => ConversionQueueItemStateDto::Finalized,
            Self::Skipped => ConversionQueueItemStateDto::Skipped,
            Self::Failed => ConversionQueueItemStateDto::Failed,
            Self::Cancelled => ConversionQueueItemStateDto::Cancelled,
            Self::NotRun => ConversionQueueItemStateDto::NotRun,
            Self::CancellationFailed => ConversionQueueItemStateDto::CancellationFailed,
        }
    }

    /// Whether this item is still waiting for its turn.
    ///
    /// The queue's own position counts everything that is not this, so a state
    /// added later that forgot to answer here would silently be counted as
    /// finished.
    const fn is_pending(self) -> bool {
        matches!(self, Self::Pending)
    }
}

/// The item state one run's outcome puts an item into.
pub(super) const fn item_state_of(class: super::conversion::OutcomeClass) -> ItemState {
    match class {
        super::conversion::OutcomeClass::Finalized => ItemState::Finalized,
        super::conversion::OutcomeClass::Skipped => ItemState::Skipped,
        super::conversion::OutcomeClass::Failed => ItemState::Failed,
    }
}

/// One dataset of a queue, and the latest thing that happened to it.
#[derive(Clone)]
pub(super) struct QueueItem {
    dataset: DatasetId,
    /// The dataset's request epoch as it stood when the queue was created, read
    /// rather than claimed. Claiming would supersede whatever the user was
    /// already doing with the row merely by opening a picker they might cancel.
    request_epoch: u64,
    kind: DatasetSourceKind,
    dataset_dto: SelectedFileDto,
    /// Derived before the queue existed, so two items that would fight over one
    /// name are refused before a picker opens.
    output_file_name: String,
    state: ItemState,
    attempts: u64,
    report: Option<super::conversion::WorkspaceConversionReport>,
    /// An attempt that never reached a conversion at all.
    error: Option<PreviewErrorDto>,
    retryable: bool,
    /// What a stop established about this item's attempt, when one reached it.
    cancellation: Option<CancellationFacts>,
}

/// What a stop established about one attempt, path-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CancellationFacts {
    pub(super) process_launched: bool,
    pub(super) tree_termination_confirmed: bool,
    /// Measured by the queue around the attempt, so it is the interval the user
    /// waited rather than the interval the process ran.
    pub(super) elapsed: Duration,
    pub(super) termination: Option<Termination>,
    pub(super) partial_output_observed: bool,
    pub(super) staging_residue: Option<StagingResidue>,
}

impl CancellationFacts {
    fn to_dto(self) -> ConversionCancellationDto {
        ConversionCancellationDto {
            process_launched: self.process_launched,
            // Always true here: this type exists only for an attempt a stop
            // reached. Carried rather than implied so a reader never infers it.
            termination_requested: true,
            tree_termination_confirmed: self.tree_termination_confirmed,
            elapsed_milliseconds: u64::try_from(self.elapsed.as_millis()).unwrap_or(u64::MAX),
            termination: self
                .termination
                .map(|termination| termination.stable_id().to_owned()),
            partial_output_observed: self.partial_output_observed,
            staging_residue: self
                .staging_residue
                .map(|residue| residue.stable_id().to_owned()),
        }
    }
}

impl QueueItem {
    pub(super) const fn new(
        dataset: DatasetId,
        request_epoch: u64,
        kind: DatasetSourceKind,
        dataset_dto: SelectedFileDto,
        output_file_name: String,
    ) -> Self {
        Self {
            dataset,
            request_epoch,
            kind,
            dataset_dto,
            output_file_name,
            state: ItemState::Pending,
            attempts: 0,
            report: None,
            error: None,
            retryable: false,
            cancellation: None,
        }
    }

    pub(super) const fn dataset(&self) -> DatasetId {
        self.dataset
    }

    pub(super) const fn request_epoch(&self) -> u64 {
        self.request_epoch
    }

    pub(super) const fn kind(&self) -> DatasetSourceKind {
        self.kind
    }

    pub(super) fn handle(&self) -> &str {
        &self.dataset_dto.handle
    }

    pub(super) fn output_file_name(&self) -> &str {
        &self.output_file_name
    }

    pub(super) fn file_name(&self) -> &str {
        &self.dataset_dto.file_name
    }

    fn to_dto(&self) -> ConversionQueueItemDto {
        ConversionQueueItemDto {
            dataset_handle: self.dataset_dto.handle.clone(),
            file_name: self.dataset_dto.file_name.clone(),
            source_kind: self.dataset_dto.source_kind,
            output_file_name: self.output_file_name.clone(),
            state: self.state.to_dto(),
            attempts: self.attempts,
            retryable: self.retryable,
            report: self
                .report
                .as_ref()
                .map(super::conversion::WorkspaceConversionReport::to_dto),
            error: self.error.clone(),
            cancellation: self.cancellation.map(CancellationFacts::to_dto),
        }
    }
}

impl fmt::Debug for QueueItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<queue-item>")
    }
}

/// One bounded, ordered queue.
#[derive(Debug, Clone)]
pub(super) struct ConversionQueue {
    /// The main document that asked. A reload advances this, so a reservation
    /// issued to a replaced document cannot be claimed by its replacement.
    document_epoch: u64,
    conflict: ConversionConflictPolicyDto,
    items: Vec<QueueItem>,
    /// Which item is running, or how many have finished when none is.
    current: usize,
    retry_round: u64,
    /// Set when a destination has been admitted, and kept for the queue's life
    /// so a retry does not ask for one again.
    destination: Option<AdmittedDestination>,
    /// Where the backend sequence stood when this queue last resolved one.
    installation_generation: u64,
    /// Which installation this queue's items were converted on.
    ///
    /// The identity itself, not the sequence that counts changes to it. A
    /// counter only ever goes up, so a user who switched away from an
    /// installation and back again would have a queue that could never be
    /// retried -- the restored installation is the same build wearing a higher
    /// number.
    installation: Option<InstallationIdentity>,
    /// A refusal that stopped the whole queue rather than one item.
    error: Option<PreviewErrorDto>,
}

impl ConversionQueue {
    /// Builds one queue from an ordered list, or says why it is not a queue.
    ///
    /// Every refusal here happens before a picker opens and before anything is
    /// created: an empty selection, a list longer than one session may run, and
    /// a list naming one dataset twice.
    pub(super) fn new(
        document_epoch: u64,
        conflict: ConversionConflictPolicyDto,
        items: Vec<QueueItem>,
    ) -> Result<Self, PreviewErrorDto> {
        if items.is_empty() {
            return Err(queue_is_empty());
        }
        if items.len() > MAX_CONVERSION_QUEUE_ITEMS {
            return Err(queue_too_large());
        }
        // Quadratic over at most sixteen items, and deliberately so: a set
        // would need one more thing to keep in step with the order, and the
        // order is the part that matters here.
        for (index, item) in items.iter().enumerate() {
            if items[..index]
                .iter()
                .any(|earlier| earlier.dataset == item.dataset)
            {
                return Err(queue_duplicate_dataset());
            }
        }
        Ok(Self {
            document_epoch,
            conflict,
            items,
            current: 0,
            retry_round: 0,
            destination: None,
            installation_generation: 0,
            installation: None,
            error: None,
        })
    }

    pub(super) const fn conflict(&self) -> ConversionConflictPolicyDto {
        self.conflict
    }

    pub(super) fn destination(&self) -> Option<&AdmittedDestination> {
        self.destination.as_ref()
    }

    /// Whether this dataset belongs to the queue, at any state.
    pub(super) fn holds(&self, dataset: DatasetId) -> bool {
        self.items.iter().any(|item| item.dataset == dataset)
    }

    /// The next item to run, with the index that names it.
    pub(super) fn next_pending(&self) -> Option<(usize, QueueItem)> {
        self.items
            .iter()
            .enumerate()
            .find(|(_, item)| item.state == ItemState::Pending)
            .map(|(index, item)| (index, item.clone()))
    }

    /// Whether any failed item could plausibly succeed on another attempt.
    ///
    /// Only an ordinary failure counts. A cancelled item has nothing to
    /// correct, a not-run item never ran, and an unconfirmed cancellation is a
    /// state in which running anything at all is refused -- so none of the
    /// three is a failure a second attempt could change.
    pub(super) fn has_retryable_failure(&self) -> bool {
        self.items
            .iter()
            .any(|item| item.state == ItemState::Failed && item.retryable)
    }

    fn count(&self, state: ItemState) -> usize {
        self.items.iter().filter(|item| item.state == state).count()
    }

    /// Marks everything that never began as not run, and reports how many.
    ///
    /// Deliberately not `Failed`. Nothing was launched, nothing was created and
    /// nothing went wrong; calling it a failure would report work the user
    /// stopped as work that broke, and would make it look retryable.
    fn strand_pending(&mut self) -> usize {
        let mut stranded = 0;
        for item in &mut self.items {
            if item.state.is_pending() {
                item.state = ItemState::NotRun;
                stranded += 1;
            }
        }
        self.recount();
        stranded
    }

    /// The queue's own position: how many items are no longer waiting.
    fn recount(&mut self) {
        self.current = self
            .items
            .iter()
            .filter(|item| !item.state.is_pending())
            .count();
    }

    fn to_dto(&self) -> ConversionQueueDto {
        let failed = self.count(ItemState::Failed);
        let retryable = self
            .items
            .iter()
            .filter(|item| item.state == ItemState::Failed && item.retryable)
            .count();
        ConversionQueueDto {
            items: self.items.iter().map(QueueItem::to_dto).collect(),
            current_index: self.current,
            item_count: self.items.len(),
            retry_round: self.retry_round,
            conflict_policy: self.conflict,
            finalized_count: self.count(ItemState::Finalized),
            skipped_count: self.count(ItemState::Skipped),
            failed_count: failed,
            retryable_failed_count: retryable,
            non_retryable_failed_count: failed - retryable,
            cancelled_count: self.count(ItemState::Cancelled),
            not_run_count: self.count(ItemState::NotRun),
            cancellation_failed_count: self.count(ItemState::CancellationFailed),
            error: self.error.clone(),
            installation_generation: self.installation_generation,
        }
    }
}

/// Where the one slot is.
#[derive(Debug, Clone)]
enum SlotState {
    Idle,
    /// A reservation was issued and has not been claimed, or has been claimed
    /// and its picker is open. Both are the same fact to a reader: no
    /// destination has been accepted, so nothing has been created.
    AwaitingDestination {
        reservation: ConversionReservationId,
        claimed: bool,
        queue: ConversionQueue,
    },
    Running {
        queue: ConversionQueue,
    },
    /// A stop was accepted and the worker has not settled the queue yet.
    ///
    /// Its own state rather than a flag beside `Running`, so nothing can read
    /// "running" and conclude that another item may start.
    Stopping {
        queue: ConversionQueue,
    },
    /// One queue, replaced by the next. Not a history: a list here would be an
    /// unbounded one, and nothing in this workflow reads a second entry.
    Terminal {
        reason: TerminalReason,
        queue: ConversionQueue,
    },
}

/// Why a terminal queue is over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TerminalReason {
    Completed,
    Stopped,
    StopFailed,
}

impl TerminalReason {
    const fn to_dto(self) -> ConversionQueueTerminalReasonDto {
        match self {
            Self::Completed => ConversionQueueTerminalReasonDto::Completed,
            Self::Stopped => ConversionQueueTerminalReasonDto::Stopped,
            Self::StopFailed => ConversionQueueTerminalReasonDto::StopFailed,
        }
    }

    /// Whether this queue may be retried in place.
    ///
    /// Only a queue that ran to its own end. A stopped queue is a decision the
    /// user made about the whole batch, and rerunning part of it in place would
    /// answer a question they did not ask; a queue whose stop could not be
    /// confirmed must not launch anything at all.
    const fn is_retryable(self) -> bool {
        matches!(self, Self::Completed)
    }
}

/// The exact attempt a stop request may reach.
///
/// Bound to the operation, the item index *and* the attempt number, so a handle
/// left over from an earlier item or an earlier retry round cannot be mistaken
/// for the live one. The queue clears it when that exact attempt settles.
struct CurrentAttempt {
    operation: u64,
    index: usize,
    attempt: u64,
    request: CancellationRequest,
}

impl CurrentAttempt {
    const fn is(&self, operation: u64, index: usize, attempt: u64) -> bool {
        self.operation == operation && self.index == index && self.attempt == attempt
    }
}

impl fmt::Debug for CurrentAttempt {
    /// Opaque. A cancellation request is not evidence about a run, and the
    /// crate it comes from renders it that way for the same reason.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<current-attempt>")
    }
}

/// What a stop request produced, for the caller that made it.
#[derive(Debug)]
pub(super) enum StopAccepted {
    /// The queue moved to stopping and this handle should be asked to cancel,
    /// outside the state lock.
    Requested(Option<CancellationRequest>),
    /// A stop was already requested for this queue. Idempotent, and answered
    /// with the authoritative state rather than a refusal.
    AlreadyRequested,
}

/// The session's single conversion slot, holding at most one queue.
///
/// `sequence` is the ordering key the interface uses to discard a stale read.
/// It advances on every observable transition and never rewinds, so a reply
/// that overtook another cannot install an older state.
#[derive(Debug)]
pub(super) struct ConversionSlot {
    sequence: u64,
    next_operation: u64,
    next_reservation: u64,
    operation: u64,
    state: SlotState,
    /// Monotonic for the life of one operation, and reset only when a new one
    /// begins. Independent of which attempt is running, so a stop that lands
    /// between two items is still a stop.
    stop_requested: bool,
    /// The one attempt a stop may reach, when one is in flight.
    current_attempt: Option<CurrentAttempt>,
}

impl Default for ConversionSlot {
    fn default() -> Self {
        Self {
            sequence: 0,
            // Both allocators begin at one, so zero is never a live identifier
            // and an uninitialised value cannot name an operation.
            next_operation: 1,
            next_reservation: 1,
            operation: 0,
            state: SlotState::Idle,
            stop_requested: false,
            current_attempt: None,
        }
    }
}

impl ConversionSlot {
    /// Whether a queue currently occupies the machine or the workspace.
    ///
    /// A terminal queue does not: it is a thing to read, not work in flight.
    /// This is what every workspace mutation asks before it proceeds.
    pub(super) const fn is_busy(&self) -> bool {
        matches!(
            self.state,
            SlotState::AwaitingDestination { .. }
                | SlotState::Running { .. }
                | SlotState::Stopping { .. }
        )
    }

    /// Whether a busy queue holds this row.
    ///
    /// Used to refuse removing any row a live queue names while leaving every
    /// other row removable. A terminal queue protects nothing: the work is over,
    /// and its report is about rows the user may now curate.
    ///
    /// A stopping queue protects its rows exactly as a running one does. The
    /// request has been made and the attempt has not settled, so the row may
    /// still be being read.
    pub(super) fn busy_holds(&self, dataset: DatasetId) -> bool {
        match &self.state {
            SlotState::AwaitingDestination { queue, .. }
            | SlotState::Running { queue }
            | SlotState::Stopping { queue } => queue.holds(dataset),
            SlotState::Idle | SlotState::Terminal { .. } => false,
        }
    }

    /// Issues one reservation for one queue, refusing while another is live.
    ///
    /// Replaces a terminal queue rather than accumulating beside it: starting a
    /// conversion is the user saying the previous result is no longer what they
    /// are looking at.
    pub(super) fn begin(
        &mut self,
        queue: ConversionQueue,
    ) -> Result<WorkspaceConversionReservationDto, PreviewErrorDto> {
        if self.is_busy() {
            return Err(conversion_busy());
        }
        let reservation = ConversionReservationId(self.next_reservation);
        self.next_reservation = self
            .next_reservation
            .checked_add(1)
            .expect("a session issues fewer than u64::MAX conversion reservations");
        self.operation = self.next_operation;
        self.next_operation = self
            .next_operation
            .checked_add(1)
            .expect("a session runs fewer than u64::MAX conversions");
        self.state = SlotState::AwaitingDestination {
            reservation,
            claimed: false,
            queue,
        };
        // A new operation, so nothing an earlier one was asked to do applies.
        // Reset here rather than when the previous queue ended: this is the one
        // place a fresh operation identifier is minted, so the flag and the
        // identifier cannot come apart.
        self.stop_requested = false;
        self.current_attempt = None;
        self.advance();
        Ok(WorkspaceConversionReservationDto {
            reservation_id: reservation.handle(),
        })
    }

    /// Consumes one exact reservation before its picker is dispatched.
    ///
    /// An unknown, already-claimed or replaced identifier is refused without
    /// disturbing the live slot. A reservation issued to a document that has
    /// since been replaced is refused for the same reason a folder import is:
    /// the document that would receive the answer is gone.
    pub(super) fn claim(
        &mut self,
        reservation_id: &str,
        document_epoch: u64,
    ) -> Result<u64, PreviewErrorDto> {
        let requested = ConversionReservationId::parse(reservation_id)
            .ok_or_else(invalid_conversion_reservation)?;
        let SlotState::AwaitingDestination {
            reservation,
            claimed,
            queue,
        } = &self.state
        else {
            return Err(invalid_conversion_reservation());
        };
        if *reservation != requested || *claimed || queue.document_epoch != document_epoch {
            return Err(invalid_conversion_reservation());
        }
        let queue = queue.clone();
        self.state = SlotState::AwaitingDestination {
            reservation: requested,
            claimed: true,
            queue,
        };
        // No sequence advance: nothing a reader can see has changed. The picker
        // is open either way, and a claim that did advance it would make a
        // cancelled picker look like two transitions.
        Ok(self.operation)
    }

    /// The queue a claimed reservation bound, for the run that follows.
    ///
    /// Read from the slot rather than handed back by `claim`, so the value that
    /// decides what is converted never leaves this module and a caller cannot
    /// run a queue it was not given.
    pub(super) fn claimed(&self) -> Option<(u64, ConversionQueue)> {
        match &self.state {
            SlotState::AwaitingDestination {
                claimed: true,
                queue,
                ..
            } => Some((self.operation, queue.clone())),
            SlotState::AwaitingDestination { .. }
            | SlotState::Idle
            | SlotState::Running { .. }
            | SlotState::Stopping { .. }
            | SlotState::Terminal { .. } => None,
        }
    }

    /// The queue this worker owns, running or stopping.
    ///
    /// A stopping queue is still the worker's: the attempt it holds has to be
    /// settled and the queue has to be terminalized, and only the worker can do
    /// either. What stopping changes is that no further item may begin, which
    /// is asked separately.
    pub(super) fn running(&self, operation: u64) -> Option<ConversionQueue> {
        match &self.state {
            SlotState::Running { queue } | SlotState::Stopping { queue }
                if self.operation == operation =>
            {
                Some(queue.clone())
            }
            _ => None,
        }
    }

    /// Whether a stop has been requested for this exact operation.
    ///
    /// Asked by the worker after the backend gate, before every item and after
    /// every settle. It is one boolean rather than a state comparison so that a
    /// request accepted while the worker was inside a process is not missed by
    /// a worker that only ever looked at the state it left behind.
    pub(super) fn stop_requested(&self, operation: u64) -> bool {
        self.operation == operation && self.stop_requested
    }

    /// Accepts one stop for the running or stopping queue of this document.
    ///
    /// Everything it does is under the caller's lock and none of it terminates
    /// anything: it records the request, moves the state, and hands back the
    /// one handle the caller should ask outside the lock. Asking a job to end
    /// while holding the lock every reader needs would make the interface stop
    /// answering for as long as termination took.
    /// The document is proved by the caller, exactly as a retry proves it: the
    /// authority that matters is being the *current* document, not the one that
    /// built the queue, because a reload is entitled to stop what it recovered.
    pub(super) fn request_stop(&mut self, operation: u64) -> Result<StopAccepted, PreviewErrorDto> {
        if self.operation != operation {
            return Err(conversion_not_stoppable());
        }
        let queue = match &self.state {
            SlotState::Running { queue } | SlotState::Stopping { queue } => queue,
            // An idle slot, a picker still open and a queue already over are
            // all the same answer: there is no running conversion of this
            // caller's to stop. A picker is closed by cancelling it, which is
            // a different action with a different meaning.
            SlotState::Idle
            | SlotState::AwaitingDestination { .. }
            | SlotState::Terminal { .. } => return Err(conversion_not_stoppable()),
        };
        if self.stop_requested {
            return Ok(StopAccepted::AlreadyRequested);
        }
        self.stop_requested = true;
        let queue = queue.clone();
        self.state = SlotState::Stopping { queue };
        self.advance();
        // Cloned rather than taken. The worker clears it when that exact
        // attempt settles, and taking it here would leave a repeated stop with
        // nothing to ask while the same attempt was still running.
        Ok(StopAccepted::Requested(
            self.current_attempt
                .as_ref()
                .map(|attempt| attempt.request.clone()),
        ))
    }

    /// Binds the one attempt a stop may reach.
    ///
    /// Replaces whatever was there: only one attempt of one queue runs at a
    /// time, and an entry that outlived its attempt is exactly what must not be
    /// reachable.
    pub(super) fn bind_attempt(
        &mut self,
        operation: u64,
        index: usize,
        attempt: u64,
        request: CancellationRequest,
    ) {
        if self.operation != operation {
            return;
        }
        self.current_attempt = Some(CurrentAttempt {
            operation,
            index,
            attempt,
            request,
        });
    }

    /// Releases the handle of one exact attempt.
    ///
    /// Named by operation, item and attempt number so a late release cannot
    /// clear a newer attempt's handle and leave a stop with nothing to ask.
    pub(super) fn release_attempt(&mut self, operation: u64, index: usize, attempt: u64) {
        if self
            .current_attempt
            .as_ref()
            .is_some_and(|current| current.is(operation, index, attempt))
        {
            self.current_attempt = None;
        }
    }

    /// Releases a reservation whose document is gone.
    ///
    /// A webview can reload between Rust issuing a reservation and the document
    /// receiving it. The replacement never learns the identifier, so it can
    /// neither claim it nor begin another queue -- and the slot would stay busy,
    /// with adding, clearing and previewing refused, until the application
    /// restarted.
    ///
    /// A queue already running is deliberately left alone. Its process is under
    /// way, its results are what the replacement document will read, and
    /// nothing here can stop it.
    pub(super) fn release_awaiting_destination(&mut self) {
        if matches!(self.state, SlotState::AwaitingDestination { .. }) {
            self.state = SlotState::Idle;
            self.advance();
        }
    }

    /// Marks one exact claimed operation as running, against one destination.
    ///
    /// Named rather than implied, because the slot lock is released while a
    /// destination is admitted -- filesystem work that takes as long as it
    /// takes. A reload in that window releases the slot, and a caller that
    /// transitioned whatever it found could mark a *replacement* operation as
    /// running and then overwrite it with the old one's results.
    pub(super) fn start_running(
        &mut self,
        operation: u64,
        destination: AdmittedDestination,
    ) -> bool {
        if self.operation != operation {
            return false;
        }
        let SlotState::AwaitingDestination { queue, .. } = &self.state else {
            return false;
        };
        let mut queue = queue.clone();
        queue.destination = Some(destination);
        queue.current = 0;
        self.state = SlotState::Running { queue };
        self.advance();
        true
    }

    /// Returns the slot to idle after a cancelled picker.
    ///
    /// An ordinary no-op, not a failure: the user closed a dialog. The operation
    /// identifier is not reused and the allocator does not rewind, so a reply
    /// still in flight for it cannot land on whatever is started next.
    pub(super) fn cancel(&mut self, operation: u64) {
        if self.operation == operation
            && matches!(self.state, SlotState::AwaitingDestination { .. })
        {
            self.state = SlotState::Idle;
            self.advance();
        }
    }

    /// Fixes the installation this queue runs on, or refuses a changed one.
    ///
    /// The first pass records what it bound; every later pass must find the
    /// same answer. A queue whose files came from two ProteoWizard builds is
    /// not a batch, and silently mixing them would put outputs that cannot be
    /// compared under one result.
    pub(super) fn bind_installation(
        &mut self,
        operation: u64,
        installation: Option<InstallationIdentity>,
        generation: u64,
    ) -> Result<(), PreviewErrorDto> {
        let Some(queue) = self.running_mut(operation) else {
            // Not this worker's queue any more. Whatever replaced it will bind
            // its own installation, and the caller stops either way.
            return Ok(());
        };
        // Recorded before the comparison below, so a queue refused *for* the
        // installation having changed still reports the one it resolved. That
        // pass produces no item and therefore no report, and a reader with only
        // the earlier reports would go on naming the installation those results
        // came from until the user rechecked by hand.
        queue.installation_generation = generation;
        match &queue.installation {
            // Both sides must say which build they are. An installation that
            // will not identify itself is not evidence that it is the same one,
            // and there is no weaker comparison to fall back on -- the same rule
            // the destination's identity follows.
            Some(bound) => {
                if installation.as_ref() == Some(bound) {
                    Ok(())
                } else {
                    Err(queue_installation_changed())
                }
            }
            None => {
                queue.installation = installation;
                Ok(())
            }
        }
    }

    /// Marks one item of the running queue as under way, and says which attempt
    /// it is.
    ///
    /// Refuses once a stop has been requested, whatever the worker believed
    /// when it decided to start. The worker checks first, but the request can
    /// land in the interval between that check and this call, and an item that
    /// began after the user asked for the queue to stop is the one thing this
    /// action promises will not happen.
    pub(super) fn start_item(&mut self, operation: u64, index: usize) -> Option<u64> {
        if self.stop_requested {
            return None;
        }
        let queue = self.running_mut(operation)?;
        let item = queue.items.get_mut(index)?;
        if item.state != ItemState::Pending {
            return None;
        }
        item.state = ItemState::Running;
        item.attempts = item
            .attempts
            .checked_add(1)
            .expect("an item is attempted fewer than u64::MAX times");
        let attempt = item.attempts;
        queue.current = index;
        self.advance();
        Some(attempt)
    }

    /// Records what one item's attempt did, and moves on.
    ///
    /// The item's own outcome, never the queue's: one file failing marks that
    /// file and nothing else, and everything already finalized stays finalized.
    pub(super) fn settle_item(
        &mut self,
        operation: u64,
        index: usize,
        outcome: ItemOutcome,
    ) -> bool {
        let Some(queue) = self.running_mut(operation) else {
            return false;
        };
        let Some(item) = queue.items.get_mut(index) else {
            return false;
        };
        match outcome {
            ItemOutcome::Reported {
                state,
                retryable,
                report,
            } => {
                item.state = state;
                item.retryable = retryable;
                item.report = Some(report);
                item.error = None;
            }
            ItemOutcome::Refused { retryable, error } => {
                item.state = ItemState::Failed;
                item.retryable = retryable;
                item.report = None;
                item.error = Some(error);
            }
            ItemOutcome::Stopped { state, facts } => {
                item.state = state;
                // Never retryable, whichever of the two states this is. A
                // cancelled item has nothing to correct, and one whose stop
                // could not be confirmed must not launch anything at all.
                item.retryable = false;
                item.report = None;
                item.error = None;
                item.cancellation = Some(facts);
            }
        }
        // Counted rather than incremented: the queue's own position is "how
        // many are done", and after the last item that is the item count.
        queue.recount();
        self.advance();
        true
    }

    /// Ends the running queue, with an optional queue-level refusal.
    ///
    /// The reason is the caller's, not inferred from the items: a queue of
    /// nothing but failures completed, and a queue stopped after one success
    /// did not, and no count of item states tells those apart.
    pub(super) fn finish(
        &mut self,
        operation: u64,
        error: Option<PreviewErrorDto>,
        reason: TerminalReason,
    ) {
        let Some(queue) = self.running_mut(operation) else {
            return;
        };
        if error.is_some() {
            queue.error = error;
        }
        // Everything the stop prevented, said as what it is. A completed queue
        // has nothing pending to strand, so this is a no-op for it.
        if reason != TerminalReason::Completed {
            queue.strand_pending();
        }
        let queue = queue.clone();
        self.state = SlotState::Terminal { reason, queue };
        // The attempt is over with the queue. Cleared unconditionally here
        // rather than by index, because nothing this operation holds can run
        // again.
        self.current_attempt = None;
        self.advance();
    }

    /// Refuses the whole queue before any item of this pass ran.
    ///
    /// Distinct from an item failing: nothing was converted by this pass, and
    /// the queue becomes terminal carrying the refusal.
    ///
    /// Anything a retry moved back to pending is put back as it was. Without
    /// that, a refused retry would leave its failures neither failed nor run --
    /// counted nowhere, and no longer retryable, so a user whose retry was
    /// refused for a reason they can fix would have lost the failures they
    /// meant to fix. A pass that never started cannot have moved anything, so
    /// on a first pass this restores nothing.
    pub(super) fn refuse(&mut self, operation: u64, error: PreviewErrorDto) {
        if self.operation != operation {
            return;
        }
        let queue = match &self.state {
            SlotState::AwaitingDestination { queue, .. }
            | SlotState::Running { queue }
            | SlotState::Stopping { queue } => queue.clone(),
            SlotState::Idle | SlotState::Terminal { .. } => return,
        };
        let mut queue = queue;
        for item in &mut queue.items {
            if !item.state.is_pending() {
                continue;
            }
            // What it carries says what it was. An item that never ran carries
            // neither and stays pending, which is the truth about it.
            if item.error.is_some() {
                item.state = ItemState::Failed;
            } else if let Some(report) = item.report.as_ref() {
                item.state = item_state_of(report.outcome_class());
            }
        }
        // A refusal that lands on a stopped queue is still a stop. What refused
        // it is recorded, and everything the stop prevented is marked as never
        // run rather than left pending -- a pending item in a terminal queue is
        // counted nowhere.
        let reason = if self.stop_requested {
            queue.strand_pending();
            TerminalReason::Stopped
        } else {
            TerminalReason::Completed
        };
        queue.recount();
        queue.error = Some(error);
        self.state = SlotState::Terminal { reason, queue };
        self.current_attempt = None;
        self.advance();
    }

    /// Moves every retryable failure back to pending for another pass.
    ///
    /// Successes, skips and non-retryable failures are left exactly as they
    /// are, and the order never changes: a retry is the same queue again, not a
    /// new one made of what is left.
    pub(super) fn begin_retry(&mut self) -> Option<u64> {
        let SlotState::Terminal { reason, queue } = &self.state else {
            return None;
        };
        // A stopped queue is not retried in place. The user asked for the whole
        // batch to stop, and rerunning part of it under the same operation
        // would answer a question they did not ask; a queue whose stop could
        // not be confirmed must launch nothing at all. Converting those rows
        // again is a new queue, made from the roster.
        if !reason.is_retryable() {
            return None;
        }
        if !queue.has_retryable_failure() {
            return None;
        }
        let mut queue = queue.clone();
        for item in &mut queue.items {
            if item.state == ItemState::Failed && item.retryable {
                item.state = ItemState::Pending;
            }
        }
        queue.error = None;
        queue.retry_round = queue
            .retry_round
            .checked_add(1)
            .expect("a queue is retried fewer than u64::MAX times");
        queue.current = queue
            .items
            .iter()
            .filter(|item| item.state != ItemState::Pending)
            .count();
        self.state = SlotState::Running { queue };
        self.advance();
        // The same operation, deliberately. Only `finish` and `refuse` produce a
        // terminal slot and both are called by the worker itself before it
        // returns, so no live worker still holds this identifier -- and a retry
        // is the same queue again rather than a new piece of work. What orders
        // two reads is the sequence, which advanced just above.
        Some(self.operation)
    }

    fn running_mut(&mut self, operation: u64) -> Option<&mut ConversionQueue> {
        if self.operation != operation {
            return None;
        }
        match &mut self.state {
            // Stopping included: the attempt in flight still has to be settled
            // and the queue still has to be terminalized, and both write here.
            SlotState::Running { queue } | SlotState::Stopping { queue } => Some(queue),
            SlotState::Idle
            | SlotState::AwaitingDestination { .. }
            | SlotState::Terminal { .. } => None,
        }
    }

    /// The folder a terminal queue was run against, for a retry.
    pub(super) fn terminal_destination(&self) -> Option<AdmittedDestination> {
        match &self.state {
            SlotState::Terminal { queue, .. } => queue.destination.clone(),
            SlotState::Idle
            | SlotState::AwaitingDestination { .. }
            | SlotState::Running { .. }
            | SlotState::Stopping { .. } => None,
        }
    }

    /// The current state, as the webview reads it.
    pub(super) fn read(&self, backend_quarantined: bool) -> WorkspaceConversionUpdateDto {
        let operation_id = self.operation.to_string();
        let state = match &self.state {
            SlotState::Idle => WorkspaceConversionStateDto::Idle,
            SlotState::AwaitingDestination { queue, .. } => {
                WorkspaceConversionStateDto::AwaitingDestination {
                    operation_id,
                    queue: queue.to_dto(),
                }
            }
            SlotState::Running { queue } => WorkspaceConversionStateDto::Running {
                operation_id,
                queue: queue.to_dto(),
            },
            SlotState::Stopping { queue } => WorkspaceConversionStateDto::Stopping {
                operation_id,
                queue: queue.to_dto(),
            },
            SlotState::Terminal { reason, queue } => WorkspaceConversionStateDto::Terminal {
                operation_id,
                reason: reason.to_dto(),
                queue: queue.to_dto(),
            },
        };
        WorkspaceConversionUpdateDto {
            sequence: self.sequence,
            state,
            backend_quarantined,
        }
    }

    fn advance(&mut self) {
        self.sequence = self
            .sequence
            .checked_add(1)
            .expect("a session makes fewer than u64::MAX conversion transitions");
    }
}

/// What one item's attempt reached, before the queue decides what to record.
///
/// Three answers rather than two. A stopped attempt is neither a conversion that
/// reached an outcome nor a refusal that never reached one, and the queue needs
/// the boundary's own two cancellation results to tell a confirmed stop from an
/// unconfirmed one.
#[derive(Debug)]
pub(super) enum QueueItemAttempt {
    Settled(ItemOutcome),
    Cancelled(CancellationReport),
    CancellationFailed(CancellationFailure),
}

/// What one item's attempt produced.
#[derive(Debug)]
pub(super) enum ItemOutcome {
    /// A conversion ran and reached an outcome, which may itself be a failure.
    Reported {
        state: ItemState,
        retryable: bool,
        report: super::conversion::WorkspaceConversionReport,
    },
    /// The attempt never reached a conversion at all.
    Refused {
        retryable: bool,
        error: PreviewErrorDto,
    },
    /// A stop reached the attempt while it was running.
    ///
    /// Carries no conversion report by construction: a stopped attempt produced
    /// no output, so there is nothing for a report to describe, and an item in
    /// this state can never name an output file.
    Stopped {
        state: ItemState,
        facts: CancellationFacts,
    },
}
