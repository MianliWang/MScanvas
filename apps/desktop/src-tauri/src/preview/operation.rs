//! The session's one conversion queue.
//!
//! One queue, bounded and ordered, replacing the single slot this evolved from
//! rather than sitting beside it. A single-dataset conversion is a queue of one,
//! so there is one protocol and one state machine; a second queue asked for
//! while one is under way is refused, not appended to.
//!
//! It is not a job system and is shaped so it cannot become one. There is no
//! persistence, no scheduler, no priority and no cancellation. What it holds is
//! one ordered list of datasets, the destination they all go to, and the latest
//! result of each — replaced whole by the next queue.
//!
//! It exists because a conversion outlives the request that started it. The
//! webview can reload at any point, and Tauri dispatches Windows invokes as
//! independent fetches, so the reply to the command that started a queue is not
//! a reliable place to learn how it went. Rust holds the answer instead, and the
//! interface reads it — on mount, and again while something is running.

use std::fmt;
use std::path::{Path, PathBuf};

use super::destination::DestinationIdentity;
use super::dto::{
    ConversionConflictPolicyDto, ConversionQueueDto, ConversionQueueItemDto,
    ConversionQueueItemStateDto, MAX_CONVERSION_QUEUE_ITEMS, PreviewErrorDto, SelectedFileDto,
    WorkspaceConversionReservationDto, WorkspaceConversionStateDto, WorkspaceConversionUpdateDto,
    conversion_busy, invalid_conversion_reservation, queue_duplicate_dataset, queue_is_empty,
    queue_too_large,
};
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
}

impl ItemState {
    const fn to_dto(self) -> ConversionQueueItemStateDto {
        match self {
            Self::Pending => ConversionQueueItemStateDto::Pending,
            Self::Running => ConversionQueueItemStateDto::Running,
            Self::Finalized => ConversionQueueItemStateDto::Finalized,
            Self::Skipped => ConversionQueueItemStateDto::Skipped,
            Self::Failed => ConversionQueueItemStateDto::Failed,
        }
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
    pub(super) fn has_retryable_failure(&self) -> bool {
        self.items
            .iter()
            .any(|item| item.state == ItemState::Failed && item.retryable)
    }

    fn count(&self, state: ItemState) -> usize {
        self.items.iter().filter(|item| item.state == state).count()
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
            error: self.error.clone(),
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
    /// One queue, replaced by the next. Not a history: a list here would be an
    /// unbounded one, and nothing in this workflow reads a second entry.
    Terminal {
        queue: ConversionQueue,
    },
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
            SlotState::AwaitingDestination { .. } | SlotState::Running { .. }
        )
    }

    /// Whether a busy queue holds this row.
    ///
    /// Used to refuse removing any row a live queue names while leaving every
    /// other row removable. A terminal queue protects nothing: the work is over,
    /// and its report is about rows the user may now curate.
    pub(super) fn busy_holds(&self, dataset: DatasetId) -> bool {
        match &self.state {
            SlotState::AwaitingDestination { queue, .. } | SlotState::Running { queue } => {
                queue.holds(dataset)
            }
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
            | SlotState::Terminal { .. } => None,
        }
    }

    /// The queue currently running, for the worker that owns it.
    pub(super) fn running(&self, operation: u64) -> Option<ConversionQueue> {
        match &self.state {
            SlotState::Running { queue } if self.operation == operation => Some(queue.clone()),
            _ => None,
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

    /// Marks one item of the running queue as under way.
    pub(super) fn start_item(&mut self, operation: u64, index: usize) -> bool {
        let Some(queue) = self.running_mut(operation) else {
            return false;
        };
        let Some(item) = queue.items.get_mut(index) else {
            return false;
        };
        if item.state != ItemState::Pending {
            return false;
        }
        item.state = ItemState::Running;
        item.attempts = item
            .attempts
            .checked_add(1)
            .expect("an item is attempted fewer than u64::MAX times");
        queue.current = index;
        self.advance();
        true
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
        }
        // Counted rather than incremented: the queue's own position is "how
        // many are done", and after the last item that is the item count.
        queue.current = queue
            .items
            .iter()
            .filter(|item| item.state != ItemState::Pending)
            .count();
        self.advance();
        true
    }

    /// Ends the running queue, with an optional queue-level refusal.
    pub(super) fn finish(&mut self, operation: u64, error: Option<PreviewErrorDto>) {
        let Some(queue) = self.running_mut(operation) else {
            return;
        };
        if error.is_some() {
            queue.error = error;
        }
        let queue = queue.clone();
        self.state = SlotState::Terminal { queue };
        self.advance();
    }

    /// Refuses the whole queue before any item ran.
    ///
    /// Distinct from an item failing: nothing was converted, and the queue is
    /// terminal with every item still pending.
    pub(super) fn refuse(&mut self, operation: u64, error: PreviewErrorDto) {
        if self.operation != operation {
            return;
        }
        let queue = match &self.state {
            SlotState::AwaitingDestination { queue, .. } | SlotState::Running { queue } => {
                queue.clone()
            }
            SlotState::Idle | SlotState::Terminal { .. } => return,
        };
        let mut queue = queue;
        queue.error = Some(error);
        self.state = SlotState::Terminal { queue };
        self.advance();
    }

    /// Moves every retryable failure back to pending for another pass.
    ///
    /// Successes, skips and non-retryable failures are left exactly as they
    /// are, and the order never changes: a retry is the same queue again, not a
    /// new one made of what is left.
    pub(super) fn begin_retry(&mut self) -> Option<u64> {
        let SlotState::Terminal { queue } = &self.state else {
            return None;
        };
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
        Some(self.operation)
    }

    fn running_mut(&mut self, operation: u64) -> Option<&mut ConversionQueue> {
        if self.operation != operation {
            return None;
        }
        match &mut self.state {
            SlotState::Running { queue } => Some(queue),
            SlotState::Idle
            | SlotState::AwaitingDestination { .. }
            | SlotState::Terminal { .. } => None,
        }
    }

    /// The folder a terminal queue was run against, for a retry.
    pub(super) fn terminal_destination(&self) -> Option<AdmittedDestination> {
        match &self.state {
            SlotState::Terminal { queue } => queue.destination.clone(),
            SlotState::Idle | SlotState::AwaitingDestination { .. } | SlotState::Running { .. } => {
                None
            }
        }
    }

    /// The current state, as the webview reads it.
    pub(super) fn read(&self) -> WorkspaceConversionUpdateDto {
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
            SlotState::Terminal { queue } => WorkspaceConversionStateDto::Terminal {
                operation_id,
                queue: queue.to_dto(),
            },
        };
        WorkspaceConversionUpdateDto {
            sequence: self.sequence,
            state,
        }
    }

    fn advance(&mut self) {
        self.sequence = self
            .sequence
            .checked_add(1)
            .expect("a session makes fewer than u64::MAX conversion transitions");
    }
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
}
