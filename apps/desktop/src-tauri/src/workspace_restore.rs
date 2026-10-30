//! Restoring the workspace at start (WSP-010, ADR 0061).
//!
//! ## What is kept
//!
//! One versioned, bounded document in the application's own per-user
//! directory, replaced whole through [`crate::local_document`]. It records
//! each row's locator, its family and the identity facts admission
//! established (length, volume serial and file ID of every member), the
//! groups, the order and the checked state (conversion membership, which
//! starts nothing by itself). Nothing that starts work is representable in it:
//! no open preview, no viewed or highlighted row, no conversion queue and no
//! adoption.
//!
//! ## What a start does
//!
//! The document is read once, when the store is opened. A document this build
//! cannot use -- malformed, oversized, unreadable or from a newer build -- is
//! refused whole and left exactly as found, and the session starts empty, with
//! restore off, and says so. Off is the fail-closed answer: a refused document
//! may be one the user had switched off, so nothing is recorded until the user
//! turns restore on, and turning it on keeps the refused document aside under
//! another name before anything replaces it.
//!
//! A usable document becomes the session's *restored rows*. They are not
//! Workbench rows: they carry `restored-N` handles, and putting one back in the
//! Workbench is ordinary admission, in a later slice. A row is offered at a
//! bounded number of starts ([`MAX_OFFERS`]) without being put back, then it is
//! no longer offered and the start says how many such rows there were. Every
//! read re-checks the offered rows cheaply: the drive or share each recorded
//! path is on is probed once, then the object at the path is opened for its
//! attributes only, without data access or a link followed, and its file ID,
//! volume serial and length are compared with what was recorded. No byte is
//! read and nothing is hashed. A changed or missing file stays a marked row;
//! it is never dropped and never relinked.
//!
//! ## When it is written
//!
//! When the webview commits an arrangement, which it does after each roster
//! change and each organization change. Rust composes the document from its
//! own registry and its own restored rows; the webview contributes only the
//! groups, the order and the checked state, by handle. A save must place every
//! live and every restored row of this process exactly once. A save is also
//! refused once this process sees that another MSCanvas process has written
//! the document since this one last read or wrote it. That check and the
//! replacement are two steps, so a write racing between them is not excluded;
//! off and clear always write.

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::local_document::{self, ReadRefusal, WriteRefusal};
use crate::preview::dto::{DatasetSourceKindDto, MAX_WORKSPACE_DATASETS};
use crate::preview::service::workspace_rows::LiveRow;

/// The document's fixed name in the per-user directory.
const FILE_NAME: &str = "workspace-restore.json";

/// The prefix of every private sibling a publish creates.
const TEMPORARY_PREFIX: &str = ".mscanvas-workspace-restore-";

/// The prefix of a refused document kept aside before restore is turned on.
const SET_ASIDE_PREFIX: &str = "workspace-restore.set-aside-";

pub const SCHEMA_VERSION: u32 = 1;

/// Far above any real roster (1,024 rows of ordinary paths is well under one
/// MiB) and far below a read anyone would wait for.
pub const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;

/// The session's own capacity: a restore never holds more than a workspace.
pub const MAX_ROWS: usize = MAX_WORKSPACE_DATASETS;

pub const MAX_NAMED_GROUPS: usize = 1_024;

/// The Workbench's own group-name bound, in UTF-16 units as the webview counts.
const MAX_GROUP_NAME_UTF16: usize = 120;

/// The longest path Windows accepts, in UTF-16 units.
const MAX_PATH_UTF16: usize = 32_767;

/// The prefix of a restored row's handle. Distinct from the live `file-`
/// handles, so one can never be taken for the other.
const RESTORED_PREFIX: &str = "restored-";

/// How many starts offer a row that is not put back (ADR 0061, decision 10,
/// Proposed). A row the session that saw the offer did not put back is
/// offered no more, so the document is the last session's Workbench and at
/// most that session's untaken offer, never a growing history.
pub const MAX_OFFERS: u32 = 1;

// ------------------------------------------------------------------ document

/// The family a row was admitted as, spelled as the roster spells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Family {
    Mzml,
    ThermoRaw,
    ShimadzuLcd,
    SciexWiff,
}

impl Family {
    const fn of(kind: DatasetSourceKindDto) -> Self {
        match kind {
            DatasetSourceKindDto::Mzml => Self::Mzml,
            DatasetSourceKindDto::ThermoRaw => Self::ThermoRaw,
            DatasetSourceKindDto::ShimadzuLcd => Self::ShimadzuLcd,
            DatasetSourceKindDto::SciexWiff => Self::SciexWiff,
        }
    }

    /// How many objects one acquisition of this family is.
    const fn members(self) -> usize {
        match self {
            Self::SciexWiff => 2,
            Self::Mzml | Self::ThermoRaw | Self::ShimadzuLcd => 1,
        }
    }
}

/// The whole stored document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreDocument {
    pub schema_version: u32,
    /// The off switch. An off document holds no rows, so turning restore off
    /// forgets every path this document stored. A copy kept aside after a
    /// refusal is a separate file and keeps its own.
    pub enabled: bool,
    /// In order. Exactly one group has no name: Ungrouped.
    pub groups: Vec<StoredGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredGroup {
    pub name: Option<String>,
    pub rows: Vec<StoredRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredRow {
    pub family: Family,
    pub checked: bool,
    /// How many starts have offered this row since it was last in the
    /// Workbench, as of the last save: 0 for a live row.
    pub offered: u32,
    /// Primary first.
    pub members: Vec<StoredMember>,
}

/// One object, as admission found it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredMember {
    pub path: String,
    pub byte_length: u64,
    pub volume_serial: u64,
    /// The 128-bit file ID, as 32 lowercase hex digits.
    pub file_id: String,
}

impl fmt::Debug for StoredMember {
    /// Opaque about the path, which is the one thing here a log must not get.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "<member of {} bytes>", self.byte_length)
    }
}

impl RestoreDocument {
    /// Nothing stored but the switch, and the Ungrouped group every
    /// arrangement has.
    #[must_use]
    pub fn empty(enabled: bool) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            enabled,
            groups: vec![StoredGroup {
                name: None,
                rows: Vec::new(),
            }],
        }
    }

    fn rows(&self) -> impl Iterator<Item = &StoredRow> {
        self.groups.iter().flat_map(|group| &group.rows)
    }

    /// Every rule a stored document must meet, applied to what is read and to
    /// what is about to be written alike.
    fn valid(&self) -> bool {
        let unnamed = self.groups.iter().filter(|g| g.name.is_none()).count();
        let named = self.groups.len() - unnamed;
        let rows = self.rows().count();
        self.schema_version == SCHEMA_VERSION
            && unnamed == 1
            && named <= MAX_NAMED_GROUPS
            && rows <= MAX_ROWS
            && (self.enabled || rows == 0)
            && self
                .groups
                .iter()
                .all(|group| group.name.as_deref().is_none_or(valid_group_name))
            && self.rows().all(|row| {
                row.members.len() == row.family.members() && row.members.iter().all(valid_member)
            })
    }
}

/// Blank as the webview's `trim()` judges it: U+0085 is Unicode white space
/// but not JavaScript white space, and U+FEFF is the reverse, so this accepts
/// exactly the names the Workbench accepts.
fn valid_group_name(name: &str) -> bool {
    !name
        .chars()
        .all(|c| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
        && name.encode_utf16().count() <= MAX_GROUP_NAME_UTF16
}

fn valid_member(member: &StoredMember) -> bool {
    !member.path.is_empty()
        && !member.path.contains('\0')
        && member.path.encode_utf16().count() <= MAX_PATH_UTF16
        && Path::new(&member.path).is_absolute()
        && file_id_bytes(&member.file_id).is_some()
}

fn file_id_hex(file_id: [u8; 16]) -> String {
    file_id.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn file_id_bytes(hex: &str) -> Option<[u8; 16]> {
    if hex.len() != 32 || !hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    let mut bytes = [0_u8; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(bytes)
}

/// Why a stored document is not used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentProblem {
    Malformed,
    /// Written by a later build. Kept aside, so a downgrade cannot destroy it.
    NewerVersion,
    UnsupportedVersion,
    Oversized,
    /// Possibly only for now: a lock or an I/O error says nothing about the
    /// document. Never replaced this session; the next start reads it again.
    Unreadable,
    /// The name is a link, a directory or a device. Never replaced.
    UnsafeTarget,
}

impl DocumentProblem {
    /// Whether nothing may replace the document this session, even with
    /// restore turned on: it is not known to be unusable, or it is not this
    /// application's file to move.
    const fn kept(self) -> bool {
        matches!(self, Self::Unreadable | Self::UnsafeTarget)
    }

    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Malformed => "malformed",
            Self::NewerVersion => "newerVersion",
            Self::UnsupportedVersion => "unsupportedVersion",
            Self::Oversized => "oversized",
            Self::Unreadable => "unreadable",
            Self::UnsafeTarget => "unsafeTarget",
        }
    }
}

/// Reads one document, whole or not at all.
///
/// # Errors
///
/// The first reason the bytes are not a document this build uses.
pub fn read_document(bytes: &[u8]) -> Result<RestoreDocument, DocumentProblem> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionProbe {
        schema_version: Option<u32>,
    }

    let probe: VersionProbe =
        serde_json::from_slice(bytes).map_err(|_| DocumentProblem::Malformed)?;
    match probe.schema_version {
        Some(SCHEMA_VERSION) => {}
        Some(version) if version > SCHEMA_VERSION => return Err(DocumentProblem::NewerVersion),
        Some(_) => return Err(DocumentProblem::UnsupportedVersion),
        None => return Err(DocumentProblem::Malformed),
    }
    let document: RestoreDocument =
        serde_json::from_slice(bytes).map_err(|_| DocumentProblem::Malformed)?;
    if !document.valid() {
        return Err(DocumentProblem::Malformed);
    }
    Ok(document)
}

#[must_use]
pub fn write_document(document: &RestoreDocument) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(document).expect("a restore document always serializes");
    bytes.push(b'\n');
    bytes
}

// ------------------------------------------------------------------ re-check

/// What the object at a restored row's recorded path is now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowState {
    /// The same file ID and volume serial, at the same length. Not a claim
    /// about the bytes: a same-length rewrite in place, or a file ID the
    /// filesystem reused after the recorded file was deleted, also matches.
    /// Admission and the ordinary revalidation decide that when it is used.
    Matching,
    /// Something is there and it is not the object recorded, or it is the
    /// object at another length.
    Changed,
    /// Nothing at the recorded path, on a drive or share that answers.
    Missing,
    /// The drive or share the recorded path is on does not answer now: a
    /// removed disk, an offline share. Says nothing about the file.
    Unreachable,
    /// There, and this process could not open it or establish its identity.
    Unreadable,
    /// A link, a directory or a device.
    Unsafe,
}

/// Whether each drive or share root answered, probed once per read, so an
/// offline share costs one wait however many rows are on it.
type Roots = HashMap<PathBuf, bool>;

fn check_row(row: &StoredRow, roots: &mut Roots) -> RowState {
    row.members
        .iter()
        .map(|member| check_member(member, roots))
        .find(|state| *state != RowState::Matching)
        .unwrap_or(RowState::Matching)
}

/// A root that refuses this process still answers; anything else that fails
/// to describe it does not.
fn root_answers(root: &Path) -> bool {
    match std::fs::metadata(root) {
        Ok(_) => true,
        Err(error) => error.kind() == std::io::ErrorKind::PermissionDenied,
    }
}

/// Opens the object for its attributes only, without following a link at its
/// name. No data access is asked for, so the open never conflicts with another
/// program's hold on the file, held without sharing or not.
#[cfg(windows)]
fn open_for_attributes(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const SHARE_ALL: u32 = 7;
    std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(SHARE_ALL)
        .custom_flags(local_document::OPEN_REPARSE_POINT)
        .open(path)
}

#[cfg(not(windows))]
use local_document::open_for_read as open_for_attributes;

/// Probes the member's root once per read, then opens the member for its
/// attributes. Reads no byte.
fn check_member(member: &StoredMember, roots: &mut Roots) -> RowState {
    let path = Path::new(&member.path);
    let root = path.ancestors().last().unwrap_or(path);
    if !*roots
        .entry(root.to_path_buf())
        .or_insert_with(|| root_answers(root))
    {
        return RowState::Unreachable;
    }
    let file = match open_for_attributes(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return RowState::Missing,
        Err(_) => {
            return match std::fs::symlink_metadata(path) {
                Ok(metadata)
                    if !metadata.is_file() || local_document::is_reparse_point(&metadata) =>
                {
                    RowState::Unsafe
                }
                _ => RowState::Unreadable,
            };
        }
    };
    let Ok(metadata) = file.metadata() else {
        return RowState::Unreadable;
    };
    if !local_document::is_ordinary_file(&metadata) {
        return RowState::Unsafe;
    }
    let recorded = (member.volume_serial, file_id_bytes(&member.file_id));
    match local_document::object_identity_of(&file) {
        Some((volume, id))
            if (volume, Some(id)) == recorded && metadata.len() == member.byte_length =>
        {
            RowState::Matching
        }
        Some(_) => RowState::Changed,
        None => RowState::Unreadable,
    }
}

// ------------------------------------------------------------------ wire

/// One row as the webview sees it: no path, no identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredRowDto {
    pub handle: String,
    /// The roster's own key and values for a row's family.
    pub source_kind: Family,
    pub display_name: String,
    pub checked: bool,
    pub state: RowState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredGroupDto {
    /// `None` is Ungrouped.
    pub name: Option<String>,
    pub rows: Vec<RestoredRowDto>,
}

/// What the start-up restore found.
///
/// `leftover_copies` counts the files beside the document that can still hold
/// paths: copies kept aside when restore was turned on over a refused
/// document, and private siblings a failed write or a crash left (another
/// window's write in progress is counted too). Off and clear remove none of
/// them (ADR 0061, decision 7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceRestoreReadDto {
    /// The rows still waiting to be put back, in their stored groups and
    /// order, each re-checked now. Empty on a first run or after a clear.
    /// `expired`: stored rows this start no longer offers, because earlier
    /// starts offered them [`MAX_OFFERS`] times and they were not put back.
    /// They stay in the document until this session first saves, clears or
    /// turns restore off, so a start that saves nothing reports them again.
    Restored {
        groups: Vec<RestoredGroupDto>,
        expired: u32,
        leftover_copies: u32,
    },
    /// Restore is switched off. Nothing is stored.
    Off { leftover_copies: u32 },
    /// The stored document was refused whole and is still where it was,
    /// unchanged; the session started empty and restore is off. It stays off
    /// until the user turns it on, which keeps the refused document aside
    /// first, or forgets it with off or clear. For `unreadable` and
    /// `unsafeTarget` every write is refused this session
    /// (`storedDocumentKept`). Answered until the first write succeeds.
    Refused {
        problem: &'static str,
        leftover_copies: u32,
    },
    /// There is nowhere to keep a document this session.
    Unavailable { problem: &'static str },
}

/// What one save, clear or switch did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceRestoreWriteDto {
    /// The stored document now says what was asked. Turning restore on when
    /// it is already on, and no other process has written since, writes
    /// nothing and answers this.
    Saved,
    /// A clear forgot every stored row and, unlike an ordinary clear, turned
    /// restore off, because which switch the document held could not be
    /// known: `changedElsewhere` or `identityUnknown`, as for `refused`.
    TurnedOff {
        problem: &'static str,
    },
    /// Restore is off; nothing was written.
    Off,
    /// Refused before anything was written. The stored document is unchanged.
    /// `changedElsewhere`: another MSCanvas process wrote it since this one
    /// last read or wrote it; this session records nothing more until it
    /// restarts. Off and clear still work, and both leave restore off.
    /// `identityUnknown`: the document is there and could not be identified
    /// just now (another program holds it); retryable, nothing is latched.
    Refused {
        problem: &'static str,
    },
    Unavailable {
        problem: &'static str,
    },
    /// The write did not complete. The last document is still what a restart
    /// will find.
    Failed {
        problem: &'static str,
        retryable: bool,
        temporary_left_behind: bool,
    },
}

/// The webview's arrangement: groups in order, each with its handles in
/// order, and which handles are checked.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceArrangementDto {
    pub groups: Vec<ArrangedGroupDto>,
    #[serde(default)]
    pub checked: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArrangedGroupDto {
    /// `None` is Ungrouped.
    #[serde(default)]
    pub name: Option<String>,
    pub handles: Vec<String>,
}

// ------------------------------------------------------------------ store

#[derive(Debug, Clone, Copy)]
enum Startup {
    Unavailable(&'static str),
    Loaded,
    /// The start-up document was refused and is still at the name. `Loaded`
    /// once a write replaces it.
    Refused(DocumentProblem),
}

struct Lane {
    startup: Startup,
    enabled: bool,
    /// What the name held when this session last read or wrote it, by
    /// identity; `None` for nothing there.
    published: Option<(u64, [u8; 16])>,
    /// Set once the name was found holding something else; never cleared, so
    /// this session records nothing more until it restarts.
    foreign: bool,
    /// The refused start-up document is already kept aside, so a retried turn
    /// on does not keep a second copy.
    kept_aside: bool,
    /// The start-up rows not yet back in the Workbench, in their stored
    /// groups, each with this start counted in `offered`. The Nth row in
    /// order is `restored-N`.
    ///
    /// ponytail: only ever emptied whole (clear, off); putting one row back
    /// or dismissing one needs stable per-row slots, which the interface
    /// slice adds first (ADR 0061, decision 4).
    restored: Vec<StoredGroup>,
    /// The stored rows this start no longer offers (decision 10).
    expired: u32,
}

/// What the document's name holds, against what this session last saw there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Seen {
    /// The same object, and it always has been.
    Same,
    /// Something is there and its identity cannot be read just now. Not
    /// latched: the next write looks again.
    Unknown,
    /// Another object, or nothing, where this session last saw one; or it
    /// did once. Latched for the session.
    Elsewhere,
}

impl Seen {
    const fn problem(self) -> &'static str {
        match self {
            Self::Unknown => "identityUnknown",
            Self::Same | Self::Elsewhere => "changedElsewhere",
        }
    }
}

/// The session's one workspace restore document.
pub struct WorkspaceRestoreStore {
    directory: Option<PathBuf>,
    lane: Mutex<Lane>,
}

impl WorkspaceRestoreStore {
    /// Reads the stored document once, for this session.
    ///
    /// `Err` is a session with nowhere to keep one, which is usable and says
    /// so.
    #[must_use]
    pub fn open(directory: Result<PathBuf, &'static str>) -> Self {
        let (directory, lane) = match directory {
            Ok(directory) => {
                let lane = load(&directory);
                (Some(directory), lane)
            }
            Err(problem) => (
                None,
                Lane {
                    startup: Startup::Unavailable(problem),
                    enabled: false,
                    published: None,
                    foreign: false,
                    kept_aside: false,
                    restored: Vec::new(),
                    expired: 0,
                },
            ),
        };
        Self {
            directory,
            lane: Mutex::new(lane),
        }
    }

    /// The start-up restore, each waiting row re-checked now.
    #[must_use]
    pub fn read(&self) -> WorkspaceRestoreReadDto {
        let (startup, enabled, restored, expired, leftover_copies) = {
            let lane = self.locked();
            // Counted under the lane, so this process's own write in progress
            // is never taken for a leftover.
            let leftover_copies = self.directory.as_deref().map_or(0, leftover_copies);
            (
                lane.startup,
                lane.enabled,
                lane.restored.clone(),
                lane.expired,
                leftover_copies,
            )
        };
        // The checks touch the filesystem, so they run with the lane free.
        match startup {
            Startup::Unavailable(problem) => WorkspaceRestoreReadDto::Unavailable { problem },
            Startup::Refused(problem) => WorkspaceRestoreReadDto::Refused {
                problem: problem.stable_id(),
                leftover_copies,
            },
            Startup::Loaded if !enabled => WorkspaceRestoreReadDto::Off { leftover_copies },
            Startup::Loaded => {
                let mut index = 0;
                let mut roots = Roots::new();
                let groups = restored
                    .into_iter()
                    .map(|group| RestoredGroupDto {
                        name: group.name,
                        rows: group
                            .rows
                            .iter()
                            .map(|row| {
                                let dto = restored_row_dto(index, row, &mut roots);
                                index += 1;
                                dto
                            })
                            .collect(),
                    })
                    .collect();
                WorkspaceRestoreReadDto::Restored {
                    groups,
                    expired,
                    leftover_copies,
                }
            }
        }
    }

    /// Replaces the document with the session as it is now: `live` from the
    /// registry, the waiting restored rows, and the webview's arrangement of
    /// both.
    #[must_use]
    pub fn save(
        &self,
        arrangement: &WorkspaceArrangementDto,
        live: Vec<LiveRow>,
    ) -> WorkspaceRestoreWriteDto {
        let mut lane = self.locked();
        let directory = match self.writable(&lane) {
            Ok(directory) => directory,
            Err(refusal) => return refusal,
        };
        if !lane.enabled {
            return WorkspaceRestoreWriteDto::Off;
        }
        let mut rows: HashMap<String, StoredRow> = HashMap::new();
        let mut live_objects = HashSet::new();
        for row in live {
            let Some(stored) = stored_row(&row) else {
                return refused("notStorable");
            };
            live_objects.insert(objects(&stored));
            rows.insert(row.handle, stored);
        }
        for (index, row) in lane.restored.iter().flat_map(|g| &g.rows).enumerate() {
            rows.insert(format!("{RESTORED_PREFIX}{index}"), row.clone());
        }
        let document = match arrange(arrangement, rows, &live_objects) {
            Ok(document) => document,
            Err(problem) => return refused(problem),
        };
        match seen(directory, &mut lane) {
            Seen::Same => publish(directory, &mut lane, &document),
            other => refused(other.problem()),
        }
    }

    /// Forgets every row the document stored, live and restored, and keeps
    /// the switch, unless the name no longer holds what this session last saw
    /// there: which switch it holds then is not known here, so the clear writes
    /// off and answers `turnedOff`. A copy kept aside after a refusal is not
    /// removed.
    #[must_use]
    pub fn clear(&self) -> WorkspaceRestoreWriteDto {
        let mut lane = self.locked();
        let directory = match self.writable(&lane) {
            Ok(directory) => directory,
            Err(refusal) => return refusal,
        };
        let seen = seen(directory, &mut lane);
        let enabled = lane.enabled && seen == Seen::Same;
        let outcome = publish(directory, &mut lane, &RestoreDocument::empty(enabled));
        if outcome != WorkspaceRestoreWriteDto::Saved {
            return outcome;
        }
        let turned_off = lane.enabled && !enabled;
        lane.enabled = enabled;
        lane.restored.clear();
        if turned_off {
            WorkspaceRestoreWriteDto::TurnedOff {
                problem: seen.problem(),
            }
        } else {
            outcome
        }
    }

    /// The off switch. Off publishes an empty, disabled document even when
    /// restore is already off, so it also forgets a refused document's paths;
    /// a copy kept aside after a refusal is not removed. On starts from an
    /// empty document, after keeping a refused one aside; turning on what is
    /// already on writes nothing. On is refused (`changedElsewhere`) once
    /// another process has written the document since this one last saw it,
    /// and (`identityUnknown`) while the document cannot be identified.
    #[must_use]
    pub fn set_enabled(&self, enabled: bool) -> WorkspaceRestoreWriteDto {
        let mut lane = self.locked();
        let directory = match self.writable(&lane) {
            Ok(directory) => directory,
            Err(refusal) => return refusal,
        };
        if enabled {
            let seen = seen(directory, &mut lane);
            if seen != Seen::Same {
                return refused(seen.problem());
            }
            if lane.enabled {
                return WorkspaceRestoreWriteDto::Saved;
            }
            if matches!(lane.startup, Startup::Refused(_)) && !lane.kept_aside {
                if !set_aside(directory) {
                    return refused("storedDocumentKept");
                }
                lane.kept_aside = true;
            }
        }
        let outcome = publish(directory, &mut lane, &RestoreDocument::empty(enabled));
        if outcome == WorkspaceRestoreWriteDto::Saved {
            lane.enabled = enabled;
            lane.restored.clear();
        }
        outcome
    }

    fn writable(&self, lane: &Lane) -> Result<&Path, WorkspaceRestoreWriteDto> {
        match (&self.directory, lane.startup) {
            (None, Startup::Unavailable(problem)) => {
                Err(WorkspaceRestoreWriteDto::Unavailable { problem })
            }
            (None, _) => Err(WorkspaceRestoreWriteDto::Unavailable {
                problem: "rootUnresolved",
            }),
            (Some(_), Startup::Refused(problem)) if problem.kept() => {
                Err(refused("storedDocumentKept"))
            }
            (Some(directory), _) => Ok(directory.as_path()),
        }
    }

    /// Poisoning is recovered from: a panic in one save says nothing about the
    /// file.
    fn locked(&self) -> std::sync::MutexGuard<'_, Lane> {
        self.lane
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

const fn refused(problem: &'static str) -> WorkspaceRestoreWriteDto {
    WorkspaceRestoreWriteDto::Refused { problem }
}

fn restored_row_dto(index: usize, row: &StoredRow, roots: &mut Roots) -> RestoredRowDto {
    let primary = row
        .members
        .first()
        .map_or("", |member| member.path.as_str());
    RestoredRowDto {
        handle: format!("{RESTORED_PREFIX}{index}"),
        source_kind: row.family,
        display_name: Path::new(primary)
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_owned(),
        checked: row.checked,
        state: check_row(row, roots),
    }
}

/// How many files beside the document can still hold paths; see
/// [`WorkspaceRestoreReadDto`]. A directory that cannot be listed counts none.
fn leftover_copies(directory: &Path) -> u32 {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return 0;
    };
    let count = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with(SET_ASIDE_PREFIX) || name.starts_with(TEMPORARY_PREFIX)
        })
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// A live row as the document records it, or `None` where a path cannot be
/// written down as itself.
fn stored_row(row: &LiveRow) -> Option<StoredRow> {
    let members = row
        .members
        .iter()
        .map(|member| {
            Some(StoredMember {
                path: member.path.to_str()?.to_owned(),
                byte_length: member.byte_length,
                volume_serial: member.identity.0,
                file_id: file_id_hex(member.identity.1),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let stored = StoredRow {
        family: Family::of(row.family),
        checked: false,
        offered: 0,
        members,
    };
    stored.members.iter().all(valid_member).then_some(stored)
}

/// The objects a row is, by identity, primary first.
fn objects(row: &StoredRow) -> Vec<(u64, String)> {
    row.members
        .iter()
        .map(|member| (member.volume_serial, member.file_id.clone()))
        .collect()
}

/// Builds the document the arrangement describes over exactly these rows.
///
/// A restored row whose objects are a live row's is that row recorded twice:
/// it is placed like any other and written once, as the live row. Objects,
/// not paths: a file renamed and added again under its new name is one row,
/// while another object at the recorded path, or a bundle with another
/// companion, is not and keeps its restored row.
fn arrange(
    arrangement: &WorkspaceArrangementDto,
    mut rows: HashMap<String, StoredRow>,
    live_objects: &HashSet<Vec<(u64, String)>>,
) -> Result<RestoreDocument, &'static str> {
    let checked: HashSet<&str> = arrangement.checked.iter().map(String::as_str).collect();
    if checked.iter().any(|handle| !rows.contains_key(*handle)) {
        return Err("staleArrangement");
    }
    let mut placed = HashSet::new();
    let mut groups = Vec::with_capacity(arrangement.groups.len());
    for group in &arrangement.groups {
        let mut stored = Vec::with_capacity(group.handles.len());
        for handle in &group.handles {
            if !placed.insert(handle.as_str()) {
                return Err("invalidArrangement");
            }
            let mut row = rows.remove(handle).ok_or("staleArrangement")?;
            if handle.starts_with(RESTORED_PREFIX) && live_objects.contains(&objects(&row)) {
                continue;
            }
            row.checked = checked.contains(handle.as_str());
            stored.push(row);
        }
        groups.push(StoredGroup {
            name: group.name.clone(),
            rows: stored,
        });
    }
    // A row the arrangement does not place is a row a save would drop.
    if !rows.is_empty() {
        return Err("staleArrangement");
    }
    let document = RestoreDocument {
        schema_version: SCHEMA_VERSION,
        enabled: true,
        groups,
    };
    if document.rows().count() > MAX_ROWS {
        return Err("tooManyRows");
    }
    if !document.valid() {
        return Err("invalidArrangement");
    }
    Ok(document)
}

/// Whether the name still holds what this session last read or wrote there,
/// and always has. Once it did not, the answer stays `Elsewhere` for the
/// session: a later write of this process's own does not make it a recorder
/// again. A document that is there but cannot be identified just now (another
/// program holds it without sharing read) is `Unknown`, which latches nothing.
///
/// ponytail: checked and then replaced, so another process's write landing
/// between the two is still lost; a lock beside the document closes that if
/// two windows are ever seen racing. A volume with no file ID answers `None`
/// both times and is not guarded.
fn seen(directory: &Path, lane: &mut Lane) -> Seen {
    let name = directory.join(FILE_NAME);
    let now = local_document::object_identity(&name);
    if !lane.foreign && now != lane.published {
        let absent = matches!(
            std::fs::symlink_metadata(&name),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound
        );
        if now.is_none() && !absent {
            return Seen::Unknown;
        }
        lane.foreign = true;
    }
    if lane.foreign {
        Seen::Elsewhere
    } else {
        Seen::Same
    }
}

/// Replaces the document and remembers what the name now holds. Every failing
/// path leaves the previous one where it was; see
/// [`local_document::publish_through_temporary`].
fn publish(
    directory: &Path,
    lane: &mut Lane,
    document: &RestoreDocument,
) -> WorkspaceRestoreWriteDto {
    let failed = |problem, retryable, temporary_left_behind| WorkspaceRestoreWriteDto::Failed {
        problem,
        retryable,
        temporary_left_behind,
    };
    let bytes = write_document(document);
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return failed("oversized", false, false);
    }
    if std::fs::create_dir_all(directory).is_err() {
        return failed("directoryUnusable", true, false);
    }
    let target = directory.join(FILE_NAME);
    match local_document::publish_through_temporary(directory, &target, &bytes, TEMPORARY_PREFIX) {
        Ok(()) => {
            // ponytail: read after the rename, so a write by another process
            // in between is taken for this one's; and an identity that cannot
            // be read just now makes the next guarded write answer
            // `changedElsewhere`, which stops recording for the session rather
            // than writing over anything.
            lane.published = local_document::object_identity(&target);
            lane.startup = Startup::Loaded;
            WorkspaceRestoreWriteDto::Saved
        }
        Err(failure) => {
            let (problem, retryable) = match failure.refusal {
                WriteRefusal::UnsafeTarget => ("unsafeTarget", false),
                WriteRefusal::NotWritten => ("notWritten", true),
                WriteRefusal::NotPublished => ("notPublished", true),
            };
            failed(problem, retryable, failure.temporary_left_behind)
        }
    }
}

/// The start-up read: what is stored, or why it is not used. Writes nothing:
/// a refused document is left exactly as found, and the session starts off.
fn load(directory: &Path) -> Lane {
    let file = directory.join(FILE_NAME);
    // Taken before the read, so a document replaced in between is one this
    // session's first save refuses rather than writes over.
    let published = local_document::object_identity(&file);
    let lane = |startup, enabled, restored, expired| Lane {
        startup,
        enabled,
        published,
        foreign: false,
        kept_aside: false,
        restored,
        expired,
    };
    // Off: a refused document may be one the user had switched off.
    let refusal = |problem| lane(Startup::Refused(problem), false, Vec::new(), 0);
    match local_document::read_bounded(&file, MAX_DOCUMENT_BYTES) {
        Ok(None) => lane(Startup::Loaded, true, Vec::new(), 0),
        Ok(Some(bytes)) => match read_document(&bytes) {
            Ok(document) => {
                let (groups, expired) = offered_now(document.groups);
                lane(Startup::Loaded, document.enabled, groups, expired)
            }
            Err(problem) => refusal(problem),
        },
        Err(ReadRefusal::UnsafeTarget) => refusal(DocumentProblem::UnsafeTarget),
        Err(ReadRefusal::Oversized) => refusal(DocumentProblem::Oversized),
        Err(ReadRefusal::Unreadable) => refusal(DocumentProblem::Unreadable),
    }
}

/// Counts this start as one more offer of every stored row, and keeps back the
/// rows already offered [`MAX_OFFERS`] times, counting them. Groups stay, even
/// one left empty: an empty group is part of an arrangement.
fn offered_now(mut groups: Vec<StoredGroup>) -> (Vec<StoredGroup>, u32) {
    let mut expired = 0_u32;
    for group in &mut groups {
        group.rows.retain_mut(|row| {
            row.offered = row.offered.saturating_add(1);
            let kept = row.offered <= MAX_OFFERS;
            expired += u32::from(!kept);
            kept
        });
    }
    (groups, expired)
}

/// Keeps the refused document under a name nothing else uses, before turning
/// restore on replaces it, so a downgrade cannot destroy a newer build's
/// document.
///
/// A hard link refuses an existing name, so nothing is ever replaced, and the
/// published name is left to the publish that follows.
fn set_aside(directory: &Path) -> bool {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let aside = directory.join(format!(
        "{SET_ASIDE_PREFIX}{seconds}-{}.json",
        std::process::id()
    ));
    std::fs::hard_link(directory.join(FILE_NAME), aside).is_ok()
}
