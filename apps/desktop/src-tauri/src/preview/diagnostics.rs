//! What a conversion queue may say about the attempts that did not work.
//!
//! A failed conversion currently leaves the user with a stable identifier and a
//! sentence. That is the right thing on screen — it is what they can act on —
//! but it is not enough to diagnose with, and the part that would be is exactly
//! the part that must not be shown: the backend's own output, which names the
//! acquisition, the folder, the staging area and the installation.
//!
//! So this exists to make one file, on purpose, once, into a folder the user
//! chooses. Not a log, not a history and not a report anything sends anywhere.
//! Its whole design is the tension between those two facts — the text is what
//! makes it useful, and the text is what makes it dangerous — and every
//! decision here resolves that tension the same way: toward saying less.
//!
//! Three things follow from that and are worth stating rather than inferring.
//!
//! The redaction happens *before* the queue keeps anything. What the queue holds
//! is already redacted and already bounded; the captured bytes go out of scope
//! with the run that produced them, so no later code has to be trusted with
//! them and none of it could redact them anyway — by then the paths are gone.
//!
//! A ticket exists only for an attempt worth diagnosing. A conversion that
//! worked leaves nothing here, because retaining what a working backend printed
//! would keep text about the user's acquisition for no purpose at all.
//!
//! And nothing is claimed about the result beyond what is true. Known paths and
//! internal identifiers are removed; an excerpt that still looks like it names
//! somewhere is withheld entirely. Neither of those makes the file anonymous.
//! Backend text describes instruments, methods and samples, and the interface
//! says so where the action is rather than in a document nobody reads.

use std::fmt;
use std::sync::Arc;

use mscanvas_proteowizard::{
    BackendDiagnosticText, BackendRunFacts, StagingResidue, ValidationMode,
};
use mscanvas_proteowizard::{MAX_CONVERSION_OUTPUTS_PER_SOURCE, SciexSampleCompleteness};

use super::conversion::{ValidationFacts, WorkspaceConversionReport};
use super::dto::{
    ConversionConflictPolicyDto, ConversionDiagnosticsExportDto, MAX_ERROR_DETAIL_CHARS,
    PreviewErrorDto, bounded_text, invalid_diagnostics_reservation, redact_absolute_paths,
};
use super::operation::{CancellationFacts, ItemOutputTopology, ItemState};
use super::selection::DatasetSourceKind;

pub(super) mod payload;

const DIAGNOSTICS_RESERVATION_PREFIX: &str = "diagnostics-reservation-";

/// The default name the native save dialog offers.
pub(super) const DIAGNOSTICS_FILE_NAME: &str = "mscanvas-conversion-diagnostics.json";

/// The largest diagnostics document MSCanvas will write.
///
/// Checked against the serialized UTF-8 bytes plus their trailing newline,
/// before anything is created. A payload over it is a refusal and not a
/// truncation: half a JSON document is not a diagnostics file, and writing one
/// would hand the user something no reader can open in exchange for hiding the
/// fact that the bound was reached.
///
/// Sixteen items, each with two 32 KiB excerpts, is a little over one mebibyte
/// of text before structure. Two is that with room for the structure and the
/// facts, and far below what a person or a text editor finds awkward.
pub(super) const MAX_DIAGNOSTIC_EXPORT_BYTES: usize = 2 * 1024 * 1024;

/// The one sentence this feature must never be shipped without.
///
/// Stated in the panel, and again inside the file, because the two are read at
/// different moments by possibly different people: the person who exports it
/// and the person who is about to be sent it.
pub(super) const REVIEW_BEFORE_SHARING: &str = "Known filesystem paths and internal identifiers \
                                                are removed, but backend text may still contain \
                                                acquisition metadata. Review the file before \
                                                sharing.";

/// Correlates one reservation with exactly one later export command.
#[derive(Clone, Copy, PartialEq, Eq)]
struct DiagnosticsReservationId(u64);

impl DiagnosticsReservationId {
    fn handle(self) -> String {
        format!("{DIAGNOSTICS_RESERVATION_PREFIX}{}", self.0)
    }

    /// Reads an identifier the webview sent back.
    ///
    /// Byte-equal or nothing, the same rule a conversion reservation follows:
    /// without the round-trip, several spellings of one number would all reach
    /// the same reservation and only one of them was ever issued.
    fn parse(handle: &str) -> Option<Self> {
        let id = Self(
            handle
                .strip_prefix(DIAGNOSTICS_RESERVATION_PREFIX)?
                .parse()
                .ok()?,
        );
        (id.handle() == handle).then_some(id)
    }
}

impl fmt::Debug for DiagnosticsReservationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<diagnostics-reservation-id>")
    }
}

/// One diagnostic-worthy attempt, and everything the export may say about it.
///
/// Private, unserialized, opaque in `Debug`, with no accessor for a raw stream
/// and no path anywhere in it. Built only by the queue settling an item, and
/// never reconstructed afterwards from a report — the redacted text is the one
/// thing that cannot be rebuilt, because rebuilding it would need the paths the
/// run has already dropped.
///
/// One per queue item at most, replaced whole when a later attempt settles, and
/// dropped when the queue is replaced or the process exits. Bounded by the
/// queue's existing sixteen items and by the excerpt bound inside each.
pub(super) struct ConversionFailureDiagnosticTicket {
    identity: DiagnosticItemIdentity,
    /// The state this was built for. Compared against the item's current state
    /// at export time, so a ticket cannot describe an attempt the queue has
    /// since said something else about.
    state: ItemState,
    retryable: bool,
    /// The conversion boundary's own answer, absent for an attempt that never
    /// reached a conversion at all.
    outcome: Option<&'static str>,
    detailed_outcome: Option<&'static str>,
    /// This session's own refusal, for the attempt that never reached one.
    refusal: Option<String>,
    /// A bounded, redacted excerpt of whatever detail that refusal carried.
    refusal_detail: Option<String>,
    validation: Option<ValidationFacts>,
    backend: Option<BackendRunFacts>,
    cancellation: Option<CancellationFacts>,
    residue: Option<StagingResidue>,
    /// Redacted where the run knew its own paths, bounded, and possibly
    /// withheld. Absent for an attempt that launched nothing, and absent for a
    /// finalized item whose only trouble was cleanup — the backend succeeded
    /// there and repeating what it printed would diagnose nothing.
    text: Option<Box<BackendDiagnosticText>>,
    /// Counts and stable identifiers for a backend-named set's attempt.
    ///
    /// Present only for a set item, which is why an export of an ordinary queue
    /// is byte-identical to what it was before this existed.
    output_set: Option<OutputSetDiagnosticFacts>,
}

/// What an export says about one backend-named set's attempt.
///
/// Counts and stable identifiers, and deliberately no member names. The
/// backend derives those from sample identifiers inside the acquisition, so
/// they are the user's data rather than this application's vocabulary — and
/// every failure class this has to tell apart is distinguishable without them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct OutputSetDiagnosticFacts {
    /// The lifecycle's own bound, so a reader can see the counts are bounded
    /// rather than having to know the constant.
    pub(super) max_members: usize,
    pub(super) member_count: usize,
    pub(super) finalized_count: usize,
    pub(super) validated_not_published_count: usize,
    pub(super) not_published_count: usize,
    /// How many objects the acquisition was bound to for the run.
    ///
    /// `None` where it never was, which is every refusal that happened before
    /// the source was opened. Zero would be a claim rather than an absence.
    pub(super) bound_source_objects: Option<usize>,
    /// The completeness judgement's stable identifier, or none where the
    /// question was never posed.
    pub(super) completeness: Option<&'static str>,
    /// Present exactly for a partial publication.
    pub(super) partial: Option<PartialFinalizationFacts>,
    /// Why no complete-set adoption authority exists, where a reader might
    /// otherwise expect one.
    pub(super) not_adoptable: Option<&'static str>,
}

impl OutputSetDiagnosticFacts {
    /// The shape of a set item that never reached the lifecycle.
    ///
    /// Every count is zero and every count is true: nothing was discovered,
    /// validated or published, because the run this item would have made was
    /// refused before it started. What it still says is that this *was* a set
    /// item and how many members one could ever hold — so a reader is not left
    /// deciding what kind of item they are looking at from which layer happened
    /// to refuse it.
    pub(super) fn before_the_run(max_members: usize) -> Self {
        Self {
            max_members,
            member_count: 0,
            finalized_count: 0,
            validated_not_published_count: 0,
            not_published_count: 0,
            // Never bound, so there is no number to report. Zero would say the
            // acquisition was held to no objects, which is a different claim.
            bound_source_objects: None,
            completeness: None,
            partial: None,
            not_adoptable: None,
        }
    }
}

/// A partial publication, in counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PartialFinalizationFacts {
    pub(super) finalized_count: usize,
    pub(super) not_published_count: usize,
    /// What the filesystem said about the member that failed.
    pub(super) failure_kind: &'static str,
}

/// Which queue item a diagnostic is about, and what it is called.
///
/// One value rather than six parameters. These six always travel together, are
/// always read from the same item at the same moment, and none of them means
/// anything without the others -- an index with no queue behind it is not an
/// identity.
pub(super) struct DiagnosticItemIdentity {
    /// The queue that produced this. A ticket that outlived its queue must
    /// never answer for a later one.
    pub(super) operation: u64,
    pub(super) item_index: usize,
    pub(super) source_file_name: String,
    /// What this item's outputs look like. A known single output names itself;
    /// a backend-named set has no single name and does not pretend to one.
    pub(super) output: ItemOutputTopology,
    pub(super) source_kind: DatasetSourceKind,
    pub(super) attempt: u64,
}

impl ConversionFailureDiagnosticTicket {
    /// Builds a ticket for a settled conversion, or answers `None`.
    ///
    /// `None` is the common case and the important one: a conversion that
    /// finalized cleanly, or was skipped, has nothing to diagnose, and this is
    /// where that is decided rather than at export time. Residue is the one
    /// thing that makes an otherwise successful item worth describing, because
    /// something MSCanvas created is still on the user's disk.
    pub(super) fn of_report(
        identity: DiagnosticItemIdentity,
        state: ItemState,
        retryable: bool,
        report: &WorkspaceConversionReport,
        text: Option<Box<BackendDiagnosticText>>,
    ) -> Option<Self> {
        let residue = report.residue();
        if state != ItemState::Failed && residue.is_none() {
            return None;
        }
        Some(Self {
            identity,
            state,
            retryable,
            outcome: Some(report.outcome_id()),
            detailed_outcome: report.detailed_outcome_id(),
            refusal: None,
            refusal_detail: None,
            validation: report.validation_facts().cloned(),
            backend: report.backend_facts(),
            cancellation: None,
            residue,
            // Kept only where it describes something that went wrong. A
            // finalized item with cleanup residue is a run whose backend did
            // its job, and the run itself already declined to retain its text.
            text: (state == ItemState::Failed).then_some(text).flatten(),
            output_set: None,
        })
    }

    /// Builds a ticket for one backend-named set attempt.
    ///
    /// The same rule the single-output constructor follows: a ticket exists
    /// only where there is something to diagnose. A finalized set with no
    /// residue is a run that worked.
    pub(super) fn of_set(
        identity: DiagnosticItemIdentity,
        settlement: &mut super::adoption::SciexAttemptSettlement,
    ) -> Option<Self> {
        let state = settlement.state();
        let retryable = settlement.is_retryable();
        let report = settlement.report();
        let residue = report.residue();
        if state != ItemState::Failed && residue.is_none() {
            return None;
        }
        let outcome = report.group_outcome();
        let detailed_outcome = report.refusal_id();
        let backend = report.backend_facts();
        let facts = OutputSetDiagnosticFacts {
            max_members: MAX_CONVERSION_OUTPUTS_PER_SOURCE,
            member_count: report.members().len(),
            finalized_count: member_count_in(report, "finalized"),
            validated_not_published_count: member_count_in(report, "validated_not_published"),
            not_published_count: member_count_in(report, "not_published"),
            bound_source_objects: Some(report.bound_source_objects()),
            completeness: report
                .completeness()
                .map(SciexSampleCompleteness::stable_id),
            partial: report
                .partial_finalization()
                .map(|partial| PartialFinalizationFacts {
                    finalized_count: partial.finalized().len(),
                    not_published_count: partial.not_published().len(),
                    failure_kind: io_error_kind_id(partial.kind()),
                }),
            not_adoptable: settlement.not_adoptable(),
        };
        // Taken here rather than borrowed, for the reason the single path takes
        // it: the redacted text is the largest thing on the attempt and two
        // copies of it would be two things to bound.
        let text = settlement.diagnostics();
        Some(Self {
            identity,
            state,
            retryable,
            outcome: Some(set_group_outcome_id(outcome)),
            detailed_outcome,
            refusal: None,
            refusal_detail: None,
            validation: None,
            backend,
            cancellation: None,
            residue,
            text: (state == ItemState::Failed).then_some(text).flatten(),
            output_set: Some(facts),
        })
    }

    /// Builds a ticket for an attempt that never reached a conversion.
    ///
    /// Always diagnostic-worthy: this outcome exists only for a failure, and it
    /// is the one where the conversion boundary contributed nothing at all, so
    /// the session's own refusal is the whole of the evidence.
    pub(super) fn of_refusal(
        identity: DiagnosticItemIdentity,
        retryable: bool,
        error: &PreviewErrorDto,
    ) -> Self {
        let output_set = identity.output.diagnostic_shape();
        Self {
            identity,
            state: ItemState::Failed,
            retryable,
            outcome: None,
            detailed_outcome: None,
            refusal: Some(error.kind.clone()),
            refusal_detail: error.detail.as_deref().map(safe_detail),
            validation: None,
            backend: None,
            cancellation: None,
            residue: None,
            text: None,
            // A refusal reaches every family, so the shape comes from the item
            // rather than from the run it never made.
            output_set,
        }
    }

    /// Builds a ticket for an attempt a stop reached.
    ///
    /// A confirmed cancellation is not one of these unless it left something
    /// behind. The user asked for it to stop and it stopped; there is nothing
    /// wrong to describe. An unconfirmed one is the opposite — it is the least
    /// diagnosable thing this application reports, and the whole of what is
    /// known about it is here.
    pub(super) fn of_stop(
        identity: DiagnosticItemIdentity,
        state: ItemState,
        facts: CancellationFacts,
        text: Option<Box<BackendDiagnosticText>>,
        output_set: Option<OutputSetDiagnosticFacts>,
    ) -> Option<Self> {
        if state != ItemState::CancellationFailed && facts.staging_residue.is_none() {
            return None;
        }
        Some(Self {
            identity,
            state,
            // Never retryable, whichever of the two states this is. The queue
            // records the same thing for the same reason.
            retryable: false,
            outcome: None,
            detailed_outcome: None,
            refusal: None,
            refusal_detail: None,
            validation: None,
            // A stopped attempt reports its process through the cancellation
            // facts below rather than through a run report, which it never
            // produced. Carrying both would be one process described twice.
            backend: None,
            cancellation: Some(facts),
            residue: facts.staging_residue,
            text: (state == ItemState::CancellationFailed)
                .then_some(text)
                .flatten(),
            // Kept, so a stopped set item is still recognisably one. A stop
            // reaches the run before it settles, so these are the shape and
            // nothing else -- see `SetStopFacts::bound_source_objects`.
            output_set,
        })
    }

    pub(super) const fn operation(&self) -> u64 {
        self.identity.operation
    }

    /// The item state this ticket was built for.
    ///
    /// Asked at export time against the item's current state. A retry that has
    /// begun moves an item back to pending while its ticket survives, and an
    /// export must not describe that item as though its old failure were the
    /// current answer.
    pub(super) const fn describes(&self) -> ItemState {
        self.state
    }
}

/// Deliberately opaque. It holds backend text, and a `{:?}` of anything
/// containing it would put that text into a log or a panic message.
impl fmt::Debug for ConversionFailureDiagnosticTicket {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionFailureDiagnosticTicket")
            .field("diagnostic", &"<opaque-diagnostic-ticket>")
            .finish_non_exhaustive()
    }
}

/// Bounds and re-redacts one refusal's detail before a ticket keeps it.
///
/// The detail is already bounded where it is constructed, and most of them are
/// repository prose. This runs the general shape test over it anyway, because
/// "most" is not a property and a detail is the one part of a refusal that can
/// carry text this boundary did not write.
fn safe_detail(detail: &str) -> String {
    bounded_text(&redact_absolute_paths(detail), MAX_ERROR_DETAIL_CHARS)
}

/// The safe provider facts one queue ran against.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct DiagnosticsProviderFacts {
    pub(super) release: Option<String>,
    pub(super) build_date: Option<String>,
    pub(super) source_revision: Option<String>,
    /// The msconvert executable's SHA-256, where discovery bound one. The path
    /// it was read from is never carried.
    pub(super) executable_sha256: Option<String>,
}

/// Everything the export says about the queue itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DiagnosticsQueueFacts {
    pub(super) operation: u64,
    pub(super) terminal_reason: &'static str,
    pub(super) conflict_policy: ConversionConflictPolicyDto,
    pub(super) retry_round: u64,
    pub(super) item_count: usize,
    pub(super) finalized_count: usize,
    pub(super) skipped_count: usize,
    pub(super) failed_count: usize,
    pub(super) cancelled_count: usize,
    pub(super) not_run_count: usize,
    pub(super) cancellation_failed_count: usize,
    pub(super) installation_generation: u64,
    /// A refusal that ended the whole queue, by its stable identifier.
    pub(super) queue_error: Option<String>,
}

/// One terminal queue's whole diagnostic answer, ready to be written.
pub(super) struct DiagnosticsExportRequest {
    pub(super) queue: DiagnosticsQueueFacts,
    pub(super) provider: DiagnosticsProviderFacts,
    pub(super) tickets: Vec<Arc<ConversionFailureDiagnosticTicket>>,
}

/// Where the session's one diagnostics export is.
///
/// One slot, like the conversion queue's, and for the same reason: this is an
/// action on the queue that is on screen, and a list of them would be a list
/// nothing reads a second entry of. It holds no path at any point.
#[derive(Debug)]
pub(super) struct DiagnosticsExportSlot {
    next_reservation: u64,
    state: ExportState,
    /// What the last export of the current queue wrote.
    ///
    /// Kept so a document that reloaded while one was writing can still learn
    /// that it happened, and so the panel can go on saying so. Dropped when the
    /// queue is replaced. It is a filename, a length and a digest: nothing here
    /// says where the file went.
    last: Option<ConversionDiagnosticsExportDto>,
}

#[derive(Debug, Clone)]
enum ExportState {
    Idle,
    /// A reservation was issued and has not been claimed, or has been claimed
    /// and its picker is open. Both are the same fact to a reader: no
    /// destination has been accepted, so nothing has been created.
    AwaitingDestination {
        reservation: DiagnosticsReservationId,
        claimed: bool,
        document_epoch: u64,
        operation: u64,
        retry_round: u64,
    },
    /// A destination was chosen and the bytes are being written.
    ///
    /// Nameless on purpose. Which queue is being written was fixed by the claim
    /// that got here, and only one export exists at a time, so a second field
    /// naming it again would be a second place for that answer to live.
    Writing,
}

impl Default for DiagnosticsExportSlot {
    fn default() -> Self {
        Self {
            // Begins at one, so zero is never a live identifier.
            next_reservation: 1,
            state: ExportState::Idle,
            last: None,
        }
    }
}

impl DiagnosticsExportSlot {
    /// Whether an export is between being asked for and being finished.
    ///
    /// This is what every action on the terminal queue asks before it proceeds.
    /// An idle slot and a finished export are both "no": the file is written
    /// and the queue is exactly as it was.
    pub(super) const fn is_busy(&self) -> bool {
        matches!(
            self.state,
            ExportState::AwaitingDestination { .. } | ExportState::Writing
        )
    }

    pub(super) const fn last(&self) -> Option<&ConversionDiagnosticsExportDto> {
        self.last.as_ref()
    }

    /// Issues one reservation for one terminal queue, refusing while busy.
    pub(super) fn begin(
        &mut self,
        document_epoch: u64,
        operation: u64,
        retry_round: u64,
    ) -> DiagnosticsReservationHandle {
        let reservation = DiagnosticsReservationId(self.next_reservation);
        self.next_reservation = self
            .next_reservation
            .checked_add(1)
            .expect("a session issues fewer than u64::MAX diagnostics reservations");
        self.state = ExportState::AwaitingDestination {
            reservation,
            claimed: false,
            document_epoch,
            operation,
            retry_round,
        };
        DiagnosticsReservationHandle(reservation.handle())
    }

    /// Consumes one exact reservation before its picker is dispatched.
    ///
    /// An unknown, already-claimed or replaced identifier is refused without
    /// disturbing the slot. A reservation issued to a document that has since
    /// been replaced is refused for the reason every other reservation is: the
    /// document that would receive the answer is gone.
    pub(super) fn claim(
        &mut self,
        reservation_id: &str,
        document_epoch: u64,
    ) -> Result<(), PreviewErrorDto> {
        let requested = DiagnosticsReservationId::parse(reservation_id)
            .ok_or_else(invalid_diagnostics_reservation)?;
        let ExportState::AwaitingDestination {
            reservation,
            claimed,
            document_epoch: bound_epoch,
            operation,
            retry_round,
        } = self.state
        else {
            return Err(invalid_diagnostics_reservation());
        };
        if reservation != requested || claimed || bound_epoch != document_epoch {
            return Err(invalid_diagnostics_reservation());
        }
        self.state = ExportState::AwaitingDestination {
            reservation: requested,
            claimed: true,
            document_epoch: bound_epoch,
            operation,
            retry_round,
        };
        Ok(())
    }

    /// Moves one exact claimed reservation into writing, and says which queue
    /// and settling it turned out to be about.
    ///
    /// Named by the reservation for the reason a cancellation is: the interval
    /// between the claim and the chosen destination is a modal dialog lasting
    /// as long as the user takes, a reload inside it can leave that window on
    /// screen while a replacement opens its own, and two dialogs for one
    /// terminal queue carry the same operation and the same settling. Only the
    /// identifier tells them apart, so an abandoned window cannot consume a
    /// replacement's reservation and write to somewhere that user never chose.
    ///
    /// The queue and the settling are *answered with* rather than asked for, so
    /// there is one place they come from and no caller can pair a reservation
    /// with a round it does not belong to.
    pub(super) fn start_writing(&mut self, reservation_id: &str) -> Option<(u64, u64)> {
        let requested = DiagnosticsReservationId::parse(reservation_id)?;
        let ExportState::AwaitingDestination {
            reservation,
            claimed: true,
            operation,
            retry_round,
            ..
        } = self.state
        else {
            return None;
        };
        if reservation != requested {
            return None;
        }
        self.state = ExportState::Writing;
        Some((operation, retry_round))
    }

    /// Records what one export wrote and returns the slot to idle.
    ///
    /// Answers whether a reader can see the difference, like every other
    /// transition here. Finishing always can: either the slot stopped being
    /// busy, or a result appeared, or both.
    pub(super) fn finish(&mut self, result: Option<ConversionDiagnosticsExportDto>) -> bool {
        if let Some(result) = result {
            self.last = Some(result);
        }
        self.state = ExportState::Idle;
        true
    }

    /// Returns the slot to idle after one exact dialog closed with nothing.
    ///
    /// Named by the queue and the settling it was opened for, exactly as a
    /// conversion picker's cancellation is named by its operation. A dialog
    /// outlives the document that opened it: a reload releases the reservation
    /// while the window is still on screen, the replacement can begin an export
    /// of its own, and the old dialog then closes and reports that it closed.
    /// An unnamed cancel would take the replacement's reservation with it, and
    /// the file the user was in the middle of choosing would be refused.
    /// Named by the reservation and by nothing weaker. Two dialogs for one
    /// terminal queue carry the same operation and the same settling, so those
    /// cannot tell the abandoned one from the live one; the identifier can,
    /// because exactly one was ever issued for each.
    pub(super) fn cancel(&mut self, reservation_id: &str) -> bool {
        let Some(requested) = DiagnosticsReservationId::parse(reservation_id) else {
            return false;
        };
        let ExportState::AwaitingDestination { reservation, .. } = self.state else {
            return false;
        };
        if reservation != requested {
            return false;
        }
        self.state = ExportState::Idle;
        true
    }

    /// Ends a write that is still under way, and nothing else.
    ///
    /// Called by the guard that owns a write on every path out of it, including
    /// a panic, which is why it cannot be conditional on the write having
    /// failed: a flag left set would leave the session unable to export again
    /// for the rest of its life.
    ///
    /// It *is* conditional on the slot still being that write. A successful
    /// export returns the slot to idle before its guard falls, and another
    /// export may reserve inside that interval -- so a release that fired
    /// whatever it found would clear a reservation belonging to somebody else,
    /// and the file that user was about to choose would be refused.
    ///
    /// The last recorded export is left alone either way: an export that ended
    /// did not undo an earlier one.
    pub(super) fn release_write(&mut self) -> bool {
        if !matches!(self.state, ExportState::Writing) {
            return false;
        }
        self.state = ExportState::Idle;
        true
    }

    /// Releases an unclaimed reservation whose document is gone.
    ///
    /// A webview can reload between Rust issuing a reservation and the document
    /// receiving it. The replacement never learns the identifier, so without
    /// this the slot would stay busy and every action on the terminal queue
    /// would be refused until the application restarted.
    ///
    /// An export that is already writing is deliberately left alone. Its bytes
    /// are going to a file the user chose, it cannot be un-asked, and the
    /// replacement document reads the result it stores rather than a state that
    /// pretends it never happened.
    pub(super) fn release_awaiting_destination(&mut self) -> bool {
        if matches!(self.state, ExportState::AwaitingDestination { .. }) {
            self.state = ExportState::Idle;
            return true;
        }
        false
    }

    /// Drops everything belonging to a queue that is being replaced.
    ///
    /// The previously exported *file* is untouched and stays exactly where the
    /// user saved it. What is dropped is this session's memory of it.
    pub(super) fn forget(&mut self) -> bool {
        let changed = self.is_busy() || self.last.is_some();
        self.state = ExportState::Idle;
        self.last = None;
        changed
    }
}

/// One issued reservation, as the webview receives it.
pub(super) struct DiagnosticsReservationHandle(pub(super) String);

/// The crate's name for how an output was judged, as the export spells it.
pub(super) const fn validation_mode_id(mode: ValidationMode) -> &'static str {
    match mode {
        ValidationMode::SourceComparison => "source_comparison",
        ValidationMode::OutputOnly => "output_only",
    }
}

/// The identifier an export writes for one set's group outcome.
///
/// The lifecycle's own spelling, passed through rather than re-derived, so the
/// export and the report cannot drift apart.
const fn set_group_outcome_id(group_outcome: &'static str) -> &'static str {
    group_outcome
}

/// How many of a set's members are in one state.
fn member_count_in(
    report: &super::conversion::WorkspaceMultiOutputConversionReport,
    state: &str,
) -> usize {
    report
        .members()
        .iter()
        .filter(|member| member.state() == state)
        .count()
}

/// A bounded, stable spelling of what the filesystem said.
///
/// Closed rather than `{:?}` over `io::ErrorKind`, because that rendering is
/// not a stable contract and an unknown kind must not become unbounded text in
/// an exported document.
const fn io_error_kind_id(kind: std::io::ErrorKind) -> &'static str {
    match kind {
        std::io::ErrorKind::AlreadyExists => "already_exists",
        std::io::ErrorKind::PermissionDenied => "permission_denied",
        std::io::ErrorKind::NotFound => "not_found",
        std::io::ErrorKind::InvalidInput => "invalid_input",
        std::io::ErrorKind::StorageFull => "storage_full",
        _ => "other",
    }
}
