use std::fs;
use std::path::{Path, PathBuf};

use crate::local_document;
use crate::preview::PreviewService;
use crate::preview::dto::DatasetSourceKindDto;
use crate::preview::idle_provider::NoProcess;
use crate::preview::service::workspace_rows::{LiveRow, RowMember};
use crate::project::tests::Scratch;

use super::*;

fn profile(scratch: &Scratch) -> PathBuf {
    scratch.join("profile")
}

fn reopen(scratch: &Scratch) -> WorkspaceRestoreStore {
    WorkspaceRestoreStore::open(Ok(profile(scratch)))
}

fn stored_bytes(scratch: &Scratch) -> Vec<u8> {
    fs::read(profile(scratch).join(FILE_NAME)).expect("the stored document")
}

fn stored(scratch: &Scratch) -> RestoreDocument {
    read_document(&stored_bytes(scratch)).expect("a usable document")
}

fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .expect("the directory")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// A live row built from a file on disk, as admission would record it.
fn live(handle: &str, path: &Path) -> LiveRow {
    LiveRow {
        handle: handle.to_owned(),
        family: DatasetSourceKindDto::Mzml,
        members: vec![RowMember {
            path: path.to_path_buf(),
            byte_length: fs::metadata(path).expect("the file").len(),
            identity: local_document::object_identity(path).expect("an identity"),
        }],
        not_verified: None,
    }
}

fn ungrouped(handles: &[&str]) -> WorkspaceArrangementDto {
    WorkspaceArrangementDto {
        groups: vec![ArrangedGroupDto {
            name: None,
            handles: handles.iter().map(|handle| (*handle).to_owned()).collect(),
        }],
        checked: Vec::new(),
    }
}

#[track_caller]
fn restored(store: &WorkspaceRestoreStore) -> Vec<RestoredGroupDto> {
    match store.read() {
        WorkspaceRestoreReadDto::Restored { groups, .. } => groups,
        other => panic!("expected restored rows, got {other:?}"),
    }
}

fn states(groups: &[RestoredGroupDto]) -> Vec<(String, RowState)> {
    groups
        .iter()
        .flat_map(|group| &group.rows)
        .map(|row| (row.display_name.clone(), row.state))
        .collect()
}

/// A member recorded on the volume its path is on, as admission would record
/// it, so a missing one reads missing, not unreachable.
fn member(path: &Path) -> StoredMember {
    StoredMember {
        path: path.to_str().expect("a Unicode path").to_owned(),
        byte_length: 1,
        volume_serial: path
            .ancestors()
            .find_map(local_document::directory_volume)
            .unwrap_or(7),
        file_id: "0123456789abcdef0123456789abcdef".to_owned(),
    }
}

fn row_at(path: &Path) -> StoredRow {
    StoredRow {
        family: Family::Mzml,
        checked: false,
        offered: 0,
        members: vec![member(path)],
        not_verified_by_mscanvas: None,
    }
}

fn write_stored(scratch: &Scratch, bytes: &[u8]) {
    fs::create_dir_all(profile(scratch)).expect("the profile");
    fs::write(profile(scratch).join(FILE_NAME), bytes).expect("the stored bytes");
}

/// The one file kept aside beside the published document, and its bytes.
fn kept_aside(scratch: &Scratch) -> Vec<u8> {
    let names = entries(&profile(scratch));
    let aside: Vec<&String> = names
        .iter()
        .filter(|name| name.starts_with(SET_ASIDE_PREFIX))
        .collect();
    assert_eq!(aside.len(), 1, "exactly one document kept aside: {names:?}");
    assert_eq!(names.len(), 2, "the published document and the kept one");
    fs::read(profile(scratch).join(aside[0])).expect("the kept document")
}

fn refused_start(problem: &'static str) -> WorkspaceRestoreReadDto {
    WorkspaceRestoreReadDto::Refused {
        problem,
        leftover_copies: 0,
    }
}

const OFF: WorkspaceRestoreReadDto = WorkspaceRestoreReadDto::Off { leftover_copies: 0 };

const KEPT: WorkspaceRestoreWriteDto = WorkspaceRestoreWriteDto::Refused {
    problem: "storedDocumentKept",
};

// ----------------------------------------------------------------- document

#[test]
fn a_document_round_trips_and_anything_else_is_refused_whole() {
    let scratch = Scratch::new("restore-document");
    let document = RestoreDocument {
        schema_version: SCHEMA_VERSION,
        enabled: true,
        groups: vec![
            StoredGroup {
                name: Some("Batch A".to_owned()),
                rows: vec![StoredRow {
                    family: Family::SciexWiff,
                    checked: true,
                    offered: 1,
                    members: vec![
                        member(&scratch.join("s.wiff")),
                        member(&scratch.join("s.wiff.scan")),
                    ],
                    not_verified_by_mscanvas: None,
                }],
            },
            StoredGroup {
                name: None,
                rows: vec![row_at(&scratch.join("a.mzML"))],
            },
        ],
    };
    let bytes = write_document(&document);
    assert_eq!(read_document(&bytes), Ok(document.clone()));

    let text = String::from_utf8(bytes).expect("UTF-8");
    let newer = text.replace("\"schemaVersion\":1", "\"schemaVersion\":2");
    assert_eq!(
        read_document(newer.as_bytes()),
        Err(DocumentProblem::NewerVersion)
    );
    let older = text.replace("\"schemaVersion\":1", "\"schemaVersion\":0");
    assert_eq!(
        read_document(older.as_bytes()),
        Err(DocumentProblem::UnsupportedVersion)
    );
    let unknown = text.replace("\"enabled\":true", "\"enabled\":true,\"preview\":1");
    assert_eq!(
        read_document(unknown.as_bytes()),
        Err(DocumentProblem::Malformed)
    );
    let off_with_rows = text.replace("\"enabled\":true", "\"enabled\":false");
    assert_eq!(
        read_document(off_with_rows.as_bytes()),
        Err(DocumentProblem::Malformed),
        "an off document never holds a path"
    );
    let relative = text.replace(
        &serde_json::to_string(&document.groups[1].rows[0].members[0].path).expect("JSON"),
        "\"a.mzML\"",
    );
    assert_eq!(
        read_document(relative.as_bytes()),
        Err(DocumentProblem::Malformed)
    );
    let mut two_ungrouped = document.clone();
    two_ungrouped.groups[0].name = None;
    assert_eq!(
        read_document(&write_document(&two_ungrouped)),
        Err(DocumentProblem::Malformed)
    );
    assert_eq!(read_document(b"{}"), Err(DocumentProblem::Malformed));
}

// ----------------------------------------------------------------- restore

#[test]
fn a_restart_restores_rows_groups_order_and_checked_state_without_paths() {
    let scratch = Scratch::new("restore-round-trip");
    let paths: Vec<PathBuf> = ["a.mzML", "b.mzML", "c.mzML"]
        .iter()
        .map(|name| scratch.write(name, b"<mzML/>"))
        .collect();
    let service = PreviewService::new(Box::new(NoProcess));
    let added = service.add_files(&paths).expect("the batch");
    let handles: Vec<String> = added
        .roster
        .datasets
        .iter()
        .map(|row| row.handle.clone())
        .collect();
    let arrangement = WorkspaceArrangementDto {
        groups: vec![
            ArrangedGroupDto {
                name: Some("Batch".to_owned()),
                handles: vec![handles[2].clone(), handles[0].clone()],
            },
            ArrangedGroupDto {
                name: None,
                handles: vec![handles[1].clone()],
            },
        ],
        checked: vec![handles[0].clone()],
    };
    let store = reopen(&scratch);
    assert_eq!(restored(&store), Vec::new(), "a first run restores nothing");
    assert_eq!(
        store.save(&arrangement, service.workspace_restore_rows()),
        WorkspaceRestoreWriteDto::Saved
    );
    drop(service);

    let read = reopen(&scratch).read();
    let row = |handle: &str, name: &str, checked| RestoredRowDto {
        handle: handle.to_owned(),
        source_kind: Family::Mzml,
        display_name: name.to_owned(),
        context: None,
        checked,
        state: RowState::Matching,
    };
    assert_eq!(
        read,
        WorkspaceRestoreReadDto::Restored {
            groups: vec![
                RestoredGroupDto {
                    name: Some("Batch".to_owned()),
                    rows: vec![
                        row("restored-0", "c.mzML", false),
                        row("restored-1", "a.mzML", true),
                    ],
                },
                RestoredGroupDto {
                    name: None,
                    rows: vec![row("restored-2", "b.mzML", false)],
                },
            ],
            expired: 0,
            leftover_copies: 0,
        }
    );
    let wire = serde_json::to_string(&read).expect("the wire form");
    assert!(
        wire.contains(r#""sourceKind":"mzml""#),
        "the roster's own key: {wire}"
    );
    let folder = scratch
        .directory()
        .file_name()
        .and_then(|name| name.to_str())
        .expect("the scratch folder name");
    assert!(
        !wire.contains(folder),
        "no path crosses the boundary: {wire}"
    );
}

#[test]
fn a_missing_or_changed_file_is_a_marked_row_never_dropped_or_relinked() {
    let scratch = Scratch::new("restore-marked");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    let c = scratch.write("c.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    let live_rows = vec![live("file-0", &a), live("file-1", &b), live("file-2", &c)];
    assert_eq!(
        store.save(&ungrouped(&["file-0", "file-1", "file-2"]), live_rows),
        WorkspaceRestoreWriteDto::Saved
    );
    let recorded = stored(&scratch);

    fs::remove_file(&a).expect("remove a");
    // Another object at b's name, at the same length: only its identity says so.
    fs::remove_file(&b).expect("remove b");
    fs::write(&b, b"<mzML/>").expect("replace b");
    // The same object at c's name, longer.
    fs::write(&c, b"<mzML></mzML>").expect("rewrite c");

    let store = reopen(&scratch);
    assert_eq!(
        states(&restored(&store)),
        vec![
            ("a.mzML".to_owned(), RowState::Missing),
            ("b.mzML".to_owned(), RowState::Changed),
            ("c.mzML".to_owned(), RowState::Changed),
        ]
    );
    // Reading changed nothing on disk: no relink, no new baseline.
    assert_eq!(stored(&scratch), recorded);

    // A save that leaves one of them out would drop it, so it is refused.
    let before = stored_bytes(&scratch);
    assert_eq!(
        store.save(&ungrouped(&["restored-0", "restored-1"]), Vec::new()),
        WorkspaceRestoreWriteDto::Refused {
            problem: "staleArrangement"
        }
    );
    assert_eq!(
        store.save(
            &ungrouped(&["restored-0", "restored-0", "restored-1"]),
            Vec::new()
        ),
        WorkspaceRestoreWriteDto::Refused {
            problem: "invalidArrangement"
        }
    );
    assert_eq!(stored_bytes(&scratch), before);

    // One that places all three keeps their recorded facts, not today's. A
    // marked row is an offer nobody could take, so nothing is counted.
    let order = ["restored-2", "restored-0", "restored-1"];
    assert_eq!(
        store.save(&ungrouped(&order), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );
    let rows = &recorded.groups[0].rows;
    let reordered = vec![rows[2].clone(), rows[0].clone(), rows[1].clone()];
    assert_eq!(stored(&scratch).groups[0].rows, reordered);

    // So it is offered at every later start, however many sessions save.
    for _ in 0..3 {
        let store = reopen(&scratch);
        match store.read() {
            WorkspaceRestoreReadDto::Restored {
                groups, expired, ..
            } => {
                assert_eq!(expired, 0);
                assert_eq!(states(&groups).len(), 3);
            }
            other => panic!("expected restored rows, got {other:?}"),
        }
        assert_eq!(
            store.save(
                &ungrouped(&["restored-0", "restored-1", "restored-2"]),
                Vec::new()
            ),
            WorkspaceRestoreWriteDto::Saved
        );
        assert_eq!(stored(&scratch).groups[0].rows, reordered);
    }
}

#[test]
fn a_bundle_without_its_companion_or_a_folder_in_a_files_place_is_marked() {
    let scratch = Scratch::new("restore-marked-more");
    let wiff = scratch.write("s.wiff", b"wiff");
    let scan = scratch.write("s.wiff.scan", b"scan");
    let folder = scratch.write("f.mzML", b"<mzML/>");
    let held = scratch.write("h.mzML", b"<mzML/>");
    let mut bundle = live("file-0", &wiff);
    bundle.family = DatasetSourceKindDto::SciexWiff;
    bundle.members.extend(live("file-0", &scan).members);
    let store = reopen(&scratch);
    assert_eq!(
        store.save(
            &ungrouped(&["file-0", "file-1", "file-2"]),
            vec![bundle, live("file-1", &folder), live("file-2", &held)]
        ),
        WorkspaceRestoreWriteDto::Saved
    );

    // Only the companion is gone: the primary alone still matches.
    fs::remove_file(&scan).expect("remove the companion");
    fs::remove_file(&folder).expect("remove f");
    fs::create_dir(&folder).expect("a folder at f's name");
    #[cfg(windows)]
    let _held = {
        use std::os::windows::fs::OpenOptionsExt as _;
        fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&held)
            .expect("the holding handle")
    };
    let marked = states(&restored(&reopen(&scratch)));
    assert_eq!(marked[0], ("s.wiff".to_owned(), RowState::Missing));
    assert_eq!(marked[1], ("f.mzML".to_owned(), RowState::Unsafe));
    // Held without any sharing: the check asks for attributes only, so it
    // neither fails on that hold nor conflicts with it.
    assert_eq!(marked[2], ("h.mzML".to_owned(), RowState::Matching));
}

#[cfg(windows)]
#[test]
fn a_path_on_a_drive_that_does_not_answer_is_unreachable_not_missing() {
    let scratch = Scratch::new("restore-unreachable");
    let absent = ('D'..='Z')
        .rev()
        .map(|letter| format!("{letter}:\\"))
        .find(|root| fs::metadata(root).is_err())
        .expect("an unassigned drive letter");
    let away = PathBuf::from(&absent).join("data").join("a.mzML");
    let gone = scratch.join("gone").join("b.mzML");
    // Recorded on another volume than the one now answering at its place: the
    // disk that held it is gone and its letter leads elsewhere.
    let reused = scratch.join("data").join("c.mzML");
    let mut elsewhere = row_at(&reused);
    elsewhere.members[0].volume_serial = elsewhere.members[0].volume_serial.wrapping_add(1);
    let document = RestoreDocument {
        groups: vec![StoredGroup {
            name: None,
            rows: vec![row_at(&away), row_at(&gone), elsewhere],
        }],
        ..RestoreDocument::empty(true)
    };
    write_stored(&scratch, &write_document(&document));
    // Three starts, each saving without putting anything back: no row could
    // be taken, so none ages out.
    for start in 0..3 {
        let store = reopen(&scratch);
        assert_eq!(
            states(&restored(&store)),
            vec![
                ("a.mzML".to_owned(), RowState::Unreachable),
                ("b.mzML".to_owned(), RowState::Missing),
                ("c.mzML".to_owned(), RowState::Unreachable),
            ],
            "a removed disk is not a deleted file; a removed folder on a drive that answers is"
        );
        assert!(
            matches!(
                store.read(),
                WorkspaceRestoreReadDto::Restored { expired: 0, .. }
            ),
            "start {start}"
        );
        assert_eq!(
            store.save(
                &ungrouped(&["restored-0", "restored-1", "restored-2"]),
                Vec::new()
            ),
            WorkspaceRestoreWriteDto::Saved
        );
    }
    assert_eq!(stored(&scratch), document);
    assert_eq!(
        super::absent(7, None),
        RowState::Missing,
        "a volume not read"
    );
}

#[test]
fn an_older_save_reaching_the_store_last_never_takes_a_newer_row_out() {
    let scratch = Scratch::new("restore-order");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    let roster = || vec![live("file-0", &a), live("file-1", &b)];
    assert_eq!(
        store.save_with(&ungrouped(&["file-0", "file-1"]), roster),
        WorkspaceRestoreWriteDto::Saved
    );
    // Arranged before file-1 was added and arriving last: the registry is
    // read only once this save is the one saving, so it meets file-1.
    let snapshot = || {
        assert!(store.saves.try_lock().is_err(), "read while saving");
        roster()
    };
    assert_eq!(
        store.save_with(&ungrouped(&["file-0"]), snapshot),
        WorkspaceRestoreWriteDto::Refused {
            problem: "staleArrangement"
        }
    );
    assert_eq!(stored(&scratch).groups[0].rows.len(), 2);
}

#[cfg(windows)]
#[test]
fn a_path_that_is_not_unicode_is_refused_rather_than_written_as_something_else() {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt as _, OsStringExt as _};

    let scratch = Scratch::new("restore-not-storable");
    let mut wide: Vec<u16> = scratch.join("x").as_os_str().encode_wide().collect();
    wide.push(0xD800);
    let row = LiveRow {
        handle: "file-0".to_owned(),
        family: DatasetSourceKindDto::Mzml,
        members: vec![RowMember {
            path: PathBuf::from(OsString::from_wide(&wide)),
            byte_length: 1,
            identity: (7, [1; 16]),
        }],
        not_verified: None,
    };
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![row]),
        WorkspaceRestoreWriteDto::Refused {
            problem: "notStorable"
        }
    );
    assert!(!profile(&scratch).exists(), "nothing was written");
}

#[test]
fn a_corrupt_document_is_left_as_found_and_restore_stays_off_until_turned_on() {
    let scratch = Scratch::new("restore-corrupt");
    write_stored(&scratch, b"{ not a document");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    assert_eq!(store.read(), refused_start("malformed"));

    // Fail closed: nothing is recorded, and nothing is written at all.
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Off
    );
    assert_eq!(stored_bytes(&scratch), b"{ not a document");
    assert_eq!(entries(&profile(&scratch)), vec![FILE_NAME.to_owned()]);
    assert_eq!(
        reopen(&scratch).read(),
        refused_start("malformed"),
        "a restart still refuses it, and is still off"
    );

    // Turning restore on keeps the refused document aside, then starts empty.
    assert_eq!(store.set_enabled(true), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(kept_aside(&scratch), b"{ not a document");
    assert_eq!(stored(&scratch), RestoreDocument::empty(true));
    assert_eq!(
        store.read(),
        WorkspaceRestoreReadDto::Restored {
            groups: Vec::new(),
            expired: 0,
            leftover_copies: 1,
        },
        "no longer answered as refused, and the kept copy is counted"
    );
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows.len(), 1);
    assert_eq!(kept_aside(&scratch), b"{ not a document");
}

#[test]
fn a_switched_off_document_from_a_newer_build_keeps_restore_off() {
    let scratch = Scratch::new("restore-newer");
    let newer = br#"{"schemaVersion":2,"enabled":false,"groups":[],"layers":[]}"#;
    write_stored(&scratch, newer);
    let a = scratch.write("a.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    assert_eq!(store.read(), refused_start("newerVersion"));
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Off,
        "no path is recorded over a choice this build cannot read"
    );
    assert_eq!(stored_bytes(&scratch), newer, "kept byte for byte");
    assert_eq!(entries(&profile(&scratch)), vec![FILE_NAME.to_owned()]);

    // Off and clear are the user forgetting: they replace it, keeping nothing.
    assert_eq!(store.set_enabled(false), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(stored(&scratch), RestoreDocument::empty(false));
    assert_eq!(entries(&profile(&scratch)), vec![FILE_NAME.to_owned()]);
    assert_eq!(store.read(), OFF);
}

#[test]
fn an_oversized_document_is_refused_without_being_parsed() {
    let scratch = Scratch::new("restore-oversized");
    let bound = usize::try_from(MAX_DOCUMENT_BYTES).expect("fits");
    write_stored(&scratch, &vec![b' '; bound + 1]);
    assert_eq!(reopen(&scratch).read(), refused_start("oversized"));
}

#[test]
fn an_unsafe_name_is_left_where_it_is_and_never_replaced() {
    let scratch = Scratch::new("restore-unsafe");
    fs::create_dir_all(profile(&scratch).join(FILE_NAME)).expect("a directory at the name");
    let store = reopen(&scratch);
    assert_eq!(store.read(), refused_start("unsafeTarget"));
    assert_eq!(store.save(&ungrouped(&[]), Vec::new()), KEPT);
    assert_eq!(store.clear(), KEPT);
    assert_eq!(store.set_enabled(true), KEPT);
    assert_eq!(store.set_enabled(false), KEPT);
    assert!(profile(&scratch).join(FILE_NAME).is_dir());
}

#[test]
fn a_refused_document_that_cannot_be_kept_aside_is_never_replaced_by_turning_on() {
    let scratch = Scratch::new("restore-no-aside");
    write_stored(&scratch, b"{ not a document");
    let store = reopen(&scratch);
    // Every name a set-aside could take in the next few seconds is taken.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after the epoch")
        .as_secs();
    for seconds in now.saturating_sub(1)..=now + 5 {
        let name = format!("{SET_ASIDE_PREFIX}{seconds}-{}.json", std::process::id());
        fs::create_dir(profile(&scratch).join(name)).expect("an occupied name");
    }
    assert_eq!(store.set_enabled(true), KEPT);
    assert_eq!(stored_bytes(&scratch), b"{ not a document");
    assert_eq!(
        store.read(),
        WorkspaceRestoreReadDto::Refused {
            problem: "malformed",
            // The seven occupied names carry the kept-aside prefix.
            leftover_copies: 7,
        }
    );
}

#[cfg(windows)]
#[test]
fn an_unreadable_document_is_left_as_found_and_read_again_at_the_next_start() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let scratch = Scratch::new("restore-unreadable-document");
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let before = stored_bytes(&scratch);
    // No sharing at all: this process cannot open it while the handle lives.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(profile(&scratch).join(FILE_NAME))
        .expect("the holding handle");
    let store = reopen(&scratch);
    drop(held);
    assert_eq!(store.read(), refused_start("unreadable"));
    assert_eq!(store.save(&ungrouped(&[]), Vec::new()), KEPT);
    assert_eq!(store.set_enabled(true), KEPT);
    assert_eq!(stored_bytes(&scratch), before);
    assert_eq!(entries(&profile(&scratch)), vec![FILE_NAME.to_owned()]);
    assert_eq!(states(&restored(&reopen(&scratch))).len(), 1);
}

#[test]
fn a_second_process_never_writes_over_the_first_ones_record() {
    let scratch = Scratch::new("restore-two-processes");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    let first = reopen(&scratch);
    let second = reopen(&scratch);
    assert_eq!(
        first.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let changed_elsewhere = WorkspaceRestoreWriteDto::Refused {
        problem: "changedElsewhere",
    };
    assert_eq!(
        second.save(&ungrouped(&["file-0"]), vec![live("file-0", &b)]),
        changed_elsewhere
    );
    assert_eq!(second.set_enabled(false), WorkspaceRestoreWriteDto::Saved);
    // The second turned it off; the first does not turn it back on or record
    // its paths again, even though it never switched off itself.
    assert_eq!(first.set_enabled(true), changed_elsewhere);
    assert_eq!(
        first.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        changed_elsewhere
    );
    // Its own write since does not make the refused window a recorder again.
    assert_eq!(second.set_enabled(true), changed_elsewhere);
    // Nor does forgetting: a clear in a refused window leaves restore off,
    // and says it did.
    assert_eq!(
        first.clear(),
        WorkspaceRestoreWriteDto::TurnedOff {
            problem: "changedElsewhere"
        }
    );
    assert_eq!(first.read(), OFF);
    assert_eq!(
        first.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Off
    );
    assert_eq!(first.set_enabled(true), changed_elsewhere);
    assert_eq!(stored(&scratch), RestoreDocument::empty(false));
}

#[test]
fn a_clear_never_undoes_another_windows_off() {
    let scratch = Scratch::new("restore-two-clear");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let first = reopen(&scratch);
    let second = reopen(&scratch);
    assert_eq!(
        first.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(second.set_enabled(false), WorkspaceRestoreWriteDto::Saved);

    // The first has not been refused yet and still holds "on": the switch the
    // other window left is not known here, so the clear writes off and says so.
    assert_eq!(
        first.clear(),
        WorkspaceRestoreWriteDto::TurnedOff {
            problem: "changedElsewhere"
        }
    );
    assert_eq!(stored(&scratch), RestoreDocument::empty(false));
    assert_eq!(
        first.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Off
    );
    assert_eq!(
        first.set_enabled(true),
        WorkspaceRestoreWriteDto::Refused {
            problem: "changedElsewhere"
        }
    );
    let path = serde_json::to_string(a.to_str().expect("Unicode")).expect("JSON");
    let text = String::from_utf8(stored_bytes(&scratch)).expect("UTF-8");
    assert!(!text.contains(&path), "no path is stored: {text}");
}

#[test]
fn a_clear_over_another_windows_on_says_it_turned_restore_off() {
    let scratch = Scratch::new("restore-clear-over-on");
    write_stored(&scratch, &write_document(&RestoreDocument::empty(false)));
    let first = reopen(&scratch);
    let second = reopen(&scratch);
    assert_eq!(second.set_enabled(true), WorkspaceRestoreWriteDto::Saved);
    // The first was off itself, but the name held the second's on.
    assert_eq!(
        first.clear(),
        WorkspaceRestoreWriteDto::TurnedOff {
            problem: "changedElsewhere"
        }
    );
    assert_eq!(stored(&scratch), RestoreDocument::empty(false));
}

#[test]
fn a_retry_after_a_failed_turn_on_keeps_one_copy_aside() {
    let scratch = Scratch::new("restore-aside-once");
    write_stored(&scratch, b"{ not a document");
    let store = reopen(&scratch);
    // Every private sibling name a publish of this process tries is taken.
    let blockers: Vec<PathBuf> = (0..8)
        .map(|attempt| {
            let name = format!("{TEMPORARY_PREFIX}{}-{attempt}.tmp", std::process::id());
            let path = profile(&scratch).join(name);
            fs::write(&path, b"").expect("a blocking file");
            path
        })
        .collect();
    assert_eq!(
        store.set_enabled(true),
        WorkspaceRestoreWriteDto::Failed {
            problem: "notWritten",
            retryable: true,
            temporary_left_behind: false
        }
    );
    assert_eq!(stored_bytes(&scratch), b"{ not a document");
    for path in blockers {
        fs::remove_file(path).expect("unblock");
    }
    assert_eq!(store.set_enabled(true), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(kept_aside(&scratch), b"{ not a document");
    assert_eq!(stored(&scratch), RestoreDocument::empty(true));
}

#[test]
fn a_restored_row_that_is_back_in_the_workbench_is_recorded_once() {
    let scratch = Scratch::new("restore-once");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(
            &ungrouped(&["file-0", "file-1"]),
            vec![live("file-0", &a), live("file-1", &b)]
        ),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    // `a` is back in the Workbench as `file-7`, and still a restored row.
    assert_eq!(
        store.save(
            &ungrouped(&["restored-1", "file-7", "restored-0"]),
            vec![live("file-7", &a)]
        ),
        WorkspaceRestoreWriteDto::Saved
    );
    let rows = &stored(&scratch).groups[0].rows;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].members[0].path, b.to_str().expect("Unicode"));
    assert_eq!(rows[1].members[0].path, a.to_str().expect("Unicode"));
    // Saved without a read, so nothing was offered and nothing is counted.
    assert_eq!(rows[0].offered, 0);
    assert_eq!(rows[1].offered, 0);
}

#[test]
fn another_object_at_the_recorded_path_added_again_keeps_its_restored_row() {
    let scratch = Scratch::new("restore-not-once");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let wiff = scratch.write("s.wiff", b"wiff");
    let scan = scratch.write("s.wiff.scan", b"scan");
    let bundle = |handle: &str| {
        let mut row = live(handle, &wiff);
        row.family = DatasetSourceKindDto::SciexWiff;
        row.members.extend(live(handle, &scan).members);
        row
    };
    assert_eq!(
        reopen(&scratch).save(
            &ungrouped(&["file-0", "file-1"]),
            vec![live("file-0", &a), bundle("file-1")]
        ),
        WorkspaceRestoreWriteDto::Saved
    );
    let recorded = stored(&scratch).groups[0].rows.clone();

    // Another object at a's path, and a bundle with only its companion
    // replaced; both are added again.
    fs::remove_file(&a).expect("remove a");
    fs::write(&a, b"<mzML/>").expect("replace a");
    fs::remove_file(&scan).expect("remove the companion");
    fs::write(&scan, b"scan").expect("replace the companion");
    let store = reopen(&scratch);
    assert_eq!(
        store.save(
            &ungrouped(&["restored-0", "restored-1", "file-0", "file-1"]),
            vec![live("file-0", &a), bundle("file-1")]
        ),
        WorkspaceRestoreWriteDto::Saved
    );
    let rows = &stored(&scratch).groups[0].rows;
    assert_eq!(
        rows.len(),
        4,
        "neither restored row is taken for a live one"
    );
    assert_eq!(rows[0].members, recorded[0].members, "the recorded facts");
    assert_eq!(rows[1].members, recorded[1].members, "the recorded facts");
}

#[test]
fn a_row_not_put_back_is_offered_once_more_then_reported_and_never_accumulates() {
    let scratch = Scratch::new("restore-lifetime");
    let files: Vec<PathBuf> = ["a.mzML", "b.mzML", "c.mzML"]
        .iter()
        .map(|name| scratch.write(name, b"<mzML/>"))
        .collect();
    let offer = |store: &WorkspaceRestoreStore| match store.read() {
        WorkspaceRestoreReadDto::Restored {
            groups, expired, ..
        } => {
            let rows: Vec<&RestoredRowDto> = groups.iter().flat_map(|g| &g.rows).collect();
            (
                rows.iter()
                    .map(|row| row.display_name.clone())
                    .collect::<Vec<_>>(),
                expired,
                rows.iter()
                    .map(|row| row.handle.clone())
                    .collect::<Vec<_>>(),
            )
        }
        other => panic!("expected restored rows, got {other:?}"),
    };
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &files[0])]),
        WorkspaceRestoreWriteDto::Saved
    );

    // Each session leaves the offer untaken and works on another file.
    for (session, file) in files.iter().enumerate().skip(1) {
        let store = reopen(&scratch);
        let (names, expired, handles) = offer(&store);
        let previous = files[session - 1].file_name().and_then(OsStr::to_str);
        assert_eq!(names, vec![previous.expect("a name").to_owned()]);
        assert_eq!(expired, u32::from(session > 1), "session {session}");
        // The expired row keeps its slot, so the offer's handle skips it.
        assert_eq!(
            handles,
            vec![format!("restored-{}", u32::from(session > 1))]
        );
        assert_eq!(
            store.save(
                &ungrouped(&[handles[0].as_str(), "file-0"]),
                vec![live("file-0", file)]
            ),
            WorkspaceRestoreWriteDto::Saved
        );
        assert_eq!(
            stored(&scratch).groups[0].rows.len(),
            2,
            "the last session and its untaken offer, never more"
        );
    }

    // A start that saves nothing ages nothing: the same offer, the same notice.
    let expected = (vec!["c.mzML".to_owned()], 1, vec!["restored-1".to_owned()]);
    assert_eq!(offer(&reopen(&scratch)), expected);
    assert_eq!(offer(&reopen(&scratch)), expected);
}

#[test]
fn a_row_declined_while_matching_and_then_gone_is_marked_not_aged_out() {
    let scratch = Scratch::new("restore-declined-gone");
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    // Seen matching and saved without being taken: declined once.
    let store = reopen(&scratch);
    assert_eq!(
        states(&restored(&store)),
        vec![("a.mzML".to_owned(), RowState::Matching)]
    );
    assert_eq!(
        store.save(&ungrouped(&["restored-0"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows[0].offered, MAX_OFFERS);

    // Gone before the next start: shown as missing, not retired.
    fs::remove_file(&a).expect("remove a");
    let store = reopen(&scratch);
    assert_eq!(
        store.read(),
        WorkspaceRestoreReadDto::Restored {
            groups: vec![RestoredGroupDto {
                name: None,
                rows: vec![RestoredRowDto {
                    handle: "restored-0".to_owned(),
                    source_kind: Family::Mzml,
                    display_name: "a.mzML".to_owned(),
                    context: None,
                    checked: false,
                    state: RowState::Missing,
                }],
            }],
            expired: 0,
            leftover_copies: 0,
        }
    );
    assert_eq!(
        store.save(&ungrouped(&["restored-0"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows.len(), 1, "still recorded");
}

#[test]
fn a_row_no_longer_offered_leaves_the_document_only_after_a_read_reported_it() {
    let scratch = Scratch::new("restore-expired-reported");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    assert_eq!(restored(&store)[0].rows.len(), 1);
    assert_eq!(
        store.save(&ungrouped(&["restored-0"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );

    // Before any read nothing is expired, so a save that places only the
    // live rows would drop a row nobody was told about, and is refused.
    let before = stored_bytes(&scratch);
    let store = reopen(&scratch);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &b)]),
        WorkspaceRestoreWriteDto::Refused {
            problem: "staleArrangement"
        }
    );
    assert_eq!(stored_bytes(&scratch), before);

    // Once a read has reported it, a save leaves it out.
    assert!(matches!(
        store.read(),
        WorkspaceRestoreReadDto::Restored { ref groups, expired: 1, .. }
            if groups[0].rows.is_empty()
    ));
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &b)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let rows = &stored(&scratch).groups[0].rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].members[0].path, b.to_str().expect("Unicode"));
}

/// One row, offered and not taken: the next session's first read reports it as
/// no longer offered if it still matches.
fn declined_once(scratch: &Scratch, path: &Path) {
    assert_eq!(
        reopen(scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", path)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let declining = reopen(scratch);
    let _ = restored(&declining);
    assert_eq!(
        declining.save(&ungrouped(&["restored-0"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );
}

#[track_caller]
fn expired_count(store: &WorkspaceRestoreStore) -> u32 {
    match store.read() {
        WorkspaceRestoreReadDto::Restored { expired, .. } => expired,
        other => panic!("expected restored rows, got {other:?}"),
    }
}

// Start fresh and Off end the "no longer offered" line this way: the webview has
// no reset of its own for it.
#[test]
fn a_clear_leaves_no_row_reported_as_no_longer_offered() {
    let scratch = Scratch::new("restore-expired-clear");
    declined_once(&scratch, &scratch.write("a.mzML", b"<mzML/>"));
    let store = reopen(&scratch);
    assert_eq!(expired_count(&store), 1);
    assert_eq!(store.clear(), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(expired_count(&store), 0);
}

#[test]
fn off_then_on_leaves_no_row_reported_as_no_longer_offered() {
    let scratch = Scratch::new("restore-expired-switch");
    declined_once(&scratch, &scratch.write("a.mzML", b"<mzML/>"));
    let store = reopen(&scratch);
    assert_eq!(expired_count(&store), 1);
    assert_eq!(store.set_enabled(false), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(store.set_enabled(true), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(expired_count(&store), 0);
}

#[test]
fn only_the_first_read_of_a_session_decides_what_is_no_longer_offered() {
    let scratch = Scratch::new("restore-expired-decided-once");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let away = scratch.join("a.away");
    declined_once(&scratch, &a);
    fs::rename(&a, &away).expect("a goes away");
    let store = reopen(&scratch);
    assert_eq!(
        states(&restored(&store)),
        vec![("a.mzML".to_owned(), RowState::Missing)]
    );

    // Marked at the first read, so offered this session; back, it stays offered.
    fs::rename(&away, &a).expect("a comes back, the same object");
    assert_eq!(
        states(&restored(&store)),
        vec![("a.mzML".to_owned(), RowState::Matching)]
    );
    assert_eq!(expired_count(&store), 0);
}

#[cfg(windows)]
#[test]
fn a_document_held_by_another_program_refuses_a_save_for_now_and_latches_nothing() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let scratch = Scratch::new("restore-identity-unknown");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    // No sharing at all: its identity cannot be read while the handle lives.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(profile(&scratch).join(FILE_NAME))
        .expect("the holding handle");
    let unknown = WorkspaceRestoreWriteDto::Refused {
        problem: "identityUnknown",
    };
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        unknown
    );
    assert_eq!(store.set_enabled(true), unknown);
    drop(held);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved,
        "not taken for another window's write"
    );
}

#[test]
fn the_bounds_are_1024_rows_and_the_workbench_group_name_length() {
    let scratch = Scratch::new("restore-bounds");
    let full = RestoreDocument {
        groups: vec![StoredGroup {
            name: None,
            rows: (0..MAX_ROWS)
                .map(|index| row_at(&scratch.join(&format!("row-{index}.mzML"))))
                .collect(),
        }],
        ..RestoreDocument::empty(true)
    };
    write_stored(&scratch, &write_document(&full));
    let store = reopen(&scratch);
    let groups = restored(&store);
    assert_eq!(groups[0].rows.len(), MAX_ROWS);
    assert!(
        groups[0]
            .rows
            .iter()
            .all(|row| row.state == RowState::Missing)
    );

    // One more row is one more than a restore holds; the document stays.
    let before = stored_bytes(&scratch);
    let extra = scratch.write("extra.mzML", b"<mzML/>");
    let mut handles: Vec<String> = (0..MAX_ROWS).map(|i| format!("restored-{i}")).collect();
    handles.push("file-0".to_owned());
    let handles: Vec<&str> = handles.iter().map(String::as_str).collect();
    assert_eq!(
        store.save(&ungrouped(&handles), vec![live("file-0", &extra)]),
        WorkspaceRestoreWriteDto::Refused {
            problem: "tooManyRows"
        }
    );
    assert_eq!(stored_bytes(&scratch), before);

    let mut over = full.clone();
    over.groups[0].rows.push(row_at(&extra));
    assert_eq!(
        read_document(&write_document(&over)),
        Err(DocumentProblem::Malformed)
    );

    let long_name = WorkspaceArrangementDto {
        groups: vec![
            ArrangedGroupDto {
                name: Some("x".repeat(121)),
                handles: Vec::new(),
            },
            ArrangedGroupDto {
                name: None,
                handles: handles[..MAX_ROWS]
                    .iter()
                    .map(|h| (*h).to_owned())
                    .collect(),
            },
        ],
        checked: Vec::new(),
    };
    assert_eq!(
        store.save(&long_name, Vec::new()),
        WorkspaceRestoreWriteDto::Refused {
            problem: "invalidArrangement"
        }
    );

    // Blank as the webview's `trim()` judges it, no stricter.
    assert!(!valid_group_name(""));
    assert!(!valid_group_name(" \t\u{3000}"));
    assert!(!valid_group_name("\u{FEFF}"));
    assert!(valid_group_name("\u{85}"));
}

#[test]
fn the_off_switch_forgets_every_stored_path_and_clear_keeps_the_switch() {
    let scratch = Scratch::new("restore-off");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );

    assert_eq!(store.set_enabled(false), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(stored(&scratch), RestoreDocument::empty(false));
    let store = reopen(&scratch);
    assert_eq!(store.read(), OFF);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Off
    );
    assert_eq!(stored(&scratch), RestoreDocument::empty(false));
    assert_eq!(store.clear(), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(
        stored(&scratch),
        RestoreDocument::empty(false),
        "clear keeps off"
    );

    assert_eq!(store.set_enabled(true), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    assert_eq!(restored(&store).len(), 1);
    assert_eq!(store.clear(), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(restored(&store), Vec::new());
    assert_eq!(stored(&scratch), RestoreDocument::empty(true));
    assert!(a.exists(), "no source is ever removed");
}

#[test]
fn a_session_with_nowhere_to_keep_a_document_is_usable_and_writes_nothing() {
    let store = WorkspaceRestoreStore::open(Err("rootUnresolved"));
    let unavailable = WorkspaceRestoreWriteDto::Unavailable {
        problem: "rootUnresolved",
    };
    assert_eq!(
        store.read(),
        WorkspaceRestoreReadDto::Unavailable {
            problem: "rootUnresolved"
        }
    );
    assert_eq!(store.save(&ungrouped(&[]), Vec::new()), unavailable);
    assert_eq!(store.clear(), unavailable);
    assert_eq!(store.set_enabled(false), unavailable);
}

#[cfg(windows)]
#[test]
fn a_write_that_fails_never_loses_the_previous_document() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let scratch = Scratch::new("restore-locked");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let before = stored_bytes(&scratch);
    // FILE_SHARE_READ only: readers are allowed, a replace is not.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(profile(&scratch).join(FILE_NAME))
        .expect("the holding handle");

    assert_eq!(
        store.clear(),
        WorkspaceRestoreWriteDto::Failed {
            problem: "notPublished",
            retryable: true,
            temporary_left_behind: false
        }
    );
    assert_eq!(stored_bytes(&scratch), before);
    assert_eq!(entries(&profile(&scratch)), vec![FILE_NAME.to_owned()]);
    drop(held);
    assert_eq!(store.clear(), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(
        stored(&scratch),
        RestoreDocument::empty(true),
        "a failed write is not taken for another window's"
    );
}

#[cfg(windows)]
#[test]
fn restoring_never_opens_a_source_for_writing_or_changes_it() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let scratch = Scratch::new("restore-read-only");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let store = reopen(&scratch);
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let modified = fs::metadata(&a).and_then(|m| m.modified()).expect("mtime");
    // FILE_SHARE_READ only: any open that asks to write is a sharing violation,
    // so a re-check that asked would not come back matching.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&a)
        .expect("the holding handle");
    assert_eq!(
        states(&restored(&reopen(&scratch))),
        vec![("a.mzML".to_owned(), RowState::Matching)]
    );
    drop(held);
    assert_eq!(fs::read(&a).expect("a"), b"<mzML/>");
    assert_eq!(
        fs::metadata(&a).and_then(|m| m.modified()).expect("mtime"),
        modified
    );
}

// ----------------------------------------------------------------- put-back

/// Rows an earlier session stored from real files: `a` (checked, in `Batch`)
/// and `b` (unchecked, Ungrouped, so stored first).
fn stored_a_and_b(scratch: &Scratch) -> (PathBuf, PathBuf) {
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    let arrangement = WorkspaceArrangementDto {
        groups: vec![
            ArrangedGroupDto {
                name: None,
                handles: vec!["file-1".to_owned()],
            },
            ArrangedGroupDto {
                name: Some("Batch".to_owned()),
                handles: vec!["file-0".to_owned()],
            },
        ],
        checked: vec!["file-0".to_owned()],
    };
    assert_eq!(
        reopen(scratch).save(&arrangement, vec![live("file-0", &a), live("file-1", &b)]),
        WorkspaceRestoreWriteDto::Saved
    );
    (a, b)
}

fn workspace() -> PreviewService {
    PreviewService::new(Box::new(NoProcess))
}

#[test]
fn restore_needs_a_read_first_because_only_a_read_offers_a_row() {
    let scratch = Scratch::new("restore-unread");
    stored_a_and_b(&scratch);
    let service = workspace();
    let refusal = reopen(&scratch)
        .put_back(&service)
        .expect_err("nothing has been offered");
    assert_eq!(refusal.kind, "workspace_restore_not_read");
    assert_eq!(service.workspace_restore_rows().len(), 0);
}

#[test]
fn restore_admits_the_matching_rows_and_leaves_the_marked_ones_waiting() {
    let scratch = Scratch::new("restore-put-back");
    let (_a, b) = stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    fs::remove_file(&b).expect("delete b");
    // Stored order: Ungrouped (b, restored-0), then Batch (a, restored-1).
    assert_eq!(
        states(&restored(&store)),
        vec![
            ("b.mzML".to_owned(), RowState::Missing),
            ("a.mzML".to_owned(), RowState::Matching),
        ]
    );

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");

    assert_eq!(
        service.workspace_restore_rows().len(),
        1,
        "only the matching row"
    );
    let [placed] = answer.placed.as_slice() else {
        panic!("one row placed: {:?}", answer.placed);
    };
    assert_eq!(placed.group, 1, "Batch, after Ungrouped");
    assert!(placed.checked, "the stored checked state comes back");
    assert!(placed.added);
    assert_eq!(answer.workspace.roster.datasets[0].handle, placed.handle);
    // The marked row keeps its handle, so the row that left changed nothing.
    let waiting = restored(&store);
    assert_eq!(
        states(&waiting),
        vec![("b.mzML".to_owned(), RowState::Missing)]
    );
    assert_eq!(waiting[0].rows[0].handle, "restored-0");

    // A save places the live row and the row still waiting, and not the one
    // that left: that handle is stale.
    let live_rows = || service.workspace_restore_rows();
    let handle = placed.handle.as_str();
    assert_eq!(
        store.save_with(&ungrouped(&[handle, "restored-0", "restored-1"]), live_rows),
        refused("staleArrangement")
    );
    assert_eq!(
        store.save_with(&ungrouped(&[handle, "restored-0"]), live_rows),
        WorkspaceRestoreWriteDto::Saved
    );
    let rows = &stored(&scratch).groups[0].rows;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].offered, 0, "a live row has declined nothing");
    assert_eq!(rows[1].offered, 0, "a marked row was never an offer");
}

#[test]
fn restore_re_checks_a_row_the_read_offered_and_refuses_what_changed_since() {
    let scratch = Scratch::new("restore-recheck");
    let (a, _b) = stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    assert!(
        states(&restored(&store))
            .iter()
            .all(|(_, state)| *state == RowState::Matching)
    );
    fs::write(&a, b"<mzML> rewritten, and longer </mzML>").expect("rewrite a");

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");

    assert_eq!(
        service.workspace_restore_rows().len(),
        1,
        "only b is still as recorded"
    );
    assert_eq!(answer.placed.len(), 1);
    assert_eq!(
        states(&restored(&store)),
        vec![("a.mzML".to_owned(), RowState::Changed)]
    );
}

#[test]
fn a_file_replaced_after_the_re_check_stays_a_marked_row_beside_what_was_admitted() {
    let scratch = Scratch::new("restore-race");
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    let _ = restored(&store);

    let service = workspace();
    let answer = store
        .put_back_between(&service, || {
            fs::remove_file(&a).expect("delete a");
            fs::write(&a, b"<mzML/>").expect("another object at the same path");
        })
        .expect("the batch runs");

    assert_eq!(
        service.workspace_restore_rows().len(),
        1,
        "admitted, as Add files would"
    );
    assert!(answer.placed.is_empty(), "not the recorded object");
    assert_eq!(
        states(&restored(&store)),
        vec![("a.mzML".to_owned(), RowState::Changed)]
    );

    // Not counted, though it was not refused: as built, not an owner decision
    // (ADR 0061, decision 10). What the next start loads says so.
    let handle = answer.workspace.roster.datasets[0].handle.clone();
    assert_eq!(
        store.save_with(&ungrouped(&[handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(
        states(&restored(&reopen(&scratch))),
        vec![
            ("a.mzML".to_owned(), RowState::Matching),
            ("a.mzML".to_owned(), RowState::Changed),
        ],
        "the new file as added, and the row that stays marked"
    );
    assert_eq!(offered_counts(&scratch), vec![0, 0]);
}

#[test]
fn restoring_a_row_that_is_already_live_leaves_one_row_and_its_arrangement() {
    let scratch = Scratch::new("restore-duplicate");
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    let _ = restored(&store);
    let service = workspace();
    let added = service.add_files(std::slice::from_ref(&a)).expect("added");
    let handle = added.roster.datasets[0].handle.clone();

    let answer = store.put_back(&service).expect("the batch runs");

    assert_eq!(service.workspace_restore_rows().len(), 1);
    assert_eq!(answer.placed[0].handle, handle);
    assert!(!answer.placed[0].added);
    assert!(states(&restored(&store)).is_empty());
}

#[test]
fn restore_admits_a_sciex_bundle_through_its_primary_as_one_row() {
    use crate::preview::sciex_fixture::{
        SCIEX_MARKERS, scan_companion_bytes, wiff_container_bytes,
    };

    let scratch = Scratch::new("restore-bundle");
    let wiff = scratch.write("s.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    scratch.write("s.wiff.scan", &scan_companion_bytes("payload"));
    let service = workspace();
    let first = service
        .add_files(std::slice::from_ref(&wiff))
        .expect("added");
    let handle = first.roster.datasets[0].handle.clone();
    assert_eq!(
        reopen(&scratch).save_with(&ungrouped(&[handle.as_str()]), || service
            .workspace_restore_rows()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows[0].members.len(), 2);
    service.remove_datasets(&[handle]).expect("removed");

    let store = reopen(&scratch);
    let _ = restored(&store);
    let answer = store.put_back(&service).expect("the batch runs");

    assert_eq!(
        service.workspace_restore_rows().len(),
        1,
        "one acquisition is one row"
    );
    assert_eq!(answer.placed.len(), 1, "both members are the recorded ones");
    assert!(states(&restored(&store)).is_empty());
}

// ------------------------------------------------------------------ dismiss

#[test]
fn a_dismissed_row_leaves_at_the_next_save_and_no_other_handle_moves() {
    let scratch = Scratch::new("restore-dismiss");
    let (_a, b) = stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    assert!(!store.dismiss("restored-0"), "no read has offered it");
    fs::remove_file(&b).expect("delete b");
    let _ = restored(&store);

    assert!(!store.dismiss("restored-9"), "no such row");
    assert!(!store.dismiss("file-0"), "not a restored handle");
    assert!(store.dismiss("restored-0"));
    assert!(!store.dismiss("restored-0"), "already gone");

    let waiting = restored(&store);
    assert_eq!(
        states(&waiting),
        vec![("a.mzML".to_owned(), RowState::Matching)]
    );
    assert_eq!(waiting[1].rows[0].handle, "restored-1");
    assert_eq!(
        store.save(&ungrouped(&["restored-1"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).rows().count(), 1, "forgotten");
}

#[test]
fn dismissing_marked_rows_is_a_way_out_of_too_many_rows() {
    let scratch = Scratch::new("restore-dismiss-capacity");
    let gone = scratch.join("gone.mzML");
    write_stored(
        &scratch,
        &write_document(&RestoreDocument {
            schema_version: SCHEMA_VERSION,
            enabled: true,
            groups: vec![StoredGroup {
                name: None,
                rows: vec![row_at(&gone); MAX_ROWS],
            }],
        }),
    );
    let store = reopen(&scratch);
    let _ = restored(&store);
    let live_file = scratch.write("live.mzML", b"<mzML/>");
    let mut handles: Vec<String> = (0..MAX_ROWS).map(|n| format!("restored-{n}")).collect();
    handles.push("file-0".to_owned());
    let all: Vec<&str> = handles.iter().map(String::as_str).collect();
    assert_eq!(
        store.save(&ungrouped(&all), vec![live("file-0", &live_file)]),
        refused("tooManyRows")
    );
    assert!(store.dismiss("restored-0"));
    assert_eq!(
        store.save(&ungrouped(&all[1..]), vec![live("file-0", &live_file)]),
        WorkspaceRestoreWriteDto::Saved
    );
}

#[test]
fn two_groups_of_one_name_stay_two_groups_through_a_put_back() {
    let scratch = Scratch::new("restore-alike");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    let group = |name: Option<&str>, handles: &[&str]| ArrangedGroupDto {
        name: name.map(str::to_owned),
        handles: handles.iter().map(|handle| (*handle).to_owned()).collect(),
    };
    let arrangement = WorkspaceArrangementDto {
        groups: vec![
            group(None, &[]),
            group(Some("Batch"), &["file-0"]),
            group(Some("Batch"), &["file-1"]),
        ],
        checked: vec![],
    };
    assert_eq!(
        reopen(&scratch).save(&arrangement, vec![live("file-0", &a), live("file-1", &b)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    let _ = restored(&store);
    let answer = store.put_back(&workspace()).expect("the batch runs");
    assert_eq!(
        answer
            .placed
            .iter()
            .map(|row| row.group)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
}

/// What the document says each row has declined, in stored order.
fn offered_counts(scratch: &Scratch) -> Vec<u32> {
    stored(scratch).rows().map(|row| row.offered).collect()
}

#[cfg(windows)]
#[test]
fn a_row_admission_refused_after_the_press_was_refused_not_declined() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let scratch = Scratch::new("restore-held");
    let (_a, b) = stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    // Stored order: Ungrouped (b, restored-0), then Batch (a, restored-1).
    let _ = restored(&store);
    // An acquisition program holding the file without sharing: its attributes
    // still read as recorded, and admission cannot read it.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&b)
        .expect("hold b without sharing");

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    let [placed] = answer.placed.as_slice() else {
        panic!("only a is placed: {:?}", answer.placed);
    };
    assert_eq!(
        states(&restored(&store)),
        vec![("b.mzML".to_owned(), RowState::Matching)],
        "it stays waiting, and a read presenting it again changes nothing"
    );
    assert_eq!(
        store.save_with(&ungrouped(&[placed.handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    drop(held);
    assert_eq!(offered_counts(&scratch), vec![0, 0]);

    let WorkspaceRestoreReadDto::Restored { expired, .. } = reopen(&scratch).read() else {
        panic!("expected restored rows");
    };
    assert_eq!(expired, 0, "the next start offers it again");
}

/// The press could not take a row that was not there. Back in this session, it
/// is an offer the user could take like any other, and is declined like one.
#[test]
fn a_row_missing_at_the_press_that_returns_and_is_not_taken_is_declined() {
    let scratch = Scratch::new("restore-back-after-press");
    let (_a, b) = stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    // Stored order: Ungrouped (b, restored-0), then Batch (a, restored-1).
    let _ = restored(&store);
    let away = scratch.join("b.away");
    fs::rename(&b, &away).expect("b goes away");

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    let [placed] = answer.placed.as_slice() else {
        panic!("only a is placed: {:?}", answer.placed);
    };

    fs::rename(&away, &b).expect("b comes back, the same object");
    assert_eq!(
        states(&restored(&store)),
        vec![("b.mzML".to_owned(), RowState::Matching)]
    );
    assert_eq!(
        store.save_with(&ungrouped(&[placed.handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );

    let WorkspaceRestoreReadDto::Restored { expired, .. } = reopen(&scratch).read() else {
        panic!("expected restored rows");
    };
    assert_eq!(expired, 1, "saw it matching, saved without putting it back");
}

/// An earlier read's matching is the offer made. A row missing at the press was
/// not handed to admission, so the press does not protect it, and the save
/// counts it though no later read found it matching (decision 10's as-built note).
#[test]
fn a_row_seen_matching_and_missing_from_the_press_on_is_still_declined() {
    let scratch = Scratch::new("restore-gone-after-press");
    let (_a, b) = stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    // Stored order: Ungrouped (b, restored-0), then Batch (a, restored-1).
    let _ = restored(&store);
    let away = scratch.join("b.away");
    fs::rename(&b, &away).expect("b goes away");

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    let [placed] = answer.placed.as_slice() else {
        panic!("only a is placed: {:?}", answer.placed);
    };
    assert_eq!(
        states(&restored(&store)),
        vec![("b.mzML".to_owned(), RowState::Missing)]
    );
    assert_eq!(
        store.save_with(&ungrouped(&[placed.handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(offered_counts(&scratch), vec![0, 1]);

    fs::rename(&away, &b).expect("b comes back, the same object");
    let WorkspaceRestoreReadDto::Restored { expired, .. } = reopen(&scratch).read() else {
        panic!("expected restored rows");
    };
    assert_eq!(
        expired, 1,
        "no longer offered, and the source file is untouched"
    );
}

/// "One of its reads" (decision 10): matching first at a later read of the
/// session is an offer made as much as at the first.
#[test]
fn a_row_first_matching_at_a_later_read_is_an_offer_made() {
    let scratch = Scratch::new("restore-later-read");
    let (_a, b) = stored_a_and_b(&scratch);
    let away = scratch.join("b.away");
    fs::rename(&b, &away).expect("b is away at the first read");
    let store = reopen(&scratch);
    assert_eq!(
        states(&restored(&store)),
        vec![
            ("b.mzML".to_owned(), RowState::Missing),
            ("a.mzML".to_owned(), RowState::Matching)
        ]
    );

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    let [placed] = answer.placed.as_slice() else {
        panic!("only a is placed: {:?}", answer.placed);
    };
    fs::rename(&away, &b).expect("b comes back, the same object");
    assert_eq!(
        states(&restored(&store)),
        vec![("b.mzML".to_owned(), RowState::Matching)]
    );
    assert_eq!(
        store.save_with(&ungrouped(&[placed.handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(offered_counts(&scratch), vec![0, 1]);
}

#[test]
fn restore_puts_back_no_row_this_session_no_longer_offers() {
    let scratch = Scratch::new("restore-expired-not-taken");
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let declining = reopen(&scratch);
    let _ = restored(&declining);
    assert_eq!(
        declining.save(&ungrouped(&["restored-0"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );

    let store = reopen(&scratch);
    let WorkspaceRestoreReadDto::Restored { expired, .. } = store.read() else {
        panic!("expected restored rows");
    };
    assert_eq!(expired, 1);
    assert!(!store.dismiss("restored-0"), "no read offers it");
    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    assert!(answer.placed.is_empty(), "{:?}", answer.placed);
    assert_eq!(service.workspace_restore_rows().len(), 0);
}

#[test]
fn restore_puts_back_no_row_the_user_dismissed() {
    let scratch = Scratch::new("restore-dismissed-not-taken");
    stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    // Stored order: Ungrouped (b, restored-0), then Batch (a, restored-1).
    let _ = restored(&store);
    assert!(store.dismiss("restored-0"));

    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    assert_eq!(answer.placed.len(), 1, "{:?}", answer.placed);
    let rows = service.workspace_restore_rows();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].members[0].path.ends_with("a.mzML"));
}

#[test]
fn a_row_a_full_workspace_refused_stays_waiting_and_is_not_counted() {
    let scratch = Scratch::new("restore-full");
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    let _ = restored(&store);
    let service = workspace();
    let held: Vec<PathBuf> = (0..MAX_ROWS)
        .map(|index| scratch.write(&format!("held-{index}.mzML"), b"<mzML/>"))
        .collect();
    let filled = service.add_files(&held).expect("the workspace fills");
    assert_eq!(filled.roster.datasets.len(), MAX_ROWS);

    let answer = store.put_back(&service).expect("the batch runs");
    assert!(answer.placed.is_empty(), "the workspace is full");
    assert!(matches!(
        answer.workspace.outcomes.as_slice(),
        [WorkspaceAddOutcomeDto::Rejected { .. }]
    ));
    assert_eq!(
        states(&restored(&store)),
        vec![("a.mzML".to_owned(), RowState::Matching)]
    );

    // Room is made, and the session ends without pressing again.
    let first = filled.roster.datasets[0].handle.clone();
    service
        .remove_datasets(std::slice::from_ref(&first))
        .expect("a row leaves");
    let handles: Vec<String> = filled.roster.datasets[1..]
        .iter()
        .map(|dataset| dataset.handle.clone())
        .chain(["restored-0".to_owned()])
        .collect();
    let handles: Vec<&str> = handles.iter().map(String::as_str).collect();
    assert_eq!(
        store.save_with(&ungrouped(&handles), || service.workspace_restore_rows()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(
        offered_counts(&scratch).last(),
        Some(&0),
        "pressed and refused: it declined nothing"
    );
}

#[test]
fn a_conversions_refusal_leaves_every_row_waiting_and_counts_none_of_them() {
    let scratch = Scratch::new("restore-converting");
    stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    let _ = restored(&store);
    let service = workspace();
    service.set_conversion_busy_for_test(true);

    let refusal = store
        .put_back(&service)
        .expect_err("a conversion refuses the batch");
    assert_eq!(refusal.kind, "conversion_busy");
    assert_eq!(service.workspace_restore_rows().len(), 0);
    assert_eq!(
        states(&restored(&store)),
        vec![
            ("b.mzML".to_owned(), RowState::Matching),
            ("a.mzML".to_owned(), RowState::Matching),
        ]
    );

    service.set_conversion_busy_for_test(false);
    assert_eq!(
        store.save_with(&ungrouped(&["restored-0", "restored-1"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(offered_counts(&scratch), vec![0, 0]);

    let next = reopen(&scratch);
    let _ = restored(&next);
    let answer = next.put_back(&service).expect("no conversion now");
    assert_eq!(answer.placed.len(), 2, "the next start can still take them");
}

#[test]
fn clear_and_off_end_every_restored_handle() {
    let scratch = Scratch::new("restore-clear-handles");
    stored_a_and_b(&scratch);
    let store = reopen(&scratch);
    let _ = restored(&store);
    assert!(store.dismiss("restored-0"));
    assert_eq!(store.clear(), WorkspaceRestoreWriteDto::Saved);
    assert!(!store.dismiss("restored-1"), "cleared");
    let service = workspace();
    let answer = store.put_back(&service).expect("nothing to do");
    assert!(answer.placed.is_empty());
    assert_eq!(service.workspace_restore_rows().len(), 0);
}

// ------------------------------------------------------------------ context

fn contexts_of(paths: &[&Path]) -> Vec<Option<String>> {
    let rows: Vec<StoredRow> = paths.iter().map(|path| row_at(path)).collect();
    let shown: Vec<(usize, &StoredRow)> = rows.iter().enumerate().collect();
    let contexts = collision_contexts(&shown);
    (0..rows.len())
        .map(|at| contexts.get(&at).cloned())
        .collect()
}

#[test]
fn a_unique_name_says_nothing_and_a_collision_says_the_fewest_folders() {
    let scratch = Scratch::new("restore-context");
    let one = scratch.join("batch-1/QC/x.raw");
    let two = scratch.join("batch-2/QC/x.raw");
    let other = scratch.join("batch-3/y.raw");
    assert_eq!(
        contexts_of(&[&one, &two, &other]),
        vec![
            Some("batch-1\\QC".to_owned()),
            Some("batch-2\\QC".to_owned()),
            None
        ]
    );
    let near = scratch.join("batch-1/A/x.raw");
    let far = scratch.join("batch-1/B/x.raw");
    assert_eq!(
        contexts_of(&[&near, &far]),
        vec![Some("A".to_owned()), Some("B".to_owned())]
    );
}

#[test]
fn folders_that_do_not_tell_rows_apart_within_the_bound_say_the_rows_place() {
    let scratch = Scratch::new("restore-context-bound");
    let one = scratch.join("one/a/b/c/x.raw");
    let two = scratch.join("two/a/b/c/x.raw");
    assert_eq!(
        contexts_of(&[&one, &two]),
        vec![Some("a\\b\\c #1".to_owned()), Some("a\\b\\c #2".to_owned())]
    );
}

#[cfg(windows)]
#[test]
fn the_context_never_names_a_drive_a_share_or_a_root() {
    let at = |path: &str| PathBuf::from(path);
    let contexts = contexts_of(&[
        &at(r"C:\x.raw"),
        &at(r"D:\QC\x.raw"),
        &at(r"\\server\share\Runs\x.raw"),
        &at(r"\\?\UNC\server\share\Verbatim\x.raw"),
        &at(r"\\?\E:\Disk\x.raw"),
    ]);
    assert_eq!(
        contexts,
        vec![
            None,
            Some("QC".to_owned()),
            Some("Runs".to_owned()),
            Some("Verbatim".to_owned()),
            Some("Disk".to_owned()),
        ]
    );
}

#[test]
fn a_read_reports_the_context_only_among_the_rows_it_shows() {
    let scratch = Scratch::new("restore-context-read");
    let one = scratch.write("one/x.mzML", b"<mzML/>");
    let two = scratch.write("two/x.mzML", b"<mzML/>");
    assert_eq!(
        reopen(&scratch).save(
            &ungrouped(&["file-0", "file-1"]),
            vec![live("file-0", &one), live("file-1", &two)]
        ),
        WorkspaceRestoreWriteDto::Saved
    );
    let store = reopen(&scratch);
    let rows = restored(&store)[0].rows.clone();
    assert_eq!(rows[0].context.as_deref(), Some("one"));
    assert_eq!(rows[1].context.as_deref(), Some("two"));
    assert!(store.dismiss("restored-1"));
    assert_eq!(
        restored(&store)[0].rows[0].context,
        None,
        "no collision left"
    );
}

// ------------------------------------------------------------------ the label

fn both_halves() -> Option<NotVerifiedByMscanvas> {
    NotVerifiedByMscanvas::of(true, Some("3.0.26204".to_owned()))
}

/// The text a document holds for [`both_halves`], to replace with something else.
fn both_halves_as_stored() -> String {
    let value = serde_json::to_value(both_halves()).expect("JSON");
    serde_json::to_string(&value).expect("JSON")
}

/// Records one row holding `label`, as a save would from the registry.
fn saved_with_label(scratch: &Scratch, path: &Path, label: Option<NotVerifiedByMscanvas>) {
    let row = LiveRow {
        not_verified: label,
        ..live("file-0", path)
    };
    assert_eq!(
        reopen(scratch).save(&ungrouped(&["file-0"]), vec![row]),
        WorkspaceRestoreWriteDto::Saved
    );
}

/// The label of the only row the service holds.
#[track_caller]
fn the_rows_label(service: &PreviewService) -> Option<NotVerifiedByMscanvas> {
    let roster = service.roster();
    assert_eq!(roster.datasets.len(), 1);
    roster.datasets[0].not_verified_by_mscanvas.clone()
}

/// The next session's first store, read, and a press of Restore workspace on a
/// new service.
fn put_back_in_a_later_session(
    scratch: &Scratch,
) -> (
    WorkspaceRestoreStore,
    PreviewService,
    WorkspaceRestorePutBackDto,
) {
    let store = reopen(scratch);
    let _ = restored(&store);
    let service = workspace();
    let answer = store.put_back(&service).expect("the batch runs");
    (store, service, answer)
}

#[test]
fn a_label_lasts_through_a_save_a_put_back_and_the_save_after_it() {
    let scratch = Scratch::new("restore-label-kept");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let identity = local_document::object_identity(&a).expect("an identity");
    {
        // The first session: the registry's row, not a fixture's, is what is saved.
        let service = workspace();
        let mut added = service.add_files(std::slice::from_ref(&a)).expect("added");
        let handle = added.roster.datasets[0].handle.clone();
        let label = both_halves().expect("a label");
        service.label_admitted_row(&mut added, &handle, identity, label);
        assert_eq!(
            reopen(&scratch).save_with(&ungrouped(&[handle.as_str()]), || {
                service.workspace_restore_rows()
            }),
            WorkspaceRestoreWriteDto::Saved
        );
    }
    assert_eq!(stored(&scratch).groups[0].rows[0].label(), both_halves());
    // The key is the document's contract, the schema version having stayed 1: under
    // another name a document holding this one would be refused whole.
    let text = String::from_utf8(stored_bytes(&scratch)).expect("UTF-8");
    let stored_label = format!("\"notVerifiedByMscanvas\":{}", both_halves_as_stored());
    assert!(text.contains(&stored_label), "{text}");

    let (store, service, answer) = put_back_in_a_later_session(&scratch);
    assert_eq!(the_rows_label(&service), both_halves());
    assert_eq!(
        answer.workspace.roster.datasets[0].not_verified_by_mscanvas,
        both_halves(),
        "the answer's roster, which the webview draws"
    );
    let WorkspaceAddOutcomeDto::Added { dataset } = &answer.workspace.outcomes[0] else {
        panic!("a new row");
    };
    assert_eq!(dataset.not_verified_by_mscanvas, both_halves());

    let handle = answer.placed[0].handle.clone();
    assert_eq!(
        store.save_with(&ungrouped(&[handle.as_str()]), || service
            .workspace_restore_rows()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(
        stored(&scratch).groups[0].rows[0].label(),
        both_halves(),
        "and for the session after that"
    );
}

#[test]
fn a_row_still_waiting_keeps_its_label_through_a_save() {
    let scratch = Scratch::new("restore-label-waiting");
    let a = scratch.write("a.mzML", b"<mzML/>");
    saved_with_label(&scratch, &a, both_halves());
    let store = reopen(&scratch);
    let _ = restored(&store);
    assert_eq!(
        store.save(&ungrouped(&["restored-0"]), Vec::new()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows[0].label(), both_halves());
}

#[test]
fn a_document_from_before_the_label_restores_with_none_and_reads_back_the_same() {
    let scratch = Scratch::new("restore-label-older");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let (volume, id) = local_document::object_identity(&a).expect("an identity");
    let path = serde_json::to_string(a.to_str().expect("a Unicode path")).expect("JSON");
    let file_id = file_id_hex(id);
    let length = fs::metadata(&a).expect("the file").len();
    let older = format!(
        "{{\"schemaVersion\":1,\"enabled\":true,\"groups\":[{{\"name\":null,\"rows\":[{{\"family\":\"mzml\",\"checked\":false,\"offered\":0,\"members\":[{{\"path\":{path},\"byteLength\":{length},\"volumeSerial\":{volume},\"fileId\":\"{file_id}\"}}]}}]}}]}}\n"
    );
    let document = read_document(older.as_bytes()).expect("not refused");
    assert_eq!(
        write_document(&document),
        older.as_bytes(),
        "a document with no label is still byte for byte what it was"
    );
    write_stored(&scratch, older.as_bytes());

    let (_store, service, answer) = put_back_in_a_later_session(&scratch);

    assert_eq!(answer.placed.len(), 1);
    assert_eq!(the_rows_label(&service), None);
    assert_eq!(service.not_verified_label_of_object((volume, id)), None);
}

#[test]
fn a_row_with_no_label_stays_without_one() {
    let scratch = Scratch::new("restore-label-none");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let identity = local_document::object_identity(&a).expect("an identity");
    saved_with_label(&scratch, &a, None);
    assert!(
        !String::from_utf8(stored_bytes(&scratch))
            .expect("UTF-8")
            .contains("notVerifiedByMscanvas")
    );

    let (store, service, answer) = put_back_in_a_later_session(&scratch);

    assert_eq!(the_rows_label(&service), None);
    assert_eq!(service.not_verified_label_of_object(identity), None);
    let handle = answer.placed[0].handle.clone();
    assert_eq!(
        store.save_with(&ungrouped(&[handle.as_str()]), || service
            .workspace_restore_rows()),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows[0].label(), None);
}

#[test]
fn a_stored_value_that_is_no_label_gives_no_label_and_refuses_nothing() {
    let too_long = format!(
        "{{\"unverifiedSettings\":true,\"unverifiedBuildRelease\":\"{}\"}}",
        "9".repeat(crate::project::record::MAX_LABEL_CHARS + 1)
    );
    for (at, value) in [
        "\"yes\"",
        "1",
        "true",
        "[]",
        "{}",
        "{\"unverifiedSettings\":true}",
        "{\"unverifiedBuildRelease\":null}",
        "{\"unverifiedSettings\":\"yes\",\"unverifiedBuildRelease\":null}",
        "{\"unverifiedSettings\":true,\"unverifiedBuildRelease\":1}",
        "{\"unverifiedSettings\":true,\"unverifiedBuildRelease\":null,\"more\":1}",
        "{\"unverifiedSettings\":false,\"unverifiedBuildRelease\":null}",
        "{\"unverifiedSettings\":false,\"unverifiedBuildRelease\":\"\"}",
        "{\"unverifiedSettings\":false,\"unverifiedBuildRelease\":\"3.0\\n\"}",
        too_long.as_str(),
    ]
    .into_iter()
    .enumerate()
    {
        let scratch = Scratch::new(&format!("restore-label-malformed-{at}"));
        let a = scratch.write("a.mzML", b"<mzML/>");
        let identity = local_document::object_identity(&a).expect("an identity");
        let good = both_halves_as_stored();
        saved_with_label(&scratch, &a, both_halves());
        let text = String::from_utf8(stored_bytes(&scratch)).expect("UTF-8");
        assert!(text.contains(&good));
        write_stored(&scratch, text.replace(&good, value).as_bytes());

        let store = reopen(&scratch);
        assert_eq!(
            states(&restored(&store)),
            vec![("a.mzML".to_owned(), RowState::Matching)],
            "{value}"
        );
        // While the row waits the value stays as found: nothing here repairs it.
        assert_eq!(
            store.save(&ungrouped(&["restored-0"]), Vec::new()),
            WorkspaceRestoreWriteDto::Saved
        );
        assert_eq!(
            stored(&scratch).groups[0].rows[0].not_verified_by_mscanvas,
            Some(serde_json::from_str(value).expect("JSON")),
            "{value}"
        );

        let service = workspace();
        let answer = store.put_back(&service).expect("the batch runs");
        assert_eq!(answer.placed.len(), 1, "{value}");
        assert_eq!(the_rows_label(&service), None, "{value}");
        assert_eq!(service.not_verified_label_of_object(identity), None);
    }
}

#[test]
fn an_explicit_null_is_no_label_and_a_neighbours_label_stands() {
    let scratch = Scratch::new("restore-label-neighbour");
    let a = scratch.write("a.mzML", b"<mzML/>");
    let b = scratch.write("b.mzML", b"<mzML/>");
    let rows = vec![
        LiveRow {
            not_verified: both_halves(),
            ..live("file-0", &a)
        },
        LiveRow {
            not_verified: both_halves(),
            ..live("file-1", &b)
        },
    ];
    assert_eq!(
        reopen(&scratch).save(&ungrouped(&["file-0", "file-1"]), rows),
        WorkspaceRestoreWriteDto::Saved
    );
    let good = both_halves_as_stored();
    let text = String::from_utf8(stored_bytes(&scratch)).expect("UTF-8");
    assert!(text.contains(&good));
    write_stored(&scratch, text.replacen(&good, "null", 1).as_bytes());

    let (_store, service, _answer) = put_back_in_a_later_session(&scratch);

    let labels: Vec<_> = service
        .roster()
        .datasets
        .iter()
        .map(|row| (row.file_name.clone(), row.not_verified_by_mscanvas.clone()))
        .collect();
    assert_eq!(
        labels,
        vec![
            ("a.mzML".to_owned(), None),
            ("b.mzML".to_owned(), both_halves())
        ]
    );
}

/// The ceiling `StoredRow`'s comment names: a value the parser cannot hold makes a
/// document it cannot parse, refused whole and left as found (ADR 0061, decision 6).
#[test]
fn a_value_the_parser_cannot_hold_is_refused_with_the_document() {
    let scratch = Scratch::new("restore-label-unparsable");
    let a = scratch.write("a.mzML", b"<mzML/>");
    saved_with_label(&scratch, &a, both_halves());
    let good = both_halves_as_stored();
    let text = String::from_utf8(stored_bytes(&scratch)).expect("UTF-8");
    assert!(text.contains(&good));
    let deep = format!("{}{}", "[".repeat(129), "]".repeat(129));
    for value in [deep.as_str(), "1e999", "\"\\uD800\""] {
        assert_eq!(
            read_document(text.replace(&good, value).as_bytes()),
            Err(DocumentProblem::Malformed),
            "{value}"
        );
    }
}

/// A reference made from a put-back row records the label, not `null`, and the
/// same table `label_admitted_row` writes keeps it once the row has left.
#[cfg(windows)]
#[test]
fn a_reference_registered_from_a_put_back_row_records_the_label() {
    use crate::project::ProjectStore;

    let scratch = Scratch::new("restore-label-reference");
    let a = scratch.write("a.mzML", b"<mzML/>");
    saved_with_label(&scratch, &a, both_halves());
    let (_store, service, answer) = put_back_in_a_later_session(&scratch);

    let reference_records = || {
        let project = ProjectStore::new();
        project
            .create("Next".to_owned(), false)
            .expect("a new project");
        project
            .register_input_labelled(&a, |identity| {
                service.not_verified_label_of_object(identity)
            })
            .expect("register the object");
        project.describe().inputs[0]
            .not_verified_by_mscanvas
            .clone()
    };
    assert_eq!(reference_records(), both_halves(), "from the row");

    service
        .remove_datasets(std::slice::from_ref(&answer.placed[0].handle))
        .expect("remove the row");
    assert_eq!(reference_records(), both_halves(), "with no row");

    service
        .add_files(std::slice::from_ref(&a))
        .expect("the object added back");
    assert_eq!(the_rows_label(&service), both_halves(), "by any route");
}

#[test]
fn a_file_replaced_after_the_re_check_is_not_given_the_label_and_the_row_keeps_it() {
    let scratch = Scratch::new("restore-label-race");
    let a = scratch.write("a.mzML", b"<mzML/>");
    saved_with_label(&scratch, &a, both_halves());
    let store = reopen(&scratch);
    let _ = restored(&store);
    let recorded = local_document::object_identity(&a).expect("an identity");

    let service = workspace();
    let answer = store
        .put_back_between(&service, || {
            fs::remove_file(&a).expect("delete a");
            fs::write(&a, b"<mzML/>").expect("another object at the same path");
        })
        .expect("the batch runs");

    assert!(answer.placed.is_empty(), "not the recorded object");
    assert_eq!(the_rows_label(&service), None);
    assert_eq!(
        service.not_verified_label_of_object(recorded),
        None,
        "not even the recorded object's table entry: nothing proved a row was it"
    );
    let handle = answer.workspace.roster.datasets[0].handle.clone();
    assert_eq!(
        store.save_with(&ungrouped(&[handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    let document = stored(&scratch);
    let labels: Vec<_> = document.rows().map(StoredRow::label).collect();
    assert_eq!(labels, vec![None, both_halves()]);
}

#[test]
fn restoring_a_labelled_row_already_live_gives_that_row_the_label_merged() {
    let scratch = Scratch::new("restore-label-duplicate");
    let a = scratch.write("a.mzML", b"<mzML/>");
    saved_with_label(&scratch, &a, NotVerifiedByMscanvas::of(true, None));
    let store = reopen(&scratch);
    let _ = restored(&store);
    let service = workspace();
    let mut added = service.add_files(std::slice::from_ref(&a)).expect("added");
    assert_eq!(the_rows_label(&service), None);
    let handle = added.roster.datasets[0].handle.clone();
    service.label_admitted_row(
        &mut added,
        &handle,
        local_document::object_identity(&a).expect("an identity"),
        NotVerifiedByMscanvas::of(false, Some("3.0.26204".to_owned())).expect("a label"),
    );

    let answer = store.put_back(&service).expect("the batch runs");

    assert!(!answer.placed[0].added);
    let WorkspaceAddOutcomeDto::Duplicate { existing } = &answer.workspace.outcomes[0] else {
        panic!("the row it already was");
    };
    assert_eq!(existing.not_verified_by_mscanvas, both_halves());
    assert_eq!(the_rows_label(&service), both_halves());
}

/// The cost owner decision P201-RESTORE accepted: the same file added instead of
/// put back has no label, and a save records it as that row (`arrange`).
#[test]
fn the_same_file_added_instead_of_put_back_has_no_label() {
    let scratch = Scratch::new("restore-label-added-instead");
    let a = scratch.write("a.mzML", b"<mzML/>");
    saved_with_label(&scratch, &a, both_halves());
    let store = reopen(&scratch);
    let _ = restored(&store);
    let service = workspace();
    let added = service.add_files(std::slice::from_ref(&a)).expect("added");
    assert_eq!(the_rows_label(&service), None);

    let handle = added.roster.datasets[0].handle.clone();
    assert_eq!(
        store.save_with(&ungrouped(&[handle.as_str(), "restored-0"]), || {
            service.workspace_restore_rows()
        }),
        WorkspaceRestoreWriteDto::Saved
    );
    let document = stored(&scratch);
    let labels: Vec<_> = document.rows().map(StoredRow::label).collect();
    assert_eq!(labels, vec![None]);
}
