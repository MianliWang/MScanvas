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

/// The smallest any laid-out text may be shrunk to before it stops shrinking.
///
/// Below this a string is present without being readable, which helps nobody.
const MIN_TEXT_SIZE: f64 = 4.0;

/// The smallest a marker label may be shrunk to before it stops shrinking.
///
/// Small text is a real cost, so this is a floor rather than a target: a label
/// only reaches it on a figure with no room for it at any larger size, and
/// below this it would be present without being readable, which helps nobody.
/// A label that does not fit even here is not drawn and is named in the
/// description instead, which is the honest end of the ladder.
const MIN_MARKER_LABEL_SIZE: f64 = MIN_TEXT_SIZE;

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
            // 3.45:1 against this background. A baseline is a reference line a
            // reader measures against rather than decoration, so it is a
            // graphical object WCAG asks for 3:1 on -- and it is drawn one unit
            // wide, which is where a low-contrast hairline stops being visible
            // at all once a figure is scaled down or printed. The grey it
            // replaced managed 2.81:1. A test holds every role to the floor.
            baseline: "#8a8a8a",
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

/// How many discrete marks are drawn where another mark already covers them.
///
/// Sharing a domain position is not enough to be hidden, and counting it that
/// way put a number in the description that the drawing contradicts. Three
/// forms leave a mark at one position and only a mark of the same form can
/// cover another: a stick rising from the zero line, a stick hanging below it,
/// and the short horizontal tick a measured zero draws. `+10` and `-10` at one
/// m/z are two sticks pointing opposite ways with both ends visible, and a zero
/// beside either of them is a horizontal tick on a line the vertical stick only
/// touches.
///
/// So marks are grouped by position and then by form, and within each form all
/// but one are covered -- the tallest of a set of same-signed sticks is the one
/// that can be seen, and identical zero ticks are indistinguishable from each
/// other.
fn covered_marks(series: &SeriesSpec, drawn: Domain) -> usize {
    let (xs, ys) = (series.x(), series.y());
    let mut covered = 0;
    let mut start = 0;
    while start < xs.len() {
        // The contract guarantees a non-decreasing domain axis, so equal
        // positions are adjacent and one pass finds every group.
        let mut end = start + 1;
        while end < xs.len() && xs[end] == xs[start] {
            end += 1;
        }
        if xs[start] >= drawn.low() && xs[start] <= drawn.high() {
            let (mut zeros, mut above, mut below) = (0_usize, 0_usize, 0_usize);
            for value in &ys[start..end] {
                if *value == 0.0 {
                    zeros += 1;
                } else if *value > 0.0 {
                    above += 1;
                } else {
                    below += 1;
                }
            }
            covered += zeros.saturating_sub(1) + above.saturating_sub(1) + below.saturating_sub(1);
        }
        start = end;
    }
    covered
}

/// Whether a joined series draws anything into a window holding no sample.
///
/// A segment can straddle a window with neither of its ends inside it -- a
/// coarsely sampled chromatogram against a narrow selection is exactly that --
/// and the renderer draws the interpolated crossing. So "nothing measured is in
/// range" and "nothing is drawn" are different questions, and the description
/// has to answer the one that matches the picture.
fn crosses_window(series: &SeriesSpec, drawn: Domain) -> bool {
    value_at(series, drawn.low()).is_some() || value_at(series, drawn.high()).is_some()
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
fn panel_description(panel: &PanelSpec, unplaced: &[String], position: (usize, usize)) -> String {
    let mut sentences = Vec::new();

    // Which panel this is, where there is more than one. Panels stack in the
    // specification's order, and the description is one run of text, so without
    // this a reader has two paragraphs and no way to attach either to a plot.
    let (index, panel_count) = position;
    if panel_count > 1 {
        sentences.push(format!(
            "Panel {} of {panel_count}, counting from the top.",
            index + 1,
        ));
    }

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

    // Which series is which, where the drawing answers that with colour alone.
    // A baseline and a measurement differ by hue and by nothing else in the
    // document -- so a monochrome print, a rasterization, or a reader who does
    // not know this product's palette loses the distinction entirely, while the
    // contract was carrying a name for each of them that the export dropped.
    //
    // "Series", not "series drawn". A series is present in the panel whichever
    // way the window falls, and an empty one -- or a discrete one whose samples
    // all lie outside the visible domain -- is named here and then reported as
    // undrawn two sentences later. Calling it drawn made the description
    // contradict itself inside one `<desc>`. Presence is what this sentence
    // knows; what reached the page is the empty-range disclosure's business.
    //
    // Always, rather than only where two of them could be confused. Attribution
    // between traces was the case that prompted this, but identity is not only
    // attribution: `id` is the one place the contract says *which* measurement
    // this is, and a lone chromatogram drawn against "Retention time" and
    // "Intensity" is a figure whose axes cannot tell a reader whether they are
    // holding a total ion current, a base peak trace or an extracted ion
    // chromatogram. Dropping the name because nothing sat beside it discarded
    // the only semantic field that distinguished them.
    {
        let named = panel
            .series
            .iter()
            .map(|series| {
                let role = match series.role() {
                    StyleRole::Measurement => "measured data",
                    StyleRole::Baseline => "a reference baseline",
                };
                format!("\"{}\" is {role}", series.id().as_str())
            })
            .collect::<Vec<_>>()
            .join(", ");
        sentences.push(format!("Series: {named}."));
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
                    "Reduced from {source_point_count} source points to {}, {}; \
                     {inside} of them lie inside the range shown.",
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
    // Nothing measured lies inside the window. Two different figures reach here
    // and they are different facts about a sample, so they get different
    // sentences -- and one of them had none at all: a discrete panel windowed
    // between two peaks drew no path, said nothing, and was indistinguishable
    // from an empty source or from a renderer that had failed. Whether there is
    // no data or merely no drawing is the one thing an export must never leave
    // ambiguous.
    //
    // Its own block rather than an arm of the chain below, because it is
    // independent of what those sentences report: a trace can both have no
    // sample in the window *and* be drawn below the zero line, and folding this
    // in as an alternative silently dropped the second disclosure.
    if panel
        .series
        .iter()
        .flat_map(|series| series.x().iter())
        .all(|at| *at < drawn.low() || *at > drawn.high())
    {
        // The series that crosses is the one whose scope this sentence is about.
        // Asking "does any series cross" and "is any series reduced" separately
        // let a full-source baseline draw the line while a reduced measurement
        // supplied the word "retained", describing the drawing with the other
        // series' semantics.
        if let Some(crossing) = panel
            .series
            .iter()
            .find(|series| panel.joins(series) && crosses_window(series, drawn))
        {
            let retained = matches!(crossing.scope(), DataScope::Reduced { .. });
            sentences.push(if retained {
                // As above: a reduction cannot speak for the samples it dropped.
                "No point retained by the reduction lies inside the range shown; the trace \
                 drawn is interpolated between retained points outside it."
                    .to_owned()
            } else {
                "No measured sample lies inside the range shown; the trace drawn is \
                 interpolated between samples outside it."
                    .to_owned()
            });
        } else if panel
            .series
            .iter()
            .any(|series| matches!(series.scope(), DataScope::Reduced { .. }))
        {
            // A reduction carries the points it kept and a count of what it
            // came from, and nothing about where the dropped ones were. So
            // "no measured point is in range" is a claim this figure cannot
            // support: a whole-domain reduction can keep one column's extreme
            // and drop real measurements inside a window that then looks
            // empty. What it can say is what it retained.
            sentences.push(
                "No point retained by the reduction lies inside the range shown, so this \
                 panel draws none; whether the source held measurements there is not \
                 recorded in this figure."
                    .to_owned(),
            );
        } else {
            sentences.push(
                "No measured point lies inside the range shown, so this panel draws none."
                    .to_owned(),
            );
        }
    }

    // Two discrete measurements at one position are drawn as two marks from the
    // same baseline at the same x, in the same colour: the shorter is inside
    // the taller and cannot be seen. `SeriesSpec` accepts equal neighbouring
    // domain values deliberately -- the axis is non-decreasing, not strictly
    // increasing -- so this is a figure the contract allows and the drawing
    // cannot show, which is exactly the kind of thing the words are for.
    //
    // Disclosed rather than refused or nudged. Refusing would reject a file
    // that genuinely reported two intensities at one m/z, and offsetting one
    // would draw a measurement at a position nothing measured it at, which is
    // the error the whole clipping and interpolation design exists to avoid.
    let hidden: usize = panel
        .series
        .iter()
        .filter(|series| !panel.joins(series))
        .map(|series| covered_marks(series, drawn))
        .sum();
    if hidden > 0 {
        sentences.push(format!(
            "{hidden} drawn {} another at the same position on the domain axis and {} \
             hidden behind it.",
            if hidden == 1 {
                "point shares"
            } else {
                "points share"
            },
            if hidden == 1 { "is" } else { "are" },
        ));
    }

    let negatives = panel
        .series
        .iter()
        .flat_map(|series| series.x().iter().zip(series.y().iter()))
        .filter(|(at, value)| **value < 0.0 && **at >= drawn.low() && **at <= drawn.high())
        .count();
    // Whether this figure has a zero line at all. A joined trace is exempt from
    // the zero-baseline rule, so its value range may legitimately exclude zero
    // -- and where it does, the horizontal rule is pinned to the edge of the
    // plotting area as that range's own end. Every sentence below that would
    // otherwise name the zero line has to ask this first, because naming a rule
    // that is not zero hands the reader the wrong datum to measure every depth
    // against, and contradicts the value-axis ends the same document prints.
    let values = panel.value_domain;
    let shows_zero = values.low() <= 0.0 && values.high() >= 0.0;
    if negatives > 0 {
        if shows_zero {
            sentences.push(format!(
                "{negatives} of the drawn values are negative and are shown below the zero line."
            ));
        } else {
            // Reachable only downwards: a range excluding zero that still holds
            // a negative value lies entirely below zero, so every drawn value
            // is one.
            sentences.push(format!("All {negatives} drawn values are negative."));
        }
    } else if panel
        .series
        .iter()
        .flat_map(|series| series.x().iter().zip(series.y().iter()))
        .filter(|(at, _)| **at >= drawn.low() && **at <= drawn.high())
        .fold(None, |all_zero, (_, value)| {
            Some(all_zero.unwrap_or(true) && *value == 0.0)
        })
        == Some(true)
        && !panel.series.iter().any(|series| {
            // A window whose only samples are zero can still draw a line that
            // is not: clipping interpolates at the edge, so a segment running
            // out to a non-zero neighbour rises away from the axis inside the
            // window. The samples are all zero and the drawing is not, and the
            // sentence below says *drawn*.
            panel.joins(series)
                && [drawn.low(), drawn.high()]
                    .into_iter()
                    .filter_map(|edge| value_at(series, edge))
                    .any(|value| value != 0.0)
        })
    {
        // Measured zeros are not missing data, and they draw almost nothing --
        // a stick of no length, a trace along its own axis. Said in words, so a
        // reader is not left deciding whether the instrument reported nothing
        // or reported nothing above zero.
        sentences.push("Every drawn value is zero.".to_owned());
    } else if shows_zero
        && panel
            .series
            .iter()
            .any(|series| panel.joins(series) && enters_below_zero(series, drawn))
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

    // Stated once, for the panel rather than for its values, because it is a
    // fact about the axis: this figure has no zero line, and the rule at the
    // edge of the plotting area is the end of the range instead.
    if !shows_zero {
        let edge = if values.high() < 0.0 { "top" } else { "bottom" };
        sentences.push(format!(
            "Zero is outside the value range shown, so the horizontal rule is the {edge} of \
             that range rather than a zero line."
        ));
    }

    // A marker carrying no label draws its line and says nothing about itself.
    // `Marker::new(at, None)` is a legitimate way to mark a persistent
    // selection, so the figure gains a dashed rule a reader can see and a
    // screen-reader user cannot know exists -- an annotation present in the
    // drawing and absent from the description, which is the same asymmetry the
    // unplaced-label sentence below exists to close.
    //
    // Only those inside the drawn window: a marker outside it draws no line,
    // and reporting one would describe something the figure does not contain.
    let anonymous: Vec<String> = panel
        .markers
        .iter()
        .filter(|marker| {
            marker.label().is_none() && marker.at() >= drawn.low() && marker.at() <= drawn.high()
        })
        .map(|marker| format_number(marker.at(), axis_decimals(drawn.span())))
        .collect();
    match anonymous.as_slice() {
        [] => {}
        [only] => sentences.push(format!(
            "One marker line is drawn without a label, at {only} on the {} axis.",
            panel.x_axis.label.as_str(),
        )),
        many => sentences.push(format!(
            "{} marker lines are drawn without labels, at {} on the {} axis.",
            many.len(),
            many.join(", "),
            panel.x_axis.label.as_str(),
        )),
    }

    // A marker whose label the page had no room for still draws its line, so
    // the figure would look annotated while an annotation was missing. The
    // words go here instead: nothing is lost from the file, and a reader is
    // told to expect a mark they cannot read a name for.
    match unplaced {
        [] => {}
        [only] => sentences.push(format!(
            "One marker is drawn without its label, \"{only}\", because the figure is too \
             small to place it clear of the others."
        )),
        many => sentences.push(format!(
            "{} markers are drawn without their labels, {}, because the figure is too small \
             to place them clear of one another.",
            many.len(),
            many.iter()
                .map(|label| format!("\"{label}\""))
                .collect::<Vec<_>>()
                .join(", "),
        )),
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

    // The panels are drawn into a buffer before anything is written, because
    // the description below has to be able to say what the drawing actually
    // did -- and one of the things it must report is a marker label the page
    // had no room for. The document's order is unchanged: this only computes
    // the body earlier than it appends it.
    let (body, unplaced) = render_panels(figure, width, height, &colours);

    // Whether the visible heading can be drawn at a readable size, decided
    // before the description is written so the words can report it when it
    // cannot. `<title>` carries the text either way, so nothing leaves the
    // file -- what is at stake is the heading a sighted reader sees.
    let heading = figure.title.as_ref().and_then(|label| {
        readable_size(
            label.as_str(),
            TITLE_SIZE,
            width - MARGIN_LEFT - MARGIN_RIGHT,
        )
        .map(|size| (label, size))
    });

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
    let panel_count = figure.panels.len();
    let disclosures = figure
        .panels
        .iter()
        .zip(unplaced.iter())
        .enumerate()
        .map(|(index, (panel, missing))| panel_description(panel, missing, (index, panel_count)))
        .collect::<Vec<_>>()
        .join(" ");
    let mut description = figure.caption.as_ref().map_or_else(
        || disclosures.clone(),
        |caption| format!("{} {}", caption.as_str(), disclosures),
    );
    // A title too long for the figure to print legibly is not drawn as a
    // heading, so the description says where it went. Squeezing it in would
    // have put a line of sub-unit glyphs across the top of the figure and
    // called it a heading.
    if figure.title.is_some() && heading.is_none() {
        description.push_str(
            " The figure's title is too long to print legibly at this size and is not shown \
             as a heading; it is carried in the document's title element.",
        );
    }
    let _ = writeln!(out, "<desc>{}</desc>", escape(&description));

    let _ = writeln!(
        out,
        "<rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"{}\"/>",
        coordinate(width),
        coordinate(height),
        colours.background,
    );

    if let Some((label, size)) = heading {
        // The visible title is laid out to a declared width like every other
        // string here. The `<title>` element carries the same words to a screen
        // reader either way, but a published figure is read by looking at it,
        // and a metadata element is no substitute for the heading a reader can
        // see.
        let _ = writeln!(
            out,
            "<text x=\"{}\" y=\"24.000\" fill=\"{}\" font-family=\"sans-serif\" \
             font-size=\"{}\" font-weight=\"600\" xml:space=\"preserve\" textLength=\"{}\" \
             lengthAdjust=\"spacingAndGlyphs\">{}</text>",
            coordinate(MARGIN_LEFT),
            colours.text,
            coordinate(size),
            coordinate(label.as_str().chars().count() as f64 * TEXT_EM * size),
            escape(label.as_str()),
        );
    }

    out.push_str(&body);
    out.push_str("</svg>\n");
    out
}

/// Draws every panel, and reports the marker labels each had no room for.
///
/// Panels stack in the order the specification gives them, sharing the figure's
/// height. One panel today; the arithmetic is already the general one so a
/// second does not change this function's shape.
fn render_panels(
    figure: &FigureSpec,
    width: f64,
    height: f64,
    colours: &Palette,
) -> (String, Vec<Vec<String>>) {
    let mut body = String::with_capacity(4_096);
    let mut unplaced = Vec::with_capacity(figure.panels.len());
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
        unplaced.push(render_panel(&mut body, panel, &frame, colours));
    }
    (body, unplaced)
}

/// What a figure is called when it was given no title.
fn default_title(figure: &FigureSpec) -> String {
    // Every panel, not the first one. A linked chromatogram above a spectrum is
    // the figure this contract was built to make possible, and naming it after
    // whichever panel happens to be at the top tells a reader who has only the
    // title -- a screen reader announcing the document, a file browser, a
    // reference manager -- that a mixed figure is one of its halves.
    let chromatograms = figure
        .panels
        .iter()
        .any(|panel| matches!(panel.kind, PlotKind::Chromatogram));
    let spectra = figure
        .panels
        .iter()
        .any(|panel| matches!(panel.kind, PlotKind::Spectrum { .. }));
    match (chromatograms, spectra) {
        (true, false) => "Chromatogram".to_owned(),
        (false, true) => "Mass spectrum".to_owned(),
        // Neutral rather than invented. A combined name would have to decide an
        // order and a relationship the specification does not state.
        _ => "Figure".to_owned(),
    }
}

fn render_panel(
    out: &mut String,
    panel: &PanelSpec,
    frame: &Frame,
    colours: &Palette,
) -> Vec<String> {
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

    // Where each label already drawn in this panel ended up, so the next one
    // does not land on it. Two markers at the same m/z is a legitimate panel --
    // a precursor window and its monoisotopic peak, say -- and drawing both
    // labels at one baseline hides whichever was written first, leaving a
    // figure that looks annotated and is missing an annotation.
    //
    // Seeded with the two value-axis ends, because both are drawn *inside* the
    // plotting area and are therefore exactly as collidable as another label.
    // Keeping the plotting area as the floor was not enough on its own: the
    // low end sits two units above that floor, so a marker label stepping down
    // to the last position the floor allows landed on top of it -- and the axis
    // end is written afterwards, so it covered the annotation. Treating them as
    // occupied rather than special-casing either replaces the earlier
    // hand-rolled avoidance of the high end with the collision machinery that
    // was already here, and covers both ends by construction.
    let mut occupied: Vec<TextBox> = vec![TextBox::new(
        frame.left + 4.0,
        plot_top + 10.0,
        fitted_width(&value_high_text, MARKER_LABEL_SIZE, value_room),
        0.0,
        MARKER_LABEL_SIZE,
    )];
    if values.low() != 0.0 {
        occupied.push(TextBox::new(
            frame.left + 4.0,
            plot_bottom - 2.0,
            fitted_width(&value_low_text, MARKER_LABEL_SIZE, value_room),
            0.0,
            MARKER_LABEL_SIZE,
        ));
    }
    let mut unplaced: Vec<String> = Vec::new();
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
        if let Some(label) = marker.label.as_ref()
            && !render_marker_label(out, label, x, &mut occupied, frame, colours)
        {
            unplaced.push(label.as_str().to_owned());
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
    let domain_caption_room = frame.right - frame.left;
    let domain_caption_size = caption_size(&domain_caption, domain_caption_room);
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"{}\" \
         text-anchor=\"middle\" xml:space=\"preserve\" textLength=\"{}\" \
         lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(f64::midpoint(frame.left, frame.right)),
        coordinate(plot_bottom + 30.0),
        colours.text,
        coordinate(domain_caption_size),
        coordinate(fitted_width(
            &domain_caption,
            domain_caption_size,
            domain_caption_room,
        )),
        escape(&domain_caption),
    );
    let value_caption = axis_caption(panel.y_axis.label.as_str(), &panel.y_axis.unit);
    let centre_y = f64::midpoint(plot_top, plot_bottom);
    let value_caption_room = plot_bottom - plot_top;
    let value_caption_size = caption_size(&value_caption, value_caption_room);
    let _ = writeln!(
        out,
        "<text x=\"14.000\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"{}\" \
         text-anchor=\"middle\" transform=\"rotate(-90 14.000 {})\" xml:space=\"preserve\" \
         textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        coordinate(centre_y),
        colours.text,
        coordinate(value_caption_size),
        coordinate(centre_y),
        coordinate(fitted_width(
            &value_caption,
            value_caption_size,
            value_caption_room,
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
    unplaced
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
    //
    // A **baseline** is joined whatever the panel draws, because the rule above
    // is about measurements and a baseline is not one. That choice lives in the
    // contract rather than here: the validation that refuses a per-sign
    // reduction for anything joined has to reach the same answer, and it missed
    // a baseline for exactly as long as this was the renderer's own opinion.
    let continuous = panel.joins(series);

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
            let at = project(*x, domain, frame.left, frame.right);
            let top = project(*y, values, plot_bottom, plot_top);
            // A stick of zero length paints nothing, so a spectrum of measured
            // zeros drew an empty plotting area -- indistinguishable from a
            // spectrum with no points at all, which is a different fact about
            // the sample. It is marked instead: a short horizontal tick on the
            // zero line, which has no height and so claims no intensity, but is
            // there to be seen.
            if (top - zero_y).abs() <= f64::EPSILON {
                let _ = write!(
                    path,
                    "M{} {}L{} {}",
                    coordinate((at - LONE_SAMPLE_TICK).max(frame.left)),
                    coordinate(zero_y),
                    coordinate((at + LONE_SAMPLE_TICK).min(frame.right)),
                    coordinate(zero_y),
                );
                continue;
            }
            let _ = write!(
                path,
                "M{} {}V{}",
                coordinate(at),
                coordinate(zero_y),
                coordinate(top),
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

/// The rectangle one laid-out block of text occupies.
///
/// Half-open in neither direction and deliberately crude: the point is to know
/// whether two annotations would be drawn over each other, not to typeset them.
struct TextBox {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

impl TextBox {
    /// From a block's anchor, its declared width, how far it wraps and its size.
    ///
    /// `baseline` is a baseline, so the box reaches one font size above it —
    /// that is where the glyphs of the first line actually are.
    fn new(left: f64, baseline: f64, width: f64, depth: f64, size: f64) -> Self {
        Self {
            left,
            right: left + width,
            top: baseline - size,
            bottom: baseline + depth,
        }
    }

    fn overlaps(&self, other: &Self) -> bool {
        self.left < other.right
            && other.left < self.right
            && self.top < other.bottom
            && other.top < self.bottom
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

/// The size an axis caption is drawn at: the largest that needs no condensing.
///
/// Falls back to the floor rather than to nothing. Unlike the figure's heading,
/// a caption is never dropped -- an unlabelled axis is a worse figure than a
/// small label, and the `<title>` element that carries a heading's words has no
/// equivalent for an axis. So this shrinks first and condenses only what will
/// not fit even at the floor.
fn caption_size(text: &str, available: f64) -> f64 {
    readable_size(text, AXIS_CAPTION_SIZE, available).unwrap_or(MIN_TEXT_SIZE)
}

/// The largest size at which this string fits without being condensed at all.
///
/// `None` when even the floor is too wide. Condensing is the fallback of last
/// resort rather than the first answer: `lengthAdjust="spacingAndGlyphs"` will
/// squeeze any string into any width, and a 120-character title on a
/// 200-unit-wide figure came out at 0.97 units a glyph at font-size 16 -- inside
/// the document, inside its declared box, and completely unreadable. Text
/// present but illegible is not the thing "condensed beats absent" was weighing.
fn readable_size(text: &str, largest: f64, available: f64) -> Option<f64> {
    let count = text.chars().count() as f64;
    let mut size = largest;
    while size >= MIN_TEXT_SIZE {
        if count * TEXT_EM * size <= available {
            return Some(size);
        }
        size -= 1.0;
    }
    None
}

/// Splits one label into lines no wider than `columns` characters.
///
/// **Every character of the label appears, in order, exactly once** -- this cuts
/// the text into pieces and never rewrites it. That is not a nicety: this
/// boundary refuses a label it cannot accept rather than repairing one, and a
/// wrapper that trimmed the ends and collapsed `sample  A` into `sample A`
/// would be the same edit made silently, one layer down, to a string that may
/// be a sample identifier.
///
/// Lines break at a space where there is one to break at, and mid-word only
/// where a word is longer than a line -- an over-long word is usually an
/// identifier, and one running off the page carries less than one broken across
/// two lines. A space a line ends on stays on that line, because dropping it
/// would be the edit again.
fn wrap_label(text: &str, columns: usize) -> Vec<String> {
    let columns = columns.max(1);
    let characters: Vec<char> = text.chars().collect();
    let mut lines: Vec<String> = Vec::new();
    let mut start = 0;
    while start < characters.len() {
        let remaining = characters.len() - start;
        if remaining <= columns {
            lines.push(characters[start..].iter().collect());
            break;
        }
        // The last space inside the line, so the break lands between words when
        // there is a between to land in. The space itself stays behind.
        let hard = start + columns;
        let cut = characters[start..hard]
            .iter()
            .rposition(char::is_ascii_whitespace)
            .map_or(hard, |offset| start + offset + 1);
        lines.push(characters[start..cut].iter().collect());
        start = cut;
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
/// It then steps down past anything already drawn in the panel, because two
/// markers at the same position is a legitimate figure and one label written
/// over another is an annotation silently lost.
///
/// The character width is an upper bound on a glyph rather than an average, and
/// every line is written with the `textLength` computed from it, so these boxes
/// are what the viewer actually lays out rather than what this renderer guessed.
fn render_marker_label(
    out: &mut String,
    label: &Label,
    x: f64,
    occupied: &mut Vec<TextBox>,
    frame: &Frame,
    colours: &Palette,
) -> bool {
    let plot_top = frame.plot_top;

    // Try the ordinary size first and give ground only where the page makes it
    // necessary. Stepping down the page cannot help a block taller than the
    // room left for it -- two eight-line labels do not fit one under the other
    // on a 180-unit figure however politely they take turns -- and the previous
    // rule then left the second block exactly on top of the first. Smaller text
    // is a real cost; text that cannot be read because another string is drawn
    // over it is a total one, and shrinking keeps every character.
    let mut chosen: Option<(f64, Vec<String>, f64, f64, f64)> = None;
    let mut size = MARKER_LABEL_SIZE;
    while size >= MIN_MARKER_LABEL_SIZE {
        let character = TEXT_EM * size;
        let leading = size + 2.0;
        let available = (frame.right - frame.left).max(character);
        let columns = (available / character).floor().max(1.0);
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "bounded above by the canvas width and below by one"
        )]
        let lines = wrap_label(label.as_str(), columns as usize);
        let Some(widest) = lines.iter().map(|line| line.chars().count()).max() else {
            return false;
        };
        let block = widest as f64 * character;
        // Clamped to the plotting area rather than to the page. Left of the
        // frame is the value axis's own gutter, where its caption is drawn
        // rotated through the whole plot height -- and that caption is written
        // after the markers, so a label allowed out there was covered by it.
        // An annotation belongs to the plot it annotates; the page is not the
        // right bound for it, and bounding it here needs no second collision
        // box to discover that.
        let left = (x + 3.0).max(frame.left).min(frame.right - block);
        // The natural place for every label. Both value-axis ends are already
        // in `occupied`, so a label that would land on one steps past it below
        // rather than being pushed down by a rule of its own.
        let wanted = plot_top + 12.0;
        // The block belongs to the panel that owns the marker, not to the
        // page. Below the plotting area sit this panel's own domain-end labels
        // and its axis caption, and after those the next panel -- so a floor
        // measured from the canvas let an annotation cover the axis it
        // annotates, and in a stacked figure walk into the panel below.
        let depth = (lines.len() - 1) as f64 * leading;
        let floor = frame.plot_bottom - MARKER_LABEL_INSET - depth;

        // Step past every label already placed in this panel.
        let mut top = wanted;
        let mut clear = false;
        while top <= floor {
            if !occupied
                .iter()
                .any(|placed| placed.overlaps(&TextBox::new(left, top, block, depth, size)))
            {
                clear = true;
                break;
            }
            top += leading;
        }
        if clear {
            chosen = Some((size, lines, left, top, block));
            break;
        }
        size -= 1.0;
    }

    let Some((size, lines, left, top, block)) = chosen else {
        return false;
    };
    let leading = size + 2.0;
    let character = TEXT_EM * size;
    let depth = (lines.len() - 1) as f64 * leading;
    occupied.push(TextBox::new(left, top, block, depth, size));

    let _ = write!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"{}\">",
        coordinate(left),
        coordinate(top),
        colours.marker,
        coordinate(size),
    );
    for (index, line) in lines.iter().enumerate() {
        let _ = write!(
            out,
            "<tspan x=\"{}\" y=\"{}\" xml:space=\"preserve\" textLength=\"{}\" \
             lengthAdjust=\"spacingAndGlyphs\">{}</tspan>",
            coordinate(left),
            coordinate(top + index as f64 * leading),
            coordinate(line.chars().count() as f64 * character),
            escape(line),
        );
    }
    let _ = writeln!(out, "</text>");
    true
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
    // Three ways fixed point stops being the right notation, and they all end
    // here. The ends collide, which is the narrow-domain case -- or the ends are
    // so large that a fixed-point form runs to hundreds of digits: `1e307`
    // prints 308 characters, which is not a number a reader can read and not a
    // string an axis can hold -- or the fixed-point form has rounded the number
    // away to nothing.
    //
    // That last one is what a single-valued domain hits, and it is the case the
    // collision rule cannot see: `1e-20 .. 1e-20` never collides, because the
    // ends genuinely are one number, so it printed `0.000000` at both and the
    // axis stated zero where the measurement is not. Printing a value's ends
    // identically is the truth; printing them as a different number is not.
    let lost = |value: f64, text: &str| value != 0.0 && text.parse::<f64>() == Ok(0.0);
    let unreadable =
        low.chars().count() > MAX_AXIS_LABEL_CHARS || high.chars().count() > MAX_AXIS_LABEL_CHARS;
    if unreadable
        || lost(domain.low(), &low)
        || lost(domain.high(), &high)
        || (domain.span() > 0.0 && low == high)
    {
        return (
            format!("{:e}", normalized_zero(domain.low())),
            format!("{:e}", normalized_zero(domain.high())),
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
    format!("{:.decimals$}", normalized_zero(value))
}

/// Negative zero, written as the zero it equals.
///
/// `-0.0` is a legitimate `f64` that arithmetic produces readily, it compares
/// equal to `0.0`, and Rust formats it with its sign. So an axis end that came
/// out as negative zero printed `-0.000000` — and `Domain::new(-0.0, 0.0)`, a
/// single-valued zero domain, labelled its two ends `-0.000000` and `0.000000`,
/// which reads as an interval spanning zero rather than as the one value it is.
///
/// Normalised at the two places an axis number is written, rather than at the
/// domain boundary: `-0.0` is a perfectly good coordinate to compute with, and
/// the only thing wrong with it is how it prints.
fn normalized_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}
