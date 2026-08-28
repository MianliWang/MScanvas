use mscanvas_proteowizard::SelectedSpectrumResult;

use mscanvas_plot_spec::spec::{
    MeasurementRefusal, SpecError, measurement_domains, validate_measurement_coordinates,
};

use super::super::dto::MAX_SPECTRUM_POINTS;
use super::{
    DomainRefusal, MAX_PROJECTION_COLUMNS, MAX_PROJECTION_POINTS, ProjectionRefusal,
    ViewportDomain, project, viewport_domain,
};

fn spectrum(points: &[(f64, f64)]) -> SelectedSpectrumResult {
    SelectedSpectrumResult::from_points_for_tests(
        0,
        points.iter().map(|point| point.0).collect(),
        points.iter().map(|point| point.1).collect(),
    )
}

/// An ascending spectrum, `count` points wide, over `100.0 ..= 100.0 + count`.
fn ascending(count: usize) -> SelectedSpectrumResult {
    let points: Vec<(f64, f64)> = (0..count)
        .map(|step| {
            #[expect(
                clippy::cast_precision_loss,
                reason = "test sizes are far below the f64 integer bound"
            )]
            let offset = step as f64;
            (100.0 + offset, offset)
        })
        .collect();
    spectrum(&points)
}

fn admitted(spectrum: &SelectedSpectrumResult) -> (f64, f64) {
    match viewport_domain(spectrum) {
        ViewportDomain::Admitted(domain) => (domain.low(), domain.high()),
        ViewportDomain::Refused(refusal) => panic!("expected an admitted domain: {refusal:?}"),
    }
}

#[test]
fn an_ordered_spectrum_admits_the_domain_its_own_points_span() {
    let spectrum = spectrum(&[(100.0, 1.0), (250.5, 9.0), (400.0, 3.0)]);

    assert_eq!(admitted(&spectrum), (100.0, 400.0));
}

#[test]
fn the_admitted_domain_is_the_points_and_never_the_reported_pair() {
    // `from_points_for_tests` derives the reported pair from the points, so this
    // asserts the relationship the export renderer documents rather than a
    // disagreement a fixture could fabricate: the domain is the first and last
    // *ordered point*, which is what `domain_of` takes for the figure.
    let spectrum = spectrum(&[(120.0, 1.0), (880.0, 2.0)]);

    assert_eq!(admitted(&spectrum), (120.0, 880.0));
    assert_eq!(admitted(&spectrum), (spectrum.mz_low(), spectrum.mz_high()));
}

#[test]
fn a_descending_m_z_array_is_refused_rather_than_sorted() {
    // mzML does not require an ordered array and nothing here sorts one. The
    // figure contract refuses the series; so does the viewport.
    let spectrum = spectrum(&[(500.0, 1000.0), (100.0, 9000.0)]);

    assert_eq!(
        viewport_domain(&spectrum),
        ViewportDomain::Refused(DomainRefusal::SourceNotOrdered),
    );
    // And the source is untouched by having been asked.
    assert_eq!(spectrum.mz_values(), &[500.0, 100.0]);
}

#[test]
fn a_value_range_the_figure_cannot_draw_refuses_the_viewport() {
    // Coordinate validity alone is not drawability. Every value here is finite
    // and the m/z array is ordered, so the coordinate rules pass -- but the
    // intensity axis spans `f64::MAX - (-f64::MAX)`, which is infinity, and a
    // renderer dividing by it writes `NaN`. The figure contract refuses such a
    // spectrum, so the viewport refuses it too rather than claiming a scene the
    // exported figure will not draw.
    let spectrum = spectrum(&[(100.0, -f64::MAX), (200.0, f64::MAX)]);

    assert_eq!(
        viewport_domain(&spectrum),
        ViewportDomain::Refused(DomainRefusal::ValueDomainUnusable),
        "the intensity axis is why, and the refusal says so",
    );
}

#[test]
fn the_shared_predicate_is_what_refuses_that_value_range() {
    // Asserted against the predicate itself, so the viewport's verdict and the
    // figure's are demonstrably the same call rather than two that agree today.
    let mz = [100.0, 200.0];
    let intensity = [-f64::MAX, f64::MAX];

    assert_eq!(
        measurement_domains(&mz, &intensity),
        Err(MeasurementRefusal::ValueDomain(
            SpecError::DomainSpanNotFinite
        )),
    );
    // And the coordinates themselves are beyond reproach.
    assert!(validate_measurement_coordinates(&mz, &intensity).is_ok());
}

#[test]
fn a_spectrum_the_figure_will_not_draw_is_projected_not_at_all() {
    let spectrum = spectrum(&[(100.0, -f64::MAX), (200.0, f64::MAX)]);

    assert_eq!(
        project(&spectrum, 100.0, 200.0),
        Err(ProjectionRefusal::NoViewportDomain(
            DomainRefusal::ValueDomainUnusable
        )),
    );
    // The source is untouched by having been asked.
    assert_eq!(spectrum.mz_values(), &[100.0, 200.0]);
    assert_eq!(spectrum.intensity_values(), &[-f64::MAX, f64::MAX]);
}

#[test]
fn an_empty_spectrum_admits_the_domain_that_claims_nothing() {
    // The same answer the exported figure gets for a spectrum with no points:
    // a single value at zero, so the two never describe different scenes.
    assert_eq!(admitted(&spectrum(&[])), (0.0, 0.0));
}

#[test]
fn a_one_point_spectrum_admits_a_single_valued_domain() {
    assert_eq!(admitted(&spectrum(&[(342.5, 7.0)])), (342.5, 342.5));
}

#[test]
fn a_window_the_source_does_not_have_is_refused_rather_than_clamped() {
    let spectrum = ascending(16);
    let (low, high) = admitted(&spectrum);

    for (asked_low, asked_high, what) in [
        (low - 1.0, high, "below the source"),
        (low, high + 1.0, "above the source"),
        (low - 5.0, high + 5.0, "outside on both sides"),
    ] {
        assert_eq!(
            project(&spectrum, asked_low, asked_high),
            Err(ProjectionRefusal::WindowOutsideSource),
            "{what}",
        );
    }
}

#[test]
fn a_window_that_is_not_an_interval_is_refused() {
    let spectrum = ascending(8);

    assert_eq!(
        project(&spectrum, 110.0, 105.0),
        Err(ProjectionRefusal::WindowUnusable),
    );
    assert_eq!(
        project(&spectrum, f64::NAN, 105.0),
        Err(ProjectionRefusal::WindowUnusable),
    );
}

#[test]
fn a_spectrum_with_no_viewport_domain_projects_nothing() {
    let spectrum = spectrum(&[(500.0, 1.0), (100.0, 2.0)]);

    assert_eq!(
        project(&spectrum, 100.0, 500.0),
        Err(ProjectionRefusal::NoViewportDomain(
            DomainRefusal::SourceNotOrdered
        )),
    );
}

#[test]
fn a_window_inside_the_budget_is_drawn_exactly() {
    let spectrum = spectrum(&[
        (100.0, 1.0),
        (200.0, 2.0),
        (300.0, 3.0),
        (400.0, 4.0),
        (500.0, 5.0),
    ]);

    let projection = project(&spectrum, 200.0, 400.0).expect("a window inside the source");

    assert_eq!(projection.mz(), &[200.0, 300.0, 400.0]);
    assert_eq!(projection.intensity(), &[2.0, 3.0, 4.0]);
    assert_eq!(projection.source_points(), 3);
    assert!(!projection.reduced(), "nothing was dropped");
    assert!(!projection.is_empty());
}

#[test]
fn both_window_edges_are_inside_the_window() {
    let spectrum = spectrum(&[(10.0, 1.0), (20.0, 2.0), (30.0, 3.0)]);

    let projection = project(&spectrum, 10.0, 30.0).expect("the whole source");

    assert_eq!(projection.mz(), &[10.0, 20.0, 30.0]);
}

#[test]
fn a_window_holding_no_reported_point_is_a_successful_empty_projection() {
    // Nothing is interpolated to avoid saying so: a discrete spectrum has no
    // value between two of its own measurements.
    let spectrum = spectrum(&[(100.0, 1.0), (500.0, 2.0)]);

    let projection = project(&spectrum, 200.0, 300.0).expect("a window of the source");

    assert!(projection.is_empty());
    assert!(projection.mz().is_empty());
    assert!(projection.intensity().is_empty());
    assert_eq!(projection.source_points(), 0);
    assert!(!projection.reduced(), "an empty window dropped nothing");
}

#[test]
fn a_window_over_the_budget_is_reduced_within_the_bound() {
    let spectrum = ascending(MAX_PROJECTION_POINTS * 4);
    let (low, high) = admitted(&spectrum);

    let projection = project(&spectrum, low, high).expect("the whole source");

    assert!(
        projection.mz().len() <= MAX_PROJECTION_POINTS,
        "drew {} points, bound is {MAX_PROJECTION_POINTS}",
        projection.mz().len(),
    );
    assert_eq!(projection.source_points(), MAX_PROJECTION_POINTS * 4);
    assert!(projection.reduced());
    assert_eq!(projection.mz().len(), projection.intensity().len());
}

#[test]
fn every_reduced_point_is_a_point_the_source_measured() {
    let spectrum = ascending(MAX_PROJECTION_POINTS * 3);
    let (low, high) = admitted(&spectrum);
    let source: Vec<(f64, f64)> = spectrum
        .mz_values()
        .iter()
        .copied()
        .zip(spectrum.intensity_values().iter().copied())
        .collect();

    let projection = project(&spectrum, low, high).expect("the whole source");

    assert!(projection.reduced());
    for pair in projection
        .mz()
        .iter()
        .copied()
        .zip(projection.intensity().iter().copied())
    {
        assert!(
            source.contains(&pair),
            "{pair:?} is not a measurement of this spectrum",
        );
    }
}

#[test]
fn a_reduction_keeps_the_tallest_peak_rather_than_a_neighbour() {
    // One conspicuous peak inside a source far larger than the budget. A rule
    // that sampled, averaged or took whichever point a column happened to visit
    // first would lose it.
    let count = MAX_PROJECTION_POINTS * 4;
    let mut points: Vec<(f64, f64)> = (0..count)
        .map(|step| {
            #[expect(
                clippy::cast_precision_loss,
                reason = "test sizes are far below the f64 integer bound"
            )]
            let offset = step as f64;
            (100.0 + offset, 1.0)
        })
        .collect();
    let peak = points[count / 2];
    points[count / 2] = (peak.0, 9_000.0);
    let spectrum = spectrum(&points);
    let (low, high) = admitted(&spectrum);

    let projection = project(&spectrum, low, high).expect("the whole source");

    let drawn: Vec<(f64, f64)> = projection
        .mz()
        .iter()
        .copied()
        .zip(projection.intensity().iter().copied())
        .collect();
    assert!(
        drawn.contains(&(peak.0, 9_000.0)),
        "the tallest measurement was replaced by a neighbour",
    );
}

#[test]
fn a_reduction_keeps_measured_signal_of_both_signs() {
    // A column holding a positive and a negative observation must draw both:
    // keeping only the larger magnitude erases measured signal of the other
    // sign, which is the defect the stick renderer's own rule exists to avoid.
    let count = MAX_PROJECTION_POINTS * 4;
    let points: Vec<(f64, f64)> = (0..count)
        .map(|step| {
            #[expect(
                clippy::cast_precision_loss,
                reason = "test sizes are far below the f64 integer bound"
            )]
            let offset = step as f64;
            let height = if step % 2 == 0 { 5.0 } else { -7.0 };
            (100.0 + offset, height)
        })
        .collect();
    let spectrum = spectrum(&points);
    let (low, high) = admitted(&spectrum);

    let projection = project(&spectrum, low, high).expect("the whole source");

    assert!(
        projection.intensity().iter().any(|value| *value > 0.0),
        "positive signal was dropped",
    );
    assert!(
        projection.intensity().iter().any(|value| *value < 0.0),
        "negative signal was dropped",
    );
}

#[test]
fn a_reduction_is_ordered_by_measured_m_z() {
    let spectrum = ascending(MAX_PROJECTION_POINTS * 3);
    let (low, high) = admitted(&spectrum);

    let projection = project(&spectrum, low, high).expect("the whole source");

    assert!(
        projection.mz().windows(2).all(|pair| pair[0] <= pair[1]),
        "the drawing is not a series the ordering rule would admit",
    );
}

#[test]
fn a_projection_is_deterministic() {
    let spectrum = ascending(MAX_PROJECTION_POINTS * 5);
    let (low, high) = admitted(&spectrum);

    let first = project(&spectrum, low, high).expect("the whole source");
    let second = project(&spectrum, low, high).expect("the whole source");

    assert_eq!(first, second);
}

#[test]
fn zooming_in_reveals_detail_the_overview_had_to_drop() {
    // The property the whole contract exists for: a narrower committed window is
    // re-projected from the source, so it is not a zoom into an already-reduced
    // overview.
    let spectrum = ascending(MAX_PROJECTION_POINTS * 8);
    let (low, high) = admitted(&spectrum);
    let overview = project(&spectrum, low, high).expect("the whole source");

    let narrow_high = low + (high - low) / 100.0;
    let zoomed = project(&spectrum, low, narrow_high).expect("a narrower window");

    let overview_inside = overview
        .mz()
        .iter()
        .filter(|value| **value <= narrow_high)
        .count();
    assert!(
        zoomed.mz().len() > overview_inside,
        "zooming showed {} points where the overview had {overview_inside}",
        zoomed.mz().len(),
    );
    assert!(
        !zoomed.reduced(),
        "the narrow window fits the budget exactly"
    );
}

#[test]
fn a_window_past_any_transfer_prefix_draws_the_retained_source() {
    // The defect the whole contract exists to make impossible. The webview's
    // copy of a spectrum stops at `MAX_SPECTRUM_POINTS`; a viewport spanning
    // the complete domain while its data stopped there would show blank space
    // over peaks this session is holding.
    //
    // Built directly rather than parsed, because the text bound refuses a
    // spectrum this large before the transfer bound could apply -- see
    // `the_transfer_bound_is_unreachable_because_the_text_bound_refuses_first`.
    let count = MAX_SPECTRUM_POINTS + 5_000;
    let spectrum = ascending(count);
    let (low, high) = admitted(&spectrum);

    #[expect(
        clippy::cast_precision_loss,
        reason = "test sizes are far below the f64 integer bound"
    )]
    let past_prefix = 100.0 + MAX_SPECTRUM_POINTS as f64;
    assert!(past_prefix > low && past_prefix <= high);

    let projection = project(&spectrum, past_prefix, high).expect("a window the source has");

    assert!(
        !projection.is_empty(),
        "a window past the transfer prefix drew nothing",
    );
    assert!(
        projection.mz().iter().all(|value| *value >= past_prefix),
        "the drawing reached back before the window",
    );
    assert_eq!(projection.source_points(), 5_000);
    // And the domain itself spans the whole source rather than the prefix.
    #[expect(
        clippy::cast_precision_loss,
        reason = "test sizes are far below the f64 integer bound"
    )]
    let complete_high = 100.0 + (count - 1) as f64;
    assert_eq!(high, complete_high);
}

#[test]
fn the_column_bound_is_the_only_thing_that_grows_with_a_larger_source() {
    // Ten times the points, the same bounded payload.
    let small = ascending(MAX_PROJECTION_POINTS * 2);
    let large = ascending(MAX_PROJECTION_POINTS * 20);

    let (small_low, small_high) = admitted(&small);
    let (large_low, large_high) = admitted(&large);
    let small = project(&small, small_low, small_high).expect("the whole source");
    let large = project(&large, large_low, large_high).expect("the whole source");

    assert!(small.mz().len() <= MAX_PROJECTION_POINTS);
    assert!(large.mz().len() <= MAX_PROJECTION_POINTS);
    assert_eq!(MAX_PROJECTION_POINTS, MAX_PROJECTION_COLUMNS * 2);
}
