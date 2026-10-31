//! Conversion run history (RUN-007, ADR 0065).
//!
//! ## Shape
//!
//! One small JSON document **per run**, in a `conversion-history` directory
//! under the application's own per-user directory, each replaced whole through
//! [`crate::local_document`]. Never one shared document: a session only ever
//! writes the files of runs it started, so a second running instance cannot
//! drop the first one's runs by writing its own -- the failure a single
//! read-once, replace-whole document has with two writers.
//!
//! ## Liveness
//!
//! Each store holds one `owner-<id>.lock` file exclusively locked for its whole
//! life, and every run record names its owner. The operating system releases
//! the lock when the process ends, however it ends. A record still `running`
//! whose owner's lock can be taken -- or no longer exists -- belongs to a
//! session that did not live to finish it, and is marked `interrupted` at the
//! next start. A lock that cannot be taken is a live session, and its runs are
//! left alone. No process identifier is compared, so a reused one cannot make a
//! dead session look alive.
//!
//! ## What is never here
//!
//! Backend text, except the bound build's release label, bounded and redacted
//! as every backend label is. Failures are stable identifiers. Paths are
//! written only into the files themselves: nothing a webview reads from this
//! module carries one.

#[cfg(test)]
mod tests;

use std::fmt;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::local_document::{self, ReadRefusal, WriteRefusal};

/// The directory under the per-user application directory.
const DIRECTORY: &str = "conversion-history";
const RUN_PREFIX: &str = "run-";
const RUN_SUFFIX: &str = ".json";
const OWNER_PREFIX: &str = "owner-";
const OWNER_SUFFIX: &str = ".lock";
/// Where an owner lock is created and locked before it takes its scanned
/// name, so no scan can ever find an owner lock that is not yet held.
const PENDING_OWNER_PREFIX: &str = ".owner-pending-";
const TEMPORARY_PREFIX: &str = ".mscanvas-run-history-";
const SET_ASIDE_PREFIX: &str = "set-aside-";
/// Present means recording is off. Shared by every instance.
const OFF_MARKER: &str = "recording-off";

pub const SCHEMA_VERSION: u32 = 1;

/// One run's document. 1,024 single-output items with long paths stay well
/// under it; SCIEX items of 24 outputs each pass it at about 740, by estimate
/// (ADR 0065 §4). A run that would not fit is written without its items, with
/// their counts, and says so.
pub const MAX_RECORD_BYTES: u64 = 16 * 1024 * 1024;

/// How long a replace refused by a reader holding the file is tried again.
const PUBLISH_RETRY_WAITS_MS: [u64; 4] = [10, 30, 60, 100];

/// How many runs are kept. The ones that ended longest ago go first.
pub const MAX_RUNS: usize = 200;

/// How many bytes of runs are kept, whichever bound is reached first.
pub const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

/// The item states a queue reports while work on an item is not over.
const RUNNING_ITEM: &str = "running";
const PENDING_ITEM: &str = "pending";
const INTERRUPTED_ITEM: &str = "interrupted";
const NOT_RUN_ITEM: &str = "notRun";
const FINALIZED_ITEM: &str = "finalized";
const FAILED_ITEM: &str = "failed";

// ------------------------------------------------------------------ record

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunState {
    Running,
    /// The queue ran to its own end. Item outcomes and `failure` say how.
    Completed,
    Stopped,
    /// Stopped, and the termination could not be confirmed.
    StopFailed,
    /// The session that ran it ended, or could not write, before its end was
    /// recorded. What it did before then is what the items say.
    Interrupted,
}

/// One run, as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRecord {
    pub schema_version: u32,
    pub run_id: String,
    /// The session that ran it. Compared only with owner locks.
    pub owner: String,
    pub state: RunState,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    /// When a later start found it interrupted. Not an end time: when it
    /// actually stopped is not known.
    pub interrupted_at_ms: Option<u64>,
    /// The first pass and each retry of the same queue.
    pub passes: u64,
    pub settings: RunSettings,
    /// The ProteoWizard release the run was bound to, bounded and redacted.
    pub build_release: Option<String>,
    pub conflict_policy: String,
    /// What refused the whole queue, by its stable code.
    pub failure: Option<String>,
    /// The items did not fit [`MAX_RECORD_BYTES`] and were left out; this is
    /// what they said, counted before, so a summary means the same without
    /// them.
    pub omitted: Option<ItemTally>,
    pub items: Vec<RunItem>,
}

/// A run's items, counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemTally {
    pub items: usize,
    pub finalized: usize,
    pub failed: usize,
    /// Pending again in a retry pass: failed in an earlier one. Counted as
    /// failed once the run is interrupted, as its items would be.
    pub retrying: usize,
    /// Every item ran under ADR 0055's verified tier.
    pub settings_verified: bool,
    /// Every item ran on the measured build for its family.
    pub build_verified: bool,
}

impl ItemTally {
    fn of(items: &[RunItem]) -> Self {
        let count = |wanted: &str| {
            items
                .iter()
                .filter(|item| item.progress.state == wanted)
                .count()
        };
        Self {
            items: items.len(),
            finalized: count(FINALIZED_ITEM),
            failed: count(FAILED_ITEM),
            retrying: items
                .iter()
                .filter(|item| item.progress.state == PENDING_ITEM && item.progress.attempts > 0)
                .count(),
            settings_verified: items.iter().all(|item| item.source.settings_verified),
            build_verified: items.iter().all(|item| item.source.build_verified),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunSettings {
    /// The verified row's stable identifier, where the settings were one.
    pub row: Option<String>,
    /// The canonical structured intent. Read back only through the same
    /// judge a request or a preset goes through, never trusted as stored.
    pub intent: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunItem {
    pub source: ItemSource,
    pub progress: ItemProgress,
}

/// What an item was, fixed when its run started.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemSource {
    pub family: String,
    pub display_name: String,
    /// Primary first, with the identity admission recorded. Empty where the
    /// row was no longer in the workspace when the run started, or where any
    /// member's path is not Unicode: a set is recorded whole or not at all.
    pub members: Vec<SourceMember>,
    /// The folder its outputs were written into.
    pub destination: Option<String>,
    /// ADR 0055's verified tier for this family on this build.
    pub settings_verified: bool,
    /// Whether this build is the measured one for this family, so no
    /// "unverified build" label applies. A build with no evidence at all never
    /// runs, so is never recorded.
    pub build_verified: bool,
}

impl fmt::Debug for ItemSource {
    /// Opaque about paths, which a log must not get.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "<{} source of {} members>",
            self.family,
            self.members.len()
        )
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceMember {
    pub path: String,
    pub byte_length: u64,
    pub volume_serial: u64,
    /// The 128-bit file ID, as 32 lowercase hex digits.
    pub file_id: String,
}

impl fmt::Debug for SourceMember {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "<member of {} bytes>", self.byte_length)
    }
}

/// What became of an item, as the queue reported it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemProgress {
    /// The queue's own item state identifier, or `interrupted`.
    pub state: String,
    pub attempts: u64,
    pub outcome: Option<String>,
    pub failure: Option<String>,
    pub outputs: Vec<RunOutput>,
    /// An output set's sample-completeness finding. `None` for a single
    /// output.
    pub completeness: Option<SetCompleteness>,
    /// Whether an output set could be adopted whole. `None` for a single
    /// output. A fully finalized set that could not is a failed item with no
    /// failure code, and this with `completeness` is why.
    pub set_adoptable: Option<bool>,
}

/// What the SCIEX completeness audit found, by its stable identifiers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SetCompleteness {
    NotPosed,
    NotEstablished { reason: String },
    Established { method: String, sample_count: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunOutput {
    pub file_name: String,
    /// A set member's own state; `None` for a single output.
    pub state: Option<String>,
    pub byte_length: Option<u64>,
    pub sha256: Option<String>,
    pub checks: Option<OutputChecks>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputChecks {
    pub mode: String,
    pub fully_verified: bool,
    pub verified: Vec<String>,
    pub unverified: Vec<String>,
    pub inapplicable: Vec<String>,
    pub advisory: Vec<String>,
}

/// What is known of a run when it starts.
#[derive(Debug, Clone)]
pub struct RunStart {
    pub settings: RunSettings,
    pub build_release: Option<String>,
    pub conflict_policy: String,
    pub items: Vec<ItemSource>,
}

/// What the queue says about a run now.
#[derive(Debug, Clone)]
pub struct RunProgress {
    pub state: RunState,
    pub passes: u64,
    pub failure: Option<String>,
    pub items: Vec<ItemProgress>,
}

/// Why a stored run is not used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecordProblem {
    Malformed,
    NewerVersion,
    Unreadable,
}

fn read_record(path: &Path) -> Result<Option<RunRecord>, RecordProblem> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionProbe {
        schema_version: Option<u32>,
    }

    let bytes = match local_document::read_bounded(path, MAX_RECORD_BYTES) {
        Ok(None) => return Ok(None),
        Ok(Some(bytes)) => bytes,
        Err(ReadRefusal::Oversized) => return Err(RecordProblem::Malformed),
        Err(ReadRefusal::Unreadable | ReadRefusal::UnsafeTarget) => {
            return Err(RecordProblem::Unreadable);
        }
    };
    let probe: VersionProbe =
        serde_json::from_slice(&bytes).map_err(|_| RecordProblem::Malformed)?;
    match probe.schema_version {
        Some(SCHEMA_VERSION) => {}
        Some(version) if version > SCHEMA_VERSION => return Err(RecordProblem::NewerVersion),
        _ => return Err(RecordProblem::Malformed),
    }
    let record: RunRecord = serde_json::from_slice(&bytes).map_err(|_| RecordProblem::Malformed)?;
    // The name is the identity a reader asks for; a document that disagrees
    // with its own name is not that run.
    if file_name_of(&record.run_id) != path.file_name().and_then(|n| n.to_str()).unwrap_or("") {
        return Err(RecordProblem::Malformed);
    }
    Ok(Some(record))
}

fn file_name_of(run_id: &str) -> String {
    format!("{RUN_PREFIX}{run_id}{RUN_SUFFIX}")
}

/// `<13-digit start millis>-<32 hex>`, so names sort oldest first.
fn valid_run_id(run_id: &str) -> bool {
    let Some((started, id)) = run_id.split_once('-') else {
        return false;
    };
    started.len() == 13
        && started.bytes().all(|b| b.is_ascii_digit())
        && id.len() == 32
        && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn run_id_of_name(name: &str) -> Option<&str> {
    let id = name.strip_prefix(RUN_PREFIX)?.strip_suffix(RUN_SUFFIX)?;
    valid_run_id(id).then_some(id)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

fn fresh_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

// ------------------------------------------------------------------ wire

/// One run as a list shows it: no path, no item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummaryDto {
    pub run_id: String,
    pub state: RunState,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    pub interrupted_at_ms: Option<u64>,
    pub passes: u64,
    pub settings_row: Option<String>,
    /// The settings were a verified row, and every item ran under ADR 0055's
    /// verified tier for its family.
    pub settings_verified: bool,
    pub build_release: Option<String>,
    /// Every item ran on the measured build for its family.
    pub build_verified: bool,
    pub failure: Option<String>,
    pub item_count: usize,
    pub finalized_count: usize,
    pub failed_count: usize,
    pub items_omitted: bool,
}

/// One item as a run's detail shows it: its name, never its location.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunItemDto {
    pub family: String,
    pub display_name: String,
    pub settings_verified: bool,
    pub build_verified: bool,
    pub progress: ItemProgress,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunHistoryListDto {
    /// Newest first. `unreadable` and `newer` count runs this build could not
    /// show. `unreadable` includes every corrupt run kept aside under another
    /// name, whenever it was found, until a Clear removes it.
    Listed {
        recording: bool,
        problem: Option<&'static str>,
        runs: Vec<RunSummaryDto>,
        unreadable: usize,
        newer: usize,
    },
    Unavailable {
        problem: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunHistoryReadDto {
    Found {
        run: RunSummaryDto,
        items: Vec<RunItemDto>,
    },
    NotFound,
    Refused {
        problem: &'static str,
    },
    Unavailable {
        problem: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunHistoryWriteDto {
    /// Done. `keptInProgress` runs are still being written, by this session or
    /// another, or may be as far as this build can tell -- a later build's, or
    /// one it cannot read now -- and are kept so their end can still be
    /// recorded. Off keeps none.
    Done {
        kept_in_progress: usize,
    },
    /// Some files could not be removed; they are still there.
    Failed {
        problem: &'static str,
        not_removed: usize,
    },
    Unavailable {
        problem: &'static str,
    },
}

impl RunSummaryDto {
    /// Of a record as [`ConversionHistory::view`] gives it.
    fn of(record: &RunRecord) -> Self {
        let tally = record
            .omitted
            .unwrap_or_else(|| ItemTally::of(&record.items));
        Self {
            run_id: record.run_id.clone(),
            state: record.state,
            started_at_ms: record.started_at_ms,
            ended_at_ms: record.ended_at_ms,
            interrupted_at_ms: record.interrupted_at_ms,
            passes: record.passes,
            settings_row: record.settings.row.clone(),
            settings_verified: record.settings.row.is_some() && tally.settings_verified,
            build_release: record.build_release.clone(),
            build_verified: tally.build_verified,
            failure: record.failure.clone(),
            item_count: tally.items,
            finalized_count: tally.finalized,
            failed_count: tally.failed,
            items_omitted: record.omitted.is_some(),
        }
    }
}

// ------------------------------------------------------------------ store

/// This session's exclusive claim, held until the process ends.
struct Owner {
    id: String,
    /// Held for its lock. Never read.
    _lock: File,
}

struct ActiveRun {
    /// The session's operation identifier for the queue.
    key: u64,
    record: RunRecord,
    /// Its latest state has not reached its file. Written by the next
    /// `begin`, `update`, `list` or `read`, so an end a reader held off is
    /// not lost.
    unwritten: bool,
    /// Its file has been written. One that is gone since was forgotten -- by
    /// a Clear, an Off or a prune, in any instance -- and is never written
    /// back.
    written: bool,
}

impl ActiveRun {
    fn forgotten(&self, directory: &Path) -> bool {
        self.written
            && fs::symlink_metadata(directory.join(file_name_of(&self.record.run_id))).is_err()
    }
}

#[derive(Default)]
struct Lane {
    active: Option<ActiveRun>,
    /// Ended runs whose end has not reached their files, put by when a later
    /// run began. Written like `active`'s owed state.
    owed: Vec<ActiveRun>,
    /// Why this session could not record, if it could not. A write still
    /// owed is `notWritten` until it is made.
    problem: Option<&'static str>,
}

impl Lane {
    fn owes(&self) -> bool {
        self.active
            .iter()
            .chain(&self.owed)
            .any(|run| run.unwritten)
    }
}

/// The session's conversion run history.
pub struct ConversionHistory {
    /// `Err` is a session with nowhere to keep runs.
    directory: Result<PathBuf, &'static str>,
    owner: Option<Owner>,
    lane: Mutex<Lane>,
}

impl ConversionHistory {
    /// Binds the history under `base`, claims this session's owner lock, marks
    /// the runs of sessions that ended mid-run as interrupted, and prunes.
    ///
    /// `Err` is a session with nowhere to keep one, which is usable and says
    /// so.
    #[must_use]
    pub fn open(base: Result<PathBuf, &'static str>) -> Self {
        let directory = base.and_then(|base| {
            let directory = base.join(DIRECTORY);
            fs::create_dir_all(&directory).map_err(|_| "directoryUnusable")?;
            // The directory itself must be one: a link here would put every
            // write somewhere this application never chose.
            match fs::symlink_metadata(&directory) {
                Ok(metadata)
                    if metadata.is_dir() && !local_document::is_reparse_point(&metadata) =>
                {
                    Ok(directory)
                }
                _ => Err("unsafeDirectory"),
            }
        });
        let owner = directory.as_ref().ok().and_then(|d| claim_owner(d));
        let history = Self {
            directory,
            owner,
            lane: Mutex::new(Lane::default()),
        };
        if let Ok(directory) = &history.directory {
            if history.owner.is_none() {
                history.locked().problem = Some("ownerUnavailable");
            }
            history.recover(directory);
            prune(directory, history.owner_id());
        }
        history
    }

    /// Starts recording the run of `key`, or reopens it for a retry pass.
    ///
    /// Never fails the conversion: a write that does not happen is recorded
    /// as this session's problem and nothing else.
    pub fn begin(&self, key: u64, start: RunStart, progress: RunProgress) {
        let (Ok(directory), Some(owner)) = (&self.directory, &self.owner) else {
            return;
        };
        let mut lane = self.locked();
        self.flush(directory, &mut lane);
        match switch_off(directory) {
            Some(false) => {}
            Some(true) => return,
            None => {
                lane.problem = Some("notWritten");
                return;
            }
        }
        let reopened = match lane.active.take() {
            // Unless it was forgotten. A run that a Clear, an Off or a prune
            // in any instance forgot is not written back by its retry, which
            // starts a new run instead.
            Some(mut active) if active.key == key && !active.forgotten(directory) => {
                active.record.ended_at_ms = None;
                active.record.state = RunState::Running;
                Some(active)
            }
            // An end still owed is still written.
            Some(previous) if previous.unwritten && previous.record.state != RunState::Running => {
                lane.owed.push(previous);
                None
            }
            // ponytail: a previous run still `running` here means its worker
            // left without a terminal answer; it stays `running` on disk and is
            // marked interrupted by the next start, which is the honest reading.
            _ => None,
        };
        let mut active = reopened.unwrap_or_else(|| {
            let started_at_ms = now_ms();
            ActiveRun {
                key,
                record: RunRecord {
                    schema_version: SCHEMA_VERSION,
                    run_id: format!("{started_at_ms:013}-{}", fresh_id()),
                    owner: owner.id.clone(),
                    state: RunState::Running,
                    started_at_ms,
                    ended_at_ms: None,
                    interrupted_at_ms: None,
                    passes: 0,
                    settings: start.settings,
                    build_release: start.build_release,
                    conflict_policy: start.conflict_policy,
                    failure: None,
                    omitted: None,
                    items: start
                        .items
                        .into_iter()
                        .map(|source| RunItem {
                            source,
                            progress: ItemProgress {
                                state: PENDING_ITEM.to_owned(),
                                attempts: 0,
                                outcome: None,
                                failure: None,
                                outputs: Vec::new(),
                                completeness: None,
                                set_adoptable: None,
                            },
                        })
                        .collect(),
                },
                unwritten: false,
                written: false,
            }
        });
        let applied = apply(&mut active.record, progress);
        lane.active = Some(active);
        if applied {
            self.write_active(directory, &mut lane);
        }
    }

    /// Records what the queue of `key` says now. Ignored unless that run is
    /// being recorded and has not ended.
    pub fn update(&self, key: u64, progress: RunProgress) {
        let Ok(directory) = &self.directory else {
            return;
        };
        let mut lane = self.locked();
        self.flush(directory, &mut lane);
        let Some(active) = lane.active.as_mut() else {
            return;
        };
        if active.key != key || active.record.state != RunState::Running {
            return;
        }
        if !apply(&mut active.record, progress) {
            return;
        }
        if active.record.state != RunState::Running {
            active.record.ended_at_ms = Some(now_ms());
        }
        self.write_active(directory, &mut lane);
    }

    /// Writes the run being recorded as it is now, as the shared switch
    /// allows, and prunes once its end is on disk and nothing else is owed.
    /// Called with the lane held, so no run of this session can start
    /// meanwhile.
    fn write_active(&self, directory: &Path, lane: &mut Lane) {
        if let Some(active) = lane.active.as_mut()
            && !write_run(directory, active)
        {
            lane.active = None;
        }
        self.settle(directory, lane);
    }

    /// Writes every state of this session's runs that has not reached its
    /// file.
    fn flush(&self, directory: &Path, lane: &mut Lane) {
        if !lane.owes() {
            return;
        }
        lane.owed
            .retain_mut(|run| write_run(directory, run) && run.unwritten);
        if lane.active.as_ref().is_some_and(|active| active.unwritten) {
            self.write_active(directory, lane);
        } else {
            self.settle(directory, lane);
        }
    }

    fn settle(&self, directory: &Path, lane: &mut Lane) {
        lane.problem = lane.owes().then_some("notWritten");
        if lane.problem.is_none()
            && lane
                .active
                .as_ref()
                .is_some_and(|active| active.record.state != RunState::Running)
        {
            prune(directory, self.owner_id());
        }
    }

    /// Every stored run, newest first, without paths or items.
    #[must_use]
    pub fn list(&self) -> RunHistoryListDto {
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return RunHistoryListDto::Unavailable { problem },
        };
        self.flush(directory, &mut self.locked());
        // Off forgets what is stored whenever it is looked at, so a run whose
        // session ended while it was off is not kept for want of a next write.
        if switch_off(directory) == Some(true) {
            let _ = self.sweep(true);
        }
        let mut runs = Vec::new();
        let (mut unreadable, mut newer) = (0, 0);
        for (name, _) in run_entries(directory) {
            match read_record(&directory.join(&name)) {
                Ok(Some(record)) => runs.push(RunSummaryDto::of(&self.view(directory, record))),
                Ok(None) => {}
                Err(RecordProblem::NewerVersion) => newer += 1,
                Err(RecordProblem::Unreadable) => unreadable += 1,
                // Counted below, among the runs kept aside.
                Err(RecordProblem::Malformed) => {
                    if !set_aside(directory, &name) {
                        unreadable += 1;
                    }
                }
            }
        }
        unreadable += names(directory)
            .iter()
            .filter(|name| is_set_aside(name))
            .count();
        runs.reverse();
        runs.truncate(MAX_RUNS);
        RunHistoryListDto::Listed {
            recording: !recording_off(directory),
            problem: self.locked().problem,
            runs,
            unreadable,
            newer,
        }
    }

    /// One run's items, by the identifier a list gave.
    #[must_use]
    pub fn read(&self, run_id: &str) -> RunHistoryReadDto {
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return RunHistoryReadDto::Unavailable { problem },
        };
        if !valid_run_id(run_id) {
            return RunHistoryReadDto::NotFound;
        }
        self.flush(directory, &mut self.locked());
        match read_record(&directory.join(file_name_of(run_id))) {
            Ok(Some(record)) => {
                let record = self.view(directory, record);
                RunHistoryReadDto::Found {
                    run: RunSummaryDto::of(&record),
                    items: record
                        .items
                        .into_iter()
                        .map(|item| RunItemDto {
                            family: item.source.family,
                            display_name: item.source.display_name,
                            settings_verified: item.source.settings_verified,
                            build_verified: item.source.build_verified,
                            progress: item.progress,
                        })
                        .collect(),
                }
            }
            Ok(None) => RunHistoryReadDto::NotFound,
            Err(RecordProblem::NewerVersion) => RunHistoryReadDto::Refused {
                problem: "newerVersion",
            },
            Err(RecordProblem::Malformed | RecordProblem::Unreadable) => {
                RunHistoryReadDto::Refused {
                    problem: "unreadable",
                }
            }
        }
    }

    /// Forgets every run that has ended and every run kept aside. A run still
    /// being written, here or in another instance, is kept, and so is one this
    /// build cannot judge -- a later build's, or one it cannot read now --
    /// which may be one too.
    #[must_use]
    pub fn clear(&self) -> RunHistoryWriteDto {
        self.sweep(false)
    }

    /// Clear's removal. `everything` is Off's: every run goes, one in progress
    /// in any instance and one this build cannot judge included. An instance
    /// whose run went stops recording it at its next write.
    fn sweep(&self, everything: bool) -> RunHistoryWriteDto {
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return RunHistoryWriteDto::Unavailable { problem },
        };
        {
            // An ended run is forgotten here with any write still owed, so
            // nothing writes it back.
            let mut lane = self.locked();
            lane.owed.clear();
            if everything
                || lane
                    .active
                    .as_ref()
                    .is_some_and(|active| active.record.state != RunState::Running)
            {
                lane.active = None;
            }
        }
        let (mut kept, mut not_removed) = (0, 0);
        for (name, _) in run_entries(directory) {
            let in_progress = !everything
                && match read_record(&directory.join(&name)) {
                    Ok(Some(record)) => self.view(directory, record).state == RunState::Running,
                    Err(RecordProblem::NewerVersion | RecordProblem::Unreadable) => true,
                    Ok(None) | Err(RecordProblem::Malformed) => false,
                };
            if in_progress {
                kept += 1;
            } else if remove(&directory.join(&name)).is_err() {
                not_removed += 1;
            }
        }
        for name in names(directory) {
            if is_set_aside(&name) && remove(&directory.join(&name)).is_err() {
                not_removed += 1;
            }
        }
        if not_removed > 0 {
            return RunHistoryWriteDto::Failed {
                problem: "notRemoved",
                not_removed,
            };
        }
        RunHistoryWriteDto::Done {
            kept_in_progress: kept,
        }
    }

    /// The off switch, shared by every instance. Off stops recording and
    /// forgets what is stored, every run in progress included; on starts
    /// recording again from the next run.
    #[must_use]
    pub fn set_enabled(&self, enabled: bool) -> RunHistoryWriteDto {
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return RunHistoryWriteDto::Unavailable { problem },
        };
        let marker = directory.join(OFF_MARKER);
        if enabled {
            return match remove(&marker) {
                Ok(()) => RunHistoryWriteDto::Done {
                    kept_in_progress: 0,
                },
                Err(_) => RunHistoryWriteDto::Failed {
                    problem: "notTurnedOn",
                    not_removed: 1,
                },
            };
        }
        // A new file or nothing: `create_new` never follows a link at the
        // name, and anything already there already reads as off.
        if let Err(error) = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)
            && error.kind() != io::ErrorKind::AlreadyExists
        {
            return RunHistoryWriteDto::Failed {
                problem: "notTurnedOff",
                not_removed: 0,
            };
        }
        self.sweep(true)
    }

    fn owner_id(&self) -> Option<&str> {
        self.owner.as_ref().map(|owner| owner.id.as_str())
    }

    /// A stored run as a reader should be told it. Never written.
    ///
    /// The run this session is recording, and an ended one whose end it still
    /// owes, is read from memory, where its latest state is even when its
    /// file could not be written yet. A `running` run whose session is gone --
    /// or one of this session's own that it is not recording, whose worker
    /// left without an end -- reads as interrupted, its items included,
    /// whether or not a start has said so on disk yet.
    ///
    /// Takes the lane, so never call it holding the lane.
    fn view(&self, directory: &Path, mut record: RunRecord) -> RunRecord {
        if record.state != RunState::Running {
            return record;
        }
        let interrupted = if Some(record.owner.as_str()) == self.owner_id() {
            let lane = self.locked();
            match lane
                .active
                .iter()
                .chain(&lane.owed)
                .find(|run| run.record.run_id == record.run_id)
            {
                Some(active) => {
                    let mut current = active.record.clone();
                    // As it is stored: without its items, where they did not
                    // fit.
                    if record.omitted.is_some() {
                        current.omitted = Some(ItemTally::of(&current.items));
                        current.items.clear();
                    }
                    return current;
                }
                None => true,
            }
        } else {
            matches!(owner_liveness(directory, &record.owner), Liveness::Dead(_))
        };
        if interrupted {
            mark_interrupted(&mut record, now_ms());
        }
        record
    }

    /// Marks every run whose session died mid-run, and removes those sessions'
    /// locks. While recording is off, such a run is removed rather than
    /// written again.
    fn recover(&self, directory: &Path) {
        let switch = switch_off(directory);
        for (name, _) in run_entries(directory) {
            let path = directory.join(&name);
            let record = match read_record(&path) {
                Ok(Some(record)) => record,
                Ok(None) | Err(RecordProblem::NewerVersion | RecordProblem::Unreadable) => {
                    continue;
                }
                Err(RecordProblem::Malformed) => {
                    set_aside(directory, &name);
                    continue;
                }
            };
            if record.state != RunState::Running || Some(record.owner.as_str()) == self.owner_id() {
                continue;
            }
            // Held across the re-read and the write, so a second starting
            // instance cannot interleave, and an owner that finished between
            // the first read and now is seen to have finished.
            let Liveness::Dead(_held) = owner_liveness(directory, &record.owner) else {
                continue;
            };
            if let Ok(Some(mut record)) = read_record(&path)
                && record.state == RunState::Running
            {
                match switch {
                    Some(false) => {
                        mark_interrupted(&mut record, now_ms());
                        let _ = publish(directory, &record);
                    }
                    // Off forgets what is stored, this too.
                    // ponytail: Off removes every run when it is turned off,
                    // so this is a write that was under way then and landed
                    // just after; one whose instance is still alive is
                    // removed by its next write, or by a list while off.
                    Some(true) => {
                        let _ = remove(&path);
                    }
                    // Left as it is; a reader is told it is interrupted.
                    None => {}
                }
            }
        }
        for name in names(directory) {
            let Some(id) = name
                .strip_prefix(OWNER_PREFIX)
                .and_then(|rest| rest.strip_suffix(OWNER_SUFFIX))
            else {
                continue;
            };
            if Some(id) == self.owner_id() {
                continue;
            }
            if let Liveness::Dead(Some(_held)) = owner_liveness(directory, id) {
                let _ = fs::remove_file(directory.join(&name));
            }
        }
    }

    /// Poisoning is recovered from: a panic in one write says nothing about
    /// the files.
    fn locked(&self) -> std::sync::MutexGuard<'_, Lane> {
        self.lane
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Copies the queue's answer onto the record. `false` where the answer cannot
/// be this run's: membership is fixed when a queue is made.
fn apply(record: &mut RunRecord, progress: RunProgress) -> bool {
    if record.omitted.is_none() && progress.items.len() != record.items.len() {
        return false;
    }
    record.state = progress.state;
    record.passes = progress.passes;
    record.failure = progress.failure;
    for (item, now) in record.items.iter_mut().zip(progress.items) {
        item.progress = now;
    }
    true
}

/// As far as the run's last write that was made says. An item is written
/// `running` before its process is launched; where that write was refused and
/// still owed when the session ended, the item reads `notRun` although its
/// process may have started (ADR 0065 §5).
fn mark_interrupted(record: &mut RunRecord, now: u64) {
    record.state = RunState::Interrupted;
    record.interrupted_at_ms = Some(now);
    if let Some(tally) = &mut record.omitted {
        tally.failed += std::mem::take(&mut tally.retrying);
    }
    for item in &mut record.items {
        match item.progress.state.as_str() {
            // Its outcome was never recorded; a file may or may not exist.
            RUNNING_ITEM => item.progress.state = INTERRUPTED_ITEM.to_owned(),
            // Never begun by this pass. A retry pass's pending item failed in
            // an earlier one, and that failure, still recorded, is what it is.
            PENDING_ITEM if item.progress.attempts > 0 => {
                item.progress.state = FAILED_ITEM.to_owned();
            }
            PENDING_ITEM => item.progress.state = NOT_RUN_ITEM.to_owned(),
            _ => {}
        }
    }
}

/// Writes one of this session's runs as the shared switch allows. `false`
/// where it is forgotten and must never be written again: turned off by any
/// instance, or its file gone once written.
///
/// A run whose first write never landed has no file to miss, so an Off and an
/// On in another instance before that write lands do not stop it.
fn write_run(directory: &Path, run: &mut ActiveRun) -> bool {
    match switch_off(directory) {
        Some(true) => {
            let _ = remove(&directory.join(file_name_of(&run.record.run_id)));
            return false;
        }
        // A switch nobody can read: nothing is written, and nothing that is
        // stored is removed on its account. A later write tries again.
        None => {
            run.unwritten = true;
            return true;
        }
        Some(false) => {}
    }
    if run.forgotten(directory) {
        return false;
    }
    run.unwritten = publish(directory, &run.record).is_err();
    run.written |= !run.unwritten;
    true
}

/// Writes one run's document, without its items where they would not fit.
fn publish(directory: &Path, record: &RunRecord) -> Result<(), &'static str> {
    let document = |record: &RunRecord| {
        let mut bytes = serde_json::to_vec(record).map_err(|_| "notWritten")?;
        bytes.push(b'\n');
        Ok::<_, &'static str>(bytes)
    };
    let mut bytes = document(record)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        let mut reduced = record.clone();
        reduced.omitted = Some(ItemTally::of(&record.items));
        reduced.items.clear();
        bytes = document(&reduced)?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err("notWritten");
        }
    }
    // ponytail: the whole document is rewritten twice per item, so a queue of
    // n items writes O(n^2) bytes over its life; an append log if that is
    // ever measured to matter.
    let target = directory.join(file_name_of(&record.run_id));
    // A reader holding the file open -- another instance listing, an indexer,
    // a scanner -- refuses a replace for as long as it holds it, which is
    // usually moments. A write still refused after these is kept for the
    // next one (`ActiveRun::unwritten`).
    let mut waits = PUBLISH_RETRY_WAITS_MS.iter();
    loop {
        match local_document::publish_through_temporary(
            directory,
            &target,
            &bytes,
            TEMPORARY_PREFIX,
        ) {
            Ok(()) => return Ok(()),
            Err(failure) if failure.refusal == WriteRefusal::NotPublished => {
                let Some(wait) = waits.next() else {
                    return Err("notWritten");
                };
                std::thread::sleep(Duration::from_millis(*wait));
            }
            Err(_) => return Err("notWritten"),
        }
    }
}

/// What the shared switch says: `Some(true)` off, `Some(false)` on, `None`
/// where its marker cannot be inspected.
fn switch_off(directory: &Path) -> Option<bool> {
    match fs::symlink_metadata(directory.join(OFF_MARKER)) {
        Ok(_) => Some(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Some(false),
        Err(_) => None,
    }
}

/// Whether nothing may be recorded. A switch nobody can read records
/// nothing, and removes nothing either.
fn recording_off(directory: &Path) -> bool {
    switch_off(directory) != Some(false)
}

enum Liveness {
    Alive,
    /// The owner is gone. The lock, where there still was one, is held by
    /// this process until the value is dropped.
    Dead(Option<File>),
    /// Neither could be established; nothing is decided on it.
    Unknown,
}

fn owner_liveness(directory: &Path, owner: &str) -> Liveness {
    if owner.len() != 32 || !owner.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Liveness::Unknown;
    }
    let path = directory.join(format!("{OWNER_PREFIX}{owner}{OWNER_SUFFIX}"));
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Liveness::Dead(None),
        Err(_) => return Liveness::Unknown,
    };
    match file.try_lock() {
        Ok(()) => Liveness::Dead(Some(file)),
        Err(fs::TryLockError::WouldBlock) => Liveness::Alive,
        Err(fs::TryLockError::Error(_)) => Liveness::Unknown,
    }
}

/// Creates and locks this session's owner file under a name no scan reads,
/// then gives it its scanned name. `None` is a session that cannot record.
fn claim_owner(directory: &Path) -> Option<Owner> {
    let id = fresh_id();
    let pending = directory.join(format!("{PENDING_OWNER_PREFIX}{id}"));
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&pending)
        .ok()?;
    if file.try_lock().is_err()
        || fs::rename(
            &pending,
            directory.join(format!("{OWNER_PREFIX}{id}{OWNER_SUFFIX}")),
        )
        .is_err()
    {
        drop(file);
        let _ = fs::remove_file(&pending);
        return None;
    }
    Some(Owner { id, _lock: file })
}

/// Every name in the directory that is valid UTF-8.
fn names(directory: &Path) -> Vec<String> {
    fs::read_dir(directory)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Run documents only, oldest first, with their sizes. Nothing whose name is
/// not exactly a run's is ever read, kept aside or removed.
fn run_entries(directory: &Path) -> Vec<(String, u64)> {
    let mut entries: Vec<(String, u64)> = fs::read_dir(directory)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let name = entry.file_name().into_string().ok()?;
                    run_id_of_name(&name)?;
                    let size = entry.metadata().ok()?.len();
                    Some((name, size))
                })
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    entries
}

/// Keeps this build's runs within both bounds, removing the ones that ended
/// longest ago first: by end, detection for an interrupted run, else start. A
/// run another instance is still writing is never removed. Called only while
/// this session is recording nothing else and owes nothing, so a `running` run
/// of its own is one whose end was never written.
///
/// A run this build cannot judge -- a later build's, or one it cannot read
/// now -- is neither removed nor counted: a later build's live instance may
/// still be writing it, and that build bounds its own. Counting it would let
/// such runs alone push out every run this build records, the newest
/// included.
fn prune(directory: &Path, own: Option<&str>) {
    let entries = run_entries(directory);
    let within = |count: usize, bytes: u64| count <= MAX_RUNS && bytes <= MAX_TOTAL_BYTES;
    // Nothing is read while every file together is within the bounds.
    if within(entries.len(), entries.iter().map(|(_, size)| size).sum()) {
        return;
    }
    let mut judged = Vec::new();
    for (name, size) in entries {
        match read_record(&directory.join(&name)) {
            Ok(Some(record)) => {
                let in_progress = record.state == RunState::Running
                    && Some(record.owner.as_str()) != own
                    && !matches!(owner_liveness(directory, &record.owner), Liveness::Dead(_));
                let ended = record
                    .ended_at_ms
                    .or(record.interrupted_at_ms)
                    .unwrap_or(record.started_at_ms);
                judged.push((ended, name, size, in_progress));
            }
            Err(RecordProblem::Malformed) => {
                set_aside(directory, &name);
            }
            Ok(None) | Err(RecordProblem::NewerVersion | RecordProblem::Unreadable) => {}
        }
    }
    // Stable, so runs that ended in the same millisecond go oldest first.
    judged.sort_by_key(|(ended, ..)| *ended);
    let mut count = judged.len();
    let mut bytes: u64 = judged.iter().map(|(_, _, size, _)| size).sum();
    for (_, name, size, in_progress) in judged {
        if within(count, bytes) {
            break;
        }
        if !in_progress && remove(&directory.join(&name)).is_ok() {
            count -= 1;
            bytes = bytes.saturating_sub(size);
        }
    }
}

/// Removes one name. Already gone is removed.
fn remove(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Keeps a corrupt run under a name nothing reads, and takes it off its own.
///
/// A hard link refuses an existing name, so nothing is replaced; once it
/// exists the bytes are kept whatever happens to the original name. `true`
/// when the run's own name is gone.
fn set_aside(directory: &Path, name: &str) -> bool {
    let aside = directory.join(format!("{SET_ASIDE_PREFIX}{}-{name}", now_ms()));
    fs::hard_link(directory.join(name), aside).is_ok() && remove(&directory.join(name)).is_ok()
}

/// Exactly a name [`set_aside`] gives: the prefix, milliseconds, a dash and a
/// run's own name.
fn is_set_aside(name: &str) -> bool {
    name.strip_prefix(SET_ASIDE_PREFIX)
        .and_then(|rest| rest.split_once('-'))
        .is_some_and(|(ms, run)| {
            !ms.is_empty()
                && ms.bytes().all(|b| b.is_ascii_digit())
                && run_id_of_name(run).is_some()
        })
}
