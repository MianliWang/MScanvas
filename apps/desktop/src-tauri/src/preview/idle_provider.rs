//! A provider that fails any test in which something starts a process.
//!
//! Shared rather than spelled once per test module. Two separate suites make
//! the same claim -- that curating the roster is free of the machine -- and the
//! claim is only as strong as the double behind it; two copies would be two
//! doubles to keep in step, and a weakened copy would silently weaken whichever
//! suite held it.

use std::path::{Path, PathBuf};

use mscanvas_proteowizard::PreviewOperation;

use super::backend::{OperationAttempt, PreviewProvider};
use super::dto::{BackendAvailabilityDto, PreviewErrorDto};
use super::installation::InstallationIdentity;

/// Fails the test outright if anything workspace-shaped tries to start a
/// process or probe an installation.
///
/// The whole roster is meant to be free of the machine: reading it, adding to
/// it, removing from it and emptying it are decisions about what the session
/// lists, and a user curating twenty rows must not be twenty ProteoWizard
/// launches. The same is true of admitting one through a project reference,
/// which is why the project bridge's tests hold this too.
pub(crate) struct NoProcess;

impl PreviewProvider for NoProcess {
    fn use_installation(&self, _home: Option<PathBuf>) {
        panic!("holding datasets must not reconfigure the backend");
    }

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        panic!("holding datasets must not probe the backend");
    }

    fn run(
        &self,
        _source: &Path,
        _operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        panic!("holding datasets must not launch a process");
    }
}
