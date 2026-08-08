//! The session's one conversion slot.
//!
//! This is not a queue and is deliberately shaped so it cannot become one. There
//! is one operation, it is replaced rather than appended to, and the only
//! history it keeps is the report of the operation that finished last. A second
//! conversion asked for while one is under way is refused, not enqueued.
//!
//! It exists because a conversion outlives the request that started it. The
//! webview can reload at any point, and Tauri dispatches Windows invokes as
//! independent fetches, so the reply to the command that started a conversion is
//! not a reliable place to learn how it went. Rust holds the answer instead, and
//! the interface reads it — on mount, and again while something is running.

use std::fmt;

use super::dto::{
    ConversionConflictPolicyDto, PreviewErrorDto, SelectedFileDto,
    WorkspaceConversionReservationDto, WorkspaceConversionStateDto, WorkspaceConversionUpdateDto,
    conversion_busy, invalid_conversion_reservation,
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

/// What one conversion request was bound to when it was made.
///
/// Every field is decided by Rust at begin and none of them can be changed
/// afterwards, which is what makes the picker that follows a picker *for this
/// request* rather than a picker whose result is applied to whatever the
/// workspace happens to hold when it closes.
#[derive(Clone)]
pub(super) struct BoundConversion {
    /// The main document that asked. A reload advances this, so a reservation
    /// issued to a replaced document cannot be claimed by its replacement.
    document_epoch: u64,
    dataset: DatasetId,
    /// The dataset's request epoch as it stood at begin, read rather than
    /// claimed. Claiming here would supersede whatever the user was already
    /// doing with the row merely by opening a picker they might cancel.
    request_epoch: u64,
    kind: DatasetSourceKind,
    conflict: ConversionConflictPolicyDto,
    /// The row as the roster described it at begin, so a state read can name it
    /// without taking the workspace lock again.
    dataset_dto: SelectedFileDto,
}

impl BoundConversion {
    pub(super) const fn new(
        document_epoch: u64,
        dataset: DatasetId,
        request_epoch: u64,
        kind: DatasetSourceKind,
        conflict: ConversionConflictPolicyDto,
        dataset_dto: SelectedFileDto,
    ) -> Self {
        Self {
            document_epoch,
            dataset,
            request_epoch,
            kind,
            conflict,
            dataset_dto,
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

    pub(super) const fn conflict(&self) -> ConversionConflictPolicyDto {
        self.conflict
    }

    pub(super) fn dataset_handle(&self) -> &str {
        &self.dataset_dto.handle
    }
}

/// Deliberately opaque. It holds a described row and two authority counters,
/// and a `{:?}` of anything containing one would put them into a log.
impl fmt::Debug for BoundConversion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<bound-conversion>")
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
        bound: BoundConversion,
    },
    Running {
        bound: BoundConversion,
    },
    /// One report, replaced by the next conversion. Not a history: a list here
    /// would be an unbounded one, and nothing in this workflow reads a second
    /// entry.
    Terminal(TerminalOutcome),
}

/// How the last operation ended.
#[derive(Debug, Clone)]
enum TerminalOutcome {
    /// A conversion ran and reached an outcome, which may itself be a failure.
    Reported(Box<super::conversion::WorkspaceConversionReport>),
    /// The operation never reached a conversion at all.
    Refused {
        dataset_handle: String,
        error: PreviewErrorDto,
    },
}

/// The session's single conversion slot.
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
    /// Whether a conversion currently occupies the machine or the workspace.
    ///
    /// A terminal report does not: it is a thing to read, not work in flight.
    /// This is what every workspace mutation asks before it proceeds.
    pub(super) const fn is_busy(&self) -> bool {
        matches!(
            self.state,
            SlotState::AwaitingDestination { .. } | SlotState::Running { .. }
        )
    }

    /// The row a busy slot is working on, if any.
    ///
    /// Used to refuse removing exactly that row while leaving every other row
    /// removable. A terminal report names no row that must be protected: the
    /// work is over.
    pub(super) fn busy_dataset(&self) -> Option<DatasetId> {
        match &self.state {
            SlotState::AwaitingDestination { bound, .. } | SlotState::Running { bound } => {
                Some(bound.dataset())
            }
            SlotState::Idle | SlotState::Terminal(_) => None,
        }
    }

    /// Issues one reservation, refusing while another conversion is live.
    ///
    /// Replaces a terminal report rather than accumulating beside it: starting a
    /// conversion is the user saying the previous result is no longer what they
    /// are looking at.
    pub(super) fn begin(
        &mut self,
        bound: BoundConversion,
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
            bound,
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
    ) -> Result<BoundConversion, PreviewErrorDto> {
        let requested = ConversionReservationId::parse(reservation_id)
            .ok_or_else(invalid_conversion_reservation)?;
        let SlotState::AwaitingDestination {
            reservation,
            claimed,
            bound,
        } = &self.state
        else {
            return Err(invalid_conversion_reservation());
        };
        if *reservation != requested || *claimed {
            return Err(invalid_conversion_reservation());
        }
        if bound.document_epoch != document_epoch {
            return Err(invalid_conversion_reservation());
        }
        let bound = bound.clone();
        self.state = SlotState::AwaitingDestination {
            reservation: requested,
            claimed: true,
            bound: bound.clone(),
        };
        // No sequence advance: nothing a reader can see has changed. The picker
        // is open either way, and a claim that did advance it would make a
        // cancelled picker look like two transitions.
        Ok(bound)
    }

    /// The request a claimed reservation bound, for the run that follows.
    ///
    /// Read from the slot rather than handed back by `claim`, so the value that
    /// decides what is converted never leaves this module and a caller cannot
    /// run a conversion for a request it was not given.
    pub(super) fn claimed(&self) -> Option<(u64, BoundConversion)> {
        match &self.state {
            SlotState::AwaitingDestination {
                claimed: true,
                bound,
                ..
            } => Some((self.operation, bound.clone())),
            SlotState::AwaitingDestination { .. }
            | SlotState::Idle
            | SlotState::Running { .. }
            | SlotState::Terminal(_) => None,
        }
    }

    /// Releases a reservation whose document is gone.
    ///
    /// A webview can reload between Rust issuing a reservation and the document
    /// receiving it. The replacement never learns the identifier, so it can
    /// neither claim it nor begin another conversion -- and the slot would stay
    /// busy, with adding, clearing and previewing refused, until the
    /// application restarted.
    ///
    /// Releases a claimed reservation as well as an unclaimed one. A claimed
    /// one means a modal picker is open for a document that no longer exists;
    /// when it closes, the command finds nothing claimed and converts nothing,
    /// which is the same answer as a dismissed picker and the right one.
    ///
    /// A conversion already running is deliberately left alone. Its process is
    /// under way, its result is what the replacement document will read, and
    /// nothing here can stop it.
    pub(super) fn release_awaiting_destination(&mut self) {
        if matches!(self.state, SlotState::AwaitingDestination { .. }) {
            self.state = SlotState::Idle;
            self.advance();
        }
    }

    /// Marks one exact claimed operation as running.
    ///
    /// Named rather than implied, because the slot lock is released while a
    /// destination is admitted and a row revalidated -- filesystem work that
    /// takes as long as it takes. A reload in that window releases the slot,
    /// and a caller that transitioned whatever it found could mark a
    /// *replacement* operation as running and then overwrite it with the old
    /// one's report. `false` means this operation is no longer the slot's, and
    /// the caller must convert nothing.
    pub(super) fn start_running(&mut self, operation: u64) -> bool {
        if self.operation != operation {
            return false;
        }
        let SlotState::AwaitingDestination { bound, .. } = &self.state else {
            return false;
        };
        self.state = SlotState::Running {
            bound: bound.clone(),
        };
        self.advance();
        true
    }

    /// Returns the slot to idle after a cancelled picker.
    ///
    /// An ordinary no-op, not a failure: the user closed a dialog. The operation
    /// identifier is not reused and the allocator does not rewind, so a reply
    /// still in flight for it cannot land on whatever is started next.
    pub(super) fn cancel(&mut self) {
        if matches!(self.state, SlotState::AwaitingDestination { .. }) {
            self.state = SlotState::Idle;
            self.advance();
        }
    }

    /// Stores the report of a conversion that reached an outcome.
    /// Stores the report of one exact operation.
    ///
    /// Silently does nothing for an operation the slot has moved past. A run
    /// whose slot was released by a reload still finishes -- its process is
    /// under way and nothing can stop it -- but its report describes work
    /// nobody is waiting for, and installing it would overwrite whatever the
    /// replacement document has since started.
    pub(super) fn complete(
        &mut self,
        operation: u64,
        report: super::conversion::WorkspaceConversionReport,
    ) {
        if self.operation != operation {
            return;
        }
        self.state = SlotState::Terminal(TerminalOutcome::Reported(Box::new(report)));
        self.advance();
    }

    /// Stores an operation that never reached a conversion.
    pub(super) fn refuse(
        &mut self,
        operation: u64,
        dataset_handle: String,
        error: PreviewErrorDto,
    ) {
        if !self.still_live(operation) {
            return;
        }
        self.state = SlotState::Terminal(TerminalOutcome::Refused {
            dataset_handle,
            error,
        });
        self.advance();
    }

    /// Whether this operation is still the one the slot is working on.
    ///
    /// The number alone is not enough. `release_awaiting_destination` returns
    /// the slot to idle without allocating a new operation, so a released
    /// operation still matches by number -- and a refusal that checked only
    /// that would install an abandoned document's failure into the replacement
    /// document's empty slot. What has to be true is that the slot is still
    /// *doing* this operation.
    const fn still_live(&self, operation: u64) -> bool {
        self.operation == operation
            && matches!(
                self.state,
                SlotState::AwaitingDestination { .. } | SlotState::Running { .. }
            )
    }

    /// The current state, as the webview reads it.
    pub(super) fn read(&self) -> WorkspaceConversionUpdateDto {
        let operation_id = self.operation.to_string();
        let state = match &self.state {
            SlotState::Idle => WorkspaceConversionStateDto::Idle,
            SlotState::AwaitingDestination { bound, .. } => {
                WorkspaceConversionStateDto::AwaitingDestination {
                    operation_id,
                    dataset: bound.dataset_dto.clone(),
                }
            }
            SlotState::Running { bound } => WorkspaceConversionStateDto::Running {
                operation_id,
                dataset: bound.dataset_dto.clone(),
            },
            SlotState::Terminal(TerminalOutcome::Reported(report)) => {
                WorkspaceConversionStateDto::Completed {
                    operation_id,
                    report: report.to_dto(),
                }
            }
            SlotState::Terminal(TerminalOutcome::Refused {
                dataset_handle,
                error,
            }) => WorkspaceConversionStateDto::Failed {
                operation_id,
                dataset_handle: dataset_handle.clone(),
                error: error.clone(),
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
