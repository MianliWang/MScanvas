//! The typed payloads the webview sends and receives about UI preferences.
//!
//! Every outcome is an enumerated tag with owned codes. No absolute path, no
//! directory name, no OS message and no provider text crosses this boundary in
//! either direction: the renderer learns what happened and what is stored, and
//! nothing about where.

use serde::{Deserialize, Serialize};

use super::record::{AppearancePreferences, LayoutPreferences, UiPreferences};

/// What a starting document is told about the stored record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiPreferenceReadDto {
    /// Nothing is stored. An ordinary first run: the defaults apply and there
    /// is nothing to recover from.
    Absent { revision: u64 },
    /// A record this build accepts, whole.
    Loaded {
        preferences: UiPreferences,
        revision: u64,
    },
    /// Something is stored and this build will not use it. The bytes are
    /// untouched. The interface runs on defaults and offers an explicit
    /// replacement.
    Unusable {
        problem: &'static str,
        revision: u64,
    },
    /// There is nowhere to store preferences this session. The interface is
    /// fully usable on defaults and says so; it does not pretend to remember.
    Unavailable {
        problem: &'static str,
        revision: u64,
    },
}

/// What one commit did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiPreferenceSaveDto {
    /// Published, read back, and confirmed. `preferences` is that exact
    /// snapshot -- what a restart will find -- rather than what was requested.
    Saved {
        preferences: UiPreferences,
        revision: u64,
    },
    /// Refused because the stored record is not this build's and replacing it
    /// was not confirmed. Nothing was written.
    StoredRecordUnusable {
        problem: &'static str,
        revision: u64,
    },
    /// There is nowhere to write. Nothing was written and nothing is claimed.
    Unavailable {
        problem: &'static str,
        revision: u64,
    },
    /// The write did not complete. The last confirmed record, if there was
    /// one, is still what a restart will find.
    ///
    /// `temporaryLeftBehind` is reported separately because it is the only part
    /// of a failure a user may have to act on.
    Failed {
        problem: &'static str,
        retryable: bool,
        temporary_left_behind: bool,
        revision: u64,
    },
}

/// One commit request: which half of the record, and whether an unusable
/// stored record may be replaced.
///
/// Two optional groups rather than a whole record, because the two live in
/// different places in the interface and must not carry each other. Settings
/// commits appearance and never the shell's live panel state; a panel toggle
/// commits layout and never the Settings dialog's unapplied draft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPreferenceWriteDto {
    #[serde(default)]
    pub appearance: Option<AppearancePreferences>,
    #[serde(default)]
    pub layout: Option<LayoutPreferences>,
    /// The explicit reset-and-replace confirmation. False for every ordinary
    /// commit, so nothing routine can overwrite a record this build refused.
    #[serde(default)]
    pub replace_unusable: bool,
}
