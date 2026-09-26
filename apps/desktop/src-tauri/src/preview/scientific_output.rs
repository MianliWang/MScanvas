//! Figure and data output for documents that are not preview snapshots.
//!
//! A stored project result is exported through exactly the machinery a
//! spectrum or a chromatogram is: the same settings and their refusals, the
//! same renderer, the same raster budget asked before any pixel is allocated,
//! the same rasterizer and PNG encoder, the same extension rule and the same
//! no-overwrite local write. It has no clipboard copy: M9.2 could not exercise
//! one natively for a stored result, so none is offered. What differs is only
//! where the figure comes from, which is the caller's business -- this module
//! is handed a finished [`FigureSpec`] or finished bytes and never sees a
//! preview token, a snapshot or a lane.

use std::path::Path;

use mscanvas_plot_spec::spec::{FigureSize, FigureSpec, FigureTheme};
use mscanvas_proteowizard::write_new_local_file;

use super::destination::admit_destination_root;
use super::dialog::SaveDialogFacts;
use super::dto::{
    ExportedFigureDto, FigureSettingsDto, MAX_CANDIDATE_NAME_CHARS, PreviewErrorDto, bounded_text,
    spectrum_destination_unusable,
};
use super::export::png_of;
use super::figure::{FigureRenderSettings, PngDpi};
use super::service::{PreviewService, spectrum_write_failure};

/// The resolution a PNG records, once it has been accepted.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PngResolution(PngDpi);

/// Figure settings read from the wire, with the contract's refusals.
#[derive(Debug, Clone, Copy)]
pub(crate) struct FigureOutput(FigureRenderSettings);

impl FigureOutput {
    /// Reads the size and theme, refusing what no figure can be.
    ///
    /// # Errors
    ///
    /// `figure_settings_refused`, with the context naming the limit.
    pub(crate) fn from_wire(settings: &FigureSettingsDto) -> Result<Self, PreviewErrorDto> {
        PreviewService::render_settings(settings).map(Self)
    }

    pub(crate) fn size(self) -> FigureSize {
        self.0.size()
    }

    pub(crate) fn theme(self) -> FigureTheme {
        self.0.theme()
    }

    pub(crate) fn width(self) -> u32 {
        self.0.width()
    }

    pub(crate) fn height(self) -> u32 {
        self.0.height()
    }

    /// Whether a PNG of this figure can be made, before anything is asked of
    /// the user: the resolution PNG records, and room for its pixels.
    ///
    /// # Errors
    ///
    /// `figure_settings_refused`.
    pub(crate) fn png_resolution(
        self,
        settings: &FigureSettingsDto,
    ) -> Result<PngResolution, PreviewErrorDto> {
        let dpi = PreviewService::png_dpi(settings)?;
        PreviewService::raster_budget(self.0)?;
        Ok(PngResolution(dpi))
    }

    /// The PNG a user receives.
    ///
    /// # Errors
    ///
    /// `figure_settings_refused` over the raster budget, asked here again so
    /// no path reaches the rasterizer without it, and the raster failures.
    pub(crate) fn png(
        self,
        figure: &FigureSpec,
        resolution: PngResolution,
    ) -> Result<Vec<u8>, PreviewErrorDto> {
        PreviewService::raster_budget(self.0)?;
        png_of(figure, self.0, resolution.0).map_err(PreviewService::figure_failure)
    }

    /// What the interface is told an exported figure was rendered as.
    pub(crate) fn exported(self, resolution: Option<PngResolution>) -> ExportedFigureDto {
        ExportedFigureDto {
            width: self.0.width(),
            height: self.0.height(),
            dpi: resolution.map(|resolution| resolution.0.get()),
            theme: PreviewService::theme_name(self.0),
        }
    }
}

/// Writes one document the user chose a destination for, never over anything.
///
/// Answers the name the file was given and nothing about where it went.
///
/// # Errors
///
/// `spectrum_destination_misnamed` for a name that is not the document's own
/// kind, `spectrum_destination_unusable`, and the write refusals every export
/// here answers with -- `spectrum_destination_exists` among them.
pub(crate) fn write_named(
    destination: &Path,
    facts: SaveDialogFacts,
    bytes: &[u8],
) -> Result<String, PreviewErrorDto> {
    PreviewService::require_named_document(destination, facts)?;
    let (parent, file_name) = match (destination.parent(), destination.file_name()) {
        (Some(parent), Some(file_name)) => (parent, file_name),
        _ => return Err(spectrum_destination_unusable()),
    };
    let (root, _identity, _held) =
        admit_destination_root(parent).map_err(|_| spectrum_destination_unusable())?;
    write_new_local_file(&root, file_name, bytes).map_err(spectrum_write_failure)?;
    Ok(bounded_text(
        &file_name.to_string_lossy(),
        MAX_CANDIDATE_NAME_CHARS,
    ))
}
