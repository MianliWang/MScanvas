//! ENV-004 copy diagnostics ([ADR 0063]): a plain-text environment summary
//! the user copies into a support request themselves.
//!
//! Built from what the session already holds. Nothing here launches a process,
//! probes ProteoWizard, writes a file or sends anything: the text goes back to
//! the caller and no further.
//!
//! There is no free-text field. For a code, what keeps a file name, a path, a
//! user name or an environment variable out is where it comes from: a stable
//! id the repository defines (a backend failure kind, a preference problem, a
//! boundary error kind), never text a person or a file supplied. The Windows
//! facts come from the registry, WebView2's from the runtime, and the
//! ProteoWizard release, build date and source revision from the installed
//! tool's own help text: those are held by their shapes alone, so loosening
//! one removes the only defence that value has. Every value must match its own
//! shape, or it is replaced whole by `<withheld>`. No shape admits a path
//! separator or a colon, so no profile redactor runs: it could never change an
//! admitted value. A value whose shape admits a word (a code, the
//! Windows version and edition, the application version) must also not hold
//! the account name as a whole token. A shape that admits no free word (the
//! language, a dotted number, the build date, hex) is not checked: the name
//! could only match it by chance, and withholding it would point at the name.
//! The account name is not matched as a substring: a user named `lab` would
//! lose `available`, and which lines were withheld would spell the name out. A
//! code-shaped name, such as a file stem without its extension, would pass
//! that second line, so a change that routes supplied text into a code field
//! breaks the first. The ProteoWizard folder is never
//! written: ADR 0005 keeps the installation path out of diagnostics, so only
//! the known root it sits under is named.
//!
//! [ADR 0063]: ../../../../docs/architecture/adr/0063-copy-diagnostics.md

use std::collections::VecDeque;
use std::ffi::OsString;
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::preferences::UiPreferenceStore;
use crate::preferences::dto::UiPreferenceReadDto;
use crate::preferences::record::UiLocale;
use crate::preview::service::PreviewService;

#[cfg(test)]
mod tests;

/// Changes when a heading or a key changes, so a reader can tell layouts apart.
pub(crate) const FORMAT_VERSION: u32 = 1;

/// The most error codes the ring keeps. Older ones are counted, not kept.
pub(crate) const RECENT_ERROR_CAPACITY: usize = 32;

const WITHHELD: &str = "<withheld>";
const UNKNOWN: &str = "unknown";
const NONE: &str = "none";

/// One code the native boundary produced, and when.
///
/// Consecutive repeats of one code are one entry with a first and a last
/// time, so a retry loop or a re-projected failure cannot push every other
/// code out of the ring.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecentError {
    pub(crate) code: String,
    /// Unix seconds.
    pub(crate) first: u64,
    /// Unix seconds.
    pub(crate) last: u64,
    /// Whether it came again after `first`, even within the same second.
    pub(crate) repeated: bool,
}

/// This session's recent boundary error codes, in memory only.
#[derive(Debug, Default)]
pub(crate) struct RecentErrors {
    entries: VecDeque<RecentError>,
    dropped: u64,
}

impl RecentErrors {
    const fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            dropped: 0,
        }
    }

    /// Keeps the code only. A summary or detail can name a file; a code
    /// cannot, and one that does not look like a code is not kept either.
    fn note(&mut self, code: &str, now: u64) {
        let code = if is_code(code) {
            code
        } else {
            "unrecognized_code"
        };
        if let Some(latest) = self.entries.back_mut()
            && latest.code == code
        {
            latest.last = now;
            latest.repeated = true;
            return;
        }
        if self.entries.len() == RECENT_ERROR_CAPACITY {
            self.entries.pop_front();
            self.dropped += 1;
        }
        self.entries.push_back(RecentError {
            code: code.to_owned(),
            first: now,
            last: now,
            repeated: false,
        });
    }

    fn snapshot(&self) -> (Vec<RecentError>, u64) {
        (self.entries.iter().cloned().collect(), self.dropped)
    }
}

static RECENT_ERRORS: Mutex<RecentErrors> = Mutex::new(RecentErrors::new());

/// Records one boundary error code. Called by `PreviewErrorDto::new`, which
/// every `PreviewErrorDto` is built through, so "produced" here means built. A
/// conversion that ran and failed is a report, and a refusal carried in an
/// `Ok` outcome is not a `PreviewErrorDto`: neither is recorded (ADR 0063,
/// decision 5).
pub(crate) fn note_error(code: &str) {
    RECENT_ERRORS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .note(code, unix_now());
}

fn recent_errors() -> (Vec<RecentError>, u64) {
    RECENT_ERRORS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .snapshot()
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// What the session knows about its ProteoWizard binding, as it already holds
/// it. Read from the last backend reading; nothing is probed to fill it.
#[derive(Debug, Clone, Default)]
pub(crate) struct Backend {
    /// Whether any reading has been taken this session.
    pub(crate) checked: bool,
    pub(crate) quarantined: bool,
    pub(crate) state: Option<String>,
    pub(crate) origin: Option<String>,
    pub(crate) release: Option<String>,
    pub(crate) build_date: Option<String>,
    pub(crate) source_revision: Option<String>,
    pub(crate) msconvert_sha256: Option<String>,
    /// The folder the usable reading names. Only the known root it sits under
    /// is written, never the folder.
    pub(crate) folder: Option<String>,
    pub(crate) failure: Option<String>,
}

/// Everything the summary states, collected before any of it is judged.
#[derive(Debug, Clone, Default)]
pub(crate) struct Facts {
    /// Unix seconds.
    pub(crate) created_at: u64,
    pub(crate) app_version: String,
    pub(crate) build_profile: String,
    pub(crate) build_commit: Option<String>,
    pub(crate) saved_ui_language: Option<String>,
    pub(crate) ui_preferences: String,
    pub(crate) ui_preferences_problem: Option<String>,
    pub(crate) windows_version: Option<String>,
    pub(crate) windows_build: Option<String>,
    pub(crate) windows_edition: Option<String>,
    pub(crate) webview2: Option<String>,
    pub(crate) backend: Backend,
    pub(crate) remembered_folder: bool,
    pub(crate) remembered_refused_at_startup: Option<String>,
    pub(crate) remembered_not_saved: Option<String>,
    pub(crate) recent_errors: Vec<RecentError>,
    pub(crate) dropped_errors: u64,
}

/// The roots a folder may be said to sit under. Each is named by a
/// placeholder; none is ever written out.
#[derive(Debug, Clone, Default)]
pub(crate) struct KnownRoots {
    pub(crate) program_files: Option<String>,
    pub(crate) program_files_x86: Option<String>,
    pub(crate) local_app_data: Option<String>,
    pub(crate) user_profile: Option<String>,
}

impl KnownRoots {
    /// `var` is `std::env::var_os` outside tests.
    fn of(var: impl Fn(&'static str) -> Option<OsString>) -> Self {
        let read = |name: &'static str| var(name).map(|value| value.to_string_lossy().into_owned());
        Self {
            program_files: read("ProgramFiles"),
            program_files_x86: read("ProgramFiles(x86)"),
            local_app_data: read("LOCALAPPDATA"),
            user_profile: read("USERPROFILE"),
        }
    }
}

/// The summary for this session. Reads; writes and sends nothing.
pub(crate) fn summary(service: &PreviewService, preferences: &UiPreferenceStore) -> String {
    summary_with(service, preferences, std::env::var_os)
}

/// [`summary`], with the environment lookup the account names and known roots
/// come from.
fn summary_with(
    service: &PreviewService,
    preferences: &UiPreferenceStore,
    var: impl Fn(&'static str) -> Option<OsString> + Copy,
) -> String {
    let (saved_ui_language, ui_preferences, ui_preferences_problem) = match preferences.load() {
        UiPreferenceReadDto::Absent { .. } => (None, "absent", None),
        UiPreferenceReadDto::Loaded { preferences, .. } => {
            let tag = match preferences.appearance.locale {
                UiLocale::En => "en",
                UiLocale::ZhCn => "zh-CN",
            };
            (Some(tag.to_owned()), "loaded", None)
        }
        UiPreferenceReadDto::Unusable { problem, .. } => (None, "unusable", Some(problem)),
        UiPreferenceReadDto::Unavailable { problem, .. } => (None, "unavailable", Some(problem)),
    };
    let remembered = service.remembered_folder();
    let (windows_version, windows_build, windows_edition) = windows_facts();
    let (recent_errors, dropped_errors) = recent_errors();
    let facts = Facts {
        created_at: unix_now(),
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .to_owned(),
        // Set by GitHub Actions for every CI and release build; absent from a
        // local one.
        build_commit: option_env!("GITHUB_SHA").map(str::to_owned),
        saved_ui_language,
        ui_preferences: ui_preferences.to_owned(),
        ui_preferences_problem: ui_preferences_problem.map(str::to_owned),
        windows_version,
        windows_build,
        windows_edition,
        webview2: tauri::webview_version().ok(),
        backend: service.backend_environment(),
        remembered_folder: remembered.stored,
        remembered_refused_at_startup: remembered.refused_at_startup.map(|failure| failure.kind),
        remembered_not_saved: remembered.not_remembered,
        recent_errors,
        dropped_errors,
    };
    render(&facts, &KnownRoots::of(var), &account_names(var))
}

/// The account name, from the variables that hold it. `var` is
/// `std::env::var_os` outside tests.
pub(crate) fn account_names(var: impl Fn(&'static str) -> Option<OsString>) -> Vec<String> {
    ["USERNAME", "USER"]
        .into_iter()
        .filter_map(var)
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .collect()
}

/// Whether `value` holds `account` as a whole token: the whole value, or a run
/// with the value's edge or `_`, `.`, `-`, `+` or a space on each side,
/// compared without ASCII case. Never as a substring (ADR 0063, decision 3).
fn names_account(value: &str, account: &str) -> bool {
    let value = value.as_bytes();
    let account = account.as_bytes();
    let bounds = |byte: Option<&u8>| {
        byte.is_none_or(|byte| matches!(byte, b'_' | b'.' | b'-' | b'+' | b' '))
    };
    !account.is_empty()
        && value
            .windows(account.len())
            .enumerate()
            .any(|(start, window)| {
                window.eq_ignore_ascii_case(account)
                    && bounds(start.checked_sub(1).and_then(|before| value.get(before)))
                    && bounds(value.get(start + account.len()))
            })
}

/// Windows version, build and edition, from the registry key `winver` reads.
/// `ProductName` is not read: it says "Windows 10" on Windows 11.
#[cfg(windows)]
fn windows_facts() -> (Option<String>, Option<String>, Option<String>) {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegGetValueW,
    };
    use windows::core::{PCWSTR, w};

    const KEY: PCWSTR = w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");

    fn text(value: PCWSTR) -> Option<String> {
        let mut buffer = [0_u16; 64];
        let mut bytes = u32::try_from(std::mem::size_of_val(&buffer)).ok()?;
        // SAFETY: the buffer and its byte length describe the same live
        // array, and the key and value names are NUL-terminated literals.
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
                value,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&raw mut bytes),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let units = usize::try_from(bytes).ok()? / 2;
        let text = buffer.get(..units)?;
        String::from_utf16(text.strip_suffix(&[0]).unwrap_or(text)).ok()
    }

    fn number(value: PCWSTR) -> Option<u32> {
        let mut data = 0_u32;
        let mut bytes = u32::try_from(std::mem::size_of::<u32>()).ok()?;
        // SAFETY: as above, for one `u32`.
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
                value,
                RRF_RT_REG_DWORD,
                None,
                Some((&raw mut data).cast()),
                Some(&raw mut bytes),
            )
        };
        (status == ERROR_SUCCESS).then_some(data)
    }

    let build = text(w!("CurrentBuildNumber")).map(|build| match number(w!("UBR")) {
        Some(revision) => format!("{build}.{revision}"),
        None => build,
    });
    (text(w!("DisplayVersion")), build, text(w!("EditionID")))
}

#[cfg(not(windows))]
fn windows_facts() -> (Option<String>, Option<String>, Option<String>) {
    (None, None, None)
}

/// Writes the summary. Pure: the same facts give the same text.
pub(crate) fn render(facts: &Facts, roots: &KnownRoots, accounts: &[String]) -> String {
    // For a shape that admits no free word: the account name could only match
    // it by chance, and withholding it then would point at the name.
    let patterned = |value: Option<&str>, shape: fn(&str) -> bool| -> String {
        match value {
            None => UNKNOWN.to_owned(),
            Some(value) if shape(value) => value.to_owned(),
            Some(_) => WITHHELD.to_owned(),
        }
    };
    // For a shape that admits a word.
    let shown = |value: Option<&str>, shape: fn(&str) -> bool| -> String {
        match value {
            Some(value) if accounts.iter().any(|account| names_account(value, account)) => {
                WITHHELD.to_owned()
            }
            value => patterned(value, shape),
        }
    };
    let code_or_none = |value: Option<&str>| match value {
        None => NONE.to_owned(),
        value => shown(value, is_code),
    };
    let yes_no = |value: bool| if value { "yes" } else { "no" };
    let backend = &facts.backend;
    let folder = backend
        .folder
        .as_deref()
        .map_or(UNKNOWN, |folder| folder_root(folder, roots));

    let held = facts.recent_errors.len().min(RECENT_ERROR_CAPACITY);
    let mut lines = vec![
        "MSCanvas diagnostics".to_owned(),
        format!("Format: {FORMAT_VERSION}"),
        format!("Created: {}", rfc3339(facts.created_at)),
        String::new(),
        "[Application]".to_owned(),
        format!(
            "Version: {}",
            shown(Some(&facts.app_version), is_app_version)
        ),
        format!(
            "Build profile: {}",
            shown(Some(&facts.build_profile), is_code)
        ),
        format!(
            "Build commit: {}",
            patterned(facts.build_commit.as_deref(), is_commit)
        ),
        format!(
            "Saved UI language: {}",
            match facts.saved_ui_language.as_deref() {
                // Nothing saved. A record that could not be read is `unknown`.
                None if facts.ui_preferences == "absent" => NONE.to_owned(),
                value => patterned(value, is_locale),
            }
        ),
        format!(
            "UI preferences: {}",
            shown(Some(&facts.ui_preferences), is_code)
        ),
        format!(
            "UI preferences problem: {}",
            code_or_none(facts.ui_preferences_problem.as_deref())
        ),
        String::new(),
        "[System]".to_owned(),
        format!(
            "Windows version: {}",
            shown(facts.windows_version.as_deref(), is_short_word)
        ),
        format!(
            "Windows build: {}",
            patterned(facts.windows_build.as_deref(), is_dotted_number)
        ),
        format!(
            "Windows edition: {}",
            shown(facts.windows_edition.as_deref(), is_word)
        ),
        format!(
            "WebView2 Runtime: {}",
            patterned(facts.webview2.as_deref(), is_dotted_number)
        ),
        String::new(),
        "[ProteoWizard]".to_owned(),
        format!("Checked this session: {}", yes_no(backend.checked)),
        format!("Quarantined: {}", yes_no(backend.quarantined)),
        format!("State: {}", shown(backend.state.as_deref(), is_code)),
        format!("Origin: {}", shown(backend.origin.as_deref(), is_code)),
        format!(
            "Release: {}",
            patterned(backend.release.as_deref(), is_dotted_number)
        ),
        format!(
            "Build date: {}",
            patterned(backend.build_date.as_deref(), is_build_date)
        ),
        format!(
            "Source revision: {}",
            patterned(backend.source_revision.as_deref(), is_revision)
        ),
        format!(
            "msconvert SHA-256: {}",
            patterned(backend.msconvert_sha256.as_deref(), is_sha256)
        ),
        format!("Folder: {folder}"),
        format!(
            "Failure: {}",
            if backend.checked {
                code_or_none(backend.failure.as_deref())
            } else {
                UNKNOWN.to_owned()
            }
        ),
        format!("Remembered folder: {}", yes_no(facts.remembered_folder)),
        format!(
            "Remembered folder refused at startup: {}",
            code_or_none(facts.remembered_refused_at_startup.as_deref())
        ),
        format!(
            "Remembered folder not saved: {}",
            code_or_none(facts.remembered_not_saved.as_deref())
        ),
        String::new(),
        // ponytail: the session holds no view cache yet (ADR 0060 slice 2
        // wires it); report the held cache's usage here then.
        "[View cache]".to_owned(),
        "Usage: not in this build".to_owned(),
        String::new(),
        "[Recent errors]".to_owned(),
        format!(
            "Held: {held} (at most {RECENT_ERROR_CAPACITY}; older dropped: {})",
            facts.dropped_errors
        ),
    ];
    lines.extend(facts.recent_errors.iter().take(held).map(|error| {
        let code = shown(Some(&error.code), is_code);
        if !error.repeated {
            format!("- {} {code}", rfc3339(error.first))
        } else {
            format!(
                "- {} {code} (repeated until {})",
                rfc3339(error.first),
                rfc3339(error.last)
            )
        }
    }));
    lines.push(String::new());
    lines.join("\n")
}

fn rfc3339(seconds: u64) -> String {
    crate::project::format_rfc3339(seconds)
}

/// Which known root the ProteoWizard folder sits under, as a placeholder, and
/// nothing below it: ADR 0005 keeps the installation path out of diagnostics.
fn folder_root(folder: &str, roots: &KnownRoots) -> &'static str {
    let folder = folder.strip_prefix(r"\\?\").unwrap_or(folder);
    // Most specific first: the local application data folder sits inside the
    // profile.
    [
        (roots.program_files.as_deref(), "<program-files>"),
        (roots.program_files_x86.as_deref(), "<program-files-x86>"),
        (roots.local_app_data.as_deref(), "<local-app-data>"),
        (roots.user_profile.as_deref(), "<user-profile>"),
    ]
    .into_iter()
    .find(|(root, _)| root.is_some_and(|root| is_under(folder, root)))
    .map_or("<other-folder>", |(_, label)| label)
}

fn components(path: &str) -> Vec<&str> {
    path.split(['\\', '/'])
        .filter(|part| !part.is_empty())
        .collect()
}

/// Whether `folder` is `root` or below it, by component and without case, as
/// Windows compares.
fn is_under(folder: &str, root: &str) -> bool {
    let folder = components(folder);
    let root = components(root);
    !root.is_empty()
        && folder.len() >= root.len()
        && root
            .iter()
            .zip(&folder)
            .all(|(root, part)| root.to_lowercase() == part.to_lowercase())
}

/// An owned code: `available`, `chosen`, `rootUnresolved`,
/// `preview_worker_unavailable`.
fn is_code(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.starts_with(|c: char| c.is_ascii_alphabetic())
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_app_version(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value.starts_with(|c: char| c.is_ascii_digit())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

fn is_dotted_number(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn is_word(value: &str) -> bool {
    (1..=32).contains(&value.len()) && value.chars().all(|c| c.is_ascii_alphanumeric())
}

/// `25H2`, `23H2`, `2009`.
fn is_short_word(value: &str) -> bool {
    value.len() <= 8 && is_word(value)
}

fn is_hex(value: &str, lengths: std::ops::RangeInclusive<usize>) -> bool {
    lengths.contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn is_commit(value: &str) -> bool {
    is_hex(value, 40..=40)
}

fn is_revision(value: &str) -> bool {
    is_hex(value, 6..=40)
}

fn is_sha256(value: &str) -> bool {
    is_hex(value, 64..=64)
}

fn is_locale(value: &str) -> bool {
    matches!(value, "en" | "zh-CN")
}

/// The compiler's `__DATE__`, which ProteoWizard prints: `Jan 13 2026`.
fn is_build_date(value: &str) -> bool {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let parts: Vec<&str> = value.split(' ').filter(|part| !part.is_empty()).collect();
    value.len() <= 12
        && matches!(parts.as_slice(), [month, day, year]
            if MONTHS.contains(month)
                && (1..=2).contains(&day.len())
                && day.chars().all(|c| c.is_ascii_digit())
                && year.len() == 4
                && year.chars().all(|c| c.is_ascii_digit()))
}
