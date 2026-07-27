//! The narrow mzML preview boundary owned by the desktop application.
//!
//! The webview can ask four things: is a backend installed, choose one file,
//! open its preview, and load one spectrum. It cannot ask for a command to be
//! run, cannot supply an executable path, and never receives raw process
//! output or an absolute filesystem path.

pub mod backend;
pub mod dialog;
pub mod dto;
pub mod selection;
pub mod service;

#[cfg(test)]
mod tests;

pub use backend::ProteoWizardProvider;
pub use service::PreviewService;
