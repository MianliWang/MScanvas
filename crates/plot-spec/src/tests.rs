//! Deterministic tests for the semantic contract and its SVG renderer.

use crate::spec::{
    AxisSpec, Caption, DataScope, DecodeError, Domain, FigureSize, FigureSpec, FigureTheme, Label,
    MAX_LABEL_CHARS, MIN_FIGURE_CHROME_HEIGHT, MIN_FIGURE_WIDTH, MIN_PANEL_HEIGHT, Marker,
    PanelSpec, PlotKind, ReductionRule, SCHEMA_VERSION, SeriesSpec, SpecError,
    SpectrumRepresentation, StyleRole, UnitState,
};
use crate::svg;

fn label(text: &str) -> Label {
    Label::new(text).expect("a test label is valid")
}

fn domain(low: f64, high: f64) -> Domain {
    Domain::new(low, high).expect("a test domain is valid")
}

fn series(x: Vec<f64>, y: Vec<f64>) -> SeriesSpec {
    SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::FullSource,
        x,
        y,
    )
    .expect("a test series is valid")
}

fn spectrum_panel(representation: SpectrumRepresentation, series: SeriesSpec) -> PanelSpec {
    let x_low = series.x().first().copied().unwrap_or(0.0);
    let x_high = series.x().last().copied().unwrap_or(1.0);
    let y_low = series.y().iter().copied().fold(0.0_f64, f64::min);
    let y_high = series.y().iter().copied().fold(0.0_f64, f64::max);
    PanelSpec::new(
        PlotKind::Spectrum { representation },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(x_low, x_high.max(x_low)),
        domain(y_low, y_high.max(y_low)),
        vec![series],
    )
    .expect("a test panel is valid")
}

/// The drawing commands of the first series path, without the rest of the
/// document.
///
/// Counting a command letter across the whole document would count the `M` in
/// the default title "Mass spectrum" as a subpath, which is exactly the kind of
/// assertion that passes for the wrong reason.
fn path_data(document: &str) -> String {
    document
        .split("<path d=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .unwrap_or_default()
        .to_owned()
}

/// The description the document actually carries, still XML-escaped.
///
/// Escaped rather than unescaped on the way out, because what a test should
/// pin is the bytes a reader's viewer receives. A quotation mark in a series
/// name reaches the file as `&quot;`, and a helper that quietly undid that
/// would let an unescaped description pass.
fn description_of(document: &str) -> String {
    document
        .split("<desc>")
        .nth(1)
        .and_then(|rest| rest.split("</desc>").next())
        .expect("the document carries a description")
        .to_owned()
}

fn figure_of(panel: PanelSpec) -> FigureSpec {
    FigureSpec::new(
        FigureTheme::Light,
        FigureSize::new(900.0, 500.0).expect("a test size is valid"),
        vec![panel],
    )
    .expect("one panel is a figure")
}

// ---------------------------------------------------------------- contract

#[test]
fn a_spectrum_specification_is_built_from_checked_values() {
    let figure = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.5, 301.25], vec![10.0, 4_000.0, 250.0]),
    ));

    assert_eq!(figure.schema_version, SCHEMA_VERSION);
    assert_eq!(figure.panels.len(), 1);
    assert!(figure.panels[0].is_full_source());
}

/// The three representations stay three things.
///
/// The one that matters is the third: a file reporting nothing is not centroid
/// data, whatever the screen happens to draw it as.
#[test]
fn the_three_spectrum_representations_stay_distinct() {
    assert_ne!(
        SpectrumRepresentation::Unreported,
        SpectrumRepresentation::Centroid
    );
    assert_ne!(
        SpectrumRepresentation::Unreported,
        SpectrumRepresentation::Profile
    );
    // And only one of them licenses a joined trace.
    assert!(SpectrumRepresentation::Profile.may_draw_continuous_trace());
    assert!(!SpectrumRepresentation::Centroid.may_draw_continuous_trace());
    assert!(!SpectrumRepresentation::Unreported.may_draw_continuous_trace());
}

/// An unreported unit and a dimensionless quantity are different facts.
#[test]
fn the_three_unit_states_stay_distinct() {
    let known = UnitState::Known { unit: label("min") };
    assert_ne!(known, UnitState::Unreported);
    assert_ne!(known, UnitState::Dimensionless);
    assert_ne!(UnitState::Unreported, UnitState::Dimensionless);

    // And they serialize as three different documents, so the distinction
    // survives the wire rather than only the type system.
    let encode = |state: &UnitState| serde_json::to_string(state).expect("a unit state encodes");
    assert_ne!(
        encode(&UnitState::Unreported),
        encode(&UnitState::Dimensionless)
    );
}

#[test]
fn mismatched_axis_lengths_are_refused() {
    let refusal = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::FullSource,
        vec![1.0, 2.0, 3.0],
        vec![1.0, 2.0],
    );
    assert_eq!(refusal.unwrap_err(), SpecError::AxisLengthMismatch);
}

#[test]
fn non_finite_coordinates_are_refused_everywhere() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            SeriesSpec::new(
                label("measurement"),
                StyleRole::Measurement,
                DataScope::FullSource,
                vec![1.0, bad],
                vec![1.0, 2.0],
            )
            .unwrap_err(),
            SpecError::NotFinite,
        );
        assert_eq!(
            SeriesSpec::new(
                label("measurement"),
                StyleRole::Measurement,
                DataScope::FullSource,
                vec![1.0, 2.0],
                vec![1.0, bad],
            )
            .unwrap_err(),
            SpecError::NotFinite,
        );
        assert_eq!(Domain::new(bad, 1.0).unwrap_err(), SpecError::NotFinite);
        assert_eq!(Marker::new(bad, None).unwrap_err(), SpecError::NotFinite);
        assert_eq!(
            FigureSize::new(bad, 100.0).unwrap_err(),
            SpecError::FigureSizeOutOfRange,
        );
    }
}

/// Unordered source data is refused rather than sorted.
///
/// Sorting would be this boundary deciding that the file meant something other
/// than what it said, and every downstream reduction and pointer lookup assumes
/// the order it was given.
#[test]
fn unordered_source_data_is_refused() {
    let refusal = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::FullSource,
        vec![1.0, 3.0, 2.0],
        vec![1.0, 1.0, 1.0],
    );
    assert_eq!(refusal.unwrap_err(), SpecError::SourceNotOrdered);

    // Equal neighbours are ordered. Two measurements at one m/z is a real
    // reading, not a fault.
    assert!(
        SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::FullSource,
            vec![1.0, 1.0, 2.0],
            vec![1.0, 2.0, 3.0],
        )
        .is_ok()
    );
}

#[test]
fn negative_intensity_survives_the_contract() {
    let values = vec![-90.0, 0.0, 4_000.0];
    let spec = series(vec![100.0, 200.0, 300.0], values.clone());
    assert_eq!(spec.y(), values.as_slice());

    let panel = spectrum_panel(SpectrumRepresentation::Profile, spec);
    assert!(
        panel.value_domain.low() < 0.0,
        "the range reaches below zero"
    );
}

#[test]
fn empty_and_peakless_scenes_remain_valid() {
    let empty = figure_of(spectrum_panel(
        SpectrumRepresentation::Unreported,
        series(Vec::new(), Vec::new()),
    ));
    assert!(empty.panels[0].series[0].is_empty());

    let peakless = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0, 300.0], vec![0.0, 0.0, 0.0]),
    ));
    assert_eq!(peakless.panels[0].series[0].len(), 3);
}

#[test]
fn labels_are_bounded_and_printable() {
    assert_eq!(Label::new("").unwrap_err(), SpecError::LabelEmpty);
    assert_eq!(Label::new("   ").unwrap_err(), SpecError::LabelEmpty);
    assert_eq!(
        Label::new("a".repeat(MAX_LABEL_CHARS + 1)).unwrap_err(),
        SpecError::LabelTooLong,
    );
    assert_eq!(
        Label::new("two\nlines").unwrap_err(),
        SpecError::LabelNotPrintable,
    );
    assert!(Label::new("a".repeat(MAX_LABEL_CHARS)).is_ok());
}

#[test]
fn a_reduction_may_not_claim_a_smaller_source_than_itself() {
    let refusal = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 2,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![1.0, 2.0, 3.0],
        vec![1.0, 2.0, 3.0],
    );
    assert_eq!(refusal.unwrap_err(), SpecError::ReductionNotSmaller);
}

#[test]
fn a_visible_window_may_not_leave_the_full_domain() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Profile,
        series(vec![100.0, 500.0], vec![1.0, 2.0]),
    );
    assert!(
        panel
            .clone()
            .with_visible_domain(domain(200.0, 400.0))
            .is_ok()
    );
    assert_eq!(
        panel.with_visible_domain(domain(50.0, 400.0)).unwrap_err(),
        SpecError::DomainInverted,
    );
}

#[test]
fn serialization_is_deterministic_and_round_trips() {
    let figure = figure_of(spectrum_panel(
        SpectrumRepresentation::Profile,
        series(vec![100.0, 200.0], vec![-5.0, 5.0]),
    ))
    .with_title(label("Spectrum 1"))
    .with_caption(Caption::new("A test caption.").expect("a caption"));

    let first = figure.to_json().expect("encodes");
    let second = figure.to_json().expect("encodes again");
    assert_eq!(first, second, "the same figure encodes to the same bytes");

    let decoded = FigureSpec::from_json(&first).expect("decodes");
    assert_eq!(decoded, figure);
}

/// A document from another schema is refused rather than partly read.
#[test]
fn an_unknown_schema_version_fails_closed() {
    let figure = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![1.0], vec![1.0]),
    ));
    let json = figure.to_json().expect("encodes");
    let future = json.replace(
        &format!("\"schema_version\":{SCHEMA_VERSION}"),
        "\"schema_version\":9999",
    );
    assert_ne!(future, json, "the test rewrote the version it meant to");

    assert_eq!(
        FigureSpec::from_json(&future).unwrap_err(),
        DecodeError::Spec(SpecError::UnknownSchemaVersion),
    );
    assert_eq!(
        FigureSpec::from_json("{").unwrap_err(),
        DecodeError::Malformed,
    );
}

#[test]
fn a_figure_holds_between_one_and_the_bounded_number_of_panels() {
    let size = FigureSize::new(MIN_FIGURE_WIDTH, 500.0).expect("a size");
    assert_eq!(
        FigureSpec::new(FigureTheme::Light, size, Vec::new()).unwrap_err(),
        SpecError::PanelCountOutOfRange,
    );
}

// ---------------------------------------------------------------- renderer

#[test]
fn the_same_specification_renders_the_same_bytes() {
    let figure = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0, 300.0], vec![5.0, -3.0, 900.0]),
    ));
    assert_eq!(svg::render(&figure), svg::render(&figure));
}

/// The figure's palette is the figure's own.
///
/// Both themes are reachable from one process with no application state
/// involved, which is what "light figure while the app stays dark" has to mean
/// for an export that runs with no window at all.
#[test]
fn figure_themes_are_independent_of_any_application_theme() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    );
    let size = FigureSize::new(600.0, 400.0).expect("a size");
    let light = FigureSpec::new(FigureTheme::Light, size, vec![panel.clone()]).expect("a figure");
    let dark = FigureSpec::new(FigureTheme::Dark, size, vec![panel]).expect("a figure");

    let light_svg = svg::render(&light);
    let dark_svg = svg::render(&dark);
    assert_ne!(light_svg, dark_svg);
    assert!(
        light_svg.contains("#ffffff"),
        "the light figure is on white"
    );
    assert!(dark_svg.contains("#12161c"), "the dark figure is not");

    // Colour is written into the document rather than left to a stylesheet, so
    // the file means the same thing wherever it is opened.
    assert!(!light_svg.contains("class="));
    assert!(light_svg.contains("fill=\"#ffffff\""));
}

#[test]
fn xml_sensitive_characters_in_labels_are_escaped() {
    let hostile = "Ion <b>&\"count\"</b> 'x'";
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label(hostile), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 10.0),
        vec![series(vec![1.0, 2.0], vec![1.0, 2.0])],
    )
    .expect("a panel");
    let document = svg::render(&figure_of(panel).with_title(label(hostile)));

    assert!(document.contains("&lt;b&gt;"), "angle brackets are escaped");
    assert!(document.contains("&amp;"), "ampersands are escaped");
    assert!(document.contains("&quot;"), "double quotes are escaped");
    assert!(document.contains("&apos;"), "single quotes are escaped");
    assert!(
        !document.contains("<b>"),
        "no label text reaches the document as markup",
    );
}

#[test]
fn every_figure_carries_a_title_and_a_description() {
    // Given ones are used.
    let titled = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![1.0], vec![1.0]),
    ))
    .with_title(label("Given title"))
    .with_caption(Caption::new("Given description.").expect("a caption"));
    let document = svg::render(&titled);
    assert!(document.contains("<title>Given title</title>"));
    // The caption is there, and so is the disclosure it must not have replaced.
    assert!(document.contains("<desc>Given description. "));
    assert!(document.contains("Centroided peaks, as reported by the source file."));

    // Absent ones are derived rather than omitted: an untitled figure is still
    // a figure somebody has to be able to identify.
    let untitled = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![1.0], vec![1.0]),
    ));
    let document = svg::render(&untitled);
    assert!(document.contains("<title>Mass spectrum</title>"));
    assert!(document.contains("<desc>"));
}

/// An unreported spectrum is described as unreported.
///
/// Not as centroid, whatever the marks look like. The description is the only
/// place a reader learns that nobody stated what these points are.
#[test]
fn an_unreported_representation_is_never_described_as_established() {
    let document = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Unreported,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )));

    assert!(
        document.contains("does not report whether"),
        "the description says the representation is unstated",
    );
    assert!(!document.contains("Centroided peaks, as reported"));
    assert!(!document.contains("Profile samples, as reported"));

    // And it is drawn as discrete marks rather than joined, because joining
    // would assert the representation while drawing it. Read from the path
    // rather than the document: a command letter counted across the whole
    // document would also count one in a label.
    let path = path_data(&document);
    assert!(path.contains('V'), "the marks are sticks");
    assert!(!path.contains('L'), "nothing is joined into a trace");
}

#[test]
fn only_established_profile_data_is_joined_into_a_trace() {
    let points = (0..8).map(f64::from).collect::<Vec<_>>();
    let values = vec![1.0, 2.0, 3.0, 2.0, 1.0, 2.0, 3.0, 4.0];

    let profile = path_data(&svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Profile,
        series(points.clone(), values.clone()),
    ))));
    assert!(profile.contains('L'), "profile samples are joined");

    for representation in [
        SpectrumRepresentation::Centroid,
        SpectrumRepresentation::Unreported,
    ] {
        let path = path_data(&svg::render(&figure_of(spectrum_panel(
            representation,
            series(points.clone(), values.clone()),
        ))));
        assert!(
            !path.contains('L'),
            "{representation:?} points are not joined",
        );
    }
}

#[test]
fn no_application_chrome_or_location_reaches_the_document() {
    let document = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, -20.0]),
    )));

    for forbidden in [
        "class=",
        "href",
        "url(",
        "<image",
        "<foreignObject",
        "<script",
        "<style",
        "C:\\",
        "/Users/",
        "\\\\?\\",
        "Add files",
        "Convert",
        "button",
    ] {
        assert!(
            !document.contains(forbidden),
            "{forbidden} reached the figure: {document}",
        );
    }
    // The one URL-looking string is the format's own namespace, which fetches
    // nothing and is required for the document to be SVG at all.
    assert!(document.contains("xmlns=\"http://www.w3.org/2000/svg\""));
    assert_eq!(document.matches("http").count(), 1);
}

#[test]
fn no_non_finite_number_reaches_the_document() {
    // Every scene that could divide by zero: one point, a flat range, an
    // all-zero range and an empty one.
    let scenes: Vec<(Vec<f64>, Vec<f64>)> = vec![
        (Vec::new(), Vec::new()),
        (vec![500.0], vec![900.0]),
        (vec![1.0, 2.0, 3.0], vec![7.0, 7.0, 7.0]),
        (vec![1.0, 2.0, 3.0], vec![0.0, 0.0, 0.0]),
        (vec![1.0, 1.0, 1.0], vec![1.0, 2.0, 3.0]),
    ];
    for (x, y) in scenes {
        let document = svg::render(&figure_of(spectrum_panel(
            SpectrumRepresentation::Unreported,
            series(x, y),
        )));
        for forbidden in ["NaN", "inf", "Infinity", "undefined"] {
            assert!(
                !document.contains(forbidden),
                "{forbidden} reached the figure: {document}",
            );
        }
        assert!(document.starts_with("<?xml"), "the document is well formed");
        assert!(document.ends_with("</svg>\n"));
        assert!(document.len() < 100_000, "an edge scene stays bounded");
    }
}

#[test]
fn the_document_states_its_own_dimensions_and_view_box() {
    let figure = FigureSpec::new(
        FigureTheme::Light,
        FigureSize::new(1_234.0, 567.0).expect("a size"),
        vec![spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![1.0], vec![1.0]),
        )],
    )
    .expect("a figure");
    let document = svg::render(&figure);

    assert!(document.contains("width=\"1234.000\""));
    assert!(document.contains("height=\"567.000\""));
    assert!(document.contains("viewBox=\"0 0 1234.000 567.000\""));
}

/// A full-range export carries the full range.
///
/// The distinction the whole export path exists for: a figure defined over the
/// source must not quietly be the screen's reduction of it.
#[test]
fn a_full_source_export_is_not_the_screen_reduction() {
    let points: Vec<f64> = (0..5_000).map(|index| f64::from(index) * 0.1).collect();
    let values: Vec<f64> = (0..5_000)
        .map(|index| f64::from(index % 97) * 13.0 - 400.0)
        .collect();

    let full = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(points.clone(), values.clone()),
    ));
    assert!(full.panels[0].is_full_source());
    let full_document = svg::render(&full);

    let reduced_series = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: points.len(),
            rule: ReductionRule::MinMaxPerColumn,
        },
        points.iter().copied().step_by(10).collect(),
        values.iter().copied().step_by(10).collect(),
    )
    .expect("a reduction");
    let reduced = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        reduced_series,
    ));
    assert!(!reduced.panels[0].is_full_source());
    let reduced_document = svg::render(&reduced);

    assert!(
        full_document.len() > reduced_document.len() * 5,
        "the full export draws what the reduction dropped",
    );
    // And the reduction says so, in words, rather than looking like a full one.
    assert!(reduced_document.contains("5000 source points reduced to 500"));
    assert!(!full_document.contains("source points reduced to"));
}

/// A reduction keeps the extrema it says it keeps.
///
/// Checked against the rendered document rather than against the reducer, so
/// what is proved is that the drawn figure reaches the measured extremes.
#[test]
fn a_min_max_reduction_preserves_the_extrema_it_claims() {
    let mut x = Vec::new();
    let mut y = Vec::new();
    for index in 0..2_000 {
        x.push(f64::from(index));
        y.push(match index {
            707 => 99_999.0,
            1_313 => -55_555.0,
            _ => f64::from(index % 11),
        });
    }

    // Reduce the way the screen does: the highest and the lowest of each
    // column, both kept.
    let columns = 100;
    let mut highest: Vec<Option<(f64, f64)>> = vec![None; columns];
    let mut lowest: Vec<Option<(f64, f64)>> = vec![None; columns];
    let span = x[x.len() - 1] - x[0];
    for (value, height) in x.iter().zip(y.iter()) {
        let column = (((value - x[0]) / span * columns as f64) as usize).min(columns - 1);
        if *height >= 0.0 {
            let slot = &mut highest[column];
            if slot.is_none_or(|(_, kept)| *height > kept) {
                *slot = Some((*value, *height));
            }
        } else {
            let slot = &mut lowest[column];
            if slot.is_none_or(|(_, kept)| *height < kept) {
                *slot = Some((*value, *height));
            }
        }
    }
    let mut kept: Vec<(f64, f64)> = highest.into_iter().chain(lowest).flatten().collect();
    kept.sort_by(|left, right| left.0.total_cmp(&right.0));

    let reduced_high = kept
        .iter()
        .map(|(_, value)| *value)
        .fold(f64::MIN, f64::max);
    let reduced_low = kept
        .iter()
        .map(|(_, value)| *value)
        .fold(f64::MAX, f64::min);
    assert_eq!(reduced_high, 99_999.0, "the tallest peak survives");
    assert_eq!(reduced_low, -55_555.0, "the deepest trough survives");
}

/// A marker outside the window is kept but not drawn; outside the source it is
/// refused.
///
/// The two are different facts. A marker the current window excludes is exactly
/// what reappears when the window widens, so the specification must keep it. A
/// marker the *source* never reaches can be drawn at no window at all, including
/// a full-range export — an annotation that silently does not exist, which is
/// worse than one that is refused when it is set.
#[test]
fn a_marker_is_kept_outside_the_window_and_refused_outside_the_source() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(120.0, Some(label("inside"))).expect("a marker"),
        Marker::new(190.0, Some(label("outside"))).expect("a marker"),
    ])
    .expect("markers on a valid panel");

    let whole = svg::render(&figure_of(panel.clone()));
    assert!(whole.contains("inside") && whole.contains("outside"));

    let windowed = panel
        .with_visible_domain(domain(100.0, 150.0))
        .expect("a window inside the domain");
    let document = svg::render(&figure_of(windowed));
    assert!(document.contains("inside"));
    assert!(
        !document.contains("outside"),
        "a marker beyond the window is not placed at its edge",
    );

    // And one the source never reaches is refused when it is attached.
    assert_eq!(
        spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
        .with_markers(vec![
            Marker::new(900.0, Some(label("unreachable"))).expect("a marker"),
        ])
        .unwrap_err(),
        SpecError::MarkerOutsideFullDomain,
    );
}

/// An unreported unit is shown as nothing rather than as a guess.
#[test]
fn an_unreported_unit_is_not_displayed_as_one() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Retention time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 10.0),
        vec![series(vec![0.0, 10.0], vec![1.0, 2.0])],
    )
    .expect("a panel");
    let document = svg::render(&figure_of(panel));

    assert!(document.contains(">Retention time<"));
    assert!(!document.contains("Retention time ("), "no empty bracket");
    assert!(!document.contains("min"), "and no invented unit");
}

/// A panel refuses data that leaves its own declared range.
///
/// The alternative was to clamp at render time, which would have drawn a value
/// the measurement does not contain at a position it was never at. Refusing
/// here is what lets the renderer project without deciding anything.
#[test]
fn a_series_outside_the_declared_domain_is_refused() {
    let build = |full: Domain, values: Domain, x: Vec<f64>, y: Vec<f64>| {
        PanelSpec::new(
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Centroid,
            },
            AxisSpec::new(label("m/z"), UnitState::Dimensionless),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            full,
            values,
            vec![series(x, y)],
        )
    };

    assert_eq!(
        build(
            domain(100.0, 200.0),
            domain(0.0, 50.0),
            vec![100.0, 250.0],
            vec![10.0, 20.0],
        )
        .unwrap_err(),
        SpecError::PointOutsideDomain,
        "a point beyond the domain axis is refused",
    );
    assert_eq!(
        build(
            domain(100.0, 200.0),
            domain(0.0, 50.0),
            vec![100.0, 200.0],
            vec![10.0, 900.0],
        )
        .unwrap_err(),
        SpecError::PointOutsideDomain,
        "a value beyond the value range is refused",
    );
    // The exact bounds are inside.
    assert!(
        build(
            domain(100.0, 200.0),
            domain(0.0, 50.0),
            vec![100.0, 200.0],
            vec![0.0, 50.0],
        )
        .is_ok()
    );
}

/// A visible window draws what is in it, and nothing outside the frame.
///
/// The panel still carries its whole source -- that is what makes a full-range
/// export possible from the same specification -- so a renderer that projected
/// past the window's edges would place marks outside the plot area and outside
/// the `viewBox` entirely.
#[test]
fn a_visible_window_clips_rather_than_projecting_past_its_edges() {
    let x: Vec<f64> = (0..=10).map(|index| f64::from(index) * 100.0).collect();
    let y: Vec<f64> = (0..=10).map(|index| f64::from(index) * 10.0).collect();
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 1_000.0),
        domain(0.0, 100.0),
        vec![series(x, y)],
    )
    .expect("a panel")
    .with_visible_domain(domain(400.0, 600.0))
    .expect("a visible window");

    let figure = FigureSpec::new(
        FigureTheme::Light,
        FigureSize::new(900.0, 500.0).expect("a size"),
        vec![panel],
    )
    .expect("a figure");
    let document = svg::render(&figure);

    // Three of the eleven points fall inside [400, 600].
    assert_eq!(
        path_data(&document).matches('V').count(),
        3,
        "only the window is drawn",
    );

    // And every drawn coordinate is inside the figure, which is what a
    // projection past the edges would have broken.
    let drawn: Vec<f64> = document
        .split('M')
        .skip(1)
        .filter_map(|piece| piece.split(' ').next())
        .filter_map(|value| value.parse::<f64>().ok())
        .collect();
    assert!(!drawn.is_empty(), "the test read some coordinates");
    for value in drawn {
        assert!(
            (0.0..=900.0).contains(&value),
            "{value} is outside the figure",
        );
    }
}

/// A window that excludes a middle region breaks the trace rather than
/// bridging it.
#[test]
fn a_clipped_trace_does_not_join_across_the_excluded_region() {
    // A profile spectrum, so the renderer is allowed to join at all.
    let x: Vec<f64> = (0..=10).map(f64::from).collect();
    let y = vec![5.0; 11];
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Profile,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 10.0),
        vec![series(x, y)],
    )
    .expect("a panel");

    let whole = path_data(&svg::render(&figure_of(panel.clone())));
    // One subpath for eleven joined points.
    assert_eq!(whole.matches('M').count(), 1);
    assert_eq!(whole.matches('L').count(), 10);

    let windowed = panel
        .with_visible_domain(domain(2.0, 8.0))
        .expect("a window");
    let clipped = path_data(&svg::render(&figure_of(windowed)));
    // Still one subpath: the window excludes only the ends, not a middle.
    assert_eq!(clipped.matches('M').count(), 1);
    assert_eq!(
        clipped.matches('L').count(),
        6,
        "seven points inside the window are six joins",
    );
}

/// A decoded document is held to every rule, not only its version number.
///
/// `serde` builds these types field by field and never calls a constructor, so
/// without this a document could carry mismatched arrays, an inverted domain or
/// an empty label straight into a renderer that has been told those cannot
/// happen -- and `render` would zip the mismatched arrays and silently draw the
/// shorter one.
#[test]
fn decoding_revalidates_the_whole_figure_and_not_only_the_schema() {
    let valid = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    ))
    .to_json()
    .expect("encodes");
    assert!(
        FigureSpec::from_json(&valid).is_ok(),
        "a sound document decodes"
    );

    // Each of these is a rule a constructor enforces, broken in the document
    // rather than in the caller.
    let cases: [(&str, &str, SpecError); 4] = [
        (
            "mismatched arrays",
            r#""x":[100.0,200.0],"y":[10.0]"#,
            SpecError::AxisLengthMismatch,
        ),
        (
            "unordered domain axis",
            r#""x":[200.0,100.0],"y":[10.0,20.0]"#,
            SpecError::SourceNotOrdered,
        ),
        (
            "a point outside the declared domain",
            r#""x":[100.0,9000.0],"y":[10.0,20.0]"#,
            SpecError::PointOutsideDomain,
        ),
        (
            "a reduction smaller than its claimed source",
            r#""x":[100.0,200.0],"y":[10.0,20.0]"#,
            SpecError::AxisLengthMismatch,
        ),
    ];
    for (label, replacement, expected) in cases.into_iter().take(3) {
        let broken = valid.replace(r#""x":[100.0,200.0],"y":[10.0,20.0]"#, replacement);
        assert_ne!(broken, valid, "{label}: the test rewrote what it meant to");
        assert_eq!(
            FigureSpec::from_json(&broken).unwrap_err(),
            DecodeError::Spec(expected),
            "{label}",
        );
    }

    // And an empty label, which no constructor would have produced. Refused as
    // `Malformed` rather than as a `SpecError`, and the difference is the
    // taxonomy rather than an inconsistency: `Label` checks itself as it is
    // read, so an empty one never becomes a label at all. A `SpecError` is what
    // this boundary answers when the parts are each readable and disagree with
    // one another.
    let empty_label = valid.replace(r#""label":"m/z""#, r#""label":"""#);
    assert_ne!(empty_label, valid);
    assert_eq!(
        FigureSpec::from_json(&empty_label).unwrap_err(),
        DecodeError::Malformed,
    );

    // And an inverted domain.
    let inverted = valid.replace(
        r#""full_domain":{"low":100.0,"high":200.0}"#,
        r#""full_domain":{"low":900.0,"high":100.0}"#,
    );
    assert_ne!(inverted, valid);
    assert!(matches!(
        FigureSpec::from_json(&inverted),
        Err(DecodeError::Spec(_)),
    ));
}

/// A trace is clipped as segments, so a line crossing the window survives even
/// when neither of its samples is inside it.
///
/// The case that makes point-filtering wrong: a coarsely sampled chromatogram
/// against a narrow window has no sample in the window at all, and the line
/// still crosses the whole view.
#[test]
fn a_trace_crossing_the_window_survives_with_no_sample_inside_it() {
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Profile,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 100.0),
        vec![series(vec![0.0, 10.0], vec![0.0, 100.0])],
    )
    .expect("a panel")
    .with_visible_domain(domain(4.0, 6.0))
    .expect("a window with no sample in it");

    let path = path_data(&svg::render(&figure_of(panel)));

    assert!(!path.is_empty(), "the crossing line is drawn");
    assert_eq!(path.matches('M').count(), 1);
    assert_eq!(path.matches('L').count(), 1);

    // The interpolated ends are the boundary values of the segment the source
    // already asserts between its own neighbours -- 40 and 60 of 100 -- so the
    // drawn line spans the full plot height band rather than a fraction of it.
    // Read as y coordinates: the figure's y grows downward, so the start is
    // below the end.
    let ys: Vec<f64> = path
        .split(['M', 'L'])
        .filter(|piece| !piece.is_empty())
        .filter_map(|piece| piece.split_whitespace().nth(1))
        .filter_map(|value| value.parse::<f64>().ok())
        .collect();
    assert_eq!(ys.len(), 2, "two endpoints");
    assert!(ys[0] > ys[1], "the trace rises across the window");
}

/// Discrete marks are filtered rather than interpolated.
///
/// Interpolating a stick at the window edge would draw intensity at an m/z
/// nobody measured -- the same error joining centroid peaks makes.
#[test]
fn discrete_marks_are_never_interpolated_at_the_window_edge() {
    for representation in [
        SpectrumRepresentation::Centroid,
        SpectrumRepresentation::Unreported,
    ] {
        let panel = PanelSpec::new(
            PlotKind::Spectrum { representation },
            AxisSpec::new(label("m/z"), UnitState::Dimensionless),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 10.0),
            domain(0.0, 100.0),
            vec![series(vec![0.0, 10.0], vec![50.0, 100.0])],
        )
        .expect("a panel")
        .with_visible_domain(domain(4.0, 6.0))
        .expect("a window with no sample in it");

        let path = path_data(&svg::render(&figure_of(panel)));
        assert!(
            path.is_empty(),
            "{representation:?} invented a mark at the boundary: {path}",
        );
    }
}

/// The two reductions this repository performs are two rules, and say so.
///
/// The screen keeps the greatest non-negative and the deepest negative value of each
/// column, so an all-positive column keeps **one** value. Calling that min/max
/// would be false for every all-positive column, which is most of them -- and
/// the sentence goes into the exported figure, so the figure would be asserting
/// it.
#[test]
fn the_two_reduction_rules_describe_themselves_differently() {
    assert_ne!(
        ReductionRule::MinMaxPerColumn.describe(),
        ReductionRule::ExtremePerSignPerColumn.describe(),
    );

    let rendered = |rule: ReductionRule| {
        let reduced = SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::Reduced {
                source_point_count: 900,
                rule,
            },
            vec![100.0, 200.0],
            vec![10.0, 20.0],
        )
        .expect("a reduction");
        svg::render(&figure_of(spectrum_panel(
            SpectrumRepresentation::Centroid,
            reduced,
        )))
    };

    let min_max = rendered(ReductionRule::MinMaxPerColumn);
    let per_sign = rendered(ReductionRule::ExtremePerSignPerColumn);
    assert!(min_max.contains("greatest and the least value"));
    assert!(per_sign.contains("greatest non-negative and the deepest negative"));
    assert!(
        !per_sign.contains("greatest and the least value"),
        "a stick reduction must not describe itself as min/max",
    );
    // The boundary is `>= 0`, so a column of measured zeros keeps a zero.
    // Calling that the tallest *positive* value asserts a positive signal the
    // column does not contain, in the one sentence both renderers share.
    assert!(
        !per_sign.contains("positive"),
        "zero is kept by this rule and zero is not positive",
    );
}

/// An author's caption is added to the disclosures, never in place of them.
///
/// The disclosures are where a reduction states its counts and where an
/// unreported representation says so. A caption that replaced them would let a
/// custom-titled export read as scientifically complete while dropping the two
/// facts a reader most needs.
#[test]
fn a_caption_does_not_displace_the_semantic_disclosures() {
    let reduced = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 40_000,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![100.0, 200.0],
        vec![10.0, 20.0],
    )
    .expect("a reduction");
    let figure = figure_of(spectrum_panel(SpectrumRepresentation::Unreported, reduced))
        .with_caption(Caption::new("Figure 1. Replicate A.").expect("a caption"));

    let document = svg::render(&figure);
    assert!(
        document.contains("Figure 1. Replicate A."),
        "the caption is kept"
    );
    assert!(
        document.contains("does not report whether"),
        "and the representation disclosure survives it",
    );
    assert!(
        document.contains("40000 source points reduced to 2"),
        "and so does the reduction disclosure",
    );
}

/// A single-sample trace draws something.
///
/// A bare move command paints nothing, so this scene rendered a blank plot area
/// for data the contract explicitly accepts.
#[test]
fn a_single_sample_trace_draws_a_visible_mark() {
    for kind in [
        PlotKind::Chromatogram,
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Profile,
        },
    ] {
        let panel = PanelSpec::new(
            kind,
            AxisSpec::new(label("x"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(500.0, 500.0),
            domain(0.0, 100.0),
            vec![series(vec![500.0], vec![70.0])],
        )
        .expect("a panel");

        let path = path_data(&svg::render(&figure_of(panel)));
        assert!(!path.is_empty(), "{kind:?} drew nothing");
        assert!(
            path.contains('L'),
            "{kind:?} emitted only a move, which paints nothing: {path}",
        );
    }
}

/// A figure too small to draw into is refused rather than drawn upside down.
///
/// The renderer subtracts fixed gutters, so below some size the plotting area
/// runs backwards and values are projected in reverse. The contract states a
/// floor; the assertion below pins that this repository's renderer fits inside
/// it, so a future margin change fails here rather than inverting a figure.
#[test]
fn a_figure_too_small_for_its_panels_is_refused() {
    assert_eq!(
        FigureSize::new(100.0, 100.0).unwrap_err(),
        SpecError::FigureSizeOutOfRange,
        "a figure narrower than the floor is refused",
    );

    let panel = || {
        spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
    };
    // One panel fits; eight in the same height do not.
    let one_panel_height = MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT;
    let size = FigureSize::new(MIN_FIGURE_WIDTH, one_panel_height).expect("a size");
    assert!(FigureSpec::new(FigureTheme::Light, size, vec![panel()]).is_ok());
    assert_eq!(
        FigureSpec::new(FigureTheme::Light, size, (0..8).map(|_| panel()).collect()).unwrap_err(),
        SpecError::FigureTooSmallForPanels,
    );

    // And the smallest accepted figure still renders a plotting area the right
    // way up, which is the property the floor exists for.
    let smallest = FigureSpec::new(
        FigureTheme::Light,
        FigureSize::new(MIN_FIGURE_WIDTH, one_panel_height).expect("a size"),
        vec![panel()],
    )
    .expect("a figure");
    let document = svg::render(&smallest);
    let path = path_data(&document);
    assert!(!path.is_empty(), "the smallest figure still draws its data");
    for value in path
        .split(['M', 'L', 'V'])
        .filter(|piece| !piece.is_empty())
        .flat_map(|piece| piece.split_whitespace())
        .filter_map(|value| value.parse::<f64>().ok())
    {
        assert!(
            value.is_finite() && (-1.0..=MIN_FIGURE_WIDTH + 1.0).contains(&value),
            "{value} left the smallest figure",
        );
    }
}

/// A stick plot's value range must contain the line its sticks rise from.
///
/// A stick encodes its magnitude as a length from zero. Against a range that
/// never reaches zero the baseline is pinned to an edge, so the smallest value
/// draws a zero-length mark and disappears, and every other mark encodes its
/// distance from the range end instead. The figure still looks like a figure,
/// which is what makes it dangerous.
#[test]
fn a_panel_drawn_from_the_zero_line_must_contain_zero() {
    let discrete = [
        SpectrumRepresentation::Centroid,
        SpectrumRepresentation::Unreported,
    ];
    for representation in discrete {
        let build = |low: f64, high: f64| {
            PanelSpec::new(
                PlotKind::Spectrum { representation },
                AxisSpec::new(label("m/z"), UnitState::Dimensionless),
                AxisSpec::new(label("Intensity"), UnitState::Unreported),
                domain(100.0, 200.0),
                domain(low, high),
                vec![series(vec![120.0, 180.0], vec![high, high])],
            )
        };
        assert_eq!(
            build(500.0, 9_000.0).unwrap_err(),
            SpecError::BaselineOutsideValueDomain,
            "{representation:?}: a strictly positive range has no baseline",
        );
        assert!(
            build(0.0, 9_000.0).is_ok(),
            "{representation:?}: zero in it"
        );
    }

    // A strictly negative range is the same defect arrived at from below.
    assert_eq!(
        PanelSpec::new(
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Centroid,
            },
            AxisSpec::new(label("m/z"), UnitState::Dimensionless),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(100.0, 200.0),
            domain(-900.0, -10.0),
            vec![series(vec![120.0, 180.0], vec![-10.0, -10.0])],
        )
        .unwrap_err(),
        SpecError::BaselineOutsideValueDomain,
    );

    // A trace carries no such promise: it is a shape over the axis, and a value
    // range excluding zero merely zooms it. Refusing this would refuse a
    // legitimate chromatogram view.
    assert!(
        PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(label("Time"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 30.0),
            domain(500.0, 9_000.0),
            vec![series(vec![1.0, 2.0], vec![600.0, 800.0])],
        )
        .is_ok(),
    );
}

/// The negative-value disclosure counts what was drawn, not what was carried.
///
/// A panel narrowed to a visible window still holds its whole series, so a
/// description counting the source would tell a reader to look below the zero
/// line for marks that are not in the file they are holding.
#[test]
fn the_negative_disclosure_counts_only_the_drawn_window() {
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 400.0),
        domain(-50.0, 900.0),
        vec![series(
            vec![110.0, 120.0, 300.0, 320.0],
            vec![-50.0, -20.0, 700.0, 900.0],
        )],
    )
    .expect("a panel");

    let whole = svg::render(&figure_of(panel.clone()));
    assert!(
        whole.contains("2 of the drawn values are negative"),
        "both negatives are drawn when the whole domain is",
    );

    let windowed = panel
        .with_visible_domain(domain(250.0, 400.0))
        .expect("a window inside the domain");
    let document = svg::render(&figure_of(windowed));
    assert!(
        !document.contains("are negative and are shown below the zero line"),
        "no negative is inside the window, so the figure must not claim one: {document}",
    );
}

/// Axis ends take their precision from the span, not from their magnitude.
///
/// A visible m/z window of 1000.1 to 1000.4 is a real selection. Rounded by
/// magnitude, both ends printed `1000`, so the exported axis claimed zero width
/// and concealed the range the user had chosen.
#[test]
fn axis_ends_keep_enough_precision_to_stay_apart() {
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(1_000.0, 1_001.0),
        domain(0.0, 900.0),
        vec![series(vec![1_000.2, 1_000.3], vec![700.0, 900.0])],
    )
    .expect("a panel")
    .with_visible_domain(domain(1_000.1, 1_000.4))
    .expect("a window inside the domain");

    let document = svg::render(&figure_of(panel));
    assert!(document.contains(">1000.100<"), "the low end: {document}");
    assert!(document.contains(">1000.400<"), "the high end: {document}");

    // And a wide axis gains no false precision from the same rule.
    let wide = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![200.0, 2_000.0], vec![10.0, 20.0]),
    )));
    assert!(wide.contains(">200<"), "a wide axis stays whole: {wide}");
    assert!(wide.contains(">2000<"), "at both ends: {wide}");
}

/// A trace that reaches the window always draws something.
///
/// Three shapes the contract accepts arrive at the same place -- every segment
/// clips down to a point -- and a path of bare move commands paints nothing,
/// which reads as *no data*.
#[test]
fn a_trace_reaching_the_window_is_never_drawn_blank() {
    let trace = |x: Vec<f64>, y: Vec<f64>, window: Option<(f64, f64)>| {
        let x_low = x.iter().copied().fold(f64::INFINITY, f64::min);
        let x_high = x.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let panel = PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(label("Time"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(x_low, x_high),
            domain(0.0, 100.0),
            vec![series(x, y)],
        )
        .expect("a panel");
        let panel = match window {
            Some((low, high)) => panel
                .with_visible_domain(domain(low, high))
                .expect("a window inside the domain"),
            None => panel,
        };
        path_data(&svg::render(&figure_of(panel)))
    };

    // A zero-width window: the crossing segment clips to a single point.
    let pinhole = trace(vec![0.0, 10.0], vec![20.0, 80.0], Some((4.0, 4.0)));
    assert!(
        pinhole.contains('L'),
        "a segment crossing a zero-width window must still mark it: {pinhole}",
    );

    // Repeated samples at one position: no segment has any length.
    let repeated = trace(vec![5.0, 5.0, 5.0], vec![40.0, 40.0, 40.0], None);
    assert!(
        repeated.contains('L'),
        "repeated samples must still draw: {repeated}",
    );

    // And the single-sample case the same fallback now also serves.
    let lone = trace(vec![7.0], vec![55.0], None);
    assert!(lone.contains('L'), "one sample must still draw: {lone}");

    // The fallback is a last resort, not a shortcut: a window a trace really
    // crosses is still drawn as the crossing rather than as one tick.
    let crossing = trace(
        vec![0.0, 1.0, 2.0],
        vec![10.0, 20.0, 30.0],
        Some((0.5, 1.5)),
    );
    assert_eq!(
        crossing.matches('L').count(),
        2,
        "two clipped segments, not one fallback mark: {crossing}",
    );
}

/// An unreported unit reaches the reader, because the caption cannot carry it.
///
/// Both unreported and dimensionless axes are captioned with the bare label --
/// printing an empty bracket or a guess would display a fact the file never
/// carried -- so if the description does not state the difference, the export
/// does not carry it at all, and the contract's third state dies at the file
/// boundary it exists to survive.
#[test]
fn an_unreported_unit_is_disclosed_and_a_dimensionless_one_is_not() {
    let panel = |x_unit: UnitState, y_unit: UnitState| {
        PanelSpec::new(
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Centroid,
            },
            AxisSpec::new(label("m/z"), x_unit),
            AxisSpec::new(label("Intensity"), y_unit),
            domain(100.0, 200.0),
            domain(0.0, 900.0),
            vec![series(vec![120.0, 180.0], vec![700.0, 900.0])],
        )
        .expect("a panel")
    };

    let neither = svg::render(&figure_of(panel(
        UnitState::Dimensionless,
        UnitState::Known {
            unit: label("counts"),
        },
    )));
    assert!(
        !neither.contains("reports no unit"),
        "a dimensionless axis is not an unreported one: {neither}",
    );

    let one = svg::render(&figure_of(panel(
        UnitState::Dimensionless,
        UnitState::Unreported,
    )));
    assert!(
        one.contains("The source file reports no unit for the Intensity axis"),
        "the unreported axis is named: {one}",
    );

    let both = svg::render(&figure_of(panel(
        UnitState::Unreported,
        UnitState::Unreported,
    )));
    assert!(
        both.contains("no unit for the m/z or the Intensity axis"),
        "both unreported axes are named: {both}",
    );

    // And the caption itself still carries no bracket for either state, which is
    // the reason the sentence above has to exist.
    assert!(
        !both.contains("m/z ("),
        "no invented unit reaches the caption"
    );
}

/// A zoomed value axis prints its lower end rather than reading as zero-based.
///
/// A trace may be zoomed to a range excluding zero. The horizontal line then
/// sits at the bottom edge exactly where a zero line would, so an unlabelled
/// lower end makes every height on the figure read as larger than it is.
#[test]
fn a_value_axis_prints_a_lower_end_that_is_not_zero() {
    let zoomed = svg::render(&figure_of(
        PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(label("Time"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 30.0),
            domain(500.0, 9_000.0),
            vec![series(vec![1.0, 2.0], vec![600.0, 8_000.0])],
        )
        .expect("a zoomed trace"),
    ));
    assert!(
        zoomed.contains(">500<"),
        "the zoomed floor is shown: {zoomed}"
    );

    // A range that reaches zero says nothing extra: the line is the zero line.
    let grounded = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )));
    assert!(
        !grounded.contains(">0<"),
        "a zero floor needs no label: {grounded}",
    );
}

/// A domain whose ends are finite but whose width is not is refused.
///
/// `f64::MAX - (-f64::MAX)` is infinity, and a renderer dividing by that span
/// computes `inf / inf` and writes `NaN` into the document — breaking the
/// promise this module makes that a non-finite number cannot reach a figure.
/// Two finite checks are not one finite domain.
#[test]
fn a_domain_wider_than_a_finite_number_is_refused() {
    assert_eq!(
        Domain::new(-f64::MAX, f64::MAX).unwrap_err(),
        SpecError::DomainSpanNotFinite,
    );
    assert_eq!(
        Domain::new(-1.0e308, 1.0e308).unwrap_err(),
        SpecError::DomainSpanNotFinite,
    );
    // The bound is on the width, not on the magnitude: a huge but finite span
    // is still a span, and refusing it would be this boundary inventing a limit
    // no measurement asked for.
    assert!(Domain::new(0.0, f64::MAX).is_ok());

    // And the rule reaches a decoded document, not only a constructed one.
    let document = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    ))
    .to_json()
    .expect("a figure serializes");
    let widened = document
        .replace("\"low\":100.0", "\"low\":-1.7976931348623157e308")
        .replace("\"high\":200.0", "\"high\":1.7976931348623157e308");
    assert_ne!(widened, document, "the probe edited something");
    assert!(
        matches!(
            FigureSpec::from_json(&widened),
            Err(DecodeError::Spec(SpecError::DomainSpanNotFinite)),
        ),
        "a decoded overflowing domain must be refused too",
    );
}

/// A validated figure cannot be edited into an invalid one from outside.
///
/// The contract's claim is that invalid states are unrepresentable, not that
/// they are checked once. Public fields would have made that claim false: a
/// marker mutated to `NaN` after construction reaches `render`, where both
/// domain comparisons are false for `NaN`, and `NaN` is written into the
/// document as a coordinate.
///
/// Rust has no runtime test for "this does not compile", so this test pins the
/// two halves that are testable — the checked path refuses the value, and the
/// only way to obtain a `Marker` is that path — and the sealing itself is
/// carried by the field visibility beside it.
#[test]
fn a_marker_position_can_only_be_set_through_the_check() {
    assert_eq!(
        Marker::new(f64::NAN, None).unwrap_err(),
        SpecError::NotFinite,
    );
    assert_eq!(
        Marker::new(f64::INFINITY, Some(label("edge"))).unwrap_err(),
        SpecError::NotFinite,
    );

    // Reading is public; writing is not. Every accessor a downstream reader
    // needs exists, so sealing the fields costs no legitimate use.
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, Some(label("peak"))).expect("a marker"),
    ])
    .expect("markers on a valid panel");
    let figure = figure_of(panel);
    let read = figure.panels()[0].markers()[0].at();
    assert!((read - 150.0).abs() < f64::EPSILON);
    assert_eq!(
        figure.panels()[0].markers()[0].label().map(Label::as_str),
        Some("peak"),
    );
    assert_eq!(figure.panels()[0].kind(), figure.panels()[0].kind());
    assert_eq!(figure.schema_version(), SCHEMA_VERSION);
    assert!(figure.title().is_none() && figure.caption().is_none());
    assert_eq!(
        figure.panels()[0].series()[0].scope(),
        DataScope::FullSource
    );
}

/// A trace drawn below the zero line says so, even with no negative sample.
///
/// Clipping interpolates at the window edge, so a segment entering from a
/// negative sample outside the window is drawn below zero while every measured
/// value inside it is positive. Counting the interpolated point among the
/// negatives would put a number in the description matching no row in any
/// source file, so it gets its own sentence.
#[test]
fn a_trace_crossing_into_the_window_from_below_zero_is_disclosed() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(-10.0, 10.0),
        vec![series(vec![0.0, 10.0], vec![-10.0, 10.0])],
    )
    .expect("a panel")
    .with_visible_domain(domain(1.0, 10.0))
    .expect("a window inside the domain");

    let document = svg::render(&figure_of(panel));
    assert!(
        !document.contains("of the drawn values are negative"),
        "no measured value inside the window is negative: {document}",
    );
    assert!(
        document.contains("Part of the drawn trace lies below the zero line"),
        "but part of the drawing is below it: {document}",
    );

    // And a baseline inside a panel of sticks: it is joined and clipped like
    // any trace, so it crosses below zero in exactly the same way -- which a
    // disclosure asking only about the panel kind could not see.
    let with_baseline = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(-10.0, 10.0),
        vec![
            series(vec![2.0, 8.0], vec![4.0, 6.0]),
            SeriesSpec::new(
                label("baseline"),
                StyleRole::Baseline,
                DataScope::FullSource,
                vec![0.0, 10.0],
                vec![-10.0, 10.0],
            )
            .expect("a baseline"),
        ],
    )
    .expect("a panel")
    .with_visible_domain(domain(1.0, 10.0))
    .expect("a window inside the domain");
    let drawn_baseline = svg::render(&figure_of(with_baseline));
    assert!(
        !drawn_baseline.contains("of the drawn values are negative"),
        "no measured value inside the window is negative: {drawn_baseline}",
    );
    assert!(
        drawn_baseline.contains("Part of the drawn trace lies below the zero line"),
        "but the joined baseline is below it: {drawn_baseline}",
    );

    // A discrete panel never interpolates, so it must not gain the sentence.
    let sticks = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(-10.0, 10.0),
        vec![series(vec![0.0, 10.0], vec![-10.0, 10.0])],
    )
    .expect("a panel")
    .with_visible_domain(domain(1.0, 10.0))
    .expect("a window inside the domain");
    let drawn = svg::render(&figure_of(sticks));
    assert!(
        !drawn.contains("below the zero line"),
        "a stick plot draws nothing between its marks: {drawn}",
    );
}

/// Every marker label lies inside the document, whatever its length.
///
/// An exported figure has no viewport to scroll, so a label placed past the
/// document edge is not clipped — it is absent — while the marker's line still
/// draws and the figure still looks finished.
///
/// Two failures, and the second is why choosing a side is not enough on its own:
/// a label to the right of a marker at the domain's high end runs off the page,
/// and a label longer than the page fits on neither side of anything.
#[test]
fn every_marker_label_lies_inside_the_document() {
    /// The same estimate the renderer uses: 0.6em at 11 units.
    const CHARACTER: f64 = 6.6;

    // Every `<tspan>` of every label, as (x, character count).
    fn placed(document: &str) -> Vec<(f64, usize)> {
        document
            .split("<tspan x=\"")
            .skip(1)
            .filter_map(|piece| {
                let (x, rest) = piece.split_once('"')?;
                let text = rest.split_once('>')?.1.split_once("</tspan>")?.0;
                Some((x.parse::<f64>().ok()?, text.chars().count()))
            })
            .collect()
    }

    let marked = |width: f64, text: &str| {
        let panel = spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
        .with_markers(vec![
            Marker::new(200.0, Some(label(text))).expect("a marker"),
            Marker::new(100.0, Some(label("start"))).expect("a marker"),
        ])
        .expect("markers on a valid panel");
        FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(width, 500.0).expect("a size"),
            vec![panel],
        )
        .expect("one panel is a figure")
    };

    // An ordinary figure with a long-ish label, and the smallest figure the
    // contract accepts carrying the longest label it accepts.
    for (width, text) in [
        (900.0, "precursor selection window".to_owned()),
        (MIN_FIGURE_WIDTH, "m".repeat(MAX_LABEL_CHARS)),
        (MIN_FIGURE_WIDTH, "precursor selection window".to_owned()),
    ] {
        let document = svg::render(&marked(width, &text));
        let lines = placed(&document);
        assert!(!lines.is_empty(), "labels are drawn at {width}");
        for (x, characters) in lines {
            assert!(
                x >= 0.0,
                "a label started off the left edge at {width}: {x}"
            );
            assert!(
                x + characters as f64 * CHARACTER <= width,
                "a label ran off the right edge at {width}: {x} + {characters} characters",
            );
        }
        let rejoined: String = document
            .split("<tspan")
            .skip(1)
            .filter_map(|piece| {
                piece
                    .split_once('>')?
                    .1
                    .split_once("</tspan>")
                    .map(|cut| cut.0)
            })
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            rejoined.contains(&text) || rejoined.replace(' ', "").contains(&text.replace(' ', "")),
            "wrapping keeps every character of the label: {rejoined}",
        );
    }
}

/// A domain too narrow for the readable precision still shows two numbers.
///
/// The span rule caps at six decimals for readability. A window of
/// `1000.0000001 .. 1000.0000004` is narrower than that and is a real
/// selection, so both ends printing `1000.000000` would claim a zero-width axis
/// — the same misstatement the span rule exists to prevent, reached from the
/// other side.
#[test]
fn a_domain_narrower_than_the_readable_precision_still_resolves() {
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(1_000.0, 1_001.0),
        domain(0.0, 900.0),
        vec![series(vec![1_000.000_000_2], vec![700.0])],
    )
    .expect("a panel")
    .with_visible_domain(domain(1_000.000_000_1, 1_000.000_000_4))
    .expect("a window inside the domain");

    let document = svg::render(&figure_of(panel));
    assert!(
        document.contains(">1000.0000001<") && document.contains(">1000.0000004<"),
        "both ends resolve: {document}",
    );

    // A single-valued domain is not a precision failure: its ends *are* the
    // same number, and escalating would print digits it does not hold.
    let flat = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![500.0], vec![10.0]),
    )));
    assert_eq!(
        flat.matches(">500.000000<").count(),
        2,
        "one value, printed the same at both ends: {flat}",
    );
}

/// Two distinct samples are interpolated between, however close they are.
///
/// `f64::EPSILON` is an absolute quantity, so testing a coordinate difference
/// against it collapses distinct samples whose values happen to be small — and
/// the ratio a clip computes is in `0..=1` for any distinct pair, so there was
/// nothing to guard against but a true division by zero.
#[test]
fn a_narrow_pair_of_samples_is_interpolated_rather_than_collapsed() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 1.0e-20),
        domain(-1.0, 1.0),
        vec![series(vec![0.0, 1.0e-20], vec![-1.0, 1.0])],
    )
    .expect("a panel")
    .with_visible_domain(domain(2.5e-21, 7.5e-21))
    .expect("a window inside the domain");

    // The window covers a quarter to three quarters of the segment, so the
    // clipped trace runs from -0.5 to 0.5: it crosses the zero line, and a
    // collapsed one would be flat at -1.
    let document = svg::render(&figure_of(panel));
    let path = path_data(&document);
    let ys: Vec<f64> = path
        .split(['M', 'L'])
        .filter(|piece| !piece.is_empty())
        .filter_map(|piece| piece.split_whitespace().nth(1)?.parse::<f64>().ok())
        .collect();
    assert_eq!(ys.len(), 2, "one clipped segment: {path}");
    assert!(
        (ys[0] - ys[1]).abs() > 1.0,
        "the clipped segment rises across the window rather than lying flat: {path}",
    );
    assert!(
        document.contains("Part of the drawn trace lies below the zero line"),
        "and the half below zero is disclosed: {document}",
    );
}

/// An axis too small for any decimal place still shows two numbers.
///
/// Seventeen *decimal places* is not seventeen significant digits: a domain of
/// `1e-20 .. 4e-20` exhausts every place and prints `0.000…` at both ends, so
/// fixed point alone cannot state a range at that magnitude. The pair falls
/// back to exponent notation rather than claiming a zero-width axis.
#[test]
fn an_axis_below_every_decimal_place_falls_back_to_exponents() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(1.0e-20, 4.0e-20),
        domain(0.0, 100.0),
        vec![series(vec![1.0e-20, 4.0e-20], vec![10.0, 90.0])],
    )
    .expect("a panel");

    let document = svg::render(&figure_of(panel));
    assert!(document.contains(">1e-20<"), "the low end: {document}");
    assert!(document.contains(">4e-20<"), "the high end: {document}");

    // The fallback triggers on the strings colliding, not on a magnitude
    // threshold, so an ordinary axis is untouched by it.
    let ordinary = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![200.0, 2_000.0], vec![10.0, 20.0]),
    )));
    assert!(ordinary.contains(">200<") && ordinary.contains(">2000<"));
    assert!(!ordinary.contains("e2"), "no exponent for a plain axis");
}

/// A windowed reduction reports the reduction and what the window shows.
///
/// The reduction ratio is what lets a reader judge the figure; the count inside
/// the window is what they can count on it. Reporting the reduction's size as
/// the number drawn made the disclosure disagree with the drawing whenever a
/// window was narrower than the source.
#[test]
fn a_windowed_reduction_reports_both_counts() {
    let reduced = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 500,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![100.0, 110.0, 300.0, 310.0, 320.0],
        vec![10.0, 20.0, 30.0, 40.0, 50.0],
    )
    .expect("a reduction");
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 320.0),
        domain(0.0, 50.0),
        vec![reduced],
    )
    .expect("a panel");

    let whole = svg::render(&figure_of(panel.clone()));
    assert!(
        whole.contains("&quot;measurement&quot; is drawn from 500 source points reduced to 5"),
        "an unwindowed reduction reads as before: {whole}",
    );

    let windowed = svg::render(&figure_of(
        panel
            .with_visible_domain(domain(250.0, 320.0))
            .expect("a window inside the domain"),
    ));
    assert!(
        windowed.contains("&quot;measurement&quot; is reduced from 500 source points to 5"),
        "the reduction ratio survives: {windowed}",
    );
    assert!(
        windowed.contains("3 of them lie inside the range shown"),
        "and the drawn count is stated: {windowed}",
    );
    assert!(
        !windowed.contains("&quot;measurement&quot; is drawn from 500 source points reduced to 5"),
        "the sentence that disagreed with the drawing is gone: {windowed}",
    );
}

/// A marker label at the left edge does not land on the value-axis maximum.
///
/// Both are drawn at the same size a unit apart, so the pair was unreadable —
/// and it costs the axis maximum, which no annotation should be able to do.
#[test]
fn a_marker_label_does_not_land_on_the_value_axis_maximum() {
    fn baseline(document: &str, needle: &str) -> f64 {
        let line = document
            .lines()
            .find(|line| line.contains(needle))
            .unwrap_or_else(|| panic!("{needle} is drawn"));
        let after = line.split("y=\"").nth(1).expect("a y attribute");
        after
            .split('"')
            .next()
            .expect("a y value")
            .parse()
            .expect("a number")
    }

    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(100.0, Some(label("injection"))).expect("a marker"),
        Marker::new(150.0, Some(label("midpoint"))).expect("a marker"),
    ])
    .expect("markers on a valid panel");

    let document = svg::render(&figure_of(panel));
    let axis_maximum = baseline(&document, ">20.0<");
    let at_edge = baseline(&document, ">injection<");
    let clear = baseline(&document, ">midpoint<");

    assert!(
        (at_edge - axis_maximum).abs() >= 11.0,
        "the edge marker clears the axis maximum: {at_edge} vs {axis_maximum}",
    );
    assert!(
        (clear - axis_maximum).abs() < 11.0,
        "a marker with room keeps its natural place: {clear} vs {axis_maximum}",
    );
}

/// A joined trace refuses a reduction that keeps one extreme per sign.
///
/// `ExtremePerSignPerColumn` keeps a single value for an all-positive column —
/// the tallest — and joining those across columns draws the upper envelope of
/// the data rather than the data. Every trough is gone and the trace sits above
/// the measurement, and nothing in the output says so, because each drawn point
/// is real.
#[test]
fn a_joined_trace_refuses_a_per_sign_reduction() {
    let reduced = |rule: ReductionRule| {
        SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::Reduced {
                source_point_count: 900,
                rule,
            },
            vec![1.0, 2.0],
            vec![10.0, 20.0],
        )
        .expect("a reduction")
    };
    let panel = |kind: PlotKind, rule: ReductionRule| {
        PanelSpec::new(
            kind,
            AxisSpec::new(label("x"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(1.0, 2.0),
            domain(0.0, 20.0),
            vec![reduced(rule)],
        )
    };

    for kind in [
        PlotKind::Chromatogram,
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Profile,
        },
    ] {
        assert!(kind.joins_a_trace(), "{kind:?} is a trace");
        assert_eq!(
            panel(kind, ReductionRule::ExtremePerSignPerColumn).unwrap_err(),
            SpecError::ReductionRuleUnsuitableForTrace,
        );
        assert!(panel(kind, ReductionRule::MinMaxPerColumn).is_ok());
    }

    // A baseline is joined whatever the panel draws, so it is held to the same
    // rule inside a panel of sticks -- which a check that read only the panel
    // kind could not see.
    let baseline = |rule: ReductionRule| {
        PanelSpec::new(
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Centroid,
            },
            AxisSpec::new(label("m/z"), UnitState::Dimensionless),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(1.0, 2.0),
            domain(0.0, 20.0),
            vec![
                SeriesSpec::new(
                    label("baseline"),
                    StyleRole::Baseline,
                    DataScope::Reduced {
                        source_point_count: 900,
                        rule,
                    },
                    vec![1.0, 2.0],
                    vec![10.0, 20.0],
                )
                .expect("a reduction"),
            ],
        )
    };
    assert_eq!(
        baseline(ReductionRule::ExtremePerSignPerColumn).unwrap_err(),
        SpecError::ReductionRuleUnsuitableForTrace,
    );
    assert!(baseline(ReductionRule::MinMaxPerColumn).is_ok());

    // Only in that direction: two sticks in a column is not a misdrawing, so a
    // discrete panel accepts either rule for a measurement.
    for representation in [
        SpectrumRepresentation::Centroid,
        SpectrumRepresentation::Unreported,
    ] {
        let kind = PlotKind::Spectrum { representation };
        assert!(!kind.joins_a_trace());
        assert!(panel(kind, ReductionRule::ExtremePerSignPerColumn).is_ok());
        assert!(panel(kind, ReductionRule::MinMaxPerColumn).is_ok());
    }
}

/// Every laid-out string declares the width it is laid out in.
///
/// The document embeds no font, so the face is the viewer's choice and a
/// per-character estimate is a prediction about someone else's machine. An
/// explicit `textLength` turns it into an instruction, and the width it carries
/// comes from an upper bound on a glyph rather than an average of one — so a
/// line of `W`s cannot overflow what was reserved for it.
#[test]
fn laid_out_text_declares_its_own_width() {
    let long = "W".repeat(MAX_LABEL_CHARS);
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label(&long), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 200.0),
        domain(0.0, 20.0),
        vec![series(vec![100.0, 200.0], vec![10.0, 20.0])],
    )
    .expect("a panel")
    .with_markers(vec![
        Marker::new(200.0, Some(label(&long))).expect("a marker"),
    ])
    .expect("markers on a valid panel");

    let width = MIN_FIGURE_WIDTH;
    let height = 500.0;
    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(width, height).expect("a size"),
            vec![panel],
        )
        .expect("one panel is a figure"),
    );

    // Every declared width fits the document, and the axis caption — which is
    // centred rather than wrapped — is condensed into the space it has rather
    // than running off both sides of it.
    let declared: Vec<f64> = document
        .split("textLength=\"")
        .skip(1)
        .filter_map(|piece| piece.split('"').next()?.parse::<f64>().ok())
        .collect();
    assert!(
        declared.len() >= 3,
        "both captions and the label: {declared:?}"
    );
    for reserved in declared {
        assert!(
            reserved > 0.0 && reserved <= width,
            "a declared width left the document: {reserved} of {width}",
        );
    }
    assert!(
        document.contains("lengthAdjust=\"spacingAndGlyphs\""),
        "the width is honoured by condensing rather than by clipping",
    );

    // And a caption short enough to fit keeps its natural width rather than
    // being stretched across the axis.
    let ordinary = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )));
    assert!(
        ordinary.contains("textLength=\"36.000\""),
        "\"m/z\" is three characters at 12 units: {ordinary}",
    );
}

/// A character XML cannot carry is refused before it can break the document.
///
/// `U+FFFE` and `U+FFFF` are `char`s, are not control characters, and are
/// outside XML 1.0's `Char` production. Escaping does nothing for them — they
/// are not markup — so they would be written straight into a document no XML
/// parser will read: the figure would not open at all, rather than opening
/// wrongly.
#[test]
fn a_character_xml_cannot_carry_is_refused() {
    for forbidden in ['\u{FFFE}', '\u{FFFF}'] {
        assert_eq!(
            Label::new(format!("m/z{forbidden}")).unwrap_err(),
            SpecError::LabelNotXmlSafe,
            "{forbidden:?} in a label",
        );
        assert_eq!(
            Caption::new(format!("Figure 1.{forbidden}")).unwrap_err(),
            SpecError::LabelNotXmlSafe,
            "{forbidden:?} in a caption",
        );
    }

    // The neighbours on either side are ordinary text and stay accepted, so the
    // rule is the XML production rather than a swipe at high code points.
    assert!(Label::new("\u{FFFD} replacement").is_ok());
    assert!(Label::new("\u{10000} beyond the plane").is_ok());
    assert!(Label::new("μ 数据 émile").is_ok());
}

/// The visible title is laid out inside the document like every other string.
///
/// The `<title>` element carries the same words to a screen reader either way,
/// but a published figure is read by looking at it, and metadata is no
/// substitute for the heading a reader can see.
#[test]
fn the_visible_title_is_laid_out_inside_the_document() {
    let width = MIN_FIGURE_WIDTH;
    let render_titled = |title: &str, width: f64| {
        svg::render(
            &FigureSpec::new(
                FigureTheme::Light,
                FigureSize::new(width, 500.0).expect("a size"),
                vec![spectrum_panel(
                    SpectrumRepresentation::Centroid,
                    series(vec![100.0, 200.0], vec![10.0, 20.0]),
                )],
            )
            .expect("one panel is a figure")
            .with_title(Label::new(title).expect("a title")),
        )
    };
    let declared_width = |document: &str| -> Option<f64> {
        document
            .lines()
            .find(|line| line.contains("font-weight="))?
            .split("textLength=\"")
            .nth(1)?
            .split('"')
            .next()?
            .parse()
            .ok()
    };

    // A heading that fits is drawn, uncondensed, inside the document.
    let document = render_titled("Enolase digest, 30 minute gradient", 900.0);
    let declared = declared_width(&document).expect("the visible title is drawn");
    assert!(
        declared > 0.0 && 64.0 + declared <= 900.0,
        "the title ends inside the document: 64 + {declared} of 900",
    );

    // On the narrowest figure the contract accepts, the same heading has no
    // room at any readable size, so it is shrunk only as far as the floor and
    // then reported rather than squeezed.
    let narrow = render_titled("Enolase digest, 30 minute gradient", width);
    assert!(
        declared_width(&narrow).is_none(),
        "a 34-character heading does not fit 116 units legibly: {narrow}",
    );

    // A heading too long for the figure to print legibly is not drawn as a
    // heading at all. `lengthAdjust="spacingAndGlyphs"` would have squeezed
    // 120 characters into 116 units -- under one unit a glyph at font-size 16,
    // inside its declared box and completely unreadable.
    let long = "W".repeat(MAX_LABEL_CHARS);
    let cramped = render_titled(&long, width);
    assert!(
        declared_width(&cramped).is_none(),
        "no illegible heading is drawn: {cramped}",
    );
    assert!(
        description_of(&cramped).contains("too long to print legibly"),
        "and the description says where it went: {cramped}",
    );
    // The words are still in the file, which is what an export must guarantee.
    assert!(
        cramped.contains(&format!("<title>{long}</title>")),
        "the title element still carries it: {cramped}",
    );

    // The same title on a figure wide enough for it is drawn, so this is a
    // limit of the size rather than of the length.
    let roomy = render_titled(&long, 2400.0);
    assert!(
        declared_width(&roomy).is_some(),
        "a wide enough figure prints it: {roomy}",
    );

    // A title that fits keeps its natural width rather than being stretched.
    let ordinary = svg::render(
        &figure_of(spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        ))
        .with_title(Label::new("Enolase").expect("a title")),
    );
    assert!(
        ordinary.contains("textLength=\"112.000\""),
        "seven characters at 16 units: {ordinary}",
    );
}

/// Deserializing a figure applies every rule a constructor would.
///
/// A derived `Deserialize` is a public entry point, not an internal detail:
/// `serde_json::from_str::<FigureSpec>` would build the type field by field,
/// skip every check, and hand the result to a renderer that has been told those
/// states cannot occur. Sealing the fields closed the mutation route; this is
/// the construction route beside it.
#[test]
fn deserializing_a_figure_applies_every_rule() {
    let document = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    ))
    .to_json()
    .expect("a figure serializes");
    assert!(
        serde_json::from_str::<FigureSpec>(&document).is_ok(),
        "a valid document still decodes",
    );

    // Each of these is a state a constructor refuses, injected into a document
    // that is otherwise well formed.
    for (name, broken) in [
        (
            "mismatched arrays",
            document.replace("\"y\":[10.0,20.0]", "\"y\":[10.0]"),
        ),
        (
            "an inverted domain",
            document.replace(
                "\"low\":100.0,\"high\":200.0",
                "\"low\":200.0,\"high\":100.0",
            ),
        ),
        ("an empty label", document.replace("\"m/z\"", "\"\"")),
        (
            "a character XML cannot carry",
            document.replace("\"m/z\"", "\"m/z\u{FFFF}\""),
        ),
    ] {
        assert_ne!(broken, document, "{name}: the probe edited something");
        assert!(
            serde_json::from_str::<FigureSpec>(&broken).is_err(),
            "{name} decoded through the public derive",
        );
        assert!(
            FigureSpec::from_json(&broken).is_err(),
            "{name} decoded through from_json",
        );
    }

    // And `from_json` still answers with the specific rule rather than with a
    // decoder message, which is why it reads the wire shape itself.
    let inverted = document.replace(
        "\"low\":100.0,\"high\":200.0",
        "\"low\":200.0,\"high\":100.0",
    );
    assert_eq!(
        FigureSpec::from_json(&inverted).unwrap_err(),
        DecodeError::Spec(SpecError::DomainInverted),
    );
}

/// An axis end too large to write out is stated as an exponent, and fits.
///
/// `Domain` accepts any finite pair, so `1e307` is a legal endpoint — and its
/// fixed-point form is 308 characters, which is neither a number a reader can
/// read nor a string an axis can hold.
#[test]
fn an_enormous_axis_end_is_stated_as_an_exponent_and_fits() {
    let width = MIN_FIGURE_WIDTH;
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(1.0e307, 2.0e307),
        domain(0.0, 1.0e307),
        vec![series(vec![1.0e307, 2.0e307], vec![1.0e306, 1.0e307])],
    )
    .expect("a panel");

    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(width, 500.0).expect("a size"),
            vec![panel],
        )
        .expect("one panel is a figure"),
    );

    assert!(document.contains(">1e307<"), "the low end: {document}");
    assert!(document.contains(">2e307<"), "the high end: {document}");
    assert!(
        !document.contains("0000000000000000000"),
        "no endpoint is written out in full: {document}",
    );

    // Every declared width still fits the document, endpoints included.
    for reserved in document
        .split("textLength=\"")
        .skip(1)
        .filter_map(|piece| piece.split('"').next()?.parse::<f64>().ok())
    {
        assert!(
            reserved > 0.0 && reserved <= width,
            "a declared width left the document: {reserved} of {width}",
        );
    }
}

/// A decoded label is checked exactly as a constructed one is.
///
/// A newtype whose invariant one entry point does not hold is a `String` with a
/// longer name — and `AxisSpec::new`, `with_title` and `with_caption` all take
/// these types precisely because the type is supposed to mean *checked*.
#[test]
fn a_decoded_label_is_checked_like_a_constructed_one() {
    // Raw strings where a backslash matters: these are JSON documents, so a
    // backslash-n must reach the decoder as two characters, not as a break.
    for text in [r#""""#, "\"m/z\u{FFFF}\""] {
        assert!(
            serde_json::from_str::<Label>(text).is_err(),
            "a label decoded unchecked: {text}",
        );
        assert!(
            serde_json::from_str::<Caption>(text).is_err(),
            "a caption decoded unchecked: {text}",
        );
    }
    // Each keeps its own rule rather than a shared one: a line break is not a
    // label, and is an ordinary part of a caption.
    assert!(serde_json::from_str::<Label>(r#""two\nlines""#).is_err());
    assert!(serde_json::from_str::<Caption>(r#""two\nlines""#).is_ok());
    assert!(serde_json::from_str::<Label>("\"m/z\"").is_ok());
    // A caption is a sentence, so it may hold the line break a label may not.
    assert!(serde_json::from_str::<Caption>(r#""Figure 1.\nReplicate A.""#).is_ok());
}

/// The smallest panel the contract accepts still shows both of its value ends.
///
/// A panel is not drawable at any height. The renderer prints the top and the
/// bottom of the value range inside the plotting area, and below some height
/// those two lines of text are closer together than they are tall — so a figure
/// the contract accepted rendered its own axis unreadable.
#[test]
fn the_smallest_accepted_panel_keeps_its_value_ends_apart() {
    fn baseline(document: &str, needle: &str) -> f64 {
        let line = document
            .lines()
            .find(|line| line.contains(needle))
            .unwrap_or_else(|| panic!("{needle} is drawn: {document}"));
        line.split("y=\"")
            .nth(1)
            .and_then(|piece| piece.split('"').next())
            .expect("a y value")
            .parse()
            .expect("a number")
    }

    // Eight panels at exactly the floor, each with a value range reaching below
    // zero so both ends are printed.
    let panel = || {
        PanelSpec::new(
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Centroid,
            },
            AxisSpec::new(label("m/z"), UnitState::Dimensionless),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(100.0, 200.0),
            domain(-40.0, 90.0),
            vec![series(vec![100.0, 200.0], vec![-40.0, 90.0])],
        )
        .expect("a panel")
    };
    let panels = 8;
    let height = MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT * f64::from(panels);
    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(900.0, height).expect("a size"),
            (0..panels).map(|_| panel()).collect(),
        )
        .expect("eight panels at the floor"),
    );

    let high = baseline(&document, ">90<");
    let low = baseline(&document, ">-40<");
    assert!(
        (low - high) >= 11.0,
        "the two value ends are at least a line apart: {high} and {low}",
    );
}

/// Two markers at one position do not draw one label over the other.
///
/// A precursor window and its monoisotopic peak sit at the same m/z, and one
/// label written on top of another leaves a figure that looks annotated and is
/// missing an annotation.
#[test]
fn two_markers_at_one_position_keep_both_labels() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, Some(label("precursor"))).expect("a marker"),
        Marker::new(150.0, Some(label("monoisotopic"))).expect("a marker"),
        Marker::new(151.0, Some(label("nearly there"))).expect("a marker"),
    ])
    .expect("markers on a valid panel");

    let document = svg::render(&figure_of(panel));
    let baselines: Vec<f64> = ["precursor", "monoisotopic", "nearly there"]
        .into_iter()
        .map(|needle| {
            let line = document
                .lines()
                .find(|line| line.contains(&format!(">{needle}<")))
                .unwrap_or_else(|| panic!("{needle} is drawn: {document}"));
            line.split("y=\"")
                .nth(1)
                .and_then(|piece| piece.split('"').next())
                .expect("a y value")
                .parse::<f64>()
                .expect("a number")
        })
        .collect();

    for (index, first) in baselines.iter().enumerate() {
        for second in baselines.iter().skip(index + 1) {
            assert!(
                (first - second).abs() >= 11.0,
                "two labels landed on each other: {baselines:?}",
            );
        }
    }
}

/// A spectrum of measured zeros is not an empty spectrum.
///
/// A stick of no length paints nothing, so a peakless scene rendered a blank
/// plotting area — the same picture as a panel with no points, which is a
/// different fact about the sample.
#[test]
fn measured_zeros_are_drawn_and_disclosed() {
    let zeros = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0, 300.0], vec![0.0, 0.0, 0.0]),
    ));
    let empty = figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(Vec::new(), Vec::new()),
    ));

    let drawn = svg::render(&zeros);
    let nothing = svg::render(&empty);

    let path = path_data(&drawn);
    assert_eq!(
        path.matches('L').count(),
        3,
        "one visible mark per measured zero: {path}",
    );
    assert!(
        path_data(&nothing).is_empty(),
        "and a panel with no points still draws no data",
    );
    assert!(
        drawn.contains("Every drawn value is zero."),
        "the figure says so in words as well: {drawn}",
    );
    assert!(!nothing.contains("Every drawn value is zero."));

    // The marks are on the zero line, so they claim no intensity: every drawn
    // y coordinate is the same one.
    let ys: Vec<&str> = path
        .split(['M', 'L'])
        .filter(|piece| !piece.is_empty())
        .filter_map(|piece| piece.split_whitespace().nth(1))
        .collect();
    assert!(
        ys.windows(2).all(|pair| pair[0] == pair[1]),
        "a zero mark has no height: {path}",
    );
}

/// A baseline is drawn as the reference line the contract calls it.
///
/// `StyleRole::Baseline` is "a reference line the data is read against" — a
/// model with a value everywhere between its samples, not a set of
/// measurements. Drawn as sticks from zero it becomes a row of extra peaks in a
/// centroid spectrum, labelled background.
#[test]
fn a_baseline_is_drawn_as_a_line_even_among_sticks() {
    let measurement = series(vec![100.0, 200.0, 300.0], vec![10.0, 90.0, 20.0]);
    let baseline = SeriesSpec::new(
        label("baseline"),
        StyleRole::Baseline,
        DataScope::FullSource,
        vec![100.0, 200.0, 300.0],
        vec![5.0, 6.0, 7.0],
    )
    .expect("a baseline");
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 300.0),
        domain(0.0, 90.0),
        vec![measurement, baseline],
    )
    .expect("a panel");

    let document = svg::render(&figure_of(panel));
    let paths: Vec<&str> = document
        .split("<path d=\"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .collect();
    assert_eq!(paths.len(), 2, "one path per series: {paths:?}");
    assert_eq!(
        paths[0].matches('V').count(),
        3,
        "the measurement is three sticks: {}",
        paths[0],
    );
    assert_eq!(
        paths[1].matches('V').count(),
        0,
        "the baseline is not drawn as sticks: {}",
        paths[1],
    );
    assert_eq!(
        paths[1].matches('L').count(),
        2,
        "it is a joined line through its own samples: {}",
        paths[1],
    );
}

/// A crowded label shrinks to fit, and is never drawn over another.
///
/// Stepping down the page cannot help a block taller than the room left for it:
/// two eight-line labels do not fit one under the other on a small figure
/// however politely they take turns. So a label that cannot be placed clear at
/// its size shrinks — and if no size fits, it is not drawn at all and the
/// description names it, because an unreadable annotation and a missing one
/// look identical while only one of them says so.
#[test]
fn a_crowded_label_shrinks_and_is_never_drawn_over_another() {
    fn marker_baselines(document: &str) -> Vec<f64> {
        document
            .split("<text ")
            .skip(1)
            // The marker colour: a wrapped label is many `<tspan>`s, so no
            // single block holds the whole string to match on.
            .filter(|block| block.contains("#b3261e"))
            .filter_map(|block| {
                block
                    .split("y=\"")
                    .nth(1)?
                    .split('"')
                    .next()?
                    .parse::<f64>()
                    .ok()
            })
            .collect()
    }

    let long = "m".repeat(MAX_LABEL_CHARS);
    let figure = |height: f64| {
        let panel = spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
        .with_markers(vec![
            Marker::new(150.0, Some(label(&long))).expect("a marker"),
            Marker::new(150.0, Some(label(&long))).expect("a marker"),
        ])
        .expect("markers on a valid panel");
        svg::render(
            &FigureSpec::new(
                FigureTheme::Light,
                FigureSize::new(MIN_FIGURE_WIDTH, height).expect("a size"),
                vec![panel],
            )
            .expect("one panel is a figure"),
        )
    };

    // Room for both, once one of them shrinks.
    let roomy = figure(420.0);
    let baselines = marker_baselines(&roomy);
    assert_eq!(baselines.len(), 2, "both labels are drawn: {baselines:?}");
    assert_ne!(
        baselines[0], baselines[1],
        "and not on top of each other: {baselines:?}",
    );
    assert!(
        !roomy.contains("drawn without"),
        "so nothing is reported missing: {roomy}",
    );
    let kept: String = roomy
        .split("<tspan")
        .skip(1)
        .filter_map(|piece| {
            piece
                .split_once('>')?
                .1
                .split_once("</tspan>")
                .map(|cut| cut.0)
        })
        .collect();
    assert_eq!(
        kept.matches('m').count(),
        MAX_LABEL_CHARS * 2,
        "nothing was elided to make room",
    );

    // Room for neither at any size. A label is bounded by the plotting area
    // rather than by the page -- left of the frame is the value axis's own
    // rotated caption -- and a maximum-length label does not fit the smallest
    // panel the contract accepts at any size it may shrink to. Neither is
    // drawn, and the figure says so in words, naming both.
    let cramped = figure(MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT);
    assert_eq!(
        marker_baselines(&cramped).len(),
        0,
        "neither is stacked on the other: {cramped}",
    );
    assert!(
        cramped.contains("2 markers are drawn without their labels"),
        "and the description says so: {cramped}",
    );
    assert!(
        cramped.contains(&long),
        "naming them, so the words are still in the file: {cramped}",
    );
}

/// A misspelled optional field is refused rather than quietly dropped.
///
/// `serde` ignores what it does not recognise, so `visible_domian` decoded as
/// "no window" — and a specification that asked for a selected range became a
/// full-source export with nothing to show it had changed. An optional field is
/// exactly where this is invisible: there is no missing-field error to raise.
#[test]
fn a_field_this_build_does_not_know_is_refused() {
    let windowed = figure_of(
        spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
        .with_visible_domain(domain(120.0, 180.0))
        .expect("a window inside the domain"),
    )
    .to_json()
    .expect("a figure serializes");
    assert!(windowed.contains("visible_domain"));

    let misspelled = windowed.replace("visible_domain", "visible_domian");
    assert_ne!(misspelled, windowed, "the probe edited something");
    assert_eq!(
        FigureSpec::from_json(&misspelled).unwrap_err(),
        DecodeError::Malformed,
        "a typo must not decode as a full-range export",
    );
    assert!(serde_json::from_str::<FigureSpec>(&misspelled).is_err());

    // And a field invented at any depth is refused too, not only at the top.
    for (name, broken) in [
        ("a panel", windowed.replace("\"markers\"", "\"marks\"")),
        ("a series", windowed.replace("\"role\"", "\"roll\"")),
        ("a domain", windowed.replace("\"low\"", "\"lo\"")),
    ] {
        assert_ne!(broken, windowed, "{name}: the probe edited something");
        assert!(
            FigureSpec::from_json(&broken).is_err(),
            "{name} decoded with a field this build does not know",
        );
    }

    // The document it was made from still decodes, so the rule is unknown
    // fields rather than strictness for its own sake.
    assert!(FigureSpec::from_json(&windowed).is_ok());
}

/// A marker label stays inside the panel that owns it.
///
/// Below the plotting area sit that panel's own domain-end labels and its axis
/// caption, and after those the next panel — so a block bounded by the page
/// could cover the axis it annotates, and in a stacked figure walk into the
/// panel below.
#[test]
fn a_marker_label_stays_inside_its_own_panel() {
    // Short enough to be placed on the smallest panel the contract accepts. A
    // maximum-length label has no room in that plotting area at any size and is
    // disclosed instead, which `a_crowded_label_shrinks_and_is_never_drawn_over_another`
    // covers; what this test needs is a label that *is* drawn, so that where it
    // lands can be checked.
    let panel = || {
        spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
        .with_markers(vec![
            Marker::new(150.0, Some(label("precursor"))).expect("a marker"),
        ])
        .expect("markers on a valid panel")
    };
    // Narrow enough that the label wraps, and short enough that its lines would
    // reach the panel below if only the page bounded them.
    let panels = 3;
    let width = MIN_FIGURE_WIDTH;
    let height = MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT * f64::from(panels);
    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(width, height).expect("a size"),
            (0..panels).map(|_| panel()).collect(),
        )
        .expect("three panels"),
    );

    // The plotting band of each panel, from the renderer's own arithmetic.
    let usable = height - 40.0 - 56.0;
    let each = usable / f64::from(panels);
    let bands: Vec<(f64, f64)> = (0..panels)
        .map(|index| {
            let top = 40.0 + each * f64::from(index);
            (top + 8.0, 40.0 + each * f64::from(index + 1) - 34.0)
        })
        .collect();

    let mut drawn = 0;
    // Only a marker label is drawn as `<tspan>` lines, and a block reaches to
    // the next `<text `, so this is the label's own content rather than a
    // colour that happens to appear further down the document.
    for block in document.split("<text ").skip(1) {
        let Some(block) = block.split("</text>").next() else {
            continue;
        };
        if !block.contains("<tspan") {
            continue;
        }
        let index = drawn;
        drawn += 1;
        let baselines: Vec<f64> = block
            .split("<tspan")
            .skip(1)
            .filter_map(|piece| {
                piece
                    .split("y=\"")
                    .nth(1)?
                    .split('"')
                    .next()?
                    .parse::<f64>()
                    .ok()
            })
            .collect();
        assert!(!baselines.is_empty(), "a label has lines: {block}");
        let (first, last) = (baselines[0], baselines[baselines.len() - 1]);
        // Against **its own** band, by index, rather than against any of them.
        // Panels are rendered in order and each one's markers are drawn before
        // its axis text, so the nth block belongs to the nth panel -- and
        // asking only whether some band contains the block would accept the
        // defect this test exists for, a label that stepped down out of its
        // panel and landed tidily inside the next one.
        //
        // The band ends at the plotting area, and this panel's own domain-end
        // labels sit 14 units below that with its axis caption below those, so
        // staying inside the band is also what keeps the annotation off the
        // axis text it annotates.
        assert!(index < bands.len(), "a fourth label appeared: {block}");
        let (top, bottom) = bands[index];
        assert!(
            first >= top && last <= bottom,
            "a label left panel {index}: {first}..{last} against {top}..{bottom}",
        );
    }
    assert_eq!(drawn, 3, "one label per panel");
}

/// Wrapping a label cuts it into pieces and never rewrites it.
///
/// `split_whitespace` trimmed the ends and collapsed runs, so `sample  A` was
/// exported as `sample A` — the same silent edit this boundary refuses to make
/// when it accepts the label in the first place, applied one layer down to what
/// may be a sample identifier.
#[test]
fn wrapping_a_label_keeps_every_character() {
    // Written as escapes rather than as literal spaces: the runs are the point
    // of the test, and a run of spaces inside a string literal is exactly what
    // `check_repo.py` looks for as a lost line continuation.
    let awkward = "\u{20}\u{20}sample\u{20}\u{20}A\u{20}\u{20}";
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, Some(label(awkward))).expect("a marker"),
    ])
    .expect("markers on a valid panel");

    let document = svg::render(&figure_of(panel));
    let rejoined: String = document
        .split("<tspan")
        .skip(1)
        .filter_map(|piece| {
            piece
                .split_once('>')?
                .1
                .split_once("</tspan>")
                .map(|cut| cut.0)
        })
        .collect();
    assert_eq!(rejoined, awkward, "the label survives its own layout");
    assert!(
        document.contains("xml:space=\"preserve\""),
        "and the document tells a viewer to keep it: {document}",
    );

    // Even when it has to be cut into many lines.
    let long = "ab cd ".repeat(20);
    let wrapped = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, Some(label(&long))).expect("a marker"),
    ])
    .expect("markers on a valid panel");
    let document = svg::render(&figure_of(wrapped));
    let rejoined: String = document
        .split("<tspan")
        .skip(1)
        .filter_map(|piece| {
            piece
                .split_once('>')?
                .1
                .split_once("</tspan>")
                .map(|cut| cut.0)
        })
        .collect();
    assert_eq!(rejoined, long, "including every space it was given");
}

/// The exported description spaces its own sentences, and nothing else.
///
/// A lost line continuation left twenty-two spaces inside the windowed
/// reduction sentence, and every assertion in place missed it: they test that
/// disclosure in fragments, and `contains` cannot see a gap between two
/// fragments it checks separately. So this reads the `<desc>` the document
/// actually carries.
///
/// Both halves are load-bearing. The whole sentence pins this text; the run
/// check catches the same defect arriving in any of the other sentences
/// `panel_description` can emit, which is the class rather than the instance.
/// It is scoped to labels carrying no run of their own, because a label that
/// carried one would reach the unplaced-label sentence legitimately -- the
/// renderer preserves the text it was given, and that is a different rule.
#[test]
fn the_description_carries_no_unintended_whitespace() {
    let reduced = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 500,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![100.0, 110.0, 300.0, 310.0, 320.0],
        vec![10.0, 20.0, 30.0, 40.0, 50.0],
    )
    .expect("a reduction");
    let windowed = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 320.0),
        domain(0.0, 50.0),
        vec![reduced],
    )
    .expect("a panel")
    .with_visible_domain(domain(250.0, 320.0))
    .expect("a window inside the domain");

    let description = description_of(&svg::render(&figure_of(windowed)));
    assert!(
        description.contains(
            "&quot;measurement&quot; is reduced from 500 source points to 5, \
             keeping the greatest and the least value in each column; 3 of them lie \
             inside the range shown."
        ),
        "the windowed disclosure reads as one sentence: {description:?}",
    );

    // Every other sentence this function can produce, over scenes chosen to
    // reach them: an unreported representation, an unreported unit, a negative
    // count, a measured zero and a chromatogram trace.
    let scenes = [
        svg::render(&figure_of(spectrum_panel(
            SpectrumRepresentation::Unreported,
            series(vec![100.0, 200.0], vec![10.0, -20.0]),
        ))),
        svg::render(&figure_of(spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![0.0, 0.0]),
        ))),
        svg::render(&figure_of(
            PanelSpec::new(
                PlotKind::Chromatogram,
                AxisSpec::new(
                    label("Retention time"),
                    UnitState::Known { unit: label("min") },
                ),
                AxisSpec::new(label("Intensity"), UnitState::Unreported),
                domain(0.0, 3.0),
                domain(-5.0, 10.0),
                vec![series(vec![0.0, 1.0, 2.0, 3.0], vec![1.0, -5.0, 10.0, 2.0])],
            )
            .expect("a chromatogram panel"),
        )),
    ];
    for document in &scenes {
        let description = description_of(document);
        assert!(
            !description.is_empty(),
            "the scene disclosed something: {document}",
        );
        assert!(
            !description.contains("  "),
            "a run of spaces reached the description: {description:?}",
        );
    }
}

/// A trace zoomed below zero does not describe a zero line it does not draw.
///
/// A joined trace is exempt from the zero-baseline rule, so its value range may
/// legitimately exclude zero -- and against a range like `-10 .. -5` the
/// renderer pins the horizontal rule to the top of the plotting area, where it
/// is that range's own end. Calling it the zero line gave the reader the wrong
/// datum to read every depth against, and contradicted the value-axis ends the
/// same document prints.
#[test]
fn a_trace_zoomed_below_zero_does_not_claim_a_zero_line() {
    let zoomed = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 3.0),
        domain(-10.0, -5.0),
        vec![series(
            vec![0.0, 1.0, 2.0, 3.0],
            vec![-9.0, -6.0, -8.0, -5.5],
        )],
    )
    .expect("a trace may be zoomed to a range excluding zero");

    let description = description_of(&svg::render(&figure_of(zoomed)));
    assert!(
        !description.contains("shown below the zero line"),
        "a figure with no zero line does not claim one: {description:?}",
    );
    assert!(
        description.contains("All 4 drawn values are negative."),
        "the negative values are still disclosed: {description:?}",
    );
    assert!(
        description.contains("Zero is outside the value range shown"),
        "and the reader is told where zero is not: {description:?}",
    );

    // The sentence is still the right one where the range does reach zero,
    // which is every ordinary figure -- this narrows a claim rather than
    // removing it.
    let ordinary = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 3.0),
        domain(-10.0, 40.0),
        vec![series(
            vec![0.0, 1.0, 2.0, 3.0],
            vec![-9.0, 30.0, -8.0, 12.0],
        )],
    )
    .expect("a trace whose range contains zero");
    let description = description_of(&svg::render(&figure_of(ordinary)));
    assert!(
        description
            .contains("2 of the drawn values are negative and are shown below the zero line."),
        "a real zero line is still described as one: {description:?}",
    );
}

/// A baseline is named in the export rather than distinguished by hue alone.
///
/// The drawing separates a reference baseline from measured data with a stroke
/// colour and nothing else, so a monochrome print, a rasterization, or a reader
/// who does not know this product's palette cannot tell which line is which --
/// while `SeriesSpec` was carrying a name for each of them that the document
/// dropped on the floor.
#[test]
fn a_baseline_is_named_in_the_description_rather_than_only_coloured() {
    let measurement = SeriesSpec::new(
        label("sample intensity"),
        StyleRole::Measurement,
        DataScope::FullSource,
        vec![100.0, 150.0, 200.0],
        vec![10.0, 40.0, 20.0],
    )
    .expect("a measurement");
    let baseline = SeriesSpec::new(
        label("estimated background"),
        StyleRole::Baseline,
        DataScope::FullSource,
        vec![100.0, 200.0],
        vec![2.0, 3.0],
    )
    .expect("a baseline");
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 200.0),
        domain(0.0, 40.0),
        vec![measurement, baseline],
    )
    .expect("a panel of two series");

    let document = svg::render(&figure_of(panel));
    // Two strokes and two roles: without the sentence below, the only thing in
    // the file telling them apart is the colour.
    assert_eq!(
        document.matches("<path ").count(),
        2,
        "two series: {document}"
    );
    let description = description_of(&document);
    // Escaped, because that is what the file carries.
    assert!(
        description.contains("&quot;sample intensity&quot; is measured data"),
        "the measurement is named: {description:?}",
    );
    assert!(
        description.contains("&quot;estimated background&quot; is a reference baseline"),
        "and so is the baseline: {description:?}",
    );

    // A lone measurement is named too. Identity is not only attribution: the id
    // is the one place the contract says *which* measurement a trace is, and a
    // figure drawn against generic axes has nowhere else to carry it.
    let plain = description_of(&svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    ))));
    assert!(
        plain.contains("&quot;measurement&quot; is measured data"),
        "a lone measurement still carries its name: {plain:?}",
    );
}

/// A window with no sample in it does not claim a zero line either.
///
/// The zero-line correction covered the counted-negatives sentence and left the
/// interpolated one beside it: a trace whose visible window clips a segment
/// with neither source sample inside it counts zero negatives, so it fell
/// through to the sentence about crossing the zero line -- in a panel whose
/// range excludes zero and which therefore draws no zero line at all.
#[test]
fn a_clipped_window_with_no_sample_does_not_claim_a_zero_line() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(-10.0, -5.0),
        vec![series(vec![0.0, 10.0], vec![-10.0, -5.0])],
    )
    .expect("a trace zoomed below zero")
    .with_visible_domain(domain(2.0, 8.0))
    .expect("a window inside the domain");

    let description = description_of(&svg::render(&figure_of(panel)));
    assert!(
        !description.contains("zero line, where it crosses"),
        "no zero line is crossed in a figure that has none: {description:?}",
    );
    assert!(
        description
            .contains("No measured sample of &quot;measurement&quot; lies inside the range shown"),
        "the reader is told why the trace has no vertices: {description:?}",
    );
    assert!(
        description.contains(
            "Zero is outside the value range shown, so the horizontal rule is the top of \
             that range rather than a zero line."
        ),
        "and where zero is not: {description:?}",
    );

    // The interpolated-crossing sentence is still produced where there really
    // is a zero line to cross, so this narrows a claim rather than dropping it.
    let crossing = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(-10.0, 10.0),
        vec![series(vec![0.0, 10.0], vec![-10.0, 10.0])],
    )
    .expect("a trace whose range contains zero")
    .with_visible_domain(domain(2.0, 4.0))
    .expect("a window inside the domain");
    let description = description_of(&svg::render(&figure_of(crossing)));
    assert!(
        description.contains("Part of the drawn trace lies below the zero line"),
        "a real crossing is still described: {description:?}",
    );
    assert!(
        !description.contains("Zero is outside the value range shown"),
        "and an ordinary range says nothing about zero being absent: {description:?}",
    );
}

/// A panel may not carry two measurement series.
///
/// Both would be drawn in one colour at one width, and a description naming two
/// ids as measured data cannot say which line is which — a figure that looks
/// like a comparison and cannot be read as one. Telling them apart needs a
/// style system and a legend to decode it, which is FIG-008 and a named
/// non-goal here, so the contract refuses the figure rather than rendering it
/// ambiguously.
#[test]
fn a_panel_refuses_two_series_of_one_role() {
    let overlay = |second_role| {
        PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(
                label("Retention time"),
                UnitState::Known { unit: label("min") },
            ),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 10.0),
            domain(0.0, 100.0),
            vec![
                SeriesSpec::new(
                    label("total ion current"),
                    StyleRole::Measurement,
                    DataScope::FullSource,
                    vec![0.0, 10.0],
                    vec![10.0, 90.0],
                )
                .expect("a measurement"),
                SeriesSpec::new(
                    label("base peak"),
                    second_role,
                    DataScope::FullSource,
                    vec![0.0, 10.0],
                    vec![5.0, 40.0],
                )
                .expect("a second series"),
            ],
        )
    };

    assert_eq!(
        overlay(StyleRole::Measurement).unwrap_err(),
        SpecError::DuplicateSeriesRole,
        "two measurements cannot be told apart, so they are not a figure",
    );
    // One measurement read against one reference line stays representable: the
    // pair is distinguishable in the drawing and named in the words.
    assert!(
        overlay(StyleRole::Baseline).is_ok(),
        "a measurement and a baseline remain a valid panel",
    );

    // And the refusal holds at the decode boundary too, not only at the
    // constructor -- a document is the other way into this type.
    let document = serde_json::to_string(&serde_json::json!({
        "schema_version": SCHEMA_VERSION,
        "theme": "light",
        "size": { "width": 900.0, "height": 500.0 },
        "title": null,
        "caption": null,
        "panels": [{
            "kind": { "kind": "chromatogram" },
            "x_axis": { "label": "Retention time", "unit": { "state": "unreported" } },
            "y_axis": { "label": "Intensity", "unit": { "state": "unreported" } },
            "full_domain": { "low": 0.0, "high": 10.0 },
            "visible_domain": null,
            "value_domain": { "low": 0.0, "high": 100.0 },
            "series": [
                { "id": "a", "role": "measurement", "scope": { "scope": "full_source" },
                  "x": [0.0, 10.0], "y": [10.0, 90.0] },
                { "id": "b", "role": "measurement", "scope": { "scope": "full_source" },
                  "x": [0.0, 10.0], "y": [5.0, 40.0] }
            ],
            "markers": []
        }]
    }))
    .expect("a document");
    assert_eq!(
        FigureSpec::from_json(&document),
        Err(DecodeError::Spec(SpecError::DuplicateSeriesRole)),
        "and a decoded overlay is refused with the rule that failed",
    );
}

/// Two baselines are as indistinguishable as two measurements.
///
/// The role check was written against `Measurement` and left the same ambiguity
/// reachable through the other role: two baselines get one grey stroke at one
/// width, and a description naming both ids as reference lines maps neither to
/// a path. The rule belongs to the mapping rather than to any member of it.
#[test]
fn a_panel_refuses_two_series_of_the_same_non_measurement_role() {
    let line = |name: &str| {
        SeriesSpec::new(
            label(name),
            StyleRole::Baseline,
            DataScope::FullSource,
            vec![0.0, 10.0],
            vec![1.0, 2.0],
        )
        .expect("a baseline")
    };
    let panel = |series| {
        PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(
                label("Retention time"),
                UnitState::Known { unit: label("min") },
            ),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 10.0),
            domain(0.0, 100.0),
            series,
        )
    };

    assert_eq!(
        panel(vec![line("solvent"), line("column bleed")]).unwrap_err(),
        SpecError::DuplicateSeriesRole,
        "two baselines cannot be told apart either",
    );
    assert!(
        panel(vec![line("solvent")]).is_ok(),
        "one baseline on its own remains a valid panel",
    );
}

/// A single-valued domain still prints the value it holds.
///
/// `1e-20 .. 1e-20` is a legitimate domain -- a flat trace, a one-point series
/// -- and it never collides with itself, so the narrow-domain fallback could
/// not see it: both ends printed `0.000000` and the axis stated zero where the
/// measurement is not. Printing one value's ends identically is the truth;
/// printing them as a *different* number is not.
#[test]
fn a_tiny_single_valued_axis_is_not_printed_as_zero() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(1.0e-20, 1.0e-20),
        domain(1.0e-20, 1.0e-20),
        vec![series(vec![1.0e-20], vec![1.0e-20])],
    )
    .expect("a single-valued panel is a real scene");

    let document = svg::render(&figure_of(panel));
    assert!(
        document.contains("1e-20"),
        "the value the axis holds is printed: {document}",
    );
    // The defect: an axis claiming zero for a measurement that is not zero.
    // `0.000000` is what the fixed-point form rounded it to at both ends.
    assert!(
        !document.contains(">0.000000<"),
        "and never rounded away to zero: {document}",
    );

    // A domain that genuinely is zero still prints as zero rather than as an
    // exponent -- the fallback triggers on losing a value, not on being small.
    let zeroed = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![0.0, 0.0]),
    )));
    assert!(
        zeroed.contains(">0.000000<"),
        "a real zero is printed as zero rather than as an exponent: {zeroed}",
    );
}

/// Every type that documents an invariant holds it at the decode door too.
///
/// `FigureSpec`, `Label` and `Caption` were sealed; `Domain`, `FigureSize`,
/// `Marker`, `SeriesSpec` and `PanelSpec` were not, so
/// `serde_json::from_str::<Domain>` built an inverted domain whose `low`,
/// `high` and `span` contradicted the sentence above them. Being reachable only
/// through an outer constructor that happens to revalidate is not the same as
/// holding an invariant.
#[test]
fn no_validated_type_has_an_unchecked_decode_door() {
    assert!(
        serde_json::from_str::<Domain>(r#"{"low":10.0,"high":0.0}"#).is_err(),
        "an inverted domain is not a domain",
    );
    assert!(
        serde_json::from_str::<Domain>(r#"{"low":0.0,"high":10.0}"#).is_ok(),
        "and an ordered one still decodes",
    );
    assert!(
        serde_json::from_str::<FigureSize>(r#"{"width":1.0,"height":1.0}"#).is_err(),
        "a figure smaller than the floor is not a size",
    );
    assert!(
        serde_json::from_str::<Marker>(r#"{"at":null,"label":null}"#).is_err(),
        "a marker with no position is not a marker",
    );
    assert!(
        serde_json::from_str::<SeriesSpec>(
            r#"{"id":"a","role":"measurement","scope":{"scope":"full_source"},
                "x":[1.0,2.0],"y":[1.0]}"#
        )
        .is_err(),
        "a series whose axes disagree in length is not a series",
    );
    assert!(
        serde_json::from_str::<PanelSpec>(
            r#"{"kind":{"kind":"chromatogram"},
                "x_axis":{"label":"t","unit":{"state":"unreported"}},
                "y_axis":{"label":"i","unit":{"state":"unreported"}},
                "full_domain":{"low":0.0,"high":10.0},
                "visible_domain":{"low":-5.0,"high":10.0},
                "value_domain":{"low":0.0,"high":10.0},
                "series":[],"markers":[]}"#
        )
        .is_err(),
        "a window outside the source is not a panel",
    );
}

/// A multi-panel figure attributes each trace to a panel and an id.
///
/// Two panels each holding one measurement are two identically drawn traces and
/// two identical paragraphs: same colour, same axis semantics, same generic
/// sentence. Asking only whether *this* panel held more than one series stayed
/// silent exactly where attribution was needed, because the question is the
/// figure's rather than the panel's.
#[test]
fn a_multi_panel_figure_names_each_panel_and_its_series() {
    let trace = |name: &str, top: f64| {
        PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(
                label("Retention time"),
                UnitState::Known { unit: label("min") },
            ),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 10.0),
            domain(0.0, 100.0),
            vec![
                SeriesSpec::new(
                    label(name),
                    StyleRole::Measurement,
                    DataScope::FullSource,
                    vec![0.0, 10.0],
                    vec![1.0, top],
                )
                .expect("a measurement"),
            ],
        )
        .expect("a chromatogram panel")
    };
    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(900.0, 500.0).expect("a size"),
            vec![trace("total ion current", 90.0), trace("base peak", 40.0)],
        )
        .expect("two panels"),
    );
    let description = description_of(&document);

    assert!(
        description.contains("Panel 1 of 2, counting from the top."),
        "each panel says which it is: {description:?}",
    );
    assert!(
        description.contains("Panel 2 of 2, counting from the top."),
        "including the second: {description:?}",
    );
    assert!(
        description.contains("&quot;total ion current&quot; is measured data"),
        "and which series it draws: {description:?}",
    );
    assert!(
        description.contains("&quot;base peak&quot; is measured data"),
        "for both of them: {description:?}",
    );
    // Order is the attribution, so the first panel's id must precede the
    // second's — otherwise "counting from the top" names nothing.
    let first = description
        .find("total ion current")
        .expect("the first id appears");
    let second = description
        .find("base peak")
        .expect("the second id appears");
    assert!(first < second, "in panel order: {description:?}");

    // A single-panel figure is not numbered, because "Panel 1 of 1" is an
    // ordinal with nothing to order.
    let lone = description_of(&svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    ))));
    assert!(
        !lone.contains("Panel 1 of"),
        "one panel is not numbered: {lone:?}",
    );
    // The series is still named: an ordinal without a second panel means
    // nothing, but an identity always does.
    assert!(
        lone.contains("Series:"),
        "and its series is still named: {lone:?}",
    );
}

/// A negative-zero axis end prints as the zero it equals.
///
/// `-0.0` is a legitimate `f64`, compares equal to `0.0`, and Rust formats it
/// with its sign — so `Domain::new(-0.0, 0.0)`, a single-valued zero domain,
/// labelled its ends `-0.000000` and `0.000000` and read as an interval
/// spanning zero rather than as the one value it is.
#[test]
fn a_negative_zero_axis_end_is_not_printed_signed() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        Domain::new(-0.0, 0.0).expect("negative zero is a finite bound"),
        Domain::new(-0.0, 0.0).expect("negative zero is a finite bound"),
        vec![series(vec![-0.0], vec![0.0])],
    )
    .expect("a single-valued zero panel");

    let document = svg::render(&figure_of(panel));
    assert!(
        !document.contains(">-0.000000<"),
        "no axis end claims a signed zero: {document}",
    );
    assert!(
        !document.contains(">-0e0<"),
        "nor does the exponent form: {document}",
    );
    assert!(
        document.contains(">0.000000<"),
        "and the value it holds is still printed: {document}",
    );
}

/// A reduction that removed nothing is not a reduction.
///
/// `ReductionNotSmaller` is the name the error always had, but the check read
/// `<`, so a source count equal to the retained count was accepted and the
/// figure then said "reduced to 5" from 5 source points -- asserting that
/// measurements were dropped when none were. That is a caller's
/// misclassification reaching a scientific caption intact.
#[test]
fn a_reduction_that_dropped_nothing_is_refused() {
    let reduction = |source: usize| {
        SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::Reduced {
                source_point_count: source,
                rule: ReductionRule::MinMaxPerColumn,
            },
            vec![100.0, 150.0, 200.0],
            vec![10.0, 40.0, 20.0],
        )
    };

    assert_eq!(
        reduction(3).unwrap_err(),
        SpecError::ReductionNotSmaller,
        "three points from three sources dropped nothing",
    );
    assert_eq!(
        reduction(2).unwrap_err(),
        SpecError::ReductionNotSmaller,
        "and fewer sources than points is still not a reduction",
    );
    assert!(
        reduction(4).is_ok(),
        "one point dropped is a reduction, and the smallest real one",
    );

    // The empty case collapses the same way: nothing from nothing.
    assert_eq!(
        SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::Reduced {
                source_point_count: 0,
                rule: ReductionRule::MinMaxPerColumn,
            },
            Vec::new(),
            Vec::new(),
        )
        .unwrap_err(),
        SpecError::ReductionNotSmaller,
        "an empty series stands for no source but its own",
    );
}

/// A marker label clears the value-axis *low* end as well as the high one.
///
/// The panel floor kept a label inside the plotting area, but the low end is
/// drawn two units above that floor and inside the same area -- so a label
/// stepping down to the last position the floor allowed landed on it, and the
/// axis end, written afterwards, covered the annotation.
#[test]
fn a_marker_label_clears_the_value_axis_low_end() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(
            label("Retention time"),
            UnitState::Known { unit: label("min") },
        ),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(1.0, 2.0),
        vec![series(vec![0.0, 10.0], vec![1.0, 2.0])],
    )
    .expect("a trace zoomed to a non-zero range")
    .with_markers(vec![
        Marker::new(0.0, Some(label("a"))).expect("a marker"),
        Marker::new(0.1, Some(label("b"))).expect("a second marker"),
    ])
    .expect("markers on a valid panel");

    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(
                MIN_FIGURE_WIDTH,
                MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT,
            )
            .expect("the smallest figure the contract accepts"),
            vec![panel],
        )
        .expect("one panel"),
    );

    // The renderer's own arithmetic for this figure.
    let plot_bottom = 40.0 + (180.0 - 40.0 - 56.0) - 34.0;
    let low_end_baseline = plot_bottom - 2.0;
    // The low end is drawn at 11 units, so its glyphs start that far above its
    // baseline. A marker block must finish above that to stay clear of it.
    let low_end_top = low_end_baseline - 11.0;

    let mut labels = 0;
    for block in document.split("<text ").skip(1) {
        let Some(block) = block.split("</text>").next() else {
            continue;
        };
        if !block.contains("<tspan") {
            continue;
        }
        labels += 1;
        let last = block
            .split("<tspan")
            .skip(1)
            .filter_map(|piece| {
                piece
                    .split("y=\"")
                    .nth(1)?
                    .split('"')
                    .next()?
                    .parse::<f64>()
                    .ok()
            })
            .fold(f64::MIN, f64::max);
        assert!(
            last <= low_end_top,
            "a marker label reached the value-axis low end: {last} against {low_end_top}",
        );
    }
    // Whatever could not be placed is disclosed rather than drawn over the
    // axis, so the two markers are either both placed clear or named in words.
    let description = description_of(&document);
    assert!(
        labels == 2 || description.contains("without its label"),
        "every marker is drawn clear or disclosed: {labels} placed, {description:?}",
    );
}

/// A window holding no measured point says so.
///
/// A discrete panel windowed between two peaks drew no path and said nothing,
/// so the file claimed centroid data and left "no measurement in this range"
/// indistinguishable from an empty source and from a renderer that had failed.
#[test]
fn a_window_with_no_measured_point_discloses_it() {
    let between_peaks = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0, 300.0], vec![10.0, 20.0, 30.0]),
    )
    .with_visible_domain(domain(210.0, 290.0))
    .expect("a window between two peaks");
    let document = svg::render(&figure_of(between_peaks));
    assert!(
        !document.contains("<path "),
        "nothing is drawn in that window: {document}",
    );
    assert!(
        description_of(&document).contains(
            "No measured point of &quot;measurement&quot; lies inside the range shown, \
             so none of it is drawn."
        ),
        "and the file says so, naming the series it is about: {}",
        description_of(&document),
    );

    // An empty source is a *different* fact and gets its own sentence: it has
    // no points at all, rather than none of them in range. Both are disclosed,
    // and neither is silent.
    let empty = description_of(&svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(Vec::new(), Vec::new()),
    ))));
    assert!(
        empty.contains("&quot;measurement&quot; carries no points, so nothing is drawn for it."),
        "an empty panel is not silent either: {empty:?}",
    );
    assert!(
        !empty.contains("lies inside the range shown"),
        "and is not described as a window that missed its points: {empty:?}",
    );

    // A joined trace crossing the window is a different fact and keeps its own
    // sentence, because something *is* drawn there.
    let crossing = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 100.0),
        vec![series(vec![0.0, 10.0], vec![10.0, 90.0])],
    )
    .expect("a trace")
    .with_visible_domain(domain(4.0, 6.0))
    .expect("a window between its samples");
    let document = svg::render(&figure_of(crossing));
    assert!(document.contains("<path "), "a line is drawn: {document}");
    let description = description_of(&document);
    assert!(
        description.contains(
            "No measured sample of &quot;measurement&quot; lies inside the range \
             shown; the trace drawn for it is"
        ),
        "and is described as interpolated rather than as absent: {description:?}",
    );
    assert!(
        !description.contains("so none of it is drawn")
            && !description.contains("carries no points"),
        "a drawn trace is not called nothing: {description:?}",
    );
}

/// A marker sentence states the marker's own coordinate rather than the axis's.
///
/// The axis and this sentence do different jobs, and making them share a
/// precision makes one of them false. An axis end is a statement of a *display
/// range*, and `0 .. 100` printing whole numbers says how wide the view is
/// perfectly well. The sentence says where one line actually is -- so
/// inheriting the axis's rounding read a marker at `1.4` as being "at 1", an
/// exact-looking coordinate the figure does not draw it at, in the one place a
/// reader has no drawing to check it against.
#[test]
fn an_unlabelled_marker_keeps_its_own_coordinate() {
    let against_a_coarse_axis = |at: f64| {
        let panel = PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(label("Time"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 100.0),
            domain(0.0, 10.0),
            vec![series(vec![0.0, 100.0], vec![1.0, 2.0])],
        )
        .expect("a domain whose ends print as whole numbers")
        .with_markers(vec![Marker::new(at, None).expect("a marker inside it")])
        .expect("markers on a valid panel");
        description_of(&svg::render(&figure_of(panel)))
    };

    // The axis prints `0` and `100`. The marker is at neither, and says so.
    let fractional = against_a_coarse_axis(1.4);
    assert!(
        fractional.contains("at 1.4 on the Time axis"),
        "the marker's own coordinate survives a coarser axis: {fractional:?}",
    );
    assert!(
        !fractional.contains("at 1 on the Time axis"),
        "and the axis's rounding is not restated as its position: {fractional:?}",
    );

    // Precision grows only as far as the `f64` itself carries it. A whole
    // number is a whole number, and decimals it does not hold would be
    // invented ones.
    let integral = against_a_coarse_axis(50.0);
    assert!(
        integral.contains("at 50 on the Time axis"),
        "an ordinary whole-numbered marker gains no notation: {integral:?}",
    );

    // A value fixed point would round away to nothing keeps the exponent form
    // it already had: the same number, in the notation a reader can take in.
    let vanishing = against_a_coarse_axis(0.0001);
    assert!(
        vanishing.contains("at 1e-4 on the Time axis"),
        "a value the axis would print as zero stays distinguishable: {vanishing:?}",
    );

    // A domain too narrow for fixed point at all states every position as an
    // exponent, and the marker is still exactly itself.
    let narrow = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(1.0e-20, 4.0e-20),
        domain(0.0, 10.0),
        vec![series(vec![1.0e-20, 4.0e-20], vec![1.0, 2.0])],
    )
    .expect("a tiny domain")
    .with_markers(vec![
        Marker::new(2.5e-20, None).expect("a marker between its ends"),
    ])
    .expect("markers on a valid panel");
    let described = description_of(&svg::render(&figure_of(narrow)));
    assert!(
        described.contains("at 2.5e-20 on the Time axis"),
        "a tiny-domain marker remains distinguishable: {described:?}",
    );
}

/// Two distinct measurements are not merged by the way coordinates are written.
///
/// Geometry is serialized to a fixed number of decimals so that the same
/// specification produces the same bytes everywhere. Three decimals alone is
/// also a quantizer: on the narrowest figure the contract accepts, `0.5` and
/// `0.500001` of a `0 .. 1` domain both projected to `122.000`, so two
/// same-signed sticks were written at one x and the shorter vanished inside the
/// taller -- at every zoom, permanently, with nothing in the file to say a
/// measurement had been lost. `covered_marks` could not disclose it either: it
/// compares source positions, and these two never shared one.
#[test]
fn distinct_measurements_survive_coordinate_serialization() {
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 1.0),
        domain(0.0, 90.0),
        vec![series(vec![0.5, 0.500_001], vec![90.0, 40.0])],
    )
    .expect("two distinct m/z a hair apart");
    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(
                MIN_FIGURE_WIDTH,
                MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT,
            )
            .expect("the smallest figure the contract accepts"),
            vec![panel],
        )
        .expect("one panel"),
    );

    // Both sticks are drawn, and they are drawn at two coordinates.
    let drawn = path_data(&document);
    let xs: Vec<&str> = drawn
        .split('M')
        .skip(1)
        .filter_map(|command| command.split(' ').next())
        .collect();
    assert_eq!(xs.len(), 2, "both measurements are drawn: {drawn:?}");
    assert!(
        xs[0] != xs[1],
        "and they keep two positions rather than one: {xs:?}",
    );

    // Nothing is disclosed as hidden, because nothing is. The two marks never
    // shared a domain position, and now they do not share a serialized one
    // either -- so the words and the drawing agree.
    assert!(
        !description_of(&document).contains("hidden behind it"),
        "no covering is claimed for two separable marks: {document}",
    );

    // The precision is derived from the drawn geometry, so a figure that never
    // needed it is unchanged -- the readable default, byte for byte.
    let ordinary = svg::render(&figure_of(spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )));
    assert!(
        ordinary.contains("viewBox=\"0 0 900.000 500.000\""),
        "an ordinary figure keeps three decimals: {ordinary}",
    );
}

/// Every series says what it drew, not just the panel.
///
/// A panel is not one drawable thing. A measurement inside the window read
/// against a baseline the source left empty is a legitimate figure, and the
/// panel-wide test could not see it: the panel as a whole held points, so
/// nothing was said, while the description listed the baseline as present and
/// the drawing showed nothing for it. The file could then not tell an empty
/// reference line from one whose samples lie outside the window, from one drawn
/// and coincident with the measurement, from an ordinary one.
#[test]
fn an_undrawn_series_discloses_itself_in_a_mixed_panel() {
    let measured = || series(vec![4.0, 5.0, 6.0], vec![10.0, 20.0, 30.0]);
    let baseline = |scope: DataScope, x: Vec<f64>, y: Vec<f64>| {
        SeriesSpec::new(
            label("estimated background"),
            StyleRole::Baseline,
            scope,
            x,
            y,
        )
        .expect("a reference baseline")
    };
    let windowed = |against: SeriesSpec| {
        let panel = PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(label("Time"), UnitState::Unreported),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 10.0),
            domain(0.0, 30.0),
            vec![measured(), against],
        )
        .expect("a measurement read against a baseline")
        .with_visible_domain(domain(4.0, 6.0))
        .expect("a window holding every measured sample");
        svg::render(&figure_of(panel))
    };

    // An empty baseline. The panel draws the measurement, so no panel-wide
    // question could have reached this, and the baseline is listed as present
    // two sentences earlier.
    let document = windowed(baseline(DataScope::FullSource, Vec::new(), Vec::new()));
    let description = description_of(&document);
    assert_eq!(
        document.matches("<path ").count(),
        1,
        "the measurement is drawn and the baseline is not: {document}",
    );
    assert!(
        description.contains(
            "&quot;estimated background&quot; carries no points, so nothing is drawn \
             for it."
        ),
        "the empty baseline discloses itself, by name: {description:?}",
    );
    assert!(
        !description.contains("&quot;measurement&quot; carries no points"),
        "and the drawn measurement is not swept up with it: {description:?}",
    );

    // A baseline whose samples are all outside the window. Present, non-empty,
    // and still nothing on the page for it -- a different fact from the one
    // above, and it gets a different sentence.
    let description = description_of(&windowed(baseline(
        DataScope::FullSource,
        vec![0.0, 1.0],
        vec![1.0, 2.0],
    )));
    assert!(
        description.contains(
            "No measured point of &quot;estimated background&quot; lies inside the range \
             shown, so none of it is drawn."
        ),
        "a baseline outside the window says so: {description:?}",
    );
    assert!(
        !description.contains("&quot;estimated background&quot; carries no points"),
        "and is not confused with an empty one: {description:?}",
    );

    // A baseline whose segment crosses the window with neither end inside it.
    // This one *is* drawn, by interpolation, and must never be called absent.
    let document = windowed(baseline(
        DataScope::FullSource,
        vec![0.0, 10.0],
        vec![1.0, 2.0],
    ));
    let description = description_of(&document);
    assert_eq!(
        document.matches("<path ").count(),
        2,
        "the crossing baseline is drawn too: {document}",
    );
    assert!(
        description.contains(
            "No measured sample of &quot;estimated background&quot; lies inside the range \
             shown; the trace drawn for it is interpolated between samples outside it."
        ),
        "a crossing baseline is described as interpolated: {description:?}",
    );
    assert!(
        !description.contains("&quot;estimated background&quot; carries no points")
            && !description.contains(
                "No measured point of &quot;estimated background&quot; lies inside the \
                 range shown, so none of it is drawn."
            ),
        "and never as empty or undrawn: {description:?}",
    );

    // A reduced baseline with no retained point in the window. It carries what
    // it kept and a count of what that came from, and nothing about where the
    // dropped points were -- so the sentence stays inside what it retained.
    let description = description_of(&windowed(baseline(
        DataScope::Reduced {
            source_point_count: 900,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![0.0, 1.0],
        vec![1.0, 2.0],
    )));
    assert!(
        description.contains(
            "No point retained by the reduction for &quot;estimated background&quot; lies \
             inside the range shown, so none of it is drawn; whether the source held \
             measurements there is not recorded in this figure."
        ),
        "a reduction claims only what it retained: {description:?}",
    );
    assert!(
        !description.contains("No measured point of &quot;estimated background&quot;"),
        "and never the stronger claim a full source could make: {description:?}",
    );
}

/// Every figure colour clears the contrast floor its role needs.
///
/// The light baseline was `#9a9a9a` on white — 2.81:1, below the 3:1 WCAG asks
/// of a graphical object, and drawn as a one-unit hairline, so the reference
/// line a reader measures against was the least visible thing in the figure.
/// Checked for every role in both themes rather than for the one that was
/// wrong, because a palette is edited by eye and contrast is not visible to it.
#[test]
fn every_figure_colour_clears_the_contrast_floor() {
    fn channel(component: f64) -> f64 {
        if component <= 0.03928 {
            component / 12.92
        } else {
            ((component + 0.055) / 1.055).powf(2.4)
        }
    }
    fn luminance(colour: &str) -> f64 {
        let value = |at: usize| {
            f64::from(u8::from_str_radix(&colour[at..at + 2], 16).expect("a six-digit hex colour"))
                / 255.0
        };
        0.2126 * channel(value(1)) + 0.7152 * channel(value(3)) + 0.0722 * channel(value(5))
    }
    fn contrast(ink: &str, ground: &str) -> f64 {
        let (a, b) = (luminance(ink), luminance(ground));
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }

    for theme in [FigureTheme::Light, FigureTheme::Dark] {
        // Rendered rather than read from the palette, so this measures the
        // colours a file actually carries.
        let document = svg::render(
            &FigureSpec::new(
                theme,
                FigureSize::new(900.0, 500.0).expect("a size"),
                vec![
                    spectrum_panel(
                        SpectrumRepresentation::Centroid,
                        series(vec![100.0, 200.0], vec![10.0, 20.0]),
                    )
                    .with_markers(vec![
                        Marker::new(150.0, Some(label("precursor"))).expect("a marker"),
                    ])
                    .expect("markers on a valid panel"),
                ],
            )
            .expect("one panel"),
        );
        let ground = document
            .split("fill=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("the background rect names its fill")
            .to_owned();
        let mut inks: Vec<String> = Vec::new();
        for attribute in ["stroke=\"", "fill=\""] {
            for piece in document.split(attribute).skip(1) {
                let Some(colour) = piece.split('"').next() else {
                    continue;
                };
                if colour.starts_with('#') && colour != ground && !inks.iter().any(|c| c == colour)
                {
                    inks.push(colour.to_owned());
                }
            }
        }
        assert!(inks.len() >= 4, "the figure uses several colours: {inks:?}");
        for ink in &inks {
            let ratio = contrast(ink, &ground);
            assert!(
                ratio >= 3.0,
                "{ink} on {ground} is {ratio:.2}:1, below the 3:1 floor",
            );
        }
    }
}

/// A default title reads every panel, not only the first.
///
/// A linked chromatogram above a spectrum is the figure this contract exists to
/// make possible, and naming it after whichever panel sits at the top tells
/// anyone holding only the title -- a screen reader announcing the document, a
/// file browser, a reference manager -- that a mixed figure is one of its
/// halves.
#[test]
fn a_default_title_describes_the_whole_figure() {
    let chromatogram = || {
        PanelSpec::new(
            PlotKind::Chromatogram,
            AxisSpec::new(
                label("Retention time"),
                UnitState::Known { unit: label("min") },
            ),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(0.0, 10.0),
            domain(0.0, 100.0),
            vec![series(vec![0.0, 10.0], vec![1.0, 90.0])],
        )
        .expect("a chromatogram panel")
    };
    let spectrum = || {
        spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        )
    };
    let titled = |panels: Vec<PanelSpec>| {
        let document = svg::render(
            &FigureSpec::new(
                FigureTheme::Light,
                FigureSize::new(900.0, 500.0).expect("a size"),
                panels,
            )
            .expect("a figure"),
        );
        document
            .split("<title>")
            .nth(1)
            .and_then(|rest| rest.split("</title>").next())
            .expect("a title")
            .to_owned()
    };

    assert_eq!(titled(vec![chromatogram()]), "Chromatogram");
    assert_eq!(titled(vec![spectrum()]), "Mass spectrum");
    assert_eq!(titled(vec![chromatogram(), chromatogram()]), "Chromatogram");
    assert_eq!(titled(vec![spectrum(), spectrum()]), "Mass spectrum");
    // Mixed: neutral rather than invented. A combined name would have to decide
    // an order and a relationship the specification does not state.
    assert_eq!(titled(vec![chromatogram(), spectrum()]), "Figure");
    assert_eq!(titled(vec![spectrum(), chromatogram()]), "Figure");
}

/// A marker label stays inside the plotting area it annotates.
///
/// Left of the frame is the value axis's own gutter, where its caption is drawn
/// rotated through the whole plot height -- and that caption is written after
/// the markers, so a label allowed onto the page at large was covered by it.
#[test]
fn a_marker_label_stays_inside_the_plotting_area() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        // At the domain's low end, which is where a label is pushed leftwards.
        Marker::new(100.0, Some(label("precursor window"))).expect("a marker"),
    ])
    .expect("markers on a valid panel");
    let document = svg::render(
        &FigureSpec::new(
            FigureTheme::Light,
            FigureSize::new(
                MIN_FIGURE_WIDTH,
                MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT,
            )
            .expect("the smallest figure the contract accepts"),
            vec![panel],
        )
        .expect("one panel"),
    );

    // The renderer's own gutters for this figure.
    let (frame_left, frame_right) = (64.0, MIN_FIGURE_WIDTH - 20.0);
    let mut lines = 0;
    for piece in document.split("<tspan").skip(1) {
        let Some(head) = piece.split('>').next() else {
            continue;
        };
        let read = |name: &str| {
            head.split(name)
                .nth(1)
                .and_then(|rest| rest.split('"').next())
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or_else(|| panic!("{name} on {head}"))
        };
        let left = read("x=\"");
        let width = read("textLength=\"");
        lines += 1;
        assert!(
            left >= frame_left,
            "a label reached the value-axis gutter: {left} before {frame_left}",
        );
        assert!(
            left + width <= frame_right,
            "a label reached past the plot: {} after {frame_right}",
            left + width,
        );
    }
    assert!(lines > 0, "the label was drawn at all: {document}");
}

/// Two discrete measurements at one position are disclosed rather than hidden.
///
/// `SeriesSpec` accepts equal neighbouring domain values deliberately -- the
/// axis is non-decreasing, not strictly increasing -- so two sticks can be
/// drawn from the same baseline at the same x in the same colour, and the
/// shorter is inside the taller where nothing can see it.
#[test]
fn coincident_discrete_marks_are_disclosed() {
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 300.0),
        domain(0.0, 90.0),
        vec![series(
            vec![100.0, 200.0, 200.0, 300.0],
            vec![10.0, 40.0, 90.0, 20.0],
        )],
    )
    .expect("equal neighbouring m/z is accepted");

    let description = description_of(&svg::render(&figure_of(panel)));
    assert!(
        description.contains(
            "1 drawn point shares another at the same position on the domain axis and is \
             hidden behind it."
        ),
        "the covered measurement is named: {description:?}",
    );

    // Three at one position is two hidden, and the sentence agrees in number.
    let crowded = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 300.0),
        domain(0.0, 90.0),
        vec![series(
            vec![100.0, 200.0, 200.0, 200.0, 300.0],
            vec![10.0, 40.0, 90.0, 60.0, 20.0],
        )],
    )
    .expect("three at one position is accepted too");
    let description = description_of(&svg::render(&figure_of(crowded)));
    assert!(
        description.contains("2 drawn points share another at the same position"),
        "both covered measurements are counted: {description:?}",
    );

    // Opposite signs at one position are two sticks pointing opposite ways from
    // the zero line, with both ends visible. Sharing a position is not being
    // covered, and counting it that way put a number in the description the
    // drawing contradicts.
    let both_signs = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 300.0),
        domain(-40.0, 90.0),
        vec![series(
            vec![100.0, 200.0, 200.0, 300.0],
            vec![10.0, 40.0, -40.0, 20.0],
        )],
    )
    .expect("a peak and a negative excursion at one m/z");
    assert!(
        !description_of(&svg::render(&figure_of(both_signs))).contains("hidden behind it"),
        "sticks pointing opposite ways do not cover each other",
    );

    // A measured zero draws a horizontal tick on the zero line, which a
    // vertical stick only touches.
    let zero_beside_peak = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 300.0),
        domain(0.0, 90.0),
        vec![series(
            vec![100.0, 200.0, 200.0, 300.0],
            vec![10.0, 90.0, 0.0, 20.0],
        )],
    )
    .expect("a zero beside a peak at one m/z");
    assert!(
        !description_of(&svg::render(&figure_of(zero_beside_peak))).contains("hidden behind it"),
        "a zero tick is not covered by a stick that only touches it",
    );

    // A trace joins its samples rather than stacking marks, so nothing is
    // hidden and nothing is claimed.
    let joined = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 3.0),
        domain(0.0, 90.0),
        vec![series(
            vec![0.0, 1.0, 1.0, 3.0],
            vec![10.0, 40.0, 90.0, 20.0],
        )],
    )
    .expect("a trace");
    assert!(
        !description_of(&svg::render(&figure_of(joined))).contains("hidden behind it"),
        "a joined trace hides nothing",
    );

    // And an ordinary spectrum says nothing about it at all.
    assert!(
        !description_of(&svg::render(&figure_of(spectrum_panel(
            SpectrumRepresentation::Centroid,
            series(vec![100.0, 200.0], vec![10.0, 20.0]),
        ))))
        .contains("same position"),
        "distinct positions are not remarked on",
    );
}

/// A reduction of a non-empty source cannot have kept nothing.
///
/// Both named rules keep at least one extreme from every column holding a
/// source point, so an empty retained series from a non-empty source is a state
/// the declared rule cannot produce -- and the figure would report it as one.
#[test]
fn a_reduction_of_a_non_empty_source_keeps_something() {
    let empty_reduction = |source: usize| {
        SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::Reduced {
                source_point_count: source,
                rule: ReductionRule::MinMaxPerColumn,
            },
            Vec::new(),
            Vec::new(),
        )
    };

    assert_eq!(
        empty_reduction(500).unwrap_err(),
        SpecError::ReductionKeptNothing,
        "500 points do not reduce to none under either rule",
    );
    assert_eq!(
        empty_reduction(1).unwrap_err(),
        SpecError::ReductionKeptNothing,
        "nor does one",
    );
    // An empty series is still representable; its scope is what it actually is.
    assert!(
        SeriesSpec::new(
            label("measurement"),
            StyleRole::Measurement,
            DataScope::FullSource,
            Vec::new(),
            Vec::new(),
        )
        .is_ok(),
        "an empty full source is a real scene",
    );
}

/// The zero-baseline rule follows the series drawn, not the panel kind.
///
/// A baseline is a joined reference line whatever the panel draws, so a panel
/// holding only one -- or whose measurement series is empty -- draws nothing
/// from the zero line and may be zoomed like any other trace. Asking the kind
/// refused those figures for a mark that was never going to be drawn, while the
/// rule exists for the mark whose length would lie.
#[test]
fn the_zero_baseline_rule_asks_which_series_are_drawn_from_zero() {
    let panel = |series: Vec<SeriesSpec>| {
        PanelSpec::new(
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Centroid,
            },
            AxisSpec::new(label("m/z"), UnitState::Dimensionless),
            AxisSpec::new(label("Intensity"), UnitState::Unreported),
            domain(100.0, 200.0),
            Domain::new(5.0, 10.0).expect("a range excluding zero"),
            series,
        )
    };
    let baseline = SeriesSpec::new(
        label("background"),
        StyleRole::Baseline,
        DataScope::FullSource,
        vec![100.0, 200.0],
        vec![6.0, 7.0],
    )
    .expect("a baseline");

    assert!(
        panel(vec![baseline.clone()]).is_ok(),
        "a panel of only a joined baseline may be zoomed away from zero",
    );
    assert!(
        panel(vec![
            SeriesSpec::new(
                label("measurement"),
                StyleRole::Measurement,
                DataScope::FullSource,
                Vec::new(),
                Vec::new(),
            )
            .expect("an empty measurement"),
            baseline,
        ])
        .is_ok(),
        "an empty measurement draws no mark whose length could lie",
    );

    // And the rule still holds where a mark really is drawn from zero: this is
    // the figure it was written for, where a stick at 5 against 5..10 comes out
    // with no length at all.
    assert_eq!(
        panel(vec![
            SeriesSpec::new(
                label("measurement"),
                StyleRole::Measurement,
                DataScope::FullSource,
                vec![100.0, 200.0],
                vec![5.0, 9.0],
            )
            .expect("a measurement"),
        ])
        .unwrap_err(),
        SpecError::BaselineOutsideValueDomain,
        "a drawn stick still needs its baseline",
    );
}

/// An all-zero claim accounts for what clipping interpolates.
///
/// A window whose only samples are zero can still draw a line that is not:
/// clipping interpolates at the edge, so a segment running out to a non-zero
/// neighbour rises away from the axis inside the window while every sample in
/// it reads zero.
#[test]
fn an_interpolated_rise_is_not_described_as_all_zero() {
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(-1.0, 2.0),
        domain(0.0, 5.0),
        vec![series(vec![-1.0, 0.0, 2.0], vec![5.0, 0.0, 5.0])],
    )
    .expect("a trace dipping to zero")
    .with_visible_domain(domain(0.0, 1.0))
    .expect("a window from the dip");

    let description = description_of(&svg::render(&figure_of(panel)));
    assert!(
        !description.contains("Every drawn value is zero."),
        "the drawn line rises to 2.5 inside this window: {description:?}",
    );

    // A window that really is all zero still says so.
    let flat = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 3.0),
        domain(0.0, 5.0),
        vec![series(vec![0.0, 1.0, 2.0, 3.0], vec![0.0, 0.0, 0.0, 0.0])],
    )
    .expect("a flat zero trace");
    assert!(
        description_of(&svg::render(&figure_of(flat))).contains("Every drawn value is zero."),
        "a genuinely zero trace is still disclosed",
    );
}

/// A reduction does not claim to know where its dropped points were.
///
/// `DataScope::Reduced` carries the points kept and a count of what they came
/// from, and nothing about the positions of the rest -- so "no measured point
/// lies inside the range shown" is a claim the figure cannot support. A
/// whole-domain reduction can keep one column's extreme and drop real
/// measurements inside a window that then looks empty.
#[test]
fn an_empty_window_of_a_reduction_claims_only_what_it_retained() {
    let reduced = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 900,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![0.0, 1.0],
        vec![10.0, 20.0],
    )
    .expect("a reduction");
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 1.0),
        domain(0.0, 20.0),
        vec![reduced],
    )
    .expect("a panel")
    .with_visible_domain(domain(0.4, 0.6))
    .expect("a window between the retained points");

    let description = description_of(&svg::render(&figure_of(panel)));
    assert!(
        description.contains(
            "No point retained by the reduction for &quot;measurement&quot; lies inside \
             the range shown"
        ),
        "the sentence is about what was retained, and names the series: {description:?}",
    );
    assert!(
        description.contains("not") && description.contains("recorded in this figure"),
        "and says the source is not answerable from here: {description:?}",
    );
    assert!(
        !description.contains("No measured point of &quot;measurement&quot; lies inside"),
        "which is more than a reduction can prove: {description:?}",
    );

    // A full-source series can prove it, and still says the stronger thing.
    let whole = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![0.0, 1.0], vec![10.0, 20.0]),
    )
    .with_visible_domain(domain(0.4, 0.6))
    .expect("a window between the points");
    assert!(
        description_of(&svg::render(&figure_of(whole)))
            .contains("No measured point of &quot;measurement&quot; lies inside the range shown"),
        "a full source carries every point it had",
    );
}

/// A marker with no label is still disclosed as an annotation.
///
/// `Marker::new(at, None)` is a legitimate way to mark a persistent selection,
/// and the renderer draws a dashed rule for it. Saying nothing left a mark a
/// sighted reader can see and a screen-reader user cannot know exists.
#[test]
fn an_unlabelled_marker_is_named_in_the_description() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, None).expect("a marker with no label"),
    ])
    .expect("markers on a valid panel");
    let document = svg::render(&figure_of(panel));
    assert!(
        document.contains("stroke-dasharray"),
        "the rule is drawn: {document}",
    );
    let description = description_of(&document);
    assert!(
        description.contains("One marker line is drawn without a label, at 150")
            && description.contains("on the m/z axis."),
        "and the description accounts for it: {description:?}",
    );

    // Two of them are counted and both positions given.
    let two = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(120.0, None).expect("a marker"),
        Marker::new(180.0, None).expect("a second marker"),
    ])
    .expect("markers on a valid panel");
    assert!(
        description_of(&svg::render(&figure_of(two)))
            .contains("2 marker lines are drawn without labels, at 120"),
        "both are counted",
    );

    // A marker outside the drawn window draws no line, so nothing is claimed.
    let windowed = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![Marker::new(110.0, None).expect("a marker")])
    .expect("markers on a valid panel")
    .with_visible_domain(domain(150.0, 200.0))
    .expect("a window past the marker");
    assert!(
        !description_of(&svg::render(&figure_of(windowed))).contains("without a label"),
        "a marker the figure does not draw is not described",
    );

    // A labelled marker keeps its own treatment and is not counted here.
    let labelled = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, Some(label("precursor"))).expect("a marker"),
    ])
    .expect("markers on a valid panel");
    assert!(
        !description_of(&svg::render(&figure_of(labelled))).contains("without a label"),
        "a labelled marker speaks for itself",
    );
}

/// The crossing sentence describes the series that actually crosses.
///
/// Asking "does any series cross the window" and "is any series reduced"
/// separately let a full-source baseline draw the line while a reduced
/// measurement supplied the word "retained" -- the drawing described with the
/// other series' semantics.
#[test]
fn the_crossing_sentence_reads_the_scope_of_the_series_that_crosses() {
    let reduced_measurement = SeriesSpec::new(
        label("measurement"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 900,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![0.0, 10.0],
        vec![10.0, 20.0],
    )
    .expect("a reduction whose points sit outside the window");
    let whole_baseline = SeriesSpec::new(
        label("background"),
        StyleRole::Baseline,
        DataScope::FullSource,
        vec![0.0, 10.0],
        vec![1.0, 2.0],
    )
    .expect("a full-source baseline spanning the window");
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 20.0),
        vec![reduced_measurement, whole_baseline],
    )
    .expect("a panel")
    .with_visible_domain(domain(4.0, 6.0))
    .expect("a window between every point");

    let description = description_of(&svg::render(&figure_of(panel)));
    // The baseline is what crosses, and it is full source, so the sentence must
    // be about samples rather than about retained points.
    assert!(
        description
            .contains("No measured sample of &quot;background&quot; lies inside the range shown"),
        "the crossing series is full source, and is named: {description:?}",
    );
    assert!(
        !description.contains("interpolated between retained points"),
        "so the reduction's wording does not describe it: {description:?}",
    );
}

/// A marker position is written the way its own axis writes numbers.
///
/// The axis ends escalate precision and fall back to exponent notation; the
/// marker sentence formatted at a fixed six decimals and did neither. Against
/// `1e-20 .. 4e-20` the ends print as exponents while a line at `2e-20` was
/// described as being at `0.000000` -- a coordinate the figure does not draw it
/// at, in a `<desc>` that contradicts the axis printed beside it.
#[test]
fn an_unlabelled_marker_position_uses_the_axis_notation() {
    let tiny = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        Domain::new(1.0e-20, 4.0e-20).expect("a tiny domain"),
        domain(0.0, 10.0),
        vec![series(vec![1.0e-20, 4.0e-20], vec![1.0, 2.0])],
    )
    .expect("a panel over a tiny domain")
    .with_markers(vec![
        Marker::new(2.0e-20, None).expect("a marker inside it"),
    ])
    .expect("markers on a valid panel");

    let document = svg::render(&figure_of(tiny));
    let description = description_of(&document);
    assert!(
        description.contains("at 2e-20 on the Time axis"),
        "the marker is described where it is drawn: {description:?}",
    );
    assert!(
        !description.contains("at 0.000000"),
        "and never rounded away to a position it is not at: {description:?}",
    );
    // The axis itself is in the same notation, which is the point: the sentence
    // and the printed axis must not disagree.
    assert!(
        document.contains(">1e-20<") && document.contains(">4e-20<"),
        "the axis ends are exponents too: {document}",
    );

    // A value fixed point would round away escalates even where the axis ends
    // did not need to: `0 .. 100` prints no decimals at all.
    let coarse = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 100.0),
        domain(0.0, 10.0),
        vec![series(vec![0.0, 100.0], vec![1.0, 2.0])],
    )
    .expect("a coarse domain")
    .with_markers(vec![
        Marker::new(0.0001, None).expect("a marker just off the origin"),
    ])
    .expect("markers on a valid panel");
    let description = description_of(&svg::render(&figure_of(coarse)));
    assert!(
        description.contains("at 1e-4 on the Time axis"),
        "a marker fixed point would lose escalates on its own: {description:?}",
    );

    // An ordinary axis is unaffected and stays in plain fixed point.
    let ordinary = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![Marker::new(150.0, None).expect("a marker")])
    .expect("markers on a valid panel");
    assert!(
        description_of(&svg::render(&figure_of(ordinary))).contains("at 150 on the m/z axis"),
        "an ordinary position is not dressed up as an exponent",
    );
}

/// A reduction disclosure names the series whose facts it states.
///
/// A panel may hold a measurement and the baseline it is read against and
/// reduce only one of them. Counts with no owner leave a reader unable to tell
/// which trace was reduced, and listing both series in an earlier sentence does
/// not attach either to these numbers.
#[test]
fn a_reduction_disclosure_names_its_own_series() {
    let reduced_baseline = SeriesSpec::new(
        label("estimated background"),
        StyleRole::Baseline,
        DataScope::Reduced {
            source_point_count: 900,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![100.0, 200.0],
        vec![1.0, 2.0],
    )
    .expect("a reduced baseline");
    let whole_measurement = SeriesSpec::new(
        label("sample intensity"),
        StyleRole::Measurement,
        DataScope::FullSource,
        vec![100.0, 150.0, 200.0],
        vec![10.0, 40.0, 20.0],
    )
    .expect("a full-source measurement");
    let panel = PanelSpec::new(
        PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        AxisSpec::new(label("m/z"), UnitState::Dimensionless),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(100.0, 200.0),
        domain(0.0, 40.0),
        vec![whole_measurement, reduced_baseline],
    )
    .expect("a panel of two series, one reduced");

    let description = description_of(&svg::render(&figure_of(panel)));
    // The reduced one is the baseline, and the sentence must say so.
    assert!(
        description.contains(
            "&quot;estimated background&quot; is drawn from 900 source points reduced to 2"
        ),
        "the reduction names the series it describes: {description:?}",
    );
    // The measurement, which was not reduced, is not implicated.
    assert!(
        !description.contains("&quot;sample intensity&quot; is drawn from 900"),
        "the full-source series is not described as reduced: {description:?}",
    );
    // And the bare, ownerless form is gone.
    assert!(
        !description.contains("Drawn from 900 source points reduced to"),
        "no reduction sentence is left without an owner: {description:?}",
    );
}

/// Every crossing joined series gets its own crossing disclosure.
///
/// Two joined series can both straddle a window with neither's samples inside
/// it -- a measurement and the baseline it is read against, coarsely sampled --
/// and the renderer draws both. Describing only the first left the second's
/// interpolation and scope entirely unstated.
#[test]
fn every_crossing_series_is_disclosed_with_its_own_scope() {
    let reduced_measurement = SeriesSpec::new(
        label("sample intensity"),
        StyleRole::Measurement,
        DataScope::Reduced {
            source_point_count: 900,
            rule: ReductionRule::MinMaxPerColumn,
        },
        vec![0.0, 10.0],
        vec![10.0, 20.0],
    )
    .expect("a reduced measurement spanning the window");
    let whole_baseline = SeriesSpec::new(
        label("estimated background"),
        StyleRole::Baseline,
        DataScope::FullSource,
        vec![0.0, 10.0],
        vec![1.0, 2.0],
    )
    .expect("a full-source baseline spanning the window");
    let panel = PanelSpec::new(
        PlotKind::Chromatogram,
        AxisSpec::new(label("Time"), UnitState::Unreported),
        AxisSpec::new(label("Intensity"), UnitState::Unreported),
        domain(0.0, 10.0),
        domain(0.0, 20.0),
        vec![reduced_measurement, whole_baseline],
    )
    .expect("a panel of two crossing traces")
    .with_visible_domain(domain(4.0, 6.0))
    .expect("a window between every sample");

    let document = svg::render(&figure_of(panel));
    // Both traces really are drawn, which is what makes one sentence wrong.
    assert_eq!(
        document.matches("<path ").count(),
        2,
        "two traces cross this window: {document}",
    );
    let description = description_of(&document);

    // Each is named, and each reads its own scope: the measurement is reduced,
    // the baseline is not.
    assert!(
        description.contains("No point retained by the reduction for &quot;sample intensity&quot; lies inside the range shown"),
        "the reduced series is disclosed as a reduction: {description:?}",
    );
    assert!(
        description.contains(
            "No measured sample of &quot;estimated background&quot; lies inside the range shown"
        ),
        "and the full-source series as measured samples: {description:?}",
    );
    // Neither borrows the other's scope.
    assert!(
        !description.contains(
            "No measured sample of &quot;sample intensity&quot; lies inside the range shown"
        ) && !description
            .contains("No point retained by the reduction for &quot;estimated background&quot;"),
        "no series is described with the other semantics: {description:?}",
    );
    // Two disclosures, not one collapsed singular sentence.
    assert_eq!(
        description.matches("lies inside the range shown").count(),
        2,
        "one sentence per crossing series: {description:?}",
    );
}
