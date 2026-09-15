use super::super::dto::{FigurePreviewOutcomeDto, FigurePreviewRequestDto, FigurePreviewSourceDto};
use super::*;

#[test]
fn figure_preview_discards_a_render_when_the_document_or_retained_source_changes_before_delivery() {
    for replace_document in [false, true] {
        let (_file, service, token) = one_loaded_spectrum();
        let question = FigurePreviewRequestDto {
            request_id: 42,
            source: FigurePreviewSourceDto::Spectrum {
                token,
                range: full_spectrum_range(),
            },
            settings: default_figure_settings(),
        };
        let document = service.workspace_drop_document_epoch();
        assert!(matches!(
            service.preview_figure(&question, document),
            FigurePreviewOutcomeDto::Rendered { .. }
        ));
        let result = service.preview_figure_after_render(&question, document, || {
            if replace_document {
                service.begin_webview_document();
            } else {
                service
                    .clear_workspace()
                    .expect("render released the lane before source removal");
            }
        });
        assert!(matches!(
            result,
            FigurePreviewOutcomeDto::Refused { request_id: 42, .. }
        ));
    }
}

fn render(
    service: &PreviewService,
    source: FigurePreviewSourceDto,
    settings: FigureSettingsDto,
) -> (String, bool) {
    let request = FigurePreviewRequestDto {
        request_id: 71,
        source,
        settings,
    };
    match service.preview_figure(&request, service.workspace_drop_document_epoch()) {
        FigurePreviewOutcomeDto::Rendered {
            request_id,
            svg,
            spec_id,
            empty,
            width,
            height,
        } => {
            assert_eq!(request_id, 71);
            assert_eq!(
                (width, height),
                (request.settings.width_px, request.settings.height_px)
            );
            assert_eq!(
                Sha256Digest::calculate(svg.as_bytes())
                    .expect("hash")
                    .to_string(),
                spec_id
            );
            (svg, empty)
        }
        refusal => panic!("the figure should render: {refusal:?}"),
    }
}

#[test]
fn figure_preview_matches_the_actual_svg_and_releases_the_lane_before_the_dialog() {
    let (file, service, spectrum) = a_ranged_spectrum("m74-preview-svg");
    for (index, range) in [
        full_spectrum_range(),
        current_spectrum_range(110.0, 130.0),
        current_whole_spectrum_range(),
    ]
    .into_iter()
    .enumerate()
    {
        let (svg, empty) = render(
            &service,
            FigurePreviewSourceDto::Spectrum {
                token: spectrum.export_token.clone(),
                range: range.clone(),
            },
            default_figure_settings(),
        );
        assert!(!empty);
        let output = file.directory.join(format!("preview-{index}.svg"));
        export_spectrum_range(&service, &spectrum.export_token, "svg", &range, &output);
        assert_eq!(fs::read_to_string(output).expect("saved SVG"), svg);
    }
}

#[test]
fn figure_preview_empty_source_and_empty_committed_window_remain_honest_figures_and_data() {
    let (file, service, spectrum) = a_ranged_spectrum("m74-preview-empty-window");
    let range = current_spectrum_range(121.0, 129.0);
    let (_, empty) = render(
        &service,
        FigurePreviewSourceDto::Spectrum {
            token: spectrum.export_token.clone(),
            range: range.clone(),
        },
        default_figure_settings(),
    );
    assert!(empty);
    export_spectrum_range(
        &service,
        &spectrum.export_token,
        "csv",
        &range,
        &file.directory.join("empty-window.csv"),
    );
    assert!(
        fs::read_to_string(file.directory.join("empty-window.csv"))
            .expect("CSV")
            .ends_with("mz,intensity\n")
    );

    let file = TestFile::new("m74-empty-spectrum");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![Response::File(
        selected_spectrum_output(0, &[]),
    )])));
    let selected = service.accept_file(&file.path).expect("source");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let (svg, empty) = render(
        &service,
        FigurePreviewSourceDto::Spectrum {
            token: token.clone(),
            range: full_spectrum_range(),
        },
        default_figure_settings(),
    );
    assert!(empty);
    export_spectrum_range(
        &service,
        &token,
        "svg",
        &full_spectrum_range(),
        &file.directory.join("empty.svg"),
    );
    assert_eq!(
        fs::read_to_string(file.directory.join("empty.svg")).expect("SVG"),
        svg
    );
    export_spectrum_range(
        &service,
        &token,
        "tsv",
        &full_spectrum_range(),
        &file.directory.join("empty.tsv"),
    );
    assert!(
        fs::read_to_string(file.directory.join("empty.tsv"))
            .expect("TSV")
            .ends_with("mz\tintensity\n")
    );
}

#[test]
fn figure_preview_uses_the_canonical_chromatogram_and_linked_paths() {
    let file = TestFile::new("m74-linked-preview");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let pair = linked_ready(&file, &service);
    let (chrom, _) = render(
        &service,
        FigurePreviewSourceDto::Chromatogram {
            token: pair.chromatogram.clone(),
            range: full_run_range(),
            traces: both_traces(),
        },
        default_figure_settings(),
    );
    let reservation = service
        .begin_chromatogram_export(
            &pair.chromatogram,
            "svg",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("reserve");
    let claimed = service
        .claim_chromatogram_export(&reservation)
        .expect("claim");
    service
        .write_chromatogram_export(&claimed, &file.directory.join("chrom.svg"))
        .expect("write");
    assert_eq!(
        fs::read_to_string(file.directory.join("chrom.svg")).expect("SVG"),
        chrom
    );
    let (linked, _) = render(
        &service,
        FigurePreviewSourceDto::Linked {
            chromatogram_token: pair.chromatogram.clone(),
            spectrum_token: pair.spectrum.clone(),
            range: full_run_range(),
            traces: both_traces(),
        },
        default_figure_settings(),
    );
    linked_saved_as(
        &service,
        &pair.chromatogram,
        &pair.spectrum,
        "svg",
        &file.directory.join("linked.svg"),
    )
    .expect("write");
    assert_eq!(
        fs::read_to_string(file.directory.join("linked.svg")).expect("SVG"),
        linked
    );
    assert!(linked.contains("Panel 2 of 2"));
}

#[test]
fn figure_preview_rejects_unknown_tokens_and_old_documents_while_invalid_dpi_remains_png_only() {
    let (_file, service, token) = one_loaded_spectrum();
    let question = FigurePreviewRequestDto {
        request_id: 1,
        source: FigurePreviewSourceDto::Spectrum {
            token: token.clone(),
            range: full_spectrum_range(),
        },
        settings: figure_settings(1200, 640, 0),
    };
    assert!(matches!(
        service.preview_figure(&question, service.workspace_drop_document_epoch() + 1),
        FigurePreviewOutcomeDto::Refused { .. }
    ));
    let unknown = FigurePreviewRequestDto {
        source: FigurePreviewSourceDto::Spectrum {
            token: "unknown".to_owned(),
            range: full_spectrum_range(),
        },
        ..question.clone()
    };
    assert!(matches!(
        service.preview_figure(&unknown, service.workspace_drop_document_epoch()),
        FigurePreviewOutcomeDto::Refused { .. }
    ));
    assert!(matches!(
        service.preview_figure(&question, service.workspace_drop_document_epoch()),
        FigurePreviewOutcomeDto::Rendered { .. }
    ));
    assert!(
        service
            .begin_spectrum_export(&token, "png", &full_spectrum_range(), &question.settings)
            .is_err()
    );
    let reservation = service
        .begin_spectrum_export(&token, "csv", &full_spectrum_range(), &question.settings)
        .expect("data ignores DPI");
    service.cancel_spectrum_export(&reservation);
}
