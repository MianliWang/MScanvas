//! What a chromatogram export is made of, and the range it is made over.
//!
//! ## Where the science comes from
//!
//! The complete per-scan facts this session already retained for the loaded
//! mzML preview, and nothing else. Not the rows the webview received -- those
//! are bounded by a transfer limit -- not the screen's reduced polyline, not the
//! vertices of an SVG path, and not a coordinate that has been through a
//! browser. Those are drawings of the science; this module writes the science.
//!
//! Nothing here rereads the file and nothing here launches a backend process.
//! The facts were read once, when the preview was opened, and an export is a
//! second reader of the same allocation.
//!
//! ## What a chromatogram is here
//!
//! Two quantities the instrument reported for every scan -- the total ion
//! current and the base peak intensity -- against the retention time of that
//! scan. It is a **projection of the spectrum table**, not a stored
//! chromatogram record, and every document this module writes says so in those
//! words. No `PreviewOperation::Tic` is issued, because none exists.
//!
//! ## The range
//!
//! Two scopes, and they differ in one place only: which retention times the
//! data document keeps, and which window the figure declares. The source series
//! in the figure is complete either way, because a figure that dropped its
//! out-of-window points would be a picture of a screen rather than a document.
//!
//! ## Where the figure and the data deliberately disagree
//!
//! A figure draws the segment that crosses a window edge, interpolating the
//! value at the boundary, because that is the line the source asserts between
//! its own neighbouring samples. A data document contains **scans**, and a
//! boundary crossing is not one -- so a window holding no scans is a figure with
//! a line through it and a table with no rows, and both are correct.

use std::sync::Arc;

use mscanvas_plot_spec::spec::{
    AxisSpec, Caption, DataScope, Domain, FigureSpec, Label, PanelSpec, PlotKind, SeriesSpec,
    SpecError, StyleRole, UnitState,
};

use super::dialog::SaveDialogFacts;
use super::figure::FigureRenderSettings;
use super::service::TableRowFacts;

/// What the data document calls itself.
pub(super) const CHROMATOGRAM_DATA_FORMAT_ID: &str = "mscanvas_chromatogram_export";

/// The version of that document's schema.
pub(super) const CHROMATOGRAM_DATA_SCHEMA_VERSION: u32 = 1;

/// The value every unreported state is written as.
const UNREPORTED: &str = "unreported";

/// What the data document says its numbers were projected from.
///
/// A fixed word rather than a sentence, because it is a field a reader may
/// match on. The sentence is in the figure's caption, where prose belongs.
const SOURCE_DESCRIPTION: &str = "per_scan_spectrum_table";

/// The order the records are written in, named in the document itself.
const ROW_ORDER: &str = "retention_time_then_table_position";

/// Which document one chromatogram export writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChromatogramExportFormat {
    Svg,
    Png,
    Csv,
    Tsv,
}

impl ChromatogramExportFormat {
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
            Self::Csv => "csv",
            Self::Tsv => "tsv",
        }
    }

    /// Whether this format is drawn rather than written.
    ///
    /// The figure formats are the ones the size, theme and resolution settings
    /// apply to, and the ones the visible trace set applies to. A data document
    /// is neither: it carries both measured columns whatever is on screen.
    pub(super) const fn is_figure(self) -> bool {
        matches!(self, Self::Svg | Self::Png)
    }

    pub(super) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "svg" => Some(Self::Svg),
            "png" => Some(Self::Png),
            "csv" => Some(Self::Csv),
            "tsv" => Some(Self::Tsv),
            _ => None,
        }
    }

    /// How this format's save dialog presents itself.
    pub(super) const fn dialog(self) -> SaveDialogFacts {
        match self {
            Self::Svg => SaveDialogFacts {
                title: "Export chromatogram figure",
                filter_label: "SVG figure (*.svg)",
                filter_pattern: "*.svg",
                default_extension: "svg",
            },
            Self::Png => SaveDialogFacts {
                title: "Export chromatogram figure",
                filter_label: "PNG image (*.png)",
                filter_pattern: "*.png",
                default_extension: "png",
            },
            Self::Csv => SaveDialogFacts {
                title: "Export chromatogram data",
                filter_label: "Comma-separated values (*.csv)",
                filter_pattern: "*.csv",
                default_extension: "csv",
            },
            Self::Tsv => SaveDialogFacts {
                title: "Export chromatogram data",
                filter_label: "Tab-separated values (*.tsv)",
                filter_pattern: "*.tsv",
                default_extension: "tsv",
            },
        }
    }

    /// What separates two fields of a data document.
    const fn delimiter(self) -> Option<char> {
        match self {
            Self::Svg | Self::Png => None,
            Self::Csv => Some(','),
            Self::Tsv => Some('\t'),
        }
    }

    /// The name the save dialog offers first.
    ///
    /// Built from the format and the scope, and from nothing else. No part of
    /// the source path, the workspace handle or the dataset's display name
    /// reaches a file name this boundary proposes -- and neither does the scan
    /// count, which would make two exports of the same run collide or not
    /// depending on a number the user did not choose.
    pub(super) fn suggested_file_name(self, scope: RangeScope) -> String {
        format!(
            "mscanvas-chromatogram-{}.{}",
            scope.stable_id(),
            self.stable_id()
        )
    }
}

/// How much of the run an export covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RangeScope {
    /// Every scan the preview holds.
    Full,
    /// The retention-time range the viewer has committed to.
    Current,
}

impl RangeScope {
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Current => "current",
        }
    }

    fn from_wire(value: &str) -> Option<Self> {
        match value {
            "full" => Some(Self::Full),
            "current" => Some(Self::Current),
            _ => None,
        }
    }
}

/// What the webview asked for, before this session has agreed to it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct RangeRequest {
    scope: RangeScope,
    /// The committed viewport, for a current-range request that has one.
    ///
    /// `None` is not a missing answer. It is the viewer saying it has committed
    /// no narrower range, which means the current range *is* the whole run --
    /// a real state, and one this module resolves rather than embellishes.
    domain: Option<Domain>,
}

impl RangeRequest {
    /// Reads one range request, refusing anything that is not one.
    ///
    /// A domain arrives as two numbers and becomes a `Domain` here, which is
    /// what refuses a non-finite or backwards pair. Whether it is a range this
    /// *source* has is a different question, answered at
    /// [`ChromatogramSource::resolve`] where the source is known.
    pub(super) fn from_wire(scope: &str, low: Option<f64>, high: Option<f64>) -> Option<Self> {
        let scope = RangeScope::from_wire(scope)?;
        let domain = match (scope, low, high) {
            // A full-run export needs no range and is not given one. Sending a
            // window with it is a contradiction rather than extra information,
            // so it is refused instead of ignored -- ignoring it would export
            // something other than what the caller described.
            (RangeScope::Full, None, None) => None,
            (RangeScope::Full, _, _) => return None,
            (RangeScope::Current, None, None) => None,
            (RangeScope::Current, Some(low), Some(high)) => Some(Domain::new(low, high).ok()?),
            (RangeScope::Current, _, _) => return None,
        };
        Some(Self { scope, domain })
    }
}

/// The range one export was actually taken over.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct ResolvedRange {
    /// What the caller asked for, kept even where it resolved to the whole run.
    ///
    /// A current-range export of a viewer that has committed nothing writes the
    /// same rows a full-run export would, and it is still a current-range
    /// export: that is what the user chose, and the document says so.
    scope: RangeScope,
    domain: Domain,
    /// Whether this range is the whole run, however it was asked for.
    covers_everything: bool,
}

impl ResolvedRange {
    pub(super) const fn scope(self) -> RangeScope {
        self.scope
    }

    pub(super) const fn domain(self) -> Domain {
        self.domain
    }

    pub(super) const fn covers_everything(self) -> bool {
        self.covers_everything
    }
}

/// Why a range could not be exported over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RangeRefusal {
    /// The range reaches outside the run this session holds.
    OutsideSource,
}

/// Which measured traces a figure draws.
///
/// A figure shows what is on screen; a data document carries both columns
/// whatever this says. The distinction is deliberate: hiding a trace is a
/// presentation choice, and it is not a decision to delete measured science on
/// the way to a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TraceSet {
    tic: bool,
    bpc: bool,
}

impl TraceSet {
    pub(super) const fn from_wire(tic: bool, bpc: bool) -> Self {
        Self { tic, bpc }
    }

    /// Whether anything is drawn at all.
    ///
    /// A figure of no series is not a figure of nothing -- the contract refuses
    /// it, and rightly: a blank panel cannot be told from a renderer that
    /// failed. So a figure export with both traces hidden is refused, and the
    /// data export beside it stays available.
    pub(super) const fn any(self) -> bool {
        self.tic || self.bpc
    }

    pub(super) const fn tic(self) -> bool {
        self.tic
    }

    pub(super) const fn bpc(self) -> bool {
        self.bpc
    }

    /// How the figure's caption names what it drew.
    const fn describe(self) -> &'static str {
        match (self.tic, self.bpc) {
            (true, true) => "Total ion current and base peak intensity",
            (true, false) => "Total ion current",
            (false, true) => "Base peak intensity",
            (false, false) => "No trace",
        }
    }
}

/// Which measured quantity one series carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Trace {
    TotalIonCurrent,
    BasePeakIntensity,
}

impl Trace {
    /// The name the figure gives this series.
    ///
    /// Short, because it is drawn in a legend inside a plotting area, and
    /// stable, because it is the one field of the figure that says *which*
    /// measurement a line is.
    const fn id(self) -> &'static str {
        match self {
            Self::TotalIonCurrent => "TIC",
            Self::BasePeakIntensity => "BPC",
        }
    }

    /// The role this quantity has, whatever else is on screen.
    ///
    /// Base peak intensity does not become the primary measurement because the
    /// total ion current is hidden. A figure of one trace and a figure of two
    /// agree about what that trace is, which is what makes the role worth
    /// having.
    const fn role(self) -> StyleRole {
        match self {
            Self::TotalIonCurrent => StyleRole::Measurement,
            Self::BasePeakIntensity => StyleRole::SecondaryMeasurement,
        }
    }

    fn value(self, row: &TableRowFacts) -> f64 {
        match self {
            Self::TotalIonCurrent => row.total_ion_current(),
            Self::BasePeakIntensity => row.base_peak_intensity(),
        }
    }
}

/// The complete scientific facts one chromatogram export draws from.
///
/// Holds the retained rows by handle rather than by copy. A run of 36,319 scans
/// is a real acquisition and this boundary already refuses to copy scientific
/// tables around; an export takes a second handle to the same allocation, and
/// the preview may drop its own the moment a newer one is opened.
#[derive(Debug, Clone)]
pub(super) struct ChromatogramSource {
    rows: Arc<Vec<TableRowFacts>>,
    /// The order an export reads the rows in: retention time, then the row's
    /// own position in the table.
    ///
    /// A projection rather than a sort of the retained table. The table's order
    /// is the order the run reported, and other readers -- a selected spectrum
    /// reconciling against its row, a table position the user clicked -- depend
    /// on it. Computed once when the snapshot is installed rather than per
    /// export.
    order: Arc<Vec<usize>>,
    full_domain: Domain,
}

impl ChromatogramSource {
    /// Reads the retained rows as a chromatogram, or answers that they are not
    /// one.
    ///
    /// **The same eligibility the visible viewer applies, deliberately.** Rust
    /// retains every row the backend reported, while the webview receives at
    /// most a bounded prefix -- so a run whose table was truncated has no
    /// visible chromatogram, and issuing an export token for it would open a
    /// door onto a capability the product does not otherwise have. A truncated
    /// viewer has no chromatogram and no chromatogram export.
    ///
    /// The remaining refusals are the model's own, and are checked here for the
    /// same reason: a retention time that is not a number cannot be placed on
    /// an axis or written as a coordinate, and a unit this build cannot name
    /// cannot be honestly labelled in a figure or in a document header.
    pub(super) fn from_rows(rows: &Arc<Vec<TableRowFacts>>, truncated: bool) -> Option<Self> {
        if truncated || rows.is_empty() {
            return None;
        }
        for row in rows.iter() {
            if !row.retention_time().is_finite()
                || !row.total_ion_current().is_finite()
                || !row.base_peak_intensity().is_finite()
                || row.retention_time_unit_known()
            {
                return None;
            }
        }
        let mut order: Vec<usize> = (0..rows.len()).collect();
        // Equal retention times keep table order, which is what makes "which of
        // these two scans" answerable without depending on a sort's stability.
        order.sort_by(|left, right| {
            let (a, b) = (&rows[*left], &rows[*right]);
            a.retention_time()
                .partial_cmp(&b.retention_time())
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(left.cmp(right))
        });
        let low = rows[*order.first()?].retention_time();
        let high = rows[*order.last()?].retention_time();
        let full_domain = Domain::new(low, high).ok()?;
        Some(Self {
            rows: Arc::clone(rows),
            order: Arc::new(order),
            full_domain,
        })
    }

    pub(super) const fn full_domain(&self) -> Domain {
        self.full_domain
    }

    pub(super) fn scan_count(&self) -> usize {
        self.order.len()
    }

    /// Every scan, in the export's order.
    fn ordered(&self) -> impl Iterator<Item = &TableRowFacts> {
        self.order.iter().map(|position| &self.rows[*position])
    }

    /// The scans inside a range, edges included.
    ///
    /// Real scans only. A boundary crossing is geometry a figure draws between
    /// two samples; it is not a measurement, and a data document that carried
    /// one would be asserting a scan the instrument never acquired.
    fn within(&self, domain: Domain) -> impl Iterator<Item = &TableRowFacts> {
        self.ordered()
            .filter(move |row| row.retention_time() >= domain.low())
            .filter(move |row| row.retention_time() <= domain.high())
    }

    /// Agrees a requested range with what this run actually covers.
    ///
    /// # Errors
    ///
    /// Refuses a window reaching outside the run. Not clamped: a request for a
    /// range this source does not have is a request about something else, and
    /// quietly exporting the nearest range it does have would answer a question
    /// nobody asked.
    pub(super) fn resolve(&self, request: RangeRequest) -> Result<ResolvedRange, RangeRefusal> {
        let domain = match (request.scope, request.domain) {
            (RangeScope::Full, _) | (RangeScope::Current, None) => self.full_domain,
            (RangeScope::Current, Some(domain)) => {
                if domain.low() < self.full_domain.low() || domain.high() > self.full_domain.high()
                {
                    return Err(RangeRefusal::OutsideSource);
                }
                domain
            }
        };
        Ok(ResolvedRange {
            scope: request.scope,
            domain,
            covers_everything: domain.low() <= self.full_domain.low()
                && domain.high() >= self.full_domain.high(),
        })
    }
}

/// The document a chromatogram data export writes.
///
/// # Schema, version 1
///
/// A metadata preamble, then a header row, then one record per **source scan**
/// inside the exported range:
///
/// ```text
/// #format,mscanvas_chromatogram_export
/// #schema_version,1
/// #source,per_scan_spectrum_table
/// #range_scope,full
/// #source_scan_count,3
/// #row_count,3
/// #full_range_low,1
/// #full_range_high,3
/// #export_range_low,1
/// #export_range_high,3
/// #retention_time_unit,unreported
/// #intensity_unit,unreported
/// #row_order,retention_time_then_table_position
/// spectrum_index,scan_number,ms_level,retention_time,total_ion_current,base_peak_intensity
/// 0,1,1,1,123,42
/// 1,,2,2,456,120
/// ```
///
/// The preamble uses the same delimiter as the records, and every preamble line
/// begins with `#`, so a reader that wants only the table can skip them without
/// knowing what they say.
///
/// An empty `scan_number` field means the run reported no scan number for that
/// spectrum. It is left empty rather than filled with a sentinel, because every
/// number that could stand for "none" is also a scan number.
///
/// **Both measured columns are always present**, whatever the screen is
/// showing. Hiding a trace is a presentation choice about a plot; a data
/// document is the source facts, and dropping one because it was not on screen
/// would make the file a record of the view rather than of the run.
///
/// **A range holding no scans writes no records**, and that is a successful
/// export. The figure for the same range may still draw a line across it,
/// interpolated between samples outside either edge -- that line is geometry the
/// source asserts between its own points, and it is not a scan.
///
/// **No quoting rule exists, because no field can need one.** Every preamble key
/// is a fixed ASCII identifier, every preamble value is an integer, a finite
/// `f64` or one of this module's fixed words, and every record field is a number
/// or empty. A test asserts that over whole documents rather than trusting it.
///
/// Numbers are written with Rust's shortest round-tripping form: locale
/// independent, `.` as the decimal point, no thousands separator, and exactly
/// the `f64` the backend parsed comes back out of the file. Lines end with
/// `\n`, chosen rather than inherited from the host.
/// Answers the document and how many records it holds.
///
/// The count is returned rather than read back out of the bytes. A writer that
/// parsed its own output to say what it wrote would be one parser away from
/// reporting something the file does not contain, and the two are supposed to
/// be one fact stated once.
pub(super) fn data_document(
    source: &ChromatogramSource,
    resolved: ResolvedRange,
    format: ChromatogramExportFormat,
) -> Option<(String, usize)> {
    let delimiter = format.delimiter()?;
    let rows: Vec<&TableRowFacts> = source.within(resolved.domain()).collect();
    let row_count = rows.len();

    let mut document = String::with_capacity(256 + rows.len() * 48);
    for (key, value) in [
        ("format", CHROMATOGRAM_DATA_FORMAT_ID.to_owned()),
        (
            "schema_version",
            CHROMATOGRAM_DATA_SCHEMA_VERSION.to_string(),
        ),
        ("source", SOURCE_DESCRIPTION.to_owned()),
        ("range_scope", resolved.scope().stable_id().to_owned()),
        ("source_scan_count", source.scan_count().to_string()),
        ("row_count", rows.len().to_string()),
        ("full_range_low", source.full_domain().low().to_string()),
        ("full_range_high", source.full_domain().high().to_string()),
        ("export_range_low", resolved.domain().low().to_string()),
        ("export_range_high", resolved.domain().high().to_string()),
        ("retention_time_unit", UNREPORTED.to_owned()),
        ("intensity_unit", UNREPORTED.to_owned()),
        ("row_order", ROW_ORDER.to_owned()),
    ] {
        document.push('#');
        document.push_str(key);
        document.push(delimiter);
        document.push_str(&value);
        document.push('\n');
    }
    for (index, column) in [
        "spectrum_index",
        "scan_number",
        "ms_level",
        "retention_time",
        "total_ion_current",
        "base_peak_intensity",
    ]
    .iter()
    .enumerate()
    {
        if index > 0 {
            document.push(delimiter);
        }
        document.push_str(column);
    }
    document.push('\n');

    for row in rows {
        document.push_str(&row.identity().index().to_string());
        document.push(delimiter);
        if let Some(scan_number) = row.identity().scan_number() {
            document.push_str(&scan_number.to_string());
        }
        document.push(delimiter);
        document.push_str(&row.ms_level().to_string());
        document.push(delimiter);
        document.push_str(&row.retention_time().to_string());
        document.push(delimiter);
        document.push_str(&row.total_ion_current().to_string());
        document.push(delimiter);
        document.push_str(&row.base_peak_intensity().to_string());
        document.push('\n');
    }
    Some((document, row_count))
}

/// The value range a window actually displays, from the geometry inside it.
///
/// The screen's rule, reached independently. Zero is always in it, because an
/// axis starting at the smallest value present makes a flat trace look like
/// structure. What decides the rest is the **clipped** trace: a scan outside the
/// window cannot set the range, while the interpolated height where a segment
/// crosses the edge can, because that height is on the page.
///
/// This is the whole reason `PanelSpec` carries a visible value domain. The
/// series in the figure is the complete source, so a nine-million peak at
/// another retention time is in the document and would otherwise decide the
/// scale of a window that does not contain it -- flattening everything the
/// reader asked to see onto the baseline.
fn visible_value_extent(
    source: &ChromatogramSource,
    domain: Domain,
    traces: TraceSet,
) -> (f64, f64) {
    let (mut low, mut high) = (0.0_f64, 0.0_f64);
    let mut consider = |value: f64| {
        low = low.min(value);
        high = high.max(value);
    };
    for trace in active_traces(traces) {
        let mut previous: Option<(f64, f64)> = None;
        for row in source.ordered() {
            let point = (row.retention_time(), trace.value(row));
            if point.0 >= domain.low() && point.0 <= domain.high() {
                consider(point.1);
            }
            if let Some(before) = previous {
                // The two edges, each interpolated along the segment that
                // straddles it. A segment can straddle both, which is exactly
                // the window with no sample inside it -- and then these two
                // heights are the only geometry there is.
                for edge in [domain.low(), domain.high()] {
                    if (before.0 < edge && point.0 > edge) || (before.0 > edge && point.0 < edge) {
                        let span = point.0 - before.0;
                        if span != 0.0 {
                            consider(before.1 + (point.1 - before.1) * ((edge - before.0) / span));
                        }
                    }
                }
            }
            previous = Some(point);
        }
    }
    (low, high)
}

/// The traces a figure draws, in the order they are declared.
fn active_traces(traces: TraceSet) -> Vec<Trace> {
    let mut active = Vec::with_capacity(2);
    if traces.tic() {
        active.push(Trace::TotalIonCurrent);
    }
    if traces.bpc() {
        active.push(Trace::BasePeakIntensity);
    }
    active
}

/// Builds the figure one chromatogram exports as.
///
/// Every active series carries the **complete source**, at
/// `DataScope::FullSource`, whatever range was asked for. A current-range figure
/// declares its window instead of dropping the points outside it: the renderer
/// clips and interpolates the crossing, and the document a reader receives still
/// contains the run.
///
/// # Errors
///
/// Answers with the contract's own refusal. A figure of no series is one of
/// them, and is what a request with both traces hidden becomes.
pub(super) fn figure_spec(
    source: &ChromatogramSource,
    resolved: ResolvedRange,
    traces: TraceSet,
    settings: FigureRenderSettings,
) -> Result<FigureSpec, SpecError> {
    let retention_times: Vec<f64> = source
        .ordered()
        .map(TableRowFacts::retention_time)
        .collect();
    let mut series = Vec::with_capacity(2);
    let (mut value_low, mut value_high) = (0.0_f64, 0.0_f64);
    for trace in active_traces(traces) {
        let values: Vec<f64> = source.ordered().map(|row| trace.value(row)).collect();
        for value in &values {
            value_low = value_low.min(*value);
            value_high = value_high.max(*value);
        }
        series.push(SeriesSpec::new(
            Label::new(trace.id())?,
            trace.role(),
            DataScope::FullSource,
            retention_times.clone(),
            values,
        )?);
    }

    let mut panel = PanelSpec::new(
        PlotKind::Chromatogram,
        // Neither axis carries a unit, because nothing that crossed the backend
        // boundary established one. A figure labelled "minutes" would state
        // something the file did not.
        AxisSpec::new(Label::new("Retention time")?, UnitState::Unreported),
        AxisSpec::new(Label::new("Intensity")?, UnitState::Unreported),
        source.full_domain(),
        Domain::new(value_low, value_high)?,
        series,
    )?;

    // A window only where there is one. A current-range export of a viewer that
    // committed nothing is the whole run, and declaring that as a window would
    // be a narrowing the figure does not have.
    if !resolved.covers_everything() {
        panel = panel.with_visible_domain(resolved.domain())?;
        let (low, high) = visible_value_extent(source, resolved.domain(), traces);
        panel = panel.with_visible_value_domain(Domain::new(low, high)?)?;
    }

    let scope = match resolved.scope() {
        RangeScope::Full => "the full run".to_owned(),
        RangeScope::Current => format!(
            "the range {} to {}",
            resolved.domain().low(),
            resolved.domain().high()
        ),
    };
    Ok(
        FigureSpec::new(settings.theme(), settings.size(), vec![panel])?
            .with_title(Label::new("Chromatogram")?)
            .with_caption(Caption::new(format!(
                "{} over {scope}, from {} scans. Per-scan values projected from the loaded \
                 spectrum table, not a stored chromatogram record. Retention time and intensity \
                 units {UNREPORTED}.",
                traces.describe(),
                source.scan_count(),
            ))?),
    )
}

/// Renders one chromatogram as the SVG document a user receives.
///
/// # Errors
///
/// Answers with the contract's refusal where the chromatogram cannot be
/// specified as a figure.
pub(super) fn svg_document(
    source: &ChromatogramSource,
    resolved: ResolvedRange,
    traces: TraceSet,
    settings: FigureRenderSettings,
) -> Result<String, SpecError> {
    Ok(mscanvas_plot_spec::svg::render(&figure_spec(
        source, resolved, traces, settings,
    )?))
}
