//! The task-owned preference root a rendered QA campaign binds.
//!
//! Compiled in only under the non-default `e2e` feature.
//!
//! ## Why this exists
//!
//! The preference faults M7.5 has to prove -- a corrupt record, a record from
//! another schema, a write the filesystem refuses -- are faults of a file in the
//! user's own profile. Proving them against the real profile would mean
//! corrupting, replacing, locking or deleting the operator's actual
//! configuration, which is not something a test gets to do.
//!
//! So the campaign binds a directory it owns instead. Everything below that
//! binding is the production implementation: the same record type, the same
//! validation, the same bounded temporary, the same handle-bound replace, the
//! same read-back. This is a different *root*, not a different *store*, and it
//! is deliberately not a fake persistence provider -- a test against a stub
//! would prove the stub.
//!
//! ## What it deliberately is not
//!
//! It is not a command, not a parameter and not a production environment
//! switch. There is nothing for a webview to call and nothing for a document to
//! pass: the root is read once, from the process environment, at startup, in a
//! build whose feature is off by default and never enabled for a release.
//!
//! And it never falls back. A binding that is missing, relative, or not an
//! existing directory leaves the store with no root at all, so every load and
//! every save answers `unavailable` and the real profile is not touched. An
//! isolation that silently stopped isolating would be worse than no isolation,
//! because the campaign would still report success.

use std::path::PathBuf;

use super::RootBinding;
use super::storage::PreferenceRoot;

/// The one variable this build reads.
///
/// Named for what it is so that it cannot be mistaken for a user-facing
/// setting, and read only here.
const QA_PREFERENCE_ROOT_VARIABLE: &str = "MSCANVAS_E2E_PREFERENCE_ROOT";

/// Binds the QA root, or refuses the campaign.
pub(super) fn bind_qa_root() -> RootBinding {
    let Some(value) = std::env::var_os(QA_PREFERENCE_ROOT_VARIABLE) else {
        return RootBinding::Unavailable("qaRootUnbound");
    };
    let directory = PathBuf::from(value);
    if directory.as_os_str().is_empty() || !directory.is_absolute() {
        return RootBinding::Unavailable("qaRootNotAbsolute");
    }
    // An existing directory, not one this build creates. The campaign owns the
    // root and says where it is; conjuring one from a typo is how a run ends up
    // isolated from the wrong thing.
    match std::fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.is_dir() => RootBinding::Bound(PreferenceRoot::new(directory)),
        _ => RootBinding::Unavailable("qaRootNotADirectory"),
    }
}
