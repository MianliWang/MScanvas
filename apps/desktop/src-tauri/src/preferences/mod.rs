//! The narrow UI preference store: one small record, owned by Rust.
//!
//! ## What this boundary is
//!
//! Three operations over one closed record. The webview sends a typed payload
//! naming which half of the record it is committing, and receives the committed
//! snapshot back. It never sends a path, a file name, a key, a prefix, a JSON
//! document or a store operation, and there is no operation here that takes one
//! -- the location is decided in [`storage`] and the contents are decided by the
//! types in [`record`].
//!
//! ## What it deliberately is not
//!
//! Not a settings framework, not a key-value store, not a session snapshot and
//! not a place to put anything scientific. It confers no authority: a record
//! read from here cannot open a file, bind a backend, name a destination or
//! restore an operation, because none of those things is representable in it.
//!
//! It also holds no lane anything else needs. This store's mutex is its own and
//! is never taken while the conversion, process or roster locks are held, so a
//! slow profile volume can delay a preference save and nothing else.
//!
//! ## Ordering
//!
//! Every write is serialized here and every accepted publish takes the next
//! revision. A caller that captured a revision can therefore tell an answer
//! about its own save from an answer about a later one, which is what stops a
//! slow completion marking the wrong snapshot saved or reviving a choice the
//! user has already changed.

pub mod dto;
/// The QA-only preference root, compiled in solely under the non-default `e2e`
/// feature. It binds the same production storage implementation to a
/// task-owned directory; it is not a second persistence provider, and an
/// unbound or unusable root refuses rather than falling back to the real
/// profile.
#[cfg(feature = "e2e")]
mod qa_root;
pub mod record;
pub mod storage;

#[cfg(test)]
mod tests;

use std::sync::Mutex;

use dto::{UiPreferenceReadDto, UiPreferenceSaveDto, UiPreferenceWriteDto};
use record::{UiPreferences, read_record, write_record};
use storage::{PreferenceRoot, StoredRecord};

/// Where this session's preferences live, or why they have nowhere to live.
///
/// A store with no root is a first-class state rather than an error to throw:
/// the interface stays completely usable on defaults and says plainly that it
/// cannot remember them. Never being able to save is not the same as not being
/// allowed to work.
#[derive(Debug, Clone)]
enum RootBinding {
    Bound(PreferenceRoot),
    /// No usable root. The reason is an owned code, not a path or an OS message.
    Unavailable(&'static str),
}

/// The serialized state one store owns.
struct Lane {
    /// Monotonic, and only ever advanced by an accepted publish.
    ///
    /// Not a version of the record and not written to disk: it orders the
    /// answers this process gave, which is exactly the question a late reply
    /// raises. A restart starts from zero because a restart has given none.
    revision: u64,
}

/// The session's one UI preference store.
pub struct UiPreferenceStore {
    binding: RootBinding,
    lane: Mutex<Lane>,
}

impl UiPreferenceStore {
    /// Binds the per-user application-local directory Tauri resolves.
    ///
    /// Under the non-default `e2e` feature this binds the task-owned QA root
    /// instead, and refuses outright when that root is missing or unusable. A
    /// QA campaign that cannot isolate itself must not quietly write into the
    /// real profile.
    #[must_use]
    pub fn bind(app: &tauri::AppHandle) -> Self {
        #[cfg(feature = "e2e")]
        let binding = {
            // The QA build resolves nothing from the application: binding the
            // real profile is exactly what it exists to prevent.
            let _ = app;
            qa_root::bind_qa_root()
        };
        #[cfg(not(feature = "e2e"))]
        let binding = Self::bind_application_local(app);
        Self::over(binding)
    }

    /// One store over an already decided binding.
    fn over(binding: RootBinding) -> Self {
        Self {
            binding,
            lane: Mutex::new(Lane { revision: 0 }),
        }
    }

    /// A store over a directory the test owns, bypassing no production
    /// behaviour: the record, the validation, the publish and the read-back are
    /// the same ones a user's session runs.
    #[cfg(test)]
    pub(crate) fn for_root(directory: std::path::PathBuf) -> Self {
        Self::over(RootBinding::Bound(PreferenceRoot::new(directory)))
    }

    /// A store with nowhere to write, for the tests that cover that state.
    #[cfg(test)]
    pub(crate) fn unavailable() -> Self {
        Self::over(RootBinding::Unavailable("rootUnresolved"))
    }

    /// The production path policy: the per-user application-local data
    /// directory, resolved by Tauri, and never anywhere else.
    #[cfg(not(feature = "e2e"))]
    fn bind_application_local(app: &tauri::AppHandle) -> RootBinding {
        use tauri::Manager as _;
        match app.path().app_local_data_dir() {
            Ok(directory) => RootBinding::Bound(PreferenceRoot::new(directory)),
            // The resolver decides this, not this application, so there is
            // nothing here to retry or to point somewhere else.
            Err(_) => RootBinding::Unavailable("rootUnresolved"),
        }
    }

    /// Reads the stored record for a starting document.
    ///
    /// Answers what is there, or why what is there cannot be used, and never
    /// writes: a first run does not get a file, and an unusable record is left
    /// exactly as found until a user confirms replacing it.
    #[must_use]
    pub fn load(&self) -> UiPreferenceReadDto {
        let lane = self.locked();
        let revision = lane.revision;
        let root = match &self.binding {
            RootBinding::Bound(root) => root,
            RootBinding::Unavailable(problem) => {
                return UiPreferenceReadDto::Unavailable { problem, revision };
            }
        };
        match storage::read(root) {
            StoredRecord::Absent => UiPreferenceReadDto::Absent { revision },
            StoredRecord::Usable(preferences) => UiPreferenceReadDto::Loaded {
                preferences,
                revision,
            },
            StoredRecord::Unusable(problem) => UiPreferenceReadDto::Unusable {
                problem: problem.stable_id(),
                revision,
            },
        }
    }

    /// Commits one half of the record, merged onto what is actually stored.
    ///
    /// The merge base is read from disk inside the same lock that publishes, so
    /// a layout commit and a Settings apply cannot overwrite each other's newer
    /// fields: each one only ever changes the group it names, and the other
    /// group comes from the record as it stands.
    ///
    /// An unusable stored record refuses unless the caller passes the explicit
    /// replacement confirmation, so nothing about ordinary use -- a startup
    /// read, a Cancel, a media-query event, an automatic layout adjustment --
    /// can silently overwrite a record this build does not understand.
    #[must_use]
    pub fn save(&self, request: &UiPreferenceWriteDto) -> UiPreferenceSaveDto {
        let mut lane = self.locked();
        let revision = lane.revision;
        if request.appearance.is_none() && request.layout.is_none() {
            return UiPreferenceSaveDto::Failed {
                problem: "nothingToSave",
                retryable: false,
                temporary_left_behind: false,
                revision,
            };
        }
        let root = match &self.binding {
            RootBinding::Bound(root) => root,
            RootBinding::Unavailable(problem) => {
                return UiPreferenceSaveDto::Unavailable { problem, revision };
            }
        };
        let mut merged = match storage::read(root) {
            StoredRecord::Usable(stored) => stored,
            StoredRecord::Absent => UiPreferences::default(),
            StoredRecord::Unusable(problem) => {
                if !request.replace_unusable {
                    return UiPreferenceSaveDto::StoredRecordUnusable {
                        problem: problem.stable_id(),
                        revision,
                    };
                }
                UiPreferences::default()
            }
        };
        if let Some(appearance) = request.appearance {
            merged.appearance = appearance;
        }
        if let Some(layout) = request.layout {
            merged.layout = layout;
        }
        // The exact snapshot about to be published, judged by this build's own
        // reader before it is written. A record that would not survive being
        // read back is not one to hand to a user as saved.
        if !round_trips(&merged) {
            return UiPreferenceSaveDto::Failed {
                problem: "invalidRecord",
                retryable: false,
                temporary_left_behind: false,
                revision,
            };
        }
        if let Err(failure) = storage::publish(root, &merged) {
            return UiPreferenceSaveDto::Failed {
                problem: failure.error.stable_id(),
                retryable: failure.error.retryable(),
                temporary_left_behind: failure.temporary_left_behind,
                revision,
            };
        }
        // Read back before anything is called saved. The publish reported
        // success, and what the interface promises the user is that this exact
        // record is what a restart will find -- so that is the thing to confirm
        // rather than infer.
        if storage::read(root) != StoredRecord::Usable(merged) {
            return UiPreferenceSaveDto::Failed {
                problem: "notConfirmed",
                retryable: true,
                temporary_left_behind: false,
                revision,
            };
        }
        lane.revision = revision.saturating_add(1);
        UiPreferenceSaveDto::Saved {
            preferences: merged,
            revision: lane.revision,
        }
    }

    /// The owned storage lane.
    ///
    /// Poisoning is recovered from rather than propagated. A panic in one save
    /// says nothing about the file, and turning that into an application that
    /// can no longer read its own preferences would be the larger fault.
    fn locked(&self) -> std::sync::MutexGuard<'_, Lane> {
        self.lane
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Whether this build's own reader accepts the record this build would write.
fn round_trips(record: &UiPreferences) -> bool {
    write_record(record).is_some_and(|bytes| read_record(&bytes).as_ref() == Ok(record))
}
