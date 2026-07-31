//! Real Windows directories, read through the real adapter.
//!
//! The fake source above can describe any tree, but it cannot answer the one
//! question that matters most here: does a junction planted in a folder the
//! user chose take the walk out of that folder? Only NTFS can answer that, so
//! these tests build real trees under `%TEMP%` and read them with the same code
//! the product would.
//!
//! A junction is the realistic threat rather than a symbolic link: creating one
//! needs no elevation, so anything running as the user can leave one in a
//! folder the user later points at.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::super::windows::{WindowsDirectory, WindowsDirectorySource};
use super::*;

/// A real directory tree, removed when the test ends.
struct TestTree(PathBuf);

impl TestTree {
    fn new(label: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mscanvas-discovery-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create discovery test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// Creates a directory under the tree, parents included.
    fn directory(&self, relative: &str) -> PathBuf {
        let path = self.0.join(relative);
        fs::create_dir_all(&path).expect("create test subdirectory");
        path
    }

    /// Creates a file with the given length under the tree.
    fn file(&self, relative: &str, bytes: usize) -> PathBuf {
        let path = self.0.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create test parent");
        }
        fs::write(&path, vec![0_u8; bytes]).expect("write test file");
        path
    }

    /// Creates a directory junction at `link` pointing at `target`.
    ///
    /// `mklink /J` through the command processor because std has no junction
    /// API and this project adds no dependency for one. A junction needs no
    /// elevation, which is exactly why the containment claim matters.
    fn junction(&self, link: &str, target: &Path) {
        let link_path = self.0.join(link);
        if let Some(parent) = link_path.parent() {
            fs::create_dir_all(parent).expect("create junction parent");
        }
        let status = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link_path)
            .arg(target)
            // Silenced because it confirms itself by printing both real paths,
            // and a suite whose subject is that nothing prints a path should
            // not be the thing printing them into a CI log.
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("run the command processor to create a junction");
        // Deliberately loud. Skipping quietly here would silently retire the
        // one claim these tests exist to make.
        assert!(
            status.success() && link_path.exists(),
            "could not create the junction this containment test depends on"
        );
    }
}

impl Drop for TestTree {
    fn drop(&mut self) {
        // Junctions first, and with `rmdir`, which removes the link and never
        // what it points at. A recursive delete over one could take the target
        // with it, and in these tests the target is another test's fixture.
        remove_junctions(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Removes every junction under a tree, deepest first.
fn remove_junctions(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        if metadata.file_type().is_symlink() {
            // `symlink_metadata` reports a junction as a symlink on Windows.
            let _ = Command::new("cmd")
                .args(["/c", "rmdir"])
                .arg(entry.path())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        } else {
            remove_junctions(&entry.path());
        }
    }
}

fn walk_real(root: &Path) -> DiscoveryResult {
    discover_mzml_candidates(root, DiscoveryBudget::default()).expect("a real root opens")
}

fn names(result: &DiscoveryResult) -> Vec<String> {
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
fn an_empty_real_directory_discovers_nothing() {
    let tree = TestTree::new("empty");

    let result = walk_real(tree.path());

    assert!(result.candidates().is_empty());
    assert!(result.is_complete());
    assert_eq!(result.summary().directories_entered, 1);
}

#[test]
fn nested_real_files_are_found_in_the_stated_order() {
    let tree = TestTree::new("nested");
    tree.file("top.mzML", 8);
    tree.file("B\\b.mzML", 8);
    tree.file("A\\a.mzML", 8);
    tree.file("A\\deeper\\d.mzML", 8);
    tree.file("ignored.txt", 8);

    let result = walk_real(tree.path());

    assert_eq!(
        names(&result),
        vec!["top.mzML", "A\\a.mzML", "A\\deeper\\d.mzML", "B\\b.mzML"]
    );
    assert!(result.is_complete());
}

#[test]
fn a_candidate_carries_the_path_acceptance_will_be_given() {
    // Discovery proposes; acceptance decides. What it proposes has to be a path
    // that resolves to the file it found, or the proposal is worthless.
    let tree = TestTree::new("path");
    let expected = tree.file("A\\sample.mzML", 12);

    let result = walk_real(tree.path());

    let candidate = result.candidates().first().expect("one candidate");
    assert_eq!(candidate.path(), expected);
    assert!(candidate.path().is_absolute());
    // And the relative form is the same file said without the root.
    assert_eq!(
        candidate.relative_components(),
        [OsString::from("A"), OsString::from("sample.mzML")]
    );
    assert!(fs::metadata(candidate.path()).is_ok());
}

#[test]
fn a_real_tree_discovers_the_same_way_twice() {
    let tree = TestTree::new("stable");
    for name in ["m.mzML", "a.mzML", "z.mzML", "B\\x.mzML", "A\\y.mzML"] {
        tree.file(name, 4);
    }

    let first = walk_real(tree.path());
    let second = walk_real(tree.path());

    assert_eq!(names(&first), names(&second));
    assert_eq!(first.summary(), second.summary());
}

#[test]
fn unicode_names_survive_a_real_round_trip() {
    let tree = TestTree::new("unicode");
    tree.file("éclair.mzML", 4);
    tree.file("Ω\\омега.mzML", 4);

    let result = walk_real(tree.path());

    assert_eq!(names(&result), vec!["éclair.mzML", "Ω\\омега.mzML"]);
}

#[test]
fn no_real_name_length_is_refused_by_the_record_bounds_check() {
    // The decoder now refuses a record whose `next` does not clear its own
    // name, which is only safe if no real record ever looks like that. Windows
    // aligns `NextEntryOffset` up to eight bytes, so the argument is that
    // `next >= 88 + FileNameLength` always -- and the place an alignment
    // argument goes wrong is at the boundaries.
    //
    // So: one name of every length from 1 to 64 characters, which covers every
    // residue of the alignment twice over. A false refusal here would break
    // real enumeration for particular filename lengths only, which is exactly
    // the kind of bug that survives a suite of tidy fixture names.
    let tree = TestTree::new("lengths");
    let mut expected = Vec::new();
    for length in 1..=64_usize {
        let stem: String = std::iter::repeat_n('n', length).collect();
        tree.file(&format!("{stem}.mzML"), 1);
        expected.push(format!("{stem}.mzML"));
    }
    expected.sort();

    let result = walk_real(tree.path());

    let mut found = names(&result);
    found.sort();
    assert_eq!(found, expected);
    assert!(result.is_complete());
}

#[test]
fn the_same_filename_in_two_real_subdirectories_keeps_both() {
    let tree = TestTree::new("collision");
    tree.file("A\\sample.mzML", 4);
    tree.file("B\\sample.mzML", 4);

    let result = walk_real(tree.path());

    assert_eq!(names(&result), vec!["A\\sample.mzML", "B\\sample.mzML"]);
    // The final names are identical, which is exactly why the relative
    // components have to be kept.
    for candidate in result.candidates() {
        assert_eq!(
            candidate.relative_components().last(),
            Some(&OsString::from("sample.mzML"))
        );
    }
}

#[test]
fn a_junction_does_not_take_the_walk_out_of_the_chosen_folder() {
    // The central claim of this slice. `escape` is an ordinary unelevated
    // junction pointing at a folder outside the one the user chose, and the
    // file behind it must not appear.
    let outside = TestTree::new("outside");
    outside.file("not-yours.mzML", 16);

    let chosen = TestTree::new("chosen");
    chosen.file("mine.mzML", 16);
    chosen.junction("escape", outside.path());

    let result = walk_real(chosen.path());

    assert_eq!(names(&result), vec!["mine.mzML"]);
    assert_eq!(result.summary().skipped_reparse_count, 1);
    // The junction was refused rather than entered.
    assert_eq!(result.summary().directories_entered, 1);
    // A walk that refused something did not describe the whole folder.
    assert!(!result.is_complete());
    // And the target is untouched by having been pointed at.
    assert!(outside.path().join("not-yours.mzML").exists());
}

#[test]
fn a_junction_used_as_the_chosen_root_is_refused() {
    let target = TestTree::new("root-target");
    target.file("inside.mzML", 8);
    let holder = TestTree::new("root-holder");
    holder.junction("as-root", target.path());

    let error =
        discover_mzml_candidates(&holder.path().join("as-root"), DiscoveryBudget::default())
            .expect_err("a link chosen as the root is refused");

    assert_eq!(error.kind(), DiscoveryErrorKind::RootReparsePoint);
}

#[test]
fn a_file_chosen_as_the_root_is_refused_as_not_a_directory() {
    let tree = TestTree::new("file-root");
    let file = tree.file("sample.mzML", 8);

    let error = discover_mzml_candidates(&file, DiscoveryBudget::default())
        .expect_err("a file is not a folder");

    assert_eq!(error.kind(), DiscoveryErrorKind::RootNotDirectory);
}

#[test]
fn a_root_that_does_not_exist_is_refused() {
    let tree = TestTree::new("absent");

    let error = discover_mzml_candidates(
        &tree.path().join("no-such-folder"),
        DiscoveryBudget::default(),
    )
    .expect_err("an absent root has nothing to walk");

    assert_eq!(error.kind(), DiscoveryErrorKind::RootUnavailable);
}

#[test]
fn a_unc_root_is_refused_without_being_walked() {
    // A UNC path names a share; this slice makes no claim about identity,
    // leases or consistency on one. It need not exist to be refused.
    let error = discover_mzml_candidates(
        Path::new(r"\\mscanvas-no-such-host\share\folder"),
        DiscoveryBudget::default(),
    )
    .expect_err("a network root is refused");

    assert_eq!(error.kind(), DiscoveryErrorKind::RemoteRootUnsupported);
}

#[test]
fn hidden_and_system_real_entries_are_ordinary() {
    // Real attributes, not just names that look the part. Hidden and System are
    // how Windows says "an ordinary user did not need to see this in a file
    // list" -- they are not a claim about whether the data is the user's, and a
    // user who pointed at the folder has already said they want what is in it.
    let tree = TestTree::new("hidden");
    let hidden_directory = tree.directory(".hidden");
    tree.file(".hidden\\inside.mzML", 4);
    let system_directory = tree.directory("SystemFolder");
    tree.file("SystemFolder\\inside.mzML", 4);
    let hidden_file = tree.file("secret.mzML", 4);
    let system_file = tree.file("machine.mzML", 4);
    set_attributes(&hidden_directory, "+h");
    set_attributes(&system_directory, "+s");
    set_attributes(&hidden_file, "+h");
    set_attributes(&system_file, "+s");

    let result = walk_real(tree.path());

    assert_eq!(
        names(&result),
        vec![
            "machine.mzML",
            "secret.mzML",
            ".hidden\\inside.mzML",
            "SystemFolder\\inside.mzML",
        ]
    );
    assert!(result.is_complete());
}

/// Marks a real path with a file attribute, so the tests above exercise the
/// attribute rather than only the name convention.
fn set_attributes(path: &Path, flag: &str) {
    let status = Command::new("cmd")
        .args(["/c", "attrib", flag])
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("run the command processor to set an attribute");
    assert!(status.success(), "could not mark the fixture {flag}");
}

#[test]
fn a_zero_byte_real_file_is_still_offered() {
    let tree = TestTree::new("zero");
    tree.file("empty.mzML", 0);

    assert_eq!(names(&walk_real(tree.path())), vec!["empty.mzML"]);
}

#[test]
fn a_real_tree_deeper_than_the_budget_truncates_and_keeps_its_siblings() {
    let tree = TestTree::new("deep");
    let mut relative = String::from("deep");
    for level in 0..12 {
        relative.push_str(&format!("\\d{level}"));
    }
    tree.file(&format!("{relative}\\bottom.mzML"), 4);
    tree.file("shallow.mzML", 4);

    let result = discover_mzml_candidates(
        tree.path(),
        DiscoveryBudget {
            max_depth: 3,
            ..DiscoveryBudget::default()
        },
    )
    .expect("a real root opens");

    assert_eq!(names(&result), vec!["shallow.mzML"]);
    assert_eq!(result.limits(), [DiscoveryLimit::Depth]);
    assert!(!result.is_complete());
}

#[test]
fn a_real_walk_stops_at_the_candidate_budget_and_keeps_what_it_found() {
    let tree = TestTree::new("candidates");
    for index in 0..6 {
        tree.file(&format!("f{index}.mzML"), 4);
    }

    let result = discover_mzml_candidates(
        tree.path(),
        DiscoveryBudget {
            max_candidates: 3,
            ..DiscoveryBudget::default()
        },
    )
    .expect("a real root opens");

    assert_eq!(result.candidates().len(), 3);
    assert_eq!(result.limits(), [DiscoveryLimit::Candidates]);
}

#[test]
fn a_real_result_prints_no_part_of_a_real_path() {
    let tree = TestTree::new("privacy");
    tree.file("Confidential\\patient.mzML", 4);

    let result = walk_real(tree.path());
    let rendered = format!("{result:?}");

    for leak in ["Confidential", "patient", "mscanvas-discovery", "Temp"] {
        assert!(!rendered.contains(leak), "{leak} appeared in {rendered}");
    }
}

// --- what happens when the tree changes under the walk ---------------------
//
// A folder is not frozen while MSCanvas looks at it, and it must not be: the
// walk opens for sharing precisely so its owner can keep working. So the gap
// between "the parent said this name is a directory" and "this handle is open"
// is real, and these tests drive it deliberately rather than waiting for a
// race. `open_child` is called with an entry that has been made stale on
// purpose, which is the same state a genuine race would produce, without a
// sleep deciding whether the test passes.

/// Enumerates a real root and returns the source, the open root and its entries.
fn enumerate_real(
    root: &Path,
) -> (
    WindowsDirectorySource,
    WindowsDirectory,
    Vec<DirectoryEntry>,
) {
    let source = WindowsDirectorySource;
    let directory = source.open_root(root).expect("a real root opens");
    let entries = source
        .entries(&directory, u64::MAX)
        .expect("a real root enumerates");
    (source, directory, entries)
}

fn entry_named<'a>(entries: &'a [DirectoryEntry], name: &str) -> &'a DirectoryEntry {
    entries
        .iter()
        .find(|entry| entry.name == name)
        .expect("the enumeration described the fixture")
}

#[test]
fn a_child_directory_replaced_after_enumeration_is_refused_by_identity() {
    // The attack this closes: the name the parent described is re-created as
    // something else before the walk opens it. The name still resolves, and it
    // is still a perfectly ordinary directory -- only its identity betrays it.
    let tree = TestTree::new("replaced");
    tree.file("A\\inside.mzML", 4);
    let (source, root, entries) = enumerate_real(tree.path());
    let stale = entry_named(&entries, "A").clone();

    fs::remove_dir_all(tree.path().join("A")).expect("remove the enumerated child");
    tree.directory("A");

    let opened = source.open_child(&root, tree.path(), &stale);

    assert!(
        matches!(opened, ChildDirectory::IdentityChanged),
        "a directory re-created under the same name is not the one that was enumerated"
    );
}

#[test]
fn a_child_directory_that_disappears_after_enumeration_is_inaccessible() {
    let tree = TestTree::new("vanished");
    tree.directory("A");
    let (source, root, entries) = enumerate_real(tree.path());
    let stale = entry_named(&entries, "A").clone();

    fs::remove_dir_all(tree.path().join("A")).expect("remove the enumerated child");

    let opened = source.open_child(&root, tree.path(), &stale);

    // Not an error, and not a silent success: a subtree that stopped existing
    // is one the walk cannot describe, which is what the count means.
    assert!(matches!(opened, ChildDirectory::Inaccessible));
}

#[test]
fn a_child_directory_replaced_by_a_junction_after_enumeration_is_refused() {
    // The same substitution, aimed at the containment boundary rather than at
    // identity: the replacement is a link out of the folder entirely.
    let outside = TestTree::new("junction-swap-target");
    outside.file("elsewhere.mzML", 4);
    let tree = TestTree::new("junction-swap");
    tree.directory("A");
    let (source, root, entries) = enumerate_real(tree.path());
    let stale = entry_named(&entries, "A").clone();

    fs::remove_dir_all(tree.path().join("A")).expect("remove the enumerated child");
    tree.junction("A", outside.path());

    let opened = source.open_child(&root, tree.path(), &stale);

    assert!(
        matches!(opened, ChildDirectory::IdentityChanged),
        "a name that became a link is refused as a link, before its identity is even asked for"
    );
}

#[test]
fn a_child_directory_replaced_by_a_file_after_enumeration_is_refused() {
    let tree = TestTree::new("became-file");
    tree.directory("A");
    let (source, root, entries) = enumerate_real(tree.path());
    let stale = entry_named(&entries, "A").clone();

    fs::remove_dir_all(tree.path().join("A")).expect("remove the enumerated child");
    tree.file("A", 4);

    let opened = source.open_child(&root, tree.path(), &stale);

    assert!(matches!(opened, ChildDirectory::IdentityChanged));
}

#[test]
fn a_child_that_did_not_change_opens_as_the_object_that_was_enumerated() {
    // The other half of the claim: refusing everything would satisfy the tests
    // above and discover nothing at all.
    let tree = TestTree::new("unchanged");
    tree.file("A\\inside.mzML", 4);
    let (source, root, entries) = enumerate_real(tree.path());
    let unchanged = entry_named(&entries, "A");

    let opened = source.open_child(&root, tree.path(), unchanged);

    match opened {
        ChildDirectory::Opened(child) => {
            assert_eq!(source.identity(&child), unchanged.identity);
        }
        _ => panic!("an unchanged child opens"),
    }
}

#[test]
fn a_candidate_whose_file_disappears_after_the_walk_is_still_only_a_proposal() {
    // Discovery describes what it saw; it does not promise the file is still
    // there when acceptance opens it. Stating that here is what stops a later
    // slice treating a candidate as a guarantee -- acceptance re-opens, re-
    // identifies and re-decides every one of them.
    let tree = TestTree::new("stale-candidate");
    let file = tree.file("sample.mzML", 4);

    let result = walk_real(tree.path());
    fs::remove_file(&file).expect("remove the discovered file");

    let candidate = result.candidates().first().expect("one candidate");
    assert_eq!(candidate.path(), file);
    assert!(
        fs::metadata(candidate.path()).is_err(),
        "the candidate names a file that is gone, and acceptance is what will say so"
    );
}

#[test]
fn what_discovery_offers_is_what_acceptance_takes() {
    // The agreement, asked of both sides rather than of the shared predicate.
    // Discovery proposing a file the picker would refuse is a folder action
    // that adds nothing and explains nothing, so this calls the real acceptance
    // boundary on the real paths the real walk produced.
    let tree = TestTree::new("agreement");
    tree.file("upper.MZML", 4);
    tree.file("mixed.MzMl", 4);
    tree.file("lower.mzml", 4);
    let refused = tree.file("run.mzXML", 4);

    let result = walk_real(tree.path());

    assert_eq!(
        names(&result),
        vec!["lower.mzml", "mixed.MzMl", "upper.MZML"]
    );
    for candidate in result.candidates() {
        super::super::super::selection::accept_mzml_file(candidate.path())
            .expect("acceptance takes what discovery offered");
    }
    // And the one it did not offer is the one acceptance would have refused.
    let error = super::super::super::selection::accept_mzml_file(&refused)
        .expect_err("acceptance refuses what discovery passed over");
    assert_eq!(error.kind, "unsupported_extension");
}

#[test]
fn a_real_walk_stops_inspecting_at_its_allowance() {
    let tree = TestTree::new("allowance");
    for index in 0..40 {
        tree.file(&format!("f{index:02}.mzML"), 4);
    }

    let result = discover_mzml_candidates(
        tree.path(),
        DiscoveryBudget {
            max_entries: 5,
            ..DiscoveryBudget::default()
        },
    )
    .expect("a real root opens");

    assert_eq!(result.summary().entries_inspected, 5);
    assert_eq!(result.candidates().len(), 5);
    assert_eq!(result.limits(), [DiscoveryLimit::Entries]);
    assert!(!result.is_complete());
}

#[test]
fn a_real_walk_stops_reading_at_its_allowance_too() {
    // The half of the budget a result cannot show. That the walk stops
    // *inspecting* at its allowance is visible in the summary above; that it
    // stops *reading* is not, and a bound that only capped the vector would
    // leave a directory of a million names still enumerated to the end -- the
    // I/O half of the very defect the allowance was added to fix, with every
    // other test green. So this counts the enumerations.
    //
    // The directory is deliberately larger than one 64 KiB buffer: at roughly
    // 112 bytes a record, one call returns about 585 entries, so 1,500 names
    // take three calls to read out and one call to satisfy an allowance of six.
    let tree = TestTree::new("reads");
    for index in 0..1_500 {
        tree.file(&format!("f{index:04}.mzML"), 0);
    }

    super::super::windows::ENUMERATION_CALLS.with(|calls| calls.set(0));
    let result = discover_mzml_candidates(
        tree.path(),
        DiscoveryBudget {
            max_entries: 5,
            ..DiscoveryBudget::default()
        },
    )
    .expect("a real root opens");
    let issued = super::super::windows::ENUMERATION_CALLS.with(std::cell::Cell::get);

    assert_eq!(result.summary().entries_inspected, 5);
    assert_eq!(
        issued, 1,
        "a bounded walk reads one buffer; an unbounded one reads the directory out"
    );
}

#[test]
fn the_remote_class_must_be_asked_with_the_size_it_documents() {
    // The check reads nothing out of this class -- whether the call answers at
    // all is the whole finding -- which makes the declared size the only thing
    // that can silently disable it. Windows validates the length before it
    // consults the object, so a buffer one byte short is refused for its length
    // on a local file and a remote one alike, and "did it succeed" then means
    // "local" everywhere.
    //
    // That is not hypothetical. This adapter shipped 88 bytes for a 116-byte
    // structure, and the refusal it advertised could not occur. So the two
    // failures are told apart here by their reasons, on an ordinary local
    // directory that any machine has.
    let tree = TestTree::new("remote-size");
    let handle = super::super::windows::open_no_follow(tree.path()).expect("a local root opens");

    let short = super::super::windows::ask_remote_protocol(&handle, 88);
    let short_error = std::io::Error::last_os_error().raw_os_error();
    let documented = super::super::windows::ask_remote_protocol(
        &handle,
        super::super::windows::REMOTE_PROTOCOL_INFO_BYTES,
    );
    let documented_error = std::io::Error::last_os_error().raw_os_error();

    // ERROR_BAD_LENGTH: refused before the object was looked at.
    assert_eq!((short, short_error), (0, Some(24)));
    // ERROR_INVALID_PARAMETER: the documented answer for a local object, which
    // is the one the check is entitled to read.
    assert_eq!((documented, documented_error), (0, Some(87)));
    assert_eq!(super::super::windows::REMOTE_PROTOCOL_INFO_BYTES, 116);
}

#[test]
#[ignore = "needs the local administrative share; run with --ignored"]
fn a_loopback_share_is_seen_as_the_remote_object_it_is() {
    // The positive direction, which needs something genuinely reached over a
    // remote protocol. `\\localhost\C$` is served by the SMB redirector and is
    // remote in every sense this check cares about, but it needs the
    // administrative share, so this is ignored by default rather than skipped
    // silently: `cargo test -- --ignored` runs it, and a suite that quietly
    // passed when the share was absent would retire the claim instead of
    // checking it.
    let handle = super::super::windows::open_no_follow(Path::new(r"\\localhost\C$\Windows"))
        .expect("the administrative share opens; this test is ignored when it does not");

    assert!(super::super::windows::is_remote_object(&handle));
}

/// Restores the process working directory however the test ends.
struct WorkingDirectory(PathBuf);

impl WorkingDirectory {
    fn moved_to(target: &Path) -> Self {
        let previous = std::env::current_dir().expect("a working directory");
        std::env::set_current_dir(target).expect("the share is reachable as a working directory");
        Self(previous)
    }
}

impl Drop for WorkingDirectory {
    fn drop(&mut self) {
        let _ = std::env::set_current_dir(&self.0);
    }
}

#[test]
#[ignore = "needs the local administrative share and moves the process working directory; run with --ignored"]
fn a_root_that_reaches_a_share_without_naming_one_is_refused() {
    // That the handle is asked at all, rather than that it answers correctly.
    // Those are two different claims, and the test above only makes the second:
    // it calls the primitive directly, so deleting the call inside `open_root`
    // leaves it green.
    //
    // Reaching the wiring needs a root that is genuinely remote and that the
    // path test lets through, and `is_remote_root` lets a relative path through
    // by design -- it names no volume that can be read out of the text. So the
    // process stands on the share and asks for a relative root. This is the
    // second case ADR 0007 names, "a relative path resolved against a mapped
    // drive", and the only one reachable here without the symbolic-link
    // privilege the first would need.
    let _restore = WorkingDirectory::moved_to(Path::new(r"\\localhost\C$"));

    let error = discover_mzml_candidates(Path::new("Windows"), DiscoveryBudget::default())
        .expect_err("a root on a share is refused however it was spelled");

    assert_eq!(error.kind(), DiscoveryErrorKind::RemoteRootUnsupported);
}

#[test]
fn a_real_local_root_is_not_mistaken_for_a_remote_one() {
    // Half of the remote check, and the half every machine can answer without a
    // share: asking the opened handle is only worth doing if it stays quiet
    // about ordinary local folders, since a check that refused those would
    // refuse every walk. The two tests above make the other half -- that a
    // genuinely remote object answers, and that `open_root` is what asks it --
    // and both are ignored by default rather than skipped in silence, because a
    // machine without the share has to be told the claim went unchecked instead
    // of shown a green run.
    let tree = TestTree::new("local");
    tree.file("sample.mzML", 4);

    let result = walk_real(tree.path());

    assert_eq!(names(&result), vec!["sample.mzML"]);
    assert!(result.is_complete());
}

#[test]
fn discovery_reads_nothing_and_changes_nothing_on_disk() {
    let tree = TestTree::new("read-only");
    let file = tree.file("sample.mzML", 32);
    let before = fs::metadata(&file).expect("metadata before");

    let result = walk_real(tree.path());

    let after = fs::metadata(&file).expect("metadata after");
    assert_eq!(names(&result), vec!["sample.mzML"]);
    assert_eq!(before.len(), after.len());
    assert_eq!(
        before.modified().expect("modified before"),
        after.modified().expect("modified after")
    );
    assert!(file.exists());
}
