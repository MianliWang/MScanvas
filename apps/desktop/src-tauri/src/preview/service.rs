//! The application service the Tauri commands adapt.
//!
//! This is where typed backend results become transfer objects. It is the only
//! place allowed to decide what the webview may see, and it is unit-testable
//! without a WebView or a local ProteoWizard installation.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use mscanvas_proteowizard::{
    ConversionSourceKind, LocalFileWriteError, LocalFileWriteFailure, MetadataEntry,
    MetadataResult, MetadataSectionKind, MsLevelBucket, PreviewNoResult, PreviewOutcome,
    PreviewValue, Redactor, RunSummaryResult, SelectedSpectrumResult, Sha256Digest,
    SpectrumIdentity, SpectrumTableResult, write_new_local_file,
};

// Both are used only by the one-item conversion the private orchestration
// tests drive; the queue reaches the same body through its own path.
#[cfg(test)]
use super::conversion::conversion_source_kind;
#[cfg(test)]
use mscanvas_proteowizard::ConflictPolicy;
#[allow(clippy::wildcard_imports)]
use mscanvas_proteowizard::{BackendRunFacts, ConversionAttempt, ConversionCancellation};

use super::backend::{
    ConversionBackend, PreviewProvider, open_operations, reporting_redactor,
    selected_spectrum_operation,
};
#[cfg(test)]
use super::conversion::run_planned_conversion;
use super::conversion::{
    ConvertedItem, WorkspaceConversionReport, conflict_policy, fixed_compression, is_convertible,
    plan_conversion, planned_output_name, refusal_is_retryable, refuse_unevidenced_build,
    run_planned_conversion_cancellable,
};
use super::destination::admit_destination_root;
use super::diagnostics::payload;
use super::diagnostics::{
    DIAGNOSTICS_FILE_NAME, DiagnosticsExportRequest, DiagnosticsExportSlot,
    MAX_DIAGNOSTIC_EXPORT_BYTES,
};
use super::discovery::{
    DiscoveryBudget, DiscoveryError, DiscoveryErrorKind, DiscoveryLimit, DiscoveryResult,
    discover_mzml_candidates,
};
use super::drop_ingestion::{
    ActiveDrop, DropBatch, DropCandidateOrigin, DropImportToken, DropOperationId, DropUpdateHub,
    NativeDropDispatch, NativeDropSignal, NativeDropWork, conversion_busy_state, drop_busy_state,
    expand_drop_paths,
};
use super::dto::{
    BackendAvailabilityDto, BackendFailureDto, ConversionConflictPolicyDto,
    ConversionOutputFormatDto, ConversionQueuePlanDto, ConversionQueuePlanItemDto,
    DropIngestionResultDto, MAX_CONVERSION_QUEUE_ITEMS, MAX_IDENTIFIER_CHARS, MAX_METADATA_ENTRIES,
    MAX_METADATA_LINE_CHARS, MAX_MS_LEVELS, MAX_PRECURSORS, MAX_SPECTRUM_POINTS,
    MAX_SPECTRUM_TABLE_ROWS, MetadataDto, MetadataSectionDto, MsLevelCountDto, PrecursorDto,
    PreviewDto, PreviewErrorDto, RetentionTimeDto, RetentionTimeRangeDto, RunSummaryDto,
    SelectedSpectrumDto, SelectedSpectrumOutcomeDto, SpectrumRowDto, SpectrumTableDto,
    ValidationModeDto, WorkspaceAddOutcomeDto, WorkspaceAddResultDto,
    WorkspaceConversionReservationDto, WorkspaceConversionUpdateDto, WorkspaceDropStateDto,
    WorkspaceDropSubscriptionReservationDto, WorkspaceDropUpdateDto, WorkspaceRemoveResultDto,
    WorkspaceRosterDto, bounded_text, conversion_busy, dataset_not_convertible,
    dataset_not_previewable, invalid_conversion_reservation, queue_destination_changed,
    queue_is_empty, queue_output_name_collision, queue_too_large, redact_absolute_paths,
    require_finite, require_finite_option, workspace_full,
};
use super::dto::{
    ConversionDiagnosticsExportDto, ConversionDiagnosticsReservationDto,
    ConversionDiagnosticsStateDto, MAX_CANDIDATE_NAME_CHARS, diagnostics_destination_exists,
    diagnostics_destination_unusable, diagnostics_export_in_progress,
    diagnostics_export_superseded, diagnostics_not_finalized, diagnostics_not_written,
    diagnostics_too_large, diagnostics_unavailable, invalid_diagnostics_reservation,
};
use super::dto::{
    FolderDiscoverySummaryDto, FolderImportReservationDto, FolderIngestionResultDto,
    FolderScanLimitDto, SelectedFileDto, import_superseded, invalid_folder_import_reservation,
};
use super::dto::{MAX_WORKSPACE_DATASETS, backend_quarantined, conversion_not_stoppable};
use super::dto::{
    WorkspaceOutputAdoptionOutcomeDto, WorkspaceOutputAdoptionResultDto, adoption_in_progress,
    adoption_superseded, outputs_not_adoptable,
};
use super::installation::InstallationIdentity;
use super::operation::{
    AdmittedDestination, CancellationFacts, ConversionQueue, ConversionSlot, ItemOutcome,
    ItemState, QueueItem, QueueItemAttempt, StopAccepted, TerminalReason, item_state_of,
};
use super::selection::{
    AcceptedFile, AddDatasetOutcome, DatasetId, DatasetRegistry, FileIdentity, RevocationReason,
    accept_mzml_file, accept_workspace_file, candidate_display_name, file_identity,
    lock_against_replacement, open_conversion_source, relative_contexts, revalidate,
    selected_file_dto, unknown_dataset,
};

/// The name the native save dialog offers for a diagnostics export.
///
/// Re-exposed here because the command that shows the dialog lives outside this
/// module and the diagnostics module is private to the preview boundary. It is
/// one value, so there is one name to change.
pub const DIAGNOSTICS_EXPORT_FILE_NAME: &str = DIAGNOSTICS_FILE_NAME;

const DROP_CLAIM_OPERATION_SHIFT: u32 = 32;
const DROP_CLAIM_STARTED: u64 = 1 << 31;
const DROP_CLAIM_BUSY: u64 = 1;

fn encode_drop_claim(operation_id: DropOperationId) -> u64 {
    assert!(operation_id.0 != 0 && operation_id.0 <= u64::from(u32::MAX));
    operation_id.0 << DROP_CLAIM_OPERATION_SHIFT
}

fn drop_claim_operation(claim: u64) -> Option<DropOperationId> {
    let operation = claim >> DROP_CLAIM_OPERATION_SHIFT;
    (operation != 0).then_some(DropOperationId(operation))
}

const fn drop_claim_has_busy(claim: u64) -> bool {
    claim & DROP_CLAIM_BUSY != 0
}

const fn drop_claim_started(claim: u64) -> bool {
    claim & DROP_CLAIM_STARTED != 0
}

/// Everything the session knows about the datasets it holds.
///
/// One structure behind one lock, because removing a dataset has to reach its
/// row and everything derived from it in the same breath. Split across two
/// locks there would be a moment where a dataset is gone and its preview facts
/// are not, and a reply arriving in that moment would find state to attach to.
#[derive(Debug, Default)]
struct Workspace {
    registry: DatasetRegistry,
    runtime: HashMap<DatasetId, DatasetRuntimeState>,
}

impl Workspace {
    /// Removes one dataset and everything the session derived from it.
    ///
    /// The only way a dataset should ever leave a session. Reaching the row
    /// without reaching the runtime state would leave a request epoch and a
    /// preview under an identifier nothing can name.
    fn revoke(&mut self, id: DatasetId, reason: RevocationReason) {
        // Dropped here rather than returned or kept. The removed row owns the
        // dataset's identity lease, and letting it go is what closes the
        // handle: a session that held on to it would go on pinning a file the
        // workspace no longer lists, and the user would have no row to remove
        // to get it back.
        //
        // What this cannot end early is a request that is already running. It
        // took its own hold on the file when it revalidated, because it is
        // reading it, and revocation does not cancel running work -- so the
        // object is let go when that request finishes rather than when the row
        // goes. Nothing outlives the request, which is the property that
        // matters: the file is not held by a session that has forgotten it.
        drop(self.registry.revoke(id, reason));
        // Dropping the runtime state is what makes a request still waiting for
        // its turn fail to find its epoch, and a reply that arrives afterwards
        // fail to find its dataset.
        self.runtime.remove(&id);
    }

    /// Removes every dataset and everything the session derived from them,
    /// including the identity lease each one holds.
    fn clear(&mut self, reason: RevocationReason) {
        // One at a time through the atomic path, so emptying the workspace
        // cannot come to mean something different from removing every dataset
        // in it -- including the handles: a loop that reached only the first
        // row would leave every other file pinned by a session that no longer
        // lists it. Nothing is asserted here: one lock now covers the registry
        // and everything derived from it, and a panic under it would take every
        // later command with it. What this leaves behind is checked from
        // outside instead.
        for id in self.registry.ids().to_vec() {
            self.revoke(id, reason);
        }
    }

    /// Starts a request for one dataset and hands back the epoch that names it.
    ///
    /// `None` when the dataset is not registered, which is a request for
    /// something the session no longer has.
    fn begin_request(&mut self, id: DatasetId) -> Option<u64> {
        if !self.registry.contains(id) {
            return None;
        }
        let state = self.runtime.entry(id).or_default();
        state.request_epoch += 1;
        Some(state.request_epoch)
    }

    /// Starts an open for one dataset: claims the epoch that names it, drops
    /// what the previous open recorded, and hands back the file to read.
    ///
    /// The three happen under one lock because they are one decision. The
    /// recorded preview is what a selected spectrum reconciles against, and it
    /// describes the read that produced it; the moment a newer open begins,
    /// that description is no longer the one the user is asking about. Left in
    /// place it would outlive its own open -- a reopen that fails would leave
    /// the previous open's rows silently usable, and a spectrum read afterwards
    /// would be reconciled against a table nothing on screen came from.
    ///
    /// `None` when the dataset is not registered.
    fn begin_open_request(&mut self, id: DatasetId) -> Option<(u64, AcceptedFile)> {
        let file = self.registry.get(id)?.file().clone();
        let state = self.runtime.entry(id).or_default();
        state.request_epoch += 1;
        state.preview = None;
        Some((state.request_epoch, file))
    }

    /// Starts a request that reads one dataset and changes nothing about it:
    /// claims the epoch that names it and hands back the file.
    ///
    /// Distinct from `begin_open_request`, which also discards what the previous
    /// open recorded. That discard is right for an open, which replaces the
    /// preview on screen. It is wrong for a read whose product lands somewhere
    /// else entirely: the preview the user is looking at is still a true
    /// description of this dataset afterwards, and clearing it would make a
    /// conversion behave like a reload that never finished.
    ///
    /// It still claims an epoch, because it still has to be superseded by
    /// anything the user does next.
    ///
    /// `None` when the dataset is not registered.
    #[cfg(test)]
    fn begin_reading_request(&mut self, id: DatasetId) -> Option<(u64, AcceptedFile)> {
        let file = self.registry.get(id)?.file().clone();
        let state = self.runtime.entry(id).or_default();
        state.request_epoch += 1;
        Some((state.request_epoch, file))
    }

    /// The dataset's current request epoch, without claiming one.
    ///
    /// Read rather than claimed because a conversion binds this at the moment
    /// the user asks, and asking opens a picker they may cancel. Claiming here
    /// would supersede whatever they were already doing with the row merely
    /// because a dialog appeared.
    fn current_request_epoch(&self, id: DatasetId) -> Option<u64> {
        self.registry
            .contains(id)
            .then(|| self.runtime.get(&id).map_or(0, |state| state.request_epoch))
    }

    /// Whether a request bound by [`Self::current_request_epoch`] is still the
    /// one to honour.
    ///
    /// Deliberately the exact inverse of that reader, and deliberately not
    /// `request_is_current`. That one answers about an epoch a caller *claimed*,
    /// so a dataset with no runtime row yet is not current by it -- correctly,
    /// because nobody claimed anything. A conversion binds by reading, and a
    /// row nobody has read yet reads as zero, so the two have to agree about
    /// what zero means or a first conversion of a fresh row is superseded by
    /// nothing at all.
    fn bound_request_is_current(&self, id: DatasetId, epoch: u64) -> bool {
        self.current_request_epoch(id) == Some(epoch)
    }

    /// Whether this request is still the newest one for a dataset that is still
    /// there. Anything else means the user has moved on.
    fn request_is_current(&self, id: DatasetId, epoch: u64) -> bool {
        self.registry.contains(id)
            && self
                .runtime
                .get(&id)
                .is_some_and(|state| state.request_epoch == epoch)
    }
}

/// What the webview is told the session holds.
///
/// Built from the registry's own order, which is the only order there is. The
/// capacity travels with it so the interface states the limit Rust enforces
/// rather than one of its own.
///
/// The disambiguating contexts are computed here, over the whole registry,
/// every time. Whether a filename is ambiguous is a property of the roster
/// rather than of a row: adding a second `sample.mzML` gives both of them
/// context and removing one takes it away again, so an answer stored per row
/// would be an answer to a question that had since changed.
fn roster_of(workspace: &Workspace) -> WorkspaceRosterDto {
    let contexts = relative_contexts(&workspace.registry);
    WorkspaceRosterDto {
        datasets: workspace
            .registry
            .ids()
            .iter()
            .filter_map(|id| {
                workspace.registry.get(*id).map(|dataset| {
                    selected_file_dto(*id, dataset.file(), contexts.get(id).cloned())
                })
            })
            .collect(),
        capacity: MAX_WORKSPACE_DATASETS,
    }
}

/// One dataset, described as the roster it belongs to would describe it.
///
/// Used wherever an outcome names a row, so the dataset in an outcome and the
/// same dataset in the roster beside it can never disagree about its context.
fn dataset_dto(workspace: &Workspace, id: DatasetId) -> Option<SelectedFileDto> {
    let contexts = relative_contexts(&workspace.registry);
    workspace
        .registry
        .get(id)
        .map(|dataset| selected_file_dto(id, dataset.file(), contexts.get(&id).cloned()))
}

/// What happened to one candidate, before it is described.
///
/// Held back because describing a row is a question about the finished roster,
/// and a batch is not finished until its last file has been accepted. The
/// candidate name travels with both variants because a rejection has no dataset
/// to be named by, and the user still has to be told which file it was.
enum PendingOutcome {
    Registered {
        candidate_name: String,
        outcome: AddDatasetOutcome,
    },
    Rejected {
        candidate_name: String,
        error: PreviewErrorDto,
    },
}

/// Turns a batch's registry outcomes into what the webview is told.
///
/// Run once, after the whole batch, against the roster it produced. Every
/// dataset named in an outcome is therefore described exactly as the roster
/// beside it describes the same dataset -- including its disambiguating
/// context, which cannot be known until every row that might collide with it
/// has arrived.
fn describe_outcomes(
    workspace: &Workspace,
    pending: Vec<PendingOutcome>,
) -> Vec<WorkspaceAddOutcomeDto> {
    let contexts = relative_contexts(&workspace.registry);
    let describe = |id: DatasetId| {
        workspace
            .registry
            .get(id)
            .map(|dataset| selected_file_dto(id, dataset.file(), contexts.get(&id).cloned()))
    };
    pending
        .into_iter()
        .map(|item| match item {
            PendingOutcome::Rejected {
                candidate_name,
                error,
            } => WorkspaceAddOutcomeDto::Rejected {
                candidate_name,
                error,
            },
            PendingOutcome::Registered {
                candidate_name,
                outcome,
            } => match (outcome, outcome.registered_id().and_then(describe)) {
                (AddDatasetOutcome::Added { .. }, Some(dataset)) => {
                    WorkspaceAddOutcomeDto::Added { dataset }
                }
                (AddDatasetOutcome::Duplicate { .. }, Some(existing)) => {
                    WorkspaceAddOutcomeDto::Duplicate { existing }
                }
                // Either the workspace was full, or -- unreachably -- a row
                // named by an outcome had gone by the time it was described.
                // A batch holds the mutation gate throughout, so the second
                // cannot happen; reporting it as full rather than asserting
                // keeps one command from taking a session down.
                _ => WorkspaceAddOutcomeDto::Rejected {
                    candidate_name,
                    error: workspace_full(),
                },
            },
        })
        .collect()
}

/// What one dataset's session state is.
#[derive(Debug, Default)]
struct DatasetRuntimeState {
    /// Counts the requests made for this dataset. A request that is still
    /// waiting for the backend gate when a newer one arrives never starts: the
    /// user has moved on, and launching a process for a row they left is
    /// spending the machine on an answer nobody will see. Per dataset, so work
    /// on one never cancels work on another.
    request_epoch: u64,
    preview: Option<DatasetPreviewState>,
}

/// What one open action established about one dataset.
///
/// The generation, the backend that read it and the rows a later spectrum is
/// reconciled against, committed together. Held apart they made two states
/// representable that must never occur: a recorded generation with no rows to
/// reconcile against, and rows with no record of which backend produced them.
#[derive(Debug, Clone)]
struct DatasetPreviewState {
    opened: OpenedPreview,
    table_rows: Vec<TableRowFacts>,
}

/// The narrow set of operations the desktop application exposes.
pub struct PreviewService {
    provider: Box<dyn PreviewProvider>,
    workspace: Mutex<Workspace>,
    /// Held for the length of one backend operation, so this application runs
    /// at most one process at a time. Moving the wait to a blocking thread
    /// stopped it starving the async runtime; it did nothing to stop several
    /// reads of the same large file competing for the machine.
    ///
    /// Never taken while the workspace lock is held: this one is waited on for
    /// as long as a backend process takes, and the workspace has to stay
    /// answerable in the meantime.
    backend_gate: Mutex<()>,
    /// Held for the length of one workspace mutation, so two of them cannot
    /// interleave the rows of one batch, and carrying the generation that says
    /// which decision about the workspace is the current one.
    ///
    /// Distinct from the workspace lock and always taken before it. A batch
    /// accepts each file in turn, which is filesystem work, and holding the
    /// workspace across the whole batch would leave every other command waiting
    /// on a picker's worth of inspections. This is what keeps a batch's order
    /// contiguous without doing that.
    ///
    /// A folder scan cannot hold it: scanning is filesystem work that lasts as
    /// long as the tree takes, and a workspace frozen for the length of it would
    /// be a workspace nobody could remove a row from. So the generation exists.
    /// A scan reserves one before it starts and commits only while it is still
    /// current; anything the user does that says "the workspace state from here
    /// on" advances it, and the abandoned scan then adds nothing.
    workspace_mutation: Mutex<WorkspaceMutationState>,
    /// Wakes workspace operations whose contract is to wait for the one active
    /// or callback-reserved native drop rather than supersede it.
    workspace_mutation_ready: Condvar,
    /// The accepted native drop, from the callback's linearization point until
    /// terminal publication or an authoritative superseding mutation. Zero is
    /// the empty sentinel; all real operation IDs begin at one.
    ///
    /// This atomic is intentionally separate from `workspace_mutation`: the
    /// platform event callback must be able to reserve or reject a drop without
    /// waiting for either service mutex or an IPC channel consumer.
    native_drop_claim: AtomicU64,
    next_drop_operation: AtomicU64,
    /// Latest non-`Over` callback in native arrival order. Workers compare
    /// their ticket before publishing hover/leave so inverse scheduling cannot
    /// resurrect an older visual state.
    native_drop_event_ticket: AtomicU64,
    /// One replayable, path-free state and at most one current-document IPC
    /// subscriber. Its delivery gate is always acquired before the workspace
    /// mutation gate, and `Channel::send` runs after all workspace locks drop.
    drop_updates: DropUpdateHub,
    /// How many times the installation in use has changed.
    ///
    /// Stamped onto every verdict under the same gate that serves it, so the
    /// verdict says where in that sequence it belongs. Request order is not
    /// service order -- two commands contend for this gate and it does not
    /// grant in the order they were called -- so a caller that trusted its own
    /// ordering could show the installation a choice replaced while every
    /// later operation used the chosen one.
    installation_generation: AtomicU64,
    /// The session's one conversion slot.
    ///
    /// A leaf: never held while any other lock is taken, and never held across
    /// a picker, a filesystem inspection or a backend process. Every transition
    /// is a short read-modify-write, which is what lets the workspace stay
    /// answerable for the whole of a conversion.
    conversion: Mutex<ConversionSlot>,
    /// Whether the slot above is busy, readable without taking its lock.
    ///
    /// The native drop callback must be able to refuse a drop without waiting
    /// on any service mutex, which is a rule this file already keeps for the
    /// drop claim itself. Written only while the slot lock is held, so it
    /// cannot come to disagree with what it mirrors.
    conversion_busy: AtomicBool,
    /// Whether this session has stopped trusting the backend.
    ///
    /// Set once, by a stop whose owned process tree could not be confirmed
    /// gone, and never cleared. Nothing in this session can establish that the
    /// process it lost track of has ended, so there is no observation a reset
    /// could be conditioned on -- and a flag that cleared itself would be
    /// telling the user something MSCanvas does not know.
    ///
    /// Read without a lock for the same reason the busy mirror is: every
    /// backend entry point asks it, and one of them is asked from the native
    /// drop callback.
    backend_quarantined: AtomicBool,
    /// Whether an adoption of converted outputs is between its two halves.
    ///
    /// Adoption hashes files, so it cannot hold the mutation gate across the
    /// part that reads them. This is what every other workspace mutation asks
    /// instead: lock-free, like the conversion mirror beside it, and for the
    /// same reason -- the paths that consult it must not take a lock that the
    /// adoption itself will want back.
    adopting_outputs: AtomicBool,
    /// The session's one diagnostics export.
    ///
    /// A leaf beside the conversion slot rather than a field inside it. What it
    /// holds is a reservation and a result, neither of which is queue state, and
    /// keeping them apart is what lets a queue read answer while an export is
    /// choosing a destination. Where both locks are taken, the conversion slot
    /// is taken first and this one second, always.
    diagnostics_export: Mutex<DiagnosticsExportSlot>,
    /// Whether the slot above is busy, readable without taking its lock.
    ///
    /// Written only while that lock is held, so it cannot come to disagree with
    /// what it mirrors. It exists for the same callers the conversion mirror
    /// exists for, the native drop callback among them.
    diagnostics_exporting: AtomicBool,
    /// Which backend the last look actually resolved to.
    ///
    /// Not the folder that was requested. A request names a configuration; what
    /// matters is the tool pair that configuration resolves to, and the two come
    /// apart in both directions -- automatic discovery falling back to another
    /// release after one is removed, and a folder whose binaries are upgraded in
    /// place. Comparing requests would miss both.
    resolved: Mutex<ObservedBackend>,
}

/// What the service has observed about which backend resolves.
#[derive(Default)]
struct ObservedBackend {
    /// False until something has actually looked. The first look is not a
    /// change: there is nothing before it to differ from, and counting it would
    /// make every session open by telling its callers to discard readings that
    /// do not exist yet.
    looked: bool,
    /// What the last look resolved. `None` means nothing usable resolved, which
    /// is a state a later look can differ from like any other.
    identity: Option<InstallationIdentity>,
    /// The verdict that look produced, kept so a quarantined session can answer
    /// a recheck without launching the very tools it has stopped trusting.
    last: Option<BackendAvailabilityDto>,
}

impl PreviewService {
    #[must_use]
    pub fn new(provider: Box<dyn PreviewProvider>) -> Self {
        Self {
            provider,
            workspace: Mutex::new(Workspace::default()),
            backend_gate: Mutex::new(()),
            workspace_mutation: Mutex::new(WorkspaceMutationState::default()),
            workspace_mutation_ready: Condvar::new(),
            native_drop_claim: AtomicU64::new(0),
            next_drop_operation: AtomicU64::new(1),
            native_drop_event_ticket: AtomicU64::new(0),
            drop_updates: DropUpdateHub::default(),
            conversion: Mutex::new(ConversionSlot::default()),
            conversion_busy: AtomicBool::new(false),
            backend_quarantined: AtomicBool::new(false),
            adopting_outputs: AtomicBool::new(false),
            diagnostics_export: Mutex::new(DiagnosticsExportSlot::default()),
            diagnostics_exporting: AtomicBool::new(false),
            installation_generation: AtomicU64::new(0),
            resolved: Mutex::new(ObservedBackend::default()),
        }
    }

    /// The workspace, locked. Never held across backend work.
    fn workspace(&self) -> std::sync::MutexGuard<'_, Workspace> {
        self.workspace
            .lock()
            .expect("the workspace lock is never poisoned by user code")
    }

    /// Reports whether a usable backend is installed.
    ///
    /// Behind the same gate as every other backend work: discovery runs the
    /// installed tools' help, which is as much a process as a preview is, and
    /// "at most one at a time" has to mean all of them or it means nothing.
    pub fn inspect_backend(&self) -> BackendAvailabilityDto {
        // A probe launches the tools it is probing, so it is a backend
        // operation like any other. A quarantined session answers without
        // starting two more processes beside one it may have lost track of.
        if let Some(reading) = self.quarantined_availability() {
            return reading;
        }
        let _running = self.enter_backend();
        // Asked again on this side of the gate. A caller admitted before a stop
        // began waits here for as long as the conversion takes, and the queue
        // it was waiting behind may have ended by failing to confirm that its
        // converter died. The check in front of the gate keeps an already
        // quarantined session from queueing at all; this one keeps a caller
        // that queued earlier from launching into a session that has since
        // stopped trusting the backend.
        if let Some(reading) = self.quarantined_availability() {
            return reading;
        }
        self.stamped_availability()
    }

    /// Points the backend at one folder, or back at automatic discovery, and
    /// reports what that installation can actually do.
    ///
    /// The change and the reading are one call because they are useless apart.
    /// Returning without probing would leave the caller holding a verdict about
    /// the installation it just stopped using, and a caller that then had to ask
    /// separately could render the old answer in between. There is no interval
    /// here in which the two can disagree.
    pub fn use_installation(&self, home: Option<PathBuf>) -> BackendAvailabilityDto {
        // Changing installation re-probes, which launches processes. Refused
        // without making the change either: pointing a quarantined session at
        // another folder would leave it describing an installation nothing has
        // examined.
        if let Some(reading) = self.quarantined_availability() {
            return reading;
        }
        let _running = self.enter_backend();
        // The same window the recheck has, and closed the same way. This one
        // matters more: past it the installation would actually change.
        if let Some(reading) = self.quarantined_availability() {
            return reading;
        }
        // Told unconditionally. Whether this is a change is not decided by what
        // was asked for -- the same request can resolve to a different backend
        // and a different request to the same one -- so it is decided below, by
        // what the reading that follows actually resolves to.
        self.provider.use_installation(home);
        self.stamped_availability()
    }

    /// Reads the backend, notes which one that turned out to be, and stamps the
    /// verdict with where it belongs in the sequence of changes.
    ///
    /// All of it under the gate, so the number describes the installation the
    /// verdict actually came from.
    fn stamped_availability(&self) -> BackendAvailabilityDto {
        let (mut availability, identity) = self.provider.availability();
        self.note_resolved(identity);
        availability.installation_generation = self.installation_generation.load(Ordering::Relaxed);
        self.resolved
            .lock()
            .expect("the installation lock is never poisoned by user code")
            .last = Some(availability.clone());
        availability
    }

    /// The verdict a quarantined session answers every backend question with,
    /// having launched nothing to produce it.
    ///
    /// Deliberately not the reading it had. A stale `available` would let the
    /// banner say the backend is fine while every action that uses one is
    /// refused, and the single thing the user needs to know -- that this
    /// session cannot run a converter again until it is restarted -- would
    /// appear nowhere. `unavailable` here is a statement about the session, and
    /// the failure beside it says so in the words the banner already renders.
    ///
    /// `None` when the session is not quarantined, which is every ordinary
    /// session.
    fn quarantined_availability(&self) -> Option<BackendAvailabilityDto> {
        if !self.backend_is_quarantined() {
            return None;
        }
        let last = self
            .resolved
            .lock()
            .expect("the installation lock is never poisoned by user code")
            .last
            .clone();
        Some(BackendAvailabilityDto {
            state: String::from("unavailable"),
            installation_generation: self.installation_generation.load(Ordering::Relaxed),
            // Kept from the last reading where there was one, so the banner
            // still names the installation this session was using rather than
            // claiming it went back to automatic discovery.
            origin: last.map_or_else(|| String::from("automatic"), |reading| reading.origin),
            // Nothing is claimed about a build. This verdict is not a reading of
            // one, and carrying a release beside `unavailable` would invite it
            // to be read as one.
            release: None,
            build_date: None,
            same_installation: true,
            failure: Some(BackendFailureDto {
                kind: String::from("backend_quarantined"),
                summary: String::from(
                    "MSCanvas could not confirm that the converter process stopped.",
                ),
                corrective_action: String::from(
                    "Restart MSCanvas before starting another preview or conversion.",
                ),
            }),
        })
    }

    /// Advances the sequence when the backend that resolves is a different one.
    ///
    /// The sequence counts changes of *backend*, not of configuration. A folder
    /// re-picked while its binaries were upgraded in place is a change; asking
    /// for automatic discovery while already on it is not; and a chosen folder
    /// that resolves to the very tools automatic discovery was already using is
    /// not either. Only comparing what resolved gets all three right.
    ///
    /// Returns where the sequence stands afterwards, so a caller that records
    /// it records the value its own observation produced rather than the one it
    /// found on the way in.
    fn note_resolved(&self, identity: Option<InstallationIdentity>) -> u64 {
        let mut observed = self
            .resolved
            .lock()
            .expect("the installation lock is never poisoned by user code");
        if observed.looked && observed.identity != identity {
            self.installation_generation.fetch_add(1, Ordering::Relaxed);
        }
        observed.looked = true;
        observed.identity = identity;
        self.installation_generation.load(Ordering::Relaxed)
    }

    /// Declares the start of a new webview document.
    ///
    /// Called by Tauri's native page-load-started hook, not by an IPC command.
    /// That distinction is load-bearing: a request from the document being
    /// replaced can reach Rust after the replacement document's requests, but
    /// it cannot arrive before the native event that started the replacement.
    /// Advancing here supersedes a picker or scan owned by the old document
    /// without letting one of that document's delayed roster reads supersede a
    /// new document's later import.
    pub fn begin_webview_document(&self) {
        // Enter and Leave are dispatched on blocking workers. Advancing the
        // ticket at the native page-load boundary makes every callback queued
        // by the replaced document stale before its replay state is reset.
        let _document_event_ticket = self.allocate_drop_event_ticket();
        let delivery = self.drop_updates.begin_delivery();
        let (gate, _, _pending_busy) = self.begin_superseding_mutation();
        drop(gate);
        self.drop_updates.reset_document(delivery);
        // A reservation belongs to the document that asked for it. The
        // replacement never learns the identifier, so one left awaiting a
        // destination would hold the slot -- and every workspace mutation
        // behind it -- for the rest of the session.
        let mut slot = self.conversion_slot();
        slot.release_awaiting_destination();
        self.publish_conversion_busy(&slot);
        drop(slot);
        // The same rule for the same reason, one slot over. An export already
        // writing is deliberately left alone: its bytes are going to a file the
        // user chose, nothing here can un-ask that, and the replacement document
        // learns what it wrote from the result the slot stores rather than from
        // a state that pretends it never happened.
        self.release_diagnostics_reservation();
    }

    /// Returns the native document epoch captured before a Channel handshake.
    pub(crate) fn workspace_drop_document_epoch(&self) -> u64 {
        self.drop_updates.document_epoch()
    }

    /// Begins one current-document subscription without accepting a Channel.
    pub fn begin_workspace_drop_subscription(
        &self,
        expected_document_epoch: u64,
    ) -> Result<WorkspaceDropSubscriptionReservationDto, PreviewErrorDto> {
        self.drop_updates
            .begin_subscription(expected_document_epoch)
    }

    /// Claims one exact current-document reservation and installs its typed
    /// Channel. Replacement and the initial snapshot are serialized with
    /// native updates, so the new channel sees one exact lifecycle state.
    pub fn claim_workspace_drop_subscription(
        &self,
        expected_document_epoch: u64,
        reservation_id: &str,
        channel: tauri::ipc::Channel<WorkspaceDropUpdateDto>,
    ) -> Result<(), PreviewErrorDto> {
        self.drop_updates
            .claim_subscription(expected_document_epoch, reservation_id, channel)
    }

    /// Reserves one normalized native event without taking a lock or sending
    /// through IPC. This is the complete platform-callback side of the
    /// boundary; its owned dispatch is processed on a blocking worker.
    pub(crate) fn reserve_native_drop_signal(
        &self,
        signal: NativeDropSignal<'_>,
    ) -> Option<NativeDropDispatch> {
        if matches!(signal, NativeDropSignal::Over) {
            return None;
        }
        let event_ticket = self.allocate_drop_event_ticket();
        match signal {
            NativeDropSignal::Enter { item_count } => {
                let mut claim = self.native_drop_claim.load(Ordering::Acquire);
                loop {
                    let Some(operation_id) = drop_claim_operation(claim) else {
                        return Some(NativeDropDispatch::Enter {
                            item_count,
                            event_ticket,
                            observed_operation: None,
                        });
                    };
                    if drop_claim_has_busy(claim) {
                        return Some(NativeDropDispatch::Busy {
                            observed_claim: operation_id,
                        });
                    }
                    match self.native_drop_claim.compare_exchange(
                        claim,
                        claim | DROP_CLAIM_BUSY,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ) {
                        Ok(_) => {
                            return Some(NativeDropDispatch::Busy {
                                observed_claim: operation_id,
                            });
                        }
                        Err(current) => claim = current,
                    }
                }
            }
            NativeDropSignal::Leave => Some(NativeDropDispatch::Leave {
                event_ticket,
                observed_operation: drop_claim_operation(
                    self.native_drop_claim.load(Ordering::Acquire),
                ),
            }),
            NativeDropSignal::Drop { paths } => {
                // Read lock-free, before the paths are retained. The callback
                // must never wait on a service mutex, and refusing here means
                // no dropped path is held for a workspace that cannot take it.
                if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
                    // `paths` is borrowed from the platform event and is not
                    // retained: returning without building a `Start` is what
                    // makes this a drop whose paths never entered the session.
                    return Some(NativeDropDispatch::ConversionBusy);
                }
                let mut claim = self.native_drop_claim.load(Ordering::Acquire);
                loop {
                    if claim == 0 {
                        let operation_id = self.allocate_drop_operation();
                        match self.native_drop_claim.compare_exchange(
                            0,
                            encode_drop_claim(operation_id),
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        ) {
                            Ok(_) => {
                                return Some(NativeDropDispatch::Start(NativeDropWork {
                                    operation_id,
                                    paths: paths
                                        .iter()
                                        .take(super::drop_ingestion::MAX_DROP_ROOTS)
                                        .cloned()
                                        .collect(),
                                    top_level_item_count: paths.len(),
                                }));
                            }
                            Err(current) => {
                                claim = current;
                                continue;
                            }
                        }
                    }

                    let operation_id = drop_claim_operation(claim)
                        .expect("a nonzero native-drop claim carries an operation");
                    if drop_claim_has_busy(claim) {
                        return Some(NativeDropDispatch::Busy {
                            observed_claim: operation_id,
                        });
                    }
                    match self.native_drop_claim.compare_exchange(
                        claim,
                        claim | DROP_CLAIM_BUSY,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ) {
                        Ok(_) => {
                            return Some(NativeDropDispatch::Busy {
                                observed_claim: operation_id,
                            });
                        }
                        Err(current) => claim = current,
                    }
                }
            }
            NativeDropSignal::Over => unreachable!("handled before allocating an event ticket"),
        }
    }

    fn allocate_drop_operation(&self) -> DropOperationId {
        let operation = self
            .next_drop_operation
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                (current <= u64::from(u32::MAX)).then(|| current + 1)
            })
            .expect("a session cannot accept more than u32::MAX native drops");
        debug_assert_ne!(operation, 0);
        DropOperationId(operation)
    }

    fn allocate_drop_event_ticket(&self) -> u64 {
        self.native_drop_event_ticket
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                current.checked_add(1)
            })
            .map(|previous| previous + 1)
            .expect("a session cannot receive more than u64::MAX native drop events")
    }

    fn mark_native_drop_started(&self, operation_id: DropOperationId) -> bool {
        let mut claim = self.native_drop_claim.load(Ordering::Acquire);
        loop {
            if drop_claim_operation(claim) != Some(operation_id) {
                return false;
            }
            if drop_claim_started(claim) {
                return false;
            }
            match self.native_drop_claim.compare_exchange(
                claim,
                claim | DROP_CLAIM_STARTED,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return true,
                Err(current) => claim = current,
            }
        }
    }

    /// Claims one registered busy notice only after `importing` owns the
    /// delivery order. A worker that arrives earlier leaves the count for the
    /// start worker to drain immediately after that persistent snapshot.
    fn take_one_pending_drop_busy(&self, operation_id: DropOperationId) -> bool {
        let mut claim = self.native_drop_claim.load(Ordering::Acquire);
        loop {
            if drop_claim_operation(claim) != Some(operation_id)
                || !drop_claim_started(claim)
                || !drop_claim_has_busy(claim)
            {
                return false;
            }
            match self.native_drop_claim.compare_exchange(
                claim,
                claim & !DROP_CLAIM_BUSY,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return true,
                Err(current) => claim = current,
            }
        }
    }

    /// Atomically removes the bounded, coalesced busy notice currently
    /// registered for an operation. Later callbacks either set the bit again
    /// or observe the terminal clear and become a new operation.
    fn take_pending_drop_busy(&self, operation_id: DropOperationId) -> Option<bool> {
        let mut claim = self.native_drop_claim.load(Ordering::Acquire);
        loop {
            if drop_claim_operation(claim) != Some(operation_id) {
                return None;
            }
            let pending = drop_claim_has_busy(claim);
            let without_busy = claim & !DROP_CLAIM_BUSY;
            match self.native_drop_claim.compare_exchange(
                claim,
                without_busy,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some(pending),
                Err(current) => claim = current,
            }
        }
    }

    /// Clears one exact operation and returns the busy notice linearized
    /// before that terminal boundary.
    fn clear_native_drop_claim(&self, operation_id: DropOperationId) -> Option<bool> {
        let mut claim = self.native_drop_claim.load(Ordering::Acquire);
        loop {
            if drop_claim_operation(claim) != Some(operation_id) {
                return None;
            }
            match self.native_drop_claim.compare_exchange(
                claim,
                0,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some(drop_claim_has_busy(claim)),
                Err(current) => claim = current,
            }
        }
    }

    /// Everything the session holds, in the order it was added.
    ///
    /// Stored facts only. Nothing is revalidated here, no process is launched
    /// and the workspace generation is not changed. Navigation itself, rather
    /// than this independently scheduled IPC read, is what supersedes work from
    /// the previous document. Rechecking a thousand paths on every mount or
    /// mutation would turn drawing a list into a thousand filesystem
    /// inspections. Whether a row's file is still the file it was is a question
    /// the next preview of it asks, and answers where the user can see it.
    pub fn roster(&self) -> WorkspaceRosterDto {
        // Pure does not mean unordered. A batch holds this gate across all of
        // its short workspace writes, so taking it here makes the snapshot
        // either wholly before or wholly after that batch rather than a
        // partial list observed between two accepted files.
        let gate = self.enter_workspace_mutation_after_drop();
        let roster = roster_of(&self.workspace());
        drop(gate);
        roster
    }

    /// Adds every chosen path, in picker order, and answers with what each one
    /// did and the roster that resulted.
    ///
    /// One item's failure is its own. A batch is a list of files the user
    /// pointed at, not a transaction: rolling back the ones that arrived
    /// because a later one could not be read would punish them for choosing it.
    ///
    /// No preview is launched for any of them. Adding a file makes it something
    /// the user can see and remove; reading one is a thing they ask for.
    pub fn add_files(&self, paths: &[PathBuf]) -> Result<WorkspaceAddResultDto, PreviewErrorDto> {
        // Rust decides this, not a disabled button. A conversion is reading one
        // of these rows and holding it open; changing the roster underneath it
        // is what the request epoch would otherwise have to refuse later, at a
        // point where a process is already running.
        if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        // Held for the whole batch so two of these cannot interleave their
        // rows. It is not the workspace lock and never becomes it: acceptance
        // opens and inspects a file, which is filesystem work, and holding the
        // workspace across it would stop every other command for the length of
        // a batch.
        // Refused under the gate rather than beside it. An adoption can claim
        // the gate in the interval since the check above, and advancing the
        // generation is what supersedes one -- so the refusal has to be decided
        // before that happens, or both actions fail where one was only asked to
        // wait.
        let (_batch, _generation) = self.begin_waiting_mutation_unless_adopting()?;
        let mut outcomes = Vec::with_capacity(paths.len());
        for path in paths {
            // Taken before acceptance, because acceptance is what may fail and
            // the user still has to be told which file it was.
            let candidate = candidate_display_name(path);
            let accepted = match accept_workspace_file(path) {
                Ok(accepted) => accepted,
                Err(error) => {
                    outcomes.push(PendingOutcome::Rejected {
                        candidate_name: candidate,
                        error,
                    });
                    continue;
                }
            };
            // Taken per item rather than once for the batch, so a long batch
            // does not hold the workspace across the acceptance of every file
            // in it.
            let mut workspace = self.workspace();
            let outcome = workspace.registry.add_direct(accepted);
            drop(workspace);
            // The dataset each outcome names is described after the batch, not
            // here: a row's context depends on what else the roster holds, and
            // the second file of a colliding pair is what gives the first one
            // its context. Described mid-batch, the earlier outcome would carry
            // no context while the roster beside it carried one.
            outcomes.push(PendingOutcome::Registered {
                candidate_name: candidate,
                outcome,
            });
        }
        let workspace = self.workspace();
        let roster = roster_of(&workspace);
        let outcomes = describe_outcomes(&workspace, outcomes);
        drop(workspace);
        Ok(WorkspaceAddResultDto { roster, outcomes })
    }

    /// The session's conversion slot, locked.
    ///
    /// Very nearly a leaf lock: a caller that needs a described row reads it
    /// first and takes this afterwards.
    ///
    /// The one exception is the document-epoch read that a retry and a stop both
    /// make, which has to happen under the same lock the state moves under or it
    /// describes a document that may have been replaced by the time it does. It
    /// is safe because the reverse order does not exist: every path that asks
    /// whether a conversion is busy reads the lock-free mirror beside this slot
    /// rather than taking it, which is the reason that mirror exists.
    fn conversion_slot(&self) -> std::sync::MutexGuard<'_, ConversionSlot> {
        self.conversion
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Republishes the lock-free busy mirror from the slot that owns it.
    ///
    /// Called with the slot lock still held, which is what makes the mirror a
    /// mirror: a writer that released first could be overtaken by another
    /// transition and leave the flag describing a state that no longer exists.
    fn publish_conversion_busy(&self, slot: &ConversionSlot) {
        self.conversion_busy
            .store(slot.is_busy(), Ordering::Release);
    }

    /// What the one conversion slot currently holds.
    ///
    /// The authoritative answer, and the only one. A document reads this on
    /// mount to recover a conversion it did not start, and again while one is
    /// running; the reply to the command that started it is not a reliable
    /// place to learn how it went, because that document may be gone.
    pub fn conversion_state(&self) -> WorkspaceConversionUpdateDto {
        // The slot first, and the flag under it. A worker sets the quarantine
        // before it moves the slot to its terminal state, so a reader holding
        // the slot lock and asking afterwards sees every quarantine that any
        // state it can observe was set before. Asking first inverts that: this
        // read could carry the `stopFailed` sequence with `false` beside it,
        // and because a document installs by sequence and stops polling at a
        // terminal state, the true answer arriving later would be discarded and
        // the session would go on saying the backend was fine.
        let slot = self.conversion_slot();
        let quarantined = self.backend_is_quarantined();
        let diagnostics = self.diagnostics_read();
        slot.read(quarantined, diagnostics)
    }

    /// Whether this session has stopped trusting the backend.
    ///
    /// Set exactly once, by a stop whose process-tree termination could not be
    /// confirmed, and never cleared: nothing in this session can establish that
    /// the process it lost track of has ended, and a flag that could be cleared
    /// would need something that can.
    pub(super) fn backend_is_quarantined(&self) -> bool {
        self.backend_quarantined.load(Ordering::Acquire)
    }

    /// Refuses anything that would launch a backend process while quarantined.
    ///
    /// Asked by every backend entry point rather than by the gate itself. The
    /// gate is a mutex and holding it forever would wedge the application on
    /// exit; what quarantine changes is not who may take the gate but whether
    /// MSCanvas is willing to start another process at all.
    fn require_usable_backend(&self) -> Result<(), PreviewErrorDto> {
        if self.backend_is_quarantined() {
            return Err(backend_quarantined());
        }
        Ok(())
    }

    /// Stops the running queue of the calling document.
    ///
    /// The request is recorded and the state moves under the slot lock; the
    /// cancellation itself is asked afterwards, with no lock held. Job
    /// termination is not instantaneous, and holding the lock every reader
    /// needs across it would stop the interface answering for as long as it
    /// took -- including the read that would tell the user their stop was
    /// accepted.
    pub fn stop_conversion_queue(
        &self,
        operation_id: &str,
        document_epoch: u64,
    ) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
        let operation: u64 = operation_id
            .parse()
            .map_err(|_| conversion_not_stoppable())?;
        let mut slot = self.conversion_slot();
        // The current document, exactly as a retry checks it, and under the
        // same lock the state moves under. A reload is entitled to stop the
        // queue it recovered; a document that has been replaced is not
        // entitled to stop its replacement's work.
        if document_epoch != self.workspace_drop_document_epoch() {
            return Err(conversion_not_stoppable());
        }
        let accepted = slot.request_stop(operation)?;
        self.publish_conversion_busy(&slot);
        let update = slot.read(self.backend_is_quarantined(), self.diagnostics_read());
        drop(slot);

        if let StopAccepted::Requested(Some(request)) = accepted {
            request.request();
        }
        Ok(update)
    }

    /// Whether a conversion currently occupies the workspace.
    ///
    /// Asked by every mutation before it proceeds. Rust enforces this; a
    /// disabled button is a courtesy, not the rule.
    fn conversion_is_busy(&self) -> bool {
        self.conversion_busy.load(Ordering::Acquire)
    }

    /// Describes the queue a set of selected rows would get.
    ///
    /// Read-only and free: no picker, no reservation, no process. Everything in
    /// it is derived from what the runs will actually do -- above all each
    /// item's planned output name, which is what makes a collision something
    /// the user is told about before choosing a folder rather than after.
    ///
    /// The order is the caller's, and the caller's order is the order the user
    /// is looking at. Rust does not re-sort it: a queue that ran in registry
    /// insertion order would run in an order nothing on screen shows.
    pub fn conversion_queue_plan(
        &self,
        handles: &[String],
    ) -> Result<ConversionQueuePlanDto, PreviewErrorDto> {
        let items = self.plan_queue_items(handles)?;
        Ok(ConversionQueuePlanDto {
            items: items
                .iter()
                .map(|item| ConversionQueuePlanItemDto {
                    dataset_handle: item.handle().to_owned(),
                    file_name: item.file_name().to_owned(),
                    output_file_name: item.output_file_name().to_owned(),
                })
                .collect(),
            output_format: ConversionOutputFormatDto::MzMl,
            compression: fixed_compression().to_owned(),
            // Stated before the run rather than after it. A vendor acquisition
            // has no mzML reading, so nothing about any output can be compared
            // to a source model -- and a user deciding whether to convert a
            // batch is entitled to know that before they choose a folder.
            validation_mode: ValidationModeDto::OutputOnly,
            capacity: MAX_CONVERSION_QUEUE_ITEMS,
        })
    }

    /// Turns an ordered list of handles into queue items, or says why it is not
    /// a queue.
    ///
    /// Every refusal here happens before a picker opens and before anything is
    /// created. The bound, the duplicate rule and the empty rule live in the
    /// queue's own constructor; what this adds is that every handle names a
    /// live, convertible row, and that no two of them would write one name.
    fn plan_queue_items(&self, handles: &[String]) -> Result<Vec<QueueItem>, PreviewErrorDto> {
        // Refused before the workspace is even read. A list longer than a
        // session may run is not a queue whose rows are worth resolving.
        if handles.is_empty() {
            return Err(queue_is_empty());
        }
        if handles.len() > MAX_CONVERSION_QUEUE_ITEMS {
            return Err(queue_too_large());
        }
        let workspace = self.workspace();
        let mut items = Vec::with_capacity(handles.len());
        for handle in handles {
            let id = DatasetId::parse(handle).ok_or_else(unknown_dataset)?;
            let dataset = workspace.registry.get(id).ok_or_else(unknown_dataset)?;
            let kind = dataset.file().source_kind();
            // mzML rows are refused rather than silently dropped. The interface
            // states how many selected rows are excluded, and a boundary that
            // quietly shortened the list would make that count a fiction.
            if !is_convertible(kind) {
                return Err(dataset_not_convertible());
            }
            let epoch = workspace
                .current_request_epoch(id)
                .ok_or_else(unknown_dataset)?;
            let dto = dataset_dto(&workspace, id).ok_or_else(unknown_dataset)?;
            // Derived from the display name the roster already carries, through
            // the same function the plan itself uses. Nothing here touches a
            // path: what an output is called is decided by what its source is
            // called.
            let output = planned_output_name(&dto.file_name).ok_or_else(dataset_not_convertible)?;
            items.push(QueueItem::new(id, epoch, kind, dto, output));
        }
        drop(workspace);

        // Two items writing one name into one folder is not a conflict with
        // something that was already there, so the conflict policy cannot
        // settle it -- and letting queue order pick the winner would make the
        // result depend on a sort the user can change. Refused outright.
        // Compared the way the destination will resolve them, not the way Rust
        // compares strings. The folder is a local Windows directory by
        // admission, and an ordinary one answers `Sample.mzML` and
        // `sample.mzML` with the same file -- so a case-sensitive comparison
        // would call that pair distinct here and then discover the conflict
        // after the picker, as the second item failing or being skipped.
        //
        // Upcased, because that is the direction Windows folds: a volume keeps
        // an uppercase table and maps a name through it. Lowercasing is not the
        // same relation and misses real collisions -- Greek final sigma is the
        // plain example, since `to_lowercase` leaves `Σ` and `ς` as `σ` and
        // `ς` while a volume upcases both to `Σ`.
        //
        // Rust's uppercasing is full Unicode rather than a volume's fixed
        // table, so the two still disagree at the edges -- `ß` expands to `SS`
        // here and does not there. Where they disagree this refuses a pair the
        // volume might have kept apart, which is the safe direction for a rule
        // whose whole purpose is to refuse, and the honest limit of comparing
        // names without asking the volume itself.
        let folded = |name: &str| name.to_uppercase();
        let mut collisions: Vec<String> = Vec::new();
        for (index, item) in items.iter().enumerate() {
            if items[..index].iter().any(|earlier| {
                folded(earlier.output_file_name()) == folded(item.output_file_name())
            }) && !collisions
                .iter()
                .any(|name| folded(name) == folded(item.output_file_name()))
            {
                collisions.push(item.output_file_name().to_owned());
            }
        }
        if !collisions.is_empty() {
            return Err(queue_output_name_collision(&collisions));
        }
        Ok(items)
    }

    /// Binds one queue and reserves the right to choose a folder for it.
    ///
    /// The synchronous half of the two-command boundary, and the same shape a
    /// folder import uses for the same reason: a webview can reload between any
    /// two IPC fetches, so the reservation is retained in Rust and a document
    /// that never receives the identifier can never open a picker.
    ///
    /// What is bound here cannot change afterwards -- the document, the ordered
    /// rows, their request epochs, their family and the conflict policy -- so
    /// the picker that follows is a picker *for this queue*, and re-sorting or
    /// re-selecting while it is open changes what is on screen and not what
    /// will run.
    pub fn begin_conversion_queue(
        &self,
        handles: &[String],
        conflict: ConversionConflictPolicyDto,
        document_epoch: u64,
    ) -> Result<WorkspaceConversionReservationDto, PreviewErrorDto> {
        // Before the plan, so a quarantined session refuses a queue without
        // first describing one it will never run.
        self.require_usable_backend()?;
        // And before anything else, an adoption of the queue this would
        // replace. The interface disables this while one runs, but a press
        // landing before that state commits would otherwise replace the very
        // terminal slot the adoption is reading -- turning a request the user
        // made into `adoption_superseded` and taking the offer with it.
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let items = self.plan_queue_items(handles)?;
        // The same gate every workspace mutation takes, so a queue and a batch
        // cannot both be admitted by each reading the other's state before
        // either committed. `_after_drop` because a drop is accepted by a
        // lock-free callback that installs its claim without waiting on any
        // mutex, so a reservation taken beside one would let that drop commit
        // rows into the workspace a queue is about to read.
        let gate = self.enter_workspace_mutation_after_drop();
        // Again, under the gate. The check before the plan keeps a queue from
        // being described while an adoption runs; this one is what makes it
        // true, because an adoption can claim the terminal queue in the
        // interval between them and replacing it here would supersede a request
        // the user had already made.
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let mut slot = self.conversion_slot();
        // Under the slot lock, and immediately before the slot is taken. The
        // authority proof is awaited, so a reload can start any time after it
        // succeeds -- and page-load releases what it finds *now*. Page-load's
        // release takes this same lock, so one of the two happens first and the
        // other sees the result.
        if document_epoch != self.workspace_drop_document_epoch() {
            return Err(invalid_conversion_reservation());
        }
        let queue = ConversionQueue::new(document_epoch, conflict, items)?;
        let reservation = slot.begin(queue);
        self.publish_conversion_busy(&slot);
        // The previous queue's diagnostics go with the previous queue. Under
        // both locks, in the order every path that takes both uses, so a read
        // between them cannot pair a new queue with the old queue's export
        // result. The exported *file* is untouched: what is dropped here is this
        // session's memory of having written one.
        let mut export = self.diagnostics_export_slot();
        export.forget();
        self.publish_diagnostics_exporting(&export);
        drop(export);
        drop(slot);
        drop(gate);
        reservation
    }

    /// Consumes one exact reservation before its picker is dispatched.
    ///
    /// Answers with the operation the claim belongs to. The caller carries it
    /// through the picker and back: without it, a dialog abandoned by a
    /// reloaded document would return a folder that the command applied to
    /// whatever the slot currently holds.
    pub fn claim_conversion(
        &self,
        reservation_id: &str,
        document_epoch: u64,
    ) -> Result<u64, PreviewErrorDto> {
        self.conversion_slot().claim(reservation_id, document_epoch)
    }

    /// Returns the slot to idle after a cancelled picker.
    ///
    /// An ordinary outcome. Nothing was created, nothing ran, and the operation
    /// identifier is not reused.
    pub fn cancel_conversion(&self, operation: u64) -> WorkspaceConversionUpdateDto {
        let mut slot = self.conversion_slot();
        slot.cancel(operation);
        self.publish_conversion_busy(&slot);
        slot.read(self.backend_is_quarantined(), self.diagnostics_read())
    }

    /// Runs one claimed queue into one chosen folder.
    ///
    /// The destination is admitted **before** the slot says running, so a folder
    /// this boundary will not write to costs no state transition and no staging
    /// area.
    pub fn run_claimed_conversion(
        &self,
        operation: u64,
        destination: &Path,
    ) -> WorkspaceConversionUpdateDto {
        // Read from the slot rather than carried by the caller. A command that
        // held the bound queue could run one for a reservation the slot has
        // since replaced; asking the slot means the queue that runs is the one
        // the slot says is claimed, or none at all.
        let Some((claimed, _)) = self.conversion_slot().claimed() else {
            return self.conversion_state();
        };
        // The operation this picker was opened for, not whichever one the slot
        // now holds. A dialog abandoned by a reloaded document still returns a
        // folder, and applying it to a replacement operation would convert the
        // wrong datasets into a directory nobody chose for them.
        if claimed != operation {
            return self.conversion_state();
        }
        let admitted = match admit_destination_root(destination) {
            Ok((root, identity, _held)) => AdmittedDestination::new(root, identity),
            Err(error) => return self.refuse_queue(operation, error),
        };
        let mut slot = self.conversion_slot();
        let started = slot.start_running(operation, admitted);
        self.publish_conversion_busy(&slot);
        drop(slot);
        if !started {
            return self.conversion_state();
        }
        self.drain_queue(operation)
    }

    /// Runs every retryable failure of the terminal queue again.
    ///
    /// The same queue, not a new one made of what is left: successes, skips and
    /// non-retryable failures keep their results and their places, and the
    /// destination and policy are the ones the queue was created with. Nothing
    /// asks the user for a folder again.
    pub fn retry_conversion_queue(
        &self,
        document_epoch: u64,
    ) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
        // The folder must still be the folder. A name is not an object, and a
        // retry that trusted the name could write into whatever had since taken
        // it. Checked before any state moves, so a changed destination costs
        // nothing and leaves every existing result exactly as it is.
        //
        // Answers `invalid_conversion_reservation` when the slot is not terminal
        // or holds no destination -- a queue refused before its picker ever
        // opened has nothing to rerun and no folder to rerun it in.
        // Before the folder is touched. A quarantined session runs nothing, and
        // a retry is the one action that would otherwise start a process
        // without the user choosing anything again.
        self.require_usable_backend()?;
        // A retry and an adoption both act on the terminal queue, and only one
        // of them may. Refused here rather than left to the generation guard,
        // because a retry replaces the very results an adoption is reading.
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let stored = self
            .terminal_destination()
            .ok_or_else(invalid_conversion_reservation)?;
        let (root, identity, _held) =
            admit_destination_root(stored.root()).map_err(|_| queue_destination_changed())?;
        if !stored.is_still(&AdmittedDestination::new(root, identity)) {
            return Err(queue_destination_changed());
        }

        let gate = self.enter_workspace_mutation_after_drop();
        // Again, under the gate. Admitting the destination is filesystem work,
        // so an adoption can claim the terminal queue while it runs -- and this
        // replaces the very results that adoption is reading.
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let mut slot = self.conversion_slot();
        // Under the slot lock and immediately before the slot moves, exactly as
        // beginning a queue checks it. The current document, not the one that
        // built the queue: a reload is entitled to retry what it recovered.
        if document_epoch != self.workspace_drop_document_epoch() {
            return Err(invalid_conversion_reservation());
        }
        // The same folder, and the same queue holding it. Admitting a directory
        // is filesystem work, so the check above cannot be done under this lock
        // -- which leaves a window in which another document could have run a
        // whole further queue and made *its* destination the terminal one. This
        // is what refuses to retry a queue whose folder was never the one just
        // proved.
        if slot.terminal_destination().as_ref() != Some(&stored) {
            return Err(queue_destination_changed());
        }
        let Some(operation) = slot.begin_retry() else {
            return Err(invalid_conversion_reservation());
        };
        // The previous settling's export described attempts this rerun is about
        // to replace. Dropped here rather than filtered on read, because a
        // result that is no longer true of anything should not survive to be
        // filtered. The file it named is untouched.
        let mut export = self.diagnostics_export_slot();
        export.forget();
        self.publish_diagnostics_exporting(&export);
        drop(export);
        self.publish_conversion_busy(&slot);
        drop(slot);
        drop(gate);
        Ok(self.drain_queue(operation))
    }

    /// Adds a terminal queue's finalized outputs to the workspace.
    ///
    /// Explicit, and all of them at once. The queue on screen is what the user
    /// is looking at when they press this, so the set is the queue's own
    /// finalized items in the queue's own order -- not a roster selection, and
    /// not a subset the interface chose.
    ///
    /// Split across the mutation gate in three parts, because the middle one
    /// hashes files and holding the gate across it would stall every other
    /// workspace action for as long as that took. Under the gate: prove the
    /// document, prove the queue, reserve a generation, take the tickets.
    /// Outside it: check and accept each output. Under the gate again: require
    /// the generation to still be current, and only then commit. A mutation
    /// that won in between means nothing is added at all -- not a partial
    /// commit against a workspace this run never saw.
    ///
    /// Launches no process and touches no backend, which is why a session that
    /// has stopped trusting the backend may still do this. What it produces are
    /// mzML rows; whether they can be *previewed* is the quarantine's business
    /// and is unchanged by adopting them.
    ///
    /// # Errors
    ///
    /// Refuses a stale document, an operation that is not the current terminal
    /// queue, an adoption already under way, and a workspace that moved while
    /// this one was reading. Individual outputs that cannot be admitted are not
    /// errors: they are outcomes, and they do not stop the others.
    pub fn adopt_conversion_outputs(
        &self,
        operation_id: &str,
        document_epoch: u64,
    ) -> Result<WorkspaceOutputAdoptionResultDto, PreviewErrorDto> {
        let operation: u64 = operation_id.parse().map_err(|_| outputs_not_adoptable())?;

        let (reserved, tickets, reserved_round) = {
            let gate = self.enter_workspace_mutation_after_drop();
            if document_epoch != self.workspace_drop_document_epoch() {
                return Err(outputs_not_adoptable());
            }
            // A diagnostics export of the same terminal queue is the one other
            // action that owns this result. Refused here rather than left to the
            // generation guard, because an adoption that started inside one
            // would hold the workspace gate while a modal save dialog was open.
            if self.diagnostics_export_is_in_flight() {
                return Err(adoption_in_progress());
            }
            let tickets = self
                .conversion_slot()
                .terminal_adoption_tickets(operation)
                .ok_or_else(outputs_not_adoptable)?;
            if tickets.is_empty() {
                return Err(outputs_not_adoptable());
            }
            // Read before anything is claimed, so that every way of refusing
            // this request leaves the session exactly as it found it.
            let round = self
                .conversion_slot()
                .terminal_retry_round(operation)
                .ok_or_else(outputs_not_adoptable)?;
            // Claimed before the gate is released, so two adoptions of one queue
            // cannot both reach the reading half and commit the same rows twice.
            // From here on every path must clear it, which the guard below does.
            if self.adopting_outputs.swap(true, Ordering::AcqRel) {
                return Err(adoption_in_progress());
            }
            (self.reserve_adoption(gate), tickets, round)
        };
        // Cleared however this returns, including through a panic in the
        // reading half. A flag left set would refuse every later adoption for
        // the rest of the session.
        let adopting = AdoptionInFlight(self);

        // No workspace lock, no slot lock and no gate. Each output is opened,
        // recognised and accepted here; nothing is committed.
        let mut inspected = Vec::with_capacity(tickets.len());
        for (index, ticket) in tickets {
            // Between outputs, and briefly: a reload or a mutation that
            // advanced the generation has already decided this run commits
            // nothing, and hashing the rest would hold the adoption flag --
            // and so the replacement document's own actions -- for no result.
            // Nothing filesystem-shaped happens while this is held.
            if self.enter_workspace_mutation().generation != reserved {
                return Err(adoption_superseded());
            }
            let accepted = ticket.accept();
            inspected.push((index, ticket, accepted));
        }

        let gate = self.enter_workspace_mutation();
        // The reservation, and the queue. Both, because they answer different
        // questions: the generation says no other workspace decision happened,
        // and the operation says the queue these outputs belong to is still the
        // one the slot holds.
        if gate.generation != reserved {
            return Err(adoption_superseded());
        }
        // The settling, not merely the queue. A retry between the two halves
        // would leave the same operation terminal again with different results,
        // and committing against that would attach these outcomes to a queue
        // that no longer produced them.
        let Some(retry_round) = self.conversion_slot().terminal_retry_round(operation) else {
            return Err(adoption_superseded());
        };
        if retry_round != reserved_round {
            return Err(adoption_superseded());
        }

        let mut workspace = self.workspace();
        let outcomes: Vec<_> = inspected
            .into_iter()
            .map(|(index, ticket, accepted)| {
                let output_file_name = ticket.output_file_name().to_owned();
                let source_handle = ticket.source().handle();
                match accepted {
                    Ok(admitted) => {
                        let (accepted, holds) = admitted.into_parts();
                        let outcome = workspace.registry.add_converted(
                            accepted,
                            ticket.source(),
                            ticket.source_display_name().to_owned(),
                            ticket.operation(),
                        );
                        // Released here and not a statement earlier. What was
                        // proved about this file is that it is the finalized
                        // object and holds the validated bytes; that stays true
                        // only while nobody may write it, rename it or take the
                        // directory it is in. The holds end when the row exists
                        // rather than when the check did.
                        drop(holds);
                        PendingAdoption::Registered {
                            item_index: index,
                            source_handle,
                            output_file_name,
                            outcome,
                        }
                    }
                    Err(refusal) => PendingAdoption::Refused {
                        item_index: index,
                        source_handle,
                        output_file_name,
                        reason: refusal.stable_id().to_owned(),
                    },
                }
            })
            .collect();
        let result = WorkspaceOutputAdoptionResultDto {
            operation_id: operation.to_string(),
            retry_round,
            roster: roster_of(&workspace),
            outcomes: describe_adoptions(&workspace, outcomes),
        };
        drop(workspace);
        // Cleared under the gate this commit still holds, not at the end of the
        // function. Between the two a drop or a queued mutation could take the
        // gate, see a flag for an adoption that has already finished, and be
        // refused for nothing -- and a native drop refused that way costs the
        // user the drop itself.
        drop(adopting);
        drop(gate);
        Ok(result)
    }

    /// The session's one diagnostics export slot, locked.
    ///
    /// Always taken after the conversion slot where both are needed, and never
    /// held across the native dialog or the write.
    fn diagnostics_export_slot(&self) -> std::sync::MutexGuard<'_, DiagnosticsExportSlot> {
        self.diagnostics_export
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Republishes the lock-free export mirror from the slot that owns it.
    fn publish_diagnostics_exporting(&self, slot: &DiagnosticsExportSlot) {
        self.diagnostics_exporting
            .store(slot.is_busy(), Ordering::Release);
    }

    /// What a document may know about diagnostics, apart from the queue's own
    /// counts.
    ///
    /// The counts are filled in by the slot that knows them. This carries the
    /// two facts that belong to the export rather than to the queue: whether one
    /// is running, and what the last one wrote.
    fn diagnostics_read(&self) -> ConversionDiagnosticsStateDto {
        let slot = self.diagnostics_export_slot();
        ConversionDiagnosticsStateDto {
            eligible_item_count: 0,
            available: false,
            exporting: slot.is_busy(),
            last_export: slot.last().cloned(),
        }
    }

    /// Binds one diagnostics export and reserves the right to choose a file.
    ///
    /// The synchronous half of the two-command boundary, the same shape a
    /// conversion destination uses and for the same reason: a webview can reload
    /// between any two IPC fetches, so the reservation is retained in Rust and a
    /// document that never receives the identifier can never open a dialog.
    ///
    /// What is bound here cannot change afterwards -- the document, the terminal
    /// queue and which settling of it -- so the dialog that follows is a dialog
    /// *for this result*, and a retry started while it is open cannot make the
    /// export describe a queue the user was not looking at.
    ///
    /// Launches no process and takes no backend gate. A session that has stopped
    /// trusting the backend may still do this, and that is the case the export
    /// exists for.
    ///
    /// # Errors
    ///
    /// Refuses a stale document, an operation that is not the current terminal
    /// queue, a queue with nothing worth describing, and an export already under
    /// way.
    pub fn begin_conversion_diagnostics_export(
        &self,
        operation_id: &str,
        document_epoch: u64,
    ) -> Result<ConversionDiagnosticsReservationDto, PreviewErrorDto> {
        let operation: u64 = operation_id
            .parse()
            .map_err(|_| diagnostics_unavailable())?;
        // The same gate a retry and an adoption take, and taken for the reason
        // they take it. Those two check that no export is in flight and then
        // wait for the conversion lock; an export that claimed the slot inside
        // that window would leave a retry starting anyway -- against the very
        // results a save dialog is about to describe. Serialising all three
        // under one gate is what makes the check they already make sound.
        let gate = self.enter_workspace_mutation_after_drop();
        if document_epoch != self.workspace_drop_document_epoch() {
            return Err(diagnostics_unavailable());
        }
        // An adoption owns the same terminal queue. It holds this gate only for
        // its first half, so the flag is asked as well as the gate held.
        if self.adoption_is_in_flight() {
            return Err(diagnostics_export_in_progress());
        }
        // Conversion first, export second, which is the order every path that
        // takes both uses.
        let mut conversion = self.conversion_slot();
        let Some((_, _, retry_round, _)) = conversion.terminal_diagnostics(operation) else {
            return Err(diagnostics_unavailable());
        };
        let mut slot = self.diagnostics_export_slot();
        if slot.is_busy() {
            return Err(diagnostics_export_in_progress());
        }
        let reservation = slot.begin(document_epoch, operation, retry_round);
        self.publish_diagnostics_exporting(&slot);
        drop(slot);
        // A reader can now see that an export is under way, which is a
        // transition like any other and needs the ordering key to move.
        conversion.note_diagnostics_change();
        drop(conversion);
        drop(gate);
        Ok(ConversionDiagnosticsReservationDto {
            reservation_id: reservation.0,
        })
    }

    /// Consumes one exact reservation before its dialog is dispatched.
    ///
    /// Answers with nothing. What the claim bound is read back out of the slot
    /// when the write begins, named by the same reservation, so there is one
    /// place the queue and the settling come from and no caller can pair a
    /// reservation with a round it does not belong to.
    ///
    /// # Errors
    ///
    /// Refuses an unknown, already-claimed or replaced reservation.
    pub fn claim_conversion_diagnostics_export(
        &self,
        reservation_id: &str,
        document_epoch: u64,
    ) -> Result<(), PreviewErrorDto> {
        self.diagnostics_export_slot()
            .claim(reservation_id, document_epoch)
    }

    /// Returns the slot to idle after a cancelled dialog or an undispatched one.
    ///
    /// An ordinary outcome. Nothing was created, nothing was written, and the
    /// last recorded export -- if there was one -- is left exactly as it was.
    pub fn cancel_conversion_diagnostics_export(
        &self,
        reservation_id: &str,
    ) -> WorkspaceConversionUpdateDto {
        // Named, and narrow. Named because a save dialog outlives the document
        // that opened it: a reload releases the reservation while the window is
        // still up, the replacement may begin an export of its own, and the old
        // dialog then closes and says so -- an unnamed cancel would take the
        // replacement's reservation with it, and two dialogs for one queue
        // carry the same operation, so only the identifier tells them apart.
        // Narrow because it releases only a slot still awaiting a destination,
        // so it can never end a write.
        self.change_diagnostics(|slot| slot.cancel(reservation_id));
        self.conversion_state()
    }

    /// Changes the export slot and records that a reader can see it.
    ///
    /// One function rather than the same four lines at every transition,
    /// because the part that is easy to forget is the last one: the diagnostics
    /// state rides on the conversion read, so it shares that read's ordering
    /// key, and a document installs by that key. A transition that did not
    /// advance it would be a transition no document ever applies.
    ///
    /// Takes the conversion lock first, which is the order every path that
    /// holds both uses.
    /// The change answers whether a reader can see it, and the key moves only
    /// then. A page load releases a reservation that usually is not there, and
    /// advancing for that would make every reload look like a transition to
    /// every document reading the slot.
    fn change_diagnostics(&self, change: impl FnOnce(&mut DiagnosticsExportSlot) -> bool) {
        let mut conversion = self.conversion_slot();
        let mut slot = self.diagnostics_export_slot();
        let observable = change(&mut slot);
        self.publish_diagnostics_exporting(&slot);
        drop(slot);
        if observable {
            conversion.note_diagnostics_change();
        }
    }

    /// Writes one terminal queue's diagnostics to the file the user chose.
    ///
    /// Everything that can refuse does so before anything is created: the queue
    /// must still be the one this dialog was opened for, the document must
    /// serialize, the folder must be one this boundary writes into, and the
    /// whole document must fit the export bound. The write itself creates a
    /// private sibling, fills it, forces it to disk and renames it -- so a name
    /// that is already taken is a refusal that replaced nothing, and a failure
    /// anywhere leaves no file under the chosen name.
    ///
    /// # Errors
    ///
    /// Refuses a superseded queue, a folder this boundary will not write into, a
    /// name that is taken, a document over the size bound, and every way the
    /// write itself can fail. A failure that also left a temporary object behind
    /// says so in its detail rather than hiding it behind the primary reason.
    pub fn write_conversion_diagnostics(
        &self,
        reservation_id: &str,
        destination: &Path,
    ) -> Result<ConversionDiagnosticsExportDto, PreviewErrorDto> {
        let mut slot = self.diagnostics_export_slot();
        let Some((operation, retry_round)) = slot.start_writing(reservation_id) else {
            return Err(invalid_diagnostics_reservation());
        };
        self.publish_diagnostics_exporting(&slot);
        drop(slot);
        // Cleared however this returns, including through a panic in the
        // rendering half.
        let exporting = DiagnosticsExportInFlight(self);

        // Read again rather than carried from the reservation. The dialog is
        // modal and lasts as long as the user takes; only the slot can say
        // whether the queue it bound is still the queue it named.
        let (queue, provider, current_round, tickets) = self
            .conversion_slot()
            .terminal_diagnostics(operation)
            .ok_or_else(diagnostics_export_superseded)?;
        if current_round != retry_round {
            return Err(diagnostics_export_superseded());
        }

        let rendered = payload::render(&DiagnosticsExportRequest {
            queue,
            provider,
            tickets,
        });
        // Before anything is opened or created. A document over the bound is a
        // refusal and never a truncation: half a JSON document is not a smaller
        // diagnostics file, it is one no reader can open.
        if rendered.bytes.len() > MAX_DIAGNOSTIC_EXPORT_BYTES {
            return Err(diagnostics_too_large());
        }

        let (parent, file_name) = match (destination.parent(), destination.file_name()) {
            (Some(parent), Some(file_name)) => (parent, file_name),
            _ => return Err(diagnostics_destination_unusable()),
        };
        // The same admission a conversion destination goes through, and for the
        // same reasons: the no-clobber rename and the object-bound cleanup this
        // write depends on are local Windows guarantees, and a redirector or a
        // link is somewhere neither of them holds. The hold is kept for the
        // whole write, so the folder cannot be renamed away underneath it.
        let (root, _identity, _held) =
            admit_destination_root(parent).map_err(|_| diagnostics_destination_unusable())?;

        let digest =
            Sha256Digest::calculate(&rendered.bytes).map_err(|_| diagnostics_not_written(false))?;
        write_new_local_file(&root, file_name, &rendered.bytes)
            .map_err(diagnostics_write_failure)?;

        let result = ConversionDiagnosticsExportDto {
            operation_id: operation.to_string(),
            retry_round,
            file_name: bounded_text(&file_name.to_string_lossy(), MAX_CANDIDATE_NAME_CHARS),
            byte_length: rendered.bytes.len() as u64,
            sha256: digest.to_string(),
            diagnostic_item_count: rendered.item_count,
        };
        // Recorded under the export slot's own lock, before the guard above
        // releases it, so a document reading between the two cannot see an idle
        // slot with no result on it.
        self.change_diagnostics(|slot| slot.finish(Some(result.clone())));

        // Already idle, so this only clears the mirror it already agrees with.
        drop(exporting);
        Ok(result)
    }

    /// Releases a reservation whose document is gone, claimed or not.
    ///
    /// Claimed included, exactly as a conversion destination reservation is
    /// released. A save dialog belonging to a replaced document may still be on
    /// screen, and what this decides is that whatever it answers with is
    /// dropped: nothing is written, no partial file exists, and the replacement
    /// document is offered the export again. Leaving a claimed reservation
    /// alive instead would keep the slot busy on the strength of a dialog no
    /// document is waiting for.
    fn release_diagnostics_reservation(&self) {
        self.change_diagnostics(DiagnosticsExportSlot::release_awaiting_destination);
    }

    /// Advances the workspace generation for one adoption and returns it.
    ///
    /// Separated so the gate guard is dropped at a statement boundary rather
    /// than living to the end of the block that produced it.
    fn reserve_adoption(&self, mut gate: std::sync::MutexGuard<'_, WorkspaceMutationState>) -> u64 {
        gate.advance()
    }

    /// Whether an adoption is between its two halves.
    pub(super) fn adoption_is_in_flight(&self) -> bool {
        self.adopting_outputs.load(Ordering::Acquire)
    }

    /// Whether a diagnostics export is between being asked for and finishing.
    ///
    /// Lock-free like the two mirrors beside it, and for the same reason: the
    /// paths that consult it include the native drop callback, which must be
    /// able to refuse without waiting on any service mutex.
    pub(super) fn diagnostics_export_is_in_flight(&self) -> bool {
        self.diagnostics_exporting.load(Ordering::Acquire)
    }

    /// Whether some action that owns the terminal queue is between its halves.
    ///
    /// Adoption and a diagnostics export are different things -- one mutates
    /// the workspace and the other only reads -- and they are refused by the
    /// same set of callers for one reason: both are about the results a
    /// terminal queue is holding, and a retry, a new queue or a mutation that
    /// landed in the middle would replace the very thing being read.
    fn terminal_queue_action_in_flight(&self) -> bool {
        self.adoption_is_in_flight() || self.diagnostics_export_is_in_flight()
    }

    /// Marks a claimed queue as running without draining it.
    ///
    /// The two halves of `run_claimed_conversion`, separated, so a test can
    /// occupy the interval between them: a queue that is running and whose
    /// worker has not begun is exactly the state a queue is in while it waits
    /// behind another backend operation for the gate, and a stop made then must
    /// launch nothing.
    #[cfg(test)]
    pub(super) fn start_running_for_test(&self, operation: u64, destination: &Path) -> bool {
        let admitted = match admit_destination_root(destination) {
            Ok((root, identity, _held)) => AdmittedDestination::new(root, identity),
            Err(_) => return false,
        };
        let mut slot = self.conversion_slot();
        let started = slot.start_running(operation, admitted);
        self.publish_conversion_busy(&slot);
        started
    }

    /// The worker half, for a queue a test already marked running.
    #[cfg(test)]
    pub(super) fn drain_queue_for_test(&self, operation: u64) -> WorkspaceConversionUpdateDto {
        self.drain_queue(operation)
    }

    /// The destination a terminal queue was run against.
    fn terminal_destination(&self) -> Option<AdmittedDestination> {
        self.conversion_slot().terminal_destination()
    }

    /// Converts every pending item, in order, on one backend binding.
    ///
    /// The gate is taken once for the whole queue and released only when it
    /// reaches terminal. That is what makes the batch one provider build, one
    /// process lane and one deterministic order -- and what stops a preview
    /// interleaving between two items of a batch the user is watching.
    ///
    /// No workspace lock, no mutation gate and no slot lock is held while a
    /// process runs. Each is taken briefly to read a row or commit a
    /// transition, and released before the next item starts.
    fn drain_queue(&self, operation: u64) -> WorkspaceConversionUpdateDto {
        let running = self.enter_backend();
        // Asked on this side of the gate as well as before it. A queue admitted
        // while an earlier one was still running waits here for its whole
        // length, and that earlier queue may have ended by losing track of its
        // converter -- which is the one state in which nothing further may
        // launch.
        if self.backend_is_quarantined() {
            drop(running);
            return self.refuse_queue(operation, backend_quarantined());
        }
        // Before the backend is resolved, not after. Resolving it runs the
        // installed tools' help, so a queue stopped while it waited behind
        // another operation would otherwise spend two processes proving which
        // build it was not going to use. Nothing has been launched at this
        // point, so the whole queue is stranded for nothing.
        if self.conversion_slot().stop_requested(operation) {
            drop(running);
            return self.finish_queue(operation, TerminalReason::Stopped);
        }
        // Bound once, for the whole queue. Binding per item would let a batch
        // span two installations, and the evidence a conversion is gated on is
        // a statement about one exact build.
        let backend = match self.provider.conversion_backend() {
            Ok(backend) => backend,
            Err(error) => {
                drop(running);
                return self.refuse_queue(operation, error);
            }
        };
        // Asked once, before any item creates a staging directory. Every item
        // of this queue is the same family, so one answer settles all of them.
        if let Err(error) =
            refuse_unevidenced_build(&backend.capabilities, ConversionSourceKind::ThermoRawFile)
        {
            drop(running);
            return self.refuse_queue(operation, error);
        }
        // One installation for one queue, retries included. Noted once here
        // rather than per item, and compared against what the queue's earlier
        // pass ran on: a user who switches ProteoWizard between a run and its
        // retry would otherwise get some of one queue's files from one build
        // and the rest from another, which is not a batch anybody can compare.
        //
        // The queue holds the identity rather than the generation the call
        // below returns. Switching away and back is a real thing to do, and it
        // restores the same build -- while the generation, which only counts
        // changes, would have moved on and refused the retry for ever.
        let generation = self.note_resolved(backend.installation.clone());
        // Bound to a local first, and every lock below it likewise. A guard
        // produced inside an `if` condition lives until the end of that `if`,
        // body included -- and each of these bodies takes the same lock again.
        let bound = self.conversion_slot().bind_installation(
            operation,
            backend.installation.clone(),
            generation,
        );
        if let Err(error) = bound {
            drop(running);
            return self.refuse_queue(operation, error);
        }

        // Again, because binding the installation released the lock and a stop
        // can have landed in between. Still before any item.
        if self.conversion_slot().stop_requested(operation) {
            drop(running);
            return self.finish_queue(operation, TerminalReason::Stopped);
        }

        loop {
            let Some(queue) = self.conversion_slot().running(operation) else {
                // The slot moved on -- a reload released it, or a newer queue
                // replaced it. Nothing further is this worker's to run.
                drop(running);
                return self.conversion_state();
            };
            // Before every item. A stop that landed while the previous one was
            // converting is honoured here rather than after one more file has
            // been written.
            if self.conversion_slot().stop_requested(operation) {
                drop(running);
                return self.finish_queue(operation, TerminalReason::Stopped);
            }
            let Some((index, item)) = queue.next_pending() else {
                break;
            };
            let Some(admitted) = queue.destination().cloned() else {
                break;
            };
            // Re-proved before every item, not once for the queue. Admission
            // holds the directory only while it is judging it, so between that
            // and this item's own run the name could come to mean a different
            // directory -- and the plan would take that one as its baseline and
            // write into it. The crate's own root lock covers the run itself;
            // this covers the gap in front of it.
            // Held, not merely checked. Compressing this to a boolean would
            // drop admission's directory handle at the end of the statement,
            // and a rename between there and the plan would leave the plan
            // taking a substitute directory as its own baseline -- which the
            // crate's root lock would then faithfully protect. Kept until the
            // item is done, so the object cannot be renamed or deleted out from
            // under the plan that is about to adopt it.
            let held = match admit_destination_root(admitted.root()) {
                Ok((root, identity, held))
                    if admitted.is_still(&AdmittedDestination::new(root.clone(), identity)) =>
                {
                    held
                }
                _ => {
                    drop(running);
                    return self.refuse_queue(operation, queue_destination_changed());
                }
            };
            let root = admitted.root().to_path_buf();
            // Refuses once a stop has been accepted, whatever this worker
            // believed a moment ago. The check above narrows the window; this
            // closes it, because the transition and the refusal are the same
            // lock acquisition.
            let Some(attempt) = self.conversion_slot().start_item(operation, index) else {
                drop(running);
                return if self.conversion_slot().stop_requested(operation) {
                    self.finish_queue(operation, TerminalReason::Stopped)
                } else {
                    self.conversion_state()
                };
            };
            self.publish_conversion_busy(&self.conversion_slot());

            // One cancellation object for this exact attempt, and its
            // request-only handle bound to the operation, item and attempt
            // number that name it. A handle left over from an earlier item or
            // an earlier retry round cannot be mistaken for this one.
            let cancellation = ConversionCancellation::new();
            self.conversion_slot().bind_attempt(
                operation,
                index,
                attempt,
                cancellation.request_handle(),
            );
            // Bound after the handle is stored, so a stop accepted in the
            // interval between the two still reaches this attempt: the request
            // it made is on the object this run is about to consume.
            let started_at = Instant::now();
            let outcome = self.convert_queue_item(
                &item,
                &root,
                queue.conflict(),
                &backend,
                generation,
                cancellation,
            );
            // What the user waited for, not how long the attempt ran. A stop
            // made a minute into a conversion would otherwise report the minute
            // as the cost of stopping it. Falls back to the attempt's own
            // duration only where no stop was accepted, which is a case the
            // classification below never turns into a cancellation.
            let elapsed = self
                .conversion_slot()
                .stop_requested_ago(operation)
                .unwrap_or_else(|| started_at.elapsed());
            drop(held);
            // Released for this exact attempt only, and before the queue moves,
            // so a stop arriving now finds no handle rather than a stale one.
            self.conversion_slot()
                .release_attempt(operation, index, attempt);
            let outcome = self.classify_attempt(outcome, elapsed);
            let unconfirmed = matches!(
                outcome,
                ItemOutcome::Stopped {
                    state: ItemState::CancellationFailed,
                    ..
                }
            );
            // Before the queue state moves, not after. Quarantine is a fact
            // about a process this session may have lost, and it must not
            // depend on the slot still being this worker's -- the one path
            // where settling fails is exactly a slot that moved on, and
            // skipping the quarantine there would leave a possibly-surviving
            // converter with nothing refusing the next one.
            if unconfirmed {
                self.quarantine_backend();
            }
            let settled = self
                .conversion_slot()
                .settle_item(operation, index, outcome);
            if !settled {
                drop(running);
                return self.conversion_state();
            }
            // Entered before the gate is released, so no operation queued
            // behind this one can slip through between the two.
            if unconfirmed {
                drop(running);
                return self.finish_queue(operation, TerminalReason::StopFailed);
            }
            // After the item settles, and before the next one is constructed.
            if self.conversion_slot().stop_requested(operation) {
                drop(running);
                return self.finish_queue(operation, TerminalReason::Stopped);
            }
        }

        // Every item ran. Whether that is a completed queue or a stopped one is
        // decided by the slot, under the one lock that commits it -- reading
        // the flag here and committing afterwards would let a stop accepted in
        // between be answered as accepted and then reported as a completion.
        let update = self.finish_queue(operation, TerminalReason::Completed);
        drop(running);
        update
    }

    /// Ends the queue and answers with the authoritative state.
    fn finish_queue(&self, operation: u64, reason: TerminalReason) -> WorkspaceConversionUpdateDto {
        let mut slot = self.conversion_slot();
        slot.finish(operation, None, reason);
        self.publish_conversion_busy(&slot);
        let update = slot.read(self.backend_is_quarantined(), self.diagnostics_read());
        drop(slot);
        update
    }

    /// Stops trusting the backend for the rest of this session.
    fn quarantine_backend(&self) {
        self.backend_quarantined.store(true, Ordering::Release);
    }

    /// Turns one attempt's result into what the queue records.
    ///
    /// The two stopped states are not one. `Cancelled` is a claim that the
    /// owned process tree is gone, which only the conversion boundary's own
    /// confirmation establishes; `CancellationFailed` is the admission that it
    /// could not be established, and it is what puts the session into
    /// quarantine.
    fn classify_attempt(&self, attempt: QueueItemAttempt, elapsed: Duration) -> ItemOutcome {
        match attempt {
            QueueItemAttempt::Settled(outcome) => outcome,
            // The boundary produces this only where no owned process survives:
            // either the tree was observed empty, or none was ever created. The
            // two are told apart by process_launched, and neither is a state
            // in which anything of this application's may still be running.
            QueueItemAttempt::Cancelled(report) => ItemOutcome::Stopped {
                state: ItemState::Cancelled,
                // Nothing to diagnose. The user asked for it to stop and the
                // owned tree is confirmed gone, so there is no failure here for
                // backend text to be an account of.
                diagnostics: None,
                facts: CancellationFacts {
                    process_launched: report.backend_was_run(),
                    tree_termination_confirmed: true,
                    elapsed,
                    termination: report.backend().map(BackendRunFacts::termination),
                    partial_output_observed: report
                        .staged_content()
                        .is_some_and(|staged| staged.entry_count() > 0),
                    staging_residue: report.residue(),
                },
            },
            QueueItemAttempt::CancellationFailed(mut failure) => ItemOutcome::Stopped {
                state: ItemState::CancellationFailed,
                // Taken here, at the one place this failure is turned into what
                // the queue records. It is already redacted and already bounded;
                // this side has no access to the raw streams and no paths with
                // which to redact them.
                diagnostics: failure.take_backend_text().map(Box::new),
                facts: CancellationFacts {
                    process_launched: failure.backend().is_some(),
                    tree_termination_confirmed: false,
                    elapsed,
                    termination: failure.backend().map(BackendRunFacts::termination),
                    partial_output_observed: failure
                        .staged_content()
                        .is_some_and(|staged| staged.entry_count() > 0),
                    staging_residue: failure.residue(),
                },
            },
        }
    }

    /// One item, on a binding and a gate the queue already owns.
    ///
    /// Everything that decides what is converted is re-established here rather
    /// than remembered: the row is revalidated under the family it was queued
    /// as, held against replacement, and re-admitted as a conversion source
    /// whose object identity must match the one the session holds.
    fn convert_queue_item(
        &self,
        item: &QueueItem,
        root: &Path,
        conflict: ConversionConflictPolicyDto,
        backend: &ConversionBackend<'_>,
        generation: u64,
        cancellation: ConversionCancellation,
    ) -> QueueItemAttempt {
        let handle = item.handle().to_owned();
        let workspace = self.workspace();
        let still_bound = workspace.bound_request_is_current(item.dataset(), item.request_epoch())
            && workspace
                .registry
                .get(item.dataset())
                .is_some_and(|dataset| dataset.file().source_kind() == item.kind());
        let remembered = workspace
            .registry
            .get(item.dataset())
            .map(|dataset| dataset.file().clone());
        drop(workspace);
        if !still_bound {
            return QueueItemAttempt::Settled(ItemOutcome::Refused {
                // The row moved on under the queue. Another attempt against the
                // same plan would find the same thing.
                retryable: false,
                error: superseded(),
            });
        }
        let Some(remembered) = remembered else {
            return QueueItemAttempt::Settled(ItemOutcome::Refused {
                retryable: false,
                error: unknown_dataset(),
            });
        };

        let outcome = (|| -> Result<ConvertedItem, PreviewErrorDto> {
            let file = revalidate(&remembered)?;
            let guard = lock_against_replacement(file.path())?;
            let source = open_conversion_source(&file)?;
            let plan = plan_conversion(source, root, conflict_policy(conflict))?;
            // The one call that can be stopped. Everything above it is this
            // side's own revalidation, which is fast and produces nothing to
            // clean up; everything a stop has to be safe about is inside it.
            let attempt = run_planned_conversion_cancellable(&plan, backend, cancellation);
            drop(guard);
            Ok(match attempt {
                ConversionAttempt::Completed(mut report) => {
                    // Described first, then taken apart. The description is
                    // what the queue shows; the retained object is what a later
                    // adoption recognises the file by, and only a finalization
                    // has one to give.
                    let described = WorkspaceConversionReport::of(
                        handle.clone(),
                        file.source_kind(),
                        generation,
                        &plan,
                        &report,
                    );
                    // Taken rather than copied, so the report the queue keeps
                    // and projects holds no backend text at all.
                    let text = report.take_backend_text().map(Box::new);
                    ConvertedItem::Reported(
                        described,
                        report.into_finalized_output().map(Box::new),
                        text,
                    )
                }
                ConversionAttempt::Cancelled(report) => ConvertedItem::Cancelled(report),
                ConversionAttempt::CancellationFailed(failure) => {
                    ConvertedItem::CancellationFailed(failure)
                }
            })
        })();

        match outcome {
            Ok(ConvertedItem::Reported(report, finalized, diagnostics)) => {
                QueueItemAttempt::Settled(ItemOutcome::Reported {
                    state: item_state_of(report.outcome_class()),
                    retryable: report.is_retryable(),
                    report: Box::new(report),
                    finalized,
                    diagnostics,
                })
            }
            Ok(ConvertedItem::Cancelled(report)) => QueueItemAttempt::Cancelled(report),
            Ok(ConvertedItem::CancellationFailed(failure)) => {
                QueueItemAttempt::CancellationFailed(failure)
            }
            Err(error) => {
                let retryable = refusal_is_retryable(&error.kind);
                QueueItemAttempt::Settled(ItemOutcome::Refused { retryable, error })
            }
        }
    }

    fn refuse_queue(&self, operation: u64, error: PreviewErrorDto) -> WorkspaceConversionUpdateDto {
        let mut slot = self.conversion_slot();
        slot.refuse(operation, error);
        self.publish_conversion_busy(&slot);
        slot.read(self.backend_is_quarantined(), self.diagnostics_read())
    }

    /// Reserves the right to claim the workspace's next state without opening
    /// a picker.
    ///
    /// This is the synchronous half of the two-command boundary. A webview can
    /// reload between any two IPC fetches, so the reservation is retained in
    /// Rust under a session-scoped, single-use identifier. If the reply
    /// disappears with the old document, no picker can start because that
    /// document never receives the identifier.
    ///
    /// Begin itself is deliberately idempotent at one workspace generation. A
    /// delayed begin from a document that has reloaded therefore cannot replace
    /// a newer document's reservation or supersede a scan it already claimed.
    /// The next begin after any other workspace decision replaces the one stale
    /// slot, so abandoned replies cannot grow an unbounded registry.
    pub fn begin_folder_import(&self) -> Result<FolderImportReservationDto, PreviewErrorDto> {
        if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let mut gate = self.enter_workspace_mutation_after_drop();
        let generation = gate.generation;
        if let Some(reservation_id) = gate
            .pending_folder_import
            .as_ref()
            .filter(|pending| pending.baseline_generation == generation)
            .map(|pending| pending.reservation_id)
        {
            return Ok(FolderImportReservationDto {
                reservation_id: reservation_id.handle(),
            });
        }
        let reservation_id = gate.allocate_folder_import_reservation();
        gate.pending_folder_import = Some(PendingFolderImport {
            reservation_id,
            baseline_generation: generation,
        });
        drop(gate);
        Ok(FolderImportReservationDto {
            reservation_id: reservation_id.handle(),
        })
    }

    /// Consumes one exact reservation before its picker is dispatched.
    ///
    /// An unknown, replaced or replayed identifier never consumes the active
    /// slot. An exact identifier whose baseline was superseded by Clear, Remove
    /// or a reloaded window is consumed but refused, so it cannot be retried
    /// after the workspace moves again. A live exact claim advances the
    /// generation and creates the internal token atomically. The token itself
    /// never crosses IPC and remains unclonable.
    pub fn claim_folder_import(
        &self,
        reservation_id: &str,
    ) -> Result<FolderImportToken, PreviewErrorDto> {
        // Asked again here, not only at begin: a conversion can start while the
        // reservation is in flight, and the claim is what dispatches a picker.
        if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let requested = FolderImportReservationId::parse(reservation_id)
            .ok_or_else(invalid_folder_import_reservation)?;
        let mut gate = self.enter_workspace_mutation_after_drop();
        let matches = gate
            .pending_folder_import
            .as_ref()
            .is_some_and(|pending| pending.reservation_id == requested);
        if !matches {
            return Err(invalid_folder_import_reservation());
        }
        let pending = gate
            .pending_folder_import
            .take()
            .expect("the exact pending folder reservation was present");
        if pending.baseline_generation != gate.generation {
            return Err(import_superseded());
        }
        // Again, under the gate and before the generation moves. An adoption can
        // claim the gate in the interval since the check above, and advancing
        // here would supersede it while still opening a picker.
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let generation = gate.advance();
        Ok(FolderImportToken { generation })
    }

    /// The three guarded workspace mutations, for the tests that are not about
    /// the guard.
    ///
    /// Each one panics rather than returning the refusal, which is the point: a
    /// test that unexpectedly hits the conversion guard fails loudly at the
    /// line that hit it instead of quietly asserting on an error value it never
    /// meant to produce. The tests that *are* about the guard call the real
    /// methods and read the refusal.
    #[cfg(test)]
    pub(super) fn add_files_now(&self, paths: &[PathBuf]) -> WorkspaceAddResultDto {
        self.add_files(paths)
            .expect("no conversion is running in this test")
    }

    #[cfg(test)]
    pub(super) fn remove_datasets_now(&self, handles: &[String]) -> WorkspaceRemoveResultDto {
        self.remove_datasets(handles)
            .expect("no conversion is running in this test")
    }

    #[cfg(test)]
    pub(super) fn clear_workspace_now(&self) -> WorkspaceRosterDto {
        self.clear_workspace()
            .expect("no conversion is running in this test")
    }

    #[cfg(test)]
    pub(super) fn begin_folder_import_now(&self) -> FolderImportReservationDto {
        self.begin_folder_import()
            .expect("no conversion is running in this test")
    }

    /// One dataset's queue plan, for the tests that are about one dataset.
    ///
    /// A queue of one is the single-conversion workflow, so these read the way
    /// they always did while going through the queue the product uses.
    #[cfg(test)]
    pub(super) fn conversion_plan_summary(
        &self,
        handle: &str,
    ) -> Result<ConversionQueuePlanDto, PreviewErrorDto> {
        self.conversion_queue_plan(std::slice::from_ref(&handle.to_owned()))
    }

    #[cfg(test)]
    pub(super) fn begin_conversion(
        &self,
        handle: &str,
        conflict: ConversionConflictPolicyDto,
        document_epoch: u64,
    ) -> Result<WorkspaceConversionReservationDto, PreviewErrorDto> {
        self.begin_conversion_queue(
            std::slice::from_ref(&handle.to_owned()),
            conflict,
            document_epoch,
        )
    }

    /// Direct token allocation for deterministic service tests.
    ///
    /// Product code uses the begin/claim pair above; tests that exercise the
    /// unlocked scan and gated commit need the internal token without an IPC
    /// protocol obscuring the ordering they control.
    #[cfg(test)]
    pub(super) fn reserve_folder_import(&self) -> FolderImportToken {
        let (gate, generation) = self.begin_waiting_mutation();
        drop(gate);
        FolderImportToken { generation }
    }

    /// Scans one chosen folder and adds every mzML file it proposes.
    ///
    /// The shape of this is the whole of what M1.4.1 adds, and every step is
    /// load-bearing:
    ///
    /// 1. the exact claim advanced the generation before the picker opened, so
    ///    there is a name for "the workspace when this picker was accepted";
    /// 2. reject an already-superseded token before touching the filesystem;
    /// 3. scan holding **no** lock -- not the workspace, not the mutation gate.
    ///    A tree can take as long as it takes, and a session frozen for the
    ///    length of it would be one the user could not remove a row from;
    /// 4. take the gate again and refuse outright if anything has happened
    ///    since. A user who cleared the list, added files, or reloaded the
    ///    window has said what the workspace is, and rows from an import they
    ///    started before that would arrive from nowhere;
    /// 5. accept the candidates in discovery order, under the gate, so the
    ///    batch is one contiguous run;
    /// 6. recheck each candidate's identity against what discovery found,
    ///    because a path is a proposal and the object behind it can be
    ///    replaced between the walk and the open.
    ///
    /// No backend is launched, for any candidate, ever. A folder of a thousand
    /// files costs a thousand filesystem inspections and no processes.
    pub fn add_mzml_folder(
        &self,
        root: &Path,
        token: FolderImportToken,
    ) -> Result<FolderIngestionResultDto, PreviewErrorDto> {
        self.import_folder(token, || {
            discover_mzml_candidates(root, DiscoveryBudget::default())
        })
    }

    /// The scan and commit an import is made of, with the walk itself left to
    /// the caller.
    ///
    /// Named as its own step because the walk is the one part that runs outside
    /// the gate, and that is both what makes a long scan safe and what makes it
    /// raceable. A test stands a controlled walk in its place and decides
    /// exactly what happens to the workspace while it runs — no sleep, no
    /// guess, and no tree the size of the case being described.
    ///
    /// It reserves nothing. The token is the reservation, and reserving a
    /// second one here would move the import forward past every decision the
    /// user made while the picker was open.
    pub(super) fn import_folder<S>(
        &self,
        token: FolderImportToken,
        scan: S,
    ) -> Result<FolderIngestionResultDto, PreviewErrorDto>
    where
        S: FnOnce() -> Result<DiscoveryResult, DiscoveryError>,
    {
        let reserved = token.generation;
        // A picker can remain open while another workspace decision supersedes
        // its token. Refuse that known-stale work before paying for a tree walk.
        // This is only a preflight: the generation must still be checked again
        // after the unlocked scan to cover a decision made while it runs.
        let preflight = self.enter_workspace_mutation();
        if preflight.generation != reserved {
            return Err(import_superseded());
        }
        drop(preflight);

        let discovered = scan().map_err(|error| folder_error(error.kind()))?;

        // Under the gate, and deliberately without advancing it: this commit is
        // the completion of the decision the token names, not a new one.
        let batch = self.enter_workspace_mutation();
        if batch.generation != reserved {
            // Nothing accepted, so nothing leased and no identifier spent. The
            // candidates are dropped here, which is also where the files they
            // named stop being held.
            return Err(import_superseded());
        }

        let mut outcomes = Vec::with_capacity(discovered.candidates().len());
        for candidate in discovered.candidates() {
            let candidate_name = candidate_display_name(candidate.path());
            let accepted = match accept_mzml_file(candidate.path()) {
                Ok(accepted) => accepted,
                Err(error) => {
                    outcomes.push(PendingOutcome::Rejected {
                        candidate_name,
                        error,
                    });
                    continue;
                }
            };
            // The recheck. Acceptance resolved the path again, and between the
            // walk finding this name and that resolution the name can have been
            // made to mean a different file -- one outside the folder the user
            // chose, in the case worth worrying about. Containment was proved
            // for the object discovery found; this is what carries that proof
            // across to the object being registered.
            if accepted.identity() != candidate.identity() {
                outcomes.push(PendingOutcome::Rejected {
                    candidate_name,
                    error: folder_candidate_changed(),
                });
                continue;
            }
            let relative_parents = parent_components(candidate.relative_components());
            let mut workspace = self.workspace();
            let outcome = workspace
                .registry
                .add_discovered(accepted, relative_parents);
            drop(workspace);
            outcomes.push(PendingOutcome::Registered {
                candidate_name,
                outcome,
            });
        }

        let workspace = self.workspace();
        let roster = roster_of(&workspace);
        let outcomes = describe_outcomes(&workspace, outcomes);
        drop(workspace);
        drop(batch);

        Ok(FolderIngestionResultDto {
            roster,
            outcomes,
            discovery: FolderDiscoverySummaryDto {
                complete: discovered.is_complete(),
                skipped_reparse_count: discovered.summary().skipped_reparse_count,
                inaccessible_entry_count: discovered.summary().inaccessible_entry_count,
                limits_reached: discovered.limits().iter().copied().map(limit_dto).collect(),
            },
        })
    }

    /// Processes one owned dispatch on a blocking worker. No branch of this
    /// method runs on the Tauri window callback.
    pub(crate) fn process_native_drop_dispatch(
        &self,
        dispatch: NativeDropDispatch,
    ) -> Option<DropIngestionResultDto> {
        match dispatch {
            NativeDropDispatch::Enter {
                item_count,
                event_ticket,
                observed_operation,
            } => {
                let delivery = self.drop_updates.begin_delivery();
                if self.native_drop_event_ticket.load(Ordering::Acquire) != event_ticket
                    || drop_claim_operation(self.native_drop_claim.load(Ordering::Acquire))
                        != observed_operation
                {
                    drop(delivery);
                    return None;
                }
                if observed_operation.is_none() {
                    self.drop_updates.publish_persistent(
                        delivery,
                        WorkspaceDropStateDto::Hovering { item_count },
                    );
                } else {
                    self.drop_updates
                        .publish_transient(delivery, drop_busy_state());
                }
                None
            }
            NativeDropDispatch::Leave {
                event_ticket,
                observed_operation,
            } => {
                let delivery = self.drop_updates.begin_delivery();
                if observed_operation.is_none()
                    && self.native_drop_event_ticket.load(Ordering::Acquire) == event_ticket
                    && drop_claim_operation(self.native_drop_claim.load(Ordering::Acquire))
                        .is_none()
                {
                    self.drop_updates
                        .publish_persistent(delivery, WorkspaceDropStateDto::Idle);
                } else {
                    drop(delivery);
                }
                None
            }
            NativeDropDispatch::Busy { observed_claim } => {
                let delivery = self.drop_updates.begin_delivery();
                if self.take_one_pending_drop_busy(observed_claim) {
                    self.drop_updates
                        .publish_transient(delivery, drop_busy_state());
                } else {
                    drop(delivery);
                }
                None
            }
            NativeDropDispatch::ConversionBusy => {
                let delivery = self.drop_updates.begin_delivery();
                self.drop_updates
                    .publish_transient(delivery, conversion_busy_state());
                None
            }
            NativeDropDispatch::Start(work) => {
                self.process_native_drop_with(work, expand_drop_paths)
            }
        }
    }

    /// The expansion seam is explicit so concurrency and identity replacement
    /// can be tested deterministically between classification and commit.
    pub(super) fn process_native_drop_with<E>(
        &self,
        work: NativeDropWork,
        expand: E,
    ) -> Option<DropIngestionResultDto>
    where
        E: FnOnce(Vec<PathBuf>) -> Result<DropBatch, PreviewErrorDto>,
    {
        let (operation_id, paths, top_level_item_count) = work.into_parts();
        let token = self.begin_native_drop(operation_id, top_level_item_count)?;
        match expand(paths) {
            Ok(mut batch) => {
                batch.summary.top_level_item_count = top_level_item_count;
                if top_level_item_count > super::drop_ingestion::MAX_DROP_ROOTS {
                    batch
                        .summary
                        .record_limit(super::dto::DropScanLimitDto::Roots);
                }
                self.commit_native_drop(token, batch)
            }
            Err(error) => {
                self.fail_native_drop(token, error);
                None
            }
        }
    }

    /// Claims the workspace generation and publishes `importing` before any
    /// filesystem classification begins. A page load, Clear, or Remove that
    /// won the atomic claim first makes this worker a no-op.
    fn begin_native_drop(
        &self,
        operation_id: DropOperationId,
        item_count: usize,
    ) -> Option<DropImportToken> {
        let delivery = self.drop_updates.begin_delivery();
        let mut gate = self.enter_workspace_mutation();
        if !self.mark_native_drop_started(operation_id) {
            drop(gate);
            drop(delivery);
            return None;
        }
        // Under the gate and before the generation moves, like every other
        // mutation. A drop claim is installed lock-free, so it can be taken in
        // the interval before an adoption sets its flag -- and advancing here
        // would supersede that adoption whether or not this drop went on to
        // commit anything.
        //
        // The claim was taken a line ago and is this worker's, so declining
        // means giving it back: a claim left set refuses every later drop, roster
        // read and mutation for the rest of the session, which is far worse than
        // the supersession it was avoiding. Released exactly as a failed worker
        // releases it, waiters included.
        if self.terminal_queue_action_in_flight() {
            drop(gate);
            // Answered, not merely declined. Nothing else will publish for this
            // drop -- the claim was this worker's -- so returning silently would
            // leave the interface saying a drop was being imported for the rest
            // of the session. The same transient refusal the commit half uses.
            self.drop_updates
                .publish_transient(delivery, conversion_busy_state());
            self.clear_native_drop_claim(operation_id);
            self.workspace_mutation_ready.notify_all();
            return None;
        }

        let generation = gate.advance();
        let workspace_was_empty = self.workspace().registry.len() == 0;
        gate.active_drop = Some(ActiveDrop {
            generation,
            operation_id,
        });
        let token = DropImportToken {
            generation,
            operation_id,
            workspace_was_empty,
        };
        drop(gate);
        let pending_busy = self.take_pending_drop_busy(operation_id).unwrap_or(false);
        self.drop_updates.publish_importing_with_busy(
            delivery,
            WorkspaceDropStateDto::Importing {
                operation_id: operation_id.handle(),
                item_count,
            },
            pending_busy,
        );
        Some(token)
    }

    fn commit_native_drop(
        &self,
        token: DropImportToken,
        batch: DropBatch,
    ) -> Option<DropIngestionResultDto> {
        let delivery = self.drop_updates.begin_delivery();
        let mut gate = self.enter_workspace_mutation();
        // The callback that accepted this drop cannot wait on a mutex, so it
        // reads the conversion flag without one and a reservation can be taken
        // immediately afterwards. This is the linearization point where that is
        // decided: a drop may be accepted, but nothing commits into a workspace
        // a conversion is reading.
        if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
            drop(gate);
            self.drop_updates
                .publish_transient(delivery, conversion_busy_state());
            self.clear_native_drop_claim(token.operation_id);
            return None;
        }
        let current = gate.active_drop.is_some_and(|active| {
            active.generation == token.generation
                && active.operation_id == token.operation_id
                && gate.generation == token.generation
                && drop_claim_operation(self.native_drop_claim.load(Ordering::Acquire))
                    == Some(token.operation_id)
        });
        if !current {
            drop(gate);
            drop(delivery);
            return None;
        }

        let DropBatch {
            candidates,
            summary,
        } = batch;
        let mut outcomes = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            let candidate_name = candidate_display_name(&candidate.path);
            let accepted = match accept_mzml_file(&candidate.path) {
                Ok(accepted) => accepted,
                Err(error) => {
                    outcomes.push(PendingOutcome::Rejected {
                        candidate_name,
                        error,
                    });
                    continue;
                }
            };
            if accepted.identity() != candidate.observed_identity {
                outcomes.push(PendingOutcome::Rejected {
                    candidate_name,
                    error: drop_candidate_changed(),
                });
                continue;
            }

            let mut workspace = self.workspace();
            let outcome = match candidate.origin {
                DropCandidateOrigin::Direct => workspace.registry.add_direct(accepted),
                DropCandidateOrigin::Folder { relative_parents } => workspace
                    .registry
                    .add_discovered(accepted, relative_parents),
            };
            drop(workspace);
            outcomes.push(PendingOutcome::Registered {
                candidate_name,
                outcome,
            });
        }

        let workspace = self.workspace();
        let roster = roster_of(&workspace);
        let outcomes = describe_outcomes(&workspace, outcomes);
        drop(workspace);
        let result = DropIngestionResultDto {
            roster,
            outcomes,
            summary: summary.into_dto(token.workspace_was_empty),
        };

        gate.active_drop = None;
        let pending_busy = self
            .clear_native_drop_claim(token.operation_id)
            .expect("the current drop owns the atomic claim");
        self.workspace_mutation_ready.notify_all();
        drop(gate);
        self.drop_updates.publish_terminal_with_busy(
            delivery,
            pending_busy,
            WorkspaceDropStateDto::Completed {
                operation_id: token.operation_id.handle(),
                result: result.clone(),
            },
        );
        Some(result)
    }

    fn fail_native_drop(&self, token: DropImportToken, error: PreviewErrorDto) {
        let delivery = self.drop_updates.begin_delivery();
        let mut gate = self.enter_workspace_mutation();
        let current = gate.active_drop.is_some_and(|active| {
            active.generation == token.generation
                && active.operation_id == token.operation_id
                && gate.generation == token.generation
                && drop_claim_operation(self.native_drop_claim.load(Ordering::Acquire))
                    == Some(token.operation_id)
        });
        if !current {
            drop(gate);
            drop(delivery);
            return;
        }
        gate.active_drop = None;
        let pending_busy = self
            .clear_native_drop_claim(token.operation_id)
            .expect("the current drop owns the atomic claim");
        self.workspace_mutation_ready.notify_all();
        drop(gate);
        self.drop_updates.publish_terminal_with_busy(
            delivery,
            pending_busy,
            WorkspaceDropStateDto::Failed {
                operation_id: token.operation_id.handle(),
                error,
            },
        );
    }

    /// Recovers the logical operation if the blocking worker panics or is
    /// cancelled. A replacement operation/document cannot be cleared because
    /// the opaque operation ID must still match.
    pub(crate) fn fail_native_drop_worker(&self, operation_id: DropOperationId) {
        let delivery = self.drop_updates.begin_delivery();
        let mut gate = self.enter_workspace_mutation();
        let Some(pending_busy) = self.clear_native_drop_claim(operation_id) else {
            drop(gate);
            drop(delivery);
            return;
        };
        if gate
            .active_drop
            .is_some_and(|active| active.operation_id == operation_id)
        {
            gate.active_drop = None;
        }
        self.workspace_mutation_ready.notify_all();
        drop(gate);
        self.drop_updates.publish_terminal_with_busy(
            delivery,
            pending_busy,
            WorkspaceDropStateDto::Failed {
                operation_id: operation_id.handle(),
                error: PreviewErrorDto::new(
                    "drop_worker_unavailable",
                    "MSCanvas could not finish adding those dropped items. Try again.",
                    true,
                ),
            },
        );
    }

    /// Removes the rows these handles name, and says which named nothing.
    ///
    /// The source acquisitions are never touched. Removing a row removes a row
    /// and releases the handle that row was holding.
    pub fn remove_datasets(
        &self,
        handles: &[String],
    ) -> Result<WorkspaceRemoveResultDto, PreviewErrorDto> {
        // Only the converting row is protected. Every other row is the user's
        // to prune while a conversion runs, because removing one says nothing
        // about the acquisition being read and the roster has to stay usable
        // for as long as a process takes.
        if handles
            .iter()
            .filter_map(|handle| DatasetId::parse(handle))
            .any(|id| self.conversion_slot().busy_holds(id))
        {
            return Err(conversion_busy());
        }
        // Advances the generation even when every handle names nothing. The
        // user said "this is the workspace now", and a folder scan that
        // committed across that would repopulate a list they had just pruned.
        let delivery = self.drop_updates.begin_delivery();
        let (batch, _generation, pending_busy) =
            self.begin_superseding_mutation_unless_adopting()?;
        // Asked again, now that the gate a queue is admitted under is held. The
        // check above is the cheap one and answers before anything is
        // superseded; this is the one that is ordered against
        // `begin_conversion_queue`, which takes this same gate. Without it a
        // removal could see an idle slot, a queue could be admitted, and the
        // removal could then delete a row that queue is about to convert -- and
        // the item would fail as `superseded`, blaming the user's own list.
        if handles
            .iter()
            .filter_map(|handle| DatasetId::parse(handle))
            .any(|id| self.conversion_slot().busy_holds(id))
        {
            return Err(conversion_busy());
        }
        let mut removed = Vec::new();
        let mut unknown = Vec::new();
        // The same handle twice is one row to remove, not one removal and one
        // stale handle. A selection can hold a row once; a caller assembling a
        // request need not have been careful.
        let mut seen = HashSet::new();
        let mut workspace = self.workspace();
        for handle in handles {
            if !seen.insert(handle.as_str()) {
                continue;
            }
            match DatasetId::parse(handle).filter(|id| workspace.registry.contains(*id)) {
                Some(id) => {
                    // Through the one atomic path, so the row, its identity
                    // index entry, its lease, its request epoch and its preview
                    // facts all go together.
                    workspace.revoke(id, RevocationReason::Removed);
                    removed.push(handle.clone());
                }
                None => unknown.push(handle.clone()),
            }
        }
        let roster = roster_of(&workspace);
        drop(workspace);
        let result = WorkspaceRemoveResultDto {
            roster,
            removed_handles: removed,
            unknown_handles: unknown,
        };
        drop(batch);
        self.drop_updates.publish_terminal_with_busy(
            delivery,
            pending_busy,
            WorkspaceDropStateDto::Idle,
        );
        Ok(result)
    }

    /// Empties the workspace, and answers with the empty roster that is now
    /// authoritative.
    ///
    /// Every row through the same revocation a single removal uses, so emptying
    /// the workspace cannot come to mean something different from removing
    /// every row in it. The identifier allocator does not rewind: a reply still
    /// in flight for one of the emptied datasets must not land on whatever is
    /// added next.
    pub fn clear_workspace(&self) -> Result<WorkspaceRosterDto, PreviewErrorDto> {
        let delivery = self.drop_updates.begin_delivery();
        let (batch, _generation, pending_busy) =
            self.begin_superseding_mutation_unless_adopting()?;
        // Under the gate. Emptying the workspace would revoke the very row a
        // conversion is reading, and clearing the list is not the way to stop
        // one -- so the question has to be asked where the answer cannot change
        // between asking it and acting on it.
        if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
            drop(batch);
            self.drop_updates.publish_terminal_with_busy(
                delivery,
                pending_busy,
                WorkspaceDropStateDto::Idle,
            );
            return Err(conversion_busy());
        }
        let mut workspace = self.workspace();
        workspace.clear(RevocationReason::Cleared);
        let roster = roster_of(&workspace);
        drop(workspace);
        drop(batch);
        self.drop_updates.publish_terminal_with_busy(
            delivery,
            pending_busy,
            WorkspaceDropStateDto::Idle,
        );
        Ok(roster)
    }

    /// Serialises one workspace mutation against another.
    ///
    /// Short-lived and never taken while a backend process runs. Without it two
    /// batches could interleave their rows, and the order the user picked files
    /// in -- which is the order the roster is -- would depend on which thread
    /// won each turn.
    fn enter_workspace_mutation(&self) -> std::sync::MutexGuard<'_, WorkspaceMutationState> {
        self.workspace_mutation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Takes the mutation gate only after the one active native drop has
    /// completed or an authoritative superseding action has cleared it.
    fn enter_workspace_mutation_after_drop(
        &self,
    ) -> std::sync::MutexGuard<'_, WorkspaceMutationState> {
        let mut gate = self.enter_workspace_mutation();
        while self.native_drop_claim.load(Ordering::Acquire) != 0 {
            gate = self
                .workspace_mutation_ready
                .wait(gate)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        gate
    }

    /// Takes the gate and declares a new state of the workspace.
    ///
    /// Every immediate mutation goes through here, as does the native start of
    /// a replacement webview document. Each one is a statement about the
    /// workspace from that moment on, which is exactly what makes an older
    /// folder scan's answer no longer the one the user is waiting for.
    ///
    /// It advances even when the operation ends up changing nothing. Removing
    /// zero rows is still the user saying "this is the workspace now", and a
    /// scan that committed across it would add rows to a list that had already
    /// been answered for.
    /// The unguarded form, kept for the test shorthand that reserves a folder
    /// import without a picker. Production takes the guarded one below, because
    /// production is where an adoption can be running.
    #[cfg(test)]
    fn begin_waiting_mutation(&self) -> (std::sync::MutexGuard<'_, WorkspaceMutationState>, u64) {
        let mut gate = self.enter_workspace_mutation_after_drop();
        let generation = gate.advance();
        (gate, generation)
    }

    /// The same, refusing while an adoption is between its halves.
    ///
    /// Asked under the gate and *before* the generation moves, which is the
    /// only order that works. Advancing it is what supersedes an adoption, so a
    /// refusal decided afterwards would fail the mutation and take the adoption
    /// down with it -- two user actions lost where one of them was only ever
    /// asked to wait.
    ///
    /// # Errors
    ///
    /// `conversion_busy` while an adoption is in flight. Nothing has moved.
    fn begin_waiting_mutation_unless_adopting(
        &self,
    ) -> Result<(std::sync::MutexGuard<'_, WorkspaceMutationState>, u64), PreviewErrorDto> {
        let mut gate = self.enter_workspace_mutation_after_drop();
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let generation = gate.advance();
        Ok((gate, generation))
    }

    /// A superseding mutation, refusing while an adoption is between its
    /// halves. See [`Self::begin_waiting_mutation_unless_adopting`] for why the
    /// order matters.
    ///
    /// # Errors
    ///
    /// `conversion_busy` while an adoption is in flight. Nothing has moved, and
    /// in particular no native drop has been superseded.
    fn begin_superseding_mutation_unless_adopting(
        &self,
    ) -> Result<(std::sync::MutexGuard<'_, WorkspaceMutationState>, u64, bool), PreviewErrorDto>
    {
        let mut gate = self.enter_workspace_mutation();
        if self.terminal_queue_action_in_flight() {
            return Err(conversion_busy());
        }
        let generation = gate.advance();
        let superseded_claim = self.native_drop_claim.swap(0, Ordering::AcqRel);
        let superseded_drop = superseded_claim != 0;
        let pending_busy = drop_claim_has_busy(superseded_claim);
        gate.active_drop = None;
        if superseded_drop {
            self.workspace_mutation_ready.notify_all();
        }
        Ok((gate, generation, pending_busy))
    }

    /// Starts one of the explicit operations allowed to supersede a native
    /// drop. The caller already holds the drop delivery gate, so clearing the
    /// operation and publishing idle cannot be overtaken by its worker.
    fn begin_superseding_mutation(
        &self,
    ) -> (std::sync::MutexGuard<'_, WorkspaceMutationState>, u64, bool) {
        let mut gate = self.enter_workspace_mutation();
        let generation = gate.advance();
        let superseded_claim = self.native_drop_claim.swap(0, Ordering::AcqRel);
        let superseded_drop = superseded_claim != 0;
        let pending_busy = drop_claim_has_busy(superseded_claim);
        gate.active_drop = None;
        if superseded_drop {
            self.workspace_mutation_ready.notify_all();
        }
        (gate, generation, pending_busy)
    }

    /// Holds both gates that the old callback-facing implementation used.
    /// Tests use this to prove native event reservation remains wait-free with
    /// respect to every service mutex and channel delivery.
    #[cfg(test)]
    pub(super) fn hold_drop_gates_for_test(
        &self,
        started: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
    ) {
        let _delivery = self.drop_updates.begin_delivery();
        let _mutation = self.enter_workspace_mutation();
        started.send(()).expect("the gate holder reports ready");
        release.recv().expect("the test releases the held gates");
    }

    /// Asserts the scan phase owns neither mutation state nor workspace state.
    #[cfg(test)]
    pub(super) fn assert_drop_scan_locks_available_for_test(&self) {
        let mutation = self
            .workspace_mutation
            .try_lock()
            .expect("drop expansion must not hold the mutation gate");
        let workspace = self
            .workspace
            .try_lock()
            .expect("drop expansion must not hold the workspace lock");
        drop(workspace);
        drop(mutation);
    }
}

const FOLDER_IMPORT_RESERVATION_PREFIX: &str = "folder-import-reservation-";

/// Correlates a pending reservation with exactly one later picker command.
#[derive(Clone, Copy, PartialEq, Eq)]
struct FolderImportReservationId(u64);

impl FolderImportReservationId {
    fn handle(self) -> String {
        format!("{FOLDER_IMPORT_RESERVATION_PREFIX}{}", self.0)
    }

    fn parse(handle: &str) -> Option<Self> {
        let id = Self(
            handle
                .strip_prefix(FOLDER_IMPORT_RESERVATION_PREFIX)?
                .parse()
                .ok()?,
        );
        (id.handle() == handle).then_some(id)
    }
}

impl fmt::Debug for FolderImportReservationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<folder-import-reservation-id>")
    }
}

struct PendingFolderImport {
    reservation_id: FolderImportReservationId,
    baseline_generation: u64,
}

/// One folder import's claim on the workspace's next state.
///
/// Opaque, unclonable and not serialisable. The webview neither supplies nor
/// receives it: begin stores only a baseline behind a session claim identifier,
/// the chooser consumes that identifier and creates this token, and the import
/// spends it. What the token represents — "the workspace as it was when the
/// picker claim was accepted" — cannot be forged, reused or moved across the
/// boundary. Holding a number rather than a lock is what lets the native dialog
/// stand open for as long as the user needs without freezing the session.
pub struct FolderImportToken {
    generation: u64,
}

impl FolderImportToken {
    /// Which decision this token names. Test-only: nothing in the product needs
    /// to look inside it, and the whole point is that the number is private.
    #[cfg(test)]
    pub(super) const fn generation(&self) -> u64 {
        self.generation
    }
}

impl fmt::Debug for FolderImportToken {
    /// Opaque, like every other value in this boundary that names a moment in
    /// the session's history. The number is meaningless outside the service and
    /// printing it invites a reader of a log to treat it as something to
    /// correlate.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<folder-import-token>")
    }
}

/// Which decision about the workspace is the current one.
///
/// A single counter behind the mutation gate. It is not a lock and it is not a
/// version of the contents: it is the answer to "has anything happened that
/// makes a scan started earlier no longer the thing the user is waiting for".
#[derive(Default)]
struct WorkspaceMutationState {
    generation: u64,
    next_folder_import_reservation: u64,
    pending_folder_import: Option<PendingFolderImport>,
    active_drop: Option<ActiveDrop>,
}

impl WorkspaceMutationState {
    /// Moves to the next generation and reports it.
    ///
    /// Checked, so the invariant is absolute rather than nearly so: a wrapped
    /// counter would hand a stale scan the token it needed to commit, and a
    /// release build wraps silently. A session cannot reach this in practice --
    /// it counts user actions -- which is exactly why the failure would be
    /// invisible if it ever did.
    fn advance(&mut self) -> u64 {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("a session cannot make more than u64::MAX workspace decisions");
        self.generation
    }

    fn allocate_folder_import_reservation(&mut self) -> FolderImportReservationId {
        let reservation = FolderImportReservationId(self.next_folder_import_reservation);
        self.next_folder_import_reservation = self
            .next_folder_import_reservation
            .checked_add(1)
            .expect("a session cannot begin more than u64::MAX folder imports");
        reservation
    }
}

/// The behaviour the picker had before the roster replaced it.
///
/// Compiled out of the shipped binary. It is kept because the replacement
/// semantics it implements -- accept and lease the new file before letting the
/// previous one go -- have focused coverage worth keeping, and because most of
/// this module's single-dataset tests are written against it. No command
/// reaches it.
#[cfg(test)]
impl PreviewService {
    /// Accepts one already-chosen path, replacing whatever the session held.
    pub(super) fn accept_file(&self, path: &Path) -> Result<SelectedFileDto, PreviewErrorDto> {
        // The replacement is accepted -- and leased -- before the selection it
        // replaces is let go, and the order is the point rather than an
        // accident of where the line sits. Revoking first would close the old
        // dataset's lease while the new file was still being inspected, and in
        // that window the old identity is free for the filesystem to hand to
        // whatever is created next; if that is the very file being accepted,
        // the session would register a new dataset under the identity of the
        // one it just dropped. It also means a path the picker cannot accept
        // leaves the workspace exactly as it was, because this line returns
        // before anything below it runs.
        let accepted = accept_mzml_file(path)?;
        let mut workspace = self.workspace();
        // Everything the previous selection owned goes at once: its row, its
        // preview facts, the identity lease that kept its file's identity its
        // own, and the request epoch that lets a spectrum still waiting for its
        // turn on it find out that nobody will look at the answer.
        workspace.clear(RevocationReason::ReplacedBySelection);
        let id = workspace.registry.add_direct(accepted).id();
        let dto = dataset_dto(&workspace, id).expect("the dataset was registered a line ago");
        Ok(dto)
    }

    /// Adds one accepted file without disturbing the datasets already held.
    ///
    /// Answers with the dataset the file is now known as. A file already in the
    /// workspace answers with the row it is already on, described as it was
    /// registered rather than as it was just named: two names for one file are
    /// one dataset, and the one the user has is the one they added.
    pub(super) fn add_dataset(&self, path: &Path) -> Result<SelectedFileDto, PreviewErrorDto> {
        let accepted = accept_mzml_file(path)?;
        let mut workspace = self.workspace();
        let id = workspace.registry.add_direct(accepted).id();
        Ok(dataset_dto(&workspace, id).expect("the dataset was registered a line ago"))
    }

    /// The same, for a dataset admitted as a vendor acquisition.
    ///
    /// The only way a Thermo dataset enters a workspace, and deliberately a
    /// test-only one. Nothing a user can do reaches [`accept_thermo_raw_file`]:
    /// the picker, folder discovery and the Explorer drop all go through mzML
    /// acceptance, and this slice adds no surface that would change that. What
    /// it stands in for is the ingestion decision a later slice has to make on
    /// purpose, not one this one makes quietly.
    pub(super) fn add_thermo_dataset(
        &self,
        path: &Path,
    ) -> Result<SelectedFileDto, PreviewErrorDto> {
        use super::selection::accept_thermo_raw_file;

        let accepted = accept_thermo_raw_file(path)?;
        let mut workspace = self.workspace();
        let id = workspace.registry.add_direct(accepted).id();
        Ok(dataset_dto(&workspace, id).expect("the dataset was registered a line ago"))
    }

    /// How many datasets the session holds.
    pub(super) fn dataset_count(&self) -> usize {
        self.workspace().registry.len()
    }

    /// A view of whether this dataset's identity lease is still open.
    ///
    /// Weak, so asking does not keep the answer alive, and taken while the
    /// dataset is still registered because afterwards there is nothing to ask.
    /// `None` for a handle the session does not hold.
    pub(super) fn lease_witness(&self, handle: &str) -> Option<super::selection::LeaseWitness> {
        let id = DatasetId::parse(handle)?;
        self.workspace()
            .registry
            .get(id)
            .map(|dataset| dataset.file().lease_witness())
    }

    /// Whether the session is holding preview facts under this handle.
    pub(super) fn holds_preview_state(&self, handle: &str) -> bool {
        DatasetId::parse(handle).is_some_and(|id| {
            self.workspace()
                .runtime
                .get(&id)
                .is_some_and(|state| state.preview.is_some())
        })
    }

    /// How many requests this dataset has had, so a test can wait for one to be
    /// claimed instead of sleeping and hoping.
    pub(super) fn requests_made(&self, handle: &str) -> u64 {
        DatasetId::parse(handle).map_or(0, |id| {
            self.workspace()
                .runtime
                .get(&id)
                .map_or(0, |state| state.request_epoch)
        })
    }

    /// Everything the session holds, printed.
    ///
    /// A roster is many paths in one structure, and this is that structure --
    /// the one a `{:?}` in a log or a panic message would reach. Exposed so a
    /// test can assert on the whole of it rather than on the types it happens
    /// to know about.
    pub(super) fn debug_workspace(&self) -> String {
        format!("{:?}", self.workspace())
    }
}

impl PreviewService {
    /// Loads metadata, run summary and the spectrum table for one open action.
    ///
    /// All three share a single discovery and capability probe, so opening a
    /// file resolves the backend once rather than once per panel.
    /// Converts one accepted dataset to mzML in a folder the caller names.
    ///
    /// Private, and not on the way to being anything else. No command reaches
    /// this, no transfer object is built from what it returns and nothing the
    /// user can click leads here. The product's ingestion surfaces are unchanged
    /// and still accept mzML only; what this exists to establish is that a
    /// dataset the session already holds can be carried, whole and identified,
    /// into the conversion boundary and back.
    ///
    /// ## The order, and why it is this one
    ///
    /// Every step below is placed against an invariant the rest of this service
    /// already keeps, and several of them are only correct where they are.
    ///
    /// 1. The handle is resolved and the epoch claimed **before** the wait, so a
    ///    request the user makes afterwards supersedes this one.
    /// 2. The backend gate is taken with **no workspace lock held**. It is
    ///    waited on for as long as a whole conversion takes, and the roster has
    ///    to keep answering throughout. The workspace above is a statement
    ///    temporary for exactly this reason.
    /// 3. The epoch is rechecked **after** the wait: a conversion still queued
    ///    when the user moves on never launches a process.
    /// 4. The file is revalidated under the family it was accepted as, so a
    ///    vendor acquisition is re-admitted by its signature rather than by its
    ///    extension.
    /// 5. The installation is bound and its build checked against the recorded
    ///    evidence **before** the file is pinned or anything is created, so an
    ///    unevidenced build costs the user nothing.
    /// 6. The file is pinned against replacement, and only then re-admitted as a
    ///    conversion source. The identity comparison inside that admission is
    ///    what closes the window between revalidation and the pin -- and it does
    ///    so before an output could exist, which a comparison made after the run
    ///    could not.
    /// 7. The run is stamped with the generation carried by the gate guard, not
    ///    one read afterwards.
    ///
    /// Nothing is recorded against the dataset. A conversion reads it and writes
    /// elsewhere, so there is no per-dataset state to commit and no reason to
    /// recheck the epoch a third time.
    /// Converts one dataset, taking its own gate and binding its own backend.
    ///
    /// The one-item path the private orchestration tests drive, kept because a
    /// queue of one goes through the queue machinery instead and this is where
    /// the per-item contract is stated on its own. It is the same body the
    /// queue runs, with the gate and the binding around it rather than shared.
    #[cfg(test)]
    pub(super) fn convert_workspace_dataset(
        &self,
        handle: &str,
        destination_root: &Path,
        conflict: ConflictPolicy,
    ) -> Result<WorkspaceConversionReport, PreviewErrorDto> {
        let id = DatasetId::parse(handle).ok_or_else(unknown_dataset)?;
        let (epoch, remembered) = self
            .workspace()
            .begin_reading_request(id)
            .ok_or_else(unknown_dataset)?;
        let running = self.enter_backend();
        if !self.workspace().request_is_current(id, epoch) {
            return Err(superseded());
        }
        let file = revalidate(&remembered)?;
        let backend = self.provider.conversion_backend()?;
        let kind = conversion_source_kind(file.source_kind());
        refuse_unevidenced_build(&backend.capabilities, kind)?;
        let guard = lock_against_replacement(file.path())?;
        let source = open_conversion_source(&file)?;
        let plan = plan_conversion(source, destination_root, conflict)?;
        let report = run_planned_conversion(&plan, &backend);
        let generation = self.note_resolved(backend.installation.clone());
        drop(guard);
        drop(running);
        Ok(WorkspaceConversionReport::of(
            id.handle(),
            file.source_kind(),
            generation,
            &plan,
            &report,
        ))
    }

    pub fn open_preview(&self, handle: &str) -> Result<PreviewDto, PreviewErrorDto> {
        // Asked before anything else. Once a stop could not be confirmed this
        // session does not start another process at all, and a preview is a
        // process.
        self.require_usable_backend()?;
        // Refused rather than queued. The backend gate would serialize it
        // anyway, but a preview that waited behind a whole conversion would sit
        // there for as long as one takes with nothing on screen saying why.
        //
        // A conversion only. An adoption launches no process, holds no backend
        // gate and does not touch an open preview -- refusing a read for it
        // would turn ordinary navigation into an error for no reason of the
        // user's, which is the opposite of what the adoption guard is for.
        if self.conversion_is_busy() {
            return Err(conversion_busy());
        }
        let id = DatasetId::parse(handle).ok_or_else(unknown_dataset)?;
        // Asked before anything is claimed. The preview boundary reads mzML and
        // nothing in this product reads a vendor acquisition directly, so a row
        // of that family is refused here rather than left to a disabled button
        // and a backend failure.
        // Only about a row that exists. A handle naming nothing is an unknown
        // handle and must keep saying so: answering "convert it first" about a
        // dataset the session does not have would send the user to look for a
        // row that is not there.
        if self
            .workspace()
            .registry
            .get(id)
            .is_some_and(|dataset| !dataset.file().source_kind().is_previewable())
        {
            return Err(dataset_not_previewable());
        }
        // Claimed before the wait, so a request that arrives after this one
        // supersedes it -- and claimed by the same per-dataset counter a
        // spectrum uses, because an open and a spectrum are both requests about
        // the same dataset and the newer of the two is the one the user is
        // waiting for. A roster is what makes two opens of one dataset
        // something a user can cause: nothing stops them activating a row
        // twice, or activating it again while the first read is still running.
        let (epoch, remembered) = self
            .workspace()
            .begin_open_request(id)
            .ok_or_else(unknown_dataset)?;
        // Taken after the epoch and before anything is established about the
        // file, so what is checked describes the moment the read actually
        // begins rather than the moment the request arrived.
        let running = self.enter_backend();
        // Checked after the wait, not before it: what matters is whether the
        // user has moved on by the time this would start. A request that is
        // still waiting when a newer one arrives never launches a process.
        if !self.workspace().request_is_current(id, epoch) {
            return Err(superseded());
        }
        // And for the same reason, whether the session still trusts the
        // backend. A read admitted before a stop began waits here for the whole
        // conversion, and that conversion may have ended by losing track of its
        // converter. Asking only on the way in would let exactly the caller
        // that waited longest be the one to start another process.
        self.require_usable_backend()?;
        let file = revalidate(&remembered)?;
        let redactor = reporting_redactor(file.path());
        let operations = open_operations();
        // The three operations read the file separately. If it is rewritten
        // between them, their results describe different generations of the
        // run, and combining those into one preview would present an
        // acquisition that never existed.
        let before = SourceGeneration::of(&file);
        // Held for the whole batch, so the file cannot be swapped away and
        // swapped back between the two comparisons around it. Required: losing
        // the hold means losing the guarantee.
        let guard = lock_against_replacement(file.path())?;
        let attempts = self.provider.run_batch(file.path(), &operations)?;
        // Which backend actually did this work, taken from the attempts rather
        // than from a later look. The batch shares one resolution, so they all
        // report the same one; taking the first is taking that resolution. Read
        // before any of the outcomes, so a failed operation does not take the
        // answer with it.
        let installation = attempts
            .first()
            .and_then(|attempt| attempt.installation.clone());
        // An open is a look at the backend like any other, and it is recorded
        // as one -- still under the gate. An open that resolved a backend
        // nothing had seen yet and kept it to itself left the sequence naming
        // the installation before it: the first spectrum load would then notice
        // the change, advance the sequence, and match on identity, and every
        // load after that would be refused by a sequence check for a change
        // that had already been accounted for.
        //
        // The value recorded is the one this observation leaves behind, not the
        // one this run found on the way in.
        let generation = self.note_resolved(installation.clone());
        drop(guard);
        drop(running);
        if SourceGeneration::capture(file.path()) != before {
            return Err(PreviewErrorDto::new(
                "source_changed_during_preview",
                "The file changed while it was being read, so the preview was discarded rather \
                 than combining results from before and after the change.",
                true,
            ));
        }
        let mut metadata = None;
        let mut run_summary = None;
        let mut spectrum_table = None;
        let mut table_rows = Vec::new();
        let mut handled = 0_usize;
        for attempt in attempts {
            handled += 1;
            // The identity of this batch was already noted above, so an
            // operation that failed no longer takes it with it.
            match attempt.outcome? {
                PreviewOutcome::Value(value) => match *value {
                    PreviewValue::Metadata(result) => {
                        metadata = Some(metadata_dto(&result, &redactor));
                    }
                    PreviewValue::RunSummary(result) => {
                        run_summary = Some(run_summary_dto(&result)?);
                    }
                    PreviewValue::SpectrumTable(result) => {
                        table_rows = result
                            .rows()
                            .iter()
                            .map(|row| TableRowFacts {
                                identity: row.identity().clone(),
                                ms_level: row.ms_level(),
                                retention_time: row.retention_time().value(),
                                base_peak_mz: row.base_peak_mz(),
                                base_peak_intensity: row.base_peak_intensity(),
                                total_ion_current: row.total_ion_current(),
                            })
                            .collect();
                        spectrum_table = Some(spectrum_table_dto(&result, &redactor)?);
                    }
                    PreviewValue::Tic(_) | PreviewValue::SelectedSpectrum(_) => {
                        return Err(PreviewErrorDto::new(
                            "unexpected_preview_result",
                            "The preview returned a result MSCanvas did not request.",
                            false,
                        ));
                    }
                },
                PreviewOutcome::NoResult(_) => {
                    return Err(PreviewErrorDto::new(
                        "preview_result_missing",
                        "The preview did not produce one of its required results.",
                        true,
                    ));
                }
            }
        }

        // Checked after the outcomes, not before: a batch that stopped at its
        // first failure is short on purpose, and reporting it as incomplete
        // would hide the error that stopped it.
        if handled != operations.len() {
            return Err(PreviewErrorDto::new(
                "incomplete_preview_result",
                "The preview did not return every requested result.",
                true,
            ));
        }

        // Everything the caller is owed, established before anything is
        // recorded. A batch can be the right length and still be short of a
        // result, and recording a preview that is about to be refused would
        // leave the dataset owning facts the user was never shown -- with rows
        // a later spectrum would silently reconcile against.
        let metadata = metadata.ok_or_else(|| missing("metadata"))?;
        let run_summary = run_summary.ok_or_else(|| missing("run summary"))?;
        let spectrum_table = spectrum_table.ok_or_else(|| missing("spectrum table"))?;

        // One commit, under one lock, of facts that are only true together: the
        // generation this was read at, the backend that read it, and the rows a
        // later spectrum is reconciled against.
        let mut workspace = self.workspace();
        // The dataset can have been revoked while this ran, and a newer request
        // for it can have been made: the workspace stays answerable throughout,
        // which is the point of not holding it. Either way this reply records
        // nothing and says so. Writing it would leave the session holding
        // preview facts for a dataset that no longer exists, or the older of two
        // reads of one dataset deciding what a later spectrum is reconciled
        // against -- the commit order of two opens is not their request order.
        if !workspace.request_is_current(id, epoch) {
            return Err(superseded());
        }
        workspace.runtime.entry(id).or_default().preview = Some(DatasetPreviewState {
            opened: OpenedPreview {
                source: before,
                generation,
                installation,
            },
            table_rows,
        });
        // Described as the roster describes it, so a preview header and the row
        // it belongs to cannot disagree about which of two identically named
        // files this is. Read from the lock that is already held rather than
        // taking it again: the workspace mutex is not reentrant, and asking for
        // it a second time inside an expression still holding the first is a
        // deadlock that stops the whole session.
        //
        // The fallback is not decoration. `request_is_current` above proves the
        // request has not been superseded, not that the row is still there --
        // and the accepted file is what the read was actually of.
        let described =
            dataset_dto(&workspace, id).unwrap_or_else(|| selected_file_dto(id, &file, None));
        drop(workspace);

        Ok(PreviewDto {
            installation_generation: generation,
            file: described,
            metadata,
            run_summary,
            spectrum_table,
        })
    }

    /// Loads exactly one spectrum by zero-based index. Requests stay direct and
    /// uncached in this slice.
    pub fn load_spectrum(
        &self,
        handle: &str,
        index: u64,
    ) -> Result<SelectedSpectrumOutcomeDto, PreviewErrorDto> {
        self.require_usable_backend()?;
        // Refused rather than queued, for the reason an open is: the backend
        // gate would serialize it anyway, but a spectrum waiting behind a whole
        // conversion sits in a loading state for as long as one takes, and
        // every further selection adds another queued request nobody sees.
        //
        // A conversion only, for the reason an open says: an adoption launches
        // nothing and leaves an open preview exactly as it is, so navigating
        // one while outputs are being checked is ordinary work.
        if self.conversion_is_busy() {
            return Err(conversion_busy());
        }
        let id = DatasetId::parse(handle).ok_or_else(unknown_dataset)?;
        // Claimed before the wait, so a request that arrives after this one
        // supersedes it. Per dataset: a spectrum chosen in one dataset says
        // nothing about whether the user still wants one from another.
        let epoch = self
            .workspace()
            .begin_request(id)
            .ok_or_else(unknown_dataset)?;
        // Waiting first, so everything below describes the moment this read
        // begins. Checked after the wait, not before it: what matters is
        // whether the user has moved on by the time it would start.
        let running = self.enter_backend();
        // And whether the session still trusts the backend, for the same
        // reason: the queue this read waited behind may have ended by failing
        // to confirm that its converter died.
        self.require_usable_backend()?;
        // A selected spectrum is shown beside the metadata and the table from
        // the open action. If the file has changed since then, this spectrum
        // would belong to a different run than everything around it. Read in
        // the same lock as the supersession check, so the preview facts belong
        // to the request that was just found to be current.
        //
        // The recorded preview is not cloned whole. Its table holds one entry
        // per spectrum of the acquisition, and copying tens of thousands of
        // them under this lock -- while also holding the backend gate -- would
        // stall every other command for the length of the copy. Only the two
        // facts this read uses are taken.
        let (remembered, opened, expected_row) = {
            let workspace = self.workspace();
            if !workspace.request_is_current(id, epoch) {
                return Err(superseded());
            }
            let remembered = workspace
                .registry
                .get(id)
                .expect("a current request names a registered dataset")
                .file()
                .clone();
            let preview = workspace
                .runtime
                .get(&id)
                .and_then(|state| state.preview.as_ref());
            let opened = preview.map(|preview| preview.opened.clone());
            let expected_row =
                preview.and_then(|preview| preview.table_rows.get(index as usize).cloned());
            (remembered, opened, expected_row)
        };
        let file = revalidate(&remembered)?;
        // Two refusals, before anything is launched, and neither replaces the
        // other. The table's rows are what this spectrum is reconciled against,
        // and they were read by whichever backend was in use then; reconciling
        // across a change would compare two backends' readings and call the
        // difference a finding about the file. Dropping the comparison is not
        // the alternative -- it is the check that keeps the row the user
        // clicked and the panel beside it describing the same spectrum.
        //
        // The sequence number is cheap and known already, so a deliberate
        // change costs nothing to catch.
        if let Some(opened) = opened.as_ref()
            && opened.generation != running.installation
        {
            return Err(installation_changed_since_preview());
        }
        // The sequence only counts changes something looked at, so a backend
        // replaced on disk since the last look advances nothing. This asks the
        // filesystem directly -- and only the filesystem: resolving again would
        // mean two help probes and two executable hashes on every row a user
        // clicks, for a check whose whole purpose is to refuse cheaply. It
        // catches the tools being deleted, replaced or rewritten, which is what
        // a stale preview looks like from here, and the operation below reports
        // the identity it actually ran with for everything else.
        if let Some(opened) = opened.as_ref()
            && let Some(installation) = opened.installation.as_ref()
            && !installation.still_the_same_files()
        {
            return Err(installation_changed_since_preview());
        }
        let opened_generation = opened.as_ref().map(|opened| opened.source.clone());
        if let Some(expected) = opened_generation.as_ref()
            && SourceGeneration::capture(file.path()) != *expected
        {
            return Err(source_changed_since_preview());
        }

        // Also compared against the handle's own accepted identity, so a file
        // replaced between validation and spawn is caught even when no preview
        // generation has been recorded yet.
        if SourceGeneration::capture(file.path()) != SourceGeneration::of(&file) {
            return Err(source_changed_since_preview());
        }

        let redactor = reporting_redactor(file.path());
        let operation = selected_spectrum_operation(index);
        let guard = lock_against_replacement(file.path())?;
        let attempt = self.provider.run(file.path(), &operation)?;
        // What ran, recorded before how it went. An operation can fail for
        // reasons that say nothing about which backend ran it -- a launch that
        // was refused, a wait that was interrupted, output that could not be
        // captured -- and propagating that error first would throw away the one
        // fact that says whether it even came from the installation this
        // preview belongs to. The banner would then keep describing the old
        // installation while every retry ran the new one.
        self.note_resolved(attempt.installation.clone());
        // And once more on what actually ran. The pre-flight above looked at
        // the recorded tools a moment before this launched, which leaves a
        // window the size of that moment; this closes it with the identity the
        // operation itself reports, which is the only one that describes this
        // spectrum.
        if let Some(opened) = opened.as_ref()
            && opened.installation != attempt.installation
        {
            return Err(installation_changed_since_preview());
        }
        // Same installation, so the operation's own failure is the truth about
        // this read -- kept as it is, retryability and all.
        let outcome = attempt.outcome?;
        drop(guard);
        drop(running);
        if SourceGeneration::capture(file.path()) != SourceGeneration::of(&file) {
            return Err(source_changed_since_preview());
        }
        if let Some(expected) = opened_generation.as_ref()
            && SourceGeneration::capture(file.path()) != *expected
        {
            return Err(source_changed_since_preview());
        }
        // Nothing is rechecked against the workspace from here on. A request
        // that had already started is not cancelled by a later selection, and
        // the rows this result is reconciled against were read above, under the
        // same lock that found this request current -- so the comparison below
        // is against the preview this spectrum actually belongs to, whatever
        // has happened to the workspace since.
        match outcome {
            PreviewOutcome::Value(value) => match *value {
                PreviewValue::SelectedSpectrum(spectrum) => {
                    // The table and the binary formatter are separate readings.
                    // If they disagree about which scan this index is, the row
                    // the user clicked and the panel beside it would describe
                    // different spectra, so the result is refused instead.
                    if let Some(expected) = expected_row {
                        if expected.identity.reconcile(spectrum.identity()).is_err() {
                            return Err(PreviewErrorDto::new(
                                "spectrum_identity_conflict",
                                "The spectrum list and this spectrum disagree about which scan \
                                 that row is, so MSCanvas did not show one beside the other.",
                                false,
                            ));
                        }
                        if expected.contradicts(&spectrum) {
                            return Err(PreviewErrorDto::new(
                                "spectrum_facts_conflict",
                                "The spectrum list and this spectrum disagree about what that \
                                 row measures, so MSCanvas did not show one beside the other.",
                                false,
                            ));
                        }
                    }
                    Ok(SelectedSpectrumOutcomeDto::Spectrum {
                        spectrum: Box::new(selected_spectrum_dto(&spectrum, &redactor)?),
                    })
                }
                _ => Err(PreviewErrorDto::new(
                    "unexpected_preview_result",
                    "The preview returned a result MSCanvas did not request.",
                    false,
                )),
            },
            PreviewOutcome::NoResult(PreviewNoResult::SpectrumUnavailable { requested_index }) => {
                Ok(SelectedSpectrumOutcomeDto::Unavailable { requested_index })
            }
        }
    }
}

/// A cheap stamp of which generation of a file was read.
///
/// Filesystem identity, length and modification time, not a digest: the
/// representative acquisition is 208 MB and hashing it around every preview
/// would cost more than the preview. The identity is what catches a file
/// replaced by another one of the same size at the same recorded time.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceGeneration {
    identity: Option<FileIdentity>,
    byte_length: Option<u64>,
    modified: Option<std::time::SystemTime>,
}

impl SourceGeneration {
    fn capture(path: &Path) -> Self {
        let metadata = std::fs::symlink_metadata(path).ok();
        Self {
            identity: file_identity(path),
            byte_length: metadata.as_ref().map(std::fs::Metadata::len),
            modified: metadata.and_then(|metadata| metadata.modified().ok()),
        }
    }

    /// The generation the handle was accepted with, so a read can be checked
    /// against what the user chose rather than only against itself.
    fn of(file: &AcceptedFile) -> Self {
        Self {
            identity: Some(file.identity()),
            byte_length: Some(file.byte_length()),
            modified: std::fs::symlink_metadata(file.path())
                .ok()
                .and_then(|metadata| metadata.modified().ok()),
        }
    }
}

#[cfg(test)]
mod source_generation_tests {
    use super::{FileIdentity, SourceGeneration};

    #[test]
    fn a_generation_differs_when_only_the_upper_file_id_bits_do() {
        // Length and modification time are held equal on purpose: the identity
        // is the only thing left to tell these two apart, and before the
        // widening its upper half was not part of it.
        let mut lower_only = [0_u8; 16];
        lower_only[..8].copy_from_slice(&42_u64.to_ne_bytes());
        let mut with_upper = lower_only;
        with_upper[8..].copy_from_slice(&1_u64.to_ne_bytes());
        let at = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000);
        let generation = |file_id| SourceGeneration {
            identity: Some(FileIdentity::for_test(9, file_id)),
            byte_length: Some(4_096),
            modified: Some(at),
        };

        assert_ne!(generation(lower_only), generation(with_upper));
        assert_eq!(generation(with_upper), generation(with_upper));
    }
}

/// A spectrum identifier is backend text like every other line the boundary
/// forwards, so it is redacted and bounded the same way. A file is free to put
/// an unrelated path, or an arbitrarily long value, in a native identifier.
pub(super) fn displayable_identifier(raw: &str, redactor: &Redactor) -> String {
    let redacted = redact_absolute_paths(&redactor.redact(raw));
    bounded_text(&redacted, MAX_IDENTIFIER_CHARS)
}

/// What the spectrum table said about one row.
///
/// Kept so a selected spectrum can be checked against the row that produced
/// it: the two come from different formatters, and a highlighted row paired
/// with a panel describing different measurements is worse than no panel.
#[derive(Debug, Clone)]
struct TableRowFacts {
    identity: SpectrumIdentity,
    ms_level: u32,
    retention_time: f64,
    base_peak_mz: f64,
    base_peak_intensity: f64,
    total_ion_current: f64,
}

impl TableRowFacts {
    fn contradicts(&self, spectrum: &SelectedSpectrumResult) -> bool {
        self.ms_level != spectrum.ms_level()
            || differs(self.retention_time, spectrum.retention_time().value())
            || differs(self.base_peak_mz, spectrum.base_peak_mz())
            || differs(self.base_peak_intensity, spectrum.base_peak_intensity())
            || differs(self.total_ion_current, spectrum.total_ion_current())
    }
}

/// Whether two readings of the same quantity contradict each other.
///
/// The table prints rounded values and the binary formatter prints full
/// precision, so exact equality would report a conflict on nearly every real
/// file. The tolerance is deliberately generous — a percent, with an absolute
/// floor for values near zero — because its job is to catch a different
/// spectrum, not to police rounding. MS level is compared exactly instead,
/// since an integer cannot be a rounding artefact.
fn differs(left: f64, right: f64) -> bool {
    const RELATIVE: f64 = 0.01;
    const ABSOLUTE: f64 = 0.05;

    let tolerance = ABSOLUTE.max(RELATIVE * left.abs().max(right.abs()));
    (left - right).abs() > tolerance
}

impl PreviewService {
    /// Waits for the right to run a backend operation.
    ///
    /// The guard is the permission; dropping it releases the next caller.
    fn enter_backend(&self) -> BackendRun<'_> {
        let guard = self
            .backend_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        BackendRun {
            installation: self.installation_generation.load(Ordering::Relaxed),
            _guard: guard,
        }
    }
}

/// The backend gate, held, and what was true when it was taken.
///
/// The installation generation travels with the guard so that reading it after
/// the gate is released stops compiling. An installation change queued behind
/// this run acquires the gate the instant it is dropped, so a value read after
/// that can name the installation which *replaced* the one whose work is being
/// recorded -- and a preview stamped that way passes the check that exists to
/// refuse it, putting one installation's spectrum beside another's rows.
///
/// `use_installation` deliberately does not use this field: it advances the
/// generation after taking the gate, so the value it must report is the one
/// after its own change, not the one it found.
struct BackendRun<'a> {
    _guard: std::sync::MutexGuard<'a, ()>,
    installation: u64,
}

/// What one open action read, and which backend read it.
#[derive(Debug, Clone)]
struct OpenedPreview {
    source: SourceGeneration,
    /// Where the sequence stood. Cheap, and known before anything is launched,
    /// so a deliberate change is refused without spending a process.
    generation: u64,
    /// Which backend actually produced the rows. `None` when the batch reported
    /// none, which compares equal to nothing and so refuses rather than
    /// assumes.
    installation: Option<InstallationIdentity>,
}

/// The parents of a discovered candidate, which is its location without its
/// name.
///
/// Discovery's components end in the filename, because that is what makes them
/// a location *of a file*. What a display context needs is where the file is,
/// and repeating the name inside the thing that disambiguates the name would
/// say it twice.
fn parent_components(relative: &[std::ffi::OsString]) -> Vec<std::ffi::OsString> {
    relative
        .split_last()
        .map(|(_, parents)| parents.to_vec())
        .unwrap_or_default()
}

fn limit_dto(limit: DiscoveryLimit) -> FolderScanLimitDto {
    match limit {
        DiscoveryLimit::Depth => FolderScanLimitDto::Depth,
        DiscoveryLimit::Entries => FolderScanLimitDto::Entries,
        DiscoveryLimit::Directories => FolderScanLimitDto::Directories,
        DiscoveryLimit::Candidates => FolderScanLimitDto::Candidates,
    }
}

/// What a candidate is refused with when the file behind its name changed.
///
/// Its own kind rather than the acceptance failures beside it, because it is
/// the one refusal that is not about the file being unreadable: the path
/// resolved, the file opened, and it simply is not the file that was found.
fn folder_candidate_changed() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "folder_candidate_changed",
        "That file changed while MSCanvas was scanning the folder, so it was not added. Scan \
         the folder again to pick up what is there now.",
        true,
    )
}

fn drop_candidate_changed() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "drop_candidate_changed",
        "That file changed while MSCanvas was adding the dropped items, so it was not added. \
         Drop it again to inspect what is there now.",
        true,
    )
}

/// Turns a private discovery refusal into something the webview may see.
///
/// One arm per kind, spelled out rather than defaulted, so adding a kind to the
/// traversal makes this fail to compile instead of silently reporting the new
/// refusal as one of the old ones. Nothing here carries a path, a root name or
/// an operating-system message.
fn folder_error(kind: DiscoveryErrorKind) -> PreviewErrorDto {
    match kind {
        DiscoveryErrorKind::PlatformUnavailable => PreviewErrorDto::new(
            "folder_discovery_unavailable",
            "Adding a folder of mzML files is available on Windows in this version.",
            false,
        ),
        DiscoveryErrorKind::RootUnavailable => PreviewErrorDto::new(
            "folder_not_readable",
            "MSCanvas could not read that folder. Check that it still exists and that you can \
             open it, or choose another one.",
            true,
        ),
        DiscoveryErrorKind::RootNotDirectory => PreviewErrorDto::new(
            "folder_not_directory",
            "That choice is not a folder. Choose the folder that holds the .mzML files.",
            true,
        ),
        // Not retryable for the same choice, and the message says what to
        // choose instead rather than inviting the user to try the same thing.
        DiscoveryErrorKind::RootReparsePoint => PreviewErrorDto::new(
            "folder_link_unsupported",
            "That is a shortcut or link to a folder rather than a folder. MSCanvas does not \
             follow links when scanning, so choose the folder it points at.",
            false,
        ),
        DiscoveryErrorKind::RemoteRootUnsupported => PreviewErrorDto::new(
            "network_folder_unsupported",
            "MSCanvas scans folders on this computer in this version. Choose a folder on a \
             local drive.",
            false,
        ),
        DiscoveryErrorKind::RootEnumerationFailed => PreviewErrorDto::new(
            "folder_scan_unreadable",
            "MSCanvas could not list what is in that folder. Check that you can open it, or \
             choose another one.",
            true,
        ),
        // Deliberately says nothing about what the filesystem answered. The
        // detail is a Win32 record layout, which is neither actionable nor
        // safe to forward.
        DiscoveryErrorKind::FilesystemInvariantFailed => PreviewErrorDto::new(
            "folder_scan_failed",
            "MSCanvas stopped scanning that folder because the filesystem described it in a \
             way it could not read. Nothing was added.",
            true,
        ),
    }
}

fn installation_changed_since_preview() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "installation_changed_since_preview",
        "The ProteoWizard installation changed after this file was opened, so this spectrum \
         was not compared against a table that a different installation produced. Open the \
         file again to continue.",
        false,
    )
}

fn source_changed_since_preview() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "source_changed_since_preview",
        "The file has changed since it was opened, so this spectrum was not shown \
         beside metadata that no longer describes it. Open the file again to continue.",
        false,
    )
}

fn missing(what: &str) -> PreviewErrorDto {
    PreviewErrorDto::new(
        "preview_result_missing",
        format!("The preview did not return its {what} result."),
        true,
    )
}

/// What a request answers with once the user has moved on from it.
///
/// One kind for every way that happens -- a newer spectrum chosen in the same
/// dataset, a newer open of it, and the dataset itself removed -- because they
/// are the same fact to the caller: the answer it asked for is no longer the
/// one it wants. The kind is the one the boundary already spoke; what widened
/// is which requests can reach it, now that a roster lets the user activate one
/// dataset twice.
fn superseded() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "selection_superseded",
        "A newer request for that file arrived before this one finished, so its result was not \
         used.",
        false,
    )
}

fn section_title(kind: MetadataSectionKind) -> &'static str {
    match kind {
        MetadataSectionKind::FileDescription => "File description",
        MetadataSectionKind::SampleList => "Samples",
        MetadataSectionKind::InstrumentConfigurationList => "Instrument configuration",
        MetadataSectionKind::SoftwareList => "Software",
        MetadataSectionKind::DataProcessingList => "Data processing",
    }
}

/// Metadata lines are backend output that can contain the opened path, so every
/// line is redacted and bounded before it becomes visible.
fn metadata_dto(result: &MetadataResult, redactor: &Redactor) -> MetadataDto {
    // Anything the backend printed before its first section is metadata too.
    // Counting it and dropping it would show an incomplete list with no sign
    // that anything was missing.
    let leading = metadata_section_dto(
        "leading",
        "Lines before the first section",
        result
            .leading_entries()
            .iter()
            .map(MetadataEntry::sensitive_text),
        result.leading_entries().len(),
        redactor,
    );

    let mut sections = Vec::with_capacity(result.sections().len() + 1);
    if !leading.entries.is_empty() {
        sections.push(leading);
    }
    for section in result.sections() {
        sections.push(metadata_section_dto(
            section.kind().stable_id(),
            section_title(section.kind()),
            section.entries().iter().map(MetadataEntry::sensitive_text),
            section.entries().len(),
            redactor,
        ));
    }
    MetadataDto { sections }
}

/// Redacts and bounds one section's lines.
///
/// Session redaction first, then any remaining path-shaped token the document
/// itself recorded, then a length bound; and the section reports how many lines
/// it really had, so a prefix never reads as the whole.
fn metadata_section_dto<'entries>(
    id: &str,
    title: &str,
    entries: impl Iterator<Item = &'entries str>,
    total_entry_count: usize,
    redactor: &Redactor,
) -> MetadataSectionDto {
    MetadataSectionDto {
        id: id.to_owned(),
        title: title.to_owned(),
        entries: entries
            .take(MAX_METADATA_ENTRIES)
            .map(|entry| {
                let redacted = redact_absolute_paths(&redactor.redact(entry));
                bounded_text(&redacted, MAX_METADATA_LINE_CHARS)
            })
            .collect(),
        total_entry_count,
        truncated: total_entry_count > MAX_METADATA_ENTRIES,
    }
}

fn retention_time_dto(
    value: mscanvas_proteowizard::RetentionTime,
) -> Result<RetentionTimeDto, PreviewErrorDto> {
    Ok(RetentionTimeDto {
        value: require_finite(value.value())?,
        // The measured formatter emits no unit, so none is claimed.
        unit_known: false,
    })
}

fn run_summary_dto(result: &RunSummaryResult) -> Result<RunSummaryDto, PreviewErrorDto> {
    let retention_time_range = result
        .retention_time_range()
        .map(|range| {
            Ok::<_, PreviewErrorDto>(RetentionTimeRangeDto {
                minimum: retention_time_dto(range.minimum())?,
                maximum: retention_time_dto(range.maximum())?,
            })
        })
        .transpose()?;

    let total_ms_level_count = result.counts_by_ms_level().len();
    Ok(RunSummaryDto {
        total_spectrum_count: result.total_spectrum_count(),
        ms_levels: result
            .counts_by_ms_level()
            .iter()
            .take(MAX_MS_LEVELS)
            .map(|count| MsLevelCountDto {
                ms_level: match count.bucket() {
                    MsLevelBucket::Level(level) => Some(level),
                    MsLevelBucket::Other => None,
                },
                spectrum_count: count.spectrum_count(),
            })
            .collect(),
        total_ms_level_count,
        ms_levels_truncated: total_ms_level_count > MAX_MS_LEVELS,
        chromatogram_count: result.chromatogram_count(),
        retention_time_range,
    })
}

fn spectrum_table_dto(
    result: &SpectrumTableResult,
    redactor: &Redactor,
) -> Result<SpectrumTableDto, PreviewErrorDto> {
    let total_row_count = result.rows().len();
    let truncated = total_row_count > MAX_SPECTRUM_TABLE_ROWS;
    let mut rows = Vec::with_capacity(total_row_count.min(MAX_SPECTRUM_TABLE_ROWS));
    for row in result.rows().iter().take(MAX_SPECTRUM_TABLE_ROWS) {
        let identity = row.identity();
        rows.push(SpectrumRowDto {
            index: identity.index(),
            identifier: identity.representations().first().map_or_else(
                || identity.index().to_string(),
                |representation| displayable_identifier(representation.sensitive_raw(), redactor),
            ),
            scan_number: identity.scan_number(),
            ms_level: row.ms_level(),
            retention_time: retention_time_dto(row.retention_time())?,
            base_peak_mz: require_finite(row.base_peak_mz())?,
            base_peak_intensity: require_finite(row.base_peak_intensity())?,
            total_ion_current: require_finite(row.total_ion_current())?,
            precursor_mz: require_finite_option(row.precursor_mz())?,
        });
    }
    Ok(SpectrumTableDto {
        rows,
        total_row_count,
        truncated,
    })
}

fn selected_spectrum_dto(
    spectrum: &SelectedSpectrumResult,
    redactor: &Redactor,
) -> Result<SelectedSpectrumDto, PreviewErrorDto> {
    let point_count = spectrum.mz_values().len();
    let truncated = point_count > MAX_SPECTRUM_POINTS;
    let transferred = point_count.min(MAX_SPECTRUM_POINTS);

    let mut mz = Vec::with_capacity(transferred);
    for value in spectrum.mz_values().iter().take(transferred) {
        mz.push(require_finite(*value)?);
    }
    let mut intensity = Vec::with_capacity(transferred);
    for value in spectrum.intensity_values().iter().take(transferred) {
        intensity.push(require_finite(*value)?);
    }

    let total_precursor_count = spectrum.precursors().len();
    let mut precursors = Vec::with_capacity(total_precursor_count.min(MAX_PRECURSORS));
    for precursor in spectrum.precursors().iter().take(MAX_PRECURSORS) {
        precursors.push(PrecursorDto {
            index: precursor.index(),
            mz: require_finite(precursor.mz())?,
            intensity: require_finite(precursor.intensity())?,
        });
    }

    let identity = spectrum.identity();
    Ok(SelectedSpectrumDto {
        index: identity.index(),
        scan_number: identity.scan_number(),
        identifiers: identity
            .representations()
            .iter()
            .map(|representation| displayable_identifier(representation.sensitive_raw(), redactor))
            .collect(),
        ms_level: spectrum.ms_level(),
        retention_time: retention_time_dto(spectrum.retention_time())?,
        point_count,
        mz,
        intensity,
        mz_low: require_finite(spectrum.mz_low())?,
        mz_high: require_finite(spectrum.mz_high())?,
        base_peak_mz: require_finite(spectrum.base_peak_mz())?,
        base_peak_intensity: require_finite(spectrum.base_peak_intensity())?,
        total_ion_current: require_finite(spectrum.total_ion_current())?,
        precursors,
        total_precursor_count,
        precursors_truncated: total_precursor_count > MAX_PRECURSORS,
        // The measured selected-spectrum formatter emits neither a
        // profile/centroid marker nor array units, so both stay unknown.
        representation_known: false,
        value_units_known: false,
        truncated,
    })
}

/// Every way the safe writer can fail, said in this boundary's vocabulary.
///
/// Total over the writer's own enumeration, with no wildcard arm: a failure
/// added there has to be answered here rather than falling into a default that
/// happens to compile. The residue travels with each of them rather than being
/// folded away — "this could not be saved" and "this could not be saved and
/// there is now a file in your folder MSCanvas cannot remove" are different
/// things to be told, and the second is the one the user has to act on.
fn diagnostics_write_failure(failure: LocalFileWriteFailure) -> PreviewErrorDto {
    let residue = failure.temporary_left_behind();
    match failure.error() {
        // The dialog answered with something that is not one plain name inside
        // one usable folder. Nothing was created either way.
        LocalFileWriteError::UnsafeName | LocalFileWriteError::ParentNotUsable { .. } => {
            diagnostics_destination_unusable()
        }
        LocalFileWriteError::TargetExists => diagnostics_destination_exists(residue),
        LocalFileWriteError::TemporaryNotCreated { .. }
        | LocalFileWriteError::NotWritten { .. }
        | LocalFileWriteError::NotFlushed { .. } => diagnostics_not_written(residue),
        LocalFileWriteError::NotFinalized { .. } => diagnostics_not_finalized(residue),
    }
}

/// Clears the export mirror however the export ends, and returns the slot to
/// idle.
///
/// A flag left set would refuse every action on the terminal queue for the rest
/// of the session, which is a worse failure than the one it would be recording.
struct DiagnosticsExportInFlight<'service>(&'service PreviewService);

impl Drop for DiagnosticsExportInFlight<'_> {
    fn drop(&mut self) {
        // Through the same helper every other transition uses, so a failed
        // export is seen to have ended. Releasing without moving the ordering
        // key would leave every document that installs by it still showing an
        // export under way, with every action it closes still closed.
        self.0.change_diagnostics(DiagnosticsExportSlot::release);
    }
}

/// Clears the adoption mirror however the adoption ends.
///
/// A flag left set would refuse every later adoption for the rest of the
/// session, which is a worse failure than the one it would be recording.
struct AdoptionInFlight<'service>(&'service PreviewService);

impl Drop for AdoptionInFlight<'_> {
    fn drop(&mut self) {
        self.0.adopting_outputs.store(false, Ordering::Release);
    }
}

/// One output's adoption, before the roster it produced exists.
enum PendingAdoption {
    Registered {
        item_index: usize,
        source_handle: String,
        output_file_name: String,
        outcome: AddDatasetOutcome,
    },
    Refused {
        item_index: usize,
        source_handle: String,
        output_file_name: String,
        reason: String,
    },
}

/// Describes what each adoption did, against the roster it produced.
///
/// The contexts are recomputed over the whole live registry, exactly as every
/// other workspace answer does: whether a name needs disambiguating is a fact
/// about the roster now, not about the moment a row arrived.
fn describe_adoptions(
    workspace: &Workspace,
    pending: Vec<PendingAdoption>,
) -> Vec<WorkspaceOutputAdoptionOutcomeDto> {
    let contexts = relative_contexts(&workspace.registry);
    let describe = |id: DatasetId| {
        workspace
            .registry
            .get(id)
            .map(|dataset| selected_file_dto(id, dataset.file(), contexts.get(&id).cloned()))
    };
    pending
        .into_iter()
        .map(|item| match item {
            PendingAdoption::Refused {
                item_index,
                source_handle,
                output_file_name,
                reason,
            } => WorkspaceOutputAdoptionOutcomeDto::Refused {
                item_index,
                source_handle,
                output_file_name,
                reason,
            },
            PendingAdoption::Registered {
                item_index,
                source_handle,
                output_file_name,
                outcome,
            } => match (outcome, outcome.registered_id().and_then(describe)) {
                (AddDatasetOutcome::Added { .. }, Some(dataset)) => {
                    WorkspaceOutputAdoptionOutcomeDto::Added {
                        item_index,
                        source_handle,
                        output_file_name,
                        dataset,
                    }
                }
                (AddDatasetOutcome::Duplicate { .. }, Some(dataset)) => {
                    WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace {
                        item_index,
                        source_handle,
                        output_file_name,
                        dataset,
                    }
                }
                // Full, or a row that vanished between the insert and the
                // description. Neither has a workspace row to name, and
                // inventing a handle for one would be the one thing this
                // boundary must never do.
                _ => WorkspaceOutputAdoptionOutcomeDto::Refused {
                    item_index,
                    source_handle,
                    output_file_name,
                    reason: String::from("workspace_full"),
                },
            },
        })
        .collect()
}
