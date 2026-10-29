//! User-saved conversion presets: named conversion intents a user chose to keep
//! (ADR 0055).
//!
//! ## What this boundary is
//!
//! Four operations -- list, save, rename, delete -- over one versioned JSON
//! document beside the UI preference record, under the same binding: the same
//! per-user application-local directory, the same task-owned QA root under the
//! `e2e` feature, and the same reason when there is none. The webview names a
//! preset by its name and sends an intent; it never names a path, a file or a
//! document. Storage is the preference store's own mechanism: a bounded read, a
//! private-sibling replace through [`crate::local_document`], and a read-back
//! before anything is called saved. Every write is a read-modify-write from
//! disk under this store's own lock, which no other lane takes.
//!
//! ## Two levels of unusable
//!
//! - **The document**: corrupt, another schema, oversized, unreadable, or not an
//!   ordinary file. Listed as unusable with its reason and left exactly as
//!   found. A save replaces it only with the explicit `replaceUnusable`
//!   confirmation; rename and delete refuse, because there is nothing in it they
//!   could address.
//! - **One preset**: its intent is not one this build can express. Listed as
//!   unusable with its reason and without its intent, so it cannot be applied,
//!   and written back unchanged by every other operation. It can still be
//!   renamed and deleted. Nothing is altered or dropped to make it fit.
//!
//! ## Presets are the user's
//!
//! MSCanvas ships none, so no shipped preset can insert a picker (ADR 0055,
//! decision 7). Saving to a taken name, or renaming onto one, is refused unless
//! the save carries `replaceExisting`. A preset confers no authority: applying
//! one is the interface handing its intent to the conversion configuration
//! authority (ADR 0044), which decides at plan time whether the installed build
//! can run it. Nothing here asks the installed build.
//!
//! ## The intent seam
//!
//! The intent is stored as an opaque JSON value and judged by [`check_intent`]
//! alone, on every save and on every listing. Until ADR 0055's structured
//! `ConversionIntent` lands, it accepts exactly today's wire: the stable id
//! string of an admitted row. When the structured intent lands, `check_intent`
//! becomes "deserialize the structured intent from this value and build it",
//! answering the builder's refusal code, and nothing else here changes. Presets
//! saved as stable-id strings then list as unusable (`notExpressible`) unless
//! that function chooses to accept them -- fail closed, by design, rather than
//! migrated silently.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use mscanvas_proteowizard::ConversionIntent;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::local_document;
use crate::preferences::record::RecordProblem;
use crate::preferences::storage::{WriteError, from_read_refusal, from_write_refusal};

/// The only document schema this build reads or writes. Anything else is
/// refused as unsupported and left alone, never migrated.
pub const SCHEMA_VERSION: u32 = 1;

/// The largest stored document this build will read or write.
///
/// A bound on what is pulled into memory, not a budget: structured intents with
/// filter chains are coming, so the margin is generous.
pub const MAX_DOCUMENT_BYTES: u64 = 512 * 1024;

/// The most presets one document holds.
pub const MAX_PRESETS: usize = 200;

/// The longest name, in characters.
pub const MAX_NAME_CHARS: usize = 80;

const FILE_NAME: &str = "conversion-presets.json";

/// Distinct from the preference record's prefix, so a residue names its owner.
const TEMPORARY_PREFIX: &str = ".mscanvas-conversion-presets-";

/// The seam the structured intent plugs into: whether this build can express
/// `intent`, or the stable code saying why not.
///
/// # Errors
///
/// `notExpressible` for anything that is not an admitted row's stable id.
pub fn check_intent(intent: &Value) -> Result<(), &'static str> {
    intent
        .as_str()
        .and_then(ConversionIntent::from_stable_id)
        .map(|_| ())
        .ok_or("notExpressible")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PresetDocument {
    schema_version: u32,
    presets: Vec<StoredPreset>,
}

/// One stored preset. The intent is kept as the parsed value and written back
/// as it was read: semantically unchanged, with whitespace and key order the
/// writer's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredPreset {
    name: String,
    intent: Value,
}

impl PresetDocument {
    const fn empty() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            presets: Vec::new(),
        }
    }
}

/// A name this store accepts: non-empty, already trimmed, bounded, and free of
/// control characters.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.trim() == name
        && name.chars().count() <= MAX_NAME_CHARS
        && !name.chars().any(char::is_control)
}

/// Names are unique ignoring case, so "Fast" and "fast" are one preset.
fn same_name(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

/// Reads one document, or says why it cannot be used.
///
/// The version is probed first, so a document from a later build reads as
/// unsupported rather than malformed. The envelope -- names and count -- is
/// this build's own and must hold whole; intents are judged per preset when
/// listed, because the intent vocabulary is what changes between builds.
fn read_document(bytes: &[u8]) -> Result<PresetDocument, RecordProblem> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionProbe {
        schema_version: Option<u32>,
    }

    let probe: VersionProbe =
        serde_json::from_slice(bytes).map_err(|_| RecordProblem::Malformed)?;
    match probe.schema_version {
        Some(SCHEMA_VERSION) => {}
        Some(_) => return Err(RecordProblem::UnsupportedVersion),
        None => return Err(RecordProblem::Malformed),
    }
    let document: PresetDocument =
        serde_json::from_slice(bytes).map_err(|_| RecordProblem::Malformed)?;
    let presets = &document.presets;
    let envelope_holds = presets.len() <= MAX_PRESETS
        && presets.iter().enumerate().all(|(index, preset)| {
            valid_name(&preset.name)
                && !presets[..index]
                    .iter()
                    .any(|earlier| same_name(&earlier.name, &preset.name))
        });
    if !envelope_holds {
        return Err(RecordProblem::Malformed);
    }
    Ok(document)
}

fn write_document(document: &PresetDocument) -> Option<Vec<u8>> {
    let mut bytes = serde_json::to_vec(document).ok()?;
    bytes.push(b'\n');
    Some(bytes)
}

#[derive(Debug, PartialEq)]
enum Stored {
    Absent,
    Usable(PresetDocument),
    Unusable(RecordProblem),
}

fn read(file: &Path) -> Stored {
    match local_document::read_bounded(file, MAX_DOCUMENT_BYTES) {
        Ok(None) => Stored::Absent,
        Ok(Some(bytes)) => match read_document(&bytes) {
            Ok(document) => Stored::Usable(document),
            Err(problem) => Stored::Unusable(problem),
        },
        Err(refusal) => Stored::Unusable(from_read_refusal(refusal)),
    }
}

/// One preset as the webview sees it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresetEntryDto {
    /// Applicable: the intent is one this build can express.
    Usable { name: String, intent: Value },
    /// Kept, listed, renamable and deletable, and never applicable. The intent
    /// is withheld so it cannot be handed on.
    Unusable { name: String, problem: &'static str },
}

/// What a listing found.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresetListDto {
    /// The stored presets in their saved order. Empty on a first run, which
    /// creates nothing.
    Listed { presets: Vec<PresetEntryDto> },
    /// The document is not one this build will use. Its bytes are untouched.
    Unusable { problem: &'static str },
    /// There is nowhere to store presets this session.
    Unavailable { problem: &'static str },
}

/// What one save, rename or delete did.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresetWriteDto {
    /// Published, read back and confirmed. `presets` is the confirmed listing.
    Committed { presets: Vec<PresetEntryDto> },
    /// The request itself was refused: `nameInvalid`, `nameTaken`,
    /// `unknownPreset`, `tooManyPresets`, or the intent's own refusal code.
    /// Nothing was written.
    Refused { problem: &'static str },
    /// The stored document is not this build's and replacing it was not
    /// confirmed. Nothing was written.
    StoredRecordUnusable { problem: &'static str },
    /// There is nowhere to write. Nothing was written.
    Unavailable { problem: &'static str },
    /// The write did not complete. The last confirmed document, if any, is
    /// still what a restart will find.
    Failed {
        problem: &'static str,
        retryable: bool,
        temporary_left_behind: bool,
    },
}

/// Save one preset under a name.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetSaveRequest {
    /// Trimmed before it is judged.
    pub name: String,
    pub intent: Value,
    /// The explicit confirmation to replace the intent of the preset that
    /// already has this name. False refuses with `nameTaken`.
    #[serde(default)]
    pub replace_existing: bool,
    /// The explicit confirmation to replace an unusable stored document with a
    /// new one holding only this preset.
    #[serde(default)]
    pub replace_unusable: bool,
}

/// Rename the preset named `name` exactly, as listed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetRenameRequest {
    pub name: String,
    /// Trimmed before it is judged.
    pub new_name: String,
}

/// Delete the preset named `name` exactly, as listed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetDeleteRequest {
    pub name: String,
}

fn entries(document: &PresetDocument) -> Vec<PresetEntryDto> {
    document
        .presets
        .iter()
        .map(|preset| match check_intent(&preset.intent) {
            Ok(()) => PresetEntryDto::Usable {
                name: preset.name.clone(),
                intent: preset.intent.clone(),
            },
            Err(problem) => PresetEntryDto::Unusable {
                name: preset.name.clone(),
                problem,
            },
        })
        .collect()
}

/// The session's conversion preset store.
pub struct PresetStore {
    /// The bound directory, or why there is none. Never sent anywhere.
    directory: Result<PathBuf, &'static str>,
    lane: Mutex<()>,
}

impl PresetStore {
    /// A store over the preference store's binding.
    #[must_use]
    pub fn over(directory: Result<PathBuf, &'static str>) -> Self {
        Self {
            directory,
            lane: Mutex::new(()),
        }
    }

    /// Lists the stored presets. Reads and never writes.
    #[must_use]
    pub fn list(&self) -> PresetListDto {
        let _lane = self.lane.lock().unwrap_or_else(PoisonError::into_inner);
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return PresetListDto::Unavailable { problem },
        };
        match read(&directory.join(FILE_NAME)) {
            Stored::Absent => PresetListDto::Listed {
                presets: Vec::new(),
            },
            Stored::Usable(document) => PresetListDto::Listed {
                presets: entries(&document),
            },
            Stored::Unusable(problem) => PresetListDto::Unusable {
                problem: problem.stable_id(),
            },
        }
    }

    /// Saves one preset. The intent must be expressible now; a taken name is
    /// refused unless `replaceExisting` confirms replacing that preset.
    #[must_use]
    pub fn save(&self, request: &PresetSaveRequest) -> PresetWriteDto {
        let name = request.name.trim();
        if !valid_name(name) {
            return PresetWriteDto::Refused {
                problem: "nameInvalid",
            };
        }
        if let Err(problem) = check_intent(&request.intent) {
            return PresetWriteDto::Refused { problem };
        }
        self.commit(request.replace_unusable, |presets| {
            let preset = StoredPreset {
                name: name.to_owned(),
                intent: request.intent.clone(),
            };
            match presets
                .iter()
                .position(|stored| same_name(&stored.name, name))
            {
                Some(index) if request.replace_existing => presets[index] = preset,
                Some(_) => return Err("nameTaken"),
                None if presets.len() >= MAX_PRESETS => return Err("tooManyPresets"),
                None => presets.push(preset),
            }
            Ok(())
        })
    }

    /// Renames one preset, usable or not. Its intent is not touched.
    #[must_use]
    pub fn rename(&self, request: &PresetRenameRequest) -> PresetWriteDto {
        let new_name = request.new_name.trim();
        if !valid_name(new_name) {
            return PresetWriteDto::Refused {
                problem: "nameInvalid",
            };
        }
        self.commit(false, |presets| {
            if !presets.iter().any(|preset| preset.name == request.name) {
                return Err("unknownPreset");
            }
            if presets
                .iter()
                .any(|preset| preset.name != request.name && same_name(&preset.name, new_name))
            {
                return Err("nameTaken");
            }
            for preset in presets.iter_mut() {
                if preset.name == request.name {
                    new_name.clone_into(&mut preset.name);
                }
            }
            Ok(())
        })
    }

    /// Deletes one preset, usable or not.
    #[must_use]
    pub fn delete(&self, request: &PresetDeleteRequest) -> PresetWriteDto {
        self.commit(false, |presets| {
            let index = presets
                .iter()
                .position(|preset| preset.name == request.name)
                .ok_or("unknownPreset")?;
            presets.remove(index);
            Ok(())
        })
    }

    /// One read-modify-write from disk, published and read back under the lock.
    fn commit(
        &self,
        replace_unusable: bool,
        change: impl FnOnce(&mut Vec<StoredPreset>) -> Result<(), &'static str>,
    ) -> PresetWriteDto {
        let _lane = self.lane.lock().unwrap_or_else(PoisonError::into_inner);
        let directory = match &self.directory {
            Ok(directory) => directory,
            Err(problem) => return PresetWriteDto::Unavailable { problem },
        };
        let file = directory.join(FILE_NAME);
        let mut document = match read(&file) {
            Stored::Absent => PresetDocument::empty(),
            Stored::Usable(document) => document,
            Stored::Unusable(_) if replace_unusable => PresetDocument::empty(),
            Stored::Unusable(problem) => {
                return PresetWriteDto::StoredRecordUnusable {
                    problem: problem.stable_id(),
                };
            }
        };
        if let Err(problem) = change(&mut document.presets) {
            return PresetWriteDto::Refused { problem };
        }
        let failed = |error: WriteError| PresetWriteDto::Failed {
            problem: error.stable_id(),
            retryable: error.retryable(),
            temporary_left_behind: false,
        };
        let Some(bytes) = write_document(&document) else {
            return failed(WriteError::NotWritten);
        };
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return failed(WriteError::Oversized);
        }
        // Judged by this build's own reader before it is written.
        if read_document(&bytes).as_ref() != Ok(&document) {
            return PresetWriteDto::Failed {
                problem: "invalidRecord",
                retryable: false,
                temporary_left_behind: false,
            };
        }
        if std::fs::create_dir_all(directory).is_err() {
            return failed(WriteError::DirectoryUnusable);
        }
        if let Err(failure) =
            local_document::publish_through_temporary(directory, &file, &bytes, TEMPORARY_PREFIX)
        {
            let failure = from_write_refusal(failure);
            return PresetWriteDto::Failed {
                problem: failure.error.stable_id(),
                retryable: failure.error.retryable(),
                temporary_left_behind: failure.temporary_left_behind,
            };
        }
        if read(&file) != Stored::Usable(document.clone()) {
            return PresetWriteDto::Failed {
                problem: "notConfirmed",
                retryable: true,
                temporary_left_behind: false,
            };
        }
        PresetWriteDto::Committed {
            presets: entries(&document),
        }
    }
}

#[cfg(test)]
mod tests {
    //! Real-filesystem coverage: actual directories under the system temporary
    //! root, driven through the production store.

    use std::sync::atomic::{AtomicU64, Ordering};

    use serde_json::json;

    use super::*;

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct Root(PathBuf);

    impl Root {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mscanvas-presets-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("the test root");
            Self(path)
        }

        fn store(&self) -> PresetStore {
            PresetStore::over(Ok(self.0.clone()))
        }

        fn file(&self) -> PathBuf {
            self.0.join(FILE_NAME)
        }

        fn put(&self, bytes: &[u8]) {
            std::fs::write(self.file(), bytes).expect("the stored bytes");
        }

        fn bytes(&self) -> Vec<u8> {
            std::fs::read(self.file()).expect("the stored bytes")
        }

        fn entries(&self) -> Vec<String> {
            let mut names: Vec<String> = std::fs::read_dir(&self.0)
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
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn intent(row: usize) -> Value {
        Value::String(ConversionIntent::ADMITTED[row].intent().stable_id())
    }

    fn save(name: &str, intent: Value) -> PresetSaveRequest {
        PresetSaveRequest {
            name: name.to_owned(),
            intent,
            replace_existing: false,
            replace_unusable: false,
        }
    }

    fn rename(name: &str, new_name: &str) -> PresetRenameRequest {
        PresetRenameRequest {
            name: name.to_owned(),
            new_name: new_name.to_owned(),
        }
    }

    fn delete(name: &str) -> PresetDeleteRequest {
        PresetDeleteRequest {
            name: name.to_owned(),
        }
    }

    fn names(outcome: &PresetWriteDto) -> Vec<&str> {
        let PresetWriteDto::Committed { presets } = outcome else {
            panic!("not committed: {outcome:?}");
        };
        presets
            .iter()
            .map(|entry| match entry {
                PresetEntryDto::Usable { name, .. } | PresetEntryDto::Unusable { name, .. } => {
                    name.as_str()
                }
            })
            .collect()
    }

    #[test]
    fn a_first_run_lists_nothing_and_creates_nothing() {
        let root = Root::new();
        assert_eq!(
            root.store().list(),
            PresetListDto::Listed {
                presets: Vec::new()
            }
        );
        assert!(root.entries().is_empty());
    }

    #[test]
    fn a_saved_preset_is_listed_with_its_intent_and_leaves_no_temporary() {
        let root = Root::new();
        let store = root.store();
        assert_eq!(names(&store.save(&save("  Fast  ", intent(0)))), ["Fast"]);
        assert_eq!(
            serde_json::to_value(store.list()).expect("serializes"),
            json!({
                "outcome": "listed",
                "presets": [{ "state": "usable", "name": "Fast", "intent": intent(0) }]
            })
        );
        assert_eq!(root.entries(), [FILE_NAME]);
        // A second store over the same directory -- a restart -- reads the same.
        assert_eq!(PresetStore::over(Ok(root.0.clone())).list(), store.list());
    }

    #[test]
    fn a_save_refuses_a_bad_name_or_an_unexpressible_intent_without_writing() {
        let root = Root::new();
        let store = root.store();
        let too_long = "x".repeat(MAX_NAME_CHARS + 1);
        for bad in ["", "   ", "a\nb", too_long.as_str()] {
            assert_eq!(
                store.save(&save(bad, intent(0))),
                PresetWriteDto::Refused {
                    problem: "nameInvalid"
                }
            );
        }
        for bad in [
            json!("mzML+invented"),
            json!({ "format": "mzML" }),
            json!(null),
        ] {
            assert_eq!(
                store.save(&save("Fast", bad)),
                PresetWriteDto::Refused {
                    problem: "notExpressible"
                }
            );
        }
        assert!(root.entries().is_empty());
        // Positive control in the same directory.
        assert_eq!(
            names(&store.save(&save(&"x".repeat(MAX_NAME_CHARS), intent(0)))).len(),
            1
        );
    }

    #[test]
    fn a_taken_name_is_refused_ignoring_case_unless_replacement_is_confirmed() {
        let root = Root::new();
        let store = root.store();
        let _ = store.save(&save("Fast", intent(0)));
        let before = root.bytes();
        assert_eq!(
            store.save(&save("fast", intent(1))),
            PresetWriteDto::Refused {
                problem: "nameTaken"
            }
        );
        assert_eq!(root.bytes(), before);
        let replacing = PresetSaveRequest {
            replace_existing: true,
            ..save("fast", intent(1))
        };
        let PresetWriteDto::Committed { presets } = store.save(&replacing) else {
            panic!("the confirmed replacement commits");
        };
        assert_eq!(
            presets,
            [PresetEntryDto::Usable {
                name: "fast".to_owned(),
                intent: intent(1)
            }]
        );
    }

    #[test]
    fn rename_addresses_one_preset_and_never_takes_anothers_name() {
        let root = Root::new();
        let store = root.store();
        let _ = store.save(&save("A", intent(0)));
        let _ = store.save(&save("B", intent(1)));
        assert_eq!(
            store.rename(&rename("C", "D")),
            PresetWriteDto::Refused {
                problem: "unknownPreset"
            }
        );
        assert_eq!(
            store.rename(&rename("A", "b")),
            PresetWriteDto::Refused {
                problem: "nameTaken"
            }
        );
        assert_eq!(
            store.rename(&rename("A", "\t")),
            PresetWriteDto::Refused {
                problem: "nameInvalid"
            }
        );
        // A change of case is a rename of itself, not a collision.
        assert_eq!(names(&store.rename(&rename("A", "a"))), ["a", "B"]);
        assert_eq!(names(&store.rename(&rename("a", " Z "))), ["Z", "B"]);
    }

    #[test]
    fn delete_removes_exactly_the_named_preset() {
        let root = Root::new();
        let store = root.store();
        let _ = store.save(&save("A", intent(0)));
        let _ = store.save(&save("B", intent(1)));
        assert_eq!(
            store.delete(&delete("a")),
            PresetWriteDto::Refused {
                problem: "unknownPreset"
            }
        );
        assert_eq!(names(&store.delete(&delete("A"))), ["B"]);
        assert_eq!(names(&store.delete(&delete("B"))), Vec::<&str>::new());
    }

    #[test]
    fn an_unexpressible_preset_is_listed_unusable_and_kept_through_other_writes() {
        let root = Root::new();
        let kept = json!({ "chain": [{ "step": "peakPicking", "msLevels": [1, 2] }], "z": 1.5 });
        root.put(
            &serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "presets": [{ "name": "Old", "intent": kept }]
            }))
            .expect("serializes"),
        );
        let store = root.store();
        assert_eq!(
            store.list(),
            PresetListDto::Listed {
                presets: vec![PresetEntryDto::Unusable {
                    name: "Old".to_owned(),
                    problem: "notExpressible"
                }]
            }
        );
        let _ = store.save(&save("New", intent(0)));
        let _ = store.rename(&rename("Old", "Older"));
        let stored: Value = serde_json::from_slice(&root.bytes()).expect("parses");
        assert_eq!(
            stored["presets"][0],
            json!({ "name": "Older", "intent": kept })
        );
        assert_eq!(names(&store.delete(&delete("Older"))), ["New"]);
    }

    #[test]
    fn an_unusable_document_is_reported_left_alone_and_replaced_only_on_confirmation() {
        let oversized = vec![b' '; usize::try_from(MAX_DOCUMENT_BYTES).expect("fits") + 1];
        let cases: [(&[u8], &str); 4] = [
            (b"{ not json", "malformed"),
            (br#"{"schemaVersion":2,"presets":[],"future":true}"#, "unsupportedVersion"),
            (
                br#"{"schemaVersion":1,"presets":[{"name":"A","intent":"x"},{"name":"a","intent":"y"}]}"#,
                "malformed",
            ),
            (&oversized, "oversized"),
        ];
        for (bytes, problem) in cases {
            let root = Root::new();
            root.put(bytes);
            let store = root.store();
            assert_eq!(store.list(), PresetListDto::Unusable { problem });
            let refused = PresetWriteDto::StoredRecordUnusable { problem };
            assert_eq!(store.save(&save("A", intent(0))), refused);
            assert_eq!(store.rename(&rename("A", "B")), refused);
            assert_eq!(store.delete(&delete("A")), refused);
            assert_eq!(root.bytes(), bytes, "{problem}: the bytes are untouched");
            let confirmed = PresetSaveRequest {
                replace_unusable: true,
                ..save("A", intent(0))
            };
            assert_eq!(names(&store.save(&confirmed)), ["A"]);
        }
    }

    #[test]
    fn the_preset_count_is_bounded() {
        let root = Root::new();
        let presets: Vec<Value> = (0..MAX_PRESETS)
            .map(|index| json!({ "name": format!("P{index}"), "intent": intent(0) }))
            .collect();
        root.put(
            &serde_json::to_vec(&json!({ "schemaVersion": 1, "presets": presets }))
                .expect("serializes"),
        );
        let store = root.store();
        assert_eq!(
            store.save(&save("One more", intent(0))),
            PresetWriteDto::Refused {
                problem: "tooManyPresets"
            }
        );
        // Replacing one that exists is not one more.
        let replacing = PresetSaveRequest {
            replace_existing: true,
            ..save("P0", intent(1))
        };
        assert_eq!(names(&store.save(&replacing)).len(), MAX_PRESETS);
    }

    #[test]
    fn a_store_with_nowhere_to_write_says_so_and_claims_nothing() {
        let store = PresetStore::over(Err("rootUnresolved"));
        assert_eq!(
            store.list(),
            PresetListDto::Unavailable {
                problem: "rootUnresolved"
            }
        );
        assert_eq!(
            store.save(&save("A", intent(0))),
            PresetWriteDto::Unavailable {
                problem: "rootUnresolved"
            }
        );
    }

    #[test]
    fn the_requests_refuse_fields_this_boundary_does_not_own() {
        assert!(
            serde_json::from_value::<PresetSaveRequest>(
                json!({ "name": "A", "intent": "x", "path": "C:/x" })
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<PresetDeleteRequest>(json!({ "name": "A", "file": "x" }))
                .is_err()
        );
        let defaults: PresetSaveRequest =
            serde_json::from_value(json!({ "name": "A", "intent": "x" })).expect("parses");
        assert!(!defaults.replace_existing && !defaults.replace_unusable);
    }
}
