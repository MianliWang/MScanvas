//! The application service the Tauri commands adapt.
//!
//! This is where typed backend results become transfer objects. It is the only
//! place allowed to decide what the webview may see, and it is unit-testable
//! without a WebView or a local ProteoWizard installation.

use std::collections::HashMap;
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
use super::dto::{
    BackendAvailabilityDto, MAX_IDENTIFIER_CHARS, MAX_METADATA_ENTRIES, MAX_METADATA_LINE_CHARS,
    MAX_MS_LEVELS, MAX_PRECURSORS, MAX_SPECTRUM_POINTS, MAX_SPECTRUM_TABLE_ROWS, MetadataDto,
    MetadataSectionDto, MsLevelCountDto, PrecursorDto, PreviewDto, PreviewErrorDto,
    RetentionTimeDto, RetentionTimeRangeDto, RunSummaryDto, SelectedFileDto, SelectedSpectrumDto,
    SelectedSpectrumOutcomeDto, SpectrumRowDto, SpectrumTableDto, bounded_text,
    redact_absolute_paths, require_finite, require_finite_option,
};
use super::installation::InstallationIdentity;
use super::selection::{
    AcceptedFile, DatasetId, DatasetRegistry, FileIdentity, RevocationReason, accept_mzml_file,
    file_identity, lock_against_replacement, revalidate, selected_file_dto, unknown_dataset,
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

    /// The file a handle names, as it was accepted, or the refusal for a handle
    /// that names nothing this session holds.
    ///
    /// A clone rather than a borrow, so the lock is released before the file is
    /// revalidated or read.
    fn remembered_file(&self, id: DatasetId) -> Result<AcceptedFile, PreviewErrorDto> {
        self.workspace()
            .registry
            .get(id)
            .map(|dataset| dataset.file().clone())
            .ok_or_else(unknown_dataset)
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

    /// Accepts one already-chosen path and registers it for later operations.
    ///
    /// The registry can hold several datasets; this entry point deliberately
    /// keeps exactly one. Registering files the user cannot see, curate or
    /// remove would hand the webview capabilities it never asked for and cannot
    /// withdraw, which is what ADR 0005 refused and ADR 0006 keeps refusing
    /// until the roster interface exists to make them visible.
    pub fn accept_file(&self, path: &Path) -> Result<SelectedFileDto, PreviewErrorDto> {
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
        let id = workspace.registry.add(accepted).id();
        let held = workspace.registry.len();
        let dto = selected_file_dto(
            id,
            workspace
                .registry
                .get(id)
                .expect("the dataset was registered a line ago")
                .file(),
        );
        drop(workspace);
        // Outside the lock. One session-wide lock now covers the registry and
        // everything derived from it, so a panic inside it would take every
        // later command with it -- and this assertion is about what the caller
        // was handed, which is already decided.
        debug_assert_eq!(
            held, 1,
            "the picker replaces the selection; the roster is what adds to it"
        );
        Ok(dto)
    }
}

/// The workspace behaviour this slice builds and nothing in production reaches.
///
/// Compiled out of the shipped binary on purpose. The roster interface (M1.2)
/// is what will add a second dataset for real; until a user can see, curate and
/// remove what the session holds, a production path that accumulates files
/// would hand the webview capabilities it never asked for and cannot withdraw.
/// Keeping these behind `cfg(test)` is what makes that a fact about the build
/// rather than a promise about the call sites.
#[cfg(test)]
impl PreviewService {
    /// Adds one accepted file without disturbing the datasets already held.
    ///
    /// Answers with the dataset the file is now known as. A file already in the
    /// workspace answers with the row it is already on, described as it was
    /// registered rather than as it was just named: two names for one file are
    /// one dataset, and the one the user has is the one they added.
    pub(super) fn add_dataset(&self, path: &Path) -> Result<SelectedFileDto, PreviewErrorDto> {
        let accepted = accept_mzml_file(path)?;
        let mut workspace = self.workspace();
        let id = workspace.registry.add(accepted).id();
        let dataset = workspace
            .registry
            .get(id)
            .expect("the dataset was registered a line ago");
        Ok(selected_file_dto(id, dataset.file()))
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
        // Taken before anything is established about the file, so what is
        // checked describes the moment the read actually begins rather than
        // the moment the request arrived.
        let running = self.enter_backend();
        let id = DatasetId::parse(handle).ok_or_else(unknown_dataset)?;
        let file = revalidate(&self.remembered_file(id)?)?;
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
        // The dataset can have been revoked while this ran: the workspace stays
        // answerable throughout, which is the point of not holding it. A reply
        // that arrives then records nothing. Writing it would leave the session
        // holding preview facts for a dataset that no longer exists, under an
        // identifier nothing can reach and nothing will ever clear.
        if workspace.registry.contains(id) {
            workspace.runtime.entry(id).or_default().preview = Some(DatasetPreviewState {
                opened: OpenedPreview {
                    source: before,
                    generation,
                    installation,
                },
                table_rows,
            });
        }
        drop(workspace);

        Ok(PreviewDto {
            installation_generation: generation,
            file: selected_file_dto(id, &file),
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

/// What a spectrum request answers with once the user has moved on from it.
///
/// One kind for both ways that happens -- a newer spectrum chosen in the same
/// dataset, and the dataset itself replaced -- because they are the same fact
/// to the caller: the answer it asked for is no longer the one it wants.
fn superseded() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "selection_superseded",
        "A newer spectrum was selected before this one started, so it was not read.",
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
