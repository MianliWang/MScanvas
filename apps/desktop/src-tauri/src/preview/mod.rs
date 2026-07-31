//! The narrow mzML preview and workspace boundary owned by the desktop
//! application.
//!
//! The webview can ask about the backend -- is one installed, use the
//! installation in this folder, go back to finding one automatically -- about
//! the workspace: what does the session hold, show a picker and add what is
//! chosen, remove these rows, empty it; and about one dataset: open its
//! preview, load one spectrum. It cannot ask for a command to be run, cannot
//! supply an executable path or a file path, and never receives raw process
//! output or an absolute filesystem path -- choosing a file or an installation
//! is a request to show a picker, not a path the webview names.

pub mod backend;
pub mod dialog;
/// Bounded, private discovery of mzML candidates under a chosen folder.
///
/// Nothing outside the preview module can reach it, and nothing inside it is
/// wired to a command yet: the traversal boundary is settled and tested before
/// a folder action depends on it. See ADR 0007.
mod discovery;
pub mod dto;
mod installation;
pub mod selection;
pub mod service;

#[cfg(test)]
mod tests;

pub use backend::ProteoWizardProvider;
pub use service::PreviewService;
