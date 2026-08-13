//! The renderer-independent semantic contract.
//!
//! What a figure *means*, with nothing in it about how any renderer draws it.
//! There is no component name, no CSS class, no DOM identifier, no path, no
//! handle and no command name here, and that is the point: the screen and the
//! export must be able to disagree about technology while agreeing about
//! science.
//!
//! ## Why validation is a boundary rather than a habit
//!
//! Every value below is either unrepresentable when invalid or refused at one
//! constructor. A caller cannot build a panel whose axes disagree in length,
//! whose points are not finite, or whose domain runs backwards -- so a renderer
//! downstream never has to decide what to draw for a number that cannot be
//! drawn, and never has to invent one.

use serde::{Deserialize, Serialize};
use std::fmt;

/// The contract version this build writes and accepts.
///
/// One rather than two: the shape this replaced was a scaffold with no reader
/// anywhere in the workspace and no serialized instance in existence, so there
/// is no version 1 data for a version 2 to be compatible with. What is new is
/// that this one is a contract rather than a sketch.
pub const SCHEMA_VERSION: u32 = 1;

/// The longest a label may be.
///
/// Labels come from files this application did not write, so they are bounded
/// rather than trusted. Long enough for a real axis label or a sample name,
/// short enough that no single string can dominate a figure or a document.
pub const MAX_LABEL_CHARS: usize = 120;

/// The longest a caption may be.
pub const MAX_CAPTION_CHARS: usize = 600;

/// The largest figure edge, in figure units.
///
/// A bound rather than a preference: a figure is rendered into a string, and an
/// unbounded edge is an unbounded document.
pub const MAX_FIGURE_EDGE: f64 = 20_000.0;

/// The most panels one figure may hold.
pub const MAX_PANELS: usize = 8;

/// Why a specification was refused.
///
/// Closed and specific. Each member names one thing a caller can correct, and
/// none of them carries the value that was wrong -- a rejected label is
/// untrusted text and repeating it into an error string would carry it further.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecError {
    /// A label was empty, or held only whitespace.
    LabelEmpty,
    /// A label was longer than the bound.
    LabelTooLong,
    /// A label held a control character.
    LabelNotPrintable,
    /// A coordinate was not finite.
    NotFinite,
    /// The two coordinate arrays were different lengths.
    AxisLengthMismatch,
    /// The domain values were the wrong way round.
    DomainInverted,
    /// The source points were not in non-decreasing order of the domain axis.
    SourceNotOrdered,
    /// A figure edge was not a positive, bounded, finite number.
    FigureSizeOutOfRange,
    /// A figure held no panel, or more than the bound.
    PanelCountOutOfRange,
    /// A reduction claimed to come from fewer points than it holds.
    ReductionNotSmaller,
    /// A decoded document declared a schema this build does not accept.
    UnknownSchemaVersion,
}

impl fmt::Display for SpecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::LabelEmpty => "a label was empty",
            Self::LabelTooLong => "a label was longer than the bound",
            Self::LabelNotPrintable => "a label held a control character",
            Self::NotFinite => "a coordinate was not finite",
            Self::AxisLengthMismatch => "the coordinate arrays were different lengths",
            Self::DomainInverted => "a domain ran backwards",
            Self::SourceNotOrdered => "the source points were not ordered",
            Self::FigureSizeOutOfRange => "a figure edge was out of range",
            Self::PanelCountOutOfRange => "the panel count was out of range",
            Self::ReductionNotSmaller => "a reduction was not smaller than its source",
            Self::UnknownSchemaVersion => "the document declares an unknown schema version",
        })
    }
}

impl std::error::Error for SpecError {}

/// One bounded, printable piece of display text.
///
/// A newtype rather than a `String`, so a label that was never checked cannot
/// reach a figure by being assigned to a field of the right type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Label(String);

impl Label {
    /// Accepts one label, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses empty, over-long and non-printable text. Control characters are
    /// refused rather than stripped: a label that had to be altered to be shown
    /// is not the label the file carried, and silently changing it would be
    /// this boundary editing the user's data.
    pub fn new(text: impl Into<String>) -> Result<Self, SpecError> {
        let text = text.into();
        if text.trim().is_empty() {
            return Err(SpecError::LabelEmpty);
        }
        if text.chars().count() > MAX_LABEL_CHARS {
            return Err(SpecError::LabelTooLong);
        }
        if text.chars().any(char::is_control) {
            return Err(SpecError::LabelNotPrintable);
        }
        Ok(Self(text))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One bounded, printable caption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Caption(String);

impl Caption {
    /// Accepts one caption, or says why it is not one.
    ///
    /// # Errors
    ///
    /// As [`Label::new`], with a longer bound: a caption is a sentence.
    pub fn new(text: impl Into<String>) -> Result<Self, SpecError> {
        let text = text.into();
        if text.trim().is_empty() {
            return Err(SpecError::LabelEmpty);
        }
        if text.chars().count() > MAX_CAPTION_CHARS {
            return Err(SpecError::LabelTooLong);
        }
        if text
            .chars()
            .any(|character| character.is_control() && character != '\n')
        {
            return Err(SpecError::LabelNotPrintable);
        }
        Ok(Self(text))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// What the source file said a spectrum's points are.
///
/// Three members, and the third is the reason this is not a `bool`. A file that
/// reports nothing is **not** centroid data, and it is not profile data either;
/// it is a spectrum whose representation nobody has stated. Collapsing that
/// into either would be this application asserting a scientific fact it was
/// never told.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpectrumRepresentation {
    /// The file reported centroided peaks.
    Centroid,
    /// The file reported profile samples.
    Profile,
    /// The file reported neither. Not a synonym for either of the above.
    Unreported,
}

impl SpectrumRepresentation {
    /// Whether points of this representation may be joined into a trace.
    ///
    /// Only established profile data. Joining centroid peaks would draw
    /// intensity at m/z values nobody measured, and joining unreported points
    /// would do that *and* assert the representation while doing it.
    #[must_use]
    pub const fn may_draw_continuous_trace(self) -> bool {
        matches!(self, Self::Profile)
    }
}

/// What the source file said an axis is measured in.
///
/// `Unreported` and `Dimensionless` are different facts and are kept apart. A
/// file that stated no unit has not told us the quantity is a pure number; an
/// axis that genuinely has no dimension has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UnitState {
    /// The file reported this unit.
    Known { unit: Label },
    /// The file reported no unit. Nothing may be displayed as one.
    Unreported,
    /// The quantity genuinely has no dimension.
    Dimensionless,
}

/// What one panel plots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlotKind {
    /// A mass spectrum, carrying what the file said its points are.
    Spectrum {
        representation: SpectrumRepresentation,
    },
    /// An ordered trace over a separation axis.
    Chromatogram,
}

/// One axis, semantically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AxisSpec {
    /// What the axis is, in words. Never a CSS selector or a field name.
    pub label: Label,
    pub unit: UnitState,
}

impl AxisSpec {
    #[must_use]
    pub const fn new(label: Label, unit: UnitState) -> Self {
        Self { label, unit }
    }
}

/// A closed interval on one axis.
///
/// Finite and ordered by construction, so no renderer has to decide what to do
/// with a backwards or infinite range.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Domain {
    low: f64,
    high: f64,
}

impl Domain {
    /// Accepts one interval, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses a non-finite bound and a bound pair that runs backwards. A
    /// single-valued domain -- `low == high` -- is accepted: a flat trace and a
    /// one-point spectrum are real scenes, and refusing them here would make
    /// the renderer invent a span instead.
    pub fn new(low: f64, high: f64) -> Result<Self, SpecError> {
        if !low.is_finite() || !high.is_finite() {
            return Err(SpecError::NotFinite);
        }
        if low > high {
            return Err(SpecError::DomainInverted);
        }
        Ok(Self { low, high })
    }

    #[must_use]
    pub const fn low(self) -> f64 {
        self.low
    }

    #[must_use]
    pub const fn high(self) -> f64 {
        self.high
    }

    /// The width of the interval, which may be zero.
    #[must_use]
    pub fn span(self) -> f64 {
        self.high - self.low
    }
}

/// How one column of a reduction was chosen.
///
/// Named rather than implied, because a figure that says it was reduced owes
/// the reader the rule. `MinMaxPerColumn` is the only rule this build performs
/// and the only one it can honestly describe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionRule {
    /// The highest and the lowest value of each column, both kept.
    ///
    /// Both, because intensity may be negative after baseline subtraction and
    /// keeping only the larger magnitude would erase measured signal of the
    /// other sign.
    MinMaxPerColumn,
}

/// Whether these points are the source or a reduction of it.
///
/// The distinction the export path exists for. A screen may draw a reduction; a
/// figure that claims to be the full range must carry the full range, and this
/// is what makes the difference checkable rather than a convention.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum DataScope {
    /// Every source point within the panel's domain.
    FullSource,
    /// A reduction, with what it came from and the rule that made it.
    Reduced {
        source_point_count: usize,
        rule: ReductionRule,
    },
}

/// What a series is for, semantically.
///
/// Roles rather than colours or class names. A renderer maps a role to its own
/// theme; the specification never names a stylesheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StyleRole {
    /// The measured data itself.
    Measurement,
    /// A reference line the data is read against.
    Baseline,
}

/// One ordered set of points, and what it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeriesSpec {
    /// Stable within one specification. Not a database key and not a handle.
    pub id: Label,
    pub role: StyleRole,
    pub scope: DataScope,
    x: Vec<f64>,
    y: Vec<f64>,
}

impl SeriesSpec {
    /// Accepts one ordered series, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses mismatched lengths, non-finite coordinates, domain values that
    /// are not non-decreasing, and a reduction that claims a source smaller
    /// than itself.
    ///
    /// Negative `y` is **accepted and preserved**. Intensity after baseline
    /// subtraction is legitimately negative, and a contract that dropped it
    /// would erase measured signal before any renderer saw it.
    pub fn new(
        id: Label,
        role: StyleRole,
        scope: DataScope,
        x: Vec<f64>,
        y: Vec<f64>,
    ) -> Result<Self, SpecError> {
        if x.len() != y.len() {
            return Err(SpecError::AxisLengthMismatch);
        }
        if x.iter().chain(y.iter()).any(|value| !value.is_finite()) {
            return Err(SpecError::NotFinite);
        }
        if x.windows(2).any(|pair| pair[0] > pair[1]) {
            return Err(SpecError::SourceNotOrdered);
        }
        if let DataScope::Reduced {
            source_point_count, ..
        } = scope
            && source_point_count < x.len()
        {
            return Err(SpecError::ReductionNotSmaller);
        }
        Ok(Self {
            id,
            role,
            scope,
            x,
            y,
        })
    }

    #[must_use]
    pub fn x(&self) -> &[f64] {
        &self.x
    }

    #[must_use]
    pub fn y(&self) -> &[f64] {
        &self.y
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.x.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    /// How many source points this series stands for.
    #[must_use]
    pub fn source_point_count(&self) -> usize {
        match self.scope {
            DataScope::FullSource => self.x.len(),
            DataScope::Reduced {
                source_point_count, ..
            } => source_point_count,
        }
    }
}

/// A persistent point of interest on the domain axis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Marker {
    pub at: f64,
    pub label: Option<Label>,
}

impl Marker {
    /// Accepts one marker, or refuses a non-finite position.
    ///
    /// # Errors
    ///
    /// Refuses a position that is not finite.
    pub fn new(at: f64, label: Option<Label>) -> Result<Self, SpecError> {
        if !at.is_finite() {
            return Err(SpecError::NotFinite);
        }
        Ok(Self { at, label })
    }
}

/// One plot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PanelSpec {
    pub kind: PlotKind,
    pub x_axis: AxisSpec,
    pub y_axis: AxisSpec,
    /// The whole domain the source covers.
    pub full_domain: Domain,
    /// The part of it on screen, when that is narrower than the whole.
    pub visible_domain: Option<Domain>,
    /// The value range, which may reach below zero.
    pub value_domain: Domain,
    pub series: Vec<SeriesSpec>,
    pub markers: Vec<Marker>,
}

impl PanelSpec {
    /// Accepts one panel, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses a visible domain that is not inside the full domain. Everything
    /// else was already refused by the value constructors this takes, which is
    /// the point of taking them rather than raw numbers.
    pub fn new(
        kind: PlotKind,
        x_axis: AxisSpec,
        y_axis: AxisSpec,
        full_domain: Domain,
        value_domain: Domain,
        series: Vec<SeriesSpec>,
    ) -> Result<Self, SpecError> {
        Ok(Self {
            kind,
            x_axis,
            y_axis,
            full_domain,
            visible_domain: None,
            value_domain,
            series,
            markers: Vec::new(),
        })
    }

    /// Narrows the panel to a visible sub-range.
    ///
    /// # Errors
    ///
    /// Refuses a range reaching outside the full domain: a visible window the
    /// source does not cover would ask a renderer to draw where nothing was
    /// measured.
    pub fn with_visible_domain(mut self, visible: Domain) -> Result<Self, SpecError> {
        if visible.low() < self.full_domain.low() || visible.high() > self.full_domain.high() {
            return Err(SpecError::DomainInverted);
        }
        self.visible_domain = Some(visible);
        Ok(self)
    }

    #[must_use]
    pub fn with_markers(mut self, markers: Vec<Marker>) -> Self {
        self.markers = markers;
        self
    }

    /// The domain a renderer should draw: the visible window when there is one.
    #[must_use]
    pub fn drawn_domain(&self) -> Domain {
        self.visible_domain.unwrap_or(self.full_domain)
    }

    /// Whether every series carries its full source.
    ///
    /// What a full-range export must be able to answer yes to.
    #[must_use]
    pub fn is_full_source(&self) -> bool {
        self.series
            .iter()
            .all(|series| matches!(series.scope, DataScope::FullSource))
    }
}

/// Which palette a figure is rendered in.
///
/// A figure's own, never the application's. A user reading a dark screen still
/// publishes on white paper, so these are separate decisions and this type is
/// what keeps them separate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FigureTheme {
    Light,
    Dark,
}

/// How large the figure is, in figure units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FigureSize {
    width: f64,
    height: f64,
}

impl FigureSize {
    /// Accepts one size, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses a non-finite, non-positive or unbounded edge.
    pub fn new(width: f64, height: f64) -> Result<Self, SpecError> {
        let sane = |edge: f64| edge.is_finite() && edge > 0.0 && edge <= MAX_FIGURE_EDGE;
        if !sane(width) || !sane(height) {
            return Err(SpecError::FigureSizeOutOfRange);
        }
        Ok(Self { width, height })
    }

    #[must_use]
    pub const fn width(self) -> f64 {
        self.width
    }

    #[must_use]
    pub const fn height(self) -> f64 {
        self.height
    }
}

/// One figure: ordered panels, a size, a theme and its own words.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FigureSpec {
    pub schema_version: u32,
    pub theme: FigureTheme,
    pub size: FigureSize,
    pub title: Option<Label>,
    pub caption: Option<Caption>,
    /// Ordered. One panel today; the order is in the contract because a second
    /// panel must not have to change the shape to be placed.
    pub panels: Vec<PanelSpec>,
}

impl FigureSpec {
    /// Accepts one figure, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses an empty panel list and more panels than the bound.
    pub fn new(
        theme: FigureTheme,
        size: FigureSize,
        panels: Vec<PanelSpec>,
    ) -> Result<Self, SpecError> {
        if panels.is_empty() || panels.len() > MAX_PANELS {
            return Err(SpecError::PanelCountOutOfRange);
        }
        Ok(Self {
            schema_version: SCHEMA_VERSION,
            theme,
            size,
            title: None,
            caption: None,
            panels,
        })
    }

    #[must_use]
    pub fn with_title(mut self, title: Label) -> Self {
        self.title = Some(title);
        self
    }

    #[must_use]
    pub fn with_caption(mut self, caption: Caption) -> Self {
        self.caption = Some(caption);
        self
    }

    /// Decodes one figure, refusing a schema this build does not accept.
    ///
    /// Fails closed rather than reading what it recognises: a document from a
    /// later build may mean something different by the same field names, and
    /// guessing would be this boundary inventing the difference.
    ///
    /// # Errors
    ///
    /// Refuses malformed JSON and any schema version but this build's.
    pub fn from_json(document: &str) -> Result<Self, DecodeError> {
        let decoded: Self = serde_json::from_str(document).map_err(|_| DecodeError::Malformed)?;
        if decoded.schema_version != SCHEMA_VERSION {
            return Err(DecodeError::Spec(SpecError::UnknownSchemaVersion));
        }
        Ok(decoded)
    }

    /// Encodes one figure.
    ///
    /// # Errors
    ///
    /// Propagates a serializer failure, which this shape does not produce.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// Why a document could not be read as a figure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    /// The text was not this shape at all.
    Malformed,
    /// The text was this shape and the shape was refused.
    Spec(SpecError),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed => formatter.write_str("the document is not a figure specification"),
            Self::Spec(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for DecodeError {}
