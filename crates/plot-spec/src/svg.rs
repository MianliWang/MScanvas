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

/// The fewest decimals a coordinate is written to.
///
/// Fixed rather than shortest-round-trip, because determinism is the property
/// under test: the same specification must produce the same bytes on every
/// platform, and a formatter that chose its own precision per number would not.
/// A floor rather than the answer -- see [`coordinate_precision`], which raises
/// it for the one kind of figure this many decimals would quantize.
const COORDINATE_DECIMALS: usize = 3;

/// The most decimals a coordinate is written to.
///
/// Seventeen significant decimals round-trip an `f64`, and every *drawn
/// position* this renderer writes lies at least `MARGIN_TOP` figure units from
/// the origin -- so seventeen decimal *places* separate two neighbouring `f64`
/// anywhere on the plotting area, and past here there is nothing left of a
/// coordinate to preserve.
const MAX_COORDINATE_DECIMALS: usize = 17;

/// `10^-d`, for every decimal count a document may be written to.
///
/// Literals rather than `powi`: an exponentiation is a floating-point operation
/// whose result this renderer would have to trust to be bit-identical on every
/// platform, and the determinism these numbers exist to protect is exactly what
/// that would be staking.
const DECIMAL_STEPS: [f64; MAX_COORDINATE_DECIMALS + 1] = [
    1e0, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10, 1e-11, 1e-12, 1e-13, 1e-14,
    1e-15, 1e-16, 1e-17,
];

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

/// The size a legend entry is drawn at: a marker label's, for one voice.
const LEGEND_SIZE: f64 = MARKER_LABEL_SIZE;

/// How long a legend's sample of a stroke is.
///
/// Long enough that a dash pattern is visibly a dash pattern rather than one
/// mark: the secondary measurement's `6 3` needs more than one period in view or
/// the swatch says nothing the colour did not already say.
const LEGEND_SWATCH: f64 = 18.0;

/// The gap between a legend's stroke sample and the name it belongs to.
const LEGEND_GAP: f64 = 4.0;

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
    secondary_measurement: &'static str,
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
            // 6.26:1 against this background, and a different hue family
            // from the measurement blue rather than a second shade of it --
            // blue against amber is the pair that survives the common colour
            // vision deficiencies. It is also drawn dashed, because a figure
            // that can only be read in colour cannot be read in a monochrome
            // print, and this role exists to be told apart.
            secondary_measurement: "#9a4a00",
            baseline: "#8a8a8a",
            marker: "#b3261e",
        },
        FigureTheme::Dark => Palette {
            background: "#12161c",
            axis: "#c9d1d9",
            text: "#f0f3f6",
            measurement: "#7aa7ff",
            secondary_measurement: "#f0a35e",
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

/// How many decimals one document writes its coordinates to.
///
/// Carried as a value rather than read from a constant, and decided once for
/// the whole document rather than per number: a figure whose geometry is
/// written at two precisions is a figure whose bytes depend on which value
/// happened to need what, and both the determinism and the reading of it are
/// easier to hold when there is one answer.
#[derive(Clone, Copy)]
struct Precision(usize);

impl Precision {
    /// Formats one coordinate.
    ///
    /// Every number reaching the document goes through here. The specification
    /// has already refused non-finite values, so this cannot be handed one --
    /// and the renderer still never formats a raw `f64` anywhere else, so a
    /// future field that forgot the check cannot print `NaN` into a figure.
    fn coordinate(self, value: f64) -> String {
        format!("{value:.decimals$}", decimals = self.0)
    }
}

/// How many decimals this figure's drawn geometry needs to stay distinct.
///
/// Three decimals is readable and is what an ordinary figure gets. On its own
/// it is also a quantizer, and on **both** axes -- but what it destroys differs
/// by axis, so the two are asked different questions.
///
/// Across the **domain axis** the question is whether two marks land on top of
/// each other. Two drawn positions closer than half a thousandth of a figure
/// unit serialize to one x, and two same-signed sticks written at one x are one
/// stick: the shorter is inside the taller at every zoom, permanently. Position
/// is ordered, so the closest pair is an adjacent pair and one pass finds it.
///
/// Up the **value axis** nothing is hidden -- two marks at one height are still
/// two marks, at their own positions -- and what is destroyed instead is
/// *slope*. Two consecutive vertices of a drawn line written at one height make
/// that segment horizontal: on the smallest panel the contract accepts, values
/// `0.5` and `0.500001` of a `0 .. 1` range both reached `69.000`, and a
/// genuinely sloped trace was exported as a flat one. So the value axis is
/// asked about consecutive drawn vertices, in the order the path visits them,
/// which is the pair a flattened segment is actually between.
///
/// Deliberately not the closest pair anywhere in the series. Intensity is not
/// ordered and finding that pair would mean sorting it, and on real data the
/// answer is the smallest coincidence in a large sample: a hundred thousand
/// noisy points always hold two that are near-identical somewhere, so every
/// dense figure would escalate to near the `f64`'s own limit, double in size,
/// and preserve a distinction between two intensities nothing in the drawing
/// relates to each other. Worse, that answer is a knife edge -- perturb one
/// input value by a single unit in the last place and a different pair becomes
/// the closest, which can move the whole document's precision. A figure's bytes
/// should not turn on which two of half a million samples happened to coincide.
///
/// Disclosing a collision in words was the alternative to all of this, and it
/// is the worse one: the geometry would still be gone, and the sentence would
/// be explaining an artefact this renderer had just created rather than a fact
/// about the sample. [`covered_marks`] is left exactly as it was -- a statement
/// about measurements that share a *domain position*, which no precision can
/// separate and which the drawing genuinely cannot show -- and this keeps
/// everything that does *not* share one separable.
///
/// The floor is never gone below and the ceiling is the `f64`'s own, so a
/// figure whose geometry never comes that close is unchanged, byte for byte.
fn coordinate_precision(figure: &FigureSpec, frames: &[Frame]) -> Precision {
    let mut smallest = f64::INFINITY;
    for (panel, frame) in figure.panels.iter().zip(frames) {
        let drawn = panel.drawn_domain();
        let values = panel.displayed_value_domain();
        for series in &panel.series {
            let height = |value: f64| project(value, values, frame.plot_bottom, frame.plot_top);
            let mut across: Option<f64> = None;
            let mut up: Option<f64> = None;
            let mut gap = |last: &mut Option<f64>, next: f64, ordered: bool| {
                if let Some(previous) = *last {
                    let apart = if ordered {
                        next - previous
                    } else {
                        (next - previous).abs()
                    };
                    if apart > 0.0 {
                        smallest = smallest.min(apart);
                    }
                }
                *last = Some(next);
            };
            // A joined series draws two vertices it never measured: the
            // interpolation where the window cuts the segment it enters on and
            // the one it leaves on. They are visited before and after every
            // sample in range, and for a segment straddling the window with no
            // sample inside it they are the only two vertices there are -- so
            // leaving them out let the entire visible slope of a crossing trace
            // flatten with nothing to say it ever had one.
            //
            // Nothing is added for a discrete series. A stick outside the
            // window is a measurement outside the window, and inventing a value
            // at the boundary for it is the error the clipping design exists to
            // avoid.
            let joined = panel.joins(series);
            if joined && let Some(value) = value_at(series, drawn.low()) {
                gap(&mut up, height(value), false);
            }
            for (at, value) in series.x().iter().zip(series.y().iter()) {
                if *at < drawn.low() || *at > drawn.high() {
                    continue;
                }
                // The contract guarantees a non-decreasing domain and the
                // projection is monotonic, so these arrive in order and the
                // difference needs no absolute value.
                gap(
                    &mut across,
                    project(*at, drawn, frame.left, frame.right),
                    true,
                );
                let top = height(*value);
                gap(&mut up, top, false);
                // A discrete mark is a *length measured from the zero line*,
                // and that is a third question the value axis has to answer.
                // The mark is written `M x zero_y V top`, so if those two
                // coordinates round to one string the stick has no length at
                // all and a genuinely non-zero peak is drawn as nothing -- not
                // shortened, absent, at every zoom. A centroid intensity of `1`
                // against a `0 .. 1e9` range is exactly that: it stands a few
                // ten-millionths of a figure unit above the baseline, and three
                // decimals put both ends in the same place.
                //
                // Only for marks the renderer will give a length. A measured
                // zero is drawn as its own short horizontal tick on the
                // baseline -- it has no height to lose -- so escalating for one
                // would buy nothing and inflate every peakless spectrum.
                //
                // Seeded at the baseline rather than at the previous mark,
                // because every stick starts there: the baseline is the
                // coordinate each one has to stay distinct from, and its
                // neighbours are the domain axis's business.
                if !joined && !draws_without_length(top, frame.zero_y) {
                    let mut from_baseline = Some(frame.zero_y);
                    gap(&mut from_baseline, top, false);
                }
            }
            if joined && let Some(value) = value_at(series, drawn.high()) {
                gap(&mut up, height(value), false);
            }
        }
        // A marker line is drawn geometry too, and the domain axis asks it the
        // same question it asks a stick: two persistent selections written at
        // one x are one dashed rule, and no zoom of the vector recovers the
        // second. Reading only the series left that to the samples, so a panel
        // whose points are far apart -- or which has none at all -- kept three
        // decimals while carrying two markers a millionth of its domain apart.
        //
        // Sorted, because nothing orders markers: they are annotations placed
        // by a reader, not an axis the contract holds non-decreasing. Sorting
        // is affordable here for the reason it was not on the value axis --
        // there are a handful of annotations, not half a million intensities.
        //
        // Only those inside the drawn window, matching what the renderer draws:
        // a marker outside it produces no line, and letting one raise the
        // precision of a figure it does not appear in would be paying for
        // geometry that is not there.
        let mut placed: Vec<f64> = panel
            .markers
            .iter()
            .filter(|marker| marker.at() >= drawn.low() && marker.at() <= drawn.high())
            .map(|marker| project(marker.at(), drawn, frame.left, frame.right))
            .collect();
        placed.sort_unstable_by(f64::total_cmp);
        for pair in placed.windows(2) {
            // Strictly apart, so two markers genuinely at one position stay
            // one line and are left to the layout to disclose. They are the
            // same coordinate; no precision separates them and none should try.
            if pair[1] > pair[0] {
                smallest = smallest.min(pair[1] - pair[0]);
            }
        }
    }
    // A gap of at least `10^-decimals` survives rounding to that many places:
    // scaled by `10^decimals` the two values differ by at least one, and
    // rounding is monotonic, so they cannot land on the same integer. Growing
    // the count until that holds is therefore enough, and the ceiling is where
    // an `f64` stops carrying more -- which is also why the loop terminates.
    let mut decimals = COORDINATE_DECIMALS;
    while decimals < MAX_COORDINATE_DECIMALS && smallest < DECIMAL_STEPS[decimals] {
        decimals += 1;
    }
    Precision(decimals)
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

/// Whether a discrete mark has any length left once it has been projected.
///
/// A question about the **drawing**. A stick of no length paints nothing, so a
/// mark that answers yes is written as the short horizontal tick instead --
/// visible, and claiming no height, which is all the geometry can honestly do.
///
/// Shared with everything that needs the answer rather than restated: the
/// precision decision has to ask exactly the question the drawing will ask, and
/// a second copy of this comparison is how the two would come to disagree.
fn draws_without_length(top: f64, zero_y: f64) -> bool {
    (top - zero_y).abs() <= f64::EPSILON
}

/// Whether a discrete mark is a measured zero.
///
/// A question about the **measurement**, and deliberately not the one above.
/// Reading the projection to answer it was the defect: `project` maps the value
/// range onto the plotting area in `f64`, and a wide enough range makes that
/// mapping lossy before a single digit is serialized. Against `0 .. 1e20` a
/// measured intensity of `1` projects to exactly the baseline coordinate -- a
/// difference of zero against an ulp of `5.7e-14` -- so a real measurement was
/// classified as a zero because the arithmetic could not hold it apart.
///
/// `source value == 0` and `projected endpoint == projected baseline` are
/// different statements, and only the first is a fact about the sample. The
/// renderer must not report a different scientific value because the picture is
/// easier that way.
fn is_measured_zero(value: f64) -> bool {
    value == 0.0
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

/// Whether this panel draws anything, and draws nothing but zero.
///
/// *Drawn*, not *measured inside the window*, and the two are different sets.
/// A joined series also draws the interpolation at each edge of the window, and
/// for a segment straddling the window with no sample inside it that
/// interpolation is the only geometry there is. Reading the samples alone was
/// wrong in both directions: it claimed all-zero for a window whose clipped
/// edge rises away from the axis, and then, once that was guarded, withheld the
/// sentence from a window drawn entirely along zero -- `x = [-1, 2]`,
/// `y = [0, 0]` seen through `0 .. 1` draws a flat zero line across the whole
/// view while the fold over samples has nothing to fold and answers `None`.
/// The reader of that file was told nothing about a trace they can see.
///
/// Nothing is interpolated for a discrete series. A stick outside the window is
/// a measurement outside the window, and inventing a value at the boundary for
/// it would draw intensity at a position nobody measured -- the error the whole
/// clipping design exists to avoid.
///
/// False for a panel that draws nothing at all: there is no drawn value to be
/// zero, and an empty window is already its own disclosure.
fn draws_only_zero(panel: &PanelSpec, drawn: Domain) -> bool {
    let mut drew = false;
    for series in &panel.series {
        for (at, value) in series.x().iter().zip(series.y().iter()) {
            if *at < drawn.low() || *at > drawn.high() {
                continue;
            }
            drew = true;
            if *value != 0.0 {
                return false;
            }
        }
        if panel.joins(series) {
            for edge in [drawn.low(), drawn.high()] {
                if let Some(value) = value_at(series, edge) {
                    drew = true;
                    if value != 0.0 {
                        return false;
                    }
                }
            }
        }
    }
    drew
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
fn panel_description(
    panel: &PanelSpec,
    unplaced: &[usize],
    frame: &Frame,
    position: (usize, usize),
) -> String {
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
                    StyleRole::SecondaryMeasurement => "a second measured series",
                    StyleRole::Baseline => "a reference baseline",
                };
                format!("\"{}\" is {role}", series.id().as_str())
            })
            .collect::<Vec<_>>()
            .join(", ");
        sentences.push(format!("Series: {named}."));
    }

    // A value axis that is a window rather than the whole range, said in words.
    //
    // The two numbers printed beside the axis are the window's, and nothing on
    // the page distinguishes that from a source whose values happen to end
    // there. It is exactly the case a current-range chromatogram is in: the
    // document carries every source point, including a peak far outside the
    // window, and a reader deciding whether this figure shows the tallest thing
    // in the run needs to be told that it does not.
    if let Some(window) = panel.visible_value_domain() {
        let (window_low, window_high) = axis_ends(window);
        let (source_low, source_high) = axis_ends(panel.value_domain());
        sentences.push(format!(
            "The value axis shows {window_low} to {window_high}; the source reaches \
             {source_low} to {source_high}, and values outside the window are in the document \
             but not drawn.",
        ));
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
            // Named, because a panel may hold more than one series and only
            // one of them be reduced. A measurement read against a reference
            // baseline is exactly that figure, and counts with no owner leave a
            // reader unable to tell which trace was reduced -- listing both
            // series in an earlier sentence does not attach either to these
            // numbers.
            let id = series.id().as_str();
            if inside == series.len() {
                sentences.push(format!(
                    "\"{id}\" is drawn from {source_point_count} source points reduced to {}, {}.",
                    series.len(),
                    rule.describe(),
                ));
            } else {
                sentences.push(format!(
                    "\"{id}\" is reduced from {source_point_count} source points to {}, {}; \
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

    // What actually reached the page, series by series.
    //
    // A panel is not one drawable thing, and asking the question of the panel
    // could not see the figure that matters: a measurement inside the window
    // read against a baseline the source left empty. The panel as a whole held
    // points, so the panel-wide test was false and nothing was said -- while
    // the sentence above listed the baseline as present and the drawing showed
    // nothing for it. A reader could not then tell an empty reference line from
    // one whose samples all lie outside the window, from one drawn and
    // coincident with the measurement, from an ordinary one.
    //
    // So it is asked of each series, and every answer names the series it is
    // about; counts and states with no owner are what made the panel-wide form
    // unreadable in the first place. The states are different facts and none of
    // them substitutes for another: nothing in the series at all, points
    // present but none of them in the window, and a joined trace whose segment
    // crosses the window with no sample inside it -- which *is* drawn, and must
    // never be described as absent.
    //
    // Counted over the drawn window rather than the whole source, because the
    // sentences say *drawn*. A panel narrowed to a visible range still carries
    // its whole series -- that is what makes a full-range export possible from
    // the same specification -- so counting the source would tell a reader to
    // look for marks that are outside the window and not in the file they are
    // holding.
    for series in &panel.series {
        let id = series.id().as_str();
        if series.is_empty() {
            // A reduction cannot be empty: the contract refuses one that kept
            // nothing, because neither named rule can produce it. So this is a
            // series whose source carried no points, and saying so claims
            // nothing about measurements a reduction dropped.
            sentences.push(format!(
                "\"{id}\" carries no points, so nothing is drawn for it."
            ));
            continue;
        }
        let inside = series
            .x()
            .iter()
            .filter(|at| **at >= drawn.low() && **at <= drawn.high())
            .count();
        if inside > 0 {
            continue;
        }
        let reduced = matches!(series.scope(), DataScope::Reduced { .. });
        if panel.joins(series) && crosses_window(series, drawn) {
            // The one state that is drawn. A segment can straddle a window with
            // neither of its ends inside it -- a coarsely sampled chromatogram
            // against a narrow selection is exactly that -- and the renderer
            // draws the interpolated crossing. "Nothing measured is in range"
            // and "nothing is drawn" are different questions, and this sentence
            // answers the one that matches the picture.
            sentences.push(if reduced {
                // A reduction cannot speak for the samples it dropped.
                format!(
                    "No point retained by the reduction for \"{id}\" lies inside the \
                     range shown; the trace drawn for it is interpolated between \
                     retained points outside it."
                )
            } else {
                format!(
                    "No measured sample of \"{id}\" lies inside the range shown; \
                     the trace drawn for it is interpolated between samples outside it."
                )
            });
            continue;
        }
        // Nothing of this series reaches the window, and nothing is drawn for
        // it. A discrete mark outside the window is a measurement outside the
        // window; a joined trace with no sample inside it and no segment
        // crossing it has no geometry in range either.
        sentences.push(if reduced {
            // A reduction carries the points it kept and a count of what they
            // came from, and nothing about where the dropped ones were. So "no
            // measured point is in range" is a claim this figure cannot
            // support: a whole-domain reduction can keep one column's extreme
            // and drop real measurements inside a window that then looks empty.
            // What it can say is what it retained.
            format!(
                "No point retained by the reduction for \"{id}\" lies inside the \
                 range shown, so none of it is drawn; whether the source held \
                 measurements there is not recorded in this figure."
            )
        } else {
            format!(
                "No measured point of \"{id}\" lies inside the range shown, \
                 so none of it is drawn."
            )
        });
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

    // Counted over the marks the drawing actually places below the line, not
    // over source signs.
    //
    // A discrete mark is a length measured from the zero line, and a negative
    // one whose projection collapses onto that line is not drawn below it: it
    // is drawn *on* it, as the tick. Counting it here told a reader that the
    // figure shows something below zero which nobody looking at the figure can
    // find, and contradicted the drawable-resolution sentence in the same
    // description. Nothing is lost by dropping it, and that is the point -- the
    // measurement is still negative and is still disclosed, by the sentence
    // about drawable resolution, which counts exactly the marks this skips.
    //
    // A joined series keeps its own semantics and is not asked this question.
    // Its samples are vertices of a line rather than marks measured from the
    // baseline, and the line runs below zero between them whatever one vertex
    // rounded to, so "is this mark below the line" is not a question its
    // geometry answers.
    let mut negatives = 0_usize;
    for series in &panel.series {
        let discrete = !panel.joins(series);
        for (at, value) in series.x().iter().zip(series.y().iter()) {
            if *value >= 0.0 || *at < drawn.low() || *at > drawn.high() {
                continue;
            }
            if discrete
                && draws_without_length(
                    project(
                        *value,
                        panel.displayed_value_domain(),
                        frame.plot_bottom,
                        frame.plot_top,
                    ),
                    frame.zero_y,
                )
            {
                continue;
            }
            negatives += 1;
        }
    }
    // Whether this figure has a zero line at all. A joined trace is exempt from
    // the zero-baseline rule, so its value range may legitimately exclude zero
    // -- and where it does, the horizontal rule is pinned to the edge of the
    // plotting area as that range's own end. Every sentence below that would
    // otherwise name the zero line has to ask this first, because naming a rule
    // that is not zero hands the reader the wrong datum to measure every depth
    // against, and contradicts the value-axis ends the same document prints.
    let values = panel.displayed_value_domain();
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
    } else if draws_only_zero(panel, drawn) {
        // Measured zeros are not missing data, and they draw almost nothing --
        // a stick of no length, a trace along its own axis. Said in words, so a
        // reader is not left deciding whether the instrument reported nothing
        // or reported nothing above zero.
        //
        // Asked of the drawing rather than of the samples, because the sentence
        // says *drawn*: a window whose only samples are zero can still show a
        // line rising away from the axis where clipping interpolates out to a
        // non-zero neighbour, and a window with no sample at all can still show
        // a trace lying flat along zero across its whole width.
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

    // A measurement that is not zero, drawn as though it had no height.
    //
    // The projection is `f64` arithmetic over the declared value range, and a
    // range wide enough makes it lossy before anything is serialized: against
    // `0 .. 1e20` a measured intensity of `1` lands on exactly the baseline
    // coordinate. The mark then has no length to draw and is written as the
    // short horizontal tick -- which is the geometry a *measured zero* uses,
    // and this measurement is not a measured zero.
    //
    // Nothing recovers it in the drawing, and this figure does not pretend
    // otherwise. More decimals cannot help: the two coordinates were already
    // equal before serialization, and any consumer of the file recomputes them
    // in the same double precision. A minimum stick height would draw an
    // intensity nobody measured, and widening the value range would restate the
    // figure the specification asked for -- both are the renderer deciding a
    // different scientific value to make the picture convenient, which is the
    // one thing this contract exists to prevent.
    //
    // So it is said in words instead. The mark keeps its position and stays
    // visible, the figure never calls it zero -- the all-zero sentence reads
    // source values and cannot fire here -- and the reader is told that a real
    // measurement lies below what this value range can show.
    //
    // Counted for the panel rather than attributed per series: a panel holds at
    // most one series drawn from the zero line, because roles are unique and a
    // baseline is always joined, so there is no attribution to lose.
    let unshowable = panel
        .series
        .iter()
        .filter(|series| !panel.joins(series))
        .flat_map(|series| series.x().iter().zip(series.y().iter()))
        .filter(|(at, value)| {
            **at >= drawn.low()
                && **at <= drawn.high()
                && !is_measured_zero(**value)
                && draws_without_length(
                    project(
                        **value,
                        panel.displayed_value_domain(),
                        frame.plot_bottom,
                        frame.plot_top,
                    ),
                    frame.zero_y,
                )
        })
        .count();
    if unshowable > 0 {
        sentences.push(format!(
            "{unshowable} drawn {} not zero but {} too small to show against the value \
             range of this figure; {} marked on the zero line without a height, where a \
             measured zero is marked too.",
            if unshowable == 1 {
                "measurement is"
            } else {
                "measurements are"
            },
            if unshowable == 1 { "is" } else { "are" },
            if unshowable == 1 { "it is" } else { "they are" },
        ));
    }

    // Every marker line the figure actually draws, each one named and placed.
    //
    // The root element is `role="img"`, and that is what makes this necessary:
    // assistive technology reads an image's accessible name and description and
    // does not descend into the `<text>` inside it. A marker label drawn on the
    // page is therefore not a label a screen-reader user has, however well it
    // was placed. The description reported only the two cases where nothing
    // readable had been drawn -- a marker carrying no label, and one whose
    // label the page had no room for -- which is exactly backwards: a placed
    // label is no more recoverable from a `role="img"` document than either of
    // them, so the annotation most likely to matter was the one left out.
    //
    // One clause per marker rather than one sentence per failure mode. The old
    // shape reported an unplaced label in a sentence that never said where that
    // marker was, while a placed one appeared in no sentence at all: three
    // partial views of the same annotation that a reader holding only the words
    // could not reconcile. Here each drawn marker is stated once, with its
    // position in the axis's own notation, its label if it has one, and whether
    // that label reached the page.
    //
    // Only those inside the drawn window: a marker outside it draws no line,
    // and reporting one would describe something the figure does not contain.
    let notation = axis_notation(drawn);
    let marked: Vec<String> = panel
        .markers
        .iter()
        .enumerate()
        .filter(|(_, marker)| marker.at() >= drawn.low() && marker.at() <= drawn.high())
        .map(|(index, marker)| {
            let at = marker_number(marker.at(), notation);
            match marker.label() {
                None => format!("an unlabelled line at {at}"),
                // Named and placed in one clause, so the two facts cannot drift
                // apart or be read as two annotations.
                Some(label) if unplaced.contains(&index) => format!(
                    "\"{}\" at {at}, whose label the figure is too small to place clear of \
                     the others",
                    label.as_str(),
                ),
                Some(label) => format!("\"{}\" at {at}", label.as_str()),
            }
        })
        .collect();
    match marked.as_slice() {
        [] => {}
        [only] => sentences.push(format!(
            "One marker line is drawn on the {} axis: {only}.",
            panel.x_axis.label.as_str(),
        )),
        // Semicolons rather than commas: a clause may carry one of its own.
        many => sentences.push(format!(
            "{} marker lines are drawn on the {} axis: {}.",
            many.len(),
            panel.x_axis.label.as_str(),
            many.join("; "),
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
    // Where every panel's plotting area is, computed before anything is
    // written because the precision decision has to project the drawn geometry
    // into it first.
    let frames = panel_frames(figure, width, height);
    let precision = coordinate_precision(figure, &frames);

    let mut out = String::with_capacity(4_096);
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    let _ = write!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" \
         viewBox=\"0 0 {} {}\" role=\"img\"",
        precision.coordinate(width),
        precision.coordinate(height),
        precision.coordinate(width),
        precision.coordinate(height),
    );
    out.push_str(">\n");

    // The panels are drawn into a buffer before anything is written, because
    // the description below has to be able to say what the drawing actually
    // did -- and one of the things it must report is a marker label the page
    // had no room for. The document's order is unchanged: this only computes
    // the body earlier than it appends it.
    let (body, unplaced) = render_panels(figure, &frames, &colours, precision);

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
        .zip(frames.iter())
        .enumerate()
        .map(|(index, ((panel, missing), frame))| {
            panel_description(panel, missing, frame, (index, panel_count))
        })
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
        precision.coordinate(width),
        precision.coordinate(height),
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
            precision.coordinate(MARGIN_LEFT),
            colours.text,
            precision.coordinate(size),
            precision.coordinate(label.as_str().chars().count() as f64 * TEXT_EM * size),
            escape(label.as_str()),
        );
    }

    out.push_str(&body);
    out.push_str("</svg>\n");
    out
}

/// The plotting area of every panel, in figure units.
///
/// Panels stack in the order the specification gives them, sharing the figure's
/// height. One panel today; the arithmetic is already the general one so a
/// second does not change its shape.
///
/// Its own function because two passes need the same answer: the precision
/// decision has to project the drawn geometry into these frames before a byte
/// is written, and the renderer then projects it again to write it. A second
/// copy of this arithmetic is exactly how the two would come to disagree about
/// where the plot is.
fn panel_frames(figure: &FigureSpec, width: f64, height: f64) -> Vec<Frame> {
    let panel_count = figure.panels.len();
    let usable = height - MARGIN_TOP - MARGIN_BOTTOM;
    let panel_height = usable / panel_count as f64;
    figure
        .panels
        .iter()
        .enumerate()
        .map(|(index, panel)| {
            let top = MARGIN_TOP + panel_height * index as f64;
            let bottom = MARGIN_TOP + panel_height * (index as f64 + 1.0);
            let plot_top = top + 8.0;
            let plot_bottom = bottom - 34.0;
            let values = panel.displayed_value_domain();
            // Where zero falls in the value range, so a negative value hangs
            // below it and a positive one rises above it. A range that never
            // reaches zero puts the line at the nearer edge rather than off the
            // panel.
            let zero_y = if values.low() <= 0.0 && values.high() >= 0.0 {
                project(0.0, values, plot_bottom, plot_top)
            } else if values.high() < 0.0 {
                plot_top
            } else {
                plot_bottom
            };
            Frame {
                left: MARGIN_LEFT,
                right: width - MARGIN_RIGHT,
                plot_top,
                plot_bottom,
                zero_y,
            }
        })
        .collect()
}

/// Draws every panel, and reports the marker labels each had no room for.
fn render_panels(
    figure: &FigureSpec,
    frames: &[Frame],
    colours: &Palette,
    precision: Precision,
) -> (String, Vec<Vec<usize>>) {
    let mut body = String::with_capacity(4_096);
    let mut unplaced = Vec::with_capacity(figure.panels.len());
    for (panel, frame) in figure.panels.iter().zip(frames) {
        unplaced.push(render_panel(&mut body, panel, frame, colours, precision));
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
    precision: Precision,
) -> Vec<usize> {
    let domain = panel.drawn_domain();
    let values = panel.displayed_value_domain();
    let plot_top = frame.plot_top;
    let plot_bottom = frame.plot_bottom;
    let zero_y = frame.zero_y;

    let _ = writeln!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
        precision.coordinate(frame.left),
        precision.coordinate(zero_y),
        precision.coordinate(frame.right),
        precision.coordinate(zero_y),
        colours.axis,
    );
    let _ = writeln!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
        precision.coordinate(frame.left),
        precision.coordinate(plot_top),
        precision.coordinate(frame.left),
        precision.coordinate(plot_bottom),
        colours.axis,
    );

    for series in &panel.series {
        render_series(out, panel, series, frame, colours, precision);
    }

    // After the traces, so the names are not drawn under them, and before the
    // annotations, so a marker label can be told where the names already are.
    let legend = render_legend(out, panel, frame, colours, precision);

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
    occupied.extend(legend);
    // Which markers lost their labels, by index rather than by label text. Two
    // markers may legitimately carry the same words, and matching on those
    // words would attach one marker's layout failure to the other's clause.
    let mut unplaced: Vec<usize> = Vec::new();
    for (index, marker) in panel.markers.iter().enumerate() {
        if marker.at < domain.low() || marker.at > domain.high() {
            continue;
        }
        let x = project(marker.at, domain, frame.left, frame.right);
        let _ = writeln!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" \
             stroke-width=\"1\" stroke-dasharray=\"4 3\"/>",
            precision.coordinate(x),
            precision.coordinate(plot_top),
            precision.coordinate(x),
            precision.coordinate(plot_bottom),
            colours.marker,
        );
        if let Some(label) = marker.label.as_ref()
            && !render_marker_label(out, label, x, &mut occupied, frame, colours, precision)
        {
            unplaced.push(index);
        }
    }

    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
         textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        precision.coordinate(frame.left),
        precision.coordinate(plot_bottom + 14.0),
        colours.text,
        precision.coordinate(fitted_width(&domain_low_text, MARKER_LABEL_SIZE, end_room)),
        escape(&domain_low_text),
    );
    let _ = writeln!(
        out,
        "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" font-size=\"11\" \
         text-anchor=\"end\" textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\">{}</text>",
        precision.coordinate(frame.right),
        precision.coordinate(plot_bottom + 14.0),
        colours.text,
        precision.coordinate(fitted_width(&domain_high_text, MARKER_LABEL_SIZE, end_room)),
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
        precision.coordinate(f64::midpoint(frame.left, frame.right)),
        precision.coordinate(plot_bottom + 30.0),
        colours.text,
        precision.coordinate(domain_caption_size),
        precision.coordinate(fitted_width(
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
        precision.coordinate(centre_y),
        colours.text,
        precision.coordinate(value_caption_size),
        precision.coordinate(centre_y),
        precision.coordinate(fitted_width(
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
        precision.coordinate(frame.left + 4.0),
        precision.coordinate(plot_top + 10.0),
        colours.text,
        precision.coordinate(fitted_width(
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
            precision.coordinate(frame.left + 4.0),
            precision.coordinate(plot_bottom - 2.0),
            colours.text,
            precision.coordinate(fitted_width(&value_low_text, MARKER_LABEL_SIZE, value_room)),
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
    precision: Precision,
) {
    if series.is_empty() {
        return;
    }
    let domain = panel.drawn_domain();
    let values = panel.displayed_value_domain();
    let (plot_top, plot_bottom, zero_y) = (frame.plot_top, frame.plot_bottom, frame.zero_y);
    let (stroke, dashes) = stroke_for(series.role, colours);

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
                    precision.coordinate(project(ax, domain, frame.left, frame.right)),
                    precision.coordinate(project(ay, values, plot_bottom, plot_top)),
                );
                pen_down = true;
            }
            let _ = write!(
                path,
                "L{} {}",
                precision.coordinate(project(bx, domain, frame.left, frame.right)),
                precision.coordinate(project(by, values, plot_bottom, plot_top)),
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
                precision.coordinate((x - LONE_SAMPLE_TICK).max(frame.left)),
                precision.coordinate(y),
                precision.coordinate((x + LONE_SAMPLE_TICK).min(frame.right)),
                precision.coordinate(y),
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
            if draws_without_length(top, zero_y) {
                let _ = write!(
                    path,
                    "M{} {}L{} {}",
                    precision.coordinate((at - LONE_SAMPLE_TICK).max(frame.left)),
                    precision.coordinate(zero_y),
                    precision.coordinate((at + LONE_SAMPLE_TICK).min(frame.right)),
                    precision.coordinate(zero_y),
                );
                continue;
            }
            let _ = write!(
                path,
                "M{} {}V{}",
                precision.coordinate(at),
                precision.coordinate(zero_y),
                precision.coordinate(top),
            );
        }
    }

    if path.is_empty() {
        return;
    }

    let _ = writeln!(
        out,
        "<path d=\"{path}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1\"{dashes}/>",
    );
}

/// How one role is drawn: its colour, and whether the stroke is broken.
///
/// One place, because the legend and the trace have to agree exactly. A legend
/// whose sample is a different dash pattern from the line it names is worse than
/// no legend: it looks like a third series.
///
/// The dash is not decoration. A second measured series distinguished by hue
/// alone disappears in a monochrome print, in a rasterization read by anyone
/// with a colour vision deficiency, and in a figure whose reader does not know
/// this product's palette -- and telling two measurements apart is the entire
/// reason the role exists.
fn stroke_for(role: StyleRole, colours: &Palette) -> (&'static str, &'static str) {
    match role {
        StyleRole::Measurement => (colours.measurement, ""),
        StyleRole::SecondaryMeasurement => {
            (colours.secondary_measurement, " stroke-dasharray=\"6 3\"")
        }
        StyleRole::Baseline => (colours.baseline, ""),
    }
}

/// Names the series a panel draws, where the drawing needs naming.
///
/// Only where two measured series share a panel. One measurement -- read against
/// a reference baseline or alone -- is already named by the description and by
/// its own axis, and a legend for it would add a second thing to lay out in a
/// plotting area that has a trace in it. Two measurements is the case the
/// drawing genuinely cannot resolve: two lines, and nothing on the page saying
/// which is the total ion current and which the base peak.
///
/// Returns the boxes it occupied, so a marker label steps around it rather than
/// over it.
fn render_legend(
    out: &mut String,
    panel: &PanelSpec,
    frame: &Frame,
    colours: &Palette,
    precision: Precision,
) -> Vec<TextBox> {
    let measured = panel
        .series()
        .iter()
        .filter(|series| series.role().is_measured())
        .count();
    if measured < 2 {
        return Vec::new();
    }

    // Right-aligned inside the plotting area. The value-axis ends are written
    // at its left edge, so this is the one side of the panel that is not
    // already spoken for.
    let right = frame.right - MARKER_LABEL_INSET;
    let room = (frame.right - frame.left) - LEGEND_SWATCH - LEGEND_GAP - MARKER_LABEL_INSET;
    let mut occupied = Vec::with_capacity(panel.series().len());
    for (row, series) in panel.series().iter().enumerate() {
        let (stroke, dashes) = stroke_for(series.role(), colours);
        let name = series.id().as_str();
        // Condensed rather than clipped, exactly as an axis end is: a name the
        // page had no room for is a legend entry that names nothing.
        let width = fitted_width(name, LEGEND_SIZE, room);
        let baseline = frame.plot_top + LEGEND_SIZE + (row as f64) * (LEGEND_SIZE + 3.0);
        if baseline > frame.plot_bottom {
            break;
        }
        let text_left = right - width;
        let swatch_right = text_left - LEGEND_GAP;
        let swatch_left = swatch_right - LEGEND_SWATCH;
        let _ = writeln!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{stroke}\" \
             stroke-width=\"1\"{dashes}/>",
            precision.coordinate(swatch_left.max(frame.left)),
            precision.coordinate(baseline - LEGEND_SIZE / 3.0),
            precision.coordinate(swatch_right.max(frame.left)),
            precision.coordinate(baseline - LEGEND_SIZE / 3.0),
        );
        let _ = writeln!(
            out,
            "<text x=\"{}\" y=\"{}\" fill=\"{}\" font-family=\"sans-serif\" \
             font-size=\"{}\" text-anchor=\"end\" textLength=\"{}\" \
             lengthAdjust=\"spacingAndGlyphs\">{}</text>",
            precision.coordinate(right),
            precision.coordinate(baseline),
            colours.text,
            precision.coordinate(LEGEND_SIZE),
            precision.coordinate(width),
            escape(name),
        );
        occupied.push(TextBox::new(
            swatch_left.max(frame.left),
            baseline,
            right - swatch_left.max(frame.left),
            0.0,
            LEGEND_SIZE,
        ));
    }
    occupied
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
    precision: Precision,
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
        precision.coordinate(left),
        precision.coordinate(top),
        colours.marker,
        precision.coordinate(size),
    );
    for (index, line) in lines.iter().enumerate() {
        let _ = write!(
            out,
            "<tspan x=\"{}\" y=\"{}\" xml:space=\"preserve\" textLength=\"{}\" \
             lengthAdjust=\"spacingAndGlyphs\">{}</tspan>",
            precision.coordinate(left),
            precision.coordinate(top + index as f64 * leading),
            precision.coordinate(line.chars().count() as f64 * character),
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
    let notation = axis_notation(domain);
    (
        axis_number(domain.low(), notation),
        axis_number(domain.high(), notation),
    )
}

/// How one axis writes its numbers.
///
/// Extracted so that everything naming a position on that axis says it the same
/// way. A marker described in one notation while the axis is labelled in
/// another puts the `<desc>` in conflict with the drawing it describes: against
/// `1e-20 .. 4e-20` the ends print as exponents while a fixed-point marker
/// position rounded to `0.000000`, naming a coordinate the line is not drawn at.
#[derive(Clone, Copy)]
enum AxisNotation {
    /// Fixed point, to this many decimals.
    Fixed(usize),
    /// Shortest-round-trip exponent form.
    Exponent,
}

/// Whether a fixed-point rendering has rounded a number away to nothing.
fn rounds_away(value: f64, text: &str) -> bool {
    value != 0.0 && text.parse::<f64>() == Ok(0.0)
}

/// Which notation this axis needs, decided once from its two ends.
fn axis_notation(domain: Domain) -> AxisNotation {
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
    let unreadable =
        low.chars().count() > MAX_AXIS_LABEL_CHARS || high.chars().count() > MAX_AXIS_LABEL_CHARS;
    if unreadable
        || rounds_away(domain.low(), &low)
        || rounds_away(domain.high(), &high)
        || (domain.span() > 0.0 && low == high)
    {
        return AxisNotation::Exponent;
    }
    AxisNotation::Fixed(decimals)
}

/// One number written the way its axis writes numbers.
///
/// A value that fixed point would round away to nothing escalates on its own,
/// even where the axis ends did not need to: an axis spanning `0 .. 100` prints
/// no decimals, and a marker at `0.0001` described as being at `0` names a
/// position the line is not drawn at.
fn axis_number(value: f64, notation: AxisNotation) -> String {
    match notation {
        AxisNotation::Exponent => format!("{:e}", normalized_zero(value)),
        AxisNotation::Fixed(decimals) => {
            let text = format_number(value, decimals);
            if rounds_away(value, &text) {
                format!("{:e}", normalized_zero(value))
            } else {
                text
            }
        }
    }
}

/// One marker coordinate, written so that it stays that coordinate.
///
/// The axis and this sentence do different jobs, and forcing them to share a
/// precision makes one of them false. An axis end is a statement of a *display
/// range*: `0 .. 100` printing no decimals says how wide the view is, and says
/// it well. A marker sentence is a statement of *where one line is*, and a
/// marker at `1.4` described as being "at 1" names a coordinate the figure does
/// not draw it at -- an exact-looking number that is simply wrong, which is
/// worse in a scientific export than a longer one that is right.
///
/// So the *notation* is still the axis's -- fixed point stays fixed point, an
/// exponent axis stays exponent, and the `<desc>` never reads in a different
/// form from the numbers printed beside the plot -- while the decimals grow
/// until the text parses back to the very `f64` the specification carries. That
/// is the value's own bound in both directions: it cannot print a digit the
/// number does not hold, and it stops the moment the number is stated.
fn marker_number(value: f64, notation: AxisNotation) -> String {
    let normalized = normalized_zero(value);
    let AxisNotation::Fixed(decimals) = notation else {
        return format!("{normalized:e}");
    };
    // A value fixed point rounds away to nothing keeps the escalation it
    // already had. `0.0001` on a `0 .. 100` axis is stated as `1e-4` rather
    // than as four decimal places of leading zeros: both are the same number,
    // and the exponent is the one a reader can take in at a glance.
    if rounds_away(value, &format_number(value, decimals)) {
        return format!("{normalized:e}");
    }
    for places in decimals..=MAX_AXIS_DECIMALS {
        let text = format_number(value, places);
        if text.parse::<f64>() != Ok(normalized) {
            continue;
        }
        // Bounded like an axis end, and for the same reason: a coordinate that
        // needs every decimal an `f64` holds prints a string nobody reads as a
        // number, and the exponent form states the same value in fewer
        // characters without dropping any of it.
        return if text.chars().count() > MAX_AXIS_LABEL_CHARS {
            format!("{normalized:e}")
        } else {
            text
        };
    }
    // No fixed-point form this side of the `f64`'s own limit states this value,
    // which is the case exponent notation exists for.
    format!("{normalized:e}")
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
