//! Bounded discovery of mzML candidates under one folder the user chose.
//!
//! A folder is an authority boundary, not a list of filenames. The user pointed
//! at one root; they did not point at every place a junction inside it happens
//! to lead. Everything here exists to keep those two things apart:
//!
//! - a reparse entry is never followed, never entered and never offered, so a
//!   traversal cannot leave the tree by an ordinary unprivileged link;
//! - a child is opened and its identity compared against what its parent
//!   enumerated, so a directory swapped underneath the walk is refused rather
//!   than descended into;
//! - every dimension of the walk is bounded by a named limit, because a folder
//!   can hold millions of entries before the thousandth candidate;
//! - the order is this application's, not the filesystem's, so the same tree
//!   discovers the same way twice.
//!
//! What this module does *not* do is as deliberate. It accepts nothing, leases
//! nothing, registers nothing, and asks no backend anything: it answers "which
//! paths under here are worth offering to acceptance", and acceptance
//! (`selection::accept_mzml_file`) re-decides every one of them. Nothing here is
//! serialisable and nothing here is reachable from a command; see ADR 0007.

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::path::{Path, PathBuf};

use super::selection::{FileIdentity, has_mzml_extension};

/// How deep the walk may go, counting the chosen root as zero.
pub(super) const MAX_DISCOVERY_DEPTH: u32 = 32;
/// How many entries an enumeration may hand back in total across the walk.
pub(super) const MAX_DISCOVERY_ENTRIES: u64 = 200_000;
/// How many directories may be entered, the chosen root included.
pub(super) const MAX_DISCOVERY_DIRECTORIES: u64 = 20_000;
/// How many candidates may be collected. Deliberately the workspace capacity:
/// collecting more would be proposing files no session could hold.
pub(super) const MAX_DISCOVERY_CANDIDATES: usize = 1_024;

/// The limits one walk runs under.
///
/// A value rather than constants at the call site, so a test can bound a walk
/// at three entries without building a tree of two hundred thousand.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct DiscoveryBudget {
    pub(super) max_depth: u32,
    pub(super) max_entries: u64,
    pub(super) max_directories: u64,
    pub(super) max_candidates: usize,
}

impl Default for DiscoveryBudget {
    fn default() -> Self {
        Self {
            max_depth: MAX_DISCOVERY_DEPTH,
            max_entries: MAX_DISCOVERY_ENTRIES,
            max_directories: MAX_DISCOVERY_DIRECTORIES,
            max_candidates: MAX_DISCOVERY_CANDIDATES,
        }
    }
}

/// Why a walk stopped short of describing everything under the root.
///
/// Four reasons rather than one boolean: which limit ran out is what tells a
/// user whether to choose a narrower folder or whether nothing they do will
/// help. The order is the declaration order, and results report them sorted, so
/// two runs of the same walk describe themselves identically.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum DiscoveryLimit {
    Depth,
    Entries,
    Directories,
    Candidates,
}

/// One path worth offering to acceptance, and where it sat under the root.
///
/// The relative components exist for one future purpose: two files called
/// `sample.mzML` in different subdirectories are different acquisitions and a
/// roster that shows both as `sample.mzML` cannot be chosen between. ADR 0007
/// approves showing the relative location for colliding names only, and this is
/// what makes that possible later. It crosses no boundary in this slice.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct DiscoveredCandidate {
    path: PathBuf,
    relative: Vec<OsString>,
    identity: FileIdentity,
}

impl DiscoveredCandidate {
    /// The path acceptance will be given. Never leaves the preview module.
    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    /// What the parent directory said this file was, when it said this name.
    ///
    /// The name and the identity come out of one enumeration record, so they
    /// describe one object rather than two lookups. Acceptance re-opens the
    /// path and compares: between the walk seeing the name and acceptance
    /// resolving it, the name can be made to mean a different file, and a
    /// candidate is only ever a proposal about the object that was found.
    pub(super) fn identity(&self) -> FileIdentity {
        self.identity
    }

    /// Where the file sat under the chosen root, root name excluded.
    ///
    /// Never absolute, never containing `.` or `..`, and never naming the root
    /// itself: it is only what would have to be said to tell two identically
    /// named files apart.
    pub(super) fn relative_components(&self) -> &[OsString] {
        &self.relative
    }
}

impl fmt::Debug for DiscoveredCandidate {
    /// Opaque, like every other path-bearing value in this boundary. A
    /// candidate is a path and a location under the user's folder; printing
    /// either into a log, a panic or an assertion is the leak this module
    /// exists to prevent.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-discovered-candidate>")
    }
}

/// What the walk saw, in counts that name no file and no directory.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct DiscoverySummary {
    pub(super) entries_inspected: u64,
    pub(super) directories_entered: u64,
    pub(super) candidate_count: usize,
    /// Entries refused for carrying a reparse tag: junctions, symlinks, mount
    /// points, cloud placeholders and every other tag alike. A walk with any of
    /// these is incomplete, and the count is how the visible slice will say so.
    pub(super) skipped_reparse_count: u64,
    /// Entries and subtrees the filesystem would not describe.
    pub(super) inaccessible_entry_count: u64,
}

/// Everything one walk established.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DiscoveryResult {
    candidates: Vec<DiscoveredCandidate>,
    summary: DiscoverySummary,
    limits: Vec<DiscoveryLimit>,
}

impl DiscoveryResult {
    pub(super) fn candidates(&self) -> &[DiscoveredCandidate] {
        &self.candidates
    }

    pub(super) fn summary(&self) -> DiscoverySummary {
        self.summary
    }

    /// Which limits were reached, sorted and without repeats.
    pub(super) fn limits(&self) -> &[DiscoveryLimit] {
        &self.limits
    }

    /// Whether anything under the root may have gone undescribed.
    ///
    /// A limit, a refused reparse entry or an unreadable subtree all mean the
    /// same thing to a reader: this is not the whole folder. Saying it once,
    /// here, is what stops the visible slice reporting a partial answer as a
    /// complete one.
    pub(super) fn is_complete(&self) -> bool {
        self.limits.is_empty()
            && self.summary.skipped_reparse_count == 0
            && self.summary.inaccessible_entry_count == 0
    }
}

/// Why a walk could not start at all.
///
/// Distinct from anything a walk *survives*: an unreadable subdirectory is a
/// count, while an unreadable root leaves nothing to have found.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DiscoveryErrorKind {
    /// This platform has no folder discovery. See ADR 0007's platform posture.
    ///
    /// Kept on every platform rather than compiled out on Windows, so the
    /// boundary that maps kinds to what a user is told has one arm per kind
    /// whichever target it is built for. Nothing constructs it here.
    #[cfg_attr(
        all(windows, not(test)),
        expect(
            dead_code,
            reason = "only the non-Windows entry point constructs it; the mapping is total on every target"
        )
    )]
    PlatformUnavailable,
    RootUnavailable,
    RootNotDirectory,
    /// The chosen root is itself a link. The user chose a name, and following
    /// it would walk somewhere they did not choose.
    RootReparsePoint,
    RemoteRootUnsupported,
    RootEnumerationFailed,
    /// The filesystem answered in a shape the documented layout does not allow.
    FilesystemInvariantFailed,
}

impl DiscoveryErrorKind {
    /// The stable identifier this kind is known by, for a future transfer
    /// object to map without inventing its own spelling.
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::PlatformUnavailable => "platform_unavailable",
            Self::RootUnavailable => "root_unavailable",
            Self::RootNotDirectory => "root_not_directory",
            Self::RootReparsePoint => "root_reparse_point",
            Self::RemoteRootUnsupported => "remote_root_unsupported",
            Self::RootEnumerationFailed => "root_enumeration_failed",
            Self::FilesystemInvariantFailed => "filesystem_invariant_failed",
        }
    }
}

impl fmt::Debug for DiscoveryErrorKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A refusal, carrying a stable kind and nothing else.
///
/// Deliberately not `PreviewErrorDto`: that type is what crosses the boundary,
/// and this foundation has no boundary to cross. It also carries no
/// `std::io::Error`, because an OS error message on Windows routinely contains
/// the path it failed on.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct DiscoveryError {
    kind: DiscoveryErrorKind,
}

impl DiscoveryError {
    pub(super) fn new(kind: DiscoveryErrorKind) -> Self {
        Self { kind }
    }

    pub(super) fn kind(self) -> DiscoveryErrorKind {
        self.kind
    }
}

impl fmt::Debug for DiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "DiscoveryError({})", self.kind.as_str())
    }
}

/// What one directory said about one of its children.
///
/// Attributes and identity come from the same enumeration record as the name,
/// so the three describe one entry rather than three separate lookups.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct DirectoryEntry {
    pub(super) name: OsString,
    pub(super) is_directory: bool,
    pub(super) is_reparse_point: bool,
    pub(super) identity: FileIdentity,
}

impl fmt::Debug for DirectoryEntry {
    /// Opaque, for the same reason a candidate is. An entry holds a filename
    /// out of the user's folder, and a derived `Debug` would put it in the
    /// first log line or assertion message anyone adds. Nothing formats one
    /// today; this is what stops the first one that does from leaking.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-directory-entry>")
    }
}

/// What happened when the walk tried to open a child directory it had decided
/// to descend into.
pub(super) enum ChildDirectory<D> {
    Opened(D),
    /// The filesystem would not open or describe it.
    Inaccessible,
    /// It opened, but it is no longer the object the parent enumerated. A name
    /// can be re-pointed between the two, and the identity is what notices.
    IdentityChanged,
}

/// The filesystem, reduced to what a traversal needs of it.
///
/// A trait so the policy above — ordering, budgets, cycles, refusals — can be
/// tested exhaustively and deterministically against trees no real filesystem
/// would let a test build, including ones that answer inconsistently.
pub(super) trait DirectorySource {
    /// A directory the source is holding open.
    type Directory;

    /// Opens the chosen root, establishing every posture that can refuse it.
    fn open_root(&self, root: &Path) -> Result<Self::Directory, DiscoveryError>;

    /// The identity of an open directory, used as the visited key.
    fn identity(&self, directory: &Self::Directory) -> FileIdentity;

    /// Every immediate child of an open directory, `.` and `..` excluded, up to
    /// `limit` of them.
    ///
    /// The limit is not advice. A directory can hold millions of entries, and a
    /// source that read them all before the caller looked at the first would
    /// make the entry budget a statement about counting rather than about cost
    /// — the allocation would already have happened. Returning fewer than
    /// `limit` means the directory really had no more.
    fn entries(
        &self,
        directory: &Self::Directory,
        limit: u64,
    ) -> Result<Vec<DirectoryEntry>, DiscoveryError>;

    /// Opens a child of an open directory, refusing anything that is no longer
    /// the entry the parent described.
    fn open_child(
        &self,
        parent: &Self::Directory,
        parent_path: &Path,
        entry: &DirectoryEntry,
    ) -> ChildDirectory<Self::Directory>;
}

/// The sort key: UTF-16 code units, as Windows stores a name.
///
/// Ordinal rather than locale-aware and deliberately not case-folded. Which
/// files a user gets and in what order must not depend on where the machine
/// thinks it is, and NTFS already decided that two names differing only by case
/// are one file, so folding here would only pretend to break ties that cannot
/// exist.
fn ordinal_key(name: &OsStr) -> Vec<u16> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        name.encode_wide().collect()
    }
    #[cfg(not(windows))]
    {
        name.to_string_lossy().encode_utf16().collect()
    }
}

/// One directory waiting to be walked.
struct Pending<D> {
    directory: D,
    path: PathBuf,
    relative: Vec<OsString>,
    depth: u32,
}

/// Accumulates the reasons a walk fell short, once each and in a stable order.
#[derive(Default)]
struct Limits(Vec<DiscoveryLimit>);

impl Limits {
    fn record(&mut self, limit: DiscoveryLimit) {
        if !self.0.contains(&limit) {
            self.0.push(limit);
        }
    }

    fn finish(mut self) -> Vec<DiscoveryLimit> {
        self.0.sort_unstable();
        self.0
    }
}

/// Walks one chosen root and returns the mzML candidates under it.
///
/// The traversal is an explicit stack rather than recursion: how much stack the
/// application uses is not a decision a directory tree gets to make, and a
/// hostile or merely deep one would otherwise make it.
pub(super) fn discover<S: DirectorySource>(
    source: &S,
    root: &Path,
    budget: DiscoveryBudget,
) -> Result<DiscoveryResult, DiscoveryError> {
    let root_directory = source.open_root(root)?;

    let mut summary = DiscoverySummary::default();
    let mut limits = Limits::default();
    let mut candidates: Vec<DiscoveredCandidate> = Vec::new();
    let mut visited: HashSet<FileIdentity> = HashSet::new();

    let mut stack = vec![Pending {
        directory: root_directory,
        path: root.to_path_buf(),
        relative: Vec::new(),
        depth: 0,
    }];
    // The root is a directory the walk enters, and counting it is what makes
    // "at most one directory" mean the root alone.
    summary.directories_entered = 1;
    visited.insert(source.identity(&stack[0].directory));

    'walk: while let Some(pending) = stack.pop() {
        // One more than the walk can still afford. The extra is what lets the
        // loop below see that the directory had more to give and record the
        // limit, without the source having to materialise the rest of a
        // directory holding millions of names to prove it.
        let affordable = budget
            .max_entries
            .saturating_sub(summary.entries_inspected)
            .saturating_add(1);
        let entries = match source.entries(&pending.directory, affordable) {
            Ok(entries) => entries,
            Err(error) => {
                if pending.depth == 0 {
                    return Err(error);
                }
                // One unreadable directory is not a reason to discard
                // everything else the user asked about.
                summary.inaccessible_entry_count += 1;
                continue;
            }
        };

        let mut level_files: Vec<(Vec<u16>, DirectoryEntry)> = Vec::new();
        let mut level_directories: Vec<(Vec<u16>, DirectoryEntry)> = Vec::new();
        let mut entries_exhausted = false;

        for entry in entries {
            if summary.entries_inspected >= budget.max_entries {
                // The level's own work is finished below before the walk ends:
                // an entry that was inspected and classified has been paid for,
                // and throwing its candidate away would charge the budget twice.
                limits.record(DiscoveryLimit::Entries);
                entries_exhausted = true;
                break;
            }
            summary.entries_inspected += 1;

            if entry.is_reparse_point {
                // Every tag alike: junction, symlink, mount point, cloud
                // placeholder. Following one leaves the folder the user chose,
                // and telling the harmless tags from the rest is its own
                // evidence question.
                summary.skipped_reparse_count += 1;
                continue;
            }

            let key = ordinal_key(&entry.name);
            if entry.is_directory {
                level_directories.push((key, entry));
            } else if has_mzml_extension(Path::new(&entry.name)) {
                level_files.push((key, entry));
            }
        }

        // The files of a level before the level's subdirectories, each group in
        // ordinal name order. The filesystem's own order is not a contract:
        // measured on NTFS it is neither sorted nor ordinal.
        level_files.sort_by(|left, right| left.0.cmp(&right.0));
        for (_, entry) in level_files {
            if candidates.len() >= budget.max_candidates {
                limits.record(DiscoveryLimit::Candidates);
                break 'walk;
            }
            let mut relative = pending.relative.clone();
            relative.push(entry.name.clone());
            candidates.push(DiscoveredCandidate {
                path: pending.path.join(&entry.name),
                relative,
                identity: entry.identity,
            });
        }

        if entries_exhausted {
            // Nothing below can be inspected either, so draining the stack
            // would cost enumerations that could add nothing.
            break 'walk;
        }

        if pending.depth >= budget.max_depth {
            if !level_directories.is_empty() {
                // The subtree is skipped, not the walk: eligible siblings
                // elsewhere in the tree still have a claim on being described.
                limits.record(DiscoveryLimit::Depth);
            }
            continue;
        }

        level_directories.sort_by(|left, right| left.0.cmp(&right.0));
        let mut children = Vec::with_capacity(level_directories.len());
        for (_, entry) in level_directories {
            if summary.directories_entered >= budget.max_directories {
                // No further directory is entered, and the ones already entered
                // are still walked: they were counted against this very budget,
                // and dropping them would spend the allowance on nothing.
                limits.record(DiscoveryLimit::Directories);
                break;
            }

            match source.open_child(&pending.directory, &pending.path, &entry) {
                ChildDirectory::Opened(directory) => {
                    // Identity rather than path: a walk that trusted names
                    // would re-enter a directory reached twice, and a cycle
                    // would never end. Every reparse entry is already refused,
                    // so this is the second lock on the same door.
                    //
                    // Skipping the second name is not incompleteness and is not
                    // counted as any. One directory reached by two names holds
                    // one set of files, and the first name already described
                    // every one of them; the second would offer the same
                    // acquisitions again under a different spelling, which
                    // registration would refuse as duplicates anyway. On
                    // Windows this is unreachable regardless: a second name for
                    // a directory is a mount point or a link, and both carry a
                    // reparse tag that was refused before this point.
                    if !visited.insert(source.identity(&directory)) {
                        continue;
                    }
                    summary.directories_entered += 1;
                    let mut relative = pending.relative.clone();
                    relative.push(entry.name.clone());
                    children.push(Pending {
                        directory,
                        path: pending.path.join(&entry.name),
                        relative,
                        depth: pending.depth + 1,
                    });
                }
                ChildDirectory::Inaccessible | ChildDirectory::IdentityChanged => {
                    summary.inaccessible_entry_count += 1;
                }
            }
        }

        // Pushed in reverse so popping walks them in ascending name order.
        for child in children.into_iter().rev() {
            stack.push(child);
        }
    }

    summary.candidate_count = candidates.len();
    Ok(DiscoveryResult {
        candidates,
        summary,
        limits: limits.finish(),
    })
}

#[cfg(windows)]
mod windows;

/// Discovers mzML candidates under a folder the user chose.
///
/// The one entry point. On Windows it walks the real filesystem through a live
/// directory handle; elsewhere it refuses, because the guarantees this module
/// makes rest on a no-following open that this project has no dependency-free
/// way to make on another platform. ADR 0006 made the same call for identity
/// leases and for the same reason.
#[cfg(windows)]
pub(super) fn discover_mzml_candidates(
    root: &Path,
    budget: DiscoveryBudget,
) -> Result<DiscoveryResult, DiscoveryError> {
    discover(&windows::WindowsDirectorySource, root, budget)
}

#[cfg(not(windows))]
pub(super) fn discover_mzml_candidates(
    _root: &Path,
    _budget: DiscoveryBudget,
) -> Result<DiscoveryResult, DiscoveryError> {
    Err(DiscoveryError::new(DiscoveryErrorKind::PlatformUnavailable))
}

#[cfg(test)]
mod tests;
