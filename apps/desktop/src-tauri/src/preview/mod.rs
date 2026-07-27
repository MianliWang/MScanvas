//! The narrow mzML preview boundary owned by the desktop application.
//!
//! The webview can ask six things: is a backend installed, choose which
//! installation to use, go back to finding one automatically, choose one file,
//! open its preview, and load one spectrum. It cannot ask for a command to be
//! run, cannot supply an executable path, and never receives raw process
//! output or an absolute filesystem path -- choosing an installation is a
//! request to show a picker, not a path the webview names.

pub mod backend;
pub mod dialog;
pub mod dto;
pub mod selection;
pub mod service;

#[cfg(test)]
mod tests;

pub use backend::ProteoWizardProvider;
pub use service::PreviewService;
