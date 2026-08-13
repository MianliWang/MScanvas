//! Deterministic tests for the semantic contract and its SVG renderer.

use crate::spec::{
    AxisSpec, Caption, DataScope, DecodeError, Domain, FigureSize, FigureSpec, FigureTheme, Label,
    MAX_LABEL_CHARS, Marker, PanelSpec, PlotKind, ReductionRule, SCHEMA_VERSION, SeriesSpec,
    SpecError, SpectrumRepresentation, StyleRole, UnitState,
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
    let size = FigureSize::new(100.0, 100.0).expect("a size");
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
    assert!(document.contains("<desc>Given description.</desc>"));

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

#[test]
fn a_marker_outside_the_drawn_domain_is_not_drawn() {
    let panel = spectrum_panel(
        SpectrumRepresentation::Centroid,
        series(vec![100.0, 200.0], vec![10.0, 20.0]),
    )
    .with_markers(vec![
        Marker::new(150.0, Some(label("inside"))).expect("a marker"),
        Marker::new(900.0, Some(label("outside"))).expect("a marker"),
    ]);
    let document = svg::render(&figure_of(panel));

    assert!(document.contains("inside"));
    assert!(
        !document.contains("outside"),
        "a marker beyond the domain is not placed at the edge",
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
