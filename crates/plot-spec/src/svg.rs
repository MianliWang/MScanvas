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
    DataScope, Domain, FigureSpec, FigureTheme, Label, PanelSpec, PlotKind, SeriesSpec,
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

/// The longest an axis end may print before it is stated as an exponent.
///
/// Comfortably above any real m/z, retention time or intensity written in full,
/// and far below the 308 characters a fixed-point `1e307` would take.
const MAX_AXIS_LABEL_CHARS: usize = 24;

/// The point past which more decimals of an `f64` carry nothing.
///
/// Seventeen significant decimal digits round-trip a `f64`; beyond that the
/// escalation below would print digits the number does not hold.
const MAX_AXIS_DECIMALS: usize = 17;

/// Half the width of the mark a single-sample trace is drawn as.
const LONE_SAMPLE_TICK: f64 = 2.0;

/// The width one character of laid-out text is given, in em.
///
/// Not an average and not an estimate of one. `0.6em` is roughly the *mean*
/// advance of a proportional sans-serif face, so a line of `W`s exceeds it and
/// a viewer choosing a wider fallback face exceeds it again -- and this
/// document embeds no font, so the face is the viewer's choice.
///
/// So this is an upper bound on a glyph rather than a guess at one, and every
/// laid-out string is written with an explicit `textLength` computed from it.
/// The width then stops being a prediction about a font and becomes an
/// instruction to the renderer, which is what makes the placement below exact
/// rather than probable.
const TEXT_EM: f64 = 1.0;

/// The font size a marker label and an axis caption are drawn at.
const MARKER_LABEL_SIZE: f64 = 11.0;

/// The font size an axis caption is drawn at.
const AXIS_CAPTION_SIZE: f64 = 12.0;

/// The font size the visible figure title is drawn at.
const TITLE_SIZE: f64 = 16.0;

/// The distance between two lines of a wrapped marker label.
const MARKER_LABEL_LEADING: f64 = 13.0;

/// How far a marker label stays from either edge of the document.
const MARKER_LABEL_INSET: f64 = 4.0;

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
        // Exact equality, not an epsilon. `f64::EPSILON` is an absolute
        // quantity, so any comparison against it collapses distinct samples
        // whose values happen to be small -- and `(x - x0) / (x1 - x0)` is in
        // `0..=1` for any distinct pair, however close, so there is nothing to
        // guard against but a true division by zero.
        if x1 == x0 {
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

    let drawn = panel.drawn_domain();
    for series in &panel.series {
        if let DataScope::Reduced {
            source_point_count,
            rule,
        } = series.scope
        {
            // Two numbers, because a windowed panel makes them two facts. The
            // reduction ratio is what a reader needs to judge the figure; the
            // count inside the window is what they can see. Reporting the
            // reduction's size as the number drawn made the disclosure
            // disagree with the drawing whenever a window was narrower than
            // the source, and reporting only the visible count would have
            // hidden that the figure is a reduction at all.
            let inside = series
                .x()
                .iter()
                .filter(|at| **at >= drawn.low() && **at <= drawn.high())
                .count();
            if inside == series.len() {
                sentences.push(format!(
                    "Drawn from {source_point_count} source points reduced to {}, {}.",
                    series.len(),
                    rule.describe(),
                ));
            } else {
                sentences.push(format!(
                    "Reduced from {source_point_count} source points to {}, {};                      {inside} of them lie inside the range shown.",
                    series.len(),
                    rule.describe(),
                ));
            }
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
    } else if panel.kind.joins_a_trace()
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
    /// The height of the whole document, which text placement clamps against.
    canvas_height: f64,
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
        // The visible title is laid out to a declared width like every other
        // string here. The `<title>` element carries the same words to a screen
        // reader either way, but a published figure is read by looking at it,
        // and a metadata element is no substitute for the heading a reader can
        // see.
        let _ = writeln!(
            out,
            "<text x=\"{}\" y=\"24.000\" fill=\"{}\" font-family=\"sans-serif\" \
             font-size=\"{}\" font-weight=\"600\" textLength=\"{}\" \
             lengthAdjust=\"spacingAndGlyphs\">{}</text>",
            coordinate(MARGIN_LEFT),
            colours.text,
            coordinate(TITLE_SIZE),
            coordinate(fitted_width(
                label.as_str(),
                TITLE_SIZE,
                width - MARGIN_LEFT - MARGIN_RIGHT,
            )),
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
            canvas_height: height,
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

    // The two domain ends and the two value ends, as real text rather than as
    // paths, so the figure remains searchable and re-typesettable after export.
    // Each axis picks its own precision from its own span: a narrow m/z window
    // and a tall intensity range need different numbers of decimals to stay
    // legible and to stay distinguishable from each other.
    //
    // Formatted here rather than beside the text that carries them, because a
    // marker label has to know how far the value-axis maximum reaches before it
    // can avoid being drawn on top of it.
    let (domain_low_text, domain_high_text) = axis_ends(domain);
    let (value_low_text, value_high_text) = axis_ends(values);
    // Half the axis each, so the two domain ends cannot meet in the middle, and
    // a declared width so neither can leave the document. An end is a number
    // rather than a `Label`, but `Domain` accepts any finite pair -- and a
    // magnitude an axis cannot print is a figure the reader loses, not an input
    // this renderer gets to assume away.
    let end_room = (frame.right - frame.left) / 2.0;
    let value_room = frame.right - frame.left - 4.0;
    let value_label_right =
        frame.left + 4.0 + value_high_text.chars().count() as f64 * TEXT_EM * MARKER_LABEL_SIZE;

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
            render_marker_label(out, label, x, plot_top, value_label_right, frame, colours);
        }
    }

    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
         textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(frame.left),
        coordinate(plot_bottom + 14.0),
        colours.text,
        coordinate(fitted_width(&domain_low_text, MARKER_LABEL_SIZE, end_room)),
        escape(&domain_low_text),
    );
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
         text-anchor=\"end\" textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(frame.right),
        coordinate(plot_bottom + 14.0),
        colours.text,
        coordinate(fitted_width(&domain_high_text, MARKER_LABEL_SIZE, end_room)),
        escape(&domain_high_text),
    );
    // Both captions are written to a declared width. A caption is a `Label`, so
    // it may be 120 characters, and the figure may be 200 units wide -- both
    // accepted by the contract, and centred text of that length runs off a
    // document that has no viewport to scroll. Condensed text is harder to read;
    // absent text cannot be read at all, and nothing in the file would say a
    // word had been cut off.
    let domain_caption = axis_caption(panel.x_axis.label.as_str(), &panel.x_axis.unit);
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"12\" \
         text-anchor=\"middle\" textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(f64::midpoint(frame.left, frame.right)),
        coordinate(plot_bottom + 30.0),
        colours.text,
        coordinate(fitted_width(
            &domain_caption,
            AXIS_CAPTION_SIZE,
            frame.right - frame.left,
        )),
        escape(&domain_caption),
    );
    let value_caption = axis_caption(panel.y_axis.label.as_str(), &panel.y_axis.unit);
    let centre_y = f64::midpoint(plot_top, plot_bottom);
    let _ = writeln!(
        out,
        "<text x=\"14.000\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"12\" \
         text-anchor=\"middle\" transform=\"rotate(-90 14.000 {})\" textLength=\"{}\" \
         lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(centre_y),
        colours.text,
        coordinate(centre_y),
        coordinate(fitted_width(
            &value_caption,
            AXIS_CAPTION_SIZE,
            plot_bottom - plot_top,
        )),
        escape(&value_caption),
    );
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
         textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(frame.left + 4.0),
        coordinate(plot_top + 10.0),
        colours.text,
        coordinate(fitted_width(
            &value_high_text,
            MARKER_LABEL_SIZE,
            value_room
        )),
        escape(&value_high_text),
    );
    // Printed whenever it is not zero, rather than only when it is negative. A
    // trace may legitimately be zoomed to a value range that excludes zero, and
    // in that case the horizontal line sits at the bottom edge exactly as a zero
    // line would -- so suppressing the lower endpoint made the axis read as
    // zero-based and understated every height on it.
    if values.low() != 0.0 {
        let _ = writeln!(
            out,
            "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
             textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
            coordinate(frame.left + 4.0),
            coordinate(plot_bottom - 2.0),
            colours.text,
            coordinate(fitted_width(&value_low_text, MARKER_LABEL_SIZE, value_room)),
            escape(&value_low_text),
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
    let continuous = panel.kind.joins_a_trace();

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
                if x1 == x0 {
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
            if bx == ax && by == ay {
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

/// The width to lay one string out in: its natural width, or the space there is.
///
/// The natural width comes from [`TEXT_EM`], which is an upper bound on a glyph
/// rather than an average, so a string given its natural width cannot overflow
/// whatever face a viewer happens to pick. A string too long for its space is
/// condensed into that space rather than allowed to leave the document.
fn fitted_width(text: &str, size: f64, available: f64) -> f64 {
    let natural = text.chars().count() as f64 * TEXT_EM * size;
    natural.min(available.max(1.0))
}

/// Splits one label into lines no wider than `columns` characters.
///
/// Greedy on whitespace, and a word longer than one line is cut rather than
/// allowed to overhang -- an over-long word is usually an identifier, and an
/// identifier running off the page carries less than one broken across two
/// lines. Nothing is dropped or elided: every character of the label appears.
fn wrap_label(text: &str, columns: usize) -> Vec<String> {
    let columns = columns.max(1);
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        let mut word = word;
        while word.chars().count() > columns {
            let cut = word
                .char_indices()
                .nth(columns)
                .map_or(word.len(), |(index, _)| index);
            if !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            lines.push(word[..cut].to_owned());
            word = &word[cut..];
        }
        if word.is_empty() {
            continue;
        }
        let would_be = if line.is_empty() {
            word.chars().count()
        } else {
            line.chars().count() + 1 + word.chars().count()
        };
        if would_be > columns && !line.is_empty() {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// Draws one marker's label so that all of it is inside the document.
///
/// Two failures to avoid, and the second is why flipping the label to the other
/// side of its marker is not enough on its own. A label placed to the right of
/// a marker at the domain's high end runs off the page. And a label longer than
/// the page cannot be placed on either side of anything -- an exported file has
/// no viewport to scroll, so whatever leaves the canvas is not clipped, it is
/// absent, while the marker's line still draws and the figure still looks
/// finished.
///
/// So the label is wrapped to the width available and then its block is clamped
/// inside the canvas, which subsumes the side choice: near the right edge the
/// clamp moves the text left of its marker on its own.
///
/// The character width is an estimate, and it has to be: measuring text needs a
/// font, which this renderer deliberately does not carry -- that is what makes
/// it headless. `0.6em` over-states a proportional sans-serif face, so the
/// estimate errs towards wrapping early, which costs a line break, rather than
/// late, which costs the annotation.
fn render_marker_label(
    out: &mut String,
    label: &Label,
    x: f64,
    plot_top: f64,
    value_label_right: f64,
    frame: &Frame,
    colours: &Palette,
) {
    let canvas_width = frame.right + MARGIN_RIGHT;
    let canvas_height = frame.canvas_height;
    let character = TEXT_EM * MARKER_LABEL_SIZE;
    let available = (canvas_width - 2.0 * MARKER_LABEL_INSET).max(character);
    let columns = (available / character).floor().max(1.0);
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "bounded above by the canvas width and below by one"
    )]
    let lines = wrap_label(label.as_str(), columns as usize);
    let Some(widest) = lines.iter().map(|line| line.chars().count()).max() else {
        return;
    };
    let block = widest as f64 * character;
    let left = (x + 3.0)
        .max(MARKER_LABEL_INSET)
        .min(canvas_width - MARKER_LABEL_INSET - block);
    // The value axis prints its maximum at the top-left of the plotting area,
    // and a marker at the domain's low end lands one unit away from it at the
    // same size -- two strings drawn over each other, which costs both. Only a
    // label that would actually reach it drops a line; every other marker keeps
    // its natural place, so the common figure is unchanged.
    let wanted = if left < value_label_right {
        plot_top + 12.0 + MARKER_LABEL_LEADING
    } else {
        plot_top + 12.0
    };
    // And the block is clamped down the page as well as across it. A label long
    // enough to wrap into many lines on a small figure would otherwise run off
    // the bottom, which loses it just as completely as running off the side.
    let depth = (lines.len() - 1) as f64 * MARKER_LABEL_LEADING;
    let top = wanted
        .min(canvas_height - MARKER_LABEL_INSET - depth)
        .max(MARKER_LABEL_SIZE);

    let _ = write!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"{}\">",
        coordinate(left),
        coordinate(top),
        colours.marker,
        coordinate(MARKER_LABEL_SIZE),
    );
    for (index, line) in lines.iter().enumerate() {
        let _ = write!(
            out,
            "<tspan x=\"{}\" y=\"{}\" textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</tspan>",
            coordinate(left),
            coordinate(top + index as f64 * MARKER_LABEL_LEADING),
            coordinate(line.chars().count() as f64 * character),
            escape(line),
        );
    }
    let _ = writeln!(out, "</text>");
}

/// The two ends of one axis, formatted so that they remain two numbers.
///
/// Fixed-point first, because that is what a reader expects on an m/z or a
/// retention-time axis. Decimals grow until the ends differ, and if they still
/// do not -- which fixed point cannot fix for a domain like `1e-20 .. 4e-20`,
/// where the significant digits are far to the right of any decimal place this
/// could print -- the pair falls back to exponent notation.
///
/// The fallback is a last resort rather than a threshold: it triggers on the
/// strings being equal, so it cannot fire for a domain whose ends already read
/// distinctly. Rust's exponent formatting is shortest-round-trip and computed
/// in `core`, so it stays deterministic across platforms, which fixed-point
/// precision was chosen for in the first place.
///
/// A **single-valued** domain never reaches the fallback: its ends *are* one
/// number, and printing them identically is the truth.
fn axis_ends(domain: Domain) -> (String, String) {
    let decimals = distinguishing_decimals(domain);
    let (low, high) = (
        format_number(domain.low(), decimals),
        format_number(domain.high(), decimals),
    );
    // Two ways fixed point stops being the right notation, and both end here.
    // The ends collide, which is the narrow-domain case -- or the ends are so
    // large that a fixed-point form runs to hundreds of digits: `1e307` prints
    // 308 characters, which is not a number a reader can read and not a string
    // an axis can hold.
    let unreadable =
        low.chars().count() > MAX_AXIS_LABEL_CHARS || high.chars().count() > MAX_AXIS_LABEL_CHARS;
    if unreadable || (domain.span() > 0.0 && low == high) {
        return (
            format!("{:e}", domain.low()),
            format!("{:e}", domain.high()),
        );
    }
    (low, high)
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
