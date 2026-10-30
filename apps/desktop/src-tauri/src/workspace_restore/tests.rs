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
        WorkspaceRestoreReadDto::Restored { groups } => groups,
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

fn member(path: &Path) -> StoredMember {
    StoredMember {
        path: path.to_str().expect("a Unicode path").to_owned(),
        byte_length: 1,
        volume_serial: 7,
        file_id: "0123456789abcdef0123456789abcdef".to_owned(),
    }
}

fn row_at(path: &Path) -> StoredRow {
    StoredRow {
        family: Family::Mzml,
        checked: false,
        members: vec![member(path)],
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
    WorkspaceRestoreReadDto::Refused { problem }
}

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
                    members: vec![
                        member(&scratch.join("s.wiff")),
                        member(&scratch.join("s.wiff.scan")),
                    ],
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
        family: Family::Mzml,
        display_name: name.to_owned(),
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
        }
    );
    let wire = serde_json::to_string(&read).expect("the wire form");
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

    // One that places all three keeps their recorded facts, not today's.
    assert_eq!(
        store.save(
            &ungrouped(&["restored-2", "restored-0", "restored-1"]),
            Vec::new()
        ),
        WorkspaceRestoreWriteDto::Saved
    );
    let rows = &recorded.groups[0].rows;
    assert_eq!(
        stored(&scratch).groups[0].rows,
        vec![rows[2].clone(), rows[0].clone(), rows[1].clone()]
    );
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
    #[cfg(windows)]
    assert_eq!(marked[2], ("h.mzML".to_owned(), RowState::Unreadable));
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
        restored(&store),
        Vec::new(),
        "no longer answered as refused"
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
    assert_eq!(store.read(), WorkspaceRestoreReadDto::Off);
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
    assert_eq!(store.read(), refused_start("malformed"));
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
    // Nor does forgetting: a clear in a refused window leaves restore off.
    assert_eq!(first.clear(), WorkspaceRestoreWriteDto::Saved);
    assert_eq!(first.read(), WorkspaceRestoreReadDto::Off);
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
    // other window left is not known here, so the clear writes off.
    assert_eq!(first.clear(), WorkspaceRestoreWriteDto::Saved);
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
    assert_eq!(store.read(), WorkspaceRestoreReadDto::Off);
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
