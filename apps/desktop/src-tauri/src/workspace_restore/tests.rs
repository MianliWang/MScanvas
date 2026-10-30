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

/// The one file kept aside, and its bytes.
fn kept_aside(scratch: &Scratch) -> Vec<u8> {
    let names = entries(&profile(scratch));
    assert_eq!(names.len(), 1, "exactly one document kept aside: {names:?}");
    assert!(names[0].starts_with("workspace-restore.set-aside-"));
    fs::read(profile(scratch).join(&names[0])).expect("the kept document")
}

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
fn a_corrupt_document_is_refused_whole_kept_aside_and_the_session_starts_empty() {
    let scratch = Scratch::new("restore-corrupt");
    write_stored(&scratch, b"{ not a document");
    let store = reopen(&scratch);
    assert_eq!(
        store.read(),
        WorkspaceRestoreReadDto::Refused {
            problem: "malformed",
            set_aside: true
        }
    );
    assert_eq!(kept_aside(&scratch), b"{ not a document");

    // The session is usable, and a new document never touches the kept one.
    let a = scratch.write("a.mzML", b"<mzML/>");
    assert_eq!(
        store.save(&ungrouped(&["file-0"]), vec![live("file-0", &a)]),
        WorkspaceRestoreWriteDto::Saved
    );
    assert_eq!(stored(&scratch).groups[0].rows.len(), 1);
    let names = entries(&profile(&scratch));
    assert_eq!(names.len(), 2);
    let aside = names
        .iter()
        .find(|name| name.starts_with("workspace-restore.set-aside-"))
        .expect("the kept document");
    assert_eq!(
        fs::read(profile(&scratch).join(aside)).expect("kept"),
        b"{ not a document"
    );
}

#[test]
fn a_document_from_a_newer_build_is_refused_and_kept_byte_for_byte() {
    let scratch = Scratch::new("restore-newer");
    let newer = br#"{"schemaVersion":2,"enabled":true,"groups":[],"layers":[]}"#;
    write_stored(&scratch, newer);
    assert_eq!(
        reopen(&scratch).read(),
        WorkspaceRestoreReadDto::Refused {
            problem: "newerVersion",
            set_aside: true
        }
    );
    assert_eq!(kept_aside(&scratch), newer);
}

#[test]
fn an_oversized_document_is_refused_without_being_parsed() {
    let scratch = Scratch::new("restore-oversized");
    let bound = usize::try_from(MAX_DOCUMENT_BYTES).expect("fits");
    write_stored(&scratch, &vec![b' '; bound + 1]);
    assert_eq!(
        reopen(&scratch).read(),
        WorkspaceRestoreReadDto::Refused {
            problem: "oversized",
            set_aside: true
        }
    );
}

#[test]
fn an_unsafe_name_is_left_where_it_is_and_never_replaced() {
    let scratch = Scratch::new("restore-unsafe");
    fs::create_dir_all(profile(&scratch).join(FILE_NAME)).expect("a directory at the name");
    let store = reopen(&scratch);
    assert_eq!(
        store.read(),
        WorkspaceRestoreReadDto::Refused {
            problem: "unsafeTarget",
            set_aside: false
        }
    );
    assert_eq!(
        store.save(&ungrouped(&[]), Vec::new()),
        WorkspaceRestoreWriteDto::Refused {
            problem: "storedDocumentKept"
        }
    );
    assert_eq!(
        store.clear(),
        WorkspaceRestoreWriteDto::Refused {
            problem: "storedDocumentKept"
        }
    );
    assert!(profile(&scratch).join(FILE_NAME).is_dir());
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
