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
/// **Two, because version 1 cannot read what this build writes.** M4.3 added two
/// pieces of representable meaning: a panel may declare a *visible value domain*
/// beside its full one, and a series may take the `secondary_measurement` role.
/// Every wire shape here is `deny_unknown_fields` and every enum is closed, so a
/// build that knows only version 1 refuses a document carrying either -- and it
/// refuses it as an unknown field or an unknown variant, which tells a reader
/// nothing about why. Bumping makes the same refusal say what actually happened.
///
/// Nothing is migrated, because there is nothing to migrate: no `FigureSpec` is
/// persisted anywhere, none crosses into the webview, and the saved-figure
/// feature that would create one (FIG-007) is unimplemented. The cost of this
/// decision is repository fixtures, and it was paid deliberately rather than by
/// leaving a version number that quietly disagreed with `deny_unknown_fields`.
pub const SCHEMA_VERSION: u32 = 2;

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

/// The narrowest figure any renderer here can draw into.
///
/// A figure needs gutters for its value labels and its axis caption, and below
/// some width those gutters meet and the plotting area runs backwards. The
/// exact gutters are a renderer's business, so this is a contract-level floor
/// generous enough for any of them; a test pins that this repository's renderer
/// fits inside it.
pub const MIN_FIGURE_WIDTH: f64 = 200.0;

/// The height one figure needs before its first panel.
pub const MIN_FIGURE_CHROME_HEIGHT: f64 = 100.0;

/// The height each panel needs on top of that.
///
/// A panel is not drawable at any height: a renderer prints the top and the
/// bottom of its value range inside the plotting area, and below some height
/// those two lines of text are closer together than they are tall. This floor
/// is generous enough for any renderer here; a test pins that this
/// repository's renderer keeps them legibly apart at exactly this height.
pub const MIN_PANEL_HEIGHT: f64 = 80.0;

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
    /// A label held a character no XML document is allowed to carry.
    LabelNotXmlSafe,
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
    /// A figure was too small for the panels it declared.
    FigureTooSmallForPanels,
    /// A reduction claimed to come from fewer points than it holds.
    ReductionNotSmaller,
    /// A reduction of a non-empty source kept no points at all.
    ReductionKeptNothing,
    /// A series held a point outside the panel's own declared domains.
    PointOutsideDomain,
    /// A panel drawn as marks from zero declared a value range excluding zero.
    BaselineOutsideValueDomain,
    /// A domain's two ends were finite but the width between them was not.
    DomainSpanNotFinite,
    /// A joined trace declared a reduction that keeps only one sign's extreme.
    ReductionRuleUnsuitableForTrace,
    /// A marker was placed where the panel's source does not reach.
    MarkerOutsideFullDomain,
    /// A panel carried two series of the same style role.
    DuplicateSeriesRole,
    /// A panel declared no series at all.
    PanelHasNoSeries,
    /// A panel's visible value window left the value range its source covers.
    VisibleValueDomainOutsideValueDomain,
    /// A decoded document declared a schema this build does not accept.
    UnknownSchemaVersion,
}

impl fmt::Display for SpecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::LabelEmpty => "a label was empty",
            Self::LabelTooLong => "a label was longer than the bound",
            Self::LabelNotPrintable => "a label held a control character",
            Self::LabelNotXmlSafe => "a label held a character XML cannot carry",
            Self::NotFinite => "a coordinate was not finite",
            Self::AxisLengthMismatch => "the coordinate arrays were different lengths",
            Self::DomainInverted => "a domain ran backwards",
            Self::SourceNotOrdered => "the source points were not ordered",
            Self::FigureSizeOutOfRange => "a figure edge was out of range",
            Self::PanelCountOutOfRange => "the panel count was out of range",
            Self::FigureTooSmallForPanels => "the figure is too small for its panels",
            Self::ReductionNotSmaller => "a reduction was not smaller than its source",
            Self::ReductionKeptNothing => "a reduction of a non-empty source kept no points",
            Self::PointOutsideDomain => "a series left the panel's declared domain",
            Self::BaselineOutsideValueDomain => {
                "a panel drawn from the zero line declared a value range without zero in it"
            }
            Self::DomainSpanNotFinite => "a domain was wider than a finite number",
            Self::ReductionRuleUnsuitableForTrace => {
                "a joined trace was reduced by a rule that keeps one extreme per sign"
            }
            Self::MarkerOutsideFullDomain => "a marker was outside the panel's source domain",
            Self::DuplicateSeriesRole => {
                "a panel carried two series of the same style role, which cannot be told apart"
            }
            Self::PanelHasNoSeries => "a panel declared no series at all",
            Self::VisibleValueDomainOutsideValueDomain => {
                "a panel's visible value window left the value range its source covers"
            }
            Self::UnknownSchemaVersion => "the document declares an unknown schema version",
        })
    }
}

impl std::error::Error for SpecError {}

/// Whether XML 1.0 permits this character in a document at all.
///
/// The `Char` production, minus the surrogates a Rust `char` cannot be. Tab,
/// newline and carriage return are listed for completeness; a label refuses
/// them anyway as control characters, which is stricter on purpose -- a line
/// break inside an axis label is not a label.
const fn is_xml_character(character: char) -> bool {
    matches!(character,
        '\u{9}' | '\u{A}' | '\u{D}'
        | '\u{20}'..='\u{D7FF}'
        | '\u{E000}'..='\u{FFFD}'
        | '\u{10000}'..='\u{10FFFF}')
}

/// One bounded, printable piece of display text.
///
/// A newtype rather than a `String`, so a label that was never checked cannot
/// reach a figure by being assigned to a field of the right type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Label(String);

/// Decoding a label applies the same rule its constructor does.
///
/// Derived, this was a public door into the newtype: a decoded `Label` is
/// accepted by `AxisSpec::new`, `with_title` and `with_caption` without
/// re-checking, because the type is supposed to mean *checked*. A newtype whose
/// invariant one entry point does not hold is a `String` with a longer name.
impl<'de> Deserialize<'de> for Label {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        Self::check(&text).map_err(serde::de::Error::custom)?;
        Ok(Self(text))
    }
}

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
        Self::check(&text)?;
        Ok(Self(text))
    }

    /// The rule, stated once.
    ///
    /// Read by the constructor and again by [`FigureSpec::from_json`], because
    /// `serde` builds this type field by field and never calls the constructor
    /// -- so a decoded document would otherwise hold a label the constructor
    /// refuses.
    fn check(text: &str) -> Result<(), SpecError> {
        if text.trim().is_empty() {
            return Err(SpecError::LabelEmpty);
        }
        if text.chars().count() > MAX_LABEL_CHARS {
            return Err(SpecError::LabelTooLong);
        }
        if text.chars().any(char::is_control) {
            return Err(SpecError::LabelNotPrintable);
        }
        // Beyond the control characters, XML 1.0 forbids two more that Rust is
        // happy to hold: `U+FFFE` and `U+FFFF` are `char`s, are not control
        // characters, and are outside the `Char` production. Escaping does
        // nothing for them -- they are not markup -- so they would be written
        // straight into a document no XML parser will read, and the figure
        // would not open at all. Refused rather than stripped, for the same
        // reason a control character is: a label that had to be altered to be
        // shown is not the label the file carried.
        if text.chars().any(|character| !is_xml_character(character)) {
            return Err(SpecError::LabelNotXmlSafe);
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), SpecError> {
        Self::check(&self.0)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One bounded, printable caption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Caption(String);

/// Decoding a caption applies the same rule its constructor does.
///
/// As [`Label`]: `with_caption` takes this type because the type means checked.
impl<'de> Deserialize<'de> for Caption {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        Self::check(&text).map_err(serde::de::Error::custom)?;
        Ok(Self(text))
    }
}

impl Caption {
    /// Accepts one caption, or says why it is not one.
    ///
    /// # Errors
    ///
    /// As [`Label::new`], with a longer bound: a caption is a sentence.
    pub fn new(text: impl Into<String>) -> Result<Self, SpecError> {
        let text = text.into();
        Self::check(&text)?;
        Ok(Self(text))
    }

    fn check(text: &str) -> Result<(), SpecError> {
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
        // Beyond the control characters, XML 1.0 forbids two more that Rust is
        // happy to hold: `U+FFFE` and `U+FFFF` are `char`s, are not control
        // characters, and are outside the `Char` production. Escaping does
        // nothing for them -- they are not markup -- so they would be written
        // straight into a document no XML parser will read, and the figure
        // would not open at all. Refused rather than stripped, for the same
        // reason a control character is: a label that had to be altered to be
        // shown is not the label the file carried.
        if text.chars().any(|character| !is_xml_character(character)) {
            return Err(SpecError::LabelNotXmlSafe);
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), SpecError> {
        Self::check(&self.0)
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
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
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
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
pub enum PlotKind {
    /// A mass spectrum, carrying what the file said its points are.
    Spectrum {
        representation: SpectrumRepresentation,
    },
    /// An ordered trace over a separation axis.
    Chromatogram,
}

impl PlotKind {
    /// Whether this kind joins its points into a trace rather than drawing
    /// each as its own mark.
    ///
    /// Stated once here rather than re-derived by each reader, because the
    /// renderer, the description and the validation below all have to agree
    /// about it -- and two of them agreeing while the third does not is how a
    /// figure comes to describe a drawing it did not make.
    #[must_use]
    pub const fn joins_a_trace(self) -> bool {
        match self {
            Self::Spectrum { representation } => representation.may_draw_continuous_trace(),
            Self::Chromatogram => true,
        }
    }

    /// Whether this kind draws each point as a length measured from zero.
    ///
    /// The complement of [`Self::joins_a_trace`]: a kind that is not joined is
    /// drawn as discrete marks rising from the zero line, and the length of
    /// each mark is what a reader reads as its magnitude. A trace carries no
    /// such promise -- it is a shape over the axis, and a value range that
    /// excludes zero merely zooms it.
    #[must_use]
    pub const fn draws_from_zero_baseline(self) -> bool {
        !self.joins_a_trace()
    }
}

/// One axis, semantically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
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

    fn validate(&self) -> Result<(), SpecError> {
        self.label.validate()?;
        if let UnitState::Known { unit } = &self.unit {
            unit.validate()?;
        }
        Ok(())
    }
}

/// A closed interval on one axis.
///
/// Finite and ordered by construction, so no renderer has to decide what to do
/// with a backwards or infinite range.
/// `Deserialize` is implemented rather than derived -- see [`WireDomain`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Domain {
    low: f64,
    high: f64,
}

/// The field-by-field shape `serde` builds for a [`Domain`], before any rule.
///
/// A derived `Deserialize` on the public type is a public door that skips its
/// constructor: `serde_json::from_str::<Domain>(r#"{"low":10,"high":0}"#)`
/// built an inverted domain whose `low`, `high` and `span` then contradicted
/// the sentence above them. Being reachable only through an outer constructor
/// that happens to revalidate is not the same as holding an invariant, and a
/// type that documents one owes it at every entry point.
#[derive(Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
struct WireDomain {
    low: f64,
    high: f64,
}

impl From<WireDomain> for Domain {
    fn from(wire: WireDomain) -> Self {
        Self {
            low: wire.low,
            high: wire.high,
        }
    }
}

impl<'de> Deserialize<'de> for Domain {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let domain = Self::from(WireDomain::deserialize(deserializer)?);
        domain.validate().map_err(serde::de::Error::custom)?;
        Ok(domain)
    }
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
        let domain = Self { low, high };
        domain.validate()?;
        Ok(domain)
    }

    fn validate(self) -> Result<(), SpecError> {
        if !self.low.is_finite() || !self.high.is_finite() {
            return Err(SpecError::NotFinite);
        }
        if self.low > self.high {
            return Err(SpecError::DomainInverted);
        }
        // Both ends finite is not enough: `f64::MAX - (-f64::MAX)` is infinity,
        // and a renderer dividing by that span produces `inf / inf` -- a `NaN`
        // coordinate written into a document this module promises never holds
        // one. Refused here rather than guarded in the renderer, so the promise
        // stays a property of the type.
        if !self.span().is_finite() {
            return Err(SpecError::DomainSpanNotFinite);
        }
        Ok(())
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
/// the reader the rule -- and because the two rules below are genuinely
/// different reductions that a single name would have blurred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionRule {
    /// The greatest and the least value of each column, both kept.
    ///
    /// The rule a trace needs. A chromatogram column holding a peak and the
    /// valley beside it keeps both, so the drawn line still has a lower edge.
    MinMaxPerColumn,
    /// The greatest non-negative and the least negative value of each column.
    ///
    /// What a stick plot needs, and **not** the same rule as above: a column of
    /// entirely positive values keeps only its tallest stick, because a shorter
    /// stick beside a taller one is drawn inside it and adds nothing. The
    /// negative half is tracked separately rather than dropped, because
    /// intensity is legitimately negative after baseline subtraction and
    /// keeping only the larger magnitude would erase measured signal of the
    /// other sign.
    ///
    /// Describing this as min/max would be false for every all-positive column,
    /// which is most of them.
    ExtremePerSignPerColumn,
}

impl ReductionRule {
    /// How a figure states this rule to a reader.
    #[must_use]
    pub const fn describe(self) -> &'static str {
        match self {
            Self::MinMaxPerColumn => "keeping the greatest and the least value in each column",
            Self::ExtremePerSignPerColumn => {
                "keeping the greatest non-negative and the deepest negative value in each column"
            }
        }
    }
}

/// Whether these points are the source or a reduction of it.
///
/// The distinction the export path exists for. A screen may draw a reduction; a
/// figure that claims to be the full range must carry the full range, and this
/// is what makes the difference checkable rather than a convention.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
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
    /// A second independently measured series, needing its own visual treatment.
    ///
    /// A chromatogram panel plots the total ion current and the base peak
    /// intensity of the same scans. Both are measurements: neither is derived
    /// from the other, neither is a model of the other, and a reader compares
    /// them. Before this role there were only two ways to say that, and both
    /// were false -- calling one of them a [`Self::Baseline`] claims it is a
    /// reference the other is read against, and giving both
    /// [`Self::Measurement`] makes them indistinguishable in the drawing and in
    /// the words, which is what [`SpecError::DuplicateSeriesRole`] refuses.
    ///
    /// It is **not** a baseline, a fit, a prediction, a derived quantity or a
    /// comparison result. It is another thing the instrument measured.
    ///
    /// Which series takes it is a property of the quantity, not of what happens
    /// to be visible: base peak intensity stays secondary when total ion current
    /// is hidden, so a figure of one trace and a figure of two agree about what
    /// that trace is.
    SecondaryMeasurement,
    /// A reference line the data is read against.
    Baseline,
}

impl StyleRole {
    /// Whether this role is something the instrument measured.
    ///
    /// The distinction a reader makes first, and the one the zero-baseline and
    /// joining rules are really about: a measurement is data, a baseline is a
    /// reference drawn beside it.
    #[must_use]
    pub const fn is_measured(self) -> bool {
        matches!(self, Self::Measurement | Self::SecondaryMeasurement)
    }
}

/// One ordered set of points, and what it is.
/// `Deserialize` is implemented rather than derived, as [`Domain`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SeriesSpec {
    /// Stable within one specification. Not a database key and not a handle.
    pub(crate) id: Label,
    pub(crate) role: StyleRole,
    pub(crate) scope: DataScope,
    x: Vec<f64>,
    y: Vec<f64>,
}

impl SeriesSpec {
    #[must_use]
    pub const fn id(&self) -> &Label {
        &self.id
    }

    #[must_use]
    pub const fn role(&self) -> StyleRole {
        self.role
    }

    #[must_use]
    pub const fn scope(&self) -> DataScope {
        self.scope
    }

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
        let series = Self {
            id,
            role,
            scope,
            x,
            y,
        };
        series.validate()?;
        Ok(series)
    }

    fn validate(&self) -> Result<(), SpecError> {
        self.id.validate()?;
        if self.x.len() != self.y.len() {
            return Err(SpecError::AxisLengthMismatch);
        }
        if self
            .x
            .iter()
            .chain(self.y.iter())
            .any(|value| !value.is_finite())
        {
            return Err(SpecError::NotFinite);
        }
        if self.x.windows(2).any(|pair| pair[0] > pair[1]) {
            return Err(SpecError::SourceNotOrdered);
        }
        // Strictly smaller, which is what the error has always been called. A
        // reduction that removed nothing is a `FullSource` series wearing the
        // other label, and the figure says so in words: "reduced to 5" from 5
        // source points asserts that measurements were dropped when none were.
        // The equal case is not a harmless rounding of the truth -- it is a
        // caller's misclassification reaching a scientific caption intact.
        if let DataScope::Reduced {
            source_point_count, ..
        } = self.scope
        {
            if source_point_count <= self.x.len() {
                return Err(SpecError::ReductionNotSmaller);
            }
            // Neither named rule can produce this. Both keep at least one
            // extreme from every column that holds a source point, so a
            // reduction of a non-empty source retains at least one point --
            // and a figure claiming otherwise says a rule did something the
            // rule cannot do, then draws the result as an empty panel. The
            // scope for a series with nothing in it is `FullSource`.
            if self.x.is_empty() {
                return Err(SpecError::ReductionKeptNothing);
            }
        }
        Ok(())
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
///
/// `Deserialize` is implemented rather than derived, as [`Domain`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Marker {
    pub(crate) at: f64,
    pub(crate) label: Option<Label>,
}

#[derive(Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
struct WireMarker {
    at: f64,
    label: Option<Label>,
}

impl From<WireMarker> for Marker {
    fn from(wire: WireMarker) -> Self {
        Self {
            at: wire.at,
            label: wire.label,
        }
    }
}

impl<'de> Deserialize<'de> for Marker {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let marker = Self::from(WireMarker::deserialize(deserializer)?);
        marker.validate().map_err(serde::de::Error::custom)?;
        Ok(marker)
    }
}

#[derive(Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
struct WireSeries {
    id: Label,
    role: StyleRole,
    scope: DataScope,
    x: Vec<f64>,
    y: Vec<f64>,
}

impl<'de> Deserialize<'de> for SeriesSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let series = Self::from(WireSeries::deserialize(deserializer)?);
        series.validate().map_err(serde::de::Error::custom)?;
        Ok(series)
    }
}

impl From<WireSeries> for SeriesSpec {
    fn from(wire: WireSeries) -> Self {
        Self {
            id: wire.id,
            role: wire.role,
            scope: wire.scope,
            x: wire.x,
            y: wire.y,
        }
    }
}

impl Marker {
    /// Accepts one marker, or refuses a non-finite position.
    ///
    /// # Errors
    ///
    /// Refuses a position that is not finite.
    #[must_use]
    pub const fn at(&self) -> f64 {
        self.at
    }

    #[must_use]
    pub const fn label(&self) -> Option<&Label> {
        self.label.as_ref()
    }

    pub fn new(at: f64, label: Option<Label>) -> Result<Self, SpecError> {
        let marker = Self { at, label };
        marker.validate()?;
        Ok(marker)
    }

    fn validate(&self) -> Result<(), SpecError> {
        if !self.at.is_finite() {
            return Err(SpecError::NotFinite);
        }
        if let Some(label) = self.label.as_ref() {
            label.validate()?;
        }
        Ok(())
    }
}

/// One plot.
///
/// `Deserialize` is implemented rather than derived, as [`Domain`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PanelSpec {
    pub(crate) kind: PlotKind,
    pub(crate) x_axis: AxisSpec,
    pub(crate) y_axis: AxisSpec,
    /// The whole domain the source covers.
    pub(crate) full_domain: Domain,
    /// The part of it on screen, when that is narrower than the whole.
    pub(crate) visible_domain: Option<Domain>,
    /// The value range the source covers, which may reach below zero.
    pub(crate) value_domain: Domain,
    /// The value range actually displayed, when that is narrower than the whole.
    ///
    /// Why a panel needs both. A current-range chromatogram must carry its
    /// **complete** source series -- that is what makes the figure a scientific
    /// document rather than a picture of a screen -- so [`Self::value_domain`]
    /// has to cover every source value, including a peak far outside the
    /// window. Scaling the drawing to that peak would flatten the range the
    /// reader actually asked for into a line along the bottom of the panel.
    ///
    /// So this is the window, and it does not claim the values outside it do
    /// not exist. `None` means the whole value range is shown, which is what
    /// every full-range figure says and what every selected-spectrum figure has
    /// always said.
    pub(crate) visible_value_domain: Option<Domain>,
    pub(crate) series: Vec<SeriesSpec>,
    pub(crate) markers: Vec<Marker>,
}

#[derive(Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
// Wire members throughout, not public ones. A wire shape whose parts validated
// themselves as they were read would report every inner refusal as a decoder
// message, and [`FigureSpec::from_json`] would lose the `SpecError` it exists to
// keep -- the split this module draws between a value refused as it is read and
// a document whose readable parts disagree. So the whole tree decodes
// unvalidated, and one `validate` at the top answers with the rule that failed.
struct WirePanel {
    kind: PlotKind,
    x_axis: AxisSpec,
    y_axis: AxisSpec,
    full_domain: WireDomain,
    visible_domain: Option<WireDomain>,
    value_domain: WireDomain,
    visible_value_domain: Option<WireDomain>,
    series: Vec<WireSeries>,
    markers: Vec<WireMarker>,
}

impl From<WirePanel> for PanelSpec {
    fn from(wire: WirePanel) -> Self {
        Self {
            kind: wire.kind,
            x_axis: wire.x_axis,
            y_axis: wire.y_axis,
            full_domain: wire.full_domain.into(),
            visible_domain: wire.visible_domain.map(Into::into),
            value_domain: wire.value_domain.into(),
            visible_value_domain: wire.visible_value_domain.map(Into::into),
            series: wire.series.into_iter().map(Into::into).collect(),
            markers: wire.markers.into_iter().map(Into::into).collect(),
        }
    }
}

impl<'de> Deserialize<'de> for PanelSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let panel = Self::from(WirePanel::deserialize(deserializer)?);
        panel.validate().map_err(serde::de::Error::custom)?;
        Ok(panel)
    }
}

impl PanelSpec {
    /// Accepts one panel, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses a series holding a point outside the declared domains.
    ///
    /// That check is the reason this takes domains at all rather than deriving
    /// them. A panel whose data leaves its own stated range is not a rendering
    /// problem to be clamped away later -- clamping would draw a value the
    /// measurement does not contain, at a position it was never at. Refusing
    /// here is what lets the renderer project without deciding anything.
    pub fn new(
        kind: PlotKind,
        x_axis: AxisSpec,
        y_axis: AxisSpec,
        full_domain: Domain,
        value_domain: Domain,
        series: Vec<SeriesSpec>,
    ) -> Result<Self, SpecError> {
        let panel = Self {
            kind,
            x_axis,
            y_axis,
            full_domain,
            visible_domain: None,
            value_domain,
            visible_value_domain: None,
            series,
            markers: Vec::new(),
        };
        panel.validate()?;
        Ok(panel)
    }

    fn validate(&self) -> Result<(), SpecError> {
        self.x_axis.validate()?;
        self.y_axis.validate()?;
        self.full_domain.validate()?;
        self.value_domain.validate()?;
        // A panel is a plot of something, and a panel of nothing is not a
        // plot of nothing -- it is a specification that forgot to say what it
        // draws. The renderer had no honest answer for it: the sentence that
        // names a panel's series joined an empty list and printed `Series: .`,
        // and no later sentence explained the blank plotting area, so a reader
        // could not tell a deliberately empty figure from a renderer that had
        // failed. That ambiguity is the one thing this export must never leave
        // open, and inventing a placeholder panel to describe would be the
        // contract making up a figure nobody asked for.
        //
        // This is **not** the same rule as refusing an empty measurement. A
        // spectrum that genuinely holds no peaks is a real scientific answer
        // and stays representable: it is one `SeriesSpec` carrying zero points,
        // which the description already discloses by name. What is refused here
        // is a panel that declares no series to have points at all.
        if self.series.is_empty() {
            return Err(SpecError::PanelHasNoSeries);
        }
        // A discrete mark is a length measured from zero, so a value range that
        // never reaches zero has no baseline to measure from. Drawn anyway, the
        // smallest value would sit exactly on the axis and vanish, and every
        // other mark would encode its distance from the range end instead of
        // its magnitude -- a stick plot whose lengths mean something other than
        // what a reader will take them to mean. Refused rather than widened
        // here: widening would draw against a range the specification does not
        // declare, and the axis text would then disagree with the drawing.
        //
        // Asked of the series actually drawn that way, not of the panel kind.
        // `joins` is the per-series answer -- a baseline is a joined reference
        // line whatever the panel draws -- so a centroid panel holding only a
        // baseline, or one whose measurement series is empty, draws nothing
        // from the zero line and may legitimately be zoomed to `5 .. 10` like
        // any other trace. Asking the kind refused those figures for a mark
        // that was never going to be drawn, while the rule's whole purpose is
        // the mark whose length would lie.
        if self
            .series
            .iter()
            .any(|series| !self.joins(series) && !series.is_empty())
            && (self.value_domain.low() > 0.0 || self.value_domain.high() < 0.0)
        {
            return Err(SpecError::BaselineOutsideValueDomain);
        }
        // One series per style role, because a role is exactly what a renderer
        // maps to a stroke. Two series sharing a role are drawn in one colour
        // at one width with nothing left to tell them apart -- and a
        // description naming both ids under the same role cannot say which line
        // is which either. A reader receiving that file sees two traces and can
        // attribute neither, which is worse than not having the figure: it
        // looks like a comparison and cannot be read as one.
        //
        // Stated over roles rather than over one role, because the ambiguity
        // belongs to the mapping and not to any particular member of it: a rule
        // written against `Measurement` alone left two baselines drawing the
        // same grey line as each other.
        //
        // Refused rather than styled around. Two series can be told apart only
        // if they carry different roles, because a role is what a renderer maps
        // to a stroke and to a legend entry: `Measurement` solid,
        // `SecondaryMeasurement` dashed, `Baseline` a thin reference line. A
        // chromatogram's total ion current and base peak intensity are two
        // measurements and take the first two -- which is why that role exists,
        // rather than one of them being called a baseline it is not.
        //
        // What stays refused is *two series claiming the same role*, which is
        // ambiguous in the drawing and in the words however many roles exist.
        // An arbitrary overlay of many measured layers is VIEW-008's
        // multi-layer comparison and needs a style system this contract does
        // not have; it should arrive with the component that can draw it rather
        // than as a figure that renders ambiguously today.
        let mut roles: Vec<StyleRole> = Vec::with_capacity(self.series.len());
        for series in &self.series {
            if roles.contains(&series.role) {
                return Err(SpecError::DuplicateSeriesRole);
            }
            roles.push(series.role);
        }
        // A joined trace and a per-sign reduction disagree about what a column
        // is. `ExtremePerSignPerColumn` keeps one value for an all-positive
        // column -- the tallest -- and joining those across columns draws the
        // upper envelope of the data rather than the data: every trough is
        // gone and the whole trace sits above the measurement. Nothing in the
        // output would say so, because each drawn point is real.
        //
        // Refused rather than left to the caller happening to pick the other
        // rule, and only in this direction: two sticks per column is not a
        // misdrawing, so a discrete panel accepts either rule.
        for series in &self.series {
            if !self.joins(series) {
                continue;
            }
            if let DataScope::Reduced {
                rule: ReductionRule::ExtremePerSignPerColumn,
                ..
            } = series.scope
            {
                return Err(SpecError::ReductionRuleUnsuitableForTrace);
            }
        }
        if let Some(visible) = self.visible_domain {
            visible.validate()?;
            if visible.low() < self.full_domain.low() || visible.high() > self.full_domain.high() {
                return Err(SpecError::DomainInverted);
            }
        }
        // The displayed value window, held to the range the source covers.
        //
        // Contained rather than merely finite, because this window is what the
        // value axis is labelled with: a window reaching above every measured
        // value prints a top label no measurement comes near, and one reaching
        // below prints a floor the data never visits. Both are the axis telling
        // a reader about space the figure does not contain.
        //
        // Deliberately *not* checked against the series the way `value_domain`
        // is. A source point outside this window is the normal case and the
        // whole reason the field exists: a peak at another retention time is
        // still in the document, and comes back into view if the window widens.
        if let Some(window) = self.visible_value_domain {
            window.validate()?;
            if window.low() < self.value_domain.low() || window.high() > self.value_domain.high() {
                return Err(SpecError::VisibleValueDomainOutsideValueDomain);
            }
        }
        for series in &self.series {
            series.validate()?;
            let outside_x = series
                .x()
                .iter()
                .any(|value| *value < self.full_domain.low() || *value > self.full_domain.high());
            let outside_y = series
                .y()
                .iter()
                .any(|value| *value < self.value_domain.low() || *value > self.value_domain.high());
            if outside_x || outside_y {
                return Err(SpecError::PointOutsideDomain);
            }
        }
        for marker in &self.markers {
            marker.validate()?;
            // Outside the **full** domain, not outside the visible window. A
            // marker beyond the source is one the panel can never draw, at any
            // window, including a full-range export -- so it is an annotation
            // that silently does not exist, which is worse than one that is
            // refused. A marker inside the source but outside the current
            // window is the opposite case and stays valid: it is exactly what
            // reappears when the window widens.
            if marker.at < self.full_domain.low() || marker.at > self.full_domain.high() {
                return Err(SpecError::MarkerOutsideFullDomain);
            }
        }
        Ok(())
    }

    /// Narrows the panel to a visible sub-range.
    ///
    /// # Errors
    ///
    /// Refuses a range reaching outside the full domain: a visible window the
    /// source does not cover would ask a renderer to draw where nothing was
    /// measured.
    pub fn with_visible_domain(mut self, visible: Domain) -> Result<Self, SpecError> {
        self.visible_domain = Some(visible);
        self.validate()?;
        Ok(self)
    }

    /// Narrows the panel's value axis to the range actually shown.
    ///
    /// # Errors
    ///
    /// Refuses a window reaching outside [`Self::value_domain`], which would
    /// label the axis with values the source does not contain.
    pub fn with_visible_value_domain(mut self, window: Domain) -> Result<Self, SpecError> {
        self.visible_value_domain = Some(window);
        self.validate()?;
        Ok(self)
    }

    /// Attaches markers to the panel.
    ///
    /// # Errors
    ///
    /// Refuses anything `validate` refuses. A second constructor that skipped
    /// the check is how a rule gets added in one place and bypassed in
    /// another -- the defect this whole boundary exists to prevent.
    pub fn with_markers(mut self, markers: Vec<Marker>) -> Result<Self, SpecError> {
        self.markers = markers;
        self.validate()?;
        Ok(self)
    }

    #[must_use]
    pub const fn kind(&self) -> PlotKind {
        self.kind
    }

    #[must_use]
    pub const fn x_axis(&self) -> &AxisSpec {
        &self.x_axis
    }

    #[must_use]
    pub const fn y_axis(&self) -> &AxisSpec {
        &self.y_axis
    }

    #[must_use]
    pub const fn full_domain(&self) -> Domain {
        self.full_domain
    }

    #[must_use]
    pub const fn visible_domain(&self) -> Option<Domain> {
        self.visible_domain
    }

    #[must_use]
    pub const fn value_domain(&self) -> Domain {
        self.value_domain
    }

    #[must_use]
    pub const fn visible_value_domain(&self) -> Option<Domain> {
        self.visible_value_domain
    }

    /// The value range a renderer projects onto: the window when there is one.
    ///
    /// The counterpart of [`Self::drawn_domain`], and stated here for the same
    /// reason -- the projection, the axis labels and the sentences describing
    /// the drawing all have to agree about which range reached the page.
    #[must_use]
    pub fn displayed_value_domain(&self) -> Domain {
        self.visible_value_domain.unwrap_or(self.value_domain)
    }

    #[must_use]
    pub fn series(&self) -> &[SeriesSpec] {
        &self.series
    }

    #[must_use]
    pub fn markers(&self) -> &[Marker] {
        &self.markers
    }

    /// Whether this panel joins that series into a line rather than drawing
    /// each of its points as its own mark.
    ///
    /// Panel kind decides it for a measurement. A **baseline** is joined
    /// whatever the panel draws: the contract calls it a reference line the
    /// data is read against, which is a model with a value everywhere between
    /// its samples rather than a set of measurements -- so joining it asserts
    /// nothing the series did not already claim, while drawing it as marks from
    /// zero would put a row of extra peaks into a spectrum.
    ///
    /// Stated here rather than in a renderer because the validation above needs
    /// the same answer: a rule that keeps one extreme per sign is refused for
    /// whatever will be joined, and a baseline being joined is exactly what
    /// made a panel-kind-only check miss one.
    #[must_use]
    pub fn joins(&self, series: &SeriesSpec) -> bool {
        self.kind.joins_a_trace() || series.role == StyleRole::Baseline
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
/// `Deserialize` is implemented rather than derived, as [`Domain`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct FigureSize {
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
struct WireFigureSize {
    width: f64,
    height: f64,
}

impl From<WireFigureSize> for FigureSize {
    fn from(wire: WireFigureSize) -> Self {
        Self {
            width: wire.width,
            height: wire.height,
        }
    }
}

impl<'de> Deserialize<'de> for FigureSize {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let size = Self::from(WireFigureSize::deserialize(deserializer)?);
        size.validate().map_err(serde::de::Error::custom)?;
        Ok(size)
    }
}

impl FigureSize {
    /// Accepts one size, or says why it is not one.
    ///
    /// # Errors
    ///
    /// Refuses a non-finite, non-positive or unbounded edge.
    pub fn new(width: f64, height: f64) -> Result<Self, SpecError> {
        let size = Self { width, height };
        size.validate()?;
        Ok(size)
    }

    fn validate(self) -> Result<(), SpecError> {
        let sane =
            |edge: f64, floor: f64| edge.is_finite() && edge >= floor && edge <= MAX_FIGURE_EDGE;
        // The height floor here is the one-panel case; a figure with more
        // panels is held to its own floor by `FigureSpec::validate`, which is
        // the only place the panel count is known.
        if !sane(self.width, MIN_FIGURE_WIDTH)
            || !sane(self.height, MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT)
        {
            return Err(SpecError::FigureSizeOutOfRange);
        }
        Ok(())
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
///
/// `Deserialize` is **implemented rather than derived** -- see the impl below.
/// A derived one would be a public door into this type that skips every rule
/// the constructors enforce.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FigureSpec {
    pub(crate) schema_version: u32,
    pub(crate) theme: FigureTheme,
    pub(crate) size: FigureSize,
    pub(crate) title: Option<Label>,
    pub(crate) caption: Option<Caption>,
    /// Ordered. One panel today; the order is in the contract because a second
    /// panel must not have to change the shape to be placed.
    pub(crate) panels: Vec<PanelSpec>,
}

impl FigureSpec {
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    #[must_use]
    pub const fn theme(&self) -> FigureTheme {
        self.theme
    }

    #[must_use]
    pub const fn size(&self) -> FigureSize {
        self.size
    }

    #[must_use]
    pub const fn title(&self) -> Option<&Label> {
        self.title.as_ref()
    }

    #[must_use]
    pub const fn caption(&self) -> Option<&Caption> {
        self.caption.as_ref()
    }

    #[must_use]
    pub fn panels(&self) -> &[PanelSpec] {
        &self.panels
    }

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
        let figure = Self {
            schema_version: SCHEMA_VERSION,
            theme,
            size,
            title: None,
            caption: None,
            panels,
        };
        figure.validate()?;
        Ok(figure)
    }

    /// Every rule this contract has, over a whole figure.
    ///
    /// # Errors
    ///
    /// Answers with the first rule the figure breaks.
    pub fn validate(&self) -> Result<(), SpecError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(SpecError::UnknownSchemaVersion);
        }
        self.size.validate()?;
        if let Some(title) = self.title.as_ref() {
            title.validate()?;
        }
        if let Some(caption) = self.caption.as_ref() {
            caption.validate()?;
        }
        if self.panels.is_empty() || self.panels.len() > MAX_PANELS {
            return Err(SpecError::PanelCountOutOfRange);
        }
        // Panels share the figure's height, so eight of them need eight times
        // the room one does. Without this a valid-looking figure could hand the
        // renderer a panel band with negative height and get a plot drawn
        // upside down.
        let needed = MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT * (self.panels.len() as f64);
        if self.size.height() < needed {
            return Err(SpecError::FigureTooSmallForPanels);
        }
        for panel in &self.panels {
            panel.validate()?;
        }
        Ok(())
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
        let decoded = Self::from(
            serde_json::from_str::<WireFigure>(document).map_err(|_| DecodeError::Malformed)?,
        );
        // Every rule, not only the version. `serde` builds these types field by
        // field and never calls a constructor, so a document could otherwise
        // carry mismatched arrays, an inverted domain or an empty label into a
        // renderer that has been told those cannot happen.
        //
        // Read from the unvalidated wire shape rather than through this type's
        // own `Deserialize`, which validates too -- so that a refusal here
        // arrives as the `SpecError` that caused it rather than as a decoder
        // message a caller would have to parse.
        decoded.validate().map_err(DecodeError::Spec)?;
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

/// The field-by-field shape `serde` builds, before any rule has been applied.
///
/// Private, and the only thing in this module that may hold an unchecked
/// figure. It exists so that decoding has one place where the values are
/// present but not yet trusted -- which is what both readers below need, and
/// what a derived `Deserialize` on the public type would have handed to
/// everyone instead.
#[derive(Deserialize)]
// A field this build does not know is a field the sender meant something
// by. Ignoring it turns a typo into a silent change of meaning -- a
// misspelled `visible_domain` decodes as "no window" and exports the whole
// source -- so the document is refused instead.
#[serde(deny_unknown_fields)]
struct WireFigure {
    schema_version: u32,
    theme: FigureTheme,
    size: WireFigureSize,
    title: Option<Label>,
    caption: Option<Caption>,
    panels: Vec<WirePanel>,
}

impl From<WireFigure> for FigureSpec {
    fn from(wire: WireFigure) -> Self {
        Self {
            schema_version: wire.schema_version,
            theme: wire.theme,
            size: wire.size.into(),
            title: wire.title,
            caption: wire.caption,
            panels: wire.panels.into_iter().map(Into::into).collect(),
        }
    }
}

/// Decoding a figure applies every rule a constructor would.
///
/// Implemented rather than derived, because a derived implementation is a
/// public entry point: `serde_json::from_str::<FigureSpec>` would build the
/// type field by field, skip every check, and hand the result to a renderer
/// that has been told those states cannot occur. Sealing the fields closed the
/// mutation route; this closes the construction route beside it.
///
/// [`FigureSpec::from_json`] reads the wire shape directly instead of going
/// through here, so that its refusals keep their `SpecError`.
impl<'de> Deserialize<'de> for FigureSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let figure = Self::from(WireFigure::deserialize(deserializer)?);
        figure.validate().map_err(serde::de::Error::custom)?;
        Ok(figure)
    }
}

/// Why a document could not be read as a figure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    /// The text was not this shape, or held a value refused as it was read.
    ///
    /// The second half is the newtypes: a `Label` and a `Caption` check
    /// themselves while decoding, so an empty or non-printable one never
    /// becomes a label at all. [`Self::Spec`] is what this boundary answers
    /// when every part was readable and the parts disagree with one another.
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
