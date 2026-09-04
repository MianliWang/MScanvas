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

mod adoption;
pub mod backend;
mod chromatogram;
mod conversion;
mod destination;
/// Redacted, bounded diagnostics for the attempts a terminal queue could not
/// complete, and the one explicit local export that writes them out.
///
/// Private to this module. The webview learns that an export is available, how
/// many items it would describe, and what one wrote; it never receives the
/// document, an excerpt, or the folder it was saved in. See ADR 0017.
mod diagnostics;
pub mod dialog;
/// Bounded, private discovery of mzML candidates under a chosen folder.
///
/// Private to this module and reached only by the folder-import service: the
/// webview asks for a picker, Rust chooses the root, and what comes back is a
/// roster. No path crosses the boundary in either direction. See ADR 0007.
mod discovery;
mod drop_ingestion;
pub mod dto;
/// The session's one selected-spectrum export: the retained complete spectrum,
/// the figure specification built from it, and the CSV/TSV document beside it.
///
/// Private to this module. The webview learns that an export is possible and
/// what one wrote; it never receives the spectrum's complete arrays, a path, or
/// the folder a file was saved in. See ADR 0029.
/// One synthetic selected spectrum for the rendered tests, compiled in only
/// under the non-default `e2e` feature. Not a command, and not reachable from
/// the webview in any build. See the module for what it deliberately is not.
#[cfg(feature = "e2e")]
mod e2e_seed;
mod export;
/// Figure output settings, and the rasterizer that turns one exported SVG into
/// pixels for PNG and the clipboard.
mod figure;
mod installation;
/// Which conversion semantics may be chosen, projected from
/// `ConversionIntent::ADMITTED` and gated on what the installed executable
/// declares.
///
/// Private to this module. The webview receives bounded product semantics --
/// never provider argv, never help text and never the evidence identifiers the
/// crate records. See ADR 0043 M6.4.
mod intent_catalog;
mod operation;
/// What a spectrum viewport may know about a retained spectrum: whether it has
/// an m/z domain at all, and what one committed window of it looks like drawn.
///
/// Private to this module. The webview receives a bounded screen projection of
/// the complete spectrum Rust retained -- never the complete arrays, never a
/// path -- and no scientific export is ever taken from one. See ADR 0037.
mod projection;
pub mod selection;
pub mod service;

#[cfg(test)]
mod tests;

pub use backend::ProteoWizardProvider;
pub(crate) use drop_ingestion::normalize_window_drop_event;
pub use service::PreviewService;

/// Installs the rendered tests' synthetic spectrum. See `e2e_seed`.
#[cfg(feature = "e2e")]
pub fn seed_spectrum_for_e2e(service: &PreviewService) {
    e2e_seed::install(service);
}
