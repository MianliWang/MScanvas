//! The application service the Tauri commands adapt.
//!
//! This is where typed backend results become transfer objects. It is the only
//! place allowed to decide what the webview may see, and it is unit-testable
//! without a WebView or a local ProteoWizard installation.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use mscanvas_proteowizard::{
    MetadataEntry, MetadataResult, MetadataSectionKind, MsLevelBucket, PreviewNoResult,
    PreviewOutcome, PreviewValue, Redactor, RunSummaryResult, SelectedSpectrumResult,
    SpectrumIdentity, SpectrumTableResult,
};

use super::backend::{
    PreviewProvider, open_operations, reporting_redactor, selected_spectrum_operation,
};
use super::discovery::{
    DiscoveryBudget, DiscoveryError, DiscoveryErrorKind, DiscoveryLimit, DiscoveryResult,
    discover_mzml_candidates,
};
use super::dto::MAX_WORKSPACE_DATASETS;
use super::dto::{
    BackendAvailabilityDto, MAX_IDENTIFIER_CHARS, MAX_METADATA_ENTRIES, MAX_METADATA_LINE_CHARS,
    MAX_MS_LEVELS, MAX_PRECURSORS, MAX_SPECTRUM_POINTS, MAX_SPECTRUM_TABLE_ROWS, MetadataDto,
    MetadataSectionDto, MsLevelCountDto, PrecursorDto, PreviewDto, PreviewErrorDto,
    RetentionTimeDto, RetentionTimeRangeDto, RunSummaryDto, SelectedSpectrumDto,
    SelectedSpectrumOutcomeDto, SpectrumRowDto, SpectrumTableDto, WorkspaceAddOutcomeDto,
    WorkspaceAddResultDto, WorkspaceRemoveResultDto, WorkspaceRosterDto, bounded_text,
    redact_absolute_paths, require_finite, require_finite_option, workspace_full,
};
use super::dto::{
    FolderDiscoverySummaryDto, FolderIngestionResultDto, FolderScanLimitDto, SelectedFileDto,
    import_superseded,
};
use super::installation::InstallationIdentity;
use super::selection::{
    AcceptedFile, AddDatasetOutcome, DatasetId, DatasetRegistry, FileIdentity, RevocationReason,
    accept_mzml_file, candidate_display_name, file_identity, lock_against_replacement,
    relative_contexts, revalidate, selected_file_dto, unknown_dataset,
};

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
    /// How many times the installation in use has changed.
    ///
    /// Stamped onto every verdict under the same gate that serves it, so the
    /// verdict says where in that sequence it belongs. Request order is not
    /// service order -- two commands contend for this gate and it does not
    /// grant in the order they were called -- so a caller that trusted its own
    /// ordering could show the installation a choice replaced while every
    /// later operation used the chosen one.
    installation_generation: AtomicU64,
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
}

impl PreviewService {
    #[must_use]
    pub fn new(provider: Box<dyn PreviewProvider>) -> Self {
        Self {
            provider,
            workspace: Mutex::new(Workspace::default()),
            backend_gate: Mutex::new(()),
            workspace_mutation: Mutex::new(WorkspaceMutationState::default()),
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
        let _running = self.enter_backend();
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
        let _running = self.enter_backend();
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
        availability
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

    /// Everything the session holds, in the order it was added.
    ///
    /// Stored facts only. Nothing is revalidated here and no process is
    /// launched: a roster read happens on every mount and after every mutation,
    /// and rechecking a thousand paths each time would turn drawing a list into
    /// a thousand filesystem inspections. Whether a row's file is still the file
    /// it was is a question the next preview of it asks, and answers where the
    /// user can see it.
    pub fn roster(&self) -> WorkspaceRosterDto {
        // Advancing the generation is a side effect, and it is the point. This
        // is the read a webview makes when it mounts, which is also what a
        // reloaded window does -- and a folder scan started by the window
        // before it may still be running, holding no lock and about to commit
        // rows the new window has never heard of.
        //
        // Going through the gate linearises the two. Either the scan commits
        // first and this read includes its rows, or this read wins and the scan
        // finds its generation stale and adds nothing. What cannot happen is
        // the new window adopting a roster and then being given rows it never
        // asked about, with no read left to discover them.
        let (gate, _) = self.begin_mutation();
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
    pub fn add_files(&self, paths: &[PathBuf]) -> WorkspaceAddResultDto {
        // Held for the whole batch so two of these cannot interleave their
        // rows. It is not the workspace lock and never becomes it: acceptance
        // opens and inspects a file, which is filesystem work, and holding the
        // workspace across it would stop every other command for the length of
        // a batch.
        let (_batch, _generation) = self.begin_mutation();
        let mut outcomes = Vec::with_capacity(paths.len());
        for path in paths {
            // Taken before acceptance, because acceptance is what may fail and
            // the user still has to be told which file it was.
            let candidate = candidate_display_name(path);
            let accepted = match accept_mzml_file(path) {
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
        WorkspaceAddResultDto { roster, outcomes }
    }

    /// Scans one chosen folder and adds every mzML file it proposes.
    ///
    /// The shape of this is the whole of what M1.4.1 adds, and every step is
    /// load-bearing:
    ///
    /// 1. reserve a generation, so there is a name for "the workspace as it was
    ///    when this scan was asked for";
    /// 2. scan holding **no** lock -- not the workspace, not the mutation gate.
    ///    A tree can take as long as it takes, and a session frozen for the
    ///    length of it would be one the user could not remove a row from;
    /// 3. take the gate back and refuse outright if anything has happened
    ///    since. A user who cleared the list, added files, or reloaded the
    ///    window has said what the workspace is, and rows from a scan they
    ///    started before that would arrive from nowhere;
    /// 4. accept the candidates in discovery order, under the gate, so the
    ///    batch is one contiguous run;
    /// 5. recheck each candidate's identity against what discovery found,
    ///    because a path is a proposal and the object behind it can be
    ///    replaced between the walk and the open.
    ///
    /// No backend is launched, for any candidate, ever. A folder of a thousand
    /// files costs a thousand filesystem inspections and no processes.
    pub fn add_mzml_folder(
        &self,
        root: &Path,
    ) -> Result<FolderIngestionResultDto, PreviewErrorDto> {
        self.import_folder(|| discover_mzml_candidates(root, DiscoveryBudget::default()))
    }

    /// The reserve, scan and commit an import is made of, with the walk itself
    /// left to the caller.
    ///
    /// Named as its own step because the walk is the one part that runs outside
    /// the gate, and that is both what makes a long scan safe and what makes it
    /// raceable. A test stands a controlled walk in its place and decides
    /// exactly what happens to the workspace while it runs — no sleep, no
    /// guess, and no tree the size of the case being described.
    pub(super) fn import_folder<S>(
        &self,
        scan: S,
    ) -> Result<FolderIngestionResultDto, PreviewErrorDto>
    where
        S: FnOnce() -> Result<DiscoveryResult, DiscoveryError>,
    {
        // Reserved before the scan and released immediately. What it buys is a
        // number: everything that happens afterwards can be compared against
        // it, and nothing has to be held for the comparison to be sound.
        let (gate, reserved) = self.begin_mutation();
        drop(gate);

        let discovered = scan().map_err(|error| folder_error(error.kind()))?;

        // Back under the gate, and deliberately without advancing it: this
        // commit is the completion of the decision made above, not a new one.
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

    /// Removes the rows these handles name, and says which named nothing.
    ///
    /// The source acquisitions are never touched. Removing a row removes a row
    /// and releases the handle that row was holding.
    pub fn remove_datasets(&self, handles: &[String]) -> WorkspaceRemoveResultDto {
        // Advances the generation even when every handle names nothing. The
        // user said "this is the workspace now", and a folder scan that
        // committed across that would repopulate a list they had just pruned.
        let (_batch, _generation) = self.begin_mutation();
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
        WorkspaceRemoveResultDto {
            roster,
            removed_handles: removed,
            unknown_handles: unknown,
        }
    }

    /// Empties the workspace, and answers with the empty roster that is now
    /// authoritative.
    ///
    /// Every row through the same revocation a single removal uses, so emptying
    /// the workspace cannot come to mean something different from removing
    /// every row in it. The identifier allocator does not rewind: a reply still
    /// in flight for one of the emptied datasets must not land on whatever is
    /// added next.
    pub fn clear_workspace(&self) -> WorkspaceRosterDto {
        let (_batch, _generation) = self.begin_mutation();
        let mut workspace = self.workspace();
        workspace.clear(RevocationReason::Cleared);
        roster_of(&workspace)
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

    /// Takes the gate and declares a new state of the workspace.
    ///
    /// Every immediate mutation goes through here, and so does the roster read
    /// the product uses. What they have in common is that each one is a
    /// statement about the workspace from that moment on, which is exactly what
    /// makes an older folder scan's answer no longer the one the user is
    /// waiting for.
    ///
    /// It advances even when the operation ends up changing nothing. Removing
    /// zero rows is still the user saying "this is the workspace now", and a
    /// scan that committed across it would add rows to a list that had already
    /// been answered for.
    fn begin_mutation(&self) -> (std::sync::MutexGuard<'_, WorkspaceMutationState>, u64) {
        let mut gate = self.enter_workspace_mutation();
        let generation = gate.advance();
        (gate, generation)
    }
}

/// Which decision about the workspace is the current one.
///
/// A single counter behind the mutation gate. It is not a lock and it is not a
/// version of the contents: it is the answer to "has anything happened that
/// makes a scan started earlier no longer the thing the user is waiting for".
#[derive(Debug, Default)]
struct WorkspaceMutationState {
    generation: u64,
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
    pub fn open_preview(&self, handle: &str) -> Result<PreviewDto, PreviewErrorDto> {
        let id = DatasetId::parse(handle).ok_or_else(unknown_dataset)?;
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
