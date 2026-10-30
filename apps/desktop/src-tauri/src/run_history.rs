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
//! Backend text of any kind. Failures are stable identifiers. Paths are written
//! only into the files themselves: nothing a webview reads from this module
//! carries one.

#[cfg(test)]
mod tests;

use std::fmt;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::local_document::{self, ReadRefusal};

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

/// One run's document. 1,024 items with long paths and a full SCIEX output
/// set each stay well under it; a run that would not is written without its
/// items, and says so.
pub const MAX_RECORD_BYTES: u64 = 16 * 1024 * 1024;

/// How many runs are kept. The oldest ended ones go first.
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
    /// The items did not fit [`MAX_RECORD_BYTES`] and were left out.
    pub items_omitted: bool,
    pub items: Vec<RunItem>,
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
    /// row was no longer in the workspace when the run started.
    pub members: Vec<SourceMember>,
    /// The folder its outputs were written into.
    pub destination: Option<String>,
    /// ADR 0055's verified tier for this family on this build.
    pub settings_verified: bool,
    /// Whether this build is evidenced for this family.
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
    /// Every item ran under verified settings on an evidenced build.
    pub settings_verified: bool,
    pub build_release: Option<String>,
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
    /// show; a corrupt one has been kept aside under another name.
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
    /// another, and are kept so their end can still be recorded.
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
    fn of(record: &RunRecord, state: RunState) -> Self {
        let count = |wanted: &str| {
            record
                .items
                .iter()
                .filter(|item| item.progress.state == wanted)
                .count()
        };
        Self {
            run_id: record.run_id.clone(),
            state,
            started_at_ms: record.started_at_ms,
            ended_at_ms: record.ended_at_ms,
            interrupted_at_ms: record.interrupted_at_ms,
            passes: record.passes,
            settings_row: record.settings.row.clone(),
            settings_verified: !record.items_omitted
                && record.settings.row.is_some()
                && record
                    .items
                    .iter()
                    .all(|item| item.source.settings_verified),
            build_release: record.build_release.clone(),
            build_verified: !record.items_omitted
                && record.items.iter().all(|item| item.source.build_verified),
            failure: record.failure.clone(),
            item_count: record.items.len(),
            finalized_count: count(FINALIZED_ITEM),
            failed_count: count(FAILED_ITEM),
            items_omitted: record.items_omitted,
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
}

#[derive(Default)]
struct Lane {
    active: Option<ActiveRun>,
    /// The last write this session could not make, cleared by the next one
    /// that succeeds.
    problem: Option<&'static str>,
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
        if recording_off(directory) {
            return;
        }
        let mut lane = self.locked();
        let reopened = match lane.active.take() {
            Some(mut active) if active.key == key => {
                active.record.ended_at_ms = None;
                active.record.state = RunState::Running;
                Some(active)
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
                    items_omitted: false,
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
                            },
                        })
                        .collect(),
                },
            }
        });
        if apply(&mut active.record, progress) {
            lane.problem = publish(directory, &active.record).err();
        }
        lane.active = Some(active);
    }

    /// Records what the queue of `key` says now. Ignored unless that run is
    /// being recorded and has not ended.
    pub fn update(&self, key: u64, progress: RunProgress) {
        let Ok(directory) = &self.directory else {
            return;
        };
        let mut lane = self.locked();
        let Some(active) = lane.active.as_mut() else {
            return;
        };
        if active.key != key || active.record.state != RunState::Running {
            return;
        }
        // Turned off by any instance: this run is forgotten, not finished.
        if recording_off(directory) {
            let name = file_name_of(&active.record.run_id);
            lane.active = None;
            let _ = fs::remove_file(directory.join(name));
            return;
        }
        if !apply(&mut active.record, progress) {
            return;
        }
        let ended = active.record.state != RunState::Running;
        if ended {
            active.record.ended_at_ms = Some(now_ms());
        }
        lane.problem = publish(directory, &active.record).err();
        drop(lane);
        if ended {
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
        let mut runs = Vec::new();
        let (mut unreadable, mut newer) = (0, 0);
        for (name, _) in run_entries(directory) {
            match read_record(&directory.join(&name)) {
                Ok(Some(record)) => {
                    let state = self.state_now(directory, &record);
                    runs.push(RunSummaryDto::of(&record, state));
                }
                Ok(None) => {}
                Err(RecordProblem::NewerVersion) => newer += 1,
                Err(RecordProblem::Unreadable) => unreadable += 1,
                Err(RecordProblem::Malformed) => {
                    unreadable += 1;
                    set_aside(directory, &name);
                }
            }
        }
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
        match read_record(&directory.join(file_name_of(run_id))) {
            Ok(Some(record)) => RunHistoryReadDto::Found {
                run: RunSummaryDto::of(&record, self.state_now(directory, &record)),
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
            },
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

    /// Forgets every run that has ended, and every run kept aside. A run still
    /// being written, here or in another instance, is kept.
    #[must_use]
    pub fn clear(&self) -> RunHistoryWriteDto {
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return RunHistoryWriteDto::Unavailable { problem },
        };
        let (mut kept, mut not_removed) = (0, 0);
        for (name, _) in run_entries(directory) {
            if let Ok(Some(record)) = read_record(&directory.join(&name))
                && self.state_now(directory, &record) == RunState::Running
            {
                kept += 1;
                continue;
            }
            if remove(&directory.join(&name)).is_err() {
                not_removed += 1;
            }
        }
        for name in names(directory) {
            if name.starts_with(SET_ASIDE_PREFIX) && remove(&directory.join(&name)).is_err() {
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
    /// forgets what is stored, this session's run in progress included; on
    /// starts recording again from the next run.
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
        if fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&marker)
            .is_err()
        {
            return RunHistoryWriteDto::Failed {
                problem: "notTurnedOff",
                not_removed: 0,
            };
        }
        if let Some(active) = self.locked().active.take() {
            let _ = remove(&directory.join(file_name_of(&active.record.run_id)));
        }
        self.clear()
    }

    fn owner_id(&self) -> Option<&str> {
        self.owner.as_ref().map(|owner| owner.id.as_str())
    }

    /// The state a reader should be told: a `running` record whose owner is
    /// gone is interrupted, whether or not a start has said so on disk yet.
    fn state_now(&self, directory: &Path, record: &RunRecord) -> RunState {
        if record.state != RunState::Running || Some(record.owner.as_str()) == self.owner_id() {
            return record.state;
        }
        match owner_liveness(directory, &record.owner) {
            Liveness::Dead(_) => RunState::Interrupted,
            Liveness::Alive | Liveness::Unknown => RunState::Running,
        }
    }

    /// Marks every run whose session died mid-run, and removes those sessions'
    /// locks.
    fn recover(&self, directory: &Path) {
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
                mark_interrupted(&mut record, now_ms());
                let _ = publish(directory, &record);
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
    if !record.items_omitted && progress.items.len() != record.items.len() {
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

fn mark_interrupted(record: &mut RunRecord, now: u64) {
    record.state = RunState::Interrupted;
    record.interrupted_at_ms = Some(now);
    for item in &mut record.items {
        match item.progress.state.as_str() {
            // Its outcome was never recorded; a file may or may not exist.
            RUNNING_ITEM => item.progress.state = INTERRUPTED_ITEM.to_owned(),
            PENDING_ITEM => item.progress.state = NOT_RUN_ITEM.to_owned(),
            _ => {}
        }
    }
}

/// Writes one run's document, without its items where they would not fit.
fn publish(directory: &Path, record: &RunRecord) -> Result<(), &'static str> {
    let mut bytes = serde_json::to_vec(record).map_err(|_| "notWritten")?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        let mut reduced = record.clone();
        reduced.items.clear();
        reduced.items_omitted = true;
        bytes = serde_json::to_vec(&reduced).map_err(|_| "notWritten")?;
    }
    bytes.push(b'\n');
    // ponytail: the whole document is rewritten on every item, so a queue of n
    // items writes O(n^2) bytes over its life; an append log if that is ever
    // measured to matter.
    local_document::publish_through_temporary(
        directory,
        &directory.join(file_name_of(&record.run_id)),
        &bytes,
        TEMPORARY_PREFIX,
    )
    .map_err(|_| "notWritten")
}

/// Whether recording is off. A marker that cannot be inspected is off: not
/// recording is the safe reading of a switch nobody can read.
fn recording_off(directory: &Path) -> bool {
    match fs::symlink_metadata(directory.join(OFF_MARKER)) {
        Ok(_) => true,
        Err(error) => error.kind() != io::ErrorKind::NotFound,
    }
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

/// Keeps the newest runs within both bounds. A run still being written is
/// never removed, whichever instance writes it.
fn prune(directory: &Path, own: Option<&str>) {
    let entries = run_entries(directory);
    let mut count = entries.len();
    let mut bytes: u64 = entries.iter().map(|(_, size)| size).sum();
    for (name, size) in entries {
        if count <= MAX_RUNS && bytes <= MAX_TOTAL_BYTES {
            break;
        }
        let path = directory.join(&name);
        if let Ok(Some(record)) = read_record(&path)
            && record.state == RunState::Running
            && (Some(record.owner.as_str()) == own
                || !matches!(owner_liveness(directory, &record.owner), Liveness::Dead(_)))
        {
            continue;
        }
        if remove(&path).is_ok() {
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
/// exists the bytes are kept whatever happens to the original name.
fn set_aside(directory: &Path, name: &str) {
    let aside = directory.join(format!("{SET_ASIDE_PREFIX}{}-{name}", now_ms()));
    if fs::hard_link(directory.join(name), aside).is_ok() {
        let _ = fs::remove_file(directory.join(name));
    }
}
