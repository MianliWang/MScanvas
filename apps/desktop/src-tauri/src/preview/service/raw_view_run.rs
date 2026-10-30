//! The one-click view's work (ADR 0060, slice 2): one admitted Thermo RAW row
//! to a pinned, verified cache entry, and then to an open preview.
//!
//! A hit runs Checking file and Checking cached copy. A miss runs Checking
//! file, the space check, Converting, Checking output, Storing and Checking
//! cached copy. The operation holds the conversion slot from Checking file
//! until it is terminal (decision 5), takes the backend gate to bind the build
//! and again for the run, and opens nothing itself: the open is
//! `open_raw_view`, through the ordinary preview path (decision 3).
//!
//! What may be written is the cache's: the attempt under `staging`, and the
//! entry it publishes. The RAW is only ever opened for reading.

use std::sync::PoisonError;

use mscanvas_proteowizard::{ConflictPolicy, ConversionRunOutcome};

use super::super::raw_view::{
    Ended, MAX_RAW_BYTES, Progress, RawView, RawViewBeginRequestDto, RawViewOperationRequestDto,
    RawViewPhaseDto, RawViewStateDto, ViewCacheClearOutcomeDto, ViewCacheSummaryDto,
    bytes_needed_for, raw_view_busy, raw_view_not_ready, raw_view_source_changed,
    raw_view_unsupported_source, view_cache_entry_lost, view_cache_entry_too_large,
    view_cache_entry_unavailable, view_cache_entry_unrecognized, view_cache_no_space,
    view_cache_not_stored, view_cache_root_unrecognized, view_cache_unavailable, view_intent_id,
};
use super::super::selection::open_thermo_raw_source_reporting;
use super::*;
use crate::view_cache::{
    CAP_BYTES, CacheKey, Lookup, RootRefusal, StagedFacts, StoreFailure, Stored, VerifiedEntry,
    ViewCache,
};

/// Reads the free space available to this user on the volume holding a
/// folder. Injected so a test never depends on the machine's disk.
type FreeSpace = Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>;

/// Where the view cache lives and how its volume is measured.
pub(super) struct RawViewSettings {
    /// The application-local data folder the preference store is bound to
    /// (decision 6). `None` refuses View with `view_cache_unavailable`.
    parent: Option<PathBuf>,
    free_space: FreeSpace,
    /// Called as each phase begins, for the tests that act at a phase.
    #[cfg(test)]
    phase_hook: Option<Arc<dyn Fn(u64, RawViewPhaseDto) + Send + Sync>>,
}

impl Default for RawViewSettings {
    fn default() -> Self {
        Self {
            parent: None,
            free_space: Arc::new(crate::local_document::available_bytes),
            #[cfg(test)]
            phase_hook: None,
        }
    }
}

/// How the work ended short of a pinned entry. `space` is a no-space
/// failure's needed and free bytes.
enum Stop {
    Failed(Box<(PreviewErrorDto, Option<(u64, u64)>)>),
    Cancelled { stored: bool },
}

impl From<PreviewErrorDto> for Stop {
    fn from(error: PreviewErrorDto) -> Self {
        Self::Failed(Box::new((error, None)))
    }
}

fn no_space(space: Option<(u64, u64)>) -> Stop {
    Stop::Failed(Box::new((view_cache_no_space(), space)))
}

const fn cancelled(stored: bool) -> Stop {
    Stop::Cancelled { stored }
}

fn root_refusal_error(refusal: RootRefusal) -> PreviewErrorDto {
    match refusal {
        RootRefusal::Unavailable => view_cache_unavailable(),
        RootRefusal::Unrecognized => view_cache_root_unrecognized(),
        RootRefusal::Unreadable => view_cache_entry_unavailable(),
    }
}

/// Opens the finalized output so it can be checked and renamed into `entry`:
/// read and delete access, sharing read only, so nothing writes, renames or
/// deletes it in between; a link is opened as itself, never followed.
fn open_for_move(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const DELETE: u32 = 0x0001_0000;
    const READ_DATA: u32 = 0x0001;
    const READ_ATTRIBUTES: u32 = 0x0080;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const SHARE_READ: u32 = 0x1;

    std::fs::OpenOptions::new()
        .access_mode(DELETE | READ_DATA | READ_ATTRIBUTES | SYNCHRONIZE)
        .share_mode(SHARE_READ)
        .custom_flags(crate::local_document::OPEN_REPARSE_POINT)
        .open(path)
}

impl PreviewService {
    fn raw_view_settings(&self) -> std::sync::MutexGuard<'_, RawViewSettings> {
        self.raw_views
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Binds the folder the view cache lives under: the preference store's
    /// own binding, so the `e2e` build's task-owned QA root applies to it too.
    pub fn bind_view_cache(&self, parent: Option<PathBuf>) {
        self.raw_view_settings().parent = parent;
    }

    #[cfg(test)]
    pub(in crate::preview) fn set_view_cache_free_space(
        &self,
        free_space: impl Fn(&Path) -> Option<u64> + Send + Sync + 'static,
    ) {
        self.raw_view_settings().free_space = Arc::new(free_space);
    }

    #[cfg(test)]
    pub(in crate::preview) fn set_raw_view_phase_hook(
        &self,
        hook: impl Fn(u64, RawViewPhaseDto) + Send + Sync + 'static,
    ) {
        self.raw_view_settings().phase_hook = Some(Arc::new(hook));
    }

    fn open_view_cache(&self) -> Result<ViewCache, RootRefusal> {
        let parent = self.raw_view_settings().parent.clone();
        ViewCache::open(parent.as_deref())
    }

    /// `get_raw_view_state`: the latest operation, or `idle`.
    pub fn raw_view_state(&self) -> RawViewStateDto {
        self.conversion_slot()
            .view()
            .map_or(RawViewStateDto::Idle, RawView::to_dto)
    }

    /// `begin_raw_view`: the refusals of decision 4 that need no process, in
    /// its table order, then the slot. The work is `run_raw_view`, which the
    /// caller runs off the async runtime.
    ///
    /// `backend_not_found` and `provider_build_not_evidenced` need the help
    /// probe, so they end the operation `failed` once its worker has bound
    /// the build, before anything is read.
    pub fn begin_raw_view(
        &self,
        request: &RawViewBeginRequestDto,
    ) -> Result<RawViewStateDto, PreviewErrorDto> {
        let id = DatasetId::parse(&request.handle).ok_or_else(unknown_dataset)?;
        self.require_usable_backend()?;
        // The gate a queue is admitted under, so a removal cannot see an idle
        // slot and then revoke the row this view is about to read.
        let _gate = self.enter_workspace_mutation();
        let (kind, file_name, byte_length) = {
            let workspace = self.workspace();
            let file = workspace
                .registry
                .get(id)
                .ok_or_else(unknown_dataset)?
                .file();
            (
                file.source_kind(),
                file.file_name().to_owned(),
                file.byte_length(),
            )
        };
        {
            let slot = self.conversion_slot();
            if slot.is_busy() {
                return Err(slot.busy_refusal());
            }
        }
        if kind != DatasetSourceKind::ThermoRaw {
            return Err(raw_view_unsupported_source());
        }
        drop(self.open_view_cache().map_err(root_refusal_error)?);
        if byte_length > MAX_RAW_BYTES {
            return Err(view_cache_entry_too_large());
        }
        let state = {
            let mut slot = self.conversion_slot();
            slot.begin_view(id, file_name)?;
            self.publish_conversion_busy(&slot);
            slot.view().map_or(RawViewStateDto::Idle, RawView::to_dto)
        };
        // Decision 8: a ready operation that was never opened gives up its
        // pin when the next one begins.
        for state in self.workspace().runtime.values_mut() {
            state.ready_view = None;
        }
        Ok(state)
    }

    /// `cancel_raw_view`: bound to the exact operation. A late press is a
    /// no-op that answers the current state (decision 10).
    pub fn cancel_raw_view(&self, request: RawViewOperationRequestDto) -> RawViewStateDto {
        let mut slot = self.conversion_slot();
        if let Some(view) = slot.view_mut(request.operation)
            && view.is_running()
        {
            view.request_cancel();
        }
        slot.view().map_or(RawViewStateDto::Idle, RawView::to_dto)
    }

    /// Runs one begun operation to its end, then releases the slot.
    pub fn run_raw_view(&self, operation: u64) {
        let (ended, entry) = match self.raw_view_steps(operation) {
            Ok((cache_hit, entry)) => (Ended::Ready { cache_hit }, Some(entry)),
            Err(Stop::Failed(failure)) => {
                let (error, space) = *failure;
                (Ended::Failed(error, space), None)
            }
            Err(Stop::Cancelled { stored }) => (Ended::Cancelled { stored }, None),
        };
        // The pin goes to the row before the state says ready, so an open
        // that reads `ready` finds it.
        if let Some(entry) = entry {
            let dataset = self.conversion_slot().view().map(|view| view.dataset);
            let mut workspace = self.workspace();
            if let Some(dataset) = dataset
                && workspace.registry.contains(dataset)
            {
                workspace.runtime.entry(dataset).or_default().ready_view = Some(entry);
            }
        }
        let mut slot = self.conversion_slot();
        if let Some(view) = slot.view_mut(operation) {
            view.finish(ended);
        }
        self.publish_conversion_busy(&slot);
    }

    /// A worker that ended without finishing releases the slot, so a lost
    /// thread does not leave every route the slot guards refused for good.
    pub fn abandon_raw_view(&self, operation: u64) {
        let mut slot = self.conversion_slot();
        if let Some(view) = slot.view_mut(operation).filter(|view| view.is_running()) {
            view.finish(Ended::Failed(view_cache_not_stored(), None));
        }
        self.publish_conversion_busy(&slot);
    }

    fn view_enter(&self, operation: u64, phase: RawViewPhaseDto) {
        if let Some(view) = self.conversion_slot().view_mut(operation) {
            view.enter(phase);
        }
        #[cfg(test)]
        {
            let hook = self.raw_view_settings().phase_hook.clone();
            if let Some(hook) = hook {
                hook(operation, phase);
            }
        }
    }

    /// The `keep_going` of one of MSCanvas's own reads: stops at the next
    /// chunk once Cancel was pressed, and otherwise records the bytes read,
    /// `offset` into `overall` where one bar spans two reads.
    fn reading<'a>(
        &'a self,
        operation: u64,
        cancel: &'a AtomicBool,
        offset: u64,
        overall: Option<u64>,
    ) -> impl FnMut(u64, u64) -> bool + 'a {
        move |read, total| {
            if cancel.load(Ordering::Acquire) {
                return false;
            }
            if let Some(view) = self.conversion_slot().view_mut(operation) {
                view.note_bytes(offset + read, overall.unwrap_or(total));
            }
            true
        }
    }

    fn raw_view_steps(&self, operation: u64) -> Result<(bool, VerifiedEntry), Stop> {
        let (id, cancel) = {
            let slot = self.conversion_slot();
            let view = slot
                .view()
                .filter(|view| view.operation == operation && view.is_running())
                .ok_or(cancelled(false))?;
            (view.dataset, view.cancel_flag())
        };
        let stopped = || cancel.load(Ordering::Acquire);
        let cache = self.open_view_cache().map_err(root_refusal_error)?;
        // Decision 6: at the start of each operation, never at startup. Only
        // attempts whose owner is gone are removed.
        let _ = cache.sweep_staging();

        // The build is bound before anything is read: the key names it, and a
        // hit counts only for the installed build (decisions 4 and 7).
        let running = self.enter_backend();
        self.require_usable_backend()?;
        let resolution = self.provider.conversion_backend();
        self.note_conversion_resolution(&resolution);
        let backend = resolution.bound?;
        refuse_unevidenced_build(&backend.capabilities, ConversionSourceKind::ThermoRawFile)?;
        drop(running);
        let provider_release = backend.capabilities.provider_build().map_or_else(
            || "unreported".to_owned(),
            |build| build.release().to_owned(),
        );

        // Checking file: the row re-accepted, then the RAW admitted and hashed
        // in chunks through one handle that shares read only. That digest is
        // the key's and, on a miss, the run's baseline.
        self.view_enter(operation, RawViewPhaseDto::CheckingSource);
        if stopped() {
            return Err(cancelled(false));
        }
        let remembered = self
            .workspace()
            .registry
            .get(id)
            .map(|dataset| dataset.file().clone())
            .ok_or_else(unknown_dataset)?;
        let file = revalidate(&remembered)?;
        let source =
            open_thermo_raw_source_reporting(&file, &mut self.reading(operation, &cancel, 0, None))
                .map_err(|error| {
                    if stopped() {
                        cancelled(false)
                    } else {
                        error.into()
                    }
                })?;
        let raw_bytes = source.byte_length();
        if raw_bytes > MAX_RAW_BYTES {
            return Err(view_cache_entry_too_large().into());
        }
        let source_sha256 = source.sha256();
        let key = CacheKey::new(
            source_sha256,
            backend.capabilities.executable_sha256(),
            &view_intent_id(),
        )
        .ok_or_else(view_cache_unavailable)?;

        // Checking cached copy.
        self.view_enter(operation, RawViewPhaseDto::CheckingCachedCopy);
        match cache.verify(&key, &mut self.reading(operation, &cancel, 0, None)) {
            Lookup::Hit(entry) => return Ok((true, *entry)),
            Lookup::Miss => {}
            Lookup::Damaged { removed: true } => {
                if let Some(view) = self.conversion_slot().view_mut(operation) {
                    view.note_damaged_copy_removed();
                }
            }
            // Neither a miss nor damage, so nothing is converted (dated note
            // of 2026-10-30, recommended and pending the owner).
            Lookup::Damaged { removed: false } | Lookup::Unreadable => {
                return Err(view_cache_entry_unavailable().into());
            }
            Lookup::Unrecognized => return Err(view_cache_entry_unrecognized().into()),
            Lookup::Cancelled => return Err(cancelled(false)),
        }

        // A miss: room on the cache's volume before anything is converted.
        if stopped() {
            return Err(cancelled(false));
        }
        self.ensure_space(&cache, raw_bytes)?;
        let attempt = cache.begin_attempt().ok_or_else(view_cache_not_stored)?;

        // Converting, with the verified default and no other intent, into the
        // attempt. The plan's name for the output comes from the RAW's name
        // (dated note: the transient exception to decision 6).
        self.view_enter(operation, RawViewPhaseDto::Converting);
        if stopped() {
            return Err(cancelled(false));
        }
        let running = self.enter_backend();
        self.require_usable_backend()?;
        let plan = plan_conversion(
            source,
            attempt.path(),
            ConflictPolicy::Fail,
            ConversionIntent::SHIPPED,
        )?;
        let cancellation = ConversionCancellation::new();
        if let Some(view) = self.conversion_slot().view_mut(operation) {
            view.bind_conversion(cancellation.request_handle());
        }
        let ran = run_planned_conversion_cancellable(&plan, &backend, cancellation);
        if let Some(view) = self.conversion_slot().view_mut(operation) {
            view.release_conversion();
        }
        drop(running);
        let finalized = match ran {
            ConversionAttempt::Completed(report) => {
                if report.leaves_an_owned_process_unaccounted() {
                    self.quarantine_backend();
                }
                if let ConversionRunOutcome::Failed(failure) = report.outcome() {
                    let retryable = super::super::conversion::run_is_retryable(
                        report.residue(),
                        report.outcome(),
                    );
                    return Err(self.conversion_failed(&cache, failure.stable_id(), retryable));
                }
                report
                    .into_finalized_output()
                    .ok_or_else(view_cache_not_stored)?
            }
            ConversionAttempt::Cancelled(_) => return Err(cancelled(false)),
            // ADR 0015: a termination that could not be confirmed quarantines
            // the backend for the session.
            ConversionAttempt::CancellationFailed(_) => {
                self.quarantine_backend();
                return Err(cancelled(false));
            }
        };

        // Checking output: the output's bytes and the RAW's, both read again,
        // under one bar.
        self.view_enter(operation, RawViewPhaseDto::CheckingOutput);
        let output_path = plan.destination_root().join(plan.output_file_name());
        let output_bytes = finalized.byte_length();
        let overall = Some(output_bytes + raw_bytes);
        let output = open_for_move(&output_path).map_err(|_| view_cache_not_stored())?;
        finalized
            .still_matches_reporting(&output, &mut self.reading(operation, &cancel, 0, overall))
            .map_err(|_| {
                if stopped() {
                    cancelled(false)
                } else {
                    view_cache_not_stored().into()
                }
            })?;
        let file = revalidate(&remembered)?;
        let again = open_thermo_raw_source_reporting(
            &file,
            &mut self.reading(operation, &cancel, output_bytes, overall),
        )
        .map_err(|error| {
            if stopped() {
                cancelled(false)
            } else {
                error.into()
            }
        })?;
        if again.sha256() != source_sha256 {
            return Err(raw_view_source_changed().into());
        }
        drop(again);
        // Renamed within the attempt through the handle it was checked with
        // (decision 8, step 4), and never over an existing name.
        crate::local_document::replace_with(&output, &output_path, &attempt.staged_output(), false)
            .map_err(|_| view_cache_not_stored())?;
        let facts = StagedFacts {
            source_byte_length: raw_bytes,
            provider_release,
            output_sha256: finalized.sha256(),
            output_byte_length: output_bytes,
        };
        // Every handle on the output closes before Storing: Windows can refuse
        // to rename a directory while a file in it is open.
        drop(output);
        drop(finalized);

        // Storing: eviction and the publishing rename. Not cancellable; a
        // Cancel pressed now is read once it is done.
        self.view_enter(operation, RawViewPhaseDto::Storing);
        let mut attempt = attempt;
        let mut published_again = false;
        loop {
            match cache.publish(attempt, &key, &facts) {
                Ok(Stored::Published) => break,
                Ok(Stored::Occupied(back)) => {
                    // Another process published this key first. Its entry is
                    // verified and used, and this attempt is discarded.
                    self.view_enter(operation, RawViewPhaseDto::CheckingCachedCopy);
                    match cache.verify(&key, &mut self.reading(operation, &cancel, 0, None)) {
                        Lookup::Hit(entry) => return Ok((false, *entry)),
                        Lookup::Cancelled => return Err(cancelled(false)),
                        Lookup::Unrecognized => {
                            return Err(view_cache_entry_unrecognized().into());
                        }
                        Lookup::Miss | Lookup::Damaged { removed: true } if !published_again => {
                            published_again = true;
                            attempt = back;
                            self.view_enter(operation, RawViewPhaseDto::Storing);
                        }
                        Lookup::Miss | Lookup::Damaged { removed: true } => {
                            return Err(view_cache_not_stored().into());
                        }
                        Lookup::Damaged { removed: false } | Lookup::Unreadable => {
                            return Err(view_cache_entry_unavailable().into());
                        }
                    }
                }
                // An attempt a sharing refusal keeps from being removed stays
                // until a later session's sweep (decision 6; dated note).
                Err(StoreFailure::NotStored) => return Err(view_cache_not_stored().into()),
                Err(StoreFailure::EntryTooLarge) => {
                    return Err(view_cache_entry_too_large().into());
                }
            }
        }
        if stopped() {
            return Err(cancelled(true));
        }

        // Checking cached copy, of the entry just published.
        self.view_enter(operation, RawViewPhaseDto::CheckingCachedCopy);
        match cache.verify(&key, &mut self.reading(operation, &cancel, 0, None)) {
            Lookup::Hit(entry) => Ok((false, *entry)),
            Lookup::Cancelled => Err(cancelled(true)),
            _ => Err(view_cache_entry_lost().into()),
        }
    }

    /// Decision 9's disk-space rule for a miss: three times the RAW plus the
    /// reserve, evicting unpinned entries only when that makes enough room.
    fn ensure_space(&self, cache: &ViewCache, raw_bytes: u64) -> Result<(), Stop> {
        let probe = Arc::clone(&self.raw_view_settings().free_space);
        let needed = bytes_needed_for(raw_bytes);
        let Some(free) = probe(cache.root()) else {
            return Err(no_space(None));
        };
        if free >= needed {
            return Ok(());
        }
        match cache.make_space(needed - free) {
            Ok(Some(_)) => {}
            Ok(None) => return Err(no_space(Some((needed, free)))),
            Err(refusal) => return Err(root_refusal_error(refusal).into()),
        }
        let free = probe(cache.root()).unwrap_or(0);
        if free >= needed {
            Ok(())
        } else {
            Err(no_space(Some((needed, free))))
        }
    }

    /// A conversion that failed, as a queue item reports it: its own code and
    /// retryability. `msconvert` says nothing about why, so the reason never
    /// claims a full disk; it states the free space when that is below the
    /// reserve (decision 9).
    fn conversion_failed(&self, cache: &ViewCache, code: &str, retryable: bool) -> Stop {
        let probe = Arc::clone(&self.raw_view_settings().free_space);
        let mut message =
            String::from("The conversion for viewing failed. Convert this file to see why.");
        let space = probe(cache.root());
        if let Some(free) =
            space.filter(|free| *free < super::super::raw_view::FREE_SPACE_RESERVE_BYTES)
        {
            let gib = free as f64 / f64::from(1 << 30);
            let _ = std::fmt::Write::write_fmt(
                &mut message,
                format_args!(
                    " {gib:.1} GiB are free on the drive that holds MSCanvas's application data."
                ),
            );
        }
        PreviewErrorDto::new(code, message, retryable).into()
    }

    /// `open_raw_view`: opens a ready operation's pinned entry, once, through
    /// the ordinary preview path. The pin passes to the row's preview state.
    pub fn open_raw_view(
        &self,
        request: RawViewOperationRequestDto,
    ) -> Result<PreviewDto, PreviewErrorDto> {
        let dataset = {
            let mut slot = self.conversion_slot();
            let view = slot
                .view_mut(request.operation)
                .ok_or_else(raw_view_not_ready)?;
            match &mut view.progress {
                Progress::Ready { opened, .. } if !*opened => {
                    *opened = true;
                    view.dataset
                }
                _ => return Err(raw_view_not_ready()),
            }
        };
        let entry = self
            .workspace()
            .runtime
            .get_mut(&dataset)
            .and_then(|state| state.ready_view.take())
            .ok_or_else(raw_view_not_ready)?;
        // Advisory: the eviction order holds no data (decision 9).
        let _ = entry.mark_opened();
        self.open_preview_of(&dataset.handle(), Some(Arc::new(entry)))
    }

    /// `describe_view_cache`: the Settings row's summary.
    pub fn describe_view_cache(&self) -> ViewCacheSummaryDto {
        let unavailable = |refusal| ViewCacheSummaryDto::Unavailable {
            available: false,
            reason: match refusal {
                RootRefusal::Unavailable => "rootUnresolved",
                RootRefusal::Unrecognized => "rootUnrecognized",
                RootRefusal::Unreadable => "unreadable",
            },
        };
        match self.open_view_cache().and_then(|cache| cache.usage()) {
            Ok(usage) => ViewCacheSummaryDto::Available {
                available: true,
                entries: usage.entries,
                bytes: usage.bytes,
                cap_bytes: CAP_BYTES,
                in_use: usage.in_use,
                unrecognized: usage.unrecognized,
            },
            Err(refusal) => unavailable(refusal),
        }
    }

    /// `clear_view_cache`: every unpinned entry and every attempt whose owner
    /// is gone. Refused while a view runs (decision 9).
    pub fn clear_view_cache(&self) -> Result<ViewCacheClearOutcomeDto, PreviewErrorDto> {
        if self.conversion_slot().view_is_running() {
            return Err(raw_view_busy());
        }
        let removal = self
            .open_view_cache()
            .and_then(|cache| cache.clear())
            .map_err(root_refusal_error)?;
        Ok(ViewCacheClearOutcomeDto {
            removed: removal.removed,
            freed_bytes: removal.freed_bytes,
            kept_in_use: removal.kept_in_use,
            failed: removal.failed,
            unrecognized_left: removal.unrecognized_left,
        })
    }
}
