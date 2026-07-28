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
    AcceptedFile, FileRegistry, accept_mzml_file, file_identity, lock_against_replacement,
};

/// The narrow set of operations the desktop application exposes.
pub struct PreviewService {
    provider: Box<dyn PreviewProvider>,
    files: FileRegistry,
    /// What each open preview described, so a later spectrum load can be
    /// refused rather than answered from a different one.
    generations: Mutex<HashMap<String, OpenedPreview>>,
    /// What the opened spectrum table said about each row, so a later selected
    /// spectrum can be checked against the row the user actually clicked.
    table_rows: Mutex<HashMap<String, Vec<TableRowFacts>>>,
    /// Held for the length of one backend operation, so this application runs
    /// at most one process at a time. Moving the wait to a blocking thread
    /// stopped it starving the async runtime; it did nothing to stop several
    /// reads of the same large file competing for the machine.
    backend_gate: Mutex<()>,
    /// The newest spectrum request. A request that is still waiting for the
    /// gate when a newer one arrives never starts: the user has moved on, and
    /// launching a process for a row they left is spending the machine on an
    /// answer nobody will see.
    spectrum_ticket: AtomicU64,
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
            files: FileRegistry::new(),
            generations: Mutex::new(HashMap::new()),
            table_rows: Mutex::new(HashMap::new()),
            backend_gate: Mutex::new(()),
            spectrum_ticket: AtomicU64::new(0),
            installation_generation: AtomicU64::new(0),
            resolved: Mutex::new(ObservedBackend::default()),
        }
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
    pub fn accept_file(&self, path: &Path) -> Result<SelectedFileDto, PreviewErrorDto> {
        let accepted = accept_mzml_file(path)?;
        // A different file supersedes any spectrum still waiting for its turn
        // on the old one, which nobody is going to look at now.
        self.spectrum_ticket.fetch_add(1, Ordering::Relaxed);
        // The previous handle is revoked by the registry, so its recorded
        // generation is dead weight rather than something to keep.
        self.generations
            .lock()
            .expect("the generation lock is never poisoned by user code")
            .clear();
        self.table_rows
            .lock()
            .expect("the table lock is never poisoned by user code")
            .clear();
        Ok(self.files.register(accepted))
    }

    /// Loads metadata, run summary and the spectrum table for one open action.
    ///
    /// All three share a single discovery and capability probe, so opening a
    /// file resolves the backend once rather than once per panel.
    pub fn open_preview(&self, handle: &str) -> Result<PreviewDto, PreviewErrorDto> {
        // Taken before anything is established about the file, so what is
        // checked describes the moment the read actually begins rather than
        // the moment the request arrived.
        let running = self.enter_backend();
        let file = self.files.resolve(handle)?;
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
        let results = self.provider.run_batch(file.path(), &operations)?;
        // Which backend actually did this work, taken from the results rather
        // than from a later look. The batch shares one resolution, so they all
        // report the same one; taking the first is taking that resolution.
        let installation = results
            .first()
            .and_then(|result| result.installation.clone());
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
        if results.len() != operations.len() {
            return Err(PreviewErrorDto::new(
                "incomplete_preview_result",
                "The preview did not return every requested result.",
                true,
            ));
        }

        let mut metadata = None;
        let mut run_summary = None;
        let mut spectrum_table = None;
        let mut table_rows = Vec::new();
        for result in results {
            match result.outcome {
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

        self.generations
            .lock()
            .expect("the generation lock is never poisoned by user code")
            .insert(
                handle.to_owned(),
                OpenedPreview {
                    source: before,
                    generation,
                    installation,
                },
            );
        self.table_rows
            .lock()
            .expect("the table lock is never poisoned by user code")
            .insert(handle.to_owned(), table_rows);

        Ok(PreviewDto {
            installation_generation: generation,
            file: file_dto(handle, &file),
            metadata: metadata.ok_or_else(|| missing("metadata"))?,
            run_summary: run_summary.ok_or_else(|| missing("run summary"))?,
            spectrum_table: spectrum_table.ok_or_else(|| missing("spectrum table"))?,
        })
    }

    /// Loads exactly one spectrum by zero-based index. Requests stay direct and
    /// uncached in this slice.
    pub fn load_spectrum(
        &self,
        handle: &str,
        index: u64,
    ) -> Result<SelectedSpectrumOutcomeDto, PreviewErrorDto> {
        let ticket = self.spectrum_ticket.fetch_add(1, Ordering::Relaxed) + 1;
        // Waiting first, so everything below describes the moment this read
        // begins. Checked after the wait, not before it: what matters is
        // whether the user has moved on by the time it would start.
        let running = self.enter_backend();
        if self.spectrum_ticket.load(Ordering::Relaxed) != ticket {
            return Err(PreviewErrorDto::new(
                "selection_superseded",
                "A newer spectrum was selected before this one started, so it was not read.",
                false,
            ));
        }
        let file = self.files.resolve(handle)?;
        // A selected spectrum is shown beside the metadata and the table from
        // the open action. If the file has changed since then, this spectrum
        // would belong to a different run than everything around it.
        let opened = self
            .generations
            .lock()
            .expect("the generation lock is never poisoned by user code")
            .get(handle)
            .cloned();
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
        let result = self.provider.run(file.path(), &operation)?;
        // And once more on what actually ran. The check above resolved the
        // backend a moment before this launched, which leaves a window the size
        // of that moment; this closes it with the identity the operation itself
        // reports, which is the only one that describes this spectrum.
        if let Some(opened) = opened.as_ref()
            && opened.installation != result.installation
        {
            return Err(installation_changed_since_preview());
        }
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
        match result.outcome {
            PreviewOutcome::Value(value) => match *value {
                PreviewValue::SelectedSpectrum(spectrum) => {
                    // The table and the binary formatter are separate readings.
                    // If they disagree about which scan this index is, the row
                    // the user clicked and the panel beside it would describe
                    // different spectra, so the result is refused instead.
                    let expected = self
                        .table_rows
                        .lock()
                        .expect("the table lock is never poisoned by user code")
                        .get(handle)
                        .and_then(|rows| rows.get(index as usize).cloned());
                    if let Some(expected) = expected {
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
    identity: Option<(u64, u64)>,
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

fn file_dto(handle: &str, file: &AcceptedFile) -> SelectedFileDto {
    SelectedFileDto {
        handle: handle.to_owned(),
        file_name: file.file_name().to_owned(),
        byte_length: file.byte_length(),
    }
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
