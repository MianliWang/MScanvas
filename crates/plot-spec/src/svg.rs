//! An export-grade SVG renderer for [`FigureSpec`].
//!
//! One direction only: this module reads the specification and the
//! specification knows nothing about this module. What comes out is a complete
//! standalone document -- explicit dimensions, a `viewBox`, real vector text,
//! its own palette -- and nothing in it depends on an application window
//! existing, a stylesheet being loaded, or a browser having painted anything.
//!
//! ## What it deliberately does not do
//!
//! It does not read the application's theme, does not emit a class attribute
//! any application stylesheet could reach, does not reference an external file
//! or URL, and does not embed a bitmap. A figure whose only plot content were a
//! screenshot would be a picture of this product rather than a figure of the
//! measurement.

use crate::spec::{
    DataScope, Domain, FigureSpec, FigureTheme, PanelSpec, PlotKind, SeriesSpec,
    SpectrumRepresentation, StyleRole, UnitState,
};
use std::fmt::Write as _;

/// Coordinates are written to this many decimals.
///
/// Fixed rather than shortest-round-trip, because determinism is the property
/// under test: the same specification must produce the same bytes on every
/// platform, and a formatter that chose its own precision would not.
const COORDINATE_DECIMALS: usize = 3;

/// The most decimals an axis end carries before the two ends are compared.
///
/// A readability bound rather than a limit: the precision rule below is derived
/// from a span that a single-value panel makes zero, and an unbounded answer
/// there would print a number no instrument reported. A domain narrow enough
/// that both ends still print the same at this many decimals escalates past it
/// -- see [`distinguishing_decimals`].
const AXIS_DECIMALS: usize = 6;

/// The point past which more decimals of an `f64` carry nothing.
///
/// Seventeen significant decimal digits round-trip a `f64`; beyond that the
/// escalation below would print digits the number does not hold.
const MAX_AXIS_DECIMALS: usize = 17;

/// Half the width of the mark a single-sample trace is drawn as.
const LONE_SAMPLE_TICK: f64 = 2.0;

/// The width one character of a marker label is assumed to take, in em.
///
/// An estimate, and it only ever decides which side of its marker a label goes
/// on. Generous for a proportional sans-serif face, so a label that would have
/// fitted may still flip -- which costs nothing, while the other error loses
/// the annotation off the edge of the exported document.
const MARKER_LABEL_EM: f64 = 0.6;

/// The gutter around the plotting area, in figure units.
const MARGIN_LEFT: f64 = 64.0;
const MARGIN_RIGHT: f64 = 20.0;
const MARGIN_TOP: f64 = 40.0;
const MARGIN_BOTTOM: f64 = 56.0;

/// One resolved palette.
///
/// The figure's own, chosen by the figure's own theme. The application's theme
/// is not an input to this function and cannot be.
struct Palette {
    background: &'static str,
    axis: &'static str,
    text: &'static str,
    measurement: &'static str,
    baseline: &'static str,
    marker: &'static str,
}

const fn palette(theme: FigureTheme) -> Palette {
    match theme {
        FigureTheme::Light => Palette {
            background: "#ffffff",
            axis: "#333333",
            text: "#111111",
            measurement: "#1f4e9c",
            baseline: "#9a9a9a",
            marker: "#b3261e",
        },
        FigureTheme::Dark => Palette {
            background: "#12161c",
            axis: "#c9d1d9",
            text: "#f0f3f6",
            measurement: "#7aa7ff",
            baseline: "#5c6470",
            marker: "#ff7b72",
        },
    }
}

/// Escapes one string for XML text and attribute content.
///
/// All five, including both quote forms: the same helper writes text nodes and
/// attribute values, and a helper that escaped only what the current call site
/// needed would be one call site away from being wrong.
fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Formats one coordinate.
///
/// Every number reaching the document goes through here. The specification has
/// already refused non-finite values, so this cannot be handed one -- and the
/// renderer still never formats a raw `f64` anywhere else, so a future field
/// that forgot the check cannot print `NaN` into a figure.
fn coordinate(value: f64) -> String {
    format!("{value:.COORDINATE_DECIMALS$}")
}

/// Maps a value from one interval onto another.
///
/// A zero-width source interval maps to the middle of the target rather than
/// dividing by zero: a flat trace and a single-point spectrum are real scenes,
/// and drawing them down the centre is the honest answer.
fn project(value: f64, from: Domain, to_low: f64, to_high: f64) -> f64 {
    let span = from.span();
    if span <= 0.0 {
        return f64::midpoint(to_low, to_high);
    }
    to_low + ((value - from.low()) / span) * (to_high - to_low)
}

/// What one axis is called, with its unit only where there is one.
///
/// An unreported unit adds nothing, which is the whole point: printing an empty
/// bracket, or a guess, would display a fact the file never carried.
fn axis_caption(label: &str, unit: &UnitState) -> String {
    match unit {
        UnitState::Known { unit } => format!("{label} ({})", unit.as_str()),
        UnitState::Unreported | UnitState::Dimensionless => label.to_owned(),
    }
}

/// Whether this kind joins its points into a trace rather than drawing marks.
///
/// One statement, read by the description and by the renderer, so the sentence
/// a figure carries cannot describe a drawing the figure did not make.
const fn joins_a_trace(kind: PlotKind) -> bool {
    match kind {
        PlotKind::Spectrum { representation } => representation.may_draw_continuous_trace(),
        PlotKind::Chromatogram => true,
    }
}

/// The value a joined trace holds at `x`, along the segment that spans it.
///
/// `None` when `x` falls outside the samples, so a window wider than the data
/// reports nothing rather than extrapolating.
fn value_at(series: &SeriesSpec, x: f64) -> Option<f64> {
    let (xs, ys) = (series.x(), series.y());
    for index in 1..xs.len() {
        let (x0, y0) = (xs[index - 1], ys[index - 1]);
        let (x1, y1) = (xs[index], ys[index]);
        if x < x0 || x > x1 {
            continue;
        }
        if (x1 - x0).abs() <= f64::EPSILON {
            return Some(y0);
        }
        return Some(y0 + (y1 - y0) * ((x - x0) / (x1 - x0)));
    }
    None
}

/// Whether a clipped trace reaches below zero at a window edge.
fn enters_below_zero(series: &SeriesSpec, drawn: Domain) -> bool {
    [drawn.low(), drawn.high()]
        .into_iter()
        .filter_map(|edge| value_at(series, edge))
        .any(|value| value < 0.0)
}

/// What a reader must be told about this panel's points.
///
/// The sentence an export owes the person reading it rather than the person who
/// made it: whether these are the source points or a reduction, and whether the
/// file said what the points are at all.
fn panel_description(panel: &PanelSpec) -> String {
    let mut sentences = Vec::new();

    match panel.kind {
        PlotKind::Spectrum { representation } => match representation {
            SpectrumRepresentation::Centroid => {
                sentences.push("Centroided peaks, as reported by the source file.".to_owned());
            }
            SpectrumRepresentation::Profile => {
                sentences.push("Profile samples, as reported by the source file.".to_owned());
            }
            SpectrumRepresentation::Unreported => {
                sentences.push(
                    "The source file does not report whether these are profile samples or \
                     centroided peaks, so each mark is one measured point rather than a peak."
                        .to_owned(),
                );
            }
        },
        PlotKind::Chromatogram => {
            sentences.push("An ordered trace over the separation axis.".to_owned());
        }
    }

    for series in &panel.series {
        if let DataScope::Reduced {
            source_point_count,
            rule,
        } = series.scope
        {
            sentences.push(format!(
                "Drawn from {source_point_count} source points reduced to {}, {}.",
                series.len(),
                rule.describe(),
            ));
        }
    }

    // An unreported unit is not a dimensionless one, and the axis caption
    // cannot carry the difference: both are drawn as the bare label, because
    // printing an empty bracket or a guess would display a fact the file never
    // carried. So the distinction is stated here, in words, or it does not
    // survive the export at all -- and a reader would have no way to tell a
    // genuinely dimensionless quantity from one whose unit the source omitted.
    let unreported: Vec<&str> = [&panel.x_axis, &panel.y_axis]
        .into_iter()
        .filter(|axis| matches!(axis.unit, UnitState::Unreported))
        .map(|axis| axis.label.as_str())
        .collect();
    match unreported.as_slice() {
        [] => {}
        [only] => sentences.push(format!(
            "The source file reports no unit for the {only} axis, so none is shown."
        )),
        [first, rest @ ..] => sentences.push(format!(
            "The source file reports no unit for the {first} or the {} axis, so none is shown.",
            rest.join(" or the "),
        )),
    }

    // Counted over the drawn window rather than the whole source, because the
    // sentence says *drawn*. A panel narrowed to a visible range still carries
    // its whole series -- that is what makes a full-range export possible from
    // the same specification -- so counting the source would tell a reader to
    // look below the zero line for marks that are outside the window and not in
    // the file they are holding.
    let drawn = panel.drawn_domain();
    let negatives = panel
        .series
        .iter()
        .flat_map(|series| series.x().iter().zip(series.y().iter()))
        .filter(|(at, value)| **value < 0.0 && **at >= drawn.low() && **at <= drawn.high())
        .count();
    if negatives > 0 {
        sentences.push(format!(
            "{negatives} of the drawn values are negative and are shown below the zero line."
        ));
    } else if joins_a_trace(panel.kind)
        && panel
            .series
            .iter()
            .any(|series| enters_below_zero(series, drawn))
    {
        // A trace can be drawn below the zero line without any *measured* value
        // inside the window being negative: the window cuts a segment whose
        // outside neighbour is negative, and the crossing is interpolated at the
        // boundary. Counting it among the negatives would put a number in the
        // description that corresponds to no row in any source file, so it gets
        // its own sentence instead of a wrong count.
        sentences.push(
            "Part of the drawn trace lies below the zero line, where it crosses the edge \
             of the window from a negative value outside it."
                .to_owned(),
        );
    }

    sentences.join(" ")
}

/// The plotting area of one panel, in figure units.
///
/// `plot_top`/`plot_bottom` are the drawable band inside the frame, and
/// `zero_y` is where the value zero falls in it. Carried together because every
/// user of one needs the others, and passing them separately was how the series
/// renderer grew an argument list nobody could read.
struct Frame {
    left: f64,
    right: f64,
    plot_top: f64,
    plot_bottom: f64,
    zero_y: f64,
}

/// Renders one figure as a standalone SVG document.
///
/// Deterministic: the same specification produces the same bytes. Nothing here
/// reads a clock, a locale, an environment variable or a random source.
#[must_use]
pub fn render(figure: &FigureSpec) -> String {
    let colours = palette(figure.theme);
    let width = figure.size.width();
    let height = figure.size.height();

    let mut out = String::with_capacity(4_096);
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    let _ = write!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" \
         viewBox=\"0 0 {} {}\" role=\"img\"",
        coordinate(width),
        coordinate(height),
        coordinate(width),
        coordinate(height),
    );
    out.push_str(">\n");

    // The accessible pair, first, because a reader that stops at the first
    // child should already know what it is looking at.
    let title = figure
        .title
        .as_ref()
        .map_or_else(|| default_title(figure), |label| label.as_str().to_owned());
    let _ = writeln!(out, "<title>{}</title>", escape(&title));

    // A supplied caption is added to the disclosures, never in place of them.
    // The generated sentences are where a reduction states its counts and rule,
    // and where an unreported representation says so; letting an author's
    // caption replace them would let a custom-titled export look scientifically
    // complete while dropping the two facts a reader most needs.
    let disclosures = figure
        .panels
        .iter()
        .map(panel_description)
        .collect::<Vec<_>>()
        .join(" ");
    let description = figure.caption.as_ref().map_or_else(
        || disclosures.clone(),
        |caption| format!("{} {}", caption.as_str(), disclosures),
    );
    let _ = writeln!(out, "<desc>{}</desc>", escape(&description));

    let _ = writeln!(
        out,
        "<rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"{}\"/>",
        coordinate(width),
        coordinate(height),
        colours.background,
    );

    if let Some(label) = figure.title.as_ref() {
        let _ = writeln!(
            out,
            "<text x=\"{}\" y=\"24.000\" fill=\"{}\" font-family=\"sans-serif\" \
             font-size=\"16\" font-weight=\"600\">{}</text>",
            coordinate(MARGIN_LEFT),
            colours.text,
            escape(label.as_str()),
        );
    }

    // Panels stack in the order the specification gives them, sharing the
    // figure's height. One panel today; the arithmetic is already the general
    // one so a second does not change this function's shape.
    let panel_count = figure.panels.len();
    let usable = height - MARGIN_TOP - MARGIN_BOTTOM;
    let panel_height = usable / panel_count as f64;
    for (index, panel) in figure.panels.iter().enumerate() {
        let top = MARGIN_TOP + panel_height * index as f64;
        let bottom = MARGIN_TOP + panel_height * (index as f64 + 1.0);
        let plot_top = top + 8.0;
        let plot_bottom = bottom - 34.0;
        let values = panel.value_domain;
        // Where zero falls in the value range, so a negative value hangs below
        // it and a positive one rises above it. A range that never reaches zero
        // puts the line at the nearer edge rather than off the panel.
        let zero_y = if values.low() <= 0.0 && values.high() >= 0.0 {
            project(0.0, values, plot_bottom, plot_top)
        } else if values.high() < 0.0 {
            plot_top
        } else {
            plot_bottom
        };
        let frame = Frame {
            left: MARGIN_LEFT,
            right: width - MARGIN_RIGHT,
            plot_top,
            plot_bottom,
            zero_y,
        };
        render_panel(&mut out, panel, &frame, &colours);
    }

    out.push_str("</svg>\n");
    out
}

/// What a figure is called when it was given no title.
fn default_title(figure: &FigureSpec) -> String {
    match figure.panels.first().map(|panel| panel.kind) {
        Some(PlotKind::Chromatogram) => "Chromatogram".to_owned(),
        Some(PlotKind::Spectrum { .. }) => "Mass spectrum".to_owned(),
        None => "Figure".to_owned(),
    }
}

fn render_panel(out: &mut String, panel: &PanelSpec, frame: &Frame, colours: &Palette) {
    let domain = panel.drawn_domain();
    let values = panel.value_domain;
    let plot_top = frame.plot_top;
    let plot_bottom = frame.plot_bottom;
    let zero_y = frame.zero_y;

    let _ = writeln!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
        coordinate(frame.left),
        coordinate(zero_y),
        coordinate(frame.right),
        coordinate(zero_y),
        colours.axis,
    );
    let _ = writeln!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
        coordinate(frame.left),
        coordinate(plot_top),
        coordinate(frame.left),
        coordinate(plot_bottom),
        colours.axis,
    );

    for series in &panel.series {
        render_series(out, panel, series, frame, colours);
    }

    for marker in &panel.markers {
        if marker.at < domain.low() || marker.at > domain.high() {
            continue;
        }
        let x = project(marker.at, domain, frame.left, frame.right);
        let _ = writeln!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" \
             stroke-width=\"1\" stroke-dasharray=\"4 3\"/>",
            coordinate(x),
            coordinate(plot_top),
            coordinate(x),
            coordinate(plot_bottom),
            colours.marker,
        );
        if let Some(label) = marker.label.as_ref() {
            // A marker at the high end of the domain sits at `frame.right`,
            // which leaves only the right gutter before the edge of the
            // document -- so a label placed to its right runs off a standalone
            // SVG or a PNG rendered from it, and the annotation is simply
            // absent from the exported figure. On screen the same overflow is
            // usually survivable; an exported file has no viewport to scroll.
            //
            // The width estimate is exactly that. A renderer that measured text
            // would need a font, which this one deliberately does not carry --
            // but the estimate only chooses a *side*, and 0.6em per character
            // over-states a proportional sans-serif face, so it errs towards
            // flipping early rather than late.
            let estimated_width = label.as_str().chars().count() as f64 * MARKER_LABEL_EM * 11.0;
            let canvas_right = frame.right + MARGIN_RIGHT;
            let overflows = x + 3.0 + estimated_width > canvas_right;
            let _ = writeln!(
                out,
                "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" \
                 font-size=\"11\"{}>{}</text>",
                coordinate(if overflows { x - 3.0 } else { x + 3.0 }),
                coordinate(plot_top + 12.0),
                colours.marker,
                if overflows {
                    " text-anchor=\"end\""
                } else {
                    ""
                },
                escape(label.as_str()),
            );
        }
    }

    // Axis captions and the two domain ends, as real text rather than as paths,
    // so the figure remains searchable and re-typesettable after export. Each
    // axis picks its own precision from its own span: a narrow m/z window and a
    // tall intensity range need different numbers of decimals to stay legible
    // and to stay distinguishable from each other.
    let domain_decimals = distinguishing_decimals(domain);
    let value_decimals = distinguishing_decimals(values);
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" \
         font-size=\"11\">{}</text>",
        coordinate(frame.left),
        coordinate(plot_bottom + 14.0),
        colours.text,
        escape(&format_number(domain.low(), domain_decimals)),
    );
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
         text-anchor=\"end\">{}</text>",
        coordinate(frame.right),
        coordinate(plot_bottom + 14.0),
        colours.text,
        escape(&format_number(domain.high(), domain_decimals)),
    );
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"12\" \
         text-anchor=\"middle\">{}</text>",
        coordinate(f64::midpoint(frame.left, frame.right)),
        coordinate(plot_bottom + 30.0),
        colours.text,
        escape(&axis_caption(
            panel.x_axis.label.as_str(),
            &panel.x_axis.unit
        )),
    );
    let value_caption = axis_caption(panel.y_axis.label.as_str(), &panel.y_axis.unit);
    let centre_y = f64::midpoint(plot_top, plot_bottom);
    let _ = writeln!(
        out,
        "<text x=\"14.000\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"12\" \
         text-anchor=\"middle\" transform=\"rotate(-90 14.000 {})\">{}</text>",
        coordinate(centre_y),
        colours.text,
        coordinate(centre_y),
        escape(&value_caption),
    );
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\">{}</text>",
        coordinate(frame.left + 4.0),
        coordinate(plot_top + 10.0),
        colours.text,
        escape(&format_number(values.high(), value_decimals)),
    );
    // Printed whenever it is not zero, rather than only when it is negative. A
    // trace may legitimately be zoomed to a value range that excludes zero, and
    // in that case the horizontal line sits at the bottom edge exactly as a zero
    // line would -- so suppressing the lower endpoint made the axis read as
    // zero-based and understated every height on it.
    if values.low() != 0.0 {
        let _ = writeln!(
            out,
            "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" \
             font-size=\"11\">{}</text>",
            coordinate(frame.left + 4.0),
            coordinate(plot_bottom - 2.0),
            colours.text,
            escape(&format_number(values.low(), value_decimals)),
        );
    }
}

fn render_series(
    out: &mut String,
    panel: &PanelSpec,
    series: &SeriesSpec,
    frame: &Frame,
    colours: &Palette,
) {
    if series.is_empty() {
        return;
    }
    let domain = panel.drawn_domain();
    let values = panel.value_domain;
    let (plot_top, plot_bottom, zero_y) = (frame.plot_top, frame.plot_bottom, frame.zero_y);
    let stroke = match series.role {
        StyleRole::Measurement => colours.measurement,
        StyleRole::Baseline => colours.baseline,
    };

    // Sticks or a trace, and the choice is the specification's rather than this
    // renderer's preference. Only established profile data may be joined:
    // joining centroid peaks would draw intensity at m/z values nobody
    // measured, and joining unreported points would assert the representation
    // while doing it.
    let continuous = joins_a_trace(panel.kind);

    // Clipped to the drawn domain rather than projected past its edges. A panel
    // narrowed to a visible window still carries its whole source -- that is
    // what makes a full-range export possible from the same specification -- so
    // without this the points outside the window would be placed outside the
    // frame, and outside the `viewBox` entirely.
    let (low, high) = (domain.low(), domain.high());
    let mut path = String::with_capacity(series.len() * 24);

    if continuous {
        // A trace is clipped **as segments**, not filtered as points. Two
        // samples can straddle the window with neither inside it -- a
        // chromatogram sampled coarsely against a narrow window is exactly
        // that -- and dropping both would erase a line that genuinely crosses
        // the whole view. The crossing is interpolated along the segment the
        // source already asserts between its own neighbouring samples.
        //
        // The interpolation adds no measurement: it is the same straight
        // segment the renderer would have drawn, cut where the window ends.
        let (xs, ys) = (series.x(), series.y());
        let mut pen_down = false;
        // Where to put a mark if the whole trace turns out to draw nothing: it
        // reaches the window but has no segment with length in it. Recorded as
        // it is discovered rather than searched for afterwards, so the mark
        // lands on a point the clipping actually produced.
        let mut touched: Option<(f64, f64)> = None;
        for index in 1..xs.len() {
            let (x0, y0) = (xs[index - 1], ys[index - 1]);
            let (x1, y1) = (xs[index], ys[index]);
            // The contract guarantees a non-decreasing domain axis, so a
            // segment is entirely outside exactly when both ends are.
            if x1 < low || x0 > high {
                pen_down = false;
                continue;
            }
            let at = |x: f64| {
                if (x1 - x0).abs() <= f64::EPSILON {
                    y0
                } else {
                    y0 + (y1 - y0) * ((x - x0) / (x1 - x0))
                }
            };
            let (ax, ay) = if x0 < low { (low, at(low)) } else { (x0, y0) };
            let (bx, by) = if x1 > high {
                (high, at(high))
            } else {
                (x1, y1)
            };
            // A segment clipped down to a point contributes nothing but a
            // duplicate command. It happens at both window edges, where the
            // outside neighbour is cut back onto the boundary sample that is
            // about to be drawn anyway. Skipped without lifting the pen: the
            // trace either has not started yet or continues through it.
            if (bx - ax).abs() <= f64::EPSILON && (by - ay).abs() <= f64::EPSILON {
                if touched.is_none() {
                    touched = Some((ax, ay));
                }
                continue;
            }
            if !pen_down {
                let _ = write!(
                    path,
                    "M{} {}",
                    coordinate(project(ax, domain, frame.left, frame.right)),
                    coordinate(project(ay, values, plot_bottom, plot_top)),
                );
                pen_down = true;
            }
            let _ = write!(
                path,
                "L{} {}",
                coordinate(project(bx, domain, frame.left, frame.right)),
                coordinate(project(by, values, plot_bottom, plot_top)),
            );
        }
        // A trace that reaches the window but has no segment with length in it
        // would leave the plot area blank, which reads as *no data* -- the one
        // thing an export must never be ambiguous about. Three ways to arrive
        // here, all accepted by the contract: a single-sample series, a series
        // whose samples repeat one position, and a zero-width visible window,
        // where every crossing segment clips down to a point.
        //
        // Drawn as a short horizontal tick at its own value: visible, honest
        // about there being no trace, and asserting nothing between samples
        // that do not exist.
        if xs.len() == 1 && xs[0] >= low && xs[0] <= high {
            touched = Some((xs[0], ys[0]));
        }
        if path.is_empty()
            && let Some((at, value)) = touched
        {
            let x = project(at, domain, frame.left, frame.right);
            let y = project(value, values, plot_bottom, plot_top);
            let _ = write!(
                path,
                "M{} {}L{} {}",
                coordinate((x - LONE_SAMPLE_TICK).max(frame.left)),
                coordinate(y),
                coordinate((x + LONE_SAMPLE_TICK).min(frame.right)),
                coordinate(y),
            );
        }
    } else {
        // Discrete marks are filtered, not clipped, and there is nothing to
        // interpolate: a stick outside the window is a measurement outside the
        // window, and inventing one at the boundary would draw intensity at an
        // m/z nobody measured -- the same error joining centroid peaks makes.
        for (x, y) in series.x().iter().zip(series.y().iter()) {
            if *x < low || *x > high {
                continue;
            }
            let _ = write!(
                path,
                "M{} {}V{}",
                coordinate(project(*x, domain, frame.left, frame.right)),
                coordinate(zero_y),
                coordinate(project(*y, values, plot_bottom, plot_top)),
            );
        }
    }

    if path.is_empty() {
        return;
    }

    let _ = writeln!(
        out,
        "<path d=\"{path}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1\"/>",
    );
}

/// How many decimals an axis end needs to distinguish itself from the other.
///
/// Chosen from the **span**, not from the magnitude. Magnitude was the wrong
/// question: a visible m/z window of `1000.1 .. 1000.4` is a real selection, and
/// rounding by magnitude labelled both ends `1000`, so the exported axis claimed
/// zero width and hid the range the user had chosen.
///
/// Roughly three significant figures across the span, bounded at both ends so a
/// wide axis gains no false precision and a zero-width one -- which a
/// single-value panel legitimately has -- still resolves rather than dividing by
/// nothing.
fn axis_decimals(span: f64) -> usize {
    if !span.is_finite() || span <= 0.0 {
        return AXIS_DECIMALS;
    }
    let places = (-span.log10()).ceil() + 2.0;
    if places <= 0.0 {
        0
    } else if places >= AXIS_DECIMALS as f64 {
        AXIS_DECIMALS
    } else {
        places as usize
    }
}

/// How many decimals this domain's two ends need to remain two numbers.
///
/// The readability bound above is enough for any ordinary axis, and a domain
/// narrow enough to defeat it is still a real selection: `1000.0000001 ..
/// 1000.0000004` printed as `1000.000000` twice would show a zero-width axis
/// for a window the user chose, which is the same misstatement the span rule
/// exists to prevent -- arrived at from the other side.
///
/// A **single-valued** domain is different and is left alone: its ends are the
/// same number, and printing them identically is the truth rather than a loss
/// of precision.
///
/// Escalation stays in fixed-point notation rather than switching to
/// scientific: the ceiling is where an `f64` stops carrying more, so the loop
/// always terminates, and an axis label that changed notation according to how
/// narrow the window was would be harder to read than one that grew a digit.
fn distinguishing_decimals(domain: Domain) -> usize {
    let mut decimals = axis_decimals(domain.span());
    if domain.span() <= 0.0 {
        return decimals;
    }
    while decimals < MAX_AXIS_DECIMALS
        && format_number(domain.low(), decimals) == format_number(domain.high(), decimals)
    {
        decimals += 1;
    }
    decimals
}

/// Formats one axis-end number for a reader.
///
/// Deterministic and locale-independent: no thousands separator and no
/// locale-dependent decimal mark reaches the document.
fn format_number(value: f64, decimals: usize) -> String {
    format!("{value:.decimals$}")
}
