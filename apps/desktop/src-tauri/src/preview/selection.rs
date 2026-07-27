//! Selection and validation of the one local mzML file a session works on.
//!
//! Rust owns the path. The webview receives an opaque handle and a display
//! name, never an absolute path, and the file itself is only ever read.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use mscanvas_proteowizard::is_reparse_point;

use super::dto::{PreviewErrorDto, SelectedFileDto};

/// The only open format this slice accepts. mzXML and vendor acquisitions are
/// deliberately out of scope.
const ACCEPTED_EXTENSION: &str = "mzML";

/// Validates a caller-supplied path and describes it without leaking it.
///
/// Extension and regular-file posture are checked here rather than in the
/// webview, so a frontend defect cannot widen what the backend will open.
pub fn accept_mzml_file(path: &Path) -> Result<AcceptedFile, PreviewErrorDto> {
    // The selected path is inspected before it is resolved. Canonicalizing
    // first would replace a link with its target, and the link test below
    // would then only ever see a regular file.
    let selected = std::fs::symlink_metadata(path).map_err(|_| unresolvable())?;
    if selected.file_type().is_symlink() || is_reparse_point(&selected) {
        return Err(not_a_regular_file());
    }

    let canonical = std::fs::canonicalize(path).map_err(|_| unresolvable())?;

    let extension_matches = canonical
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(ACCEPTED_EXTENSION));
    if !extension_matches {
        return Err(PreviewErrorDto::new(
            "unsupported_extension",
            "MSCanvas opens .mzML files in this version.",
            false,
        ));
    }

    // Repeated on the resolved target, so neither the name the user picked nor
    // what it resolves to can be anything but a regular file.
    let metadata = std::fs::symlink_metadata(&canonical).map_err(|_| {
        PreviewErrorDto::new(
            "file_not_inspectable",
            "That file could not be inspected.",
            true,
        )
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
        return Err(not_a_regular_file());
    }

    let file_name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| {
            PreviewErrorDto::new("file_has_no_name", "That path has no file name.", false)
        })?;

    Ok(AcceptedFile {
        path: canonical,
        file_name,
        byte_length: metadata.len(),
    })
}

fn unresolvable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "file_not_resolvable",
        "That file could not be opened. It may have been moved or renamed.",
        true,
    )
}

fn not_a_regular_file() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "not_a_regular_file",
        "That path is not a regular file.",
        false,
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedFile {
    path: PathBuf,
    file_name: String,
    byte_length: u64,
}

impl AcceptedFile {
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }
}

/// The one file a session currently has open, behind an opaque handle.
///
/// Exactly one, replaced on each selection. The product opens one file at a
/// time, so keeping every previously chosen path callable would leave the
/// webview holding a capability over files the user has moved on from, for the
/// lifetime of the process. Handles are session-scoped and meaningless outside
/// the running process, so a frontend value can never name a path the user did
/// not choose.
#[derive(Debug, Default)]
pub struct FileRegistry {
    next_handle: AtomicU64,
    current: Mutex<Option<(String, AcceptedFile)>>,
}

impl FileRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a newly accepted file and revokes the previous one.
    pub fn register(&self, file: AcceptedFile) -> SelectedFileDto {
        let handle = format!("file-{}", self.next_handle.fetch_add(1, Ordering::Relaxed));
        let dto = SelectedFileDto {
            handle: handle.clone(),
            file_name: file.file_name().to_owned(),
            byte_length: file.byte_length(),
        };
        *self
            .current
            .lock()
            .expect("the file registry lock is never poisoned by user code") = Some((handle, file));
        dto
    }

    pub fn resolve(&self, handle: &str) -> Result<AcceptedFile, PreviewErrorDto> {
        self.current
            .lock()
            .expect("the file registry lock is never poisoned by user code")
            .as_ref()
            .filter(|(current, _)| current == handle)
            .map(|(_, file)| file.clone())
            .ok_or_else(|| {
                PreviewErrorDto::new(
                    "unknown_file_handle",
                    "That file is no longer open. Open it again to continue.",
                    false,
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mscanvas-selection-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create selection test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn only_regular_mzml_files_are_accepted() {
        let directory = TestDirectory::new("accept");
        let accepted = directory.path().join("sample.mzML");
        fs::write(&accepted, b"<mzML/>").expect("write accepted fixture");
        let wrong_extension = directory.path().join("sample.mzXML");
        fs::write(&wrong_extension, b"<mzXML/>").expect("write rejected fixture");
        let directory_input = directory.path().join("acquisition.mzML");
        fs::create_dir(&directory_input).expect("create directory input");

        let file = accept_mzml_file(&accepted).expect("a regular mzML file is accepted");
        assert_eq!(file.file_name(), "sample.mzML");
        assert_eq!(file.byte_length(), 7);

        assert_eq!(
            accept_mzml_file(&wrong_extension).map(|_| ()),
            Err(PreviewErrorDto::new(
                "unsupported_extension",
                "MSCanvas opens .mzML files in this version.",
                false,
            ))
        );
        assert_eq!(
            accept_mzml_file(&directory_input).map(|_| ()),
            Err(PreviewErrorDto::new(
                "not_a_regular_file",
                "That path is not a regular file.",
                false,
            ))
        );
        assert_eq!(
            accept_mzml_file(&directory.path().join("absent.mzML")).map(|_| ()),
            Err(PreviewErrorDto::new(
                "file_not_resolvable",
                "That file could not be opened. It may have been moved or renamed.",
                true,
            ))
        );
    }

    #[test]
    fn a_case_insensitive_extension_is_still_mzml() {
        let directory = TestDirectory::new("case");
        let path = directory.path().join("SAMPLE.MZML");
        fs::write(&path, b"<mzML/>").expect("write fixture");

        assert!(accept_mzml_file(&path).is_ok());
    }

    /// Creating a symlink needs a privilege that an ordinary Windows session
    /// may not have, so this reports whether the link was actually created
    /// rather than failing the suite for an environment reason.
    #[cfg(windows)]
    fn try_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }

    #[cfg(not(windows))]
    fn try_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[test]
    fn a_link_to_a_regular_mzml_file_is_still_rejected() {
        let directory = TestDirectory::new("symlink");
        let target = directory.path().join("target.mzML");
        fs::write(&target, b"<mzML/>").expect("write link target");
        let link = directory.path().join("link.mzML");
        if !try_symlink(&target, &link) {
            // No symlink privilege here; the ordering this test guards is
            // still exercised by the reparse-point branch on Windows hosts
            // that do grant it.
            return;
        }

        assert_eq!(
            accept_mzml_file(&link).map(|_| ()),
            Err(PreviewErrorDto::new(
                "not_a_regular_file",
                "That path is not a regular file.",
                false,
            ))
        );
        // The target itself remains perfectly acceptable.
        assert!(accept_mzml_file(&target).is_ok());
    }

    #[test]
    fn handles_are_opaque_and_never_carry_the_path() {
        let directory = TestDirectory::new("registry");
        let path = directory.path().join("sample.mzML");
        fs::write(&path, b"<mzML/>").expect("write fixture");
        let registry = FileRegistry::new();

        let first = registry.register(accept_mzml_file(&path).expect("accepted"));

        assert_eq!(first.file_name, "sample.mzML");
        let rendered = serde_json::to_string(&first).expect("the handle serializes");
        assert!(!rendered.contains("mscanvas-selection-registry"));
        assert!(!rendered.contains(':') || !rendered.contains('\\'));

        assert_eq!(
            registry
                .resolve(&first.handle)
                .expect("a registered handle resolves")
                .file_name(),
            "sample.mzML"
        );
        assert_eq!(
            registry.resolve("file-does-not-exist").map(|_| ()),
            Err(PreviewErrorDto::new(
                "unknown_file_handle",
                "That file is no longer open. Open it again to continue.",
                false,
            ))
        );
    }

    #[test]
    fn opening_another_file_revokes_the_previous_handle() {
        let directory = TestDirectory::new("revoke");
        let first_path = directory.path().join("first.mzML");
        let second_path = directory.path().join("second.mzML");
        fs::write(&first_path, b"<mzML/>").expect("write first fixture");
        fs::write(&second_path, b"<mzML/>").expect("write second fixture");
        let registry = FileRegistry::new();

        let first = registry.register(accept_mzml_file(&first_path).expect("accepted"));
        let second = registry.register(accept_mzml_file(&second_path).expect("accepted"));

        assert_ne!(first.handle, second.handle);
        assert_eq!(
            registry
                .resolve(&second.handle)
                .expect("the current handle resolves")
                .file_name(),
            "second.mzML"
        );
        // The webview keeps no capability over a file the user has moved on
        // from, for the rest of the process lifetime or at all.
        assert_eq!(
            registry.resolve(&first.handle).map(|_| ()),
            Err(PreviewErrorDto::new(
                "unknown_file_handle",
                "That file is no longer open. Open it again to continue.",
                false,
            ))
        );
    }
}
