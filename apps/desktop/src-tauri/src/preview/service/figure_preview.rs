//! A bounded export image. A dialog never owns the scientific operation lane.

use super::super::dto::{FigurePreviewOutcomeDto, FigurePreviewRequestDto, FigurePreviewSourceDto};
use super::*;

pub(in crate::preview) const MAX_FIGURE_PREVIEW_BYTES: usize = 8 * 1024 * 1024;

/// Releases only the reservation this render created, including on failure.
struct PreviewReservation<'a> {
    service: &'a PreviewService,
    id: String,
}
impl Drop for PreviewReservation<'_> {
    fn drop(&mut self) {
        self.service.cancel_spectrum_export(&self.id);
    }
}

impl PreviewService {
    pub fn preview_figure(
        &self,
        request: &FigurePreviewRequestDto,
        document: u64,
    ) -> FigurePreviewOutcomeDto {
        self.preview_figure_after_render(request, document, || {})
    }

    pub(in crate::preview) fn preview_figure_after_render(
        &self,
        request: &FigurePreviewRequestDto,
        document: u64,
        after_render: impl FnOnce(),
    ) -> FigurePreviewOutcomeDto {
        match self.render_figure_preview(request, document, after_render) {
            Ok((svg, empty)) => match Sha256Digest::calculate(svg.as_bytes()) {
                Ok(digest) => FigurePreviewOutcomeDto::Rendered {
                    request_id: request.request_id,
                    spec_id: digest.to_string(),
                    svg,
                    empty,
                    width: request.settings.width_px,
                    height: request.settings.height_px,
                },
                Err(_) => FigurePreviewOutcomeDto::Refused {
                    request_id: request.request_id,
                    error: spectrum_export_refused(),
                },
            },
            Err(error) => FigurePreviewOutcomeDto::Refused {
                request_id: request.request_id,
                error,
            },
        }
    }

    fn render_figure_preview(
        &self,
        request: &FigurePreviewRequestDto,
        document: u64,
        after_render: impl FnOnce(),
    ) -> Result<(String, bool), PreviewErrorDto> {
        if document != self.workspace_drop_document_epoch() {
            return Err(spectrum_export_stale());
        }
        let (spectrum, chromatogram) = match &request.source {
            FigurePreviewSourceDto::Spectrum { token, .. } => (Some(token.as_str()), None),
            FigurePreviewSourceDto::Chromatogram { token, .. } => (None, Some(token.as_str())),
            FigurePreviewSourceDto::Linked {
                spectrum_token,
                chromatogram_token,
                ..
            } => (
                Some(spectrum_token.as_str()),
                Some(chromatogram_token.as_str()),
            ),
        };
        if spectrum
            .into_iter()
            .chain(chromatogram)
            .any(|token| token.len() > 64)
        {
            return Err(spectrum_export_stale());
        }
        // BEGIN and CLAIM use the original token/range/link admission. The claim
        // pins immutable inputs and the lane for this render alone. Rendering
        // performs no filesystem access, source read, or process invocation.
        let (svg, empty) = match &request.source {
            FigurePreviewSourceDto::Spectrum { token, range } => {
                let id = self.begin_spectrum_export(token, "svg", range, &request.settings)?;
                let reservation = PreviewReservation { service: self, id };
                let claimed = self.claim_spectrum_export(&reservation.id)?;
                let svg =
                    svg_document(claimed.snapshot.spectrum(), claimed.settings, claimed.range)
                        .map_err(|_| spectrum_export_refused())?;
                let empty = exported_point_count(claimed.snapshot.spectrum(), claimed.range) == 0;
                (svg, empty)
            }
            FigurePreviewSourceDto::Chromatogram {
                token,
                range,
                traces,
            } => {
                let id = self.begin_chromatogram_export(
                    token,
                    "svg",
                    range,
                    *traces,
                    &request.settings,
                )?;
                let reservation = PreviewReservation { service: self, id };
                let claimed = self.claim_chromatogram_export(&reservation.id)?;
                (
                    chromatogram_svg(
                        claimed.snapshot.source(),
                        claimed.range,
                        claimed.traces,
                        claimed.figure_settings(),
                    )
                    .map_err(|_| chromatogram_export_refused())?,
                    false,
                )
            }
            FigurePreviewSourceDto::Linked {
                chromatogram_token,
                spectrum_token,
                range,
                traces,
            } => {
                let id = self.begin_linked_figure_export(
                    chromatogram_token,
                    spectrum_token,
                    "svg",
                    range,
                    *traces,
                    &request.settings,
                )?;
                let reservation = PreviewReservation { service: self, id };
                let claimed = self.claim_linked_figure_export(&reservation.id)?;
                (
                    mscanvas_plot_spec::svg::render(&Self::linked_figure_of(&claimed)?),
                    false,
                )
            }
        };
        after_render();
        if document != self.workspace_drop_document_epoch()
            || !self
                .spectrum_export_slot()
                .preview_sources_current(spectrum, chromatogram)
        {
            return Err(spectrum_export_stale());
        }
        if svg.len() > MAX_FIGURE_PREVIEW_BYTES {
            return Err(PreviewErrorDto {
                kind: "figure_preview_too_large".to_owned(),
                summary: "This figure exceeds the preview display limit.".to_owned(),
                detail: None,
                retryable: false,
                context: None,
            });
        }
        Ok((svg, empty))
    }
}
