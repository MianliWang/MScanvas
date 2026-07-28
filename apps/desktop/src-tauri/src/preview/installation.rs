//! Which ProteoWizard actually resolved, as opposed to which one was asked for.
//!
//! Nothing here is serialisable, and nothing here may reach the webview. An
//! installation identity is made of absolute paths and filesystem identities,
//! which is exactly what this boundary exists to keep in Rust.

use std::fmt;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use mscanvas_proteowizard::{DiscoveryFailure, DiscoveryResult};

use super::selection::file_identity;

/// One resolved tool, identified well enough to notice it being replaced.
///
/// The path alone is not an identity: an installer that upgrades in place
/// leaves the path exactly as it was. The filesystem identity alone is not one
/// either, because writing over a file can keep it. Together with the length
/// and the modification time they cover replacement, upgrade in place, and a
/// different installation resolving under the same name.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ToolIdentity {
    path: PathBuf,
    /// `None` when the path is not an acceptable regular file, which a
    /// comparison reads as a change rather than as a match.
    filesystem: Option<(u64, u64)>,
    byte_length: Option<u64>,
    modified: Option<SystemTime>,
}

impl ToolIdentity {
    fn of(path: &Path) -> Self {
        let metadata = std::fs::symlink_metadata(path).ok();
        Self {
            path: path.to_path_buf(),
            filesystem: file_identity(path),
            byte_length: metadata.as_ref().map(std::fs::Metadata::len),
            modified: metadata.and_then(|metadata| metadata.modified().ok()),
        }
    }
}

impl fmt::Debug for ToolIdentity {
    /// Deliberately opaque. This type exists to be compared, never to be
    /// reported, and a `Debug` that printed the path would put one into any
    /// log or panic message that touched it.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-installation-tool>")
    }
}

/// The pair of tools one resolution of the backend produced, and what they
/// reported about themselves.
///
/// Compared, never displayed. Two of these being equal is the whole claim that
/// a spectrum and the table it is reconciled against came from one backend.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct InstallationIdentity {
    msconvert: ToolIdentity,
    msaccess: ToolIdentity,
    /// What the binaries said about themselves, normalised by the crate. It
    /// corroborates the filesystem facts rather than replacing them: a build
    /// can be replaced without the version changing, and a version can differ
    /// between two copies of the same files.
    release: Option<String>,
    build_date: Option<String>,
}

impl InstallationIdentity {
    /// Reads the identity out of one discovery result.
    ///
    /// `None` when discovery resolved no tool pair at all, which is not an
    /// identity and must not compare equal to one.
    pub(crate) fn of(discovery: &DiscoveryResult) -> Option<Self> {
        let msconvert = discovery.msconvert.path.as_deref()?;
        let msaccess = discovery.msaccess.path.as_deref()?;
        Some(Self {
            msconvert: ToolIdentity::of(msconvert),
            msaccess: ToolIdentity::of(msaccess),
            release: discovery.release.clone(),
            build_date: discovery.build_date.clone(),
        })
    }
}

#[cfg(test)]
impl InstallationIdentity {
    /// Builds one directly, for tests that model a backend rather than
    /// discovering a real one.
    ///
    /// The paths need not exist: a path with no file behind it yields a tool
    /// with no filesystem facts, which is exactly how a vanished executable
    /// compares, and two different paths still differ.
    pub(crate) fn for_test(msconvert: &Path, msaccess: &Path, release: &str) -> Self {
        Self {
            msconvert: ToolIdentity::of(msconvert),
            msaccess: ToolIdentity::of(msaccess),
            release: Some(release.to_owned()),
            build_date: None,
        }
    }
}

impl fmt::Debug for InstallationIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-installation>")
    }
}

/// Why a folder the user chose cannot be used, in terms this application can
/// act on.
///
/// The crate reports "the configured ProteoWizard location is not usable" and
/// attaches a reason next to a `PathBuf`. Forwarding that reason would risk
/// putting a path in front of the webview, and the crate's own advice names
/// recoveries this application does not have. So the cause is established here
/// instead, from typed discovery failures where they say enough and from the
/// folder itself where they do not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChosenFolderProblem {
    Missing,
    NotADirectory,
    Unreadable,
    MissingMsconvert,
    MissingMsaccess,
    MissingBothTools,
    ProbeFailed,
    IncompatibleToolPair,
}

impl ChosenFolderProblem {
    /// A stable identifier, in the same shape as the crate's failure kinds.
    pub(crate) const fn kind(self) -> &'static str {
        match self {
            Self::Missing => "chosen_folder_missing",
            Self::NotADirectory => "chosen_folder_not_a_directory",
            Self::Unreadable => "chosen_folder_unreadable",
            Self::MissingMsconvert => "chosen_folder_missing_msconvert",
            Self::MissingMsaccess => "chosen_folder_missing_msaccess",
            Self::MissingBothTools => "chosen_folder_missing_both_tools",
            Self::ProbeFailed => "chosen_folder_probe_failed",
            Self::IncompatibleToolPair => "chosen_folder_incompatible_tools",
        }
    }

    /// What to tell the user. No path, no OS error text, no backend prose.
    pub(crate) const fn summary(self) -> &'static str {
        match self {
            Self::Missing => "That folder no longer exists.",
            Self::NotADirectory => "That choice is not a folder.",
            Self::Unreadable => "That folder could not be read.",
            Self::MissingMsconvert => {
                "That folder holds msaccess.exe but not msconvert.exe, so it is only half of a \
                 ProteoWizard installation."
            }
            Self::MissingMsaccess => {
                "That folder holds msconvert.exe but not msaccess.exe, and msaccess is the tool \
                 MSCanvas reads files with."
            }
            Self::MissingBothTools => {
                "That folder holds neither msconvert.exe nor msaccess.exe, so it is not a \
                 ProteoWizard installation."
            }
            Self::ProbeFailed => {
                "The ProteoWizard in that folder could not be started, or did not answer as this \
                 version expects."
            }
            Self::IncompatibleToolPair => {
                "The two tools in that folder come from different ProteoWizard installations."
            }
        }
    }
}

/// The names the crate looks for. Kept here so the classification asks the same
/// question discovery did rather than a similar one.
const MSCONVERT_EXE: &str = "msconvert.exe";
const MSACCESS_EXE: &str = "msaccess.exe";

/// Works out why a chosen folder did not produce a usable backend.
///
/// Typed discovery failures are believed where they are specific enough. Where
/// the crate only says "not usable", the folder itself is asked — which is
/// sound because this code holds the path and the answer never carries it.
pub(crate) fn classify_chosen_folder(
    home: &Path,
    failure: Option<&DiscoveryFailure>,
) -> ChosenFolderProblem {
    if let Some(failure) = failure {
        match failure.kind() {
            "msconvert_missing" => return ChosenFolderProblem::MissingMsconvert,
            "msaccess_missing" => return ChosenFolderProblem::MissingMsaccess,
            "tools_from_different_installations" => {
                return ChosenFolderProblem::IncompatibleToolPair;
            }
            _ => {}
        }
    }

    let Ok(metadata) = std::fs::symlink_metadata(home) else {
        return ChosenFolderProblem::Missing;
    };
    if !metadata.is_dir() {
        return ChosenFolderProblem::NotADirectory;
    }
    if std::fs::read_dir(home).is_err() {
        return ChosenFolderProblem::Unreadable;
    }

    let msconvert = home.join(MSCONVERT_EXE).is_file();
    let msaccess = home.join(MSACCESS_EXE).is_file();
    match (msconvert, msaccess) {
        (false, false) => ChosenFolderProblem::MissingBothTools,
        (false, true) => ChosenFolderProblem::MissingMsconvert,
        (true, false) => ChosenFolderProblem::MissingMsaccess,
        // Both are there and discovery still refused, so the objection is to
        // what they are rather than to whether they exist.
        (true, true) => ChosenFolderProblem::ProbeFailed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "mscanvas-installation-{label}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("temporary directory");
            Self { path }
        }

        fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.path.join(name);
            std::fs::write(&path, contents).expect("file");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn a_folder_that_is_not_there_is_distinguished_from_one_that_is_empty() {
        let tree = TempDir::new("missing-vs-empty");
        let absent = tree.path.join("no-such-folder");

        assert_eq!(
            classify_chosen_folder(&absent, None),
            ChosenFolderProblem::Missing
        );
        assert_eq!(
            classify_chosen_folder(&tree.path, None),
            ChosenFolderProblem::MissingBothTools
        );
    }

    #[test]
    fn a_file_chosen_as_a_folder_says_so() {
        let tree = TempDir::new("not-a-directory");
        let file = tree.file("not-a-folder.txt", b"x");

        assert_eq!(
            classify_chosen_folder(&file, None),
            ChosenFolderProblem::NotADirectory
        );
    }

    #[test]
    fn half_an_installation_names_the_half_that_is_missing() {
        let only_msconvert = TempDir::new("only-msconvert");
        only_msconvert.file(MSCONVERT_EXE, b"x");
        let only_msaccess = TempDir::new("only-msaccess");
        only_msaccess.file(MSACCESS_EXE, b"x");

        assert_eq!(
            classify_chosen_folder(&only_msconvert.path, None),
            ChosenFolderProblem::MissingMsaccess
        );
        assert_eq!(
            classify_chosen_folder(&only_msaccess.path, None),
            ChosenFolderProblem::MissingMsconvert
        );
    }

    #[test]
    fn a_complete_pair_that_discovery_still_refused_is_a_probe_failure() {
        // Both tools are present, so the objection is to what they are rather
        // than to whether they exist -- which is the one case the folder alone
        // cannot explain and the crate's kind does not narrow.
        let tree = TempDir::new("complete-pair");
        tree.file(MSCONVERT_EXE, b"x");
        tree.file(MSACCESS_EXE, b"x");

        assert_eq!(
            classify_chosen_folder(&tree.path, None),
            ChosenFolderProblem::ProbeFailed
        );
    }

    #[test]
    fn no_reported_reason_carries_a_path_or_an_operating_system_message() {
        let tree = TempDir::new("path-free");
        let cases = [
            ChosenFolderProblem::Missing,
            ChosenFolderProblem::NotADirectory,
            ChosenFolderProblem::Unreadable,
            ChosenFolderProblem::MissingMsconvert,
            ChosenFolderProblem::MissingMsaccess,
            ChosenFolderProblem::MissingBothTools,
            ChosenFolderProblem::ProbeFailed,
            ChosenFolderProblem::IncompatibleToolPair,
        ];
        let secret = tree.path.to_string_lossy().to_string();
        for problem in cases {
            let summary = problem.summary();
            assert!(!summary.contains(&secret), "{summary}");
            assert!(!summary.contains(":\\"), "{summary}");
            assert!(!summary.contains('/'), "{summary}");
            assert!(!problem.kind().is_empty());
        }
    }

    #[test]
    fn an_identity_is_opaque_when_printed() {
        // It is built from paths and filesystem identities, so anything that
        // prints one -- a log line, a panic message, an assertion -- would
        // otherwise carry them out of Rust.
        let tree = TempDir::new("opaque");
        let tool = ToolIdentity::of(&tree.file(MSCONVERT_EXE, b"x"));

        assert_eq!(format!("{tool:?}"), "<opaque-installation-tool>");
    }

    #[test]
    fn replacing_a_tool_in_place_changes_its_identity() {
        // The path is unchanged, which is exactly what an in-place upgrade
        // looks like, so the path alone could not tell these apart.
        let tree = TempDir::new("in-place");
        let path = tree.file(MSCONVERT_EXE, b"first build");
        let before = ToolIdentity::of(&path);

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, b"a different build entirely").expect("rewrite");
        let after = ToolIdentity::of(&path);

        assert_ne!(before, after);
        // And re-reading the same unchanged file is not a change.
        assert_eq!(after, ToolIdentity::of(&path));
    }
}
