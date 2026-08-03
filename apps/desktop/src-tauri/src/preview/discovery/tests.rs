//! What the traversal promises, tested against a filesystem that can be told
//! to misbehave.
//!
//! The policy tests run everywhere and use a fake source, so a tree that
//! answers inconsistently, presents a cycle, or hands its entries back in a
//! different order every time is an ordinary test rather than something to hope
//! never happens. The Windows tests below them use real directories, because
//! the one claim a fake cannot make is that a junction planted in a real folder
//! does not take the walk out of it.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::*;

/// A filesystem the test writes.
///
/// Keyed by identity rather than by path, so the same directory reached twice
/// is genuinely the same directory and a cycle is expressible.
#[derive(Default)]
struct FakeSource {
    /// What each directory hands back, in the order it hands it back.
    entries: HashMap<FileIdentity, Vec<DirectoryEntry>>,
    /// Directories whose enumeration fails.
    unreadable: HashMap<FileIdentity, u64>,
    /// Children whose open fails.
    unopenable: Vec<FileIdentity>,
    /// Children that open as something other than what the parent described.
    switched: Vec<FileIdentity>,
    /// A refusal the root open produces instead of succeeding.
    root_error: Option<DiscoveryErrorKind>,
    /// Every entry allowance the walk asked this source to respect, in order.
    limits_asked: RefCell<Vec<u64>>,
}

#[derive(Clone, Copy)]
struct FakeDirectory {
    identity: FileIdentity,
}

/// Identities are minted from a single number so a test can say "directory 3"
/// and mean it. The volume is constant: every fake tree is one volume.
fn identity(key: u128) -> FileIdentity {
    FileIdentity::new(7, key.to_le_bytes())
}

impl FakeSource {
    fn new() -> Self {
        Self::default()
    }

    /// Gives a directory its children.
    fn directory(mut self, key: u128, entries: Vec<DirectoryEntry>) -> Self {
        self.entries.insert(identity(key), entries);
        self
    }

    fn unreadable(mut self, key: u128) -> Self {
        self.unreadable.insert(identity(key), 0);
        self
    }

    fn unreadable_after(mut self, key: u128, entries_inspected: u64) -> Self {
        self.unreadable.insert(identity(key), entries_inspected);
        self
    }

    fn unopenable(mut self, key: u128) -> Self {
        self.unopenable.push(identity(key));
        self
    }

    fn switched(mut self, key: u128) -> Self {
        self.switched.push(identity(key));
        self
    }

    fn root_error(mut self, kind: DiscoveryErrorKind) -> Self {
        self.root_error = Some(kind);
        self
    }
}

impl DirectorySource for FakeSource {
    type Directory = FakeDirectory;

    fn open_root(&self, _root: &Path) -> Result<Self::Directory, DiscoveryError> {
        match self.root_error {
            Some(kind) => Err(DiscoveryError::new(kind)),
            // Directory 1 is the root in every fake tree here.
            None => Ok(FakeDirectory {
                identity: identity(1),
            }),
        }
    }

    fn identity(&self, directory: &Self::Directory) -> FileIdentity {
        directory.identity
    }

    fn entries(
        &self,
        directory: &Self::Directory,
        limit: u64,
    ) -> Result<Vec<DirectoryEntry>, DiscoveryError> {
        if let Some(entries_inspected) = self.unreadable.get(&directory.identity) {
            return Err(
                DiscoveryError::new(DiscoveryErrorKind::RootEnumerationFailed)
                    .with_materialized_entries(*entries_inspected),
            );
        }
        self.limits_asked.borrow_mut().push(limit);
        let mut entries = self
            .entries
            .get(&directory.identity)
            .cloned()
            .unwrap_or_default();
        // Honoured rather than ignored, so a test that says "this directory
        // holds a million names" costs the walk what the real adapter would
        // charge it and not a byte more.
        entries.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
        Ok(entries)
    }

    fn open_child(
        &self,
        _parent: &Self::Directory,
        _parent_path: &Path,
        entry: &DirectoryEntry,
    ) -> ChildDirectory<Self::Directory> {
        if self.unopenable.contains(&entry.identity) {
            return ChildDirectory::Inaccessible;
        }
        if self.switched.contains(&entry.identity) {
            return ChildDirectory::IdentityChanged;
        }
        ChildDirectory::Opened(FakeDirectory {
            identity: entry.identity,
        })
    }
}

fn file(name: &str, key: u128) -> DirectoryEntry {
    DirectoryEntry {
        name: OsString::from(name),
        is_directory: false,
        is_reparse_point: false,
        identity: identity(key),
    }
}

fn directory(name: &str, key: u128) -> DirectoryEntry {
    DirectoryEntry {
        name: OsString::from(name),
        is_directory: true,
        is_reparse_point: false,
        identity: identity(key),
    }
}

fn link(name: &str, key: u128, is_directory: bool) -> DirectoryEntry {
    DirectoryEntry {
        name: OsString::from(name),
        is_directory,
        is_reparse_point: true,
        identity: identity(key),
    }
}

fn root() -> PathBuf {
    PathBuf::from("R")
}

fn walk(source: &FakeSource) -> DiscoveryResult {
    discover(source, &root(), DiscoveryBudget::default()).expect("the fake root opens")
}

/// Relative locations as a test can read them, `\` separated.
fn located(result: &DiscoveryResult) -> Vec<String> {
    result
        .candidates()
        .iter()
        .map(|candidate| {
            candidate
                .relative_components()
                .iter()
                .map(|component| component.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("\\")
        })
        .collect()
}

#[test]
fn an_empty_root_discovers_nothing_and_is_complete() {
    let result = walk(&FakeSource::new().directory(1, vec![]));

    assert!(result.candidates().is_empty());
    assert!(result.is_complete());
    assert_eq!(result.summary().directories_entered, 1);
    assert_eq!(result.summary().entries_inspected, 0);
}

#[test]
fn only_mzml_files_become_candidates() {
    let result = walk(&FakeSource::new().directory(
        1,
        vec![
            file("notes.txt", 2),
            file("sample.mzML", 3),
            file("run.mzXML", 4),
            file("no-extension", 5),
        ],
    ));

    assert_eq!(located(&result), vec!["sample.mzML"]);
    // Everything was still looked at, which is what the budget counts.
    assert_eq!(result.summary().entries_inspected, 4);
}

#[test]
fn discovery_offers_every_spelling_of_the_extension() {
    // Discovery proposes and acceptance decides, but the two must agree about
    // what an mzML name is or a folder would offer files the picker refuses.
    // This half pins what discovery offers; the real-filesystem test named
    // `what_discovery_offers_is_what_acceptance_takes` pins that acceptance
    // answers the same way, by actually calling it.
    let result = walk(&FakeSource::new().directory(
        1,
        vec![
            file("upper.MZML", 2),
            file("mixed.MzMl", 3),
            file("lower.mzml", 4),
        ],
    ));

    assert_eq!(result.candidates().len(), 3);
    for name in ["upper.MZML", "mixed.MzMl", "lower.mzml"] {
        assert!(has_mzml_extension(Path::new(name)), "{name}");
    }
    assert!(!has_mzml_extension(Path::new("run.mzXML")));
}

#[test]
fn a_candidate_carries_the_identity_its_parent_described_it_by() {
    // Discovery proposes a path; acceptance resolves that path again. Between
    // the two, the name can be made to mean a different file. Carrying the
    // identity the enumeration record gave is what lets acceptance notice --
    // and it has to be that record's own identity, not something looked up
    // afterwards, or it would describe whatever the name means later.
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![file("top.mzML", 40), directory("A", 2)])
            .directory(2, vec![file("inner.mzML", 41)]),
    );

    assert_eq!(located(&result), vec!["top.mzML", "A\\inner.mzML"]);
    assert_eq!(result.candidates()[0].identity(), identity(40));
    assert_eq!(result.candidates()[1].identity(), identity(41));
}

#[test]
fn two_files_of_one_name_carry_the_two_identities_that_tell_them_apart() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("A", 2), directory("B", 3)])
            .directory(2, vec![file("sample.mzML", 50)])
            .directory(3, vec![file("sample.mzML", 51)]),
    );

    let identities: Vec<_> = result
        .candidates()
        .iter()
        .map(super::DiscoveredCandidate::identity)
        .collect();
    assert_eq!(identities, vec![identity(50), identity(51)]);
    assert_ne!(identities[0], identities[1]);
}

#[test]
fn a_zero_byte_file_is_still_a_candidate() {
    // Discovery does not read a file, so it has nothing to say about one being
    // empty. Acceptance and the backend answer that later.
    let result = walk(&FakeSource::new().directory(1, vec![file("empty.mzML", 2)]));

    assert_eq!(located(&result), vec!["empty.mzML"]);
}

#[test]
fn files_of_a_level_come_before_the_files_below_it() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("A", 2), file("top.mzML", 3)])
            .directory(2, vec![file("inner.mzML", 4)]),
    );

    assert_eq!(located(&result), vec!["top.mzML", "A\\inner.mzML"]);
}

#[test]
fn each_level_is_ordered_by_utf16_code_unit() {
    let result = walk(&FakeSource::new().directory(
        1,
        vec![
            file("zeta.mzML", 2),
            file("_under.mzML", 3),
            file("Alpha.mzML", 4),
            file("beta.mzML", 5),
        ],
    ));

    // Ordinal: capitals before `_` (0x5F) before lower case. Not alphabetical,
    // and deliberately not case-folded.
    assert_eq!(
        located(&result),
        vec!["Alpha.mzML", "_under.mzML", "beta.mzML", "zeta.mzML"]
    );
}

#[test]
fn numeric_names_sort_ordinally_rather_than_naturally() {
    // The roster's *view* sorts naturally, so `sample-2` reads before
    // `sample-10` on screen. Discovery is not the view: it produces one stable
    // sequence, and mixing a second ordering idea in here would make the
    // registry's order depend on which one ran.
    let result = walk(&FakeSource::new().directory(
        1,
        vec![
            file("s-10.mzML", 2),
            file("s-2.mzML", 3),
            file("s-1.mzML", 4),
        ],
    ));

    assert_eq!(located(&result), vec!["s-1.mzML", "s-10.mzML", "s-2.mzML"]);
}

#[test]
fn directories_are_walked_in_ordinal_order() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("B", 3), directory("A", 2)])
            .directory(2, vec![file("a.mzML", 4)])
            .directory(3, vec![file("b.mzML", 5)]),
    );

    assert_eq!(located(&result), vec!["A\\a.mzML", "B\\b.mzML"]);
}

#[test]
fn unicode_names_are_ordered_and_carried_intact() {
    let result = walk(&FakeSource::new().directory(
        1,
        vec![
            file("éclair.mzML", 2),
            file("ａfullwidth.mzML", 3),
            file("ascii.mzML", 4),
        ],
    ));

    assert_eq!(
        located(&result),
        vec!["ascii.mzML", "éclair.mzML", "ａfullwidth.mzML"]
    );
}

#[test]
fn the_same_filename_under_two_directories_keeps_both_locations() {
    // The reason the relative components exist at all: two acquisitions, one
    // display name, and nothing else to tell them apart.
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("A", 2), directory("B", 3)])
            .directory(2, vec![file("sample.mzML", 4)])
            .directory(3, vec![file("sample.mzML", 5)]),
    );

    assert_eq!(located(&result), vec!["A\\sample.mzML", "B\\sample.mzML"]);
    for candidate in result.candidates() {
        let components = candidate.relative_components();
        assert_eq!(components.len(), 2);
        assert!(!components.iter().any(|part| part == "." || part == ".."));
        assert!(!components.iter().any(|part| part == "R"));
        assert!(!Path::new(components.first().expect("a first component")).is_absolute());
    }
}

#[test]
fn the_order_does_not_depend_on_the_order_the_filesystem_answers_in() {
    let forwards = FakeSource::new()
        .directory(
            1,
            vec![directory("A", 2), directory("B", 3), file("t.mzML", 6)],
        )
        .directory(2, vec![file("a.mzML", 4)])
        .directory(3, vec![file("b.mzML", 5)]);
    let backwards = FakeSource::new()
        .directory(
            1,
            vec![file("t.mzML", 6), directory("B", 3), directory("A", 2)],
        )
        .directory(3, vec![file("b.mzML", 5)])
        .directory(2, vec![file("a.mzML", 4)]);

    assert_eq!(located(&walk(&forwards)), located(&walk(&backwards)));
    assert_eq!(
        located(&walk(&forwards)),
        vec!["t.mzML", "A\\a.mzML", "B\\b.mzML"]
    );
}

#[test]
fn repeating_a_walk_over_an_unchanged_tree_answers_identically() {
    let source = FakeSource::new()
        .directory(1, vec![directory("A", 2), file("t.mzML", 5)])
        .directory(2, vec![file("x.mzML", 3), file("y.mzML", 4)]);

    let first = walk(&source);
    let second = walk(&source);

    assert_eq!(located(&first), located(&second));
    assert_eq!(first.summary(), second.summary());
    assert_eq!(first.limits(), second.limits());
}

// --- authority ------------------------------------------------------------

#[test]
fn a_reparse_root_is_refused_before_anything_is_walked() {
    let error = discover(
        &FakeSource::new().root_error(DiscoveryErrorKind::RootReparsePoint),
        &root(),
        DiscoveryBudget::default(),
    )
    .expect_err("a link root is refused");

    assert_eq!(error.kind(), DiscoveryErrorKind::RootReparsePoint);
    assert_eq!(error.usage(), DiscoveryUsage::default());
}

#[test]
fn a_remote_root_is_refused() {
    let error = discover(
        &FakeSource::new().root_error(DiscoveryErrorKind::RemoteRootUnsupported),
        &root(),
        DiscoveryBudget::default(),
    )
    .expect_err("a remote root is refused");

    assert_eq!(error.kind(), DiscoveryErrorKind::RemoteRootUnsupported);
}

#[test]
fn a_reparse_child_is_skipped_counted_and_never_asked_about() {
    // Directory 9 exists in the fake and holds a file. If the walk followed the
    // link it would find it, which is the whole failure this refuses.
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![link("escape", 9, true), file("here.mzML", 2)])
            .directory(9, vec![file("not-yours.mzML", 10)]),
    );

    assert_eq!(located(&result), vec!["here.mzML"]);
    assert_eq!(result.summary().skipped_reparse_count, 1);
    assert_eq!(result.summary().directories_entered, 1);
    assert!(!result.is_complete());
}

#[test]
fn a_reparse_file_is_skipped_even_when_it_is_named_like_a_candidate() {
    // A cloud placeholder or a file symlink carries the same attribute as a
    // junction, and this slice refuses every tag alike.
    let result = walk(&FakeSource::new().directory(
        1,
        vec![link("placeholder.mzML", 2, false), file("real.mzML", 3)],
    ));

    assert_eq!(located(&result), vec!["real.mzML"]);
    assert_eq!(result.summary().skipped_reparse_count, 1);
}

#[test]
fn a_directory_reached_twice_is_entered_once() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("A", 2), directory("B", 2)])
            .directory(2, vec![file("once.mzML", 3)]),
    );

    assert_eq!(located(&result), vec!["A\\once.mzML"]);
    assert_eq!(result.summary().directories_entered, 2);
}

#[test]
fn a_cycle_terminates() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("down", 2)])
            .directory(2, vec![directory("up", 1), file("inner.mzML", 3)]),
    );

    assert_eq!(located(&result), vec!["down\\inner.mzML"]);
}

#[test]
fn two_directories_with_one_name_but_different_identities_are_both_walked() {
    // The other half of the visited set. Keying it by name would make the
    // second `data` a directory already seen and drop its subtree silently --
    // and `data`, `raw` or `Blank` under two different parents is the ordinary
    // shape of a real folder, not a corner case. So the two must share a name
    // in different places, which is exactly what this builds.
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("A", 2), directory("B", 3)])
            .directory(2, vec![directory("data", 4)])
            .directory(3, vec![directory("data", 5)])
            .directory(4, vec![file("first.mzML", 6)])
            .directory(5, vec![file("second.mzML", 7)]),
    );

    assert_eq!(
        located(&result),
        vec!["A\\data\\first.mzML", "B\\data\\second.mzML"]
    );
    assert_eq!(result.summary().directories_entered, 5);
    assert!(result.is_complete());
}

#[test]
fn an_unreadable_root_is_an_error_and_an_unreadable_child_is_a_count() {
    let root_failed = discover(
        &FakeSource::new().unreadable_after(1, 2),
        &root(),
        DiscoveryBudget::default(),
    )
    .expect_err("an unreadable root has nothing to have found");
    assert_eq!(
        root_failed.kind(),
        DiscoveryErrorKind::RootEnumerationFailed
    );
    assert_eq!(
        root_failed.usage(),
        DiscoveryUsage {
            entries_inspected: 2,
            directories_entered: 1,
            candidates_collected: 0,
        }
    );

    // One unreadable subdirectory is not a reason to discard the rest.
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("bad", 2), directory("good", 3)])
            .directory(3, vec![file("kept.mzML", 4)])
            .unreadable(2),
    );

    assert_eq!(located(&result), vec!["good\\kept.mzML"]);
    assert_eq!(result.summary().inaccessible_entry_count, 1);
    assert!(!result.is_complete());
}

#[test]
fn a_nested_enumeration_error_keeps_prior_candidates_and_charges_partial_usage() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![file("kept.mzML", 2), directory("unreadable", 3)])
            .unreadable_after(3, 2),
    );

    assert_eq!(located(&result), vec!["kept.mzML"]);
    assert_eq!(result.summary().entries_inspected, 4);
    assert_eq!(result.summary().directories_entered, 2);
    assert_eq!(result.summary().inaccessible_entry_count, 1);
    assert!(!result.is_complete());
}

#[test]
fn a_child_that_will_not_open_or_is_no_longer_itself_is_counted_not_entered() {
    let unopenable = walk(
        &FakeSource::new()
            .directory(1, vec![directory("locked", 2), directory("open", 3)])
            .directory(3, vec![file("kept.mzML", 4)])
            .unopenable(2),
    );
    assert_eq!(located(&unopenable), vec!["open\\kept.mzML"]);
    assert_eq!(unopenable.summary().inaccessible_entry_count, 1);

    // The name was re-pointed between the parent describing it and the walk
    // opening it. Refusing is the only safe answer: what opened is not what the
    // enumeration vouched for.
    let switched = walk(
        &FakeSource::new()
            .directory(1, vec![directory("swapped", 2), directory("open", 3)])
            .directory(2, vec![file("planted.mzML", 5)])
            .directory(3, vec![file("kept.mzML", 4)])
            .switched(2),
    );
    assert_eq!(located(&switched), vec!["open\\kept.mzML"]);
    assert_eq!(switched.summary().inaccessible_entry_count, 1);
}

// --- ordinary entries are not guessed about -------------------------------

#[test]
fn hidden_system_and_dot_prefixed_entries_are_ordinary() {
    // Skipping by name is a guess about what the user meant, and the guess
    // silently omits data they explicitly pointed at.
    let result = walk(
        &FakeSource::new()
            .directory(
                1,
                vec![
                    directory(".git", 2),
                    directory("$RECYCLE.BIN", 3),
                    file(".hidden.mzML", 4),
                ],
            )
            .directory(2, vec![file("in-dot.mzML", 5)])
            .directory(3, vec![file("in-system.mzML", 6)]),
    );

    assert_eq!(
        located(&result),
        vec![
            ".hidden.mzML",
            "$RECYCLE.BIN\\in-system.mzML",
            ".git\\in-dot.mzML",
        ]
    );
    assert!(result.is_complete());
}

// --- budgets --------------------------------------------------------------

fn budget(depth: u32, entries: u64, directories: u64, candidates: usize) -> DiscoveryBudget {
    DiscoveryBudget {
        max_depth: depth,
        max_entries: entries,
        max_directories: directories,
        max_candidates: candidates,
    }
}

/// A chain `1 -> 2 -> 3 -> ...`, each level holding one file and one child.
fn chain(levels: u128) -> FakeSource {
    let mut source = FakeSource::new();
    for level in 1..=levels {
        let mut entries = vec![file(&format!("f{level}.mzML"), 1_000 + level)];
        if level < levels {
            entries.push(directory(&format!("d{level}"), level + 1));
        }
        source = source.directory(level, entries);
    }
    source
}

#[test]
fn a_tree_under_and_exactly_at_the_depth_limit_is_complete() {
    // Depth 0 is the root, so three levels sit at depths 0, 1 and 2.
    let expected = vec!["f1.mzML", "d1\\f2.mzML", "d1\\d2\\f3.mzML"];

    let under = discover(&chain(3), &root(), budget(3, 100, 100, 100)).expect("the root opens");
    assert_eq!(located(&under), expected);
    assert!(under.limits().is_empty());

    let at = discover(&chain(3), &root(), budget(2, 100, 100, 100)).expect("the root opens");
    assert_eq!(located(&at), expected);
    assert!(at.limits().is_empty());
}

#[test]
fn a_child_one_level_past_the_depth_limit_is_not_entered() {
    let result = discover(&chain(4), &root(), budget(2, 100, 100, 100)).expect("the root opens");

    assert_eq!(
        located(&result),
        vec!["f1.mzML", "d1\\f2.mzML", "d1\\d2\\f3.mzML"]
    );
    assert_eq!(result.limits(), [DiscoveryLimit::Depth]);
    assert!(!result.is_complete());
}

#[test]
fn a_depth_limit_skips_the_subtree_and_keeps_the_siblings() {
    // `deep` runs past the limit; `flat` sits beside it and must still be
    // described. A depth limit is the one limit that does not end the walk.
    let result = discover(
        &FakeSource::new()
            .directory(1, vec![directory("deep", 2), directory("flat", 4)])
            .directory(2, vec![directory("deeper", 3), file("at-limit.mzML", 5)])
            .directory(3, vec![file("too-deep.mzML", 6)])
            .directory(4, vec![file("sibling.mzML", 7)]),
        &root(),
        budget(1, 100, 100, 100),
    )
    .expect("the root opens");

    assert_eq!(
        located(&result),
        vec!["deep\\at-limit.mzML", "flat\\sibling.mzML"]
    );
    assert_eq!(result.limits(), [DiscoveryLimit::Depth]);
}

#[test]
fn the_entry_limit_stops_the_walk_and_keeps_what_was_found() {
    let source = FakeSource::new().directory(
        1,
        vec![file("a.mzML", 2), file("b.mzML", 3), file("c.mzML", 4)],
    );

    // One under the limit, exactly at it, and one past: the three cases that
    // tell a correct comparison from an off-by-one, since a budget checked with
    // the wrong operator still passes two of them.
    let under = discover(&source, &root(), budget(8, 4, 100, 100)).expect("opens");
    assert_eq!(under.candidates().len(), 3);
    assert!(under.limits().is_empty());

    let at = discover(&source, &root(), budget(8, 3, 100, 100)).expect("opens");
    assert_eq!(at.candidates().len(), 3);
    assert_eq!(at.summary().entries_inspected, 3);
    assert!(at.limits().is_empty());

    let past = discover(&source, &root(), budget(8, 2, 100, 100)).expect("opens");
    assert_eq!(past.summary().entries_inspected, 2);
    // The two entries seen were classified, and what they produced is kept.
    assert_eq!(located(&past), vec!["a.mzML", "b.mzML"]);
    assert_eq!(past.limits(), [DiscoveryLimit::Entries]);
    assert!(!past.is_complete());
}

#[test]
fn an_entry_allowance_is_what_the_source_is_asked_for_not_what_it_is_told_after() {
    // A budget checked only after a directory has been read is a statement
    // about counting, not about cost: the allocation has already happened. So
    // the walk asks for what it can still afford, and the source is required to
    // stop there -- which is the difference between a folder holding millions
    // of names costing one allowance and costing all of them.
    let many: Vec<DirectoryEntry> = (0..500)
        .map(|index| file(&format!("f{index:03}.mzML"), 100 + index))
        .collect();
    let source = FakeSource::new().directory(1, many);

    let result = discover(&source, &root(), budget(8, 4, 100, 100)).expect("opens");

    let asked = source.limits_asked.borrow().clone();
    // Five: the four still affordable, plus the one that proves there were more.
    assert_eq!(asked, vec![5]);
    assert_eq!(result.summary().entries_inspected, 4);
    assert_eq!(result.limits(), [DiscoveryLimit::Entries]);
    assert_eq!(result.candidates().len(), 4);
}

#[test]
fn the_directory_limit_counts_the_root_and_enters_no_more() {
    // Deliberately not "stops the walk": reaching this limit ends the *entering*
    // of directories, and the ones already entered are still described. They
    // were counted against this very budget, and discarding their work would
    // spend the allowance on nothing.
    let source = FakeSource::new()
        .directory(1, vec![directory("A", 2), directory("B", 3)])
        .directory(2, vec![file("a.mzML", 4)])
        .directory(3, vec![file("b.mzML", 5)]);

    let under = discover(&source, &root(), budget(8, 100, 4, 100)).expect("opens");
    assert_eq!(located(&under), vec!["A\\a.mzML", "B\\b.mzML"]);
    assert!(under.limits().is_empty());

    // Three: the root and both children.
    let at = discover(&source, &root(), budget(8, 100, 3, 100)).expect("opens");
    assert_eq!(located(&at), vec!["A\\a.mzML", "B\\b.mzML"]);
    assert_eq!(at.summary().directories_entered, 3);
    assert!(at.limits().is_empty());

    let past = discover(&source, &root(), budget(8, 100, 2, 100)).expect("opens");
    assert_eq!(located(&past), vec!["A\\a.mzML"]);
    assert_eq!(past.summary().directories_entered, 2);
    assert_eq!(past.limits(), [DiscoveryLimit::Directories]);
    assert!(!past.is_complete());
}

#[test]
fn the_candidate_limit_stops_the_walk_and_keeps_the_candidates() {
    let source = FakeSource::new().directory(
        1,
        vec![file("a.mzML", 2), file("b.mzML", 3), file("c.mzML", 4)],
    );

    let under = discover(&source, &root(), budget(8, 100, 100, 4)).expect("opens");
    assert_eq!(under.candidates().len(), 3);
    assert!(under.limits().is_empty());

    let at = discover(&source, &root(), budget(8, 100, 100, 3)).expect("opens");
    assert_eq!(at.candidates().len(), 3);
    assert!(at.limits().is_empty());

    let past = discover(&source, &root(), budget(8, 100, 100, 2)).expect("opens");
    assert_eq!(located(&past), vec!["a.mzML", "b.mzML"]);
    assert_eq!(past.limits(), [DiscoveryLimit::Candidates]);
    assert_eq!(past.summary().candidate_count, 2);
    assert!(!past.is_complete());
}

#[test]
fn several_limits_are_reported_once_each_in_a_stable_order() {
    // A tree that runs out of depth in one branch and directories overall.
    let result = discover(
        &FakeSource::new()
            .directory(1, vec![directory("A", 2), directory("B", 4)])
            .directory(2, vec![directory("deeper", 3)])
            .directory(3, vec![file("x.mzML", 5)])
            .directory(4, vec![file("y.mzML", 6)]),
        &root(),
        budget(1, 100, 2, 100),
    )
    .expect("opens");

    assert_eq!(
        result.limits(),
        [DiscoveryLimit::Depth, DiscoveryLimit::Directories]
    );
}

#[test]
fn a_tree_far_deeper_than_the_budget_neither_overflows_nor_loses_its_siblings() {
    // An explicit stack is what makes this a budget question rather than a
    // question about how much stack the process was given.
    let result = discover(
        &chain(4_000),
        &root(),
        budget(64, 1_000_000, 1_000_000, 1_000_000),
    )
    .expect("opens");

    assert_eq!(result.candidates().len(), 65);
    assert_eq!(result.limits(), [DiscoveryLimit::Depth]);
}

/// A chain of bare directories with one file at the very bottom.
///
/// Distinct from `chain` because this one is walked all the way down: a file
/// per level would make the fixture, not the traversal, the expensive part.
fn bare_chain(levels: u128) -> FakeSource {
    let mut source = FakeSource::new();
    for level in 1..=levels {
        let entries = if level < levels {
            vec![directory(&format!("d{level}"), level + 1)]
        } else {
            vec![file("bottom.mzML", level + 1)]
        };
        source = source.directory(level, entries);
    }
    source
}

#[test]
fn a_chain_deeper_than_a_call_stack_is_bounded_by_the_heap_instead() {
    // What the explicit stack buys, stated as a test. How deep MSCanvas is
    // willing to walk is a decision this application makes and can revisit;
    // how much native stack the process happens to have been given is not, and
    // a traversal that recursed would quietly tie the first to the second. This
    // chain is deeper than a call stack survives, and the budget is opened wide
    // so that nothing but the algorithm decides whether it reaches the bottom.
    let depth = 6_000_u128;

    let result = discover(
        &bare_chain(depth),
        &root(),
        budget(u32::MAX, u64::MAX, u64::MAX, usize::MAX),
    )
    .expect("the root opens");

    assert_eq!(result.candidates().len(), 1);
    assert_eq!(
        result.candidates()[0].relative_components().len(),
        depth as usize
    );
    assert!(result.is_complete());
}

// --- privacy --------------------------------------------------------------

#[test]
fn nothing_path_bearing_prints_a_path() {
    let result = walk(
        &FakeSource::new()
            .directory(1, vec![directory("Secret", 2), link("escape", 9, true)])
            .directory(2, vec![file("patient-name.mzML", 3)]),
    );

    let candidate = format!("{:?}", result.candidates().first().expect("one candidate"));
    let whole = format!("{result:?}");
    // The entry too, and not only the candidate. An entry is where a filename
    // out of the user's folder first exists, and it is the value most likely to
    // end up in the first diagnostic anyone writes.
    let entry = format!("{:?}", file("patient-name.mzML", 3));
    let error = format!(
        "{:?}",
        DiscoveryError::new(DiscoveryErrorKind::RootReparsePoint)
    );

    for rendered in [&candidate, &whole, &entry] {
        for leak in ["patient-name", "Secret", "escape", "R\\", "mzML"] {
            assert!(!rendered.contains(leak), "{leak} appeared in {rendered}");
        }
    }
    assert_eq!(candidate, "<opaque-discovered-candidate>");
    assert_eq!(entry, "<opaque-directory-entry>");
    // An error says which refusal it is and nothing else.
    assert_eq!(error, "DiscoveryError(root_reparse_point)");
    assert!(!format!("{:?}", identity(3)).contains('3'));
}

#[test]
fn every_error_kind_has_a_stable_path_free_identifier() {
    for (kind, spelling) in [
        (
            DiscoveryErrorKind::PlatformUnavailable,
            "platform_unavailable",
        ),
        (DiscoveryErrorKind::RootUnavailable, "root_unavailable"),
        (DiscoveryErrorKind::RootNotDirectory, "root_not_directory"),
        (DiscoveryErrorKind::RootReparsePoint, "root_reparse_point"),
        (
            DiscoveryErrorKind::RemoteRootUnsupported,
            "remote_root_unsupported",
        ),
        (
            DiscoveryErrorKind::RootEnumerationFailed,
            "root_enumeration_failed",
        ),
        (
            DiscoveryErrorKind::FilesystemInvariantFailed,
            "filesystem_invariant_failed",
        ),
    ] {
        assert_eq!(kind.as_str(), spelling);
        assert_eq!(format!("{kind:?}"), spelling);
    }
}

#[test]
fn the_production_budget_is_the_one_the_decision_record_states() {
    let budget = DiscoveryBudget::default();

    assert_eq!(budget.max_depth, 32);
    assert_eq!(budget.max_entries, 200_000);
    assert_eq!(budget.max_directories, 20_000);
    // Deliberately the workspace capacity: proposing more than a session can
    // hold would be proposing files nothing could accept.
    assert_eq!(budget.max_candidates, 1_024);
}

#[cfg(not(windows))]
#[test]
fn discovery_is_unavailable_off_windows() {
    let error = discover_mzml_candidates(Path::new("/tmp"), DiscoveryBudget::default())
        .expect_err("no guarantee is made off Windows");

    assert_eq!(error.kind(), DiscoveryErrorKind::PlatformUnavailable);
}

#[cfg(windows)]
mod windows_filesystem;
