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
    AppearancePreferences, DisplayPreferences, LayoutPreferences, MAX_RECORD_BYTES,
    MotionPreference, PanelPresentation, RecordProblem, RosterDensity, SCHEMA_VERSION,
    TextContrast, TextSize, UiLocale, UiPreferences, WheelHabit, read_record, write_record,
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
        display: None,
        replace_unusable: false,
    }
}

fn layout(roster: PanelPresentation, details: PanelPresentation) -> UiPreferenceWriteDto {
    UiPreferenceWriteDto {
        appearance: None,
        layout: Some(LayoutPreferences { roster, details }),
        display: None,
        replace_unusable: false,
    }
}

fn display(display: DisplayPreferences) -> UiPreferenceWriteDto {
    UiPreferenceWriteDto {
        appearance: None,
        layout: None,
        display: Some(display),
        replace_unusable: false,
    }
}

fn saved(outcome: &UiPreferenceSaveDto) -> UiPreferences {
    match outcome {
        UiPreferenceSaveDto::Saved { preferences, .. } => preferences.clone(),
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
        display: DisplayPreferences {
            text_size: TextSize::Large,
            contrast: TextContrast::High,
            motion: MotionPreference::Reduce,
            wheel_habit: WheelHabit::Figma,
            crosshair: true,
            grid: false,
            remember: false,
        },
        backend_folder: Some(installation_folder()),
    };
    let bytes = write_record(&record).expect("the serialized record");
    assert_eq!(read_record(&bytes), Ok(record));
}

/// An absolute folder on whatever platform runs the test, so "absolute" is
/// judged the way the platform judges it.
fn installation_folder() -> String {
    std::env::temp_dir()
        .join("ProteoWizard 3.0.26204")
        .to_str()
        .expect("a Unicode temporary directory")
        .to_owned()
}

fn with_folder(folder: &str) -> Vec<u8> {
    write_record(&UiPreferences {
        backend_folder: Some(folder.to_owned()),
        ..UiPreferences::default()
    })
    .expect("the serialized record")
}

// ------------------------------------------------- schema 1 on users' disks

/// What beta 1 wrote, byte for byte: `write_record` at tag `v0.1.0-beta.1`,
/// whose record has no folder field.
const BETA_ONE_RECORD: &str = concat!(
    r#"{"schemaVersion":1,"appearance":{"locale":"zh-CN","density":"compact"},"layout":{"roster":"shown","details":"hidden"}}"#,
    "\n"
);

/// The same choices as `main` wrote them before schema 2: still schema 1, with
/// the folder after the two groups.
fn schema_one_with_a_folder() -> Vec<u8> {
    let folder = serde_json::to_string(&installation_folder()).expect("the folder");
    format!(
        r#"{{"schemaVersion":1,"appearance":{{"locale":"zh-CN","density":"compact"}},"layout":{{"roster":"shown","details":"hidden"}},"backendFolder":{folder}}}{}"#,
        "\n"
    )
    .into_bytes()
}

/// What both of those read as, apart from the folder.
fn the_choices_in_those_records() -> UiPreferences {
    UiPreferences {
        appearance: AppearancePreferences {
            locale: UiLocale::ZhCn,
            density: RosterDensity::Compact,
        },
        layout: LayoutPreferences {
            roster: PanelPresentation::Shown,
            details: PanelPresentation::Hidden,
        },
        ..UiPreferences::default()
    }
}

#[test]
fn every_record_beta_one_could_write_reads_with_nothing_lost() {
    let panels = [
        ("automatic", PanelPresentation::Automatic),
        ("shown", PanelPresentation::Shown),
        ("hidden", PanelPresentation::Hidden),
    ];
    for (locale_name, locale) in [("en", UiLocale::En), ("zh-CN", UiLocale::ZhCn)] {
        for (density_name, density) in [
            ("comfortable", RosterDensity::Comfortable),
            ("compact", RosterDensity::Compact),
        ] {
            for (roster_name, roster) in panels {
                for (details_name, details) in panels {
                    let stored = format!(
                        r#"{{"schemaVersion":1,"appearance":{{"locale":"{locale_name}","density":"{density_name}"}},"layout":{{"roster":"{roster_name}","details":"{details_name}"}}}}{}"#,
                        "\n"
                    );
                    assert_eq!(
                        read_record(stored.as_bytes()),
                        Ok(UiPreferences {
                            appearance: AppearancePreferences { locale, density },
                            layout: LayoutPreferences { roster, details },
                            ..UiPreferences::default()
                        }),
                        "{stored}"
                    );
                }
            }
        }
    }
}

#[test]
fn both_shapes_of_schema_one_read_without_a_write_and_survive_the_next_change() {
    for (shape, folder) in [
        (BETA_ONE_RECORD.as_bytes().to_vec(), None),
        (schema_one_with_a_folder(), Some(installation_folder())),
    ] {
        let root = Root::new("schema-one");
        let store = root.store();
        root.store_bytes(&shape);
        let expected = UiPreferences {
            backend_folder: folder.clone(),
            ..the_choices_in_those_records()
        };

        // Reading gives schema 2 with the defaults, and leaves the file alone.
        assert_eq!(
            store.load(),
            UiPreferenceReadDto::Loaded {
                preferences: expected.clone(),
                revision: 0
            }
        );
        assert_eq!(
            store.remembered_backend_folder(),
            folder.as_deref().map(PathBuf::from)
        );
        assert_eq!(root.stored_bytes(), shape);
        assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);

        // The next change writes schema 2 and keeps everything it did not name.
        let committed =
            saved(&store.save(&layout(PanelPresentation::Hidden, PanelPresentation::Shown)));
        assert_eq!(
            committed,
            UiPreferences {
                layout: LayoutPreferences {
                    roster: PanelPresentation::Hidden,
                    details: PanelPresentation::Shown,
                },
                ..expected
            }
        );
        assert_eq!(
            root.stored_bytes(),
            write_record(&committed).expect("bytes")
        );
        let written: serde_json::Value =
            serde_json::from_slice(&root.stored_bytes()).expect("the written record");
        assert_eq!(written["schemaVersion"], 2);
        assert_eq!(written["display"]["remember"], true);
        assert_eq!(
            store.remembered_backend_folder(),
            folder.as_deref().map(PathBuf::from)
        );
    }
}

#[test]
fn remembering_a_folder_over_a_beta_one_record_keeps_its_choices() {
    let root = Root::new("schema-one-folder");
    let store = root.store();
    root.store_bytes(BETA_ONE_RECORD.as_bytes());
    let folder = PathBuf::from(installation_folder());
    assert_eq!(
        saved(&store.remember_backend_folder(Some(&folder))),
        UiPreferences {
            backend_folder: Some(installation_folder()),
            ..the_choices_in_those_records()
        }
    );
}

#[test]
fn a_schema_one_record_is_held_to_exactly_the_fields_schema_one_had() {
    assert!(read_record(BETA_ONE_RECORD.as_bytes()).is_ok());
    for document in [
        // A group from schema 2 under the old version is neither schema, and
        // reading it would drop what it says.
        r#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"display":{"textSize":"standard","contrast":"normal","motion":"system","wheelHabit":"draw","crosshair":false,"grid":true,"remember":true}}"#,
        r#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"theme":"dark"}"#,
        r#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"}}"#,
        r#"{"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"backendFolder":"ProteoWizard"}"#,
    ] {
        assert_eq!(
            read_record(document.as_bytes()),
            Err(RecordProblem::Malformed),
            "{document}"
        );
    }
}

// ------------------------------------------------------- the display group

/// The default record with its display group edited, as JSON.
fn with_display(edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
    let mut document = serde_json::to_value(UiPreferences::default()).expect("the document");
    edit(&mut document["display"]);
    serde_json::to_vec(&document).expect("the bytes")
}

#[test]
fn every_display_field_holds_exactly_its_domain_and_cannot_be_left_out() {
    use serde_json::{Value, json};
    let on_or_off = || {
        (
            vec![json!(true), json!(false)],
            vec![json!("on"), json!(1), Value::Null],
        )
    };
    for (field, (accepted, refused)) in [
        (
            "textSize",
            (
                vec![json!("standard"), json!("large")],
                vec![json!("huge"), json!(1)],
            ),
        ),
        (
            "contrast",
            (
                vec![json!("normal"), json!("high")],
                vec![json!("low"), Value::Null],
            ),
        ),
        (
            "motion",
            (
                vec![json!("system"), json!("reduce")],
                vec![json!("off"), json!(true)],
            ),
        ),
        (
            "wheelHabit",
            (
                vec![json!("draw"), json!("figma")],
                vec![json!("touch"), json!(0)],
            ),
        ),
        ("crosshair", on_or_off()),
        ("grid", on_or_off()),
        ("remember", on_or_off()),
    ] {
        for value in accepted {
            let document = with_display(|display| display[field] = value.clone());
            let record = read_record(&document).expect("a value in its domain");
            let stored = serde_json::to_value(record.display).expect("the group");
            assert_eq!(stored[field], value, "{field}");
        }
        for value in refused {
            let document = with_display(|display| display[field] = value.clone());
            assert_eq!(
                read_record(&document),
                Err(RecordProblem::Malformed),
                "{field}: {value}"
            );
        }
        let document = with_display(|display| {
            display.as_object_mut().expect("a group").remove(field);
        });
        assert_eq!(
            read_record(&document),
            Err(RecordProblem::Malformed),
            "{field} left out"
        );
    }
}

#[test]
fn a_schema_two_record_needs_the_group_and_refuses_anything_more_in_it() {
    assert_eq!(
        read_record(&with_display(|_| {})),
        Ok(UiPreferences::default())
    );
    let without_the_group = br#"{"schemaVersion":2,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}"#;
    assert_eq!(
        read_record(without_the_group),
        Err(RecordProblem::Malformed)
    );
    assert_eq!(
        read_record(&with_display(|display| display["theme"] = "dark".into())),
        Err(RecordProblem::Malformed)
    );
    assert_eq!(
        read_record(&with_display(|display| *display = "standard".into())),
        Err(RecordProblem::Malformed)
    );
    // The rest of a schema 2 record is held the same way, at every level.
    for (group, field, value) in [
        (None, "lastFolder", serde_json::json!("D:\\data")),
        (Some("appearance"), "theme", serde_json::json!("dark")),
        (Some("appearance"), "locale", serde_json::json!("de")),
        (Some("layout"), "width", serde_json::json!(280)),
        (Some("layout"), "roster", serde_json::json!("maybe")),
    ] {
        let mut record = serde_json::to_value(UiPreferences::default()).expect("the document");
        let target = match group {
            Some(group) => &mut record[group],
            None => &mut record,
        };
        target[field] = value;
        assert_eq!(
            read_record(&serde_json::to_vec(&record).expect("the bytes")),
            Err(RecordProblem::Malformed),
            "{record}"
        );
    }
}

#[test]
fn a_stored_folder_must_be_absolute_bounded_and_printable() {
    // Positive control first, in the same shape as every refusal below.
    assert!(read_record(&with_folder(&installation_folder())).is_ok());
    let too_long = format!(
        "{}{}",
        installation_folder(),
        "x".repeat(record::MAX_BACKEND_FOLDER_BYTES)
    );
    for folder in [
        "ProteoWizard".to_owned(),
        String::new(),
        too_long,
        format!("{}\u{7}", installation_folder()),
    ] {
        assert_eq!(
            read_record(&with_folder(&folder)),
            Err(RecordProblem::Malformed),
            "{folder:?} must not be accepted"
        );
    }
    // The bound keeps a record holding the longest folder, every separator
    // escaped, inside the record's own limit.
    let separators = format!("{}\\", installation_folder())
        .chars()
        .chain(std::iter::repeat('\\'))
        .take(record::MAX_BACKEND_FOLDER_BYTES)
        .collect::<String>();
    let longest = with_folder(&separators);
    assert!(
        longest.len() as u64 <= MAX_RECORD_BYTES,
        "{}",
        longest.len()
    );
}

#[test]
fn the_stored_document_carries_only_the_allowlisted_fields() {
    let bytes = write_record(&UiPreferences::default()).expect("the serialized record");
    let document = String::from_utf8(bytes).expect("utf-8");
    // Named exactly, so a field added to the record without a decision fails
    // here rather than reaching a user's profile.
    assert_eq!(
        document.trim_end(),
        r#"{"schemaVersion":2,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"display":{"textSize":"standard","contrast":"normal","motion":"system","wheelHabit":"draw","crosshair":false,"grid":true,"remember":true}}"#
    );
}

#[test]
fn a_record_from_another_schema_is_unsupported_rather_than_malformed() {
    for version in [0, 3, 7, u32::MAX] {
        let other = format!(
            r#"{{"schemaVersion":{version},"appearance":{{"locale":"en","density":"comfortable"}},"layout":{{"roster":"automatic","details":"automatic"}},"theme":"dark"}}"#
        );
        assert_eq!(
            read_record(other.as_bytes()),
            Err(RecordProblem::UnsupportedVersion),
            "{version}"
        );
    }
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
fn the_size_bound_falls_on_the_same_byte_for_either_schema() {
    let root = Root::new("bound");
    let bound = usize::try_from(MAX_RECORD_BYTES).expect("the bound fits");
    for record in [
        BETA_ONE_RECORD.as_bytes().to_vec(),
        write_record(&UiPreferences::default()).expect("bytes"),
    ] {
        let mut padded = record;
        padded.resize(bound, b' ');
        root.store_bytes(&padded);
        assert!(matches!(
            storage::read(&root.root()),
            StoredRecord::Usable(_)
        ));
        padded.push(b' ');
        root.store_bytes(&padded);
        assert_eq!(
            storage::read(&root.root()),
            StoredRecord::Unusable(RecordProblem::Oversized)
        );
    }
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
        display: DisplayPreferences::default(),
        backend_folder: None,
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
        ..original.clone()
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
    let future = br#"{"schemaVersion":3,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"},"theme":"dark"}"#;
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
        display: None,
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
            display: None,
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

// -------------------------------------------------------- the remember switch

/// A record with choices in it and remembering switched off.
fn a_record_with_remembering_off() -> UiPreferences {
    UiPreferences {
        display: DisplayPreferences {
            text_size: TextSize::Large,
            remember: false,
            ..DisplayPreferences::default()
        },
        ..the_choices_in_those_records()
    }
}

#[test]
fn a_commit_that_leaves_remembering_off_writes_nothing_and_says_so() {
    let root = Root::new("remember-off");
    let store = root.store();
    let stored = a_record_with_remembering_off();
    storage::publish(&root.root(), &stored).expect("the stored record");
    let before = root.stored_bytes();

    for request in [
        appearance(UiLocale::En, RosterDensity::Comfortable),
        layout(PanelPresentation::Hidden, PanelPresentation::Shown),
        display(DisplayPreferences {
            contrast: TextContrast::High,
            ..stored.display
        }),
    ] {
        assert_eq!(
            store.save(&request),
            UiPreferenceSaveDto::NotRemembered { revision: 0 }
        );
        assert_eq!(root.stored_bytes(), before);
    }
    assert_eq!(root.entries(), vec!["ui-preferences.json".to_owned()]);
    // Nothing was published, so nothing took a revision, and a restart finds
    // what was stored before remembering went off.
    assert_eq!(
        store.load(),
        UiPreferenceReadDto::Loaded {
            preferences: stored,
            revision: 0
        }
    );
}

#[test]
fn turning_remembering_off_writes_the_switch_and_no_other_change() {
    let root = Root::new("remember-turned-off");
    let store = root.store();
    let chosen = saved(&store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact)));

    let committed = saved(&store.save(&UiPreferenceWriteDto {
        appearance: Some(AppearancePreferences::default()),
        layout: Some(LayoutPreferences {
            roster: PanelPresentation::Hidden,
            details: PanelPresentation::Hidden,
        }),
        display: Some(DisplayPreferences {
            text_size: TextSize::Large,
            remember: false,
            ..DisplayPreferences::default()
        }),
        replace_unusable: false,
    }));
    assert_eq!(
        committed,
        UiPreferences {
            display: DisplayPreferences {
                remember: false,
                ..DisplayPreferences::default()
            },
            ..chosen
        }
    );
    assert_eq!(
        root.stored_bytes(),
        write_record(&committed).expect("bytes")
    );
}

#[test]
fn turning_remembering_on_writes_the_whole_commit_and_later_ones_again() {
    let root = Root::new("remember-turned-on");
    let store = root.store();
    storage::publish(&root.root(), &a_record_with_remembering_off()).expect("the stored record");

    let on = DisplayPreferences {
        contrast: TextContrast::High,
        ..DisplayPreferences::default()
    };
    let committed = saved(&store.save(&UiPreferenceWriteDto {
        appearance: Some(AppearancePreferences::default()),
        ..display(on)
    }));
    assert_eq!(committed.display, on);
    assert_eq!(committed.appearance, AppearancePreferences::default());
    assert_eq!(committed.layout, the_choices_in_those_records().layout);

    let later = saved(&store.save(&appearance(UiLocale::ZhCn, RosterDensity::Comfortable)));
    assert_eq!(later.appearance.locale, UiLocale::ZhCn);
    assert_eq!(later.display, on);
}

#[test]
fn a_first_commit_can_turn_remembering_off_and_the_record_keeps_the_switch() {
    let root = Root::new("remember-first");
    let store = root.store();
    let off = DisplayPreferences {
        remember: false,
        ..DisplayPreferences::default()
    };
    assert_eq!(saved(&store.save(&display(off))).display, off);
    assert!(matches!(
        store.load(),
        UiPreferenceReadDto::Loaded { preferences, .. } if !preferences.display.remember
    ));
}

/// A reading, not an owner decision (V-7.3 does not say). A different answer
/// changes this test and the closure in `remember_backend_folder`.
#[test]
fn the_folder_is_still_remembered_and_forgotten_while_remembering_is_off() {
    let root = Root::new("remember-folder");
    let store = root.store();
    storage::publish(&root.root(), &a_record_with_remembering_off()).expect("the stored record");
    let folder = PathBuf::from(installation_folder());

    let remembered = saved(&store.remember_backend_folder(Some(&folder)));
    assert_eq!(remembered.backend_folder, Some(installation_folder()));
    assert!(!remembered.display.remember);
    assert_eq!(store.remembered_backend_folder(), Some(folder));

    let forgotten = saved(&store.remember_backend_folder(None));
    assert_eq!(forgotten, a_record_with_remembering_off());
    assert_eq!(store.remembered_backend_folder(), None);
}

#[test]
fn replacing_an_unusable_record_starts_with_remembering_on() {
    let root = Root::new("remember-replace");
    let store = root.store();
    root.store_bytes(b"{ not a record");
    let committed = saved(&store.save(&UiPreferenceWriteDto {
        replace_unusable: true,
        ..appearance(UiLocale::ZhCn, RosterDensity::Compact)
    }));
    assert_eq!(committed.appearance.locale, UiLocale::ZhCn);
    assert_eq!(committed.display, DisplayPreferences::default());
}

/// A commit with remembering off and every group named, as a replacement or a
/// turn-off would carry them.
fn every_group_with_remembering_off(replace_unusable: bool) -> UiPreferenceWriteDto {
    UiPreferenceWriteDto {
        appearance: Some(AppearancePreferences {
            locale: UiLocale::ZhCn,
            density: RosterDensity::Compact,
        }),
        layout: Some(LayoutPreferences {
            roster: PanelPresentation::Hidden,
            details: PanelPresentation::Shown,
        }),
        display: Some(DisplayPreferences {
            text_size: TextSize::Large,
            remember: false,
            ..DisplayPreferences::default()
        }),
        replace_unusable,
    }
}

/// The confirmation promises "stores the preferences shown here", and the record
/// it replaces has nothing to keep, so the switch does not narrow it.
#[test]
fn replacing_an_unusable_record_stores_what_was_confirmed_with_remembering_off() {
    let root = Root::new("remember-replace-off");
    let store = root.store();
    root.store_bytes(br#"{"schemaVersion":3,"theme":"dark"}"#);
    let request = every_group_with_remembering_off(true);

    let committed = saved(&store.save(&request));
    assert_eq!(
        committed,
        UiPreferences {
            appearance: request.appearance.expect("named"),
            layout: request.layout.expect("named"),
            display: request.display.expect("named"),
            ..UiPreferences::default()
        }
    );
    assert_eq!(
        root.stored_bytes(),
        write_record(&committed).expect("bytes")
    );

    // Replaced, it is an ordinary record with remembering off.
    let before = root.stored_bytes();
    assert_eq!(
        store.save(&request),
        UiPreferenceSaveDto::NotRemembered { revision: 1 }
    );
    assert_eq!(root.stored_bytes(), before);
}

/// The confirmation is for a record this build refused. On a usable one it
/// widens nothing, so the flag alone cannot be what writes a whole commit.
#[test]
fn the_replace_flag_on_a_usable_record_leaves_the_write_rule_alone() {
    let root = Root::new("remember-replace-usable");
    let store = root.store();
    let chosen = saved(&store.save(&layout(
        PanelPresentation::Shown,
        PanelPresentation::Hidden,
    )));

    let committed = saved(&store.save(&every_group_with_remembering_off(true)));
    assert_eq!(
        committed,
        UiPreferences {
            display: DisplayPreferences {
                remember: false,
                ..DisplayPreferences::default()
            },
            ..chosen
        }
    );
    assert_eq!(
        root.stored_bytes(),
        write_record(&committed).expect("bytes")
    );
}

// ------------------------------------------------------ remembered folder

#[test]
fn a_remembered_folder_survives_other_commits_and_can_be_forgotten() {
    let root = Root::new("remembered-folder");
    let store = root.store();
    let folder = PathBuf::from(installation_folder());
    assert_eq!(store.remembered_backend_folder(), None);

    let remembered = saved(&store.remember_backend_folder(Some(&folder)));
    assert_eq!(remembered.backend_folder, Some(installation_folder()));
    assert_eq!(store.remembered_backend_folder(), Some(folder.clone()));

    // A Settings apply and a panel toggle each commit only their own group,
    // and the merge base is what is stored, so neither drops the folder.
    let _ = saved(&store.save(&appearance(UiLocale::ZhCn, RosterDensity::Compact)));
    let _ = saved(&store.save(&layout(PanelPresentation::Hidden, PanelPresentation::Shown)));
    assert_eq!(store.remembered_backend_folder(), Some(folder));

    let forgotten = saved(&store.remember_backend_folder(None));
    assert_eq!(forgotten.backend_folder, None);
    assert_eq!(forgotten.appearance.locale, UiLocale::ZhCn);
    assert_eq!(store.remembered_backend_folder(), None);
    // Forgotten is gone, not blanked: the document is byte for byte what a
    // record that never remembered one is.
    assert_eq!(
        root.stored_bytes(),
        write_record(&UiPreferences {
            appearance: AppearancePreferences {
                locale: UiLocale::ZhCn,
                density: RosterDensity::Compact,
            },
            layout: LayoutPreferences {
                roster: PanelPresentation::Hidden,
                details: PanelPresentation::Shown,
            },
            ..UiPreferences::default()
        })
        .expect("bytes")
    );
}

#[test]
fn a_folder_is_never_remembered_over_a_record_this_build_refused() {
    let root = Root::new("remembered-over-unusable");
    let store = root.store();
    let future = br#"{"schemaVersion":3,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}"#;
    root.store_bytes(future);
    assert!(matches!(
        store.remember_backend_folder(Some(&PathBuf::from(installation_folder()))),
        UiPreferenceSaveDto::StoredRecordUnusable {
            problem: "unsupportedVersion",
            ..
        }
    ));
    assert!(matches!(
        store.remember_backend_folder(None),
        UiPreferenceSaveDto::StoredRecordUnusable { .. }
    ));
    assert_eq!(root.stored_bytes(), future);
    assert_eq!(store.remembered_backend_folder(), None);
}

#[test]
fn a_relative_folder_is_refused_without_a_write() {
    let root = Root::new("remembered-relative");
    let store = root.store();
    let _ = saved(&store.save(&appearance(UiLocale::En, RosterDensity::Compact)));
    let before = root.stored_bytes();
    assert!(matches!(
        store.remember_backend_folder(Some(&PathBuf::from("ProteoWizard"))),
        UiPreferenceSaveDto::Failed {
            problem: "invalidRecord",
            ..
        }
    ));
    assert_eq!(root.stored_bytes(), before);
}

#[test]
fn the_webview_never_receives_the_remembered_folder() {
    let root = Root::new("remembered-wire");
    let store = root.store();
    let folder = installation_folder();
    let remembered = store.remember_backend_folder(Some(&PathBuf::from(&folder)));
    let loaded = store.load();
    // Rust holds it ...
    assert!(matches!(
        &loaded,
        UiPreferenceReadDto::Loaded { preferences, .. }
            if preferences.backend_folder.as_deref() == Some(folder.as_str())
    ));
    // ... and neither answer a document receives names it, or the field.
    for outcome in [
        serde_json::to_value(&remembered).expect("the saved outcome"),
        serde_json::to_value(&loaded).expect("the loaded outcome"),
    ] {
        let rendered = outcome.to_string();
        assert!(!rendered.contains("ProteoWizard 3.0.26204"), "{rendered}");
        assert!(!rendered.contains("backendFolder"), "{rendered}");
        assert_eq!(
            outcome["preferences"]["schemaVersion"],
            record::SCHEMA_VERSION
        );
        assert_eq!(outcome["preferences"]["display"]["remember"], true);
    }
}

#[test]
fn the_write_payload_cannot_name_a_backend_folder() {
    let payload =
        r#"{"appearance":{"locale":"en","density":"comfortable"},"backendFolder":"D:\\pwiz"}"#;
    assert!(serde_json::from_str::<dto::UiPreferenceWriteDto>(payload).is_err());
}

// ------------------------------------------------------------- wire contract

#[test]
fn the_write_payload_refuses_a_field_this_boundary_does_not_own() {
    for payload in [
        r#"{"appearance":{"locale":"en","density":"comfortable"},"lastFolder":"D:\\data"}"#,
        r#"{"appearance":{"locale":"en","density":"comfortable","theme":"dark"}}"#,
        r#"{"layout":{"roster":"shown","details":"shown","width":280}}"#,
        r#"{"appearance":{"locale":"de","density":"comfortable"}}"#,
        r#"{"display":{"remember":false}}"#,
        r#"{"display":{"textSize":"huge","contrast":"normal","motion":"system","wheelHabit":"draw","crosshair":false,"grid":true,"remember":true}}"#,
        r#"{"display":{"textSize":"standard","contrast":"normal","motion":"system","wheelHabit":"draw","crosshair":false,"grid":true,"remember":true,"backendFolder":"D:\\pwiz"}}"#,
    ] {
        assert!(
            serde_json::from_str::<dto::UiPreferenceWriteDto>(payload).is_err(),
            "{payload} must not deserialize"
        );
    }
}

#[test]
fn the_write_payload_can_commit_the_display_group() {
    let payload: dto::UiPreferenceWriteDto = serde_json::from_str(
        r#"{"display":{"textSize":"large","contrast":"high","motion":"reduce","wheelHabit":"figma","crosshair":true,"grid":false,"remember":false}}"#,
    )
    .expect("the group");
    assert_eq!(
        payload.display,
        Some(DisplayPreferences {
            text_size: TextSize::Large,
            contrast: TextContrast::High,
            motion: MotionPreference::Reduce,
            wheel_habit: WheelHabit::Figma,
            crosshair: true,
            grid: false,
            remember: false,
        })
    );
}

#[test]
fn the_write_payload_defaults_to_committing_nothing_and_replacing_nothing() {
    let empty: dto::UiPreferenceWriteDto =
        serde_json::from_str("{}").expect("an empty payload is well formed");
    assert_eq!(empty.appearance, None);
    assert_eq!(empty.layout, None);
    assert_eq!(empty.display, None);
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

#[test]
fn a_commit_not_remembered_says_so_on_the_wire() {
    let answer = serde_json::to_value(UiPreferenceSaveDto::NotRemembered { revision: 3 })
        .expect("the answer");
    assert_eq!(
        answer,
        serde_json::json!({ "outcome": "notRemembered", "revision": 3 })
    );
}
