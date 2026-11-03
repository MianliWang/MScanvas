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

    let file = TestFile::with_points("m74-empty-spectrum", 0, &[]);
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
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

/// ADR 0055, owner decision A0055 (a) of 2026-10-31: a labelled row's figure
/// says so wherever it goes, and an unlabelled one is exactly what it was. The
/// clipboard's figures have their own test below.
#[test]
fn a_labelled_row_s_figures_say_so_in_the_preview_and_in_every_saved_document() {
    const RELEASE: &str = "3.0.26204";
    const NOTE: &str = "Not verified by MSCanvas: ProteoWizard 3.0.26204";
    // The webview's own words for the same label, in the same language.
    let en = include_str!("../../../../src/features/preferences/locales/en.ts");
    assert!(en.contains(
        "m74CnvNotVerifiedBuild: \"Not verified by MSCanvas: ProteoWizard {{release}}\""
    ));
    assert!(en.contains("m74CnvNotVerified: \"Not verified by MSCanvas\""));

    let file = TestFile::new("m74-labelled-figures");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let pair = linked_ready(&file, &service);
    let spectrum = || FigurePreviewSourceDto::Spectrum {
        token: pair.spectrum.clone(),
        range: full_spectrum_range(),
    };
    let chromatogram = || FigurePreviewSourceDto::Chromatogram {
        token: pair.chromatogram.clone(),
        range: full_run_range(),
        traces: both_traces(),
    };
    let linked = || FigurePreviewSourceDto::Linked {
        chromatogram_token: pair.chromatogram.clone(),
        spectrum_token: pair.spectrum.clone(),
        range: full_run_range(),
        traces: both_traces(),
    };
    for source in [spectrum(), chromatogram(), linked()] {
        let (svg, _) = render(&service, source, default_figure_settings());
        assert!(!svg.contains("Not verified"), "{svg}");
    }

    service.label_admitted_row(
        &mut crate::preview::dto::WorkspaceAddResultDto {
            roster: service.roster(),
            outcomes: Vec::new(),
        },
        &pair.handle,
        crate::project::record::NotVerifiedByMscanvas::of(false, Some(RELEASE.to_owned()))
            .expect("a label"),
    );

    for (name, source) in [
        ("spectrum", spectrum()),
        ("chromatogram", chromatogram()),
        ("linked", linked()),
    ] {
        let (svg, _) = render(&service, source, default_figure_settings());
        assert!(svg.contains(&format!(">{NOTE}<")), "{name} draws it: {svg}");
        assert!(
            svg.contains(&format!("<desc>{NOTE}. ")),
            "{name} describes it: {svg}"
        );
    }

    // The saved documents are the preview's, and a PNG's text is the SVG's.
    let saved_spectrum = |format: &str, name: &str| {
        let destination = file.directory.join(name);
        let reservation = service
            .begin_spectrum_export(
                &pair.spectrum,
                format,
                &full_spectrum_range(),
                &default_figure_settings(),
            )
            .expect("reserve");
        let claimed = service.claim_spectrum_export(&reservation).expect("claim");
        service
            .write_spectrum_export(&claimed, &destination)
            .expect("write");
        fs::read(destination).expect("saved")
    };
    let (preview, _) = render(&service, spectrum(), default_figure_settings());
    assert_eq!(saved_spectrum("svg", "spectrum.svg"), preview.into_bytes());
    assert!(String::from_utf8_lossy(&saved_spectrum("png", "spectrum.png")).contains(NOTE));

    let reservation = service
        .begin_chromatogram_export(
            &pair.chromatogram,
            "png",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("reserve");
    let claimed = service
        .claim_chromatogram_export(&reservation)
        .expect("claim");
    let chromatogram_png = file.directory.join("chromatogram.png");
    service
        .write_chromatogram_export(&claimed, &chromatogram_png)
        .expect("write");
    assert!(String::from_utf8_lossy(&fs::read(chromatogram_png).expect("saved")).contains(NOTE));

    let linked_png = file.directory.join("linked.png");
    linked_saved_as(
        &service,
        &pair.chromatogram,
        &pair.spectrum,
        "png",
        &linked_png,
    )
    .expect("write");
    assert!(String::from_utf8_lossy(&fs::read(linked_png).expect("saved")).contains(NOTE));

    // The label is read when the export is claimed: a row removed while the
    // save dialog is open does not take it off the figure.
    let reservation = service
        .begin_spectrum_export(
            &pair.spectrum,
            "svg",
            &full_spectrum_range(),
            &default_figure_settings(),
        )
        .expect("reserve");
    let claimed = service.claim_spectrum_export(&reservation).expect("claim");
    service.remove_datasets_now(std::slice::from_ref(&pair.handle));
    let figure = claimed.figure().expect("still the figure");
    assert_eq!(
        figure.source_note().map(|note| note.as_str().to_owned()),
        Some(NOTE.to_owned())
    );
    service.cancel_spectrum_export(&reservation);
}

/// One run, open and with a scan selected, on a row labelled with this release.
fn labelled_session(release: &str) -> (TestFile, PreviewService, LinkedSession) {
    let file = TestFile::new("a0055-labelled-session");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let pair = linked_ready(&file, &service);
    service.label_admitted_row(
        &mut crate::preview::dto::WorkspaceAddResultDto {
            roster: service.roster(),
            outcomes: Vec::new(),
        },
        &pair.handle,
        crate::project::record::NotVerifiedByMscanvas::of(false, Some(release.to_owned()))
            .expect("a label"),
    );
    (file, service, pair)
}

type CopiedFigure = Result<mscanvas_plot_spec::spec::FigureSpec, PreviewErrorDto>;

/// One copy of the kind named, up to the clipboard write, which is the only
/// part that needs an app handle. `meanwhile` runs after the lane is taken.
fn copied_figure(
    service: &PreviewService,
    pair: &LinkedSession,
    kind: &str,
    meanwhile: impl FnOnce(),
) -> CopiedFigure {
    use crate::preview::chromatogram::{RangeRequest, TraceSet};
    use crate::preview::export::{LinkedTokens, SpectrumRangeRequest};
    let settings = PreviewService::render_settings(&default_figure_settings()).expect("settings");
    let traces = TraceSet::from_wire(true, true);
    let run_range = RangeRequest::from_wire(&full_run_range().scope, None, None).expect("a range");
    let figure = match kind {
        "spectrum" => {
            let wire = full_spectrum_range();
            let range = SpectrumRangeRequest::from_wire(&wire.scope, wire.low, wire.high);
            let (snapshot, resolved) = service
                .spectrum_export_slot()
                .begin_copy(&pair.spectrum, range.expect("a range"))
                .expect("the lane");
            meanwhile();
            service.spectrum_copy_figure(&snapshot, resolved, settings)
        }
        "chromatogram" => {
            let (snapshot, resolved) = service
                .spectrum_export_slot()
                .begin_chromatogram_copy(&pair.chromatogram, run_range, traces)
                .expect("the lane");
            meanwhile();
            service.chromatogram_copy_figure(&snapshot, resolved, traces, settings)
        }
        _ => {
            let linked = service
                .spectrum_export_slot()
                .begin_linked_figure_copy(
                    LinkedTokens {
                        chromatogram: &pair.chromatogram,
                        spectrum: &pair.spectrum,
                    },
                    run_range,
                    traces,
                    settings,
                )
                .expect("the lane");
            meanwhile();
            service.linked_copy_figure(&linked, traces, settings)
        }
    };
    service.spectrum_export_slot().release_write();
    figure
}

type Refusal = fn() -> PreviewErrorDto;

const COPIES: [(&str, Refusal); 3] = [
    ("spectrum", crate::preview::dto::spectrum_export_stale),
    (
        "chromatogram",
        crate::preview::dto::chromatogram_export_stale,
    ),
    ("linked", crate::preview::dto::linked_figure_stale),
];

/// A clipboard image has no words but the ones drawn (owner decision A0055 (a)),
/// and the row is asked again for each copy, since a copy has no dialog.
#[test]
fn a_labelled_row_s_copied_figures_say_so_and_a_row_that_left_refuses_the_copy() {
    const NOTE: &str = "Not verified by MSCanvas: ProteoWizard 3.0.26204";
    for (kind, stale) in COPIES {
        let file = TestFile::new("a0055-unlabelled-copy");
        let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
        let pair = linked_ready(&file, &service);
        let plain = copied_figure(&service, &pair, kind, || {}).expect("drawn");
        assert_eq!(plain.source_note(), None, "{kind}");

        let (_file, service, pair) = labelled_session("3.0.26204");
        let figure = copied_figure(&service, &pair, kind, || {}).expect("drawn");
        assert_eq!(
            figure.source_note().map(|note| note.as_str().to_owned()),
            Some(NOTE.to_owned()),
            "{kind}"
        );

        let error = copied_figure(&service, &pair, kind, || {
            service.remove_datasets_now(std::slice::from_ref(&pair.handle));
        })
        .expect_err("a row that left is not a row with no label");
        assert_eq!(error.kind, stale().kind, "{kind}");
    }
}

/// `remove_datasets` takes the row, and only then the slot's snapshot, and it
/// never touches a reservation. A claim that found no row and went on would save
/// a labelled output's figure with no label, so it is refused: no dialog opens
/// and nothing is written, and the lane is free for the next export.
#[test]
fn a_row_removed_between_begin_and_claim_refuses_the_claim_and_frees_the_lane() {
    for (kind, stale) in COPIES {
        let (_file, service, pair) = labelled_session("3.0.26204");
        let settings = default_figure_settings();
        let (reservation, refused) = match kind {
            "spectrum" => {
                let reservation = service
                    .begin_spectrum_export(&pair.spectrum, "svg", &full_spectrum_range(), &settings)
                    .expect("reserve");
                service.remove_datasets_now(std::slice::from_ref(&pair.handle));
                let refused = service.claim_spectrum_export(&reservation).map(|_| ());
                (reservation, refused)
            }
            "chromatogram" => {
                let reservation = service
                    .begin_chromatogram_export(
                        &pair.chromatogram,
                        "svg",
                        &full_run_range(),
                        both_traces(),
                        &settings,
                    )
                    .expect("reserve");
                service.remove_datasets_now(std::slice::from_ref(&pair.handle));
                let refused = service.claim_chromatogram_export(&reservation).map(|_| ());
                (reservation, refused)
            }
            _ => {
                let reservation = service
                    .begin_linked_figure_export(
                        &pair.chromatogram,
                        &pair.spectrum,
                        "svg",
                        &full_run_range(),
                        both_traces(),
                        &settings,
                    )
                    .expect("reserve");
                service.remove_datasets_now(std::slice::from_ref(&pair.handle));
                let refused = service.claim_linked_figure_export(&reservation).map(|_| ());
                (reservation, refused)
            }
        };
        assert_eq!(
            refused.expect_err("no row, no claim").kind,
            stale().kind,
            "{kind}"
        );
        assert!(
            !service.cancel_linked_figure_export(&reservation),
            "{kind}: the refused claim already gave its reservation back"
        );
    }
}

/// The longest release a figure's note can name, and one past it: refused, with
/// nothing written, rather than exported without the label.
#[test]
fn a_release_too_long_to_print_refuses_the_figure_and_writes_nothing() {
    // The note's own words are 39 characters of the 120 a label holds.
    for (length, drawn) in [(81, true), (82, false)] {
        let (file, service, pair) = labelled_session(&"r".repeat(length));
        let reservation = service
            .begin_spectrum_export(
                &pair.spectrum,
                "svg",
                &full_spectrum_range(),
                &default_figure_settings(),
            )
            .expect("reserve");
        let claimed = service.claim_spectrum_export(&reservation).expect("claim");
        let destination = file.directory.join(format!("release-{length}.svg"));
        let saved = service.write_spectrum_export(&claimed, &destination);
        assert_eq!(saved.is_ok(), drawn, "{length} characters");
        assert_eq!(destination.exists(), drawn, "{length} characters");
        service.cancel_spectrum_export(&reservation);
    }
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
