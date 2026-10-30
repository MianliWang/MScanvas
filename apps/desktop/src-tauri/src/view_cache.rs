//! The view cache of ADR 0060 (decisions 6 to 10): where MSCanvas keeps the
//! mzML it converted from a Thermo RAW file so the file can be viewed, and the
//! only code that writes or removes anything there.
//!
//! ## Layout
//!
//! ```text
//! <application-local data>\view-cache\
//!   .mscanvas-view-cache-owner        the root marker
//!   entries\<key>\                    one published entry; <key> is 64 lowercase hex digits
//!     entry.json                      the manifest
//!     view.mzML                       the converted file
//!   staging\<attempt uuid>\           one attempt's private area
//!     owner.json                      the attempt's owner: process id and creation time
//!     entry\                          what publishing renames to entries\<key>
//! ```
//!
//! No name here comes from the user's file, and no file outside the cache is
//! ever written. The root is always injected: this module resolves no folder of
//! its own.
//!
//! ## What may be deleted
//!
//! Decision 9's closed list, and nothing else:
//!
//! - an entry: a directory under `entries` named by a key and holding nothing
//!   but `view.mzML` and `entry.json` as plain files (either may be missing);
//!   `view.mzML`, then `entry.json`, then the directory;
//! - an attempt under `staging` whose `owner.json` names it and a process that
//!   is gone, or an attempt this process made, when it ends;
//! - this process's own `view-cache.creating-<uuid>`, holding at most the
//!   marker, after it failed or lost the race to become the root.
//!
//! Everything else is left exactly as found and counted: a link or other
//! reparse point where a cache directory or an entry's file belongs, an unknown
//! name, a directory not named by a key -- spelled otherwise than in lowercase
//! included --, an entry with anything else in it, an attempt with a link or
//! other reparse point anywhere below it, and a root without its marker.
//!
//! ## Names are held while they are used
//!
//! The root, `entries` and `staging` are held open for the cache's lifetime,
//! and a directory being read or emptied is held while it is, every one of
//! them without delete sharing. None of those names can then be renamed away
//! and replaced by a link while a path through them is in use. Every handle is
//! opened on the name itself (`FILE_FLAG_OPEN_REPARSE_POINT`) and checked to be
//! a plain directory spelled on disk exactly as the cache spells it, or a plain
//! file, before anything below it is touched, and a file is removed through
//! such a handle, never by resolving its name again.
//!
//! ponytail: the three lifetime handles must share write access, because
//! creating and publishing into them needs it, so one of them could be turned
//! into a link in place while it is empty. Each operation re-checks them first;
//! a same-user writer racing one operation is the residual. Handle-relative
//! opens (`NtCreateFile` with a root directory, as `conversion_run/cleanup.rs`
//! does) close it if that ever matters.

use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::windows::fs::OpenOptionsExt as _;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use mscanvas_proteowizard::Sha256Digest;
use serde::{Deserialize, Serialize};

use crate::local_document::{self, OPEN_REPARSE_POINT, ReadRefusal};
use crate::targeted_ms1::scratch::{Owner, owner, this_process};
use crate::targeted_ms1::write_new;

#[cfg(test)]
mod tests;

/// The cap of decision 9: 10 GiB of published `view.mzML` bytes.
pub(crate) const CAP_BYTES: u64 = 10 * 1024 * 1024 * 1024;
/// The per-entry ceiling: the document limit of the mzML inspector and the
/// viewing reader (`MzmlScanLimits`, ADR 0056 decision 2).
pub(crate) const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024 * 1024;

const ROOT_NAME: &str = "view-cache";
const ROOT_MARKER: &str = ".mscanvas-view-cache-owner";
const ROOT_MARKER_CONTENT: &[u8] = b"mscanvas-view-cache\n";
const ENTRIES: &str = "entries";
const STAGING: &str = "staging";
const MANIFEST: &str = "entry.json";
const OUTPUT: &str = "view.mzML";
/// An entry's fixed names, in the order a removal takes them: the file a pin
/// holds goes first, so a pinned entry is refused before anything is removed.
const ENTRY_NAMES: [&str; 2] = [OUTPUT, MANIFEST];
const ATTEMPT_OWNER: &str = "owner.json";
const ATTEMPT_ENTRY: &str = "entry";
const ATTEMPT_SCHEMA: &str = "mscanvas.viewCache.attempt/1";
const KEY_VERSION: &str = "mscanvas-view-cache-key/1";
const MANIFEST_SCHEMA: u32 = 1;
const SOURCE_KIND: &str = "thermoRaw";
const MAX_MANIFEST_BYTES: u64 = 16 * 1024;
const MAX_ATTEMPT_OWNER_BYTES: u64 = 4096;
/// The bound on the intent and the provider release, which keeps a manifest
/// far inside its own bound.
const MAX_TEXT_BYTES: usize = 1024;

const LIST_DIRECTORY: u32 = 0x0001;
const READ_ATTRIBUTES: u32 = 0x0080;
const WRITE_ATTRIBUTES: u32 = 0x0100;
const DELETE: u32 = 0x0001_0000;
const SYNCHRONIZE: u32 = 0x0010_0000;
const SHARE_READ: u32 = 0x1;
const SHARE_WRITE: u32 = 0x2;
const SHARE_DELETE: u32 = 0x4;
const BACKUP_SEMANTICS: u32 = 0x0200_0000;
const ERROR_SHARING_VIOLATION: i32 = 32;

// ---------------------------------------------------------------------------
// The key and the manifest
// ---------------------------------------------------------------------------

/// What an entry holds: one source's bytes, converted by one `msconvert.exe`,
/// with one canonical intent (decision 7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CacheKey {
    source: Sha256Digest,
    provider: Sha256Digest,
    intent: String,
    name: String,
}

impl CacheKey {
    /// The key of these three inputs: the lowercase hex SHA-256 of the UTF-8
    /// text `mscanvas-view-cache-key/1`, `source-sha256=<hex>`,
    /// `provider-sha256=<hex>` and `intent=<intent>`, each line ended by one
    /// LF, the last included, with the digests in lowercase hex.
    ///
    /// `intent` is the caller's canonical intent, opaque here. `None` where it
    /// is not one line of at most 1 KiB without control characters -- a line
    /// break in it could spell another key's text -- or where SHA-256 is
    /// unavailable.
    pub(crate) fn new(source: Sha256Digest, provider: Sha256Digest, intent: &str) -> Option<Self> {
        if !bounded_line(intent) {
            return None;
        }
        let text = format!(
            "{KEY_VERSION}\nsource-sha256={}\nprovider-sha256={}\nintent={intent}\n",
            hex(&source),
            hex(&provider),
        );
        let name = hex(&Sha256Digest::calculate(text.as_bytes()).ok()?);
        Some(Self {
            source,
            provider,
            intent: intent.to_owned(),
            name,
        })
    }

    /// The entry's directory name.
    pub(crate) fn name(&self) -> &str {
        &self.name
    }
}

/// `entry.json`, schema 1 (decision 9). Written once, before publishing, and
/// never again. It holds no path and no file name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Manifest {
    pub(crate) schema_version: u32,
    pub(crate) key: String,
    pub(crate) source_sha256: String,
    pub(crate) source_byte_length: u64,
    pub(crate) source_kind: String,
    pub(crate) provider_release: String,
    pub(crate) provider_sha256: String,
    pub(crate) intent: String,
    pub(crate) output_sha256: String,
    pub(crate) output_byte_length: u64,
    pub(crate) created_at: String,
}

impl Manifest {
    /// Whether this is a schema-1 manifest of exactly `key`'s inputs. The
    /// inputs then hash to the key's name, which is the directory's.
    fn describes(&self, key: &CacheKey) -> bool {
        self.schema_version == MANIFEST_SCHEMA
            && self.key == key.name
            && self.source_kind == SOURCE_KIND
            && parse_hex(&self.source_sha256) == Some(key.source)
            && parse_hex(&self.provider_sha256) == Some(key.provider)
            && self.intent == key.intent
            && parse_hex(&self.output_sha256).is_some()
            && self.output_byte_length <= MAX_ENTRY_BYTES
            && bounded_line(&self.provider_release)
            && bounded_line(&self.created_at)
    }
}

/// What the caller established about the validated output it staged.
#[derive(Debug, Clone)]
pub(crate) struct StagedFacts {
    pub(crate) source_byte_length: u64,
    pub(crate) provider_release: String,
    pub(crate) output_sha256: Sha256Digest,
    pub(crate) output_byte_length: u64,
}

fn bounded_line(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_TEXT_BYTES && !text.chars().any(char::is_control)
}

/// Lowercase, as every digest in the cache is written. (`Sha256Digest`'s own
/// `Display` is uppercase.)
fn hex(digest: &Sha256Digest) -> String {
    digest
        .as_bytes()
        .iter()
        .fold(String::with_capacity(64), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}

/// A digest spelled exactly as this cache spells one, and nothing else.
fn parse_hex(text: &str) -> Option<Sha256Digest> {
    let digest: Sha256Digest = text.parse().ok()?;
    (hex(&digest) == text).then_some(digest)
}

// ---------------------------------------------------------------------------
// The root
// ---------------------------------------------------------------------------

/// Why there is no cache to use (decision 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RootRefusal {
    /// `view_cache_unavailable`: no folder was given, or none could be made.
    Unavailable,
    /// `view_cache_root_unrecognized`: something MSCanvas did not make is
    /// where the root goes, or inside it where `entries` or `staging` goes.
    /// Nothing under it was read past the marker, written or removed.
    /// A summary, eviction, Clear or sweep answers it too when the root,
    /// `entries` or `staging` stopped being a plain directory while held.
    Unrecognized,
    /// A summary's `unreadable`: `entries` or `staging` could not be listed.
    /// Nothing was removed.
    Unreadable,
}

/// One process's handle on the cache. Two processes, or two of these in one
/// process, share a root: nothing here is a flag in memory.
#[derive(Debug)]
pub(crate) struct ViewCache {
    root: PathBuf,
    cap_bytes: u64,
    /// The root, `entries` and `staging`, held so none can be renamed.
    held: [File; 3],
}

impl ViewCache {
    /// Opens the cache under `parent`, the application-local data folder,
    /// making the root whole -- with its marker -- if there is none.
    pub(crate) fn open(parent: Option<&Path>) -> Result<Self, RootRefusal> {
        Self::open_with_cap(parent, CAP_BYTES)
    }

    fn open_with_cap(parent: Option<&Path>, cap_bytes: u64) -> Result<Self, RootRefusal> {
        let parent = parent.ok_or(RootRefusal::Unavailable)?;
        let root = parent.join(ROOT_NAME);
        let held_root = match hold_directory(&root) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                make_root(parent, &root, rename_no_replace)?;
                hold_directory(&root)
            }
            held => held,
        }
        .map_err(root_refusal)?;
        match local_document::read_bounded(&root.join(ROOT_MARKER), 64) {
            Ok(Some(marker)) if marker == ROOT_MARKER_CONTENT => {}
            Err(ReadRefusal::Unreadable) => return Err(RootRefusal::Unavailable),
            _ => return Err(RootRefusal::Unrecognized),
        }
        let entries = held_subdirectory(&root, ENTRIES)?;
        let staging = held_subdirectory(&root, STAGING)?;
        Ok(Self {
            root,
            cap_bytes,
            held: [held_root, entries, staging],
        })
    }

    fn entries(&self) -> PathBuf {
        self.root.join(ENTRIES)
    }

    fn staging(&self) -> PathBuf {
        self.root.join(STAGING)
    }

    /// Whether the held directories are still plain directories. Asked first
    /// by every operation; see the module documentation.
    fn intact(&self) -> bool {
        self.held.iter().all(|held| {
            held.metadata()
                .is_ok_and(|metadata| plain_directory(&metadata))
        })
    }

    /// The names under `entries` or `staging`, after `intact`.
    fn list(&self, directory: &Path) -> Result<Vec<fs::DirEntry>, RootRefusal> {
        if !self.intact() {
            return Err(RootRefusal::Unrecognized);
        }
        fs::read_dir(directory)
            .and_then(Iterator::collect)
            .map_err(|_| RootRefusal::Unreadable)
    }
}

/// Makes the root whole or not at all (decision 6): a creation directory with
/// the marker, renamed to the root with no replacement. Losing the race to
/// another process is success; its root is then read like any other.
fn make_root(
    parent: &Path,
    root: &Path,
    rename: impl Fn(&Path, &Path) -> io::Result<()>,
) -> Result<(), RootRefusal> {
    fs::create_dir_all(parent).map_err(|_| RootRefusal::Unavailable)?;
    let creating = parent.join(format!("{ROOT_NAME}.creating-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&creating).map_err(|_| RootRefusal::Unavailable)?;
    let made = write_new(&creating.join(ROOT_MARKER), ROOT_MARKER_CONTENT)
        .map_err(|_| RootRefusal::Unavailable)
        .and_then(|()| match rename(&creating, root) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(_) => Err(RootRefusal::Unavailable),
        });
    // Absent after a rename; otherwise only this call's own creation
    // directory, holding at most the marker.
    let _ = remove_fixed(&creating, &[ROOT_MARKER], None);
    made
}

fn held_subdirectory(root: &Path, name: &str) -> Result<File, RootRefusal> {
    let path = root.join(name);
    match fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(RootRefusal::Unavailable),
    }
    hold_directory(&path).map_err(root_refusal)
}

fn root_refusal(error: io::Error) -> RootRefusal {
    if error.kind() == io::ErrorKind::NotADirectory {
        RootRefusal::Unrecognized
    } else {
        RootRefusal::Unavailable
    }
}

// ---------------------------------------------------------------------------
// Verification and the pin
// ---------------------------------------------------------------------------

/// What is at a key's place (decision 8).
#[derive(Debug)]
pub(crate) enum Lookup {
    /// Verified and pinned.
    Hit(Box<VerifiedEntry>),
    /// Nothing is there.
    Miss,
    /// An entry with only MSCanvas's names failed a check. It was removed
    /// unless `removed` says otherwise, and it was not opened.
    Damaged { removed: bool },
    /// Something MSCanvas did not make holds the place
    /// (`view_cache_entry_unrecognized`). Left exactly as found.
    Unrecognized,
    /// The checks could not be made -- the entry could not be opened or read,
    /// for instance while another process removes it. Nothing was removed and
    /// nothing is opened.
    Unreadable,
    /// The caller stopped the read (decision 10). Nothing was removed and
    /// nothing is opened.
    Cancelled,
}

/// Asked before each chunk of a cached copy is read, with the bytes read so
/// far and the file's length (`bytesRead`, `bytesTotal`); `false` stops the
/// read there.
pub(crate) type KeepGoing<'a> = &'a mut dyn FnMut(u64, u64) -> bool;

/// An entry that passed every check, pinned.
///
/// `view.mzML` is held open for reading with read sharing only, and its
/// directory without delete sharing, so no process can delete, rename or write
/// the file until this is dropped: eviction and Clear meet a sharing refusal
/// and count the entry as in use. Readers that share read access still open it.
#[derive(Debug)]
pub(crate) struct VerifiedEntry {
    _directory: File,
    _pin: File,
    manifest: Manifest,
    path: PathBuf,
}

impl VerifiedEntry {
    pub(crate) fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// The pinned file, for the open (slice 2).
    pub(crate) fn output(&self) -> PathBuf {
        self.path.join(OUTPUT)
    }

    /// Moves the entry to the back of the eviction order (decision 9).
    /// `false` where the time could not be set; the order is then stale and
    /// nothing else is affected.
    pub(crate) fn mark_opened(&self) -> bool {
        set_directory_time(&self.path, SystemTime::now())
    }
}

enum Check {
    Damaged,
    Unreadable,
    Cancelled,
}

impl ViewCache {
    /// Verifies the entry at `key`'s place, hit or not, and pins it.
    ///
    /// A plain directory holding exactly `entry.json` and `view.mzML`; a
    /// schema-1 manifest of `key`'s inputs within 16 KiB; and a regular
    /// `view.mzML` whose length and SHA-256, read through the pin in chunks
    /// that `keep_going` is asked about, are the manifest's. A damaged entry
    /// is removed -- the directory object that was checked, and no other --
    /// and never opened.
    pub(crate) fn verify(&self, key: &CacheKey, keep_going: KeepGoing<'_>) -> Lookup {
        if !self.intact() {
            return Lookup::Unreadable;
        }
        let path = self.entries().join(key.name());
        let directory = match hold_directory(&path) {
            Ok(directory) => directory,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Lookup::Miss,
            Err(error) if error.kind() == io::ErrorKind::NotADirectory => {
                return Lookup::Unrecognized;
            }
            Err(_) => return Lookup::Unreadable,
        };
        match list_fixed(&path, &ENTRY_NAMES) {
            Listing::Fixed(_) => {}
            Listing::Unrecognized => return Lookup::Unrecognized,
            Listing::Unreadable => return Lookup::Unreadable,
        }
        match check(&path, key, keep_going) {
            Ok((pin, manifest)) => Lookup::Hit(Box::new(VerifiedEntry {
                _directory: directory,
                _pin: pin,
                manifest,
                path,
            })),
            Err(Check::Unreadable) => Lookup::Unreadable,
            Err(Check::Cancelled) => Lookup::Cancelled,
            Err(Check::Damaged) => {
                // The removal holds the directory itself, checks it again, and
                // must find the object checked here: another process may have
                // removed it and published a sound entry in its place.
                let identity = local_document::object_identity_of(&directory);
                drop(directory);
                let removed = identity.is_some()
                    && matches!(
                        remove_fixed(&path, &ENTRY_NAMES, identity),
                        Removed::Gone { .. }
                    );
                Lookup::Damaged { removed }
            }
        }
    }
}

/// The pin, read in the hash's chunks, asking before each whether to go on
/// (decision 10: Cancel stops MSCanvas's own read at the next chunk).
struct Reported<'a, 'b> {
    pin: &'a File,
    read: u64,
    total: u64,
    keep_going: KeepGoing<'b>,
    stopped: bool,
}

impl io::Read for Reported<'_, '_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if !(self.keep_going)(self.read, self.total) {
            self.stopped = true;
            return Err(io::Error::other("cancelled"));
        }
        let count = io::Read::read(&mut self.pin, buffer)?;
        self.read += count as u64;
        Ok(count)
    }
}

/// The checks after the names: pin first, so nothing changes under them.
fn check(
    path: &Path,
    key: &CacheKey,
    keep_going: KeepGoing<'_>,
) -> Result<(File, Manifest), Check> {
    let pin = match OpenOptions::new()
        .read(true)
        .share_mode(SHARE_READ)
        .custom_flags(OPEN_REPARSE_POINT)
        .open(path.join(OUTPUT))
    {
        Ok(pin) => pin,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(Check::Damaged),
        Err(_) => return Err(Check::Unreadable),
    };
    let manifest = match local_document::read_bounded(&path.join(MANIFEST), MAX_MANIFEST_BYTES) {
        Ok(Some(bytes)) => {
            serde_json::from_slice::<Manifest>(&bytes).map_err(|_| Check::Damaged)?
        }
        Err(ReadRefusal::Unreadable) => return Err(Check::Unreadable),
        // Missing, over the bound, or not a plain file.
        Ok(None) | Err(_) => return Err(Check::Damaged),
    };
    if !manifest.describes(key) {
        return Err(Check::Damaged);
    }
    let metadata = pin.metadata().map_err(|_| Check::Unreadable)?;
    if !local_document::is_ordinary_file(&metadata) || metadata.len() != manifest.output_byte_length
    {
        return Err(Check::Damaged);
    }
    let mut reported = Reported {
        pin: &pin,
        read: 0,
        total: metadata.len(),
        keep_going,
        stopped: false,
    };
    // A stop is an I/O error to the hash, so the flag tells it apart.
    let digest = Sha256Digest::calculate_reader(&mut reported);
    if reported.stopped {
        return Err(Check::Cancelled);
    }
    let digest = digest.map_err(|_| Check::Unreadable)?;
    if parse_hex(&manifest.output_sha256) != Some(digest) {
        return Err(Check::Damaged);
    }
    Ok((pin, manifest))
}

// ---------------------------------------------------------------------------
// Size: eviction and Clear
// ---------------------------------------------------------------------------

/// What `entries` holds, as a summary can state it (`ViewCacheSummaryDto`).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Usage {
    /// Key-named plain directories holding only an entry's fixed names.
    pub(crate) entries: usize,
    /// Their `view.mzML` lengths, which is what the cap counts.
    pub(crate) bytes: u64,
    /// The entries a pin holds (`inUse`), and their bytes: no eviction frees
    /// them.
    pub(crate) in_use: usize,
    pub(crate) in_use_bytes: u64,
    /// Every other name under `entries`, left as found.
    pub(crate) unrecognized: usize,
}

/// What an eviction or a Clear did (`ViewCacheClearOutcomeDto`).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Removal {
    pub(crate) removed: usize,
    pub(crate) freed_bytes: u64,
    /// Pinned: a sharing refusal. Never removed.
    pub(crate) kept_in_use: usize,
    /// A removal that could not finish. What remains keeps its fixed names, so
    /// a later pass recognises it.
    pub(crate) failed: usize,
    pub(crate) unrecognized_left: usize,
}

impl Removal {
    fn count(&mut self, removed: Removed) {
        match removed {
            Removed::Gone { bytes } => {
                self.removed += 1;
                self.freed_bytes += bytes;
            }
            Removed::Absent => {}
            Removed::InUse => self.kept_in_use += 1,
            Removed::Unrecognized | Removed::Linked => self.unrecognized_left += 1,
            Removed::Failed => self.failed += 1,
        }
    }
}

struct Candidate {
    key: String,
    bytes: u64,
    opened: SystemTime,
    in_use: bool,
}

impl ViewCache {
    pub(crate) fn usage(&self) -> Result<Usage, RootRefusal> {
        let (candidates, unrecognized) = self.scan()?;
        let in_use = candidates.iter().filter(|candidate| candidate.in_use);
        Ok(Usage {
            entries: candidates.len(),
            bytes: candidates.iter().map(|candidate| candidate.bytes).sum(),
            in_use: in_use.clone().count(),
            in_use_bytes: in_use.map(|candidate| candidate.bytes).sum(),
            unrecognized,
        })
    }

    /// Removes unpinned entries, least recently opened first -- by the entry
    /// directory's last-write time, then the key -- until `bytes_to_free` bytes
    /// are freed or no entry is left (decision 9). A pinned entry is skipped.
    pub(crate) fn evict(&self, bytes_to_free: u64) -> Result<Removal, RootRefusal> {
        let (mut candidates, unrecognized) = self.scan()?;
        candidates.sort_by(|left, right| {
            left.opened
                .cmp(&right.opened)
                .then_with(|| left.key.cmp(&right.key))
        });
        let mut removal = Removal {
            unrecognized_left: unrecognized,
            ..Removal::default()
        };
        for candidate in candidates {
            if removal.freed_bytes >= bytes_to_free {
                break;
            }
            removal.count(remove_fixed(
                &self.entries().join(&candidate.key),
                &ENTRY_NAMES,
                None,
            ));
        }
        Ok(removal)
    }

    /// Decision 9's disk-space rule, for a miss `short_by` bytes short of the
    /// space it needs: when every unpinned entry together frees that much, the
    /// least recently opened are evicted until it is freed. `None` when they
    /// do not, and nothing was evicted (`view_cache_no_space`).
    ///
    /// ponytail: a pin taken between the count and the eviction frees less
    /// than counted; the caller reads the free space again either way.
    pub(crate) fn make_space(&self, short_by: u64) -> Result<Option<Removal>, RootRefusal> {
        let usage = self.usage()?;
        if usage.bytes.saturating_sub(usage.in_use_bytes) < short_by {
            return Ok(None);
        }
        self.evict(short_by).map(Some)
    }

    /// Clear view cache: every unpinned entry, then every attempt whose owner
    /// is gone. What it could not remove, and what it does not recognise, is
    /// counted and left.
    pub(crate) fn clear(&self) -> Result<Removal, RootRefusal> {
        let mut removal = self.evict(u64::MAX)?;
        let sweep = self.sweep_staging()?;
        // An attempt whose owner could not be asked about could not be
        // removed either.
        removal.failed += sweep.failed + sweep.uncertain;
        removal.unrecognized_left += sweep.unrecognized + sweep.linked;
        Ok(removal)
    }

    /// Evicts until the published total plus `incoming` fits the cap. Pinned
    /// entries may keep it above.
    fn make_room(&self, incoming: u64) -> Result<Removal, RootRefusal> {
        let total = self.usage()?.bytes;
        self.evict(
            total
                .saturating_add(incoming)
                .saturating_sub(self.cap_bytes),
        )
    }

    /// Every entry under `entries` -- a key-named plain directory holding
    /// only an entry's fixed names, as a removal requires -- and how many
    /// other names there are.
    fn scan(&self) -> Result<(Vec<Candidate>, usize), RootRefusal> {
        let mut candidates = Vec::new();
        let mut unrecognized = 0;
        for child in self.list(&self.entries())? {
            let key = child
                .file_name()
                .into_string()
                .ok()
                .filter(|name| parse_hex(name).is_some());
            let path = child.path();
            // Read from the entry itself: a directory listing's copy of the
            // time can lag behind the one eviction orders by.
            let metadata = fs::symlink_metadata(&path).ok().filter(plain_directory);
            match (key, metadata) {
                (Some(key), Some(metadata))
                    if matches!(list_fixed(&path, &ENTRY_NAMES), Listing::Fixed(_)) =>
                {
                    let output = path.join(OUTPUT);
                    let bytes = fs::symlink_metadata(&output)
                        .ok()
                        .filter(local_document::is_ordinary_file)
                        .map_or(0, |output| output.len());
                    candidates.push(Candidate {
                        key,
                        bytes,
                        opened: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        in_use: pinned(&output),
                    });
                }
                _ => unrecognized += 1,
            }
        }
        Ok((candidates, unrecognized))
    }
}

/// Whether a pin holds `output`, without removing anything. A pin shares read
/// only, so an open asking for delete access -- and sharing everything --
/// meets a sharing refusal.
///
/// ponytail: a pin taken at that instant meets the probe instead and reads as
/// unreadable once, the same transient an eviction's own open can cause.
fn pinned(output: &Path) -> bool {
    OpenOptions::new()
        .access_mode(DELETE | SYNCHRONIZE)
        .share_mode(SHARE_READ | SHARE_WRITE | SHARE_DELETE)
        .custom_flags(OPEN_REPARSE_POINT)
        .open(output)
        .is_err_and(|error| error.raw_os_error() == Some(ERROR_SHARING_VIOLATION))
}

// ---------------------------------------------------------------------------
// Staging: attempts and the sweep
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttemptOwner {
    schema: String,
    attempt_id: String,
    owner_process_id: u32,
    /// The owner's creation time, in 100 ns intervals since 1601 (UTC).
    owner_process_created: u64,
}

/// One attempt's private area under `staging`, removed whole when this is
/// dropped -- a failure, a cancel, or after publishing -- unless it is kept.
#[derive(Debug)]
pub(crate) struct Attempt {
    path: PathBuf,
    identity: Option<(u64, [u8; 16])>,
    /// `entry.json` is staged beside the output, so a publish after an
    /// occupied place does not write it again.
    manifest_staged: bool,
    kept: bool,
}

impl Attempt {
    /// Leaves the attempt in place, marker and all: a conversion whose end
    /// was not observed may still use it (decision 10). A sweep in a later
    /// session removes it once this process is gone.
    pub(crate) fn keep(mut self) {
        self.kept = true;
    }

    /// The attempt's own directory. The conversion's staging area goes beneath
    /// it (slice 2).
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Where the validated output goes before publishing: `entry\view.mzML`.
    pub(crate) fn staged_output(&self) -> PathBuf {
        self.path.join(ATTEMPT_ENTRY).join(OUTPUT)
    }
}

impl Drop for Attempt {
    fn drop(&mut self) {
        if !self.kept {
            let _ = remove_attempt(&self.path, self.identity);
        }
    }
}

/// What one sweep of `staging` found (decision 6).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Sweep {
    /// Attempts whose owner is gone, removed whole.
    pub(crate) removed: usize,
    /// Attempts of a running process, this one included: left.
    pub(crate) live: usize,
    /// Attempts whose owner could not be asked about: left.
    pub(crate) uncertain: usize,
    /// Not provably an attempt: left exactly as found.
    pub(crate) unrecognized: usize,
    /// A gone owner's attempt with a link or other reparse point below it:
    /// left whole, because no link is ever a candidate (decision 9).
    pub(crate) linked: usize,
    /// A gone owner's attempt whose removal did not finish. Its marker stays
    /// with the remainder for a later sweep.
    pub(crate) failed: usize,
}

impl ViewCache {
    /// A new attempt directory, marked as this process's before anything else
    /// is put in it. `None` where it could not be made and marked; what was
    /// made is then removed.
    pub(crate) fn begin_attempt(&self) -> Option<Attempt> {
        if !self.intact() {
            return None;
        }
        let name = uuid::Uuid::new_v4().to_string();
        let path = self.staging().join(&name);
        fs::create_dir(&path).ok()?;
        let identity = open_directory(&path, 0, SHARE_READ | SHARE_WRITE | SHARE_DELETE)
            .ok()
            .and_then(|directory| local_document::object_identity_of(&directory));
        let attempt = Attempt {
            path,
            identity,
            manifest_staged: false,
            kept: false,
        };
        let marked = this_process().is_some_and(|(owner_process_id, owner_process_created)| {
            serde_json::to_vec(&AttemptOwner {
                schema: ATTEMPT_SCHEMA.to_owned(),
                attempt_id: name,
                owner_process_id,
                owner_process_created,
            })
            .is_ok_and(|marker| write_new(&attempt.path.join(ATTEMPT_OWNER), &marker).is_ok())
        });
        let usable = identity.is_some()
            && marked
            && fs::create_dir(attempt.path.join(ATTEMPT_ENTRY)).is_ok();
        // A refused attempt is dropped here, which removes it.
        usable.then_some(attempt)
    }

    /// Removes the attempts whose owner is gone. Runs at the start of a view
    /// operation and in Clear, never at startup. An attempt of a running
    /// process, this one included, is left.
    pub(crate) fn sweep_staging(&self) -> Result<Sweep, RootRefusal> {
        let mut sweep = Sweep::default();
        for child in self.list(&self.staging())? {
            let path = child.path();
            match attempt_owner(&path) {
                Found::NotAnAttempt => sweep.unrecognized += 1,
                Found::Owned(Owner::Alive, _) => sweep.live += 1,
                Found::Unsettled | Found::Owned(Owner::Unknown, _) => sweep.uncertain += 1,
                Found::Owned(Owner::Gone, identity) => {
                    match remove_attempt(&path, Some(identity)) {
                        // Absent: another process swept it first.
                        Removed::Gone { .. } | Removed::Absent => sweep.removed += 1,
                        Removed::Linked => sweep.linked += 1,
                        // No longer the object whose marker was read.
                        Removed::Unrecognized => sweep.unrecognized += 1,
                        Removed::InUse | Removed::Failed => sweep.failed += 1,
                    }
                }
            }
        }
        Ok(sweep)
    }
}

enum Found {
    NotAnAttempt,
    /// A plain directory with an attempt's name that could not be held or
    /// identified just now: neither judged nor touched.
    Unsettled,
    Owned(Owner, (u64, [u8; 16])),
}

/// Whether `path` is provably an attempt, and whose: a plain directory named
/// by a canonical UUID whose `owner.json` reads, is this schema and names that
/// same directory. The directory is held while its marker is read, and the
/// identity read through that handle is what a removal must then find.
fn attempt_owner(path: &Path) -> Found {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return Found::NotAnAttempt;
    };
    if !uuid::Uuid::parse_str(name).is_ok_and(|id| id.to_string() == name) {
        return Found::NotAnAttempt;
    }
    let directory = match hold_directory(path) {
        Ok(directory) => directory,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotADirectory | io::ErrorKind::NotFound
            ) =>
        {
            return Found::NotAnAttempt;
        }
        Err(_) => return Found::Unsettled,
    };
    let Some(identity) = local_document::object_identity_of(&directory) else {
        return Found::Unsettled;
    };
    let marker = local_document::read_bounded(&path.join(ATTEMPT_OWNER), MAX_ATTEMPT_OWNER_BYTES)
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<AttemptOwner>(&bytes).ok())
        .filter(|marker| marker.schema == ATTEMPT_SCHEMA && marker.attempt_id == name);
    match marker {
        Some(marker) => Found::Owned(
            owner(marker.owner_process_id, marker.owner_process_created),
            identity,
        ),
        None => Found::NotAnAttempt,
    }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/// What a publish did (decision 8).
#[derive(Debug)]
pub(crate) enum Stored {
    /// This attempt's entry now holds its key's place. It is not verified yet:
    /// the caller verifies it, and a failure then is `view_cache_entry_lost`.
    Published,
    /// Something holds the key's place, and nothing was replaced. The attempt
    /// comes back unpublished, so that the caller verifies what is there as
    /// Checking cached copy, which Cancel can stop (decision 10): a hit is
    /// used and the attempt dropped; `Unrecognized` is
    /// `view_cache_entry_unrecognized`; a damaged entry it removed, or a miss,
    /// is this attempt published once more -- once, which the caller counts.
    Occupied(Attempt),
}

/// Why a publish did not go through. Nothing was published by this attempt,
/// and the attempt is removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StoreFailure {
    /// `view_cache_not_stored`, retryable.
    NotStored,
    /// `view_cache_entry_too_large`, not retryable: over the 4 GiB ceiling, or
    /// alone over the cap. Nothing was evicted for it.
    EntryTooLarge,
}

impl ViewCache {
    /// Publishes the attempt's staged output under `key`: writes `entry.json`
    /// beside it, makes room under the cap, and renames `entry` to
    /// `entries\<key>` with no replacement (decision 8, steps 4 to 6). The
    /// caller has validated the output and closed every handle to it.
    pub(crate) fn publish(
        &self,
        attempt: Attempt,
        key: &CacheKey,
        facts: &StagedFacts,
    ) -> Result<Stored, StoreFailure> {
        self.publish_with(attempt, key, facts, rename_no_replace)
    }

    fn publish_with(
        &self,
        mut attempt: Attempt,
        key: &CacheKey,
        facts: &StagedFacts,
        rename: impl Fn(&Path, &Path) -> io::Result<()>,
    ) -> Result<Stored, StoreFailure> {
        // An entry alone over the cap would leave the cache above it with no
        // pin to account for that; in production the 4 GiB ceiling is lower.
        if facts.output_byte_length > MAX_ENTRY_BYTES.min(self.cap_bytes) {
            return Err(StoreFailure::EntryTooLarge);
        }
        let staged = attempt.path.join(ATTEMPT_ENTRY);
        // Held while it is read and written, so `entry` stays this plain
        // directory; released before the rename, which it would refuse.
        let Ok(held) = hold_directory(&staged) else {
            return Err(StoreFailure::NotStored);
        };
        let names: &[&str] = if attempt.manifest_staged {
            &ENTRY_NAMES
        } else {
            &[OUTPUT]
        };
        let staged_length = fs::symlink_metadata(staged.join(OUTPUT))
            .ok()
            .filter(local_document::is_ordinary_file)
            .map(|metadata| metadata.len());
        if !self.intact()
            || !bounded_line(&facts.provider_release)
            || !matches!(list_fixed(&staged, names), Listing::Fixed(found) if found.len() == names.len())
            || staged_length != Some(facts.output_byte_length)
        {
            return Err(StoreFailure::NotStored);
        }
        if !attempt.manifest_staged {
            stage_manifest(&staged, key, facts)?;
            attempt.manifest_staged = true;
        }
        drop(held);
        self.make_room(facts.output_byte_length)
            .map_err(|_| StoreFailure::NotStored)?;
        let published = self.entries().join(key.name());
        match rename(&staged, &published) {
            Ok(()) => {
                let _ = set_directory_time(&published, SystemTime::now());
                Ok(Stored::Published)
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                Ok(Stored::Occupied(attempt))
            }
            Err(_) => Err(StoreFailure::NotStored),
        }
    }
}

/// Writes `entry.json` beside the staged output, once.
fn stage_manifest(staged: &Path, key: &CacheKey, facts: &StagedFacts) -> Result<(), StoreFailure> {
    let manifest = Manifest {
        schema_version: MANIFEST_SCHEMA,
        key: key.name.clone(),
        source_sha256: hex(&key.source),
        source_byte_length: facts.source_byte_length,
        source_kind: SOURCE_KIND.to_owned(),
        provider_release: facts.provider_release.clone(),
        provider_sha256: hex(&key.provider),
        intent: key.intent.clone(),
        output_sha256: hex(&facts.output_sha256),
        output_byte_length: facts.output_byte_length,
        created_at: crate::project::now_rfc3339(),
    };
    let written = serde_json::to_vec(&manifest)
        .is_ok_and(|bytes| write_new(&staged.join(MANIFEST), &bytes).is_ok());
    if written {
        Ok(())
    } else {
        Err(StoreFailure::NotStored)
    }
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

/// What one removal did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Removed {
    Gone {
        bytes: u64,
    },
    /// Nothing was there.
    Absent,
    /// A sharing refusal before anything was removed: a pin.
    InUse,
    /// Not something this module removes. Untouched.
    Unrecognized,
    /// An attempt holding a link or other reparse point. Left whole.
    Linked,
    Failed,
}

/// Removes a directory whose children are only plain files with `names`
/// (ignoring case, each at most once), in `names` order, then the directory.
/// Anything else in it -- a link, a subdirectory, another name -- leaves the
/// whole directory untouched. With `identity`, the directory must still be
/// that object.
fn remove_fixed(path: &Path, names: &[&str], identity: Option<(u64, [u8; 16])>) -> Removed {
    let directory = match open_directory(path, DELETE, SHARE_READ) {
        Ok(directory) => directory,
        Err(error) => return removal_refusal(&error),
    };
    if identity
        .is_some_and(|expected| local_document::object_identity_of(&directory) != Some(expected))
    {
        return Removed::Unrecognized;
    }
    let found = match list_fixed(path, names) {
        Listing::Fixed(found) => found,
        Listing::Unrecognized => return Removed::Unrecognized,
        Listing::Unreadable => return Removed::Failed,
    };
    let mut bytes = 0;
    for (index, (fixed, name)) in found.iter().enumerate() {
        let child = OpenOptions::new()
            .access_mode(DELETE | READ_ATTRIBUTES | SYNCHRONIZE)
            .share_mode(SHARE_READ | SHARE_WRITE | SHARE_DELETE)
            .custom_flags(OPEN_REPARSE_POINT)
            .open(path.join(name));
        let child = match child {
            Ok(child) => child,
            Err(error) if index == 0 => return removal_refusal(&error),
            Err(_) => return Removed::Failed,
        };
        let Ok(metadata) = child.metadata() else {
            return Removed::Failed;
        };
        if !local_document::is_ordinary_file(&metadata) {
            return if index == 0 {
                Removed::Unrecognized
            } else {
                Removed::Failed
            };
        }
        if names[*fixed] == OUTPUT {
            bytes = metadata.len();
        }
        if dispose(&child).is_err() {
            return Removed::Failed;
        }
    }
    match dispose(&directory) {
        Ok(()) => Removed::Gone { bytes },
        Err(_) => Removed::Failed,
    }
}

/// Removes an attempt directory and everything in it, its marker last, so a
/// removal that stops part way leaves a remainder a later sweep still
/// recognises. With `identity`, the directory must still be that object.
///
/// An attempt with a link or other reparse point anywhere below it, or that
/// cannot be shown to have none, is left whole with its marker: no link is
/// ever a candidate (decision 9), as `conversion_run/cleanup.rs` refuses one.
///
/// ponytail: the scan is by path, so a link planted after it is removed as
/// the link by `std::fs::remove_dir_all`, which never traverses one; nothing
/// it points at is touched. Handle-relative removal, as `cleanup.rs` does it,
/// closes that if it ever matters.
fn remove_attempt(path: &Path, identity: Option<(u64, [u8; 16])>) -> Removed {
    let directory = match open_directory(path, DELETE, SHARE_READ) {
        Ok(directory) => directory,
        Err(error) => return removal_refusal(&error),
    };
    if identity
        .is_some_and(|expected| local_document::object_identity_of(&directory) != Some(expected))
    {
        return Removed::Unrecognized;
    }
    if may_hold_a_reparse_point(path) {
        return Removed::Linked;
    }
    let Ok(children) = fs::read_dir(path) else {
        return Removed::Failed;
    };
    for child in children {
        let Ok(child) = child else {
            return Removed::Failed;
        };
        if child.file_name() == ATTEMPT_OWNER {
            continue;
        }
        let child = child.path();
        if fs::remove_file(&child).is_err() && fs::remove_dir_all(&child).is_err() {
            return Removed::Failed;
        }
    }
    match fs::remove_file(path.join(ATTEMPT_OWNER)) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => return Removed::Failed,
    }
    match dispose(&directory) {
        Ok(()) => Removed::Gone { bytes: 0 },
        Err(_) => Removed::Failed,
    }
}

/// Whether anything below `directory` is a link or other reparse point, or
/// could not be listed. Never follows one: a listing's metadata is the
/// name's own.
fn may_hold_a_reparse_point(directory: &Path) -> bool {
    let Ok(children) = fs::read_dir(directory) else {
        return true;
    };
    children.into_iter().any(|child| {
        child
            .and_then(|child| Ok((child.metadata()?, child.path())))
            .map_or(true, |(metadata, path)| {
                local_document::is_reparse_point(&metadata)
                    || (metadata.is_dir() && may_hold_a_reparse_point(&path))
            })
    })
}

fn removal_refusal(error: &io::Error) -> Removed {
    match error.kind() {
        io::ErrorKind::NotFound => Removed::Absent,
        io::ErrorKind::NotADirectory => Removed::Unrecognized,
        _ if error.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => Removed::InUse,
        _ => Removed::Failed,
    }
}

enum Listing {
    /// Each child's index in the names, and its name as found, in names order.
    Fixed(Vec<(usize, std::ffi::OsString)>),
    Unrecognized,
    Unreadable,
}

fn list_fixed(path: &Path, names: &[&str]) -> Listing {
    let Ok(children) = fs::read_dir(path) else {
        return Listing::Unreadable;
    };
    let mut found: Vec<(usize, std::ffi::OsString)> = Vec::new();
    for child in children {
        let Ok(child) = child else {
            return Listing::Unreadable;
        };
        let name = child.file_name();
        let fixed = name.to_str().and_then(|name| {
            names
                .iter()
                .position(|fixed| fixed.eq_ignore_ascii_case(name))
        });
        let plain = child
            .metadata()
            .is_ok_and(|metadata| local_document::is_ordinary_file(&metadata));
        match fixed {
            Some(fixed) if plain && !found.iter().any(|(seen, _)| *seen == fixed) => {
                found.push((fixed, name));
            }
            _ => return Listing::Unrecognized,
        }
    }
    found.sort_by_key(|(fixed, _)| *fixed);
    Listing::Fixed(found)
}

// ---------------------------------------------------------------------------
// Win32
// ---------------------------------------------------------------------------

fn plain_directory(metadata: &fs::Metadata) -> bool {
    metadata.is_dir() && !local_document::is_reparse_point(metadata)
}

/// Opens a directory on its own name, never a link's target. A name that is
/// not a plain directory, or is spelled on disk otherwise than `path`'s last
/// component, answers `NotADirectory`: NTFS opens a name ignoring case, so
/// `entries\<key>` would otherwise open a `<KEY>` that is not a key's.
fn open_directory(path: &Path, access: u32, share: u32) -> io::Result<File> {
    let directory = OpenOptions::new()
        .access_mode(access | LIST_DIRECTORY | READ_ATTRIBUTES | SYNCHRONIZE)
        .share_mode(share)
        .custom_flags(BACKUP_SEMANTICS | OPEN_REPARSE_POINT)
        .open(path)?;
    if plain_directory(&directory.metadata()?)
        && path.file_name() == Some(on_disk_name(&directory)?.as_os_str())
    {
        Ok(directory)
    } else {
        Err(io::ErrorKind::NotADirectory.into())
    }
}

/// The last component of the held object's normalized name: its spelling on
/// disk, whatever spelling opened it.
fn on_disk_name(object: &File) -> io::Result<std::ffi::OsString> {
    use std::os::windows::ffi::OsStringExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FILE_NAME_NORMALIZED, GETFINALPATHNAMEBYHANDLE_FLAGS, GetFinalPathNameByHandleW,
        VOLUME_NAME_NONE,
    };

    let mut buffer = vec![0_u16; 512];
    loop {
        // SAFETY: the handle is live for the call, and the buffer is writable
        // for the length its slice states.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                HANDLE(object.as_raw_handle()),
                &mut buffer,
                GETFINALPATHNAMEBYHANDLE_FLAGS(FILE_NAME_NORMALIZED.0 | VOLUME_NAME_NONE.0),
            )
        } as usize;
        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        // A buffer too small is answered with the length it needs.
        if length < buffer.len() {
            buffer.truncate(length);
            break;
        }
        buffer.resize(length, 0);
    }
    let name = buffer.rsplit(|unit| *unit == u16::from(b'\\')).next();
    Ok(std::ffi::OsString::from_wide(name.unwrap_or_default()))
}

/// Holds a directory so its name cannot be renamed or deleted while held.
/// Write sharing stays open, so entries can be created and renamed into it.
fn hold_directory(path: &Path) -> io::Result<File> {
    open_directory(path, 0, SHARE_READ | SHARE_WRITE)
}

fn set_directory_time(path: &Path, time: SystemTime) -> bool {
    open_directory(
        path,
        WRITE_ATTRIBUTES,
        SHARE_READ | SHARE_WRITE | SHARE_DELETE,
    )
    .and_then(|directory| directory.set_modified(time))
    .is_ok()
}

/// Deletes the object a handle holds: with POSIX semantics, so the name goes
/// at once, or where the volume lacks them, when the caller closes the handle.
fn dispose(object: &File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO,
        FILE_DISPOSITION_INFO_EX, FILE_DISPOSITION_INFO_EX_FLAGS, FileDispositionInfo,
        FileDispositionInfoEx, SetFileInformationByHandle,
    };

    let handle = HANDLE(object.as_raw_handle());
    let posix = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_INFO_EX_FLAGS(
            FILE_DISPOSITION_FLAG_DELETE.0 | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS.0,
        ),
    };
    // SAFETY: the handle is live for the call, and the buffer is a fully
    // initialized FILE_DISPOSITION_INFO_EX of the size passed with it.
    let disposed = unsafe {
        SetFileInformationByHandle(
            handle,
            FileDispositionInfoEx,
            (&raw const posix).cast(),
            size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    };
    if disposed.is_ok() {
        return Ok(());
    }
    let legacy = FILE_DISPOSITION_INFO { DeleteFile: true };
    // SAFETY: as above, for FILE_DISPOSITION_INFO.
    unsafe {
        SetFileInformationByHandle(
            handle,
            FileDispositionInfo,
            (&raw const legacy).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    }
    .map_err(|error| io::Error::from_raw_os_error(error.code().0 & 0xFFFF))
}

/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`: an existing name, file
/// or directory, refuses the rename (`AlreadyExists`) and is never replaced.
/// `std::fs::rename` replaces, so it is never used here.
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use windows::Win32::Storage::FileSystem::{MOVE_FILE_FLAGS, MoveFileExW};
    use windows::core::HSTRING;

    // SAFETY: both names are owned, terminated wide strings that outlive the
    // call.
    unsafe { MoveFileExW(&HSTRING::from(from), &HSTRING::from(to), MOVE_FILE_FLAGS(0)) }
        .map_err(|error| io::Error::from_raw_os_error(error.code().0 & 0xFFFF))
}
