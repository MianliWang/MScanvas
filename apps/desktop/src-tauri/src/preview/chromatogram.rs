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
    AxisSpec, Caption, DataScope, Domain, FigureSpec, Label, Marker, PanelSpec, PlotKind,
    SeriesSpec, SpecError, StyleRole, UnitState,
};

use mscanvas_proteowizard::SelectedSpectrumResult;

use super::dialog::SaveDialogFacts;
use super::export::spectrum_panel;
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

/// What a linked two-panel figure can be written as.
///
/// Drawings only. A linked figure is a statement about where one scan sits in a
/// run, and there is no honest table of that: a combined CSV would have to
/// either interleave two different measurements or pick one and drop the link.
/// So the linked surface offers no data document, and the two single-source
/// exports keep theirs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LinkedFigureFormat {
    Svg,
    Png,
}

impl LinkedFigureFormat {
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
        }
    }

    pub(super) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "svg" => Some(Self::Svg),
            "png" => Some(Self::Png),
            _ => None,
        }
    }

    /// How this format's save dialog presents itself.
    pub(super) const fn dialog(self) -> SaveDialogFacts {
        match self {
            Self::Svg => SaveDialogFacts {
                title: "Export linked figure",
                filter_label: "SVG figure (*.svg)",
                filter_pattern: "*.svg",
                default_extension: "svg",
            },
            Self::Png => SaveDialogFacts {
                title: "Export linked figure",
                filter_label: "PNG image (*.png)",
                filter_pattern: "*.png",
                default_extension: "png",
            },
        }
    }

    /// The name the save dialog offers first.
    ///
    /// The selected spectrum's index, the chromatogram's scope, and the format.
    /// The index is a scientific position in the run that the interface already
    /// shows; no part of a path, a workspace handle or a dataset display name
    /// reaches a name this boundary proposes.
    pub(super) fn suggested_file_name(self, index: u64, scope: RangeScope) -> String {
        format!(
            "mscanvas-linked-spectrum-{index}-{}.{}",
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

    /// The retained row this selected spectrum was read from, if it is one.
    ///
    /// **Same dataset is necessary and not sufficient.** Two snapshots can be
    /// owned by one dataset and still not describe the same moment -- a
    /// spectrum read before a reload, a table replaced underneath it -- so a
    /// linked figure has to establish that *this* spectrum is a scan of *this*
    /// retained table rather than of one that looked like it.
    ///
    /// The zero-based spectrum index is the table position, so the row is found
    /// in constant time and the answer does not depend on the scan count. Found
    /// is not enough either: the row's identity has to reconcile with the
    /// spectrum's, which is the same reconciliation the selected-spectrum
    /// loader already performs against the row it read. A disagreement answers
    /// `None` rather than choosing one of the two.
    ///
    /// Retention time is deliberately not a key here. Scans may share one, and
    /// a lookup by time could not say which of them was selected.
    pub(super) fn row_for_spectrum(
        &self,
        spectrum: &SelectedSpectrumResult,
    ) -> Option<&TableRowFacts> {
        let index = usize::try_from(spectrum.identity().index()).ok()?;
        let row = self.rows.get(index)?;
        row.identity().reconcile(spectrum.identity()).ok()?;
        Some(row)
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
    let panel = chromatogram_panel(source, resolved, traces)?;
    Ok(
        FigureSpec::new(settings.theme(), settings.size(), vec![panel])?
            .with_title(Label::new("Chromatogram")?)
            .with_caption(Caption::new(format!(
                "{} over {}, from {} scans. Per-scan values projected from the loaded \
                 spectrum table, not a stored chromatogram record. Retention time and intensity \
                 units {UNREPORTED}.",
                traces.describe(),
                scope_phrase(resolved),
                source.scan_count(),
            ))?),
    )
}

/// How a caption names the range a chromatogram was taken over.
///
/// Shared by the single-panel figure and the linked one, so the two cannot come
/// to describe the same range differently.
fn scope_phrase(resolved: ResolvedRange) -> String {
    match resolved.scope() {
        RangeScope::Full => "the full run".to_owned(),
        RangeScope::Current => format!(
            "the range {} to {}",
            resolved.domain().low(),
            resolved.domain().high()
        ),
    }
}

/// The chromatogram as one panel, with no figure around it.
///
/// Factored out so the linked two-panel figure draws the *same* chromatogram
/// the single-panel export does rather than a second implementation of it. Every
/// scientific decision -- the complete source series, the full value domain, the
/// window a current range declares, the trace roles -- lives here and has
/// exactly one home.
///
/// # Errors
///
/// Answers with the contract's own refusal. A panel of no series is one of
/// them, and is what a request with both traces hidden becomes.
pub(super) fn chromatogram_panel(
    source: &ChromatogramSource,
    resolved: ResolvedRange,
    traces: TraceSet,
) -> Result<PanelSpec, SpecError> {
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

    Ok(panel)
}

/// What the linking marker is called in the figure it appears in.
const SELECTED_SCAN_LABEL: &str = "Selected scan";

/// Builds the linked two-panel figure: a chromatogram above the scan it names.
///
/// Two ordered panels and nothing else. The top is the chromatogram this
/// session would export on its own, over whichever range was asked for, with one
/// marker added *after* its ordinary scientific semantics are built -- so the
/// link is an annotation on the science rather than a change to it. The bottom
/// is the complete selected spectrum, exactly as its own export writes it: never
/// clipped to the chromatogram's range, because the range is a statement about
/// where the scan sits in the run and not about which of its peaks are real.
///
/// The marker's position is `row.retention_time()` -- the retained table row's
/// own number. Nothing here accepts a retention time from the webview or infers
/// one from a coordinate: a marker drawn at a time the source does not have
/// would be the figure claiming a scan was acquired when it was not.
///
/// # Errors
///
/// Answers with the contract's own refusal, including a figure too short for
/// two panels and a chromatogram panel with no visible trace.
pub(super) fn linked_figure_spec(
    source: &ChromatogramSource,
    spectrum: &SelectedSpectrumResult,
    row: &TableRowFacts,
    resolved: ResolvedRange,
    traces: TraceSet,
    settings: FigureRenderSettings,
) -> Result<FigureSpec, SpecError> {
    let marker = Marker::new(row.retention_time(), Some(Label::new(SELECTED_SCAN_LABEL)?))?;
    let top = chromatogram_panel(source, resolved, traces)?.with_markers(vec![marker])?;
    let bottom = spectrum_panel(spectrum)?;

    // Order is the meaning. The renderer places panels in the sequence it is
    // given, top to bottom, and the caption below says which is which -- so a
    // figure whose panels were swapped would be a figure that lies about both.
    Ok(
        FigureSpec::new(settings.theme(), settings.size(), vec![top, bottom])?
            .with_title(Label::new("Selected spectrum in chromatographic context")?)
            .with_caption(Caption::new(format!(
                "Two panels. Above, {} over {}, from {} scans -- per-scan values projected from \
                 the loaded spectrum table, not a stored chromatogram record. The marker there \
                 identifies spectrum index {}, shown below in full: the complete selected \
                 spectrum, {} points, never narrowed to the chromatogram range. Retention time, \
                 m/z and intensity units {UNREPORTED}.",
                traces.describe(),
                scope_phrase(resolved),
                source.scan_count(),
                spectrum.identity().index(),
                spectrum.mz_values().len(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use mscanvas_plot_spec::spec::{DataScope, FigureTheme};

    /// One run, from the four facts an export reads.
    fn run(rows: &[(u64, Option<u64>, f64, f64, f64)]) -> Arc<Vec<TableRowFacts>> {
        Arc::new(
            rows.iter()
                .map(|(index, scan_number, retention_time, tic, bpc)| {
                    TableRowFacts::for_test(
                        *index,
                        *scan_number,
                        1,
                        *retention_time,
                        false,
                        *tic,
                        *bpc,
                    )
                })
                .collect(),
        )
    }

    fn source(rows: &Arc<Vec<TableRowFacts>>) -> ChromatogramSource {
        ChromatogramSource::from_rows(rows, false).expect("an exportable run")
    }

    fn ordinary() -> ChromatogramSource {
        source(&run(&[
            (0, Some(1), 1.0, 100.0, 40.0),
            (1, Some(2), 2.0, 300.0, 120.0),
            (2, Some(3), 3.0, 200.0, 90.0),
        ]))
    }

    fn full(source: &ChromatogramSource) -> ResolvedRange {
        source
            .resolve(RangeRequest::from_wire("full", None, None).expect("a full request"))
            .expect("the whole run is always inside itself")
    }

    fn current(source: &ChromatogramSource, low: f64, high: f64) -> ResolvedRange {
        source
            .resolve(RangeRequest::from_wire("current", Some(low), Some(high)).expect("a request"))
            .expect("a range inside the run")
    }

    fn settings() -> FigureRenderSettings {
        FigureRenderSettings::default()
    }

    fn both() -> TraceSet {
        TraceSet::from_wire(true, true)
    }

    /// The records of one data document, without its preamble or header.
    fn records(document: &str) -> Vec<&str> {
        document
            .lines()
            .skip_while(|line| line.starts_with('#'))
            .skip(1)
            .collect()
    }

    /// One preamble value, by key.
    fn preamble<'a>(document: &'a str, key: &str, delimiter: char) -> &'a str {
        document
            .lines()
            .find_map(|line| line.strip_prefix(&format!("#{key}{delimiter}")))
            .unwrap_or_else(|| panic!("the preamble carries {key}"))
    }

    // ------------------------------------------------------ what is exportable

    /// A run the viewer would not draw is a run this export does not have.
    ///
    /// Rust retains every row the backend reported while the webview receives a
    /// bounded prefix, so "Rust happens to hold more" is exactly the door this
    /// refusal closes: a truncated table has no chromatogram on screen and must
    /// have none in a file either.
    #[test]
    fn a_truncated_table_is_not_exportable() {
        let rows = run(&[(0, Some(1), 1.0, 100.0, 40.0)]);

        assert!(ChromatogramSource::from_rows(&rows, true).is_none());
        assert!(ChromatogramSource::from_rows(&rows, false).is_some());
    }

    /// The model's own refusals, reached from the same facts.
    #[test]
    fn a_run_the_model_refuses_is_not_exportable() {
        assert!(ChromatogramSource::from_rows(&run(&[]), false).is_none());
        assert!(
            ChromatogramSource::from_rows(&run(&[(0, Some(1), f64::NAN, 100.0, 40.0)]), false)
                .is_none(),
            "a retention time that is not a number cannot be placed on an axis"
        );
        assert!(
            ChromatogramSource::from_rows(&run(&[(0, Some(1), 1.0, f64::INFINITY, 40.0)]), false)
                .is_none()
        );
        assert!(
            ChromatogramSource::from_rows(
                &run(&[(0, Some(1), 1.0, 100.0, f64::NEG_INFINITY)]),
                false
            )
            .is_none()
        );
        // A unit this build cannot name cannot be honestly labelled, in a figure
        // or in a document header.
        let claimed = Arc::new(vec![TableRowFacts::for_test(
            0,
            Some(1),
            1,
            1.0,
            true,
            100.0,
            40.0,
        )]);
        assert!(ChromatogramSource::from_rows(&claimed, false).is_none());
    }

    /// The export's order is the screen's: retention time, then table position.
    #[test]
    fn scans_are_exported_in_retention_time_then_table_order() {
        let rows = run(&[
            (0, Some(1), 3.0, 30.0, 3.0),
            (1, Some(2), 1.0, 10.0, 1.0),
            // Two scans at one retention time. Table order decides, and it is
            // decided rather than left to a sort's stability.
            (2, Some(3), 2.0, 20.0, 2.0),
            (3, Some(4), 2.0, 21.0, 2.1),
        ]);
        let source = source(&rows);
        let document = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a data document")
            .0;

        let indices: Vec<&str> = records(&document)
            .iter()
            .map(|line| line.split(',').next().expect("a first field"))
            .collect();
        assert_eq!(indices, ["1", "2", "3", "0"]);
        // And the retained table is untouched: other readers depend on its own
        // order, and an export is a projection rather than a sort.
        assert_eq!(rows[0].retention_time(), 3.0);
    }

    // ------------------------------------------------------------- the range

    #[test]
    fn a_full_run_needs_no_range_from_the_caller() {
        let source = ordinary();
        let resolved = full(&source);

        assert_eq!(resolved.scope(), RangeScope::Full);
        assert_eq!(resolved.domain(), source.full_domain());
        assert!(resolved.covers_everything());
        // A full request carrying a window is a contradiction rather than extra
        // information.
        assert!(RangeRequest::from_wire("full", Some(1.0), Some(2.0)).is_none());
    }

    /// A viewer that committed nothing has no narrower range, and says so.
    #[test]
    fn a_current_range_with_no_committed_window_is_the_whole_run() {
        let source = ordinary();
        let resolved = source
            .resolve(RangeRequest::from_wire("current", None, None).expect("a request"))
            .expect("the whole run");

        // The scope the user chose survives into the document, even though the
        // rows are the same ones a full export would write.
        assert_eq!(resolved.scope(), RangeScope::Current);
        assert_eq!(resolved.domain(), source.full_domain());
        assert!(resolved.covers_everything());
    }

    /// A range this run does not have is refused rather than clamped.
    #[test]
    fn a_range_outside_the_run_is_refused() {
        let source = ordinary();

        for (low, high) in [(0.5, 2.0), (2.0, 3.5), (-10.0, 10.0)] {
            let request = RangeRequest::from_wire("current", Some(low), Some(high))
                .expect("a well-formed request");
            assert_eq!(
                source.resolve(request),
                Err(RangeRefusal::OutsideSource),
                "{low} to {high}"
            );
        }
        // And a pair that is not an interval never becomes a request at all.
        assert!(RangeRequest::from_wire("current", Some(3.0), Some(1.0)).is_none());
        assert!(RangeRequest::from_wire("current", Some(f64::NAN), Some(2.0)).is_none());
        assert!(RangeRequest::from_wire("current", Some(1.0), None).is_none());
        assert!(RangeRequest::from_wire("sideways", None, None).is_none());
    }

    /// A range of no width is a range.
    #[test]
    fn a_zero_width_range_is_accepted() {
        let source = ordinary();
        let resolved = current(&source, 2.0, 2.0);

        assert_eq!(resolved.domain().low(), resolved.domain().high());
        let document = data_document(&source, resolved, ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;
        assert_eq!(records(&document).len(), 1, "the scan at exactly 2.0");
    }

    // -------------------------------------------------------- the data document

    #[test]
    fn the_data_document_states_what_it_is() {
        let source = ordinary();
        let (document, rows) = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document");

        assert_eq!(rows, 3);
        assert_eq!(
            preamble(&document, "format", ','),
            CHROMATOGRAM_DATA_FORMAT_ID
        );
        assert_eq!(preamble(&document, "schema_version", ','), "1");
        assert_eq!(preamble(&document, "source", ','), SOURCE_DESCRIPTION);
        assert_eq!(preamble(&document, "range_scope", ','), "full");
        assert_eq!(preamble(&document, "source_scan_count", ','), "3");
        assert_eq!(preamble(&document, "row_count", ','), "3");
        assert_eq!(preamble(&document, "full_range_low", ','), "1");
        assert_eq!(preamble(&document, "full_range_high", ','), "3");
        assert_eq!(preamble(&document, "export_range_low", ','), "1");
        assert_eq!(preamble(&document, "export_range_high", ','), "3");
        assert_eq!(preamble(&document, "retention_time_unit", ','), UNREPORTED);
        assert_eq!(preamble(&document, "intensity_unit", ','), UNREPORTED);
        assert_eq!(preamble(&document, "row_order", ','), ROW_ORDER);
        assert!(document.contains(
            "spectrum_index,scan_number,ms_level,retention_time,total_ion_current,\
             base_peak_intensity\n"
        ));
        assert_eq!(
            records(&document),
            ["0,1,1,1,100,40", "1,2,1,2,300,120", "2,3,1,3,200,90"]
        );
        assert!(document.ends_with('\n'));
    }

    /// The same document, with tabs.
    #[test]
    fn tsv_is_the_same_document_with_another_delimiter() {
        let source = ordinary();
        let csv = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;
        let tsv = data_document(&source, full(&source), ChromatogramExportFormat::Tsv)
            .expect("a document")
            .0;

        assert_eq!(tsv, csv.replace(',', "\t"));
        assert!(!tsv.contains(','));
    }

    /// A scan number the run did not report is empty rather than invented.
    #[test]
    fn an_unreported_scan_number_is_an_empty_field() {
        let rows = run(&[(0, None, 1.0, 100.0, 40.0)]);
        let source = source(&rows);
        let document = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;

        // Empty, because every number that could stand for "none" is also a
        // scan number.
        assert_eq!(records(&document), ["0,,1,1,100,40"]);
    }

    /// No field can need quoting, and that is asserted rather than trusted.
    #[test]
    fn no_field_needs_a_quoting_rule() {
        let source = source(&run(&[
            (0, Some(1), -0.0, -1.5e-320, 9_007_199_254_740_993.0),
            (1, None, 1.0, f64::MIN_POSITIVE, -0.0),
        ]));
        for format in [ChromatogramExportFormat::Csv, ChromatogramExportFormat::Tsv] {
            let delimiter = if matches!(format, ChromatogramExportFormat::Csv) {
                ','
            } else {
                '\t'
            };
            let document = data_document(&source, full(&source), format)
                .expect("a document")
                .0;
            for line in document.lines() {
                for field in line.split(delimiter) {
                    assert!(!field.contains('"'), "{field}");
                    assert!(!field.contains('\n'), "{field}");
                    assert!(!field.contains('\r'), "{field}");
                    let other = if delimiter == ',' { '\t' } else { ',' };
                    assert!(!field.contains(other), "{field}");
                }
            }
        }
    }

    /// The numbers come back out of the file exactly as they went in.
    #[test]
    fn numbers_round_trip_bit_for_bit() {
        let values = [
            -0.0_f64,
            f64::MIN_POSITIVE,
            -1.5e-320,
            9_007_199_254_740_993.0,
            1.7976931348623157e308,
            0.1 + 0.2,
        ];
        let rows: Vec<(u64, Option<u64>, f64, f64, f64)> = values
            .iter()
            .enumerate()
            .map(|(position, value)| {
                (
                    position as u64,
                    Some(position as u64),
                    position as f64,
                    *value,
                    *value,
                )
            })
            .collect();
        let source = source(&run(&rows));
        let document = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;

        for (line, expected) in records(&document).iter().zip(values.iter()) {
            let written: f64 = line
                .split(',')
                .nth(4)
                .expect("the total ion current field")
                .parse()
                .expect("a number this file wrote is a number");
            assert_eq!(
                written.to_bits(),
                expected.to_bits(),
                "{line} should carry {expected}"
            );
        }
        // Locale-independent, with no thousands separator anywhere.
        assert!(!document.contains(' '));
    }

    /// A current range contains scans, and only scans.
    #[test]
    fn a_current_range_carries_the_real_scans_inside_it() {
        let source = source(&run(&[
            (0, Some(1), 1.0, 10.0, 1.0),
            (1, Some(2), 2.0, 20.0, 2.0),
            (2, Some(3), 3.0, 30.0, 3.0),
            (3, Some(4), 4.0, 40.0, 4.0),
        ]));
        let (document, rows) = data_document(
            &source,
            current(&source, 2.0, 3.0),
            ChromatogramExportFormat::Csv,
        )
        .expect("a document");

        // Edges included, and nothing interpolated at either of them.
        assert_eq!(rows, 2);
        assert_eq!(records(&document), ["1,2,1,2,20,2", "2,3,1,3,30,3"]);
        assert_eq!(preamble(&document, "range_scope", ','), "current");
        assert_eq!(preamble(&document, "export_range_low", ','), "2");
        assert_eq!(preamble(&document, "export_range_high", ','), "3");
        // The run is still reported whole, so a reader can see how much of it
        // this file is.
        assert_eq!(preamble(&document, "source_scan_count", ','), "4");
    }

    /// A range with no scans in it is a successful export of no records.
    ///
    /// The distinction this milestone is really about. The figure for the same
    /// range draws the segment crossing it, interpolated between the samples
    /// outside either side -- and that line is geometry the source asserts
    /// between its own points. It is not a scan, and inventing a row for it
    /// would put a measurement in a file that the instrument never made.
    #[test]
    fn a_range_between_two_scans_carries_no_rows_and_is_not_a_failure() {
        let source = source(&run(&[
            (0, Some(1), 1.0, 10.0, 1.0),
            (1, Some(2), 9.0, 90.0, 9.0),
        ]));
        let resolved = current(&source, 4.0, 5.0);
        let (document, rows) =
            data_document(&source, resolved, ChromatogramExportFormat::Csv).expect("a document");

        assert_eq!(rows, 0);
        assert!(records(&document).is_empty());
        assert_eq!(preamble(&document, "row_count", ','), "0");
        // And the figure over that same range is a line.
        let figure = figure_spec(&source, resolved, both(), settings()).expect("a figure");
        let document = mscanvas_plot_spec::svg::render(&figure);
        assert!(
            document.contains("<path d=\"M"),
            "the crossing segment is drawn: {document}"
        );
    }

    /// Both measured columns, whatever the screen is showing.
    #[test]
    fn the_data_document_carries_both_traces() {
        let source = ordinary();
        // The builder takes no trace set at all, which is the strongest form of
        // this: there is nothing to pass that could remove a column.
        let document = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;

        assert!(document.contains("total_ion_current"));
        assert!(document.contains("base_peak_intensity"));
        for line in records(&document) {
            assert_eq!(line.split(',').count(), 6, "{line}");
        }
    }

    // ------------------------------------------------------------- the figure

    /// A figure carries the whole run, whatever range it declares.
    #[test]
    fn a_current_range_figure_still_carries_the_complete_source() {
        let source = source(&run(&[
            (0, Some(1), 9.0, 9_000_000.0, 10.0),
            (1, Some(2), 10.0, 90.0, 20.0),
            (2, Some(3), 11.0, 100.0, 30.0),
            (3, Some(4), 12.0, 110.0, 40.0),
            (4, Some(5), 13.0, 120.0, 50.0),
        ]));
        let figure = figure_spec(&source, current(&source, 10.0, 13.0), both(), settings())
            .expect("a figure");
        let panel = &figure.panels()[0];

        assert!(panel.is_full_source());
        for series in panel.series() {
            assert_eq!(series.scope(), DataScope::FullSource);
            assert_eq!(series.len(), 5, "every scan, including the ones outside");
        }
        assert_eq!(panel.full_domain().low(), 9.0);
        assert_eq!(panel.visible_domain().expect("a window").low(), 10.0);
    }

    /// A peak outside the window does not decide the window's value axis.
    ///
    /// The Viewer Closure y-extent finding, at the export layer. Nine million at
    /// retention time 9 is in the document -- it is part of the run -- and a
    /// figure of the range 10 to 13 that scaled to it would flatten everything
    /// the reader asked to see onto the baseline.
    #[test]
    fn an_out_of_window_peak_does_not_scale_a_current_range_figure() {
        let source = source(&run(&[
            (0, Some(1), 9.0, 9_000_000.0, 10.0),
            (1, Some(2), 10.0, 90.0, 20.0),
            (2, Some(3), 11.0, 100.0, 30.0),
            (3, Some(4), 12.0, 110.0, 40.0),
            (4, Some(5), 13.0, 120.0, 50.0),
        ]));
        let traces = TraceSet::from_wire(true, false);
        let figure = figure_spec(&source, current(&source, 10.0, 13.0), traces, settings())
            .expect("a figure");
        let panel = &figure.panels()[0];

        // The source range still says how far the run reaches.
        assert_eq!(panel.value_domain().high(), 9_000_000.0);
        // The drawing does not.
        let window = panel.visible_value_domain().expect("a value window");
        assert_eq!(window.low(), 0.0);
        assert!(
            (window.high() - 120.0).abs() < 1e-9,
            "the window ends at the tallest value in view, not at the peak: {window:?}"
        );

        // And nothing drawn mentions the peak.
        let document = mscanvas_plot_spec::svg::render(&figure);
        let drawn = document
            .split("</desc>")
            .nth(1)
            .expect("a document has a body");
        assert!(!drawn.contains("9000000"));
    }

    /// A boundary crossing does set the value axis, because it is on the page.
    #[test]
    fn an_interpolated_boundary_value_participates_in_the_value_window() {
        // The window cuts the segment from 1 to 3 at 2, where the trace is 200.
        let source = source(&run(&[
            (0, Some(1), 1.0, 100.0, 1.0),
            (1, Some(2), 3.0, 300.0, 3.0),
        ]));
        let traces = TraceSet::from_wire(true, false);
        let figure =
            figure_spec(&source, current(&source, 1.5, 2.0), traces, settings()).expect("a figure");
        let window = figure.panels()[0]
            .visible_value_domain()
            .expect("a value window");

        // No scan lies inside 1.5 to 2.0, so the only geometry is the two
        // interpolated crossings: 150 and 200.
        assert!(
            (window.high() - 200.0).abs() < 1e-9,
            "the right crossing sets the top: {window:?}"
        );
        assert_eq!(window.low(), 0.0);
    }

    /// A full-run figure declares no window at all.
    #[test]
    fn a_full_run_figure_declares_no_window() {
        let source = ordinary();
        let figure = figure_spec(&source, full(&source), both(), settings()).expect("a figure");
        let panel = &figure.panels()[0];

        assert_eq!(panel.visible_domain(), None);
        assert_eq!(panel.visible_value_domain(), None);
        assert_eq!(panel.displayed_value_domain(), panel.value_domain());
    }

    /// A current range that turns out to be the whole run declares none either.
    #[test]
    fn a_current_range_covering_everything_declares_no_window() {
        let source = ordinary();
        let resolved = source
            .resolve(RangeRequest::from_wire("current", None, None).expect("a request"))
            .expect("the whole run");
        let figure = figure_spec(&source, resolved, both(), settings()).expect("a figure");
        let panel = &figure.panels()[0];

        assert_eq!(panel.visible_domain(), None);
        assert_eq!(panel.visible_value_domain(), None);
    }

    /// The traces on screen decide what a figure draws, and what it is called.
    #[test]
    fn a_figure_draws_the_traces_that_are_visible() {
        let source = ordinary();
        let resolved = full(&source);

        let tic = figure_spec(
            &source,
            resolved,
            TraceSet::from_wire(true, false),
            settings(),
        )
        .expect("a figure");
        assert_eq!(tic.panels()[0].series().len(), 1);
        assert_eq!(tic.panels()[0].series()[0].id().as_str(), "TIC");
        assert_eq!(tic.panels()[0].series()[0].role(), StyleRole::Measurement);

        let bpc = figure_spec(
            &source,
            resolved,
            TraceSet::from_wire(false, true),
            settings(),
        )
        .expect("a figure");
        assert_eq!(bpc.panels()[0].series().len(), 1);
        assert_eq!(bpc.panels()[0].series()[0].id().as_str(), "BPC");
        // Its own role, not promoted because it is alone.
        assert_eq!(
            bpc.panels()[0].series()[0].role(),
            StyleRole::SecondaryMeasurement
        );

        let together = figure_spec(&source, resolved, both(), settings()).expect("a figure");
        assert_eq!(together.panels()[0].series().len(), 2);
    }

    /// A figure of no series is refused rather than drawn blank.
    #[test]
    fn a_figure_with_no_visible_trace_is_refused() {
        let source = ordinary();

        assert!(
            figure_spec(
                &source,
                full(&source),
                TraceSet::from_wire(false, false),
                settings()
            )
            .is_err()
        );
    }

    /// The figure says what it is and what it is not.
    #[test]
    fn the_figure_names_its_source_without_claiming_a_record() {
        let source = ordinary();
        let document = svg_document(&source, full(&source), both(), settings()).expect("a figure");

        // What it is, in the words the product uses everywhere else.
        assert!(document.contains("Per-scan values projected from the loaded spectrum table"));
        // And what it is not, said rather than left to be assumed: a reader
        // holding this file must not take it for a chromatogram the instrument
        // recorded.
        assert!(document.contains("not a stored chromatogram record"));
        assert!(document.contains("Retention time"));
        // Neither axis claims a unit.
        assert!(!document.contains("Retention time ("));
    }

    /// One scan is a run, and it draws.
    #[test]
    fn a_single_scan_run_exports() {
        let source = source(&run(&[(0, Some(1), 4.0, 9_000.0, 700.0)]));
        let resolved = full(&source);

        assert_eq!(source.full_domain().low(), source.full_domain().high());
        let (document, rows) =
            data_document(&source, resolved, ChromatogramExportFormat::Csv).expect("a document");
        assert_eq!(rows, 1);
        assert_eq!(records(&document), ["0,1,1,4,9000,700"]);

        let figure = svg_document(&source, resolved, both(), settings()).expect("a figure");
        assert!(figure.contains("<path d=\"M"), "a lone sample is drawn");
    }

    /// A run whose measurements are all zero still exports.
    #[test]
    fn an_all_zero_run_exports() {
        let source = source(&run(&[
            (0, Some(1), 1.0, 0.0, 0.0),
            (1, Some(2), 2.0, 0.0, 0.0),
        ]));

        let (document, rows) = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document");
        assert_eq!(rows, 2);
        assert_eq!(records(&document), ["0,1,1,1,0,0", "1,2,1,2,0,0"]);
        assert!(svg_document(&source, full(&source), both(), settings()).is_ok());
    }

    /// Negative intensity is preserved rather than clamped.
    #[test]
    fn negative_and_mixed_intensities_survive() {
        let source = source(&run(&[
            (0, Some(1), 1.0, -50.0, -5.0),
            (1, Some(2), 2.0, 100.0, 10.0),
        ]));
        let document = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;

        assert_eq!(records(&document), ["0,1,1,1,-50,-5", "1,2,1,2,100,10"]);
        let figure = figure_spec(&source, full(&source), both(), settings()).expect("a figure");
        assert_eq!(figure.panels()[0].value_domain().low(), -50.0);
    }

    /// The figure and the data describe the same resolved range.
    ///
    /// Neither is reconstructed from the other: the document's metadata comes
    /// from the range the export was bound to, and the panel's window comes from
    /// the same one. This is what makes them siblings rather than one being a
    /// reading of the other.
    #[test]
    fn the_figure_and_the_data_agree_about_the_range() {
        let source = source(&run(&[
            (0, Some(1), 1.0, 10.0, 1.0),
            (1, Some(2), 2.0, 20.0, 2.0),
            (2, Some(3), 3.0, 30.0, 3.0),
        ]));
        let resolved = current(&source, 1.5, 2.5);

        let document = data_document(&source, resolved, ChromatogramExportFormat::Csv)
            .expect("a document")
            .0;
        let window = figure_spec(&source, resolved, both(), settings())
            .expect("a figure")
            .panels()[0]
            .visible_domain()
            .expect("a window");

        assert_eq!(preamble(&document, "export_range_low", ','), "1.5");
        assert_eq!(preamble(&document, "export_range_high", ','), "2.5");
        assert_eq!(window.low(), 1.5);
        assert_eq!(window.high(), 2.5);
    }

    /// Both themes render, and neither is the other.
    #[test]
    fn a_chromatogram_renders_in_either_theme() {
        let source = ordinary();
        let mut documents = Vec::new();
        for theme in [FigureTheme::Light, FigureTheme::Dark] {
            let settings = FigureRenderSettings::from_wire(1_200, 640, theme_name(theme))
                .expect("accepted settings");
            documents
                .push(svg_document(&source, full(&source), both(), settings).expect("a figure"));
        }
        assert_ne!(documents[0], documents[1]);
    }

    fn theme_name(theme: FigureTheme) -> &'static str {
        match theme {
            FigureTheme::Light => "light",
            FigureTheme::Dark => "dark",
        }
    }

    /// A representative acquisition exports without copying the table.
    #[test]
    fn a_representative_run_exports_bounded_work() {
        let rows: Vec<(u64, Option<u64>, f64, f64, f64)> = (0..36_319_u64)
            .map(|index| {
                (
                    index,
                    Some(index + 1),
                    index as f64 * 0.0125,
                    10_000.0 + index as f64,
                    1_000.0 + index as f64,
                )
            })
            .collect();
        let retained = run(&rows);
        let before = Arc::strong_count(&retained);
        let source = source(&retained);

        // A handle, not a copy. The retained table is one allocation and the
        // export is a second reader of it.
        assert_eq!(Arc::strong_count(&retained), before + 1);
        assert_eq!(source.scan_count(), 36_319);

        let (_, written) = data_document(&source, full(&source), ChromatogramExportFormat::Csv)
            .expect("a document");
        assert_eq!(written, 36_319);
        // One pass for a narrow window, and the count is the scans inside it.
        let (_, inside) = data_document(
            &source,
            current(&source, 1.0, 2.0),
            ChromatogramExportFormat::Csv,
        )
        .expect("a document");
        assert_eq!(inside, 81);
    }

    /// The suggested name says the format and the scope, and nothing else.
    #[test]
    fn the_suggested_name_comes_from_the_request_alone() {
        assert_eq!(
            ChromatogramExportFormat::Csv.suggested_file_name(RangeScope::Full),
            "mscanvas-chromatogram-full.csv"
        );
        assert_eq!(
            ChromatogramExportFormat::Svg.suggested_file_name(RangeScope::Current),
            "mscanvas-chromatogram-current.svg"
        );
        assert_eq!(
            ChromatogramExportFormat::Png.suggested_file_name(RangeScope::Full),
            "mscanvas-chromatogram-full.png"
        );
        assert_eq!(
            ChromatogramExportFormat::Tsv.suggested_file_name(RangeScope::Current),
            "mscanvas-chromatogram-current.tsv"
        );
    }

    /// The dialogs say which surface they belong to.
    #[test]
    fn the_dialog_names_the_chromatogram() {
        assert_eq!(
            ChromatogramExportFormat::Svg.dialog().title,
            "Export chromatogram figure"
        );
        assert_eq!(
            ChromatogramExportFormat::Csv.dialog().title,
            "Export chromatogram data"
        );
        assert!(ChromatogramExportFormat::Png.is_figure());
        assert!(!ChromatogramExportFormat::Tsv.is_figure());
    }
}
