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
//! Stopping arrived in two steps. A queue-level stop came first and
//! deliberately nothing narrower: it asks the running attempt to end and
//! refuses to begin any item after it. M6.8 added the two narrower ones its
//! measurement admitted — ending the item being converted while the queue
//! carries on, and settling a waiting item without converting it. There is
//! still no pause, no resume, and no removing a row from a bound queue,
//! because each of those is a different promise about work already done.
//!
//! It exists because a conversion outlives the request that started it. The
//! webview can reload at any point, and Tauri dispatches Windows invokes as
//! independent fetches, so the reply to the command that started a queue is not
//! a reliable place to learn how it went. Rust holds the answer instead, and the
//! interface reads it — on mount, and again while something is running.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use mscanvas_proteowizard::{
    BackendDiagnosticText, CancellationFailure, CancellationReport, CancellationRequest,
    ConversionIntent, FinalizedOutput, OperationRunIdentity, OwnedTreeDisposition,
    ProcessAttemptOutcome, StagedOutputEvidence, StagingResidue, Termination,
};

use super::adoption::FinalizedOutputAdoptionTicket;
use super::adoption::FinalizedOutputSetAdoptionTicket;
use super::conversion::{process_dto, staged_output_dto};
use super::destination::{
    DestinationHold, DestinationIdentity, DestinationLease, lease_destination,
};
use super::destination_policy::{DestinationPolicy, ItemDestinationBindings, ResolutionSubject};
use super::diagnostics::{
    ConversionFailureDiagnosticTicket, DiagnosticItemIdentity, DiagnosticsProviderFacts,
    DiagnosticsQueueFacts,
};
use super::dto::BackendAuthorityProjectionDto;
use super::dto::{
    AdoptionCandidateIdentityDto, ConversionAttemptResultDto, ConversionCancellationDto,
    ConversionConflictPolicyDto, ConversionDestinationStatusDto, ConversionDiagnosticsStateDto,
    ConversionItemAdoptionDto, ConversionOutputPlanDto, ConversionQueueDto, ConversionQueueItemDto,
    ConversionQueueItemStateDto, ConversionQueueTerminalReasonDto, MAX_CONVERSION_QUEUE_ITEMS,
    PreviewErrorDto, SelectedFileDto, WorkspaceConversionReservationDto,
    WorkspaceConversionStateDto, WorkspaceConversionUpdateDto, conversion_busy,
    conversion_item_not_cancellable, conversion_item_not_skippable, conversion_not_stoppable,
    invalid_conversion_reservation, queue_duplicate_dataset, queue_installation_changed,
    queue_is_empty, queue_too_large,
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
    //
    // Byte-equal or nothing, the same rule a dataset handle follows: without
    // the round-trip, several spellings of one number would all reach the same
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
//
// Retained for the length of the queue so a retry runs against the same
// directory without asking for it again — and so it can be *proved* to be the
/// same directory rather than assumed. The path never leaves this module.
#[derive(Clone)]
pub(super) struct AdmittedDestination {
    root: PathBuf,
    /// The volume serial and file id the directory was admitted with, where the
    // platform names objects that way. A path is not an object, and a queue
    // that retried on a name alone could write into whatever had since taken
    /// it.
    identity: Option<DestinationIdentity>,
    /// Lifetime, not a path lock. Retry/adoption still revalidate the name.
    _lease: Option<DestinationLease>,
}

impl PartialEq for AdmittedDestination {
    fn eq(&self, other: &Self) -> bool {
        self.root == other.root && self.identity == other.identity
    }
}

impl Eq for AdmittedDestination {}

impl AdmittedDestination {
    /// Synthetic comparison facts are confined to tests. Production retained
    /// destinations must transfer lifetime from the actual admission hold.
    #[cfg(test)]
    pub(super) const fn new(root: PathBuf, identity: Option<DestinationIdentity>) -> Self {
        Self {
            root,
            identity,
            _lease: None,
        }
    }

    pub(super) fn from_held(
        root: PathBuf,
        held: &DestinationHold,
    ) -> Result<Self, super::dto::PreviewErrorDto> {
        let lease = lease_destination(&root, held)?;
        Ok(Self {
            root,
            identity: super::destination::identity_of_hold(held),
            _lease: Some(lease),
        })
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    /// Whether a fresh admission of the same name reached the same object.
    //
    // A platform that will not answer with an identity says so, and every
    // caller here reads that as a refusal rather than as agreement: there is
    /// no weaker comparison to fall back to.
    pub(super) fn is_still(&self, other: &Self) -> bool {
        self.matches_current(&other.root, other.identity)
    }

    pub(super) fn matches_current(
        &self,
        root: &Path,
        identity: Option<DestinationIdentity>,
    ) -> bool {
        self.root == root && self.identity.is_some() && self.identity == identity
    }

    #[cfg(all(test, windows))]
    pub(super) fn lease_witness(&self) -> std::sync::Weak<std::fs::File> {
        self._lease
            .as_ref()
            .map_or_else(std::sync::Weak::new, std::sync::Arc::downgrade)
    }
}

impl fmt::Debug for AdmittedDestination {
    /// Deliberately opaque. This is the one absolute path a queue holds, and a
    /// `{:?}` of anything containing it would put a user's filesystem into a log.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<admitted-destination>")
    }
}

/// Folds one output name the way the destination volume will resolve it.
//
// The one implementation, because two would be two answers to one question.
// Windows folds by upcasing: a volume keeps an uppercase table and maps names
// through it. Lowercasing is a different relation and misses real collisions
// -- Greek final sigma is the plain example, since `to_lowercase` leaves `Σ`
// and `ς` as `σ` and `ς` while a volume upcases both to `Σ`.
//
// Rust's uppercasing is full Unicode rather than a volume's fixed table, so
// the two still disagree at the edges: `ß` expands to `SS` here and does not
// there. Where they disagree this refuses a pair the volume might have kept
// apart, which is the safe direction for a rule whose whole purpose is to
// refuse, and the honest limit of comparing names without asking the volume.
//
// The crate's staged-member duplicate check is deliberately *not* this. It
// folds ASCII only, over names one backend wrote into one private directory,
/// and its narrowness is argued where it lives.
pub(super) fn folded_output_name(name: &str) -> String {
    name.to_uppercase()
}

/// What one queue item's outputs look like before it runs.
//
// The distinction the queue could previously not make. A Thermo or Shimadzu
// row has exactly one output and its name is decided by the row's own name, so
// two items that would fight over a name are refused before a picker opens. A
// SCIEX acquisition has one to twenty-four outputs whose names the backend
// chooses, and **no name exists until it has run** -- so there is nothing to
// compare at planning time and nothing a placeholder could honestly stand for.
//
// Two named cases rather than `Option<String>`, because `None` would have to
// mean unknown, absent, failed and multi-output at once, and the four are
/// different facts.
#[derive(Clone)]
pub(super) enum ItemOutputTopology {
    /// One document, named before anything runs.
    KnownSingle { basename: String },
    /// One to `max_members` documents the backend names itself.
    //
    // Reachable now, and only through explicit family admission. A row gets
    // this shape because it was admitted as a family whose conversion boundary
    // declares that its backend names its own outputs -- never because of an
    /// extension, and never because a caller asked for it.
    BackendNamedSet { max_members: usize },
}

impl ItemOutputTopology {
    /// What a visible queue projects for this item.
    //
    // A discriminated projection rather than a string, so there is no value to
    // choose for a set that has no name. The empty string this used to
    // project was not a filename, and a wire contract that carried one would
    /// have made a blank output column the interface's problem to avoid.
    pub(super) fn to_dto(&self) -> ConversionOutputPlanDto {
        match self {
            Self::KnownSingle { basename } => ConversionOutputPlanDto::KnownSingle {
                file_name: basename.clone(),
            },
            Self::BackendNamedSet { max_members } => ConversionOutputPlanDto::BackendNamedSet {
                max_members: *max_members,
            },
        }
    }

    /// The name this item owns from the moment it is planned, if it owns one.
    //
    // A set owns nothing until it has published: its names are unknown, and a
    /// claim on an unknown name is not a claim.
    pub(super) fn planned_name(&self) -> Option<&str> {
        match self {
            Self::KnownSingle { basename } => Some(basename),
            Self::BackendNamedSet { .. } => None,
        }
    }

    /// The shape an export states for this item before it has run.
    //
    // `None` for a known single output, which says all it needs to by naming
    /// its one document.
    pub(super) fn diagnostic_shape(&self) -> Option<super::diagnostics::OutputSetDiagnosticFacts> {
        match self {
            Self::KnownSingle { .. } => None,
            Self::BackendNamedSet { max_members } => {
                Some(super::diagnostics::OutputSetDiagnosticFacts::before_the_run(*max_members))
            }
        }
    }

    /// How many names this item could ever own.
    //
    /// The per-item half of the queue name authority's bound.
    pub(super) const fn max_names(&self) -> usize {
        match self {
            Self::KnownSingle { .. } => 1,
            Self::BackendNamedSet { max_members } => *max_members,
        }
    }
}

impl fmt::Debug for ItemOutputTopology {
    /// Shape only. A known single output's name is the source's own name with
    /// another extension, and a set's names are sample identifiers.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::KnownSingle { .. } => formatter.write_str("<known-single-output>"),
            Self::BackendNamedSet { max_members } => formatter
                .debug_struct("BackendNamedOutputSet")
                .field("max_members", max_members)
                .finish(),
        }
    }
}

/// One output name a queue item owns, and which item owns it.
//
// Derived from the items rather than accumulated beside them, so there is no
// second list to keep in step. Bounded by construction: at most
// `MAX_CONVERSION_QUEUE_ITEMS` items, each owning at most
// `MAX_CONVERSION_OUTPUTS_PER_SOURCE` names -- 16 × 24 = 384 with today's
// numbers, and [`ConversionQueue::max_output_names`] states it from the
/// constants rather than from a comment.
pub(super) struct ClaimedOutputName {
    /// Folded once, at derivation, because every use of it is a comparison.
    pub(super) folded: String,
    /// As the backend or the planner spelled it. Read by the queue's own
    // refusals; the conversion lifecycle is never handed it, and names the
    /// member from its own validated list instead.
    pub(super) display: String,
    /// Which item owns it.
    pub(super) item: usize,
    /// **The object it is owned in.**
    //
    // Half the key. A name is not claimed anywhere: it is claimed in a
    // directory, and under a source-relative policy two items own the same
    /// spelling in two different directories without either being a conflict.
    pub(super) destination: AdmittedDestination,
    /// Where it sat in the list the asker was comparing, when there was one.
    pub(super) discovered_position: usize,
}

impl fmt::Debug for ClaimedOutputName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClaimedOutputName")
            .field("item", &self.item)
            .finish_non_exhaustive()
    }
}

/// The authority to admit one settled item's outputs into the workspace.
//
// Cardinality-aware rather than flattened. A set is one authority over many
// members, not many authorities: rebuilding one from its members after the
// fact would be assembling a set ticket from parts, which is the thing the
/// output-set boundary exists to refuse.
#[derive(Clone)]
pub(super) enum QueueAdoptionAuthority {
    Single(Arc<FinalizedOutputAdoptionTicket>),
    /// Compiled out of the shipped binary, like the topology that produces it.
    Set(Arc<FinalizedOutputSetAdoptionTicket>),
}

impl fmt::Debug for QueueAdoptionAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<queue-adoption-authority>")
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
    /// A stop settled this item and no backend process of it survives.
    ///
    /// **Two ways that is so, and this state is both.** A tree existed and was
    /// confirmed gone, or nothing was launched for there to be one. Which one
    /// happened is on the item's cancellation facts as `owned_tree`; describing
    /// this state as a confirmed tree would assert one for a run that never
    /// started a process, which is the conflation the disposition exists to
    /// undo.
    Cancelled,
    /// The queue never began it. Not a failure and not an attempt.
    ///
    /// A stop is one way that happens and not the only one: a session that
    /// loses track of a process it started refuses the rest of the queue, and
    /// that queue is `Completed`.
    NotRun,
    /// The user settled this item without running it, while the queue carried
    /// on with the rest.
    ///
    /// Three states now say "no process ran for this item", and they are three
    /// because they answer three different questions. `Skipped` is the conflict
    /// policy leaving an existing file alone. `NotRun` is a stopped queue never
    /// reaching it. This one is a decision the user made about this item, and
    /// the plan still holds it and still says what became of it -- which is the
    /// whole reason skipping is an outcome rather than a membership change.
    SkippedByRequest,
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
            Self::SkippedByRequest => ConversionQueueItemStateDto::SkippedByRequest,
            Self::CancellationFailed => ConversionQueueItemStateDto::CancellationFailed,
        }
    }

    /// Whether this item is still waiting for its turn.
    //
    // The queue's own position counts everything that is not this, so a state
    // added later that forgot to answer here would silently be counted as
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

/// What this row's outputs will look like, or why it cannot be queued.
//
// One definition, asked of every visible planner. The two answers are the two
// cardinalities the queue can hold, and which one a row gets is decided by the
// family it was **admitted** as — never by its extension and never by a flag a
// caller passes in. A family reaches the set arm only by having been through
// its own evidenced admission and by declaring, at the conversion boundary,
/// that its backend names its own outputs.
///
/// The intent decides the name's extension, so it is passed in rather than
/// reached for: a topology built from the shipped posture would state a name
/// the run under another admitted combination would not write.
pub(super) fn item_output_topology(
    kind: DatasetSourceKind,
    file_name: &str,
    intent: ConversionIntent,
) -> Result<ItemOutputTopology, PreviewErrorDto> {
    // Convertibility first, and for both arms. Producing an output set is a
    // statement about cardinality rather than a licence to convert: a family the
    // visible queue does not accept must be refused whichever shape its outputs
    // would have taken, or productionizing the set variant would quietly admit
    // the next multi-output family the crate learns to name.
    if !super::conversion::is_convertible(kind) {
        return Err(super::dto::dataset_not_convertible());
    }
    if super::conversion::conversion_source_kind(kind).produces_output_set() {
        // No name is derived, and that is the point. The stem of the
        // acquisition, the sample count and the sample names are all things
        // this could reach for, and every one of them would be a filename
        // MSCanvas invented for a document the backend has not written.
        return Ok(ItemOutputTopology::BackendNamedSet {
            max_members: mscanvas_proteowizard::MAX_CONVERSION_OUTPUTS_PER_SOURCE,
        });
    }
    Ok(ItemOutputTopology::KnownSingle {
        basename: super::conversion::planned_output_name(file_name, intent)
            .ok_or_else(super::dto::dataset_not_convertible)?,
    })
}

/// One dataset of a queue, and the latest thing that happened to it.
#[derive(Clone)]
pub(super) struct QueueItem {
    dataset: DatasetId,
    /// The logical acquisition anchor captured with this item at BEGIN, under
    /// the workspace mutation gate. Resolution must not consult the registry
    /// again after a user pause. Filesystem objects are admitted separately.
    resolution_subject: ResolutionSubject,
    /// The dataset's request epoch as it stood when the queue was created, read
    // rather than claimed. Claiming would supersede whatever the user was
    /// already doing with the row merely by opening a picker they might cancel.
    request_epoch: u64,
    kind: DatasetSourceKind,
    dataset_dto: SelectedFileDto,
    /// What this item's outputs look like, and for a known single output what
    // it will be called.
    //
    // Derived before the queue existed, so two items that would fight over one
    // name are refused before a picker opens -- for the items whose names can
    // be known that early. A backend-named set has none to compare, and says
    /// so rather than carrying a placeholder.
    output: ItemOutputTopology,
    state: ItemState,
    attempts: u64,
    report: Option<super::conversion::WorkspaceConversionReport>,
    /// The group report of a backend-named set's latest attempt.
    //
    // Its own field rather than a variant of `report`, because the two
    // describe different shapes and nothing reads both. Boxed because it is
    /// much the larger of the two and the queue is cloned on every read.
    set_report: Option<Box<super::conversion::WorkspaceMultiOutputConversionReport>>,
    /// What the latest set attempt settled into.
    //
    // A set item that ran keeps this even while a retry has moved it back to
    // pending, because that is the only place its result lives: the group
    // report is its own field, so the two restoration paths below would
    // otherwise see an item with no `error` and no single-output `report` and
    /// call it never-run.
    set_state: Option<ItemState>,
    /// Which conversion the latest set attempt was.
    //
    // Allocated when that attempt finished, so a retry cannot be described by
    // the attempt before it and cannot inherit its authority. Never reaches
    /// disk and never reaches the wire.
    set_run: Option<u64>,
    /// An attempt that never reached a conversion at all.
    error: Option<PreviewErrorDto>,
    retryable: bool,
    /// What a stop established about this item's attempt, when one reached it.
    cancellation: Option<CancellationFacts>,
    /// What the latest attempt established about itself, beside its outcome.
    //
    // On the item rather than on either report, because the two reports are
    // two shapes and a cancelled item has neither. This is the one place every
    /// settled row answers judgements one and two from.
    attempt: AttemptFacts,
    /// What an adoption did with this item's finalized outputs.
    //
    // Recorded when an adoption settles, and read back on every poll and every
    // remount. Deriving it in the interface from the adoption reply would put
    // the fifth judgement in a message rather than in the queue, and it would
    /// vanish from the row the moment the document was re-read.
    adopted: ItemAdoption,
    /// The authority to admit this item's output into the workspace later.
    //
    // Shared rather than owned, because the queue this sits in is cloned on
    // every read: one retention, however many descriptions of it. Present only
    // for an item that finalized, dropped with the queue that made it, and
    /// never rebuilt from a name.
    adoption: Option<QueueAdoptionAuthority>,
    /// The names this item actually published, once it has.
    //
    // Only a backend-named set contributes to this. A known single output owns
    // its planned name from the moment the queue existed, whether or not it
    // ran, so recording it again would count it twice — and a set owns nothing
    // until it has published, because until then nobody knows what it will be
    /// called.
    published: Vec<String>,
    /// What an export may say about this item's latest attempt.
    //
    // Shared for the reason the adoption ticket is: the queue is cloned on
    // every read and the redacted text is the largest thing on it. Present only
    // where the latest attempt is worth diagnosing, replaced whole when a later
    /// attempt settles, and dropped with the queue.
    diagnostic: Option<Arc<ConversionFailureDiagnosticTicket>>,
}

/// What a stop established about one attempt, path-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CancellationFacts {
    pub(super) process_launched: bool,
    /// What the stop established about this attempt's backend process tree.
    ///
    /// The conversion boundary's own judgement, carried rather than re-decided.
    /// It replaced a boolean that answered `true` both for a tree confirmed
    /// gone and for a run that launched nothing — two facts a reader given only
    /// `true` could not tell apart, and only one of which is a claim about a
    /// process that existed.
    pub(super) owned_tree: OwnedTreeDisposition,
    /// From the moment the stop was accepted to the moment the attempt settled,
    // which is the interval the user actually waited. Not the interval the
    // process ran: an attempt that had been converting for a minute before the
    /// request would otherwise report a minute as the cost of stopping it.
    pub(super) elapsed: Duration,
    pub(super) termination: Option<Termination>,
    pub(super) staging_residue: Option<StagingResidue>,
}

impl CancellationFacts {
    fn to_dto(self) -> ConversionCancellationDto {
        ConversionCancellationDto {
            process_launched: self.process_launched,
            // Always true here: this type exists only for an attempt a stop
            // reached. Carried rather than implied so a reader never infers it.
            termination_requested: true,
            owned_tree: self.owned_tree.stable_id().to_owned(),
            elapsed_milliseconds: u64::try_from(self.elapsed.as_millis()).unwrap_or(u64::MAX),
            termination: self
                .termination
                .map(|termination| termination.stable_id().to_owned()),
            staging_residue: self
                .staging_residue
                .map(|residue| residue.stable_id().to_owned()),
        }
    }
}

impl QueueItem {
    pub(super) const fn new(
        resolution_subject: ResolutionSubject,
        request_epoch: u64,
        kind: DatasetSourceKind,
        dataset_dto: SelectedFileDto,
        output: ItemOutputTopology,
    ) -> Self {
        Self {
            dataset: resolution_subject.dataset,
            resolution_subject,
            request_epoch,
            kind,
            dataset_dto,
            output,
            state: ItemState::Pending,
            attempts: 0,
            report: None,
            set_report: None,
            set_state: None,
            set_run: None,
            error: None,
            retryable: false,
            cancellation: None,
            attempt: AttemptFacts::NOTHING_RAN,
            adopted: ItemAdoption::NotRequested,
            adoption: None,
            published: Vec::new(),
            diagnostic: None,
        }
    }

    pub(super) const fn dataset(&self) -> DatasetId {
        self.dataset
    }

    pub(super) const fn resolution_subject(&self) -> &ResolutionSubject {
        &self.resolution_subject
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

    pub(super) const fn output(&self) -> &ItemOutputTopology {
        &self.output
    }

    /// The names this item has published, once it has published any.
    pub(super) fn published(&self) -> &[String] {
        &self.published
    }

    /// Which conversion this item's latest set attempt was.
    #[cfg(test)]
    pub(super) const fn set_run(&self) -> Option<u64> {
        self.set_run
    }

    /// The group report of this item's latest set attempt.
    #[cfg(test)]
    pub(super) fn set_report(
        &self,
    ) -> Option<&super::conversion::WorkspaceMultiOutputConversionReport> {
        self.set_report.as_deref()
    }

    pub(super) fn file_name(&self) -> &str {
        &self.dataset_dto.file_name
    }

    /// The state this item earned by running, if it has run.
    //
    // `None` means it never has, which is the one case a stop may call not-run.
    // Read by both restoration paths, so an item that ran once and was moved
    // back to pending by a retry keeps the result the user has already seen --
    // its place in the counts, its reason, and the diagnostic ticket whose
    /// state must still match.
    fn earned_state(&self) -> Option<ItemState> {
        if self.error.is_some() {
            return Some(ItemState::Failed);
        }
        if let Some(report) = self.report.as_ref() {
            return Some(item_state_of(report.outcome_class()));
        }
        if let Some(state) = self.set_state {
            return Some(state);
        }
        None
    }

    /// Which item a diagnostic built here is about.
    //
    // Read from the item rather than assembled by the caller, so a ticket can
    // never be given a display name or an attempt number belonging to another
    /// row.
    fn diagnostic_identity(&self, operation: u64, item_index: usize) -> DiagnosticItemIdentity {
        DiagnosticItemIdentity {
            operation,
            item_index,
            source_file_name: self.dataset_dto.file_name.clone(),
            output: self.output.clone(),
            source_kind: self.kind,
            attempt: self.attempts,
        }
    }

    /// How many output files this item would contribute to an adoption.
    //
    // The same predicate the expansion applies, in the same order: finalized,
    // then whatever the authority holds. Written once here and read by both,
    // so the count the interface shows and the outcomes it later receives
    /// cannot disagree about how many there were.
    fn adoptable_output_count(&self) -> usize {
        if self.state != ItemState::Finalized {
            return 0;
        }
        match self.adoption.as_ref() {
            Some(QueueAdoptionAuthority::Single(_)) => 1,
            Some(QueueAdoptionAuthority::Set(ticket)) => ticket.len(),
            None => 0,
        }
    }

    fn to_dto(&self, stop_requested: bool) -> ConversionQueueItemDto {
        ConversionQueueItemDto {
            dataset_handle: self.dataset_dto.handle.clone(),
            file_name: self.dataset_dto.file_name.clone(),
            source_kind: self.dataset_dto.source_kind,
            output: self.output.to_dto(),
            state: self.state.to_dto(),
            attempts: self.attempts,
            retryable: self.retryable,
            // One arm or neither, never both. The two reports live in separate
            // fields because they are separate shapes, and this is where that
            // becomes a wire contract a reader cannot misread: an item with a
            // group report is an `outputSet` result, and there is no
            // combination of nullable fields for it to be confused with.
            result: match (self.report.as_ref(), self.set_report.as_deref()) {
                (Some(report), _) => Some(ConversionAttemptResultDto::Single {
                    report: report.to_dto(),
                }),
                (None, Some(set)) => Some(ConversionAttemptResultDto::OutputSet {
                    report: set.to_dto(matches!(
                        self.adoption.as_ref(),
                        Some(QueueAdoptionAuthority::Set(_))
                    )),
                }),
                (None, None) => None,
            },
            error: self.error.clone(),
            cancellation: self.cancellation.map(CancellationFacts::to_dto),
            stop_requested,
            process: process_dto(self.attempt.process),
            staged: staged_output_dto(self.attempt.staged),
            run_identity: self.attempt.identity.map(OperationRunIdentity::to_hex),
            adoption: self.adoption_dto(),
        }
    }

    /// The fifth judgement, as the wire carries it.
    ///
    /// Three answers that are not degrees of one another. Nobody has asked yet
    /// is not the same as having asked and been refused, and an item that never
    /// produced an adoptable output was never a candidate at all.
    fn adoption_dto(&self) -> ConversionItemAdoptionDto {
        match &self.adopted {
            ItemAdoption::NotRequested => {
                if self.adoptable_output_count() == 0 {
                    ConversionItemAdoptionDto::NothingToAdopt
                } else {
                    ConversionItemAdoptionDto::NotRequested
                }
            }
            ItemAdoption::Settled(settled) => ConversionItemAdoptionDto::Settled {
                added: settled.added,
                already_in_workspace: settled.already_in_workspace,
                refused: settled.refusals.len(),
                refusals: settled.refusals.clone(),
            },
        }
    }

    /// Records what one attempt established about itself.
    pub(super) const fn record_attempt_facts(&mut self, facts: AttemptFacts) {
        self.attempt = facts;
    }

    /// Records what an adoption did with this item's outputs.
    //
    // Replaced whole rather than accumulated. An adoption may be asked for
    // again -- a duplicate today is a row the user removes tomorrow -- and the
    /// answer a reader needs is what the latest one did.
    pub(super) fn record_adoption(&mut self, settled: SettledItemAdoption) {
        self.adopted = ItemAdoption::Settled(settled);
    }

    /// Forgets any adoption result, because a new attempt produced new outputs.
    //
    // A retry replaces the very files an earlier adoption reported on, so
    /// carrying its answer forward would describe outputs that no longer exist.
    pub(super) fn forget_adoption(&mut self) {
        self.adopted = ItemAdoption::NotRequested;
    }
}

/// What one attempt established about itself, beside its outcome.
///
/// The three facts the conversion boundary mints or observes and nothing
/// downstream can reconstruct: whether the provider was invoked, what the
/// staging area held, and which attempt this was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct AttemptFacts {
    pub(super) process: ProcessAttemptOutcome,
    pub(super) staged: StagedOutputEvidence,
    pub(super) identity: Option<OperationRunIdentity>,
}

impl AttemptFacts {
    /// An item nothing has been run for.
    ///
    /// Pending, never reached, skipped by the user, or settled by a refusal
    /// that never created anything. No identity, because no provider was
    /// invoked -- which is what keeps a skip from manufacturing a launched run.
    pub(super) const NOTHING_RAN: Self = Self {
        process: ProcessAttemptOutcome::NotAttempted,
        staged: StagedOutputEvidence::NotCreated,
        identity: None,
    };
}

/// What an adoption did with one item's outputs.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ItemAdoption {
    /// No adoption has been asked for since this item settled.
    NotRequested,
    Settled(SettledItemAdoption),
}

/// The counted result of one adoption over one item's outputs.
///
/// Bounded by the item's own output bound, and dropped with the queue. Nothing
/// here is persisted, and it is deliberately not an adoption history: it is
/// what the latest adoption did, which is the question a row can answer.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(super) struct SettledItemAdoption {
    pub(super) added: usize,
    pub(super) already_in_workspace: usize,
    /// Why each refusal happened, by stable identifier, in the order the
    /// outputs were offered.
    pub(super) refusals: Vec<String>,
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
    /// What every item of this queue is converted under.
    //
    // Bound once, when the queue is made, and never reassigned afterwards --
    // there is no setter and the field is private, so a retry re-reads this
    // same value rather than deciding again. That is the whole point of
    // keeping it here: a retry that re-derived an intent could convert the
    // second time under something the first attempt was never judged against,
    // and the user asked for one thing.
    intent: ConversionIntent,
    items: Vec<QueueItem>,
    /// Which item is running, or how many have finished when none is.
    current: usize,
    retry_round: u64,
    /// Where this queue's outputs go, as one bound user decision.
    //
    // Bound when the queue is made and never reassigned -- there is no setter
    // and the field is private, exactly as for the conflict policy and the
    // intent. A retry re-reads this rather than deciding again, which is what
    // makes "a retry never re-resolves the policy into a different destination"
    // a property of the type.
    //
    /// The *kind* is fixed here even where its input is not: a custom-folder
    /// queue knows it is one before the picker opens, and does not yet know
    /// which folder.
    policy: DestinationPolicy,
    /// The admitted object each item will be written into, once the policy has
    /// resolved.
    //
    // `None` until the authorized resolution step runs, which for a custom
    // folder is when the picker answers and for a source-relative policy is
    // when the resolution command is called. Complete by construction when it
    // is `Some`: there is no way to build one that leaves an item unbound, so
    /// no item can run against a destination nothing resolved.
    bindings: Option<ItemDestinationBindings>,
    /// The authority this queue last resolved a backend at.
    //
    // Two things at once, deliberately: its revision is the durable record of
    // which reading the queue ran under, which the diagnostics export writes
    // under ADR 0017's schema and which outlives the session; its receipt is
    // the session-scoped identity the webview compares. Kept as one value
    // because both come from one observation, and two fields updated
    /// separately are how they come to disagree.
    authority: BackendAuthorityProjectionDto,
    /// Which installation this queue's items were converted on.
    //
    // The identity itself, not the sequence that counts changes to it. A
    // counter only ever goes up, so a user who switched away from an
    // installation and back again would have a queue that could never be
    // retried -- the restored installation is the same build wearing a higher
    /// number.
    installation: Option<InstallationIdentity>,
    /// A refusal that stopped the whole queue rather than one item.
    error: Option<PreviewErrorDto>,
}

impl ConversionQueue {
    /// Builds one queue from an ordered list, or says why it is not a queue.
    //
    // Every refusal here happens before a picker opens and before anything is
    // created: an empty selection, a list longer than one session may run, and
    /// a list naming one dataset twice.
    pub(super) fn new(
        document_epoch: u64,
        conflict: ConversionConflictPolicyDto,
        intent: ConversionIntent,
        policy: DestinationPolicy,
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
            intent,
            items,
            current: 0,
            retry_round: 0,
            policy,
            bindings: None,
            // Nothing is bound at BEGIN. `ConversionQueue::new` runs before
            // the picker, and the first drain pass is what records a build --
            // so an unresolved projection here is the truthful answer rather
            // than a placeholder, and it carries no receipt.
            authority: BackendAuthorityProjectionDto::unresolved(),
            installation: None,
            error: None,
        })
    }

    pub(super) const fn conflict(&self) -> ConversionConflictPolicyDto {
        self.conflict
    }

    /// What this queue converts under, first attempt and every retry alike.
    pub(super) const fn intent(&self) -> ConversionIntent {
        self.intent
    }

    /// The bound membership, in the order it will run.
    pub(super) fn items(&self) -> &[QueueItem] {
        &self.items
    }

    /// What this queue's outputs go under, first attempt and every retry alike.
    pub(super) const fn policy(&self) -> &DestinationPolicy {
        &self.policy
    }

    /// Takes back the destinations this queue's resolution created, if this
    /// queue never attempted anything.
    ///
    /// **The invariant has to reach past `start_running`.** A resolution that
    /// fails takes back what it made, and so does a caller that refuses
    /// bindings which resolved perfectly well. But between starting and
    /// converting there is a stretch that can refuse or stop the whole queue
    /// without running a single item -- the backend is quarantined, a stop
    /// lands while this queue waits behind another, the installation will not
    /// bind, a family has no evidence -- and a queue that ends there had
    /// folders made for it and used none of them.
    ///
    /// **"Attempted nothing" is the condition, not "published nothing".** An
    /// item that ran and failed leaves the queue retryable, and a retry
    /// revalidates the objects it is bound to rather than resolving again, so
    /// taking a folder back from under a retry would turn a fixable failure
    /// into `queue_destination_changed`. A queue that attempted nothing has no
    /// retryable failure and nothing to strand.
    fn reclaim_untouched_destinations(&mut self) {
        if self.items.iter().any(|item| item.attempts > 0) {
            return;
        }
        if let Some(bindings) = self.bindings.take() {
            bindings.reclaim_created();
        }
    }

    /// The object this dataset's outputs go into.
    ///
    /// `None` where the policy has not resolved, or where this dataset is not
    /// one of the bound items. Both are refusals: a caller that cannot name an
    /// item's destination must not run it.
    pub(super) fn destination_for(&self, dataset: DatasetId) -> Option<&AdmittedDestination> {
        self.bindings
            .as_ref()?
            .destination_for(dataset)
            .map(|bound| bound.admitted())
    }

    /// Whether this dataset belongs to the queue, at any state.
    pub(super) fn holds(&self, dataset: DatasetId) -> bool {
        self.items.iter().any(|item| item.dataset == dataset)
    }

    /// The distinct source families of this queue's items, in first-appearance
    // order.
    //
    // For the provider-evidence gate, which is asked once per family rather
    // than once per queue: a queue may now mix families, and the evidence a
    // conversion is gated on is a statement about one family on one build. A
    /// set of one is the common case and costs nothing.
    pub(super) fn distinct_source_kinds(&self) -> Vec<DatasetSourceKind> {
        let mut kinds = Vec::new();
        for item in &self.items {
            if !kinds.contains(&item.kind) {
                kinds.push(item.kind);
            }
        }
        kinds
    }

    /// Every output name this queue owns right now, and which item owns it.
    //
    // Two sources, and they are different in kind. A known single output owns
    // its name from the moment the queue was planned, whether or not it has
    // run. A backend-named set owns nothing until it has published, because
    // until then nobody knows what it will be called -- so what it contributes
    // is exactly the names it did publish.
    //
    // Derived on demand rather than accumulated, so there is no second list to
    // keep in step with the items, and bounded by
    /// [`Self::max_output_names`].
    /// Every name this queue's items own, and **the object each owns it in**.
    //
    // The destination is half the key. Two items writing `sample.mzML` into two
    // directories own two different things; the same two names in one directory
    // are one claim twice. Before M6.5 there was one folder for the whole queue
    // and the object could be left out of the comparison; under a
    // source-relative policy leaving it out refuses batches that never
    /// collided.
    pub(super) fn claimed_output_names(&self) -> Vec<ClaimedOutputName> {
        let mut claimed = Vec::new();
        for (index, item) in self.items.iter().enumerate() {
            // An item whose destination nothing resolved owns nothing: there is
            // no object for a name to be claimed in. It cannot run either, so
            // this is not a hole -- it is the same refusal seen from the other
            // side.
            let Some(destination) = self.destination_for(item.dataset) else {
                continue;
            };
            if let Some(planned) = item.output().planned_name() {
                claimed.push(ClaimedOutputName {
                    folded: folded_output_name(planned),
                    display: planned.to_owned(),
                    item: index,
                    destination: destination.clone(),
                    discovered_position: 0,
                });
            }
            for published in item.published() {
                claimed.push(ClaimedOutputName {
                    folded: folded_output_name(published),
                    display: published.clone(),
                    item: index,
                    destination: destination.clone(),
                    discovered_position: 0,
                });
            }
        }
        debug_assert!(claimed.len() <= self.max_output_names());
        claimed
    }

    /// The most names this queue could ever own.
    //
    // Stated from the items' own bounds rather than from the two constants, so
    // a queue of one single-output item is bounded at one rather than at the
    // whole-queue worst case. The worst case itself is
    // `MAX_CONVERSION_QUEUE_ITEMS × MAX_CONVERSION_OUTPUTS_PER_SOURCE`, which
    // is 384 today; a known single output contributes one name and a
    // backend-named set contributes its published members, never more than its
    /// own bound.
    pub(super) fn max_output_names(&self) -> usize {
        self.items
            .iter()
            .map(|item| item.output().max_names())
            .sum()
    }

    /// Which name of `names` some *other* item already owns.
    //
    // Asked by an item that is about to publish, about the set it discovered.
    // Its own claims are skipped: an item does not collide with itself, and a
    // set republishing the names it published on an earlier attempt is a
    /// retry, not a conflict.
    pub(super) fn name_claimed_by_another(
        &self,
        item: usize,
        names: &[String],
    ) -> Option<ClaimedOutputName> {
        // The asker's own object. An item with none is not running, so nothing
        // it might have been about to write can be claimed by anybody.
        let asking_in = self
            .items
            .get(item)
            .and_then(|item| self.destination_for(item.dataset))?;
        let claimed = self.claimed_output_names();
        names.iter().enumerate().find_map(|(position, name)| {
            let folded = folded_output_name(name);
            claimed
                .iter()
                .find(|owned| {
                    // **Both halves.** A different item, the same folded name,
                    // and the same object -- by identity, so two spellings of
                    // one directory are one object and two directories are
                    // never confused for one.
                    owned.item != item
                        && owned.folded == folded
                        && owned.destination.is_still(asking_in)
                })
                .map(|owned| ClaimedOutputName {
                    folded: owned.folded.clone(),
                    display: owned.display.clone(),
                    item: owned.item,
                    destination: owned.destination.clone(),
                    // Where in the asker's own list the collision was, so a
                    // caller that must not be handed a name can still be told
                    // which one.
                    discovered_position: position,
                })
        })
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
    //
    // Only an ordinary failure counts. A cancelled item has nothing to
    // correct, a not-run item never ran, and an unconfirmed cancellation is a
    // state in which running anything at all is refused -- so none of the
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
    //
    // Deliberately not `Failed`. Nothing was launched, nothing was created and
    // nothing went wrong; calling it a failure would report work the user
    // stopped as work that broke, and would make it look retryable.
    //
    // "Never began" is decided by what the item carries, not by its pending
    // state alone. A retry moves every retryable failure back to pending, so a
    // stop landing in the middle of one finds items that are pending *now* and
    // did run in the pass before -- and calling those not run would delete a
    // failure the user has already seen, hide the reason for it, take it out of
    // the failure count, and contradict the attempt count sitting beside it.
    /// Those keep the result they earned.
    fn strand_pending(&mut self) -> usize {
        let mut stranded = 0;
        for item in &mut self.items {
            if !item.state.is_pending() {
                continue;
            }
            match item.earned_state() {
                Some(earned) => item.state = earned,
                None => {
                    item.state = ItemState::NotRun;
                    stranded += 1;
                }
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

    /// Every diagnostic-worthy item of this queue, in queue order.
    //
    // A ticket answers only for the state it was built for. A retry moves a
    // failure back to pending while its ticket survives -- deliberately, so a
    // stopped retry keeps the diagnostics of failures it never reran -- and an
    /// item in some other state now must not be described by what it used to be.
    fn diagnostic_tickets(&self, operation: u64) -> Vec<Arc<ConversionFailureDiagnosticTicket>> {
        self.items
            .iter()
            .filter_map(|item| {
                let ticket = item.diagnostic.as_ref()?;
                // The queue, and the state. The operation is asked even though a
                // ticket only ever reaches the queue that built it, for the
                // reason the adoption tickets ask their state: a binding that is
                // never checked is a binding that can quietly stop holding.
                (ticket.operation() == operation && ticket.describes() == item.state)
                    .then(|| Arc::clone(ticket))
            })
            .collect()
    }

    /// What the export says about the queue itself.
    fn diagnostic_facts(&self, operation: u64, reason: TerminalReason) -> DiagnosticsQueueFacts {
        DiagnosticsQueueFacts {
            operation,
            terminal_reason: reason.stable_id(),
            conflict_policy: self.conflict,
            retry_round: self.retry_round,
            item_count: self.items.len(),
            finalized_count: self.count(ItemState::Finalized),
            skipped_count: self.count(ItemState::Skipped),
            failed_count: self.count(ItemState::Failed),
            cancelled_count: self.count(ItemState::Cancelled),
            not_run_count: self.count(ItemState::NotRun),
            skipped_by_request_count: self.count(ItemState::SkippedByRequest),
            cancellation_failed_count: self.count(ItemState::CancellationFailed),
            installation_generation: self.authority.revision,
            queue_error: self.error.as_ref().map(|error| error.kind.clone()),
        }
    }

    /// This queue, as the webview reads it.
    //
    // `terminal` decides only the adoptable count, which is zero until the
    // queue is over for the reason the diagnostics count is: an offer to add
    /// outputs from a queue still running would be an offer Rust refuses.
    fn to_dto(&self, terminal: bool, item_stop: Option<(usize, u64)>) -> ConversionQueueDto {
        let failed = self.count(ItemState::Failed);
        let retryable = self
            .items
            .iter()
            .filter(|item| item.state == ItemState::Failed && item.retryable)
            .count();
        ConversionQueueDto {
            items: self
                .items
                .iter()
                .enumerate()
                .map(|(index, item)| item.to_dto(item_stop == Some((index, item.attempts))))
                .collect(),
            current_index: self.current,
            item_count: self.items.len(),
            retry_round: self.retry_round,
            conflict_policy: self.conflict,
            destination_policy: self.policy.to_dto(),
            destination_status: if self.bindings.is_some() {
                ConversionDestinationStatusDto::Bound
            } else {
                ConversionDestinationStatusDto::Unresolved
            },
            finalized_count: self.count(ItemState::Finalized),
            skipped_count: self.count(ItemState::Skipped),
            failed_count: failed,
            retryable_failed_count: retryable,
            non_retryable_failed_count: failed - retryable,
            cancelled_count: self.count(ItemState::Cancelled),
            not_run_count: self.count(ItemState::NotRun),
            skipped_by_request_count: self.count(ItemState::SkippedByRequest),
            cancellation_failed_count: self.count(ItemState::CancellationFailed),
            // Output files, not finalized items. Summed from the authorities
            // the items actually hold, which is the same source the adoption
            // expands, so this count and the outcomes that follow it cannot
            // disagree about how many there were.
            adoptable_output_count: if terminal {
                self.items
                    .iter()
                    .map(QueueItem::adoptable_output_count)
                    .sum()
            } else {
                0
            },
            error: self.error.clone(),
            receipt: self.authority.receipt(),
        }
    }
}

/// Where the one slot is.
#[derive(Debug, Clone)]
enum SlotState {
    Idle,
    /// A reservation was issued and has not been claimed, or has been claimed
    // and its picker is open. Both are the same fact to a reader: no
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
    //
    // Its own state rather than a flag beside `Running`, so nothing can read
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

    /// The identifier an export writes for this reason.
    //
    // Snake case, like every other stable identifier in that document, and
    // deliberately not the wire spelling: the file is a separate contract from
    // the transfer object and neither should be read as evidence about the
    /// other.
    const fn stable_id(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Stopped => "stopped",
            Self::StopFailed => "stop_failed",
        }
    }

    /// Whether this queue may be retried in place.
    //
    // Only a queue that ran to its own end. A stopped queue is a decision the
    // user made about the whole batch, and rerunning part of it in place would
    // answer a question they did not ask; a queue whose stop could not be
    /// confirmed must not launch anything at all.
    const fn is_retryable(self) -> bool {
        matches!(self, Self::Completed)
    }
}

/// A per-item stop accepted before that attempt's handle existed.
///
/// The worker marks an item running and binds its cancellation handle in two
/// steps, and the authoritative state is readable between them: it says the
/// item is converting, which is exactly what enables *Stop this file*. A
/// request arriving there found no handle to ask and was refused -- the
/// interface offering a control and the authority rejecting it, over the same
/// item, in the same state.
///
/// So it is held instead, and [`ConversionSlot::bind_attempt`] asks the handle
/// the moment there is one. The same shape the whole-queue stop already used
/// for the same interval, named for the exact attempt rather than the queue,
/// because a stop of one item must never slide onto the next one.
#[derive(Debug)]
struct PendingItemStop {
    operation: u64,
    index: usize,
    attempt: u64,
    requested_at: Instant,
}

impl PendingItemStop {
    const fn is(&self, operation: u64, index: usize, attempt: u64) -> bool {
        self.operation == operation && self.index == index && self.attempt == attempt
    }
}

/// The exact attempt a stop request may reach.
//
// Bound to the operation, the item index *and* the attempt number, so a handle
// left over from an earlier item or an earlier retry round cannot be mistaken
/// for the live one. The queue clears it when that exact attempt settles.
struct CurrentAttempt {
    operation: u64,
    index: usize,
    attempt: u64,
    request: CancellationRequest,
    /// When this exact attempt was asked to end on its own, leaving the queue
    /// running.
    ///
    /// Lives here rather than beside the queue-level flag because that is what
    /// scopes it: `bind_attempt` replaces this record whole, so a request made
    /// against one attempt cannot be found by the next one, and a token left
    /// over from an earlier item or an earlier retry round is not the live one.
    item_stop_requested_at: Option<Instant>,
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

/// What becomes of items still waiting when a refusal ends a queue.
///
/// The caller decides, because only the caller knows whether anything of this
/// session's can still run. A refusal the session can recover from leaves a
/// waiting item waiting, so a retry that reaches it still does; a refusal that
/// quarantines the backend cannot be recovered from at all, and a row rendered
/// as "Waiting" in a queue that is over describes work that will never happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PendingDisposition {
    /// Leave them pending: this queue may yet be retried.
    Keep,
    /// Settle them as never run: nothing further of this session's will start.
    Strand,
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
//
// `sequence` is the ordering key the interface uses to discard a stale read.
// It advances on every observable transition and never rewinds, so a reply
/// that overtook another cannot install an older state.
#[derive(Debug)]
pub(super) struct ConversionSlot {
    sequence: u64,
    next_operation: u64,
    next_reservation: u64,
    operation: u64,
    state: SlotState,
    /// Monotonic for the life of one operation, and reset only when a new one
    // begins. Independent of which attempt is running, so a stop that lands
    /// between two items is still a stop.
    stop_requested: bool,
    /// When the stop was accepted, so what is reported is what the user waited
    /// rather than how long the attempt had already been running.
    stop_requested_at: Option<Instant>,
    /// The one attempt a stop may reach, when one is in flight.
    current_attempt: Option<CurrentAttempt>,
    /// A stop accepted for an attempt whose handle was not yet bound.
    pending_item_stop: Option<PendingItemStop>,
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
            stop_requested_at: None,
            current_attempt: None,
            pending_item_stop: None,
        }
    }
}

impl ConversionSlot {
    /// Whether a queue currently occupies the machine or the workspace.
    //
    // A terminal queue does not: it is a thing to read, not work in flight.
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
    //
    // Used to refuse removing any row a live queue names while leaving every
    // other row removable. A terminal queue protects nothing: the work is over,
    // and its report is about rows the user may now curate.
    //
    // A stopping queue protects its rows exactly as a running one does. The
    // request has been made and the attempt has not settled, so the row may
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
    //
    // Replaces a terminal queue rather than accumulating beside it: starting a
    // conversion is the user saying the previous result is no longer what they
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
        self.stop_requested_at = None;
        self.current_attempt = None;
        self.pending_item_stop = None;
        self.advance();
        Ok(WorkspaceConversionReservationDto {
            reservation_id: reservation.handle(),
        })
    }

    /// Consumes one exact reservation before its picker is dispatched.
    //
    // An unknown, already-claimed or replaced identifier is refused without
    // disturbing the live slot. A reservation issued to a document that has
    // since been replaced is refused for the same reason a folder import is:
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
    //
    // Read from the slot rather than handed back by `claim`, so the value that
    // decides what is converted never leaves this module and a caller cannot
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
    //
    // A stopping queue is still the worker's: the attempt it holds has to be
    // settled and the queue has to be terminalized, and only the worker can do
    // either. What stopping changes is that no further item may begin, which
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
    //
    // Asked by the worker after the backend gate, before every item and after
    // every settle. It is one boolean rather than a state comparison so that a
    // request accepted while the worker was inside a process is not missed by
    /// a worker that only ever looked at the state it left behind.
    pub(super) fn stop_requested(&self, operation: u64) -> bool {
        self.operation == operation && self.stop_requested
    }

    /// How long ago the stop was accepted, for the attempt that is settling.
    pub(super) fn stop_requested_ago(&self, operation: u64) -> Option<Duration> {
        if self.operation != operation {
            return None;
        }
        self.stop_requested_at.map(|at| at.elapsed())
    }

    /// Accepts one stop for the running or stopping queue of this document.
    //
    // Everything it does is under the caller's lock and none of it terminates
    // anything: it records the request, moves the state, and hands back the
    // one handle the caller should ask outside the lock. Asking a job to end
    // while holding the lock every reader needs would make the interface stop
    // answering for as long as termination took.
    // The document is proved by the caller, exactly as a retry proves it: the
    // authority that matters is being the *current* document, not the one that
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
        self.stop_requested_at = Some(Instant::now());
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
    //
    // Replaces whatever was there: only one attempt of one queue runs at a
    // time, and an entry that outlived its attempt is exactly what must not be
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
        // A stop accepted between the transition that started this item and
        // this binding found no handle to ask, because there was none yet to
        // find. Asked here, in the same lock acquisition that stores it, so
        // that request cannot fall between the two -- otherwise the queue would
        // say it was stopping while a conversion of unknown length ran to its
        // own end. Reachable only through that exact interval: a stop recorded
        // any earlier makes `start_item` refuse, and this is never called.
        if self.stop_requested {
            request.request();
        }
        // And the same for a stop of this exact item accepted in that interval.
        // Asked here, in the same lock acquisition that stores the handle, so
        // the request cannot fall between the two either.
        //
        // Taken whether or not it matches. The queue runs one attempt at a
        // time, so an unbound request still held when a *different* attempt
        // binds is a request whose attempt is over -- and leaving it would let
        // it answer a later stop of the live attempt with "already asked".
        let item_stop_requested_at = self
            .pending_item_stop
            .take()
            .filter(|pending| pending.is(operation, index, attempt))
            .map(|pending| pending.requested_at);
        if item_stop_requested_at.is_some() {
            request.request();
        }
        self.current_attempt = Some(CurrentAttempt {
            operation,
            index,
            attempt,
            request,
            item_stop_requested_at,
        });
    }

    /// Asks the one attempt in flight to end, leaving the queue running.
    ///
    /// Bound to the exact operation, item and attempt. A caller holding an
    /// identity from a moment ago is refused rather than redirected: the item
    /// it named may have settled and the next one begun, and a request that
    /// slid onto that one would cancel work nobody asked about.
    ///
    /// **A queue stop takes precedence and is not undone by this.** Once a
    /// whole-queue stop has been accepted there is no "continue" left to
    /// preserve, so this refuses rather than adding a second meaning to a
    /// decision the user already made.
    pub(super) fn request_item_stop(
        &mut self,
        operation: u64,
        index: usize,
        attempt: u64,
    ) -> Result<StopAccepted, PreviewErrorDto> {
        if self.operation != operation {
            return Err(conversion_item_not_cancellable());
        }
        // `Running` only. `Stopping` is the whole queue already ending, and a
        // terminal or idle slot has no attempt of this caller's in flight.
        if !matches!(self.state, SlotState::Running { .. }) || self.stop_requested {
            return Err(conversion_item_not_cancellable());
        }
        // The interval between the transition that started this item and the
        // binding of its handle. The queue already says this attempt is
        // running -- that is what put the control on screen -- so refusing here
        // would refuse a control the authoritative state itself offered. Held
        // for `bind_attempt`, which asks the handle as soon as there is one.
        if self.current_attempt.is_none() && self.item_is_attempting(operation, index, attempt) {
            if self.pending_item_stop.is_some() {
                return Ok(StopAccepted::AlreadyRequested);
            }
            self.pending_item_stop = Some(PendingItemStop {
                operation,
                index,
                attempt,
                requested_at: Instant::now(),
            });
            self.advance();
            // Nothing to ask yet. The handle does not exist, and the record
            // above is what makes sure the request reaches the one that will.
            return Ok(StopAccepted::Requested(None));
        }
        let Some(current) = self.current_attempt.as_mut() else {
            return Err(conversion_item_not_cancellable());
        };
        if !current.is(operation, index, attempt) {
            return Err(conversion_item_not_cancellable());
        }
        if current.item_stop_requested_at.is_some() {
            return Ok(StopAccepted::AlreadyRequested);
        }
        current.item_stop_requested_at = Some(Instant::now());
        let request = current.request.clone();
        // No slot transition. The queue is not stopping -- one attempt is --
        // and moving to `Stopping` would tell every reader that no later item
        // will start, which is the opposite of what this action promises.
        self.advance();
        Ok(StopAccepted::Requested(Some(request)))
    }

    /// Whether the queue's own state says this exact attempt is converting.
    ///
    /// Read from the queue rather than from the bound handle, because the two
    /// are what disagree in the interval this exists for.
    fn item_is_attempting(&self, operation: u64, index: usize, attempt: u64) -> bool {
        self.running(operation).is_some_and(|queue| {
            queue
                .items
                .get(index)
                .is_some_and(|item| item.state == ItemState::Running && item.attempts == attempt)
        })
    }

    /// The one item whose own stop is outstanding, for the state the webview
    /// reads.
    ///
    /// Both halves, because both are the same fact at different moments: a
    /// request held for a handle that does not exist yet, and one already made
    /// on the handle that does.
    fn item_stop_in_flight(&self) -> Option<(usize, u64)> {
        self.current_attempt
            .as_ref()
            .filter(|current| {
                current.operation == self.operation && current.item_stop_requested_at.is_some()
            })
            .map(|current| (current.index, current.attempt))
            .or_else(|| {
                self.pending_item_stop
                    .as_ref()
                    .filter(|pending| pending.operation == self.operation)
                    .map(|pending| (pending.index, pending.attempt))
            })
    }

    /// How long the user has waited for a stop of this exact attempt.
    ///
    /// The per-attempt request where there is one, and the queue-level request
    /// otherwise. Either way it is measured from when the stop was accepted
    /// rather than from when the attempt began: an item converting for a minute
    /// before the request must not report a minute as the cost of stopping it.
    pub(super) fn stop_requested_ago_for(
        &self,
        operation: u64,
        index: usize,
        attempt: u64,
    ) -> Option<Duration> {
        self.current_attempt
            .as_ref()
            .filter(|current| current.is(operation, index, attempt))
            .and_then(|current| current.item_stop_requested_at)
            .or_else(|| {
                self.pending_item_stop
                    .as_ref()
                    .filter(|pending| pending.is(operation, index, attempt))
                    .map(|pending| pending.requested_at)
            })
            .map(|at| at.elapsed())
            .or_else(|| self.stop_requested_ago(operation))
    }

    /// Settles one pending item terminally without launching it.
    ///
    /// The item keeps its place and the plan keeps its answer for it, which is
    /// what makes this an outcome rather than a membership change. Removing it
    /// would delete the question along with the answer, and membership is bound
    /// at BEGIN.
    ///
    /// **Only a pending item.** An item the worker has already started is a
    /// different request with a different meaning, and letting a skip slide
    /// onto it would turn one into a cancellation the user did not ask for.
    /// The check and the transition are the same lock acquisition, so a skip
    /// racing a start resolves to one or the other and never to both.
    pub(super) fn skip_pending_item(
        &mut self,
        operation: u64,
        index: usize,
    ) -> Result<(), PreviewErrorDto> {
        if self.operation != operation {
            return Err(conversion_item_not_skippable());
        }
        // A queue that is stopping settles the rest as `NotRun` on its own, and
        // a skip accepted here would claim the user chose for an item the stop
        // was already going to answer for.
        if !matches!(self.state, SlotState::Running { .. }) || self.stop_requested {
            return Err(conversion_item_not_skippable());
        }
        let Some(queue) = self.running_mut(operation) else {
            return Err(conversion_item_not_skippable());
        };
        let Some(item) = queue.items.get_mut(index) else {
            return Err(conversion_item_not_skippable());
        };
        if item.state != ItemState::Pending {
            return Err(conversion_item_not_skippable());
        }
        // **Pending is not the same as never run.** `begin_retry` moves every
        // retryable failure back to pending, so a skip during a rerun can land
        // on a row that did run in the pass before. Calling that one "you chose
        // not to convert this" would delete a failure the user has already
        // seen, hide its reason, take it out of the failure count, drop its
        // diagnostic ticket -- `diagnostic_tickets` keeps only tickets whose
        // state still matches the item's -- and leave the label sitting beside
        // an attempt count that contradicts it.
        //
        // This is the rule `strand_pending` applies to a stop, applied to one
        // item: what already ran keeps the result it earned, and the skip does
        // the part that was actually asked for, which is to take the row out of
        // this pass.
        match item.earned_state() {
            Some(earned) => item.state = earned,
            None => {
                item.state = ItemState::SkippedByRequest;
                // Not retryable, and for the reason a cancelled item is not:
                // there is no failure to correct. A user who wants it converted
                // after all starts a queue that includes it.
                //
                // Only on this branch. A row that kept an earned failure keeps
                // its own retryability, because that is a fact about the
                // failure rather than about this decision -- and a later
                // `Retry` is a fresh request of the user's, not this one
                // being undone.
                item.retryable = false;
            }
        }
        // Only where nothing is running. The position means "which item is
        // running" while one is, and "how many are done" only when none is --
        // and `recount` answers the second. Recounting here would publish a
        // number naming a different acquisition than the one being converted,
        // and in a two-item queue with one running and one skipped it names a
        // row past the end of the list.
        if !queue
            .items
            .iter()
            .any(|item| item.state == ItemState::Running)
        {
            queue.recount();
        }
        self.advance();
        Ok(())
    }

    /// Releases the handle of one exact attempt.
    //
    // Named by operation, item and attempt number so a late release cannot
    /// clear a newer attempt's handle and leave a stop with nothing to ask.
    pub(super) fn release_attempt(&mut self, operation: u64, index: usize, attempt: u64) {
        if self
            .current_attempt
            .as_ref()
            .is_some_and(|current| current.is(operation, index, attempt))
        {
            self.current_attempt = None;
        }
        // An attempt that settled before its handle was bound takes any request
        // held for it. The identity is exact, so a stale record could never
        // reach another attempt; it is dropped so it cannot answer a later
        // request for a different one with "already asked".
        if self
            .pending_item_stop
            .as_ref()
            .is_some_and(|pending| pending.is(operation, index, attempt))
        {
            self.pending_item_stop = None;
        }
    }

    /// Releases a reservation whose document is gone.
    //
    // A webview can reload between Rust issuing a reservation and the document
    // receiving it. The replacement never learns the identifier, so it can
    // neither claim it nor begin another queue -- and the slot would stay busy,
    // with adding, clearing and previewing refused, until the application
    // restarted.
    //
    // A queue already running is deliberately left alone. Its process is under
    // way, its results are what the replacement document will read, and
    /// nothing here can stop it.
    pub(super) fn release_awaiting_destination(&mut self) {
        if matches!(self.state, SlotState::AwaitingDestination { .. }) {
            self.state = SlotState::Idle;
            self.advance();
        }
    }

    /// Marks one exact claimed operation as running, against one destination.
    //
    // Named rather than implied, because the slot lock is released while a
    // destination is admitted -- filesystem work that takes as long as it
    // takes. A reload in that window releases the slot, and a caller that
    // transitioned whatever it found could mark a *replacement* operation as
    /// running and then overwrite it with the old one's results.
    /// Installs resolved bindings and starts the queue, or hands them back.
    ///
    /// **`Err` returns the bindings rather than dropping them.** The slot can
    /// refuse a resolution that succeeded -- the reservation moved on while the
    /// objects were being proved -- and the caller is then the only one left
    /// who can take back the children that resolution created. Returning them
    /// is what makes forgetting that impossible to write.
    pub(super) fn start_running(
        &mut self,
        operation: u64,
        bindings: ItemDestinationBindings,
    ) -> Result<(), ItemDestinationBindings> {
        if self.operation != operation {
            return Err(bindings);
        }
        let SlotState::AwaitingDestination { queue, .. } = &self.state else {
            return Err(bindings);
        };
        // Every item, or none. A resolution that bound some of the queue is a
        // partial mapping, and a partial mapping must never be installed as a
        // complete one -- the items it did not name would run against nothing.
        if bindings.len() != queue.items.len() {
            return Err(bindings);
        }
        let mut queue = queue.clone();
        queue.bindings = Some(bindings);
        queue.current = 0;
        self.state = SlotState::Running { queue };
        self.advance();
        Ok(())
    }

    /// Returns the slot to idle after a cancelled picker.
    //
    // An ordinary no-op, not a failure: the user closed a dialog. The operation
    // identifier is not reused and the allocator does not rewind, so a reply
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
    //
    // The first pass records what it bound; every later pass must find the
    // same answer. A queue whose files came from two ProteoWizard builds is
    // not a batch, and silently mixing them would put outputs that cannot be
    /// compared under one result.
    pub(super) fn bind_installation(
        &mut self,
        operation: u64,
        installation: Option<InstallationIdentity>,
        projection: BackendAuthorityProjectionDto,
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
        queue.authority = projection;
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
    // it is.
    //
    // Refuses once a stop has been requested, whatever the worker believed
    // when it decided to start. The worker checks first, but the request can
    // land in the interval between that check and this call, and an item that
    // began after the user asked for the queue to stop is the one thing this
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
    //
    // The item's own outcome, never the queue's: one file failing marks that
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
        // Read before the item is borrowed. A ticket needs the folder *this
        // item* was written into -- which under a source-relative policy is not
        // the same object as the item beside it, and is what makes an adoption
        // look in the right place.
        let destination = queue
            .items
            .get(index)
            .and_then(|item| queue.destination_for(item.dataset).cloned());
        let Some(item) = queue.items.get_mut(index) else {
            return false;
        };
        match outcome {
            ItemOutcome::Reported {
                state,
                retryable,
                attempt,
                report,
                finalized,
                diagnostics,
            } => {
                item.state = state;
                item.retryable = retryable;
                item.record_attempt_facts(attempt);
                // Replaced whole, including with `None`. A rerun that succeeded
                // removes the failure this item used to carry, which is the
                // whole meaning of "the latest attempt": an export after a
                // successful retry must not describe the attempt before it.
                item.diagnostic = ConversionFailureDiagnosticTicket::of_report(
                    item.diagnostic_identity(operation, index),
                    state,
                    retryable,
                    &report,
                    diagnostics,
                )
                .map(Arc::new);
                item.report = Some(*report);
                item.error = None;
                // Built here and nowhere else, from a finalization that
                // actually happened. Reconstructing one later from a name and a
                // report would be exactly the path-trusting this exists to
                // avoid. A destination is always present by the time an item
                // runs; without one there is nothing to adopt from.
                // Nothing is added to `published`: a known single output owns
                // its planned name from the moment the queue existed, whether
                // or not it ran, so the claim is already derived from the
                // topology and recording it again would count it twice.
                {
                    item.set_report = None;
                    item.set_state = None;
                    item.set_run = None;
                }
                let planned = item.output.planned_name().unwrap_or_default().to_owned();
                item.adoption = finalized.zip(destination).map(|(finalized, destination)| {
                    QueueAdoptionAuthority::Single(Arc::new(FinalizedOutputAdoptionTicket::new(
                        operation,
                        item.dataset,
                        item.dataset_dto.file_name.clone(),
                        planned,
                        destination,
                        *finalized,
                    )))
                });
            }
            ItemOutcome::ReportedSet(settlement) => {
                let settlement = *settlement;
                item.state = settlement.state();
                item.retryable = settlement.is_retryable();
                item.record_attempt_facts(settlement.attempt_facts());
                item.published = settlement.published_names();
                let mut settlement = settlement;
                item.diagnostic = ConversionFailureDiagnosticTicket::of_set(
                    item.diagnostic_identity(operation, index),
                    &mut settlement,
                )
                .map(Arc::new);
                item.error = None;
                item.report = None;
                item.set_state = Some(settlement.state());
                item.set_run = Some(settlement.run());
                let (set_report, adoption) = settlement.into_parts();
                item.set_report = Some(Box::new(set_report));
                item.adoption =
                    adoption.map(|ticket| QueueAdoptionAuthority::Set(Arc::new(ticket)));
            }
            ItemOutcome::Refused {
                retryable,
                error,
                attempt,
            } => {
                item.state = ItemState::Failed;
                item.retryable = retryable;
                item.record_attempt_facts(attempt);
                // A refusal published nothing, so it releases whatever the
                // previous attempt of this item had claimed.
                item.published.clear();
                // And it describes itself, not the attempt before it. The
                // single-output report is cleared just below for the same
                // reason: "the latest attempt" has to mean the latest one.
                {
                    item.set_report = None;
                    item.set_state = None;
                    item.set_run = None;
                }
                item.diagnostic = Some(Arc::new(ConversionFailureDiagnosticTicket::of_refusal(
                    item.diagnostic_identity(operation, index),
                    retryable,
                    &error,
                )));
                item.report = None;
                item.error = Some(error);
            }
            ItemOutcome::Stopped {
                facts,
                attempt,
                set: stopped_set,
                diagnostics,
            } => {
                item.record_attempt_facts(attempt);
                // Derived here, from the conversion boundary's own judgement,
                // and nowhere else. `Cancelled` is reachable only where no
                // owned process survives -- true both of a tree confirmed gone
                // and of a run that launched nothing, and of nothing else.
                let state = if facts.owned_tree.no_owned_process_survives() {
                    ItemState::Cancelled
                } else {
                    ItemState::CancellationFailed
                };
                item.state = state;
                // Never retryable, whichever of the two states this is. A
                // cancelled item has nothing to correct, and one whose stop
                // could not be confirmed must not launch anything at all.
                item.retryable = false;
                item.diagnostic = ConversionFailureDiagnosticTicket::of_stop(
                    item.diagnostic_identity(operation, index),
                    state,
                    facts,
                    attempt,
                    diagnostics,
                    stopped_set,
                )
                .map(Arc::new);
                item.report = None;
                item.error = None;
                item.published.clear();
                {
                    item.set_report = None;
                    item.set_state = None;
                    item.set_run = None;
                }
                item.cancellation = Some(facts);
            }
        }
        // A settled attempt replaces the outputs any earlier adoption reported
        // on, so its answer is dropped rather than carried forward onto files
        // that no longer exist. Written once, after every arm, because every
        // arm is a new attempt.
        item.forget_adoption();
        // Counted rather than incremented: the queue's own position is "how
        // many are done", and after the last item that is the item count.
        queue.recount();
        self.advance();
        true
    }

    /// Records what one adoption did with each item's outputs.
    ///
    /// Guarded by the queue **and** its settling. A retry settles the same
    /// operation a second time with different files, so an answer stamped
    /// against the earlier round would describe outputs that no longer exist.
    /// Both are checked here rather than at the caller, because this is the one
    /// place that can see which settling the slot is actually holding.
    ///
    /// Answers arrive as one entry per item that was offered; an item nobody
    /// offered keeps whatever it had, which for a fresh settlement is
    /// `NotRequested`.
    pub(super) fn record_adoption(
        &mut self,
        operation: u64,
        retry_round: u64,
        settled: &[(usize, SettledItemAdoption)],
    ) -> bool {
        if self.operation != operation {
            return false;
        }
        let SlotState::Terminal { queue, .. } = &mut self.state else {
            return false;
        };
        if queue.retry_round != retry_round {
            return false;
        }
        for (index, adoption) in settled {
            if let Some(item) = queue.items.get_mut(*index) {
                item.record_adoption(adoption.clone());
            }
        }
        true
    }

    /// Ends the running queue, with an optional queue-level refusal.
    //
    // The reason is the caller's, not inferred from the items: a queue of
    // nothing but failures completed, and a queue stopped after one success
    /// did not, and no count of item states tells those apart.
    pub(super) fn finish(
        &mut self,
        operation: u64,
        error: Option<PreviewErrorDto>,
        reason: TerminalReason,
    ) {
        // Read before the queue is borrowed, and decisive. A worker observes
        // this flag and then has to take this lock to commit; a stop landing in
        // between was answered to its caller as accepted, so an ordinary
        // completion arriving afterwards must not overwrite it. Only a
        // completion is upgraded: `Stopped` and `StopFailed` are what the
        // attempt itself produced, and no flag read here can contradict them.
        let stop_requested = self.stop_requested;
        let Some(queue) = self.running_mut(operation) else {
            return;
        };
        let reason = if reason == TerminalReason::Completed && stop_requested {
            TerminalReason::Stopped
        } else {
            reason
        };
        if error.is_some() {
            queue.error = error;
        }
        queue.reclaim_untouched_destinations();
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
        self.pending_item_stop = None;
        self.advance();
    }

    /// Refuses the whole queue before any item of this pass ran.
    //
    // Distinct from an item failing: nothing was converted by this pass, and
    // the queue becomes terminal carrying the refusal.
    //
    // Anything a retry moved back to pending is put back as it was. Without
    // that, a refused retry would leave its failures neither failed nor run --
    // counted nowhere, and no longer retryable, so a user whose retry was
    // refused for a reason they can fix would have lost the failures they
    // meant to fix. A pass that never started cannot have moved anything, so
    /// on a first pass this restores nothing.
    pub(super) fn refuse(
        &mut self,
        operation: u64,
        error: PreviewErrorDto,
        pending: PendingDisposition,
    ) {
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
        queue.reclaim_untouched_destinations();
        // A refusal that lands on a stopped queue is still a stop. What refused
        // it is recorded, and everything the stop prevented is marked as never
        // run rather than left pending -- a pending item in a terminal queue is
        // counted nowhere. `strand_pending` restores what a retry moved back to
        // pending as part of that, which is why it is not repeated here.
        let reason = if self.stop_requested {
            queue.strand_pending();
            TerminalReason::Stopped
        } else if pending == PendingDisposition::Strand {
            // The session cannot run anything further, so an item still waiting
            // its turn is an item that never ran -- not one waiting for a turn
            // that will not come. A `Pending` row in a terminal queue is
            // rendered as "Waiting" and counted nowhere, which describes a
            // queue that is still going.
            queue.strand_pending();
            TerminalReason::Completed
        } else {
            // Not a stop, and the queue could still be retried. What a retry
            // moved back to pending keeps the result it earned: an item this
            // pass never reached did run in the one before, and what it carries
            // says so.
            for item in &mut queue.items {
                if !item.state.is_pending() {
                    continue;
                }
                if let Some(earned) = item.earned_state() {
                    item.state = earned;
                }
            }
            TerminalReason::Completed
        };
        queue.recount();
        queue.error = Some(error);
        self.state = SlotState::Terminal { reason, queue };
        self.current_attempt = None;
        self.pending_item_stop = None;
        self.advance();
    }

    /// Marks one failed item of a terminal queue as worth another attempt.
    //
    // There is no other way to reach the interval this exists for. A set
    // failure is retryable only when the destination could not be opened or
    // inspected -- a physical condition a deterministic test cannot produce --
    // so no test can otherwise get a set item back to pending while its result
    // lives only in its group report, which is exactly the state a stop
    // landing mid-retry must not mistake for never-run. This forges that
    /// state rather than waiting for one to exist, and changes nothing else.
    #[cfg(test)]
    pub(super) fn mark_retryable_for_test(&mut self, operation: u64, index: usize) -> bool {
        if self.operation != operation {
            return false;
        }
        let SlotState::Terminal { queue, .. } = &mut self.state else {
            return false;
        };
        let Some(item) = queue.items.get_mut(index) else {
            return false;
        };
        if item.state != ItemState::Failed {
            return false;
        }
        item.retryable = true;
        true
    }

    /// Moves every retryable failure back to pending for another pass.
    //
    // Successes, skips and non-retryable failures are left exactly as they
    // are, and the order never changes: a retry is the same queue again, not a
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

    /// Every object a terminal queue was run against, for a retry.
    //
    // All of them, not one: a source-relative policy resolves per item, and a
    /// retry revalidates each identity it will actually use.
    pub(super) fn terminal_bindings(&self) -> Option<ItemDestinationBindings> {
        match &self.state {
            SlotState::Terminal { queue, .. } => queue.bindings.clone(),
            SlotState::Idle
            | SlotState::AwaitingDestination { .. }
            | SlotState::Running { .. }
            | SlotState::Stopping { .. } => None,
        }
    }

    /// Every finalized output of a terminal queue this caller named, in queue
    // order, paired with the item each belongs to.
    //
    // `None` for anything that is not exactly that: a different operation, a
    // queue still under way, an idle slot. The caller is asking about a result
    // on screen, and only a terminal queue has one.
    //
    // Order is the queue's own and never the registry's. What the user is
    // looking at is the list the panel drew, and rows arriving in some other
    // order would be a different answer to the question they asked.
    // Which settling of a terminal queue this caller named, if it is the one
    // the slot holds.
    //
    // A retry settles the same operation again, so an answer that carried only
    // the identifier could not tell a result about the first settling from one
    /// about the second.
    pub(super) fn terminal_retry_round(&self, operation: u64) -> Option<u64> {
        if self.operation != operation {
            return None;
        }
        match &self.state {
            SlotState::Terminal { queue, .. } => Some(queue.retry_round),
            SlotState::Idle
            | SlotState::AwaitingDestination { .. }
            | SlotState::Running { .. }
            | SlotState::Stopping { .. } => None,
        }
    }

    /// The group report one terminal item of this queue kept.
    #[cfg(test)]
    pub(super) fn terminal_set_report(
        &self,
        operation: u64,
        index: usize,
    ) -> Option<super::conversion::WorkspaceMultiOutputConversionReport> {
        if self.operation != operation {
            return None;
        }
        let SlotState::Terminal { queue, .. } = &self.state else {
            return None;
        };
        queue.items.get(index)?.set_report().cloned()
    }

    /// Which conversion one terminal item's latest set attempt was.
    #[cfg(test)]
    pub(super) fn terminal_set_run(&self, operation: u64, index: usize) -> Option<u64> {
        if self.operation != operation {
            return None;
        }
        let SlotState::Terminal { queue, .. } = &self.state else {
            return None;
        };
        queue.items.get(index)?.set_run()
    }

    /// What the queue in this slot owns of the destination's namespace, and the
    // most it ever could.
    //
    // `None` when no queue is here to ask. Reads whichever queue the slot
    // holds -- waiting, running or over -- because the authority is a property
    /// of the plan rather than of the run.
    #[cfg(test)]
    pub(super) fn output_name_authority(&self) -> Option<(Vec<String>, usize)> {
        let queue = match &self.state {
            SlotState::AwaitingDestination { queue, .. }
            | SlotState::Running { queue }
            | SlotState::Stopping { queue }
            | SlotState::Terminal { queue, .. } => queue,
            SlotState::Idle => return None,
        };
        Some((
            queue
                .claimed_output_names()
                .into_iter()
                .map(|claimed| claimed.display)
                .collect(),
            queue.max_output_names(),
        ))
    }

    /// Every output this terminal queue offers to adopt, in the order it offers
    // them.
    //
    // Ordered by queue item, then by publication order within one item's set,
    // so a mixed queue's outcomes read down the screen the way the queue does.
    //
    // A set authority is **expanded here and only here**, from a ticket that
    // has already been authenticated as a set. That is the difference between
    // expanding an authority and reconstructing one: nothing is rebuilt from a
    // filename or a member report, the member tickets are the ones the set was
    // minted with, and the `Arc`s are cloned so the retained objects stay in
    // the set ticket. A second attempt asks the same objects the same
    /// questions.
    pub(super) fn terminal_adoption_tickets(
        &self,
        operation: u64,
    ) -> Option<
        Vec<(
            AdoptionCandidateIdentityDto,
            Arc<FinalizedOutputAdoptionTicket>,
        )>,
    > {
        if self.operation != operation {
            return None;
        }
        let SlotState::Terminal { queue, .. } = &self.state else {
            return None;
        };
        Some(
            queue
                .items
                .iter()
                .enumerate()
                .filter(|(_, item)| {
                    // The state and the ticket agree by construction -- only a
                    // finalization builds one -- and the state is asked anyway,
                    // so a later member of `ItemState` cannot become adoptable
                    // by inheriting a ticket it was never given.
                    item.state == ItemState::Finalized
                })
                .flat_map(|(item_index, item)| {
                    let members: Vec<Arc<FinalizedOutputAdoptionTicket>> =
                        match item.adoption.as_ref() {
                            Some(QueueAdoptionAuthority::Single(ticket)) => {
                                vec![Arc::clone(ticket)]
                            }
                            // No session check here, deliberately. The crossing
                            // it would guard is closed where it can actually be
                            // established: a ticket is minted only from a
                            // conversion of the minting session, so a queue
                            // item cannot come to hold a foreign one. Checking
                            // again here would make this predicate differ from
                            // `adoptable_output_count`'s -- and two answers to
                            // "how many outputs does this item offer" that can
                            // disagree is precisely what the count exists not
                            // to be.
                            Some(QueueAdoptionAuthority::Set(ticket)) => ticket
                                .candidates()
                                .into_iter()
                                .map(|(_, member)| member)
                                .collect(),
                            None => Vec::new(),
                        };
                    members
                        .into_iter()
                        .enumerate()
                        .map(move |(member, ticket)| {
                            (
                                AdoptionCandidateIdentityDto {
                                    item_index,
                                    // Zero for a known single output, and a real
                                    // position rather than a filler: such an item
                                    // has exactly one member and it is the first.
                                    member_index: member,
                                },
                                ticket,
                            )
                        })
                })
                .collect(),
        )
    }

    /// Everything one diagnostics export of this exact queue would describe.
    //
    // `None` for anything that is not exactly that: a different operation, a
    // queue still under way, an idle slot. The caller is asking about a result
    // on screen, and only a terminal queue has one.
    //
    // A queue whose stop could not be confirmed answers even when no item
    // carries a ticket. What that queue records about *itself* -- that MSCanvas
    // cannot say whether a converter process survived -- is the diagnosis, and
    /// it belongs to the queue rather than to any one item.
    pub(super) fn terminal_diagnostics(
        &self,
        operation: u64,
    ) -> Option<(
        DiagnosticsQueueFacts,
        DiagnosticsProviderFacts,
        u64,
        Vec<Arc<ConversionFailureDiagnosticTicket>>,
    )> {
        if self.operation != operation {
            return None;
        }
        let SlotState::Terminal { reason, queue } = &self.state else {
            return None;
        };
        let tickets = queue.diagnostic_tickets(operation);
        if tickets.is_empty() && *reason != TerminalReason::StopFailed {
            return None;
        }
        Some((
            queue.diagnostic_facts(operation, *reason),
            queue
                .installation
                .as_ref()
                .map(InstallationIdentity::diagnostic_facts)
                .unwrap_or_default(),
            queue.retry_round,
            tickets,
        ))
    }

    /// How many items an export of the current queue would describe.
    //
    // Zero unless the slot holds a terminal queue, which is what makes the
    // action's availability a projection of this rule rather than a second one
    /// the interface keeps in step.
    fn terminal_diagnostic_summary(&self) -> (usize, bool) {
        let SlotState::Terminal { reason, queue } = &self.state else {
            return (0, false);
        };
        let count = queue.diagnostic_tickets(self.operation).len();
        (count, count > 0 || *reason == TerminalReason::StopFailed)
    }

    /// The current state, as the webview reads it.
    pub(super) fn read(
        &self,
        backend_quarantined: bool,
        diagnostics: ConversionDiagnosticsStateDto,
        authority: BackendAuthorityProjectionDto,
    ) -> WorkspaceConversionUpdateDto {
        let operation_id = self.operation.to_string();
        let item_stop = self.item_stop_in_flight();
        let state = match &self.state {
            SlotState::Idle => WorkspaceConversionStateDto::Idle,
            SlotState::AwaitingDestination { queue, .. } => {
                WorkspaceConversionStateDto::AwaitingDestination {
                    operation_id,
                    queue: queue.to_dto(false, item_stop),
                }
            }
            SlotState::Running { queue } => WorkspaceConversionStateDto::Running {
                operation_id,
                queue: queue.to_dto(false, item_stop),
            },
            SlotState::Stopping { queue } => WorkspaceConversionStateDto::Stopping {
                operation_id,
                queue: queue.to_dto(false, item_stop),
            },
            SlotState::Terminal { reason, queue } => WorkspaceConversionStateDto::Terminal {
                operation_id,
                reason: reason.to_dto(),
                queue: queue.to_dto(true, item_stop),
            },
        };
        let (eligible_item_count, available) = self.terminal_diagnostic_summary();
        WorkspaceConversionUpdateDto {
            sequence: self.sequence,
            state,
            diagnostics: ConversionDiagnosticsStateDto {
                eligible_item_count,
                available,
                ..diagnostics
            },
            backend_quarantined,
            authority,
        }
    }

    /// Records that something a reader can see about diagnostics has changed.
    //
    // The diagnostics state rides on this update, so it shares this update's
    // ordering key. Without this a document would reject every read carrying a
    // diagnostics change -- it installs by sequence, and the sequence would not
    /// have moved -- and an export would appear to run for ever.
    pub(super) fn note_diagnostics_change(&mut self) {
        self.advance();
    }

    fn advance(&mut self) {
        self.sequence = self
            .sequence
            .checked_add(1)
            .expect("a session makes fewer than u64::MAX conversion transitions");
    }
}

/// What one item's attempt reached, before the queue decides what to record.
//
// Three answers rather than two. A stopped attempt is neither a conversion that
// reached an outcome nor a refusal that never reached one, and the queue needs
// the boundary's own two cancellation results to tell a confirmed stop from an
/// unconfirmed one.
#[derive(Debug)]
pub(super) enum QueueItemAttempt {
    Settled(ItemOutcome),
    Cancelled(CancellationReport),
    CancellationFailed(CancellationFailure),
    /// A stop reached a backend-named set attempt.
    //
    // Its own variant because the multi-output lifecycle reports cancellation
    // in its own vocabulary rather than through the single-output boundary's
    // two result types. What it means is identical, and `classify_attempt`
    /// turns both into the same two item states.
    SetStopped(Box<SetStopFacts>),
}

/// What a stop established about one backend-named set attempt.
//
// Everything [`CancellationFacts`] holds except the interval, which only the
// worker knows: it is measured from the moment the stop was accepted, and the
/// run has no view of that.
#[derive(Debug)]
pub(super) struct SetStopFacts {
    /// How many objects the acquisition was bound to for the run.
    //
    // The one set-shaped fact a stop knows, and the reason it is carried: a
    // stopped set item is still a set item, and an export that dropped every
    // trace of that would leave a reader unable to tell one from a stopped
    /// single-output item.
    pub(super) bound_source_objects: usize,
    /// What the stop established about the backend process tree, in the
    // conversion boundary's own vocabulary. `Unconfirmed` quarantines the
    /// backend exactly as the single-output path's does.
    pub(super) owned_tree: OwnedTreeDisposition,
    pub(super) process_launched: bool,
    pub(super) termination: Option<Termination>,
    pub(super) staging_residue: Option<StagingResidue>,
    pub(super) diagnostics: Option<Box<BackendDiagnosticText>>,
    /// What this attempt established about itself, carried from the lifecycle
    /// that ran it rather than rebuilt from the stop's own shape.
    pub(super) attempt: AttemptFacts,
}

/// What one item's attempt produced.
#[derive(Debug)]
pub(super) enum ItemOutcome {
    /// A conversion ran and reached an outcome, which may itself be a failure.
    Reported {
        state: ItemState,
        retryable: bool,
        /// What the attempt established about itself, read off the same report.
        attempt: AttemptFacts,
        report: Box<super::conversion::WorkspaceConversionReport>,
        /// The retained output, present exactly when the run finalized one.
        // Everything a later adoption needs beyond this is already on the
        // queue, so the ticket is assembled where the item settles rather than
        /// carried around half-built.
        finalized: Option<Box<FinalizedOutput>>,
        /// The redacted backend text, taken out of the run's own report.
        //
        // Present exactly where the run kept any, which is where it failed.
        // It arrives already redacted and already bounded: this side has no
        // way to obtain the raw streams and no paths with which to redact
        /// them.
        diagnostics: Option<Box<BackendDiagnosticText>>,
    },
    /// The attempt never reached a conversion at all.
    Refused {
        retryable: bool,
        error: PreviewErrorDto,
        /// What the attempt established about itself.
        ///
        /// [`AttemptFacts::NOTHING_RAN`] for every refusal this application
        /// makes on its own -- a row that moved, a source that could not be
        /// revalidated, a name another item claimed -- because none of them
        /// reaches the conversion boundary at all. Carried rather than assumed
        /// so a refusal that one day does reach it has somewhere truthful to
        /// say so.
        attempt: AttemptFacts,
    },
    /// One backend-named set attempt, settled.
    //
    // One value rather than a report beside a ticket beside an identity.
    // Everything in it was derived together from one owned conversion, so
    // nothing here can pair one attempt's report with another attempt's
    /// objects -- see [`super::adoption::SciexAttemptSettlement`].
    ReportedSet(Box<super::adoption::SciexAttemptSettlement>),
    /// A stop reached the attempt while it was running.
    //
    // Carries no conversion report by construction: a stopped attempt produced
    // no output, so there is nothing for a report to describe, and an item in
    /// this state can never name an output file.
    ///
    /// **It carries no item state either.** The state is derived from the
    /// disposition in `settle_item`, so pairing a confirmed-sounding state with
    /// an unconfirmed disposition is not something a caller can express. It was
    /// a field, and a caller writing the wrong one there would have rendered an
    /// unconfirmed stop as a success and skipped the quarantine that exists to
    /// keep the next conversion from starting beside a process nobody can
    /// account for. A repository check can only guard the spellings it knows;
    /// this removes the state a wrong spelling would have named.
    Stopped {
        facts: CancellationFacts,
        /// What the stopped attempt established about itself.
        attempt: AttemptFacts,
        /// Present exactly when the attempt was a backend-named set's.
        //
        // A stop reaches the run before it settles, so there are no member
        // facts to report — the counts are zero by construction, because the
        // two cancellation refusals this is translated from publish nothing.
        // What it carries is the shape: this was a set, of at most this many
        /// members, of an acquisition bound to this many objects.
        set: Option<super::diagnostics::OutputSetDiagnosticFacts>,
        /// Present only where the stop could not be confirmed, which is the
        /// outcome that most needs an account of what the backend was saying.
        diagnostics: Option<Box<BackendDiagnosticText>>,
    },
}
