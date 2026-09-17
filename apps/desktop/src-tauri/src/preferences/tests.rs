//! Real-filesystem coverage for the UI preference store.
//!
//! These tests write to actual directories under the system temporary root and
//! drive the production implementation: the record, the validation, the bounded
//! temporary, the handle-bound replace and the read-back. Nothing here stubs the
//! filesystem, because what is being proved is what the filesystem does.
//!
//! Every refusal sits next to a positive control in the same directory, so a
//! test that passes because nothing worked at all cannot be mistaken for a test
//! that passes because the refusal is correct.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::dto::{UiPreferenceReadDto, UiPreferenceSaveDto, UiPreferenceWriteDto};
use super::record::{
    AppearancePreferences, LayoutPreferences, MAX_RECORD_BYTES, PanelPresentation, RecordProblem,
    RosterDensity, SCHEMA_VERSION, UiLocale, UiPreferences, read_record, write_record,
};
use super::storage::{self, PreferenceRoot, StoredRecord, WriteError};
use super::{UiPreferenceStore, dto, record};

/// Keeps concurrently running tests out of each other's directories. The
/// process id alone is one name per binary, not one per test.
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Root {
    path: PathBuf,
}

impl Root {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mscanvas-preferences-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("the test root");
        Self { path }
    }

    fn store(&self) -> UiPreferenceStore {
        UiPreferenceStore::for_root(self.path.clone())
    }

    fn root(&self) -> PreferenceRoot {
        PreferenceRoot::new(self.path.clone())
    }

    fn file(&self) -> PathBuf {
        self.path.join("ui-preferences.json")
    }

    /// Puts arbitrary bytes at the published name, as something other than this
    /// application would.
    fn store_bytes(&self, bytes: &[u8]) {
        std::fs::write(self.file(), bytes).expect("the stored bytes");
    }

    fn stored_bytes(&self) -> Vec<u8> {
        std::fs::read(self.file()).expect("the stored bytes")
    }

    /// Every name in the directory, sorted. Used to prove that a failed write
    /// cleans up after itself and that nothing else is created.
    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&self.path)
            .expect("the test root")
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
}

impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn appearance(locale: UiLocale, density: RosterDensity) -> UiPreferenceWriteDto {
    UiPreferenceWriteDto {
        appearance: Some(AppearancePreferences { locale, density }),
        layout: None,
        replace_unusable: false,
    }
}

fn layout(roster: PanelPresentation, details: PanelPresentation) -> UiPreferenceWriteDto {
    UiPreferenceWriteDto {
        appearance: None,
        layout: Some(LayoutPreferences { roster, details }),
        replace_unusable: false,
    }
}

fn saved(outcome: &UiPreferenceSaveDto) -> UiPreferences {
    match outcome {
        UiPreferenceSaveDto::Saved { preferences, .. } => *preferences,
        other => panic!("expected a saved record, got {other:?}"),
    }
}

// ------------------------------------------------------------- record rules

#[test]
fn a_valid_record_round_trips_through_its_own_reader() {
    let record = UiPreferences {
        schema_version: SCHEMA_VERSION,
        appearance: AppearancePreferences {
            locale: UiLocale::ZhCn,
            density: RosterDensity::Compact,
        },
        layout: LayoutPreferences {
            roster: PanelPresentation::Hidden,
            details: PanelPresentation::Shown,
        },
    };
    let bytes = write_record(&record).expect("the serialized record");
    assert_eq!(read_record(&bytes), Ok(record));
}

#[test]
fn the_stored_document_carries_only_the_allowlisted_fields() {
    let bytes = write_record(&UiPreferences::default()).expect("the serialized record");
    let document = String::from_utf8(bytes).expect("utf-8");
    // Named exactly, so a field added to the record without a decision fails
    // here rather than reaching a user's profile.
    assert_eq!(
        document.trim_end(),
        r#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}"#
    );
}

#[test]
fn a_record_from_another_schema_is_unsupported_rather_than_malformed() {
    let future = br#"{"schemaVersion":2,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"theme":"dark"}"#;
    assert_eq!(read_record(future), Err(RecordProblem::UnsupportedVersion));
}

#[test]
fn a_record_with_no_version_is_malformed() {
    let versionless = br#"{"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}"#;
    assert_eq!(read_record(versionless), Err(RecordProblem::Malformed));
}

#[test]
fn an_unknown_field_at_this_schema_is_refused_rather_than_retained() {
    let extra = br#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"lastFolder":"D:\\data"}"#;
    assert_eq!(read_record(extra), Err(RecordProblem::Malformed));
    let nested = br#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable","theme":"dark"},"layout":{"roster":"automatic","details":"automatic"}}"#;
    assert_eq!(read_record(nested), Err(RecordProblem::Malformed));
}

#[test]
fn a_value_outside_its_domain_is_refused() {
    for document in [
        br#"{"schemaVersion":1,"appearance":{"locale":"de","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}"#.as_slice(),
        br#"{"schemaVersion":1,"appearance":{"locale":"en","density":"cosy"},"layout":{"roster":"automatic","details":"automatic"}}"#.as_slice(),
        br#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"maybe","details":"automatic"}}"#.as_slice(),
        br#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic"}}"#.as_slice(),
        b"not json at all".as_slice(),
        b"".as_slice(),
    ] {
        assert_eq!(read_record(document), Err(RecordProblem::Malformed));
    }
}

#[test]
fn the_supported_locale_domain_is_exactly_the_two_bundled_locales() {
    for (document, locale) in [
        (
            br#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}"#.as_slice(),
            UiLocale::En,
        ),
        (
            br#"{"schemaVersion":1,"appearance":{"locale":"zh-CN","density":"compact"},"layout":{"roster":"shown","details":"hidden"}}"#.as_slice(),
            UiLocale::ZhCn,
        ),
    ] {
        assert_eq!(
            read_record(document).map(|record| record.appearance.locale),
            Ok(locale)
        );
    }
}

// ------------------------------------------------------------ storage rules

#[test]
fn an_absent_record_is_not_a_problem_and_creates_nothing() {
    let root = Root::new("absent");
    assert_eq!(storage::read(&root.root()), StoredRecord::Absent);
    assert_eq!(root.entries(), Vec::<String>::new());
}

#[test]
fn an_oversized_stored_file_is_refused_without_being_parsed() {
    let root = Root::new("oversized");
    let mut padded = Vec::new();
    padded.extend_from_slice(b"{\"schemaVersion\":1,\"appearance\":{\"locale\":\"en\",\"density\":\"comfortable\"},\"layout\":{\"roster\":\"automatic\",\"details\":\"automatic\"},\"pad\":\"");
    padded.resize(
        usize::try_from(MAX_RECORD_BYTES).expect("the bound fits") + 64,
        b'x',
    );
    padded.extend_from_slice(b"\"}");
    root.store_bytes(&padded);
    assert_eq!(
        storage::read(&root.root()),
        StoredRecord::Unusable(RecordProblem::Oversized)
    );
    // Positive control in the same directory: the bound is a bound, not a
    // directory that has stopped working.
    root.store_bytes(&write_record(&UiPreferences::default()).expect("bytes"));
    assert_eq!(
        storage::read(&root.root()),
        StoredRecord::Usable(UiPreferences::default())
    );
}

#[test]
fn a_directory_at_the_published_name_is_an_unsafe_target() {
    let root = Root::new("unsafe-target");
    std::fs::create_dir_all(root.file()).expect("a directory in the way");
    assert_eq!(
        storage::read(&root.root()),
        StoredRecord::Unusable(RecordProblem::UnsafeTarget)
    );
    let failure = storage::publish(&root.root(), &UiPreferences::default()).expect_err("a refusal");
    assert_eq!(failure.error, WriteError::UnsafeTarget);
    assert!(!failure.temporary_left_behind);
    assert!(!failure.error.retryable());
    // Nothing was created beside it, and the directory in the way is intact.
    assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);
    assert!(root.file().is_dir());
}

#[test]
fn publishing_replaces_the_stored_record_and_leaves_no_temporary() {
    let root = Root::new("replace");
    let first = UiPreferences::default();
    storage::publish(&root.root(), &first).expect("the first publish");
    assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);
    let second = UiPreferences {
        schema_version: SCHEMA_VERSION,
        appearance: AppearancePreferences {
            locale: UiLocale::ZhCn,
            density: RosterDensity::Compact,
        },
        layout: LayoutPreferences {
            roster: PanelPresentation::Hidden,
            details: PanelPresentation::Shown,
        },
    };
    storage::publish(&root.root(), &second).expect("the replacing publish");
    assert_eq!(storage::read(&root.root()), StoredRecord::Usable(second));
    assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);
}

/// A genuine Windows refusal: the published name is held by a handle that
/// denies delete, so the replace cannot take it.
///
/// Windows only, and deliberately not simulated elsewhere: what is being proved
/// is that this platform's sharing rules leave the old record intact, and a
/// platform without them would be proving something else.
#[cfg(windows)]
#[test]
fn a_locked_published_name_fails_the_publish_and_preserves_the_old_record() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let root = Root::new("locked");
    let original = UiPreferences::default();
    storage::publish(&root.root(), &original).expect("the original publish");
    let original_bytes = root.stored_bytes();

    // FILE_SHARE_READ only: readers are allowed, a replace is not.
    let held = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(root.file())
        .expect("the holding handle");

    let replacement = UiPreferences {
        appearance: AppearancePreferences {
            locale: UiLocale::ZhCn,
            density: RosterDensity::Compact,
        },
        ..original
    };
    let failure = storage::publish(&root.root(), &replacement).expect_err("a refusal");
    assert_eq!(failure.error, WriteError::NotPublished);
    assert!(failure.error.retryable());
    assert!(
        !failure.temporary_left_behind,
        "the private sibling this write created must be cleaned up"
    );
    assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);
    assert_eq!(root.stored_bytes(), original_bytes);
    assert_eq!(storage::read(&root.root()), StoredRecord::Usable(original));

    // Released, and the same publish now succeeds. The refusal was the lock,
    // not the writer.
    drop(held);
    storage::publish(&root.root(), &replacement).expect("the retried publish");
    assert_eq!(
        storage::read(&root.root()),
        StoredRecord::Usable(replacement)
    );
}

// -------------------------------------------------------------- store rules

#[test]
fn a_first_run_reads_absent_and_the_first_save_is_confirmed() {
    let root = Root::new("first-run");
    let store = root.store();
    assert_eq!(store.load(), UiPreferenceReadDto::Absent { revision: 0 });
    // A read must not have created anything.
    assert_eq!(root.entries(), Vec::<String>::new());

    let outcome = store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact));
    let committed = saved(&outcome);
    assert_eq!(committed.appearance.locale, UiLocale::ZhCn);
    assert_eq!(committed.appearance.density, RosterDensity::Compact);
    // Defaults for the group this commit did not name.
    assert_eq!(committed.layout, LayoutPreferences::default());
    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Loaded {
            preferences: committed,
            revision: 1
        }
    );
}

#[test]
fn each_accepted_publish_takes_the_next_revision() {
    let root = Root::new("revisions");
    let store = root.store();
    let first = store.save(&appearance(UiLocale::ZhCn, RosterDensity::Comfortable));
    let second = store.save(&appearance(UiLocale::En, RosterDensity::Compact));
    assert!(matches!(
        first,
        UiPreferenceSaveDto::Saved { revision: 1, .. }
    ));
    assert!(matches!(
        second,
        UiPreferenceSaveDto::Saved { revision: 2, .. }
    ));
    // The later answer describes the later record, so a caller that kept the
    // highest revision it has seen is holding the newest choice.
    assert_eq!(saved(&second).appearance.density, RosterDensity::Compact);
}

#[test]
fn a_layout_commit_and_an_appearance_commit_keep_each_others_fields() {
    let root = Root::new("merge");
    let store = root.store();
    saved(&store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact)));
    let after_layout =
        saved(&store.save(&layout(PanelPresentation::Hidden, PanelPresentation::Shown)));
    assert_eq!(after_layout.appearance.locale, UiLocale::ZhCn);
    assert_eq!(after_layout.layout.roster, PanelPresentation::Hidden);

    // And the other order: an appearance commit does not revert the layout the
    // shell committed while Settings was open.
    let after_appearance =
        saved(&store.save(&appearance(UiLocale::En, RosterDensity::Comfortable)));
    assert_eq!(after_appearance.layout.roster, PanelPresentation::Hidden);
    assert_eq!(after_appearance.layout.details, PanelPresentation::Shown);
    assert_eq!(after_appearance.appearance.locale, UiLocale::En);
}

#[test]
fn a_commit_merges_onto_what_is_on_disk_rather_than_onto_what_it_last_saw() {
    let root = Root::new("merge-base");
    let store = root.store();
    saved(&store.save(&appearance(UiLocale::En, RosterDensity::Comfortable)));
    // Something else publishes a newer layout while this caller was away. The
    // merge base is the file, so that newer field survives this commit.
    let mut newer = UiPreferences::default();
    newer.layout.details = PanelPresentation::Shown;
    storage::publish(&root.root(), &newer).expect("the intervening publish");

    let committed = saved(&store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact)));
    assert_eq!(committed.layout.details, PanelPresentation::Shown);
    assert_eq!(committed.appearance.locale, UiLocale::ZhCn);
}

#[test]
fn an_unusable_stored_record_is_reported_and_left_alone() {
    let root = Root::new("unusable");
    let store = root.store();
    let corrupt = b"{ this is not a preference record";
    root.store_bytes(corrupt);

    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Unusable {
            problem: "malformed",
            revision: 0
        }
    );
    // A second read does not repair it either. Reading is not a write.
    assert_eq!(root.stored_bytes(), corrupt);

    let refused = store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact));
    assert_eq!(
        refused,
        UiPreferenceSaveDto::StoredRecordUnusable {
            problem: "malformed",
            revision: 0
        }
    );
    assert_eq!(root.stored_bytes(), corrupt);
    assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);
}

#[test]
fn a_record_from_a_later_build_is_preserved_until_replacement_is_confirmed() {
    let root = Root::new("future");
    let store = root.store();
    let future = br#"{"schemaVersion":7,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"theme":"dark"}"#;
    root.store_bytes(future);

    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Unusable {
            problem: "unsupportedVersion",
            revision: 0
        }
    );
    assert!(matches!(
        store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact)),
        UiPreferenceSaveDto::StoredRecordUnusable {
            problem: "unsupportedVersion",
            ..
        }
    ));
    assert_eq!(root.stored_bytes(), future);

    // The confirmed replacement, which is the only thing that overwrites it.
    let committed = saved(&store.save(&UiPreferenceWriteDto {
        appearance: Some(AppearancePreferences::default()),
        layout: Some(LayoutPreferences::default()),
        replace_unusable: true,
    }));
    assert_eq!(committed, UiPreferences::default());
    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Loaded {
            preferences: UiPreferences::default(),
            revision: 1
        }
    );
}

#[test]
fn a_store_with_no_root_is_usable_and_claims_nothing() {
    let store = UiPreferenceStore::unavailable();
    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Unavailable {
            problem: "rootUnresolved",
            revision: 0
        }
    );
    assert_eq!(
        store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact)),
        UiPreferenceSaveDto::Unavailable {
            problem: "rootUnresolved",
            revision: 0
        }
    );
}

#[test]
fn a_commit_that_names_no_group_is_refused_without_a_write() {
    let root = Root::new("nothing");
    let store = root.store();
    assert_eq!(
        store.save(&UiPreferenceWriteDto {
            appearance: None,
            layout: None,
            replace_unusable: false,
        }),
        UiPreferenceSaveDto::Failed {
            problem: "nothingToSave",
            retryable: false,
            temporary_left_behind: false,
            revision: 0
        }
    );
    assert_eq!(root.entries(), Vec::<String>::new());
}

#[cfg(windows)]
#[test]
fn a_refused_write_reports_failure_without_advancing_the_revision() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let root = Root::new("store-locked");
    let store = root.store();
    let first = saved(&store.save(&appearance(UiLocale::En, RosterDensity::Comfortable)));
    let held = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(root.file())
        .expect("the holding handle");

    let failed = store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact));
    assert_eq!(
        failed,
        UiPreferenceSaveDto::Failed {
            problem: "notPublished",
            retryable: true,
            temporary_left_behind: false,
            // Unchanged: nothing was committed, so nothing took a revision.
            revision: 1
        }
    );
    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Loaded {
            preferences: first,
            revision: 1
        }
    );

    drop(held);
    let retried = store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact));
    assert!(matches!(
        retried,
        UiPreferenceSaveDto::Saved { revision: 2, .. }
    ));
}

// ------------------------------------------------------------- wire contract

#[test]
fn the_write_payload_refuses_a_field_this_boundary_does_not_own() {
    for payload in [
        r#"{"appearance":{"locale":"en","density":"comfortable"},"lastFolder":"D:\\data"}"#,
        r#"{"appearance":{"locale":"en","density":"comfortable","theme":"dark"}}"#,
        r#"{"layout":{"roster":"shown","details":"shown","width":280}}"#,
        r#"{"appearance":{"locale":"de","density":"comfortable"}}"#,
    ] {
        assert!(
            serde_json::from_str::<dto::UiPreferenceWriteDto>(payload).is_err(),
            "{payload} must not deserialize"
        );
    }
}

#[test]
fn the_write_payload_defaults_to_committing_nothing_and_replacing_nothing() {
    let empty: dto::UiPreferenceWriteDto =
        serde_json::from_str("{}").expect("an empty payload is well formed");
    assert_eq!(empty.appearance, None);
    assert_eq!(empty.layout, None);
    assert!(!empty.replace_unusable);
}

#[test]
fn every_read_outcome_serializes_with_its_own_tag() {
    let absent = serde_json::to_value(UiPreferenceReadDto::Absent { revision: 3 })
        .expect("the absent outcome");
    assert_eq!(absent["outcome"], "absent");
    assert_eq!(absent["revision"], 3);

    let loaded = serde_json::to_value(UiPreferenceReadDto::Loaded {
        preferences: UiPreferences::default(),
        revision: 4,
    })
    .expect("the loaded outcome");
    assert_eq!(loaded["outcome"], "loaded");
    assert_eq!(loaded["preferences"]["appearance"]["locale"], "en");
    assert_eq!(
        loaded["preferences"]["schemaVersion"],
        record::SCHEMA_VERSION
    );

    let unusable = serde_json::to_value(UiPreferenceReadDto::Unusable {
        problem: "oversized",
        revision: 5,
    })
    .expect("the unusable outcome");
    assert_eq!(unusable["outcome"], "unusable");
    assert_eq!(unusable["problem"], "oversized");
}

#[test]
fn a_failed_save_names_its_residue_on_the_wire() {
    let failed = serde_json::to_value(UiPreferenceSaveDto::Failed {
        problem: "notWritten",
        retryable: true,
        temporary_left_behind: true,
        revision: 2,
    })
    .expect("the failed outcome");
    assert_eq!(failed["outcome"], "failed");
    assert_eq!(failed["temporaryLeftBehind"], true);
    assert_eq!(failed["retryable"], true);
}
