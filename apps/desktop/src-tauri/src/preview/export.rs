//! The session's one selected-spectrum export.
//!
//! Three documents come out of here -- an SVG figure, and the same spectrum's
//! points as CSV or TSV -- and all three are built from one thing: the complete
//! `SelectedSpectrumResult` Rust already read. They are siblings over that
//! source rather than derivations of each other. The data file is not read out
//! of the figure's coordinates, and the figure is not drawn from the rows.
//!
//! ## Why the webview's arrays cannot be the source
//!
//! `SelectedSpectrumDto` carries at most `MAX_SPECTRUM_POINTS` of each array
//! and a `truncated` flag, because that projection exists to get a *drawing*
//! across an IPC boundary. The component that receives it treats what it holds
//! as a prefix and says so. Exporting from there would mean a file whose point
//! count is a property of the transfer bound rather than of the measurement,
//! and it would be wrong silently -- the arrays look complete whenever the
//! spectrum happens to be smaller than the bound, so the defect would only
//! appear on the large spectra a user is most likely to want exported.
//!
//! So the complete result stays in Rust, in one slot, and the webview receives
//! an opaque token naming it. An export command identifies the exact spectrum
//! it was invoked for; it does not reconstruct one from React, and it does not
//! read whichever row happens to be focused by the time the user finishes with
//! a save dialog.
//!
//! ## One current spectrum, and no more
//!
//! The slot holds exactly one snapshot: the spectrum whose preview is on
//! screen. A newer selection replaces it, which is what makes this bounded --
//! nothing accumulates, nothing is written to disk, and nothing survives a
//! restart. An export that has already claimed its snapshot finishes from the
//! `Arc` it took, so a selection landing while a save dialog is open cannot
//! change which spectrum is being written.
//!
//! ## And no longer than that
//!
//! "The spectrum whose preview is on screen" is a claim about a moment, and the
//! moment ends in more ways than a newer selection. The spectrum can turn out
//! to be unavailable, the read can fail, the preview can be replaced, its
//! dataset can be removed, the whole list can be cleared. Each of those leaves
//! a panel with nothing loaded, and a slot still holding the last complete
//! measurement is a slot whose contents outlive the sentence describing them --
//! two `f64` arrays kept alive for the rest of the session by nothing the user
//! can see.
//!
//! So revocation is Rust's decision, taken where the event happens, rather than
//! a courtesy call the webview is trusted to make. `forget` drops the retained
//! spectrum; `forget_if_owned_by` drops it only when the dataset it came from
//! is one of the ones going away, which is what keeps removing an *unrelated*
//! row -- or moving focus to one -- from revoking the spectrum a user is
//! reading. A claimed export is untouched by all of it: it holds its own `Arc`
//! and finishes. What revocation guarantees is narrower and is the whole point
//! -- after it, the old token names nothing, so every *new* operation is
//! refused as stale.

use std::sync::Arc;

use mscanvas_plot_spec::spec::{
    AxisSpec, Caption, DataScope, Domain, FigureSize, FigureSpec, FigureTheme, Label, PanelSpec,
    PlotKind, SeriesSpec, SpecError, SpectrumRepresentation, StyleRole, UnitState,
};
use mscanvas_proteowizard::{
    SelectedSpectrumResult, SpectrumRepresentationState, UnitState as SourceUnitState,
};

use super::dialog::SaveDialogFacts;
use super::selection::DatasetId;

/// The exported figure's size, in figure units.
///
/// Fixed for M4.1, and deliberately not a control. A dimension picker is
/// FIG-002's neighbour and arrives with DPI and theme in M4.2; offering one
/// here would be a user-selectable figure property shipped without the rest of
/// the surface it belongs to. This is a legible single-panel spectrum on a
/// page, which is what this milestone exports.
const EXPORT_FIGURE_WIDTH: f64 = 1_200.0;
const EXPORT_FIGURE_HEIGHT: f64 = 640.0;

/// The exported figure's theme.
///
/// The figure's own rather than the application's, which is the property ADR
/// 0028 settled: a user reading a dark screen still publishes on white paper,
/// and the colour is written into the document so the file means the same thing
/// wherever it is opened. Fixed here, and a fixed theme is **not** FIG-005 --
/// that feature is a theme the user chooses.
const EXPORT_FIGURE_THEME: FigureTheme = FigureTheme::Light;

/// The version this file's schema answers to.
///
/// Written into every data document beside the format name, so a file that
/// outlives this build says which rules it was written under rather than
/// leaving a reader to infer them from the columns. Two fields rather than one
/// compound: a reader that recognises the format and not the version needs to
/// be able to say so, and splitting a joined field to find out would be a parse
/// rule of its own.
pub(super) const SPECTRUM_DATA_SCHEMA_VERSION: u32 = 1;

/// What the data document calls itself.
pub(super) const SPECTRUM_DATA_FORMAT_ID: &str = "mscanvas_spectrum_export";

/// The value every unreported state is written as, in the figure and the data
/// document alike.
///
/// One spelling, because a reader comparing the two files should not have to
/// decide whether `unreported` and `unknown` mean the same thing.
const UNREPORTED: &str = "unreported";

/// Which document one export writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SpectrumExportFormat {
    Svg,
    Csv,
    Tsv,
}

impl SpectrumExportFormat {
    /// The stable identifier this format is named by across the boundary.
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Csv => "csv",
            Self::Tsv => "tsv",
        }
    }

    /// Reads one format the webview asked for, refusing anything else.
    ///
    /// Closed rather than parsed loosely: the webview names one of three
    /// documents this boundary knows how to write, and an unrecognised name is
    /// a request MSCanvas has no answer for rather than one to guess at.
    pub(super) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "svg" => Some(Self::Svg),
            "csv" => Some(Self::Csv),
            "tsv" => Some(Self::Tsv),
            _ => None,
        }
    }

    /// How this format's save dialog presents itself.
    pub(super) const fn dialog(self) -> SaveDialogFacts {
        match self {
            Self::Svg => SaveDialogFacts {
                title: "Export spectrum figure",
                filter_label: "SVG figure (*.svg)",
                filter_pattern: "*.svg",
                default_extension: "svg",
            },
            Self::Csv => SaveDialogFacts {
                title: "Export spectrum data",
                filter_label: "Comma-separated values (*.csv)",
                filter_pattern: "*.csv",
                default_extension: "csv",
            },
            Self::Tsv => SaveDialogFacts {
                title: "Export spectrum data",
                filter_label: "Tab-separated values (*.tsv)",
                filter_pattern: "*.tsv",
                default_extension: "tsv",
            },
        }
    }

    /// What separates two fields of a data document.
    ///
    /// `None` for the figure, which has no fields. Kept as one answer rather
    /// than a second enum, so a format added here cannot forget to say.
    const fn delimiter(self) -> Option<char> {
        match self {
            Self::Svg => None,
            Self::Csv => Some(','),
            Self::Tsv => Some('\t'),
        }
    }

    /// The name the save dialog offers first.
    ///
    /// Built from the spectrum's index and nothing else. No part of the source
    /// path, the workspace handle or the dataset's display name reaches a file
    /// name this boundary proposes.
    pub(super) fn suggested_file_name(self, index: u64) -> String {
        format!("mscanvas-spectrum-{index}.{}", self.stable_id())
    }
}

/// One session-scoped name for one retained spectrum.
///
/// Opaque on purpose. It is a counter, it names nothing outside this session,
/// and it is meaningless to anything that did not receive it from this slot --
/// so a webview holding one has been told which spectrum it may export and
/// nothing whatever about where that spectrum came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SpectrumExportToken(u64);

impl SpectrumExportToken {
    /// The form that crosses to the webview.
    ///
    /// A string rather than a number, because a JSON number is an `f64` on the
    /// other side and a token is an identity rather than a quantity. Nothing
    /// arithmetic is ever done to it there.
    pub(super) fn as_wire(self) -> String {
        self.0.to_string()
    }

    /// Reads one token back, refusing anything that is not one.
    fn from_wire(value: &str) -> Option<Self> {
        value.parse::<u64>().ok().map(Self)
    }
}

/// The exact spectrum one export writes.
///
/// The result is held behind an `Arc` and never cloned. A selected spectrum is
/// two `f64` arrays that may run to hundreds of thousands of points each, and
/// this boundary already refuses to copy scientific arrays around; an export
/// takes a second handle to the same allocation and the slot may drop its own
/// the moment a newer selection arrives.
#[derive(Debug, Clone)]
pub(super) struct SpectrumSnapshot {
    token: SpectrumExportToken,
    /// Which dataset this spectrum was read from.
    ///
    /// The minimum needed to answer one question: when rows are removed, is
    /// this one of them. A `DatasetId` is a number this session allocated and
    /// only Rust can turn into a path, so carrying it here adds no way to learn
    /// where the file is -- and it is never serialized, never sent to the
    /// webview, and never written down.
    owner: DatasetId,
    spectrum: Arc<SelectedSpectrumResult>,
}

impl SpectrumSnapshot {
    pub(super) const fn token(&self) -> SpectrumExportToken {
        self.token
    }

    pub(super) fn spectrum(&self) -> &SelectedSpectrumResult {
        &self.spectrum
    }

    /// How many points the exported document will carry.
    ///
    /// The complete count, which is the whole reason this type exists: the
    /// webview's copy of the same spectrum may hold fewer.
    pub(super) fn point_count(&self) -> usize {
        self.spectrum.mz_values().len()
    }

    pub(super) fn index(&self) -> u64 {
        self.spectrum.identity().index()
    }

    /// The dataset this spectrum was read from.
    pub(super) const fn owner(&self) -> DatasetId {
        self.owner
    }
}

/// Where the session's one selected-spectrum export is.
///
/// One slot, for the reason the diagnostics export has one: this is an action
/// on the spectrum that is on screen, and a list of them would be a list
/// nothing reads a second entry of. It holds no path at any point.
#[derive(Debug)]
pub(super) struct SpectrumExportSlot {
    next_token: u64,
    next_reservation: u64,
    /// The spectrum a new export may be started for.
    ///
    /// Replaced whenever a newer selection is interpreted, and dropped when the
    /// preview it belonged to closes. An export already under way does not read
    /// this: it took its own handle when it claimed one.
    current: Option<SpectrumSnapshot>,
    state: ExportState,
}

#[derive(Debug, Clone)]
enum ExportState {
    Idle,
    /// A reservation was issued and has not been claimed, or has been claimed
    /// and its picker is open. Both are the same fact to a reader: no
    /// destination has been accepted, so nothing has been created.
    AwaitingDestination {
        reservation: SpectrumReservationId,
        claimed: bool,
        /// The snapshot this export is for, taken when the reservation was
        /// issued. Held here rather than read from `current` at claim time, so
        /// a selection that lands in between cannot move an export that has
        /// already been started onto a different spectrum.
        snapshot: SpectrumSnapshot,
        format: SpectrumExportFormat,
    },
    /// A destination was chosen and the bytes are being written.
    Writing,
}

/// One session-scoped name for one export attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SpectrumReservationId(u64);

impl SpectrumReservationId {
    pub(super) fn as_wire(self) -> String {
        self.0.to_string()
    }

    fn from_wire(value: &str) -> Option<Self> {
        value.parse::<u64>().ok().map(Self)
    }
}

/// What a claimed reservation hands to the code that will write the file.
///
/// Public so the command layer can carry one from the claim to the write, and
/// opaque so that is all it can do with it. The spectrum inside never leaves
/// this module: the command layer needs a dialog and a suggested name, and both
/// are answered here rather than by handing out the measurement.
#[derive(Debug, Clone)]
pub struct ClaimedSpectrumExport {
    pub(super) snapshot: SpectrumSnapshot,
    pub(super) format: SpectrumExportFormat,
}

impl ClaimedSpectrumExport {
    /// How this export's save dialog presents itself.
    #[must_use]
    pub const fn dialog(&self) -> SaveDialogFacts {
        self.format.dialog()
    }

    /// The name that dialog offers first.
    ///
    /// Built from the spectrum's index and the format, and from nothing that
    /// came out of a path.
    #[must_use]
    pub fn suggested_file_name(&self) -> String {
        self.format.suggested_file_name(self.snapshot.index())
    }
}

impl Default for SpectrumExportSlot {
    fn default() -> Self {
        Self {
            // Both begin at one, so zero is never a live identifier.
            next_token: 1,
            next_reservation: 1,
            current: None,
            state: ExportState::Idle,
        }
    }
}

impl SpectrumExportSlot {
    /// Retains one interpreted spectrum as the one a new export may name.
    ///
    /// The previous snapshot is dropped here, which is the whole bound: one
    /// spectrum is retained, not a history of them. An export already under way
    /// is unaffected -- it holds its own handle -- so this neither waits for one
    /// nor cancels one.
    pub(super) fn install(
        &mut self,
        owner: DatasetId,
        spectrum: SelectedSpectrumResult,
    ) -> SpectrumSnapshot {
        let token = SpectrumExportToken(self.next_token);
        self.next_token = self
            .next_token
            .checked_add(1)
            .expect("a session interprets fewer than u64::MAX selected spectra");
        let snapshot = SpectrumSnapshot {
            token,
            owner,
            spectrum: Arc::new(spectrum),
        };
        self.current = Some(snapshot.clone());
        snapshot
    }

    /// Forgets the retained spectrum.
    ///
    /// Called wherever the panel stops naming it: the read failed, the spectrum
    /// was unavailable, a preview was opened over it, or the list was cleared.
    /// An export under way keeps its own handle and finishes; what this ends is
    /// the ability to start a *new* one against the old token.
    pub(super) fn forget(&mut self) {
        self.current = None;
    }

    /// Forgets the retained spectrum only if one of these datasets owns it.
    ///
    /// Removing rows around the preview is not a reason to revoke what the user
    /// is reading -- the frontend keeps the preview open in exactly that case,
    /// and a slot that forgot anyway would refuse the next export of a spectrum
    /// still on screen. Answers whether it dropped anything.
    pub(super) fn forget_if_owned_by(&mut self, removed: &[DatasetId]) -> bool {
        let owned = self
            .current
            .as_ref()
            .is_some_and(|snapshot| removed.contains(&snapshot.owner()));
        if owned {
            self.current = None;
        }
        owned
    }

    /// A handle that does not keep the spectrum alive.
    ///
    /// Test-only, and the only way to witness what revocation is actually for:
    /// whether the two arrays are *released*, rather than merely unreachable
    /// through this slot. A test drops its own snapshot, revokes, and upgrades
    /// this -- `None` is the evidence, and nothing else in this module could
    /// have produced it.
    #[cfg(test)]
    pub(super) fn weak_current(&self) -> Option<std::sync::Weak<SelectedSpectrumResult>> {
        self.current
            .as_ref()
            .map(|snapshot| Arc::downgrade(&snapshot.spectrum))
    }

    /// Whether an export has reached something a second one must not disturb.
    ///
    /// A dialog the user is standing in front of, or bytes going to disk. An
    /// *unclaimed* reservation is neither: it is a document having asked and not
    /// yet followed through, and refusing on it is what would let one reload
    /// between the two commands wedge the slot for the rest of the session.
    const fn is_committed(&self) -> bool {
        matches!(
            self.state,
            ExportState::Writing | ExportState::AwaitingDestination { claimed: true, .. }
        )
    }

    /// Issues one reservation for one named spectrum.
    ///
    /// Refuses while an export is committed, and supersedes an unclaimed
    /// reservation rather than refusing on it. Two dialogs for one session stay
    /// impossible -- claiming is what opens one, and a superseded reservation
    /// can no longer be claimed -- while a document that reloaded after asking
    /// leaves nothing behind that a later export has to wait for.
    ///
    /// The token is checked against the retained snapshot rather than trusted:
    /// a webview that has been holding a token across a newer selection is
    /// naming a spectrum this session no longer has, and the honest answer is
    /// that it is gone rather than a file of whatever is current now.
    pub(super) fn begin(
        &mut self,
        token: &str,
        format: SpectrumExportFormat,
    ) -> Result<SpectrumReservationId, BeginExportRefusal> {
        // Asked before whether anything else is running, because the two
        // refusals send the user somewhere different. "Already exporting" means
        // wait; "no longer loaded" means select the spectrum again. A stale
        // token answered with the first would send someone to wait for an
        // export whose finishing cannot help them.
        let requested = SpectrumExportToken::from_wire(token).ok_or(BeginExportRefusal::Stale)?;
        let snapshot = self
            .current
            .as_ref()
            .filter(|snapshot| snapshot.token == requested)
            .ok_or(BeginExportRefusal::Stale)?
            .clone();
        if self.is_committed() {
            return Err(BeginExportRefusal::AlreadyExporting);
        }
        let reservation = SpectrumReservationId(self.next_reservation);
        self.next_reservation = self
            .next_reservation
            .checked_add(1)
            .expect("a session issues fewer than u64::MAX spectrum export reservations");
        self.state = ExportState::AwaitingDestination {
            reservation,
            claimed: false,
            snapshot,
            format,
        };
        Ok(reservation)
    }

    /// Claims one issued reservation, so its save dialog may be shown.
    ///
    /// Claiming once is the rule. A second claim of the same reservation is a
    /// second dialog for one export, and answering it would leave two windows
    /// able to publish the same file.
    pub(super) fn claim(&mut self, reservation: &str) -> Option<ClaimedSpectrumExport> {
        let requested = SpectrumReservationId::from_wire(reservation)?;
        let ExportState::AwaitingDestination {
            reservation: held,
            claimed,
            snapshot,
            format,
        } = &mut self.state
        else {
            return None;
        };
        if *held != requested || *claimed {
            return None;
        }
        *claimed = true;
        Some(ClaimedSpectrumExport {
            snapshot: snapshot.clone(),
            format: *format,
        })
    }

    /// Returns an unclaimed or open reservation to idle.
    ///
    /// Answers whether it changed anything, so a caller can tell a cancellation
    /// that closed this export from one that named a reservation which had
    /// already ended.
    pub(super) fn cancel(&mut self, reservation: &str) -> bool {
        let Some(requested) = SpectrumReservationId::from_wire(reservation) else {
            return false;
        };
        let ExportState::AwaitingDestination {
            reservation: held, ..
        } = &self.state
        else {
            return false;
        };
        if *held != requested {
            return false;
        }
        self.state = ExportState::Idle;
        true
    }

    /// Moves a claimed export from choosing a destination to writing one.
    pub(super) fn begin_write(&mut self) {
        self.state = ExportState::Writing;
    }

    /// Ends this write, however it went.
    ///
    /// Only a write. A successful export has already returned the slot to idle
    /// by the time the guard falls, and another export may have reserved it in
    /// between -- clearing that would refuse a file somebody else is in the
    /// middle of choosing.
    pub(super) fn release_write(&mut self) -> bool {
        if matches!(self.state, ExportState::Writing) {
            self.state = ExportState::Idle;
            return true;
        }
        false
    }
}

/// Why one export could not be started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BeginExportRefusal {
    /// Another export of this session has not finished.
    AlreadyExporting,
    /// The named spectrum is not the one this session holds.
    Stale,
}

/// Builds the figure one selected spectrum exports as.
///
/// One panel and one measurement series, at `DataScope::FullSource`, because
/// this export is the complete spectrum Rust read. Nothing here is a reduction,
/// and nothing here comes from the screen: the screen's own renderer draws from
/// a different projection of the same reading, and the two agree by both being
/// right rather than by sharing geometry.
///
/// # Errors
///
/// Answers with the contract's own refusal. A spectrum whose m/z values are not
/// non-decreasing, or which carries a value the contract will not accept, is
/// refused here rather than drawn into a figure that misstates it.
pub(super) fn figure_spec(spectrum: &SelectedSpectrumResult) -> Result<FigureSpec, SpecError> {
    // Exhaustive, with no wildcard arm. Both of these enumerations carry one
    // state today, and that is exactly why the match is written this way: a
    // backend that starts emitting a real representation or a real unit must
    // arrive here as a compile error and be mapped from that evidence, rather
    // than falling into a default that happens to keep building.
    let representation = match spectrum.representation() {
        SpectrumRepresentationState::NotEmitted => SpectrumRepresentation::Unreported,
    };
    let unit = match spectrum.value_units() {
        SourceUnitState::NotEmitted => UnitState::Unreported,
    };

    let series = SeriesSpec::new(
        // A stable semantic name for what this series is, and not an identity
        // of the file it came from. No part of a path, a workspace handle or a
        // dataset display name reaches the exported document.
        Label::new("measurement")?,
        StyleRole::Measurement,
        DataScope::FullSource,
        spectrum.mz_values().to_vec(),
        spectrum.intensity_values().to_vec(),
    )?;

    let panel = PanelSpec::new(
        PlotKind::Spectrum { representation },
        // Both axes carry the same state because the backend reports one
        // answer for the arrays rather than one per axis. Cloned rather than
        // copied: an established unit is a `Label`, so the state owns a string
        // in the case this build cannot reach yet.
        AxisSpec::new(Label::new("m/z")?, unit.clone()),
        AxisSpec::new(Label::new("Intensity")?, unit),
        domain_of(series.x())?,
        value_domain_of(series.y())?,
        vec![series],
    )?;

    Ok(FigureSpec::new(
        EXPORT_FIGURE_THEME,
        FigureSize::new(EXPORT_FIGURE_WIDTH, EXPORT_FIGURE_HEIGHT)?,
        vec![panel],
    )?
    .with_title(Label::new(format!(
        "Spectrum {}",
        spectrum.identity().index()
    ))?)
    .with_caption(Caption::new(format!(
        "Complete selected spectrum, {} points. Representation {UNREPORTED}; m/z and \
         intensity units {UNREPORTED}.",
        spectrum.mz_values().len()
    ))?))
}

/// The domain the exported spectrum covers.
///
/// Derived from the points themselves rather than from the backend's separately
/// reported low and high. Those are a second reading of the same spectrum, and
/// where the two disagree the points are what the figure draws -- so taking the
/// reported pair would produce a figure whose axis and whose marks describe
/// different things, or a refusal for a disagreement the reader cannot see.
///
/// An empty spectrum has no points to derive anything from, and gets the one
/// domain that claims nothing: a single value at zero. The description already
/// states in words that the series carries no points, so the axis is not where
/// a reader learns that.
fn domain_of(values: &[f64]) -> Result<Domain, SpecError> {
    match (values.first(), values.last()) {
        // Ordered by the contract, so the ends are the extremes.
        (Some(low), Some(high)) => Domain::new(*low, *high),
        _ => Domain::new(0.0, 0.0),
    }
}

/// The value range the exported spectrum is drawn against.
///
/// Always includes zero. An unreported representation is drawn as marks from
/// the zero line -- only established profile data may be joined -- and the
/// contract refuses such a panel whose range excludes zero, because a mark's
/// length would then encode its distance from the range end rather than its
/// magnitude. Negative intensity is preserved rather than clamped: baseline
/// subtraction produces it legitimately, and dropping it would erase measured
/// signal on the way to a file.
fn value_domain_of(values: &[f64]) -> Result<Domain, SpecError> {
    let mut low = 0.0_f64;
    let mut high = 0.0_f64;
    for value in values {
        low = low.min(*value);
        high = high.max(*value);
    }
    Domain::new(low, high)
}

/// Renders one selected spectrum as the SVG document a user receives.
///
/// # Errors
///
/// Answers with the contract's refusal where the spectrum cannot be specified.
pub(super) fn svg_document(spectrum: &SelectedSpectrumResult) -> Result<String, SpecError> {
    Ok(mscanvas_plot_spec::svg::render(&figure_spec(spectrum)?))
}

/// Renders one selected spectrum as the data document a user receives.
///
/// # Schema, version 1
///
/// A metadata preamble, then a header row, then exactly one record per source
/// point in source order:
///
/// ```text
/// #format,mscanvas_spectrum_export
/// #schema_version,1
/// #spectrum_index,42
/// #point_count,2
/// #representation,unreported
/// #mz_unit,unreported
/// #intensity_unit,unreported
/// mz,intensity
/// 100.5,12
/// 100.75,0
/// ```
///
/// The preamble uses the same delimiter as the records, so one split rule reads
/// the whole file, and every preamble line begins with `#` so a reader that
/// wants only the table can skip them without knowing what they say. An empty
/// spectrum is the same document with `#point_count,0` and no records after the
/// header: the representation and unit states survive in a file with no rows,
/// which is the case a bare two-column table could not describe at all.
///
/// **No quoting rule exists, because no field can need one.** Every preamble
/// key is a fixed ASCII identifier, every preamble value is either an integer
/// or one of this module's fixed state words, and every record field is a
/// number. None of them can contain a delimiter, a quote or a line break, and a
/// test asserts that over the whole document rather than trusting it.
///
/// Numbers are written with Rust's shortest round-tripping form: locale
/// independent, `.` as the decimal point, no thousands separator, and exactly
/// the `f64` the backend parsed comes back out of the file.
///
/// Lines end with `\n`. One ending, chosen rather than inherited from the host,
/// so the same spectrum is the same bytes on every platform.
pub(super) fn data_document(
    spectrum: &SelectedSpectrumResult,
    format: SpectrumExportFormat,
) -> Option<String> {
    let delimiter = format.delimiter()?;
    let representation = match spectrum.representation() {
        SpectrumRepresentationState::NotEmitted => UNREPORTED,
    };
    let unit = match spectrum.value_units() {
        SourceUnitState::NotEmitted => UNREPORTED,
    };

    let mz = spectrum.mz_values();
    let intensity = spectrum.intensity_values();
    let mut document = String::with_capacity(64 + mz.len() * 24);
    for (key, value) in [
        ("format", SPECTRUM_DATA_FORMAT_ID.to_owned()),
        ("schema_version", SPECTRUM_DATA_SCHEMA_VERSION.to_string()),
        ("spectrum_index", spectrum.identity().index().to_string()),
        ("point_count", mz.len().to_string()),
        ("representation", representation.to_owned()),
        ("mz_unit", unit.to_owned()),
        ("intensity_unit", unit.to_owned()),
    ] {
        document.push('#');
        document.push_str(key);
        document.push(delimiter);
        document.push_str(&value);
        document.push('\n');
    }
    document.push_str("mz");
    document.push(delimiter);
    document.push_str("intensity\n");
    // One record per source point, in source order. Zipped rather than indexed
    // because the contract already refuses arrays of different lengths, and a
    // loop over one length would decide what to do about the other.
    for (at, value) in mz.iter().zip(intensity.iter()) {
        document.push_str(&at.to_string());
        document.push(delimiter);
        document.push_str(&value.to_string());
        document.push('\n');
    }
    Some(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mscanvas_plot_spec::spec::DataScope;

    /// The dataset a slot test's spectrum came from.
    ///
    /// Which one rarely matters here -- the slot tests are about the token and
    /// the reservation, not about ownership -- so they share one, and the tests
    /// that *are* about ownership name a second explicitly.
    fn owner(number: u64) -> DatasetId {
        DatasetId::parse(&format!("file-{number}")).expect("a well-formed handle")
    }

    fn spectrum(index: u64, mz: Vec<f64>, intensity: Vec<f64>) -> SelectedSpectrumResult {
        SelectedSpectrumResult::from_points_for_tests(index, mz, intensity)
    }

    /// Reads the records of one data document back into the numbers they carry.
    fn records(document: &str, delimiter: char) -> Vec<(f64, f64)> {
        document
            .lines()
            .skip_while(|line| line.starts_with('#'))
            .skip(1)
            .filter(|line| !line.is_empty())
            .map(|line| {
                let (at, value) = line
                    .split_once(delimiter)
                    .expect("a record carries both fields");
                (
                    at.parse::<f64>().expect("the domain field is a number"),
                    value.parse::<f64>().expect("the value field is a number"),
                )
            })
            .collect()
    }

    fn preamble(document: &str) -> Vec<String> {
        document
            .lines()
            .take_while(|line| line.starts_with('#'))
            .map(str::to_owned)
            .collect()
    }

    // ------------------------------------------------------------ the figure

    /// One panel, one measurement, and the whole source.
    ///
    /// The shape M4.1 promises. A second panel or a reduction reaching this
    /// figure would mean the export had stopped being the spectrum the user
    /// selected and started being something assembled about it.
    #[test]
    fn the_exported_figure_is_one_full_source_measurement() {
        let figure = figure_spec(&spectrum(7, vec![100.0, 200.0], vec![10.0, 20.0]))
            .expect("an ordinary spectrum is specifiable");
        assert_eq!(figure.panels().len(), 1, "exactly one panel");
        let panel = &figure.panels()[0];
        assert_eq!(panel.series().len(), 1, "exactly one series");
        let series = &panel.series()[0];
        assert_eq!(series.scope(), DataScope::FullSource, "never a reduction");
        assert_eq!(series.role(), StyleRole::Measurement);
        assert_eq!(
            panel.visible_domain(),
            None,
            "M4.1 exports the full range and declares no window",
        );
        assert!(
            panel.is_full_source(),
            "every series in the panel carries its whole source",
        );
        // The points are the spectrum's own, in its own order.
        assert_eq!(series.x(), &[100.0, 200.0]);
        assert_eq!(series.y(), &[10.0, 20.0]);
        assert_eq!(
            panel.full_domain().low(),
            100.0,
            "the domain is derived from the points it draws",
        );
        assert_eq!(panel.full_domain().high(), 200.0);
    }

    /// Representation and units are carried across as the unreported states
    /// they are.
    ///
    /// Not centroid, and not dimensionless. The backend emits no marker and no
    /// unit, and the exported figure says exactly that -- the third state the
    /// contract keeps precisely so this distinction survives a file boundary.
    #[test]
    fn unreported_backend_states_reach_the_figure_unreported() {
        let figure = figure_spec(&spectrum(1, vec![100.0], vec![5.0])).expect("specifiable");
        let panel = &figure.panels()[0];
        assert_eq!(
            panel.kind(),
            PlotKind::Spectrum {
                representation: SpectrumRepresentation::Unreported,
            },
            "an unreported representation is not centroid data",
        );
        assert_eq!(
            panel.x_axis().unit,
            UnitState::Unreported,
            "an unreported unit is not a dimensionless one",
        );
        assert_eq!(panel.y_axis().unit, UnitState::Unreported);
        assert_eq!(panel.x_axis().label.as_str(), "m/z");
        assert_eq!(panel.y_axis().label.as_str(), "Intensity");
    }

    /// The value range keeps zero and keeps negative intensity.
    #[test]
    fn the_value_range_keeps_zero_and_negative_intensity() {
        let figure = figure_spec(&spectrum(1, vec![1.0, 2.0, 3.0], vec![-4.0, 0.0, 9.0]))
            .expect("negative intensity is preserved end to end");
        let values = figure.panels()[0].value_domain();
        assert!(
            values.low() <= 0.0 && values.high() >= 0.0,
            "zero is in range"
        );
        assert_eq!(values.low(), -4.0, "the deepest negative is kept");
        assert_eq!(values.high(), 9.0);
        // An all-positive spectrum still declares zero, because the marks are
        // lengths measured from it.
        let positive = figure_spec(&spectrum(1, vec![1.0], vec![9.0])).expect("specifiable");
        assert_eq!(positive.panels()[0].value_domain().low(), 0.0);
    }

    /// A spectrum with no peaks is one empty measurement, never a panel of no
    /// series.
    #[test]
    fn an_empty_spectrum_is_one_empty_measurement() {
        let figure =
            figure_spec(&spectrum(3, Vec::new(), Vec::new())).expect("an empty spectrum exports");
        let panel = &figure.panels()[0];
        assert_eq!(panel.series().len(), 1, "one series, carrying no points");
        assert!(panel.series()[0].is_empty());
        let document = mscanvas_plot_spec::svg::render(&figure);
        assert!(
            document.contains("carries no points"),
            "and the figure says so in words: {document}",
        );
    }

    /// Nothing in the exported document names where the spectrum came from.
    #[test]
    fn the_exported_figure_carries_no_path_or_handle() {
        let figure =
            figure_spec(&spectrum(42, vec![100.0, 200.0], vec![1.0, 2.0])).expect("specifiable");
        assert_eq!(figure.title().map(Label::as_str), Some("Spectrum 42"));
        let document = mscanvas_plot_spec::svg::render(&figure);
        // The SVG namespace declaration is required by the format and locates
        // nothing -- the M4.0 evidence record makes the same exclusion for the
        // same reason -- so it is removed before the document is searched.
        let searchable = document.replace("http://www.w3.org/2000/svg", "");
        for forbidden in [
            ":\\", "://", "C:", "/Users/", "\\\\", "href", "url(", "<image",
        ] {
            assert!(
                !searchable.contains(forbidden),
                "the document carries {forbidden:?}: {document}",
            );
        }
        assert!(
            document.contains("<title>") && document.contains("<desc>"),
            "the accessible pair survives the export",
        );
    }

    /// The same specification renders the same bytes.
    #[test]
    fn the_exported_svg_is_deterministic() {
        let source = spectrum(5, vec![100.0, 200.0, 300.0], vec![1.0, -2.0, 3.0]);
        let first = svg_document(&source).expect("specifiable");
        let second = svg_document(&source).expect("specifiable");
        assert_eq!(
            first, second,
            "two renders of one spectrum are one document"
        );
        assert!(first.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
    }

    // -------------------------------------------------------- the data files

    /// The v1 preamble, exactly.
    #[test]
    fn the_data_document_carries_the_version_one_preamble() {
        let document = data_document(
            &spectrum(42, vec![100.5], vec![12.0]),
            SpectrumExportFormat::Csv,
        )
        .expect("a data format has a document");
        assert_eq!(
            preamble(&document),
            vec![
                "#format,mscanvas_spectrum_export".to_owned(),
                "#schema_version,1".to_owned(),
                "#spectrum_index,42".to_owned(),
                "#point_count,1".to_owned(),
                "#representation,unreported".to_owned(),
                "#mz_unit,unreported".to_owned(),
                "#intensity_unit,unreported".to_owned(),
            ],
        );
        let mut lines = document.lines().skip(7);
        assert_eq!(lines.next(), Some("mz,intensity"), "then the header row");
        assert_eq!(lines.next(), Some("100.5,12"));
    }

    /// Each format uses its own delimiter, in the preamble and the records
    /// alike, and no other.
    #[test]
    fn each_format_uses_one_delimiter_throughout() {
        let source = spectrum(1, vec![100.5, 200.25], vec![1.0, 2.0]);
        let csv = data_document(&source, SpectrumExportFormat::Csv).expect("csv");
        let tsv = data_document(&source, SpectrumExportFormat::Tsv).expect("tsv");
        assert!(csv.contains("#format,mscanvas_spectrum_export"));
        assert!(tsv.contains("#format\tmscanvas_spectrum_export"));
        assert!(csv.contains("mz,intensity\n"));
        assert!(tsv.contains("mz\tintensity\n"));
        assert!(!csv.contains('\t'), "a comma-separated file carries no tab");
        assert!(
            !tsv.contains(','),
            "a tab-separated file carries no comma: {tsv}",
        );
        // One line ending, chosen rather than inherited from the host.
        assert!(!csv.contains('\r') && !tsv.contains('\r'));
        assert!(csv.ends_with('\n') && tsv.ends_with('\n'));
        assert_eq!(
            csv.matches('\n').count(),
            10,
            "seven preamble lines, one header and two records",
        );
        // The figure has no data document at all.
        assert_eq!(data_document(&source, SpectrumExportFormat::Svg), None);
    }

    /// No field this schema emits can need a quoting rule.
    ///
    /// Asserted over the whole document rather than trusted. Every preamble key
    /// is a fixed identifier, every preamble value is an integer or a fixed
    /// state word, and every record field is a number -- so a delimiter, a
    /// quote or a line break inside a field is not something this schema can
    /// produce, and a quoting rule would be a rule with no case.
    #[test]
    fn no_emitted_field_ever_needs_quoting() {
        let source = spectrum(
            9,
            vec![-1.5, 0.0, 1e300, 2.5],
            vec![-0.0, 0.0, -1e-300, 7.25],
        );
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            let document = data_document(&source, format).expect("a data document");
            assert!(!document.contains('"'), "no field is quoted");
            for line in document.lines() {
                assert_eq!(
                    line.matches(delimiter).count(),
                    1,
                    "every line carries exactly one delimiter: {line:?}",
                );
            }
        }
    }

    /// The records are the source points, in source order, exactly.
    #[test]
    fn the_records_are_the_source_points_in_source_order() {
        let mz = vec![100.0, 100.5, 300.25, 999.125];
        let intensity = vec![0.0, -12.5, 3.0, 0.0];
        let source = spectrum(1, mz.clone(), intensity.clone());
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            let document = data_document(&source, format).expect("a data document");
            let parsed = records(&document, delimiter);
            assert_eq!(parsed.len(), mz.len(), "one record per source point");
            for (index, (at, value)) in parsed.iter().enumerate() {
                // Bit-for-bit, not approximately. The file is the measurement.
                assert_eq!(at.to_bits(), mz[index].to_bits(), "m/z {index} round-trips");
                assert_eq!(
                    value.to_bits(),
                    intensity[index].to_bits(),
                    "intensity {index} round-trips",
                );
            }
            assert!(
                document.contains(&format!("#point_count,{}", mz.len()))
                    || document.contains(&format!("#point_count\t{}", mz.len())),
                "the declared count is the record count",
            );
        }
    }

    /// Awkward numbers survive the round trip.
    #[test]
    fn awkward_values_round_trip_through_both_formats() {
        // `MIN_POSITIVE` is the smallest *normal* f64, so it does not answer
        // the subnormal question at all. `from_bits(1)` is the smallest
        // positive subnormal and `MIN_POSITIVE / 2.0` is one in the middle of
        // that range -- the values whose shortest round-tripping form is
        // longest and least like the number a reader expects.
        let mz = vec![
            0.1 + 0.2,
            1.0 / 3.0,
            1e-300,
            1e300,
            f64::from_bits(1),
            f64::MIN_POSITIVE / 2.0,
        ];
        let intensity = vec![
            -0.0,
            f64::MIN_POSITIVE,
            -1.0 / 3.0,
            0.0,
            -f64::from_bits(1),
            f64::MAX,
        ];
        let source = spectrum(1, mz.clone(), intensity.clone());
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            for (index, (at, value)) in records(
                &data_document(&source, format).expect("a data document"),
                delimiter,
            )
            .iter()
            .enumerate()
            {
                assert_eq!(at.to_bits(), mz[index].to_bits());
                assert_eq!(value.to_bits(), intensity[index].to_bits());
            }
        }
    }

    /// An empty spectrum still says what it is.
    ///
    /// The case a bare two-column table could not describe at all: no rows, and
    /// therefore nothing to infer a representation or a unit from.
    #[test]
    fn an_empty_spectrum_still_carries_its_semantics() {
        let document = data_document(
            &spectrum(4, Vec::new(), Vec::new()),
            SpectrumExportFormat::Csv,
        )
        .expect("an empty spectrum has a document");
        assert_eq!(
            preamble(&document),
            vec![
                "#format,mscanvas_spectrum_export".to_owned(),
                "#schema_version,1".to_owned(),
                "#spectrum_index,4".to_owned(),
                "#point_count,0".to_owned(),
                "#representation,unreported".to_owned(),
                "#mz_unit,unreported".to_owned(),
                "#intensity_unit,unreported".to_owned(),
            ],
        );
        assert!(
            document.ends_with("mz,intensity\n"),
            "the header and no records"
        );
        assert!(records(&document, ',').is_empty());
    }

    /// The data file and the figure describe the same points.
    ///
    /// Siblings over one source rather than derivations of each other. This is
    /// the assertion that would fail if either ever started reading the other.
    #[test]
    fn the_data_document_and_the_figure_carry_the_same_points() {
        let source = spectrum(11, vec![100.0, 150.5, 200.0], vec![5.0, -1.25, 0.0]);
        let figure = figure_spec(&source).expect("specifiable");
        let series = &figure.panels()[0].series()[0];
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            let parsed = records(
                &data_document(&source, format).expect("a data document"),
                delimiter,
            );
            assert_eq!(parsed.len(), series.len());
            for (index, (at, value)) in parsed.iter().enumerate() {
                assert_eq!(at.to_bits(), series.x()[index].to_bits());
                assert_eq!(value.to_bits(), series.y()[index].to_bits());
            }
        }
    }

    // --------------------------------------------------------------- the slot

    /// A token names one retained spectrum, and a superseded one names nothing.
    #[test]
    fn a_stale_token_is_refused_rather_than_rebound() {
        let mut slot = SpectrumExportSlot::default();
        let first = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let stale = first.token().as_wire();
        // A newer selection replaces the retained spectrum.
        let second = slot.install(owner(1), spectrum(2, vec![200.0], vec![2.0]));
        assert_ne!(stale, second.token().as_wire(), "each spectrum has its own");
        assert_eq!(
            slot.begin(&stale, SpectrumExportFormat::Svg),
            Err(BeginExportRefusal::Stale),
            "the older spectrum is gone rather than answered with the newer one",
        );
        // The spectrum that is actually loaded exports.
        assert!(
            slot.begin(&second.token().as_wire(), SpectrumExportFormat::Csv)
                .is_ok()
        );
    }

    /// A claimed export finishes from the spectrum it claimed.
    #[test]
    fn a_claimed_export_is_unaffected_by_a_later_selection() {
        let mut slot = SpectrumExportSlot::default();
        let first = slot.install(owner(1), spectrum(1, vec![100.0, 200.0], vec![1.0, 2.0]));
        let reservation = slot
            .begin(&first.token().as_wire(), SpectrumExportFormat::Csv)
            .expect("a reservation");
        let claimed = slot
            .claim(&reservation.as_wire())
            .expect("the reservation is claimable once");
        // The user is now in a save dialog. Two more selections land.
        slot.install(owner(1), spectrum(2, vec![300.0], vec![3.0]));
        slot.install(owner(1), spectrum(3, Vec::new(), Vec::new()));
        assert_eq!(
            claimed.snapshot.point_count(),
            2,
            "the claim still holds the spectrum it was invoked for",
        );
        assert_eq!(claimed.snapshot.index(), 1);
    }

    /// Claiming happens once, and a superseded reservation cannot claim at all.
    #[test]
    fn a_reservation_claims_once_and_a_superseded_one_never_does() {
        let mut slot = SpectrumExportSlot::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();
        let first = slot
            .begin(&token, SpectrumExportFormat::Svg)
            .expect("a reservation");
        // Unclaimed, so a second request supersedes it rather than being
        // refused -- which is what stops a reload between the two commands
        // wedging the slot for the rest of the session.
        let second = slot
            .begin(&token, SpectrumExportFormat::Csv)
            .expect("an unclaimed reservation is superseded");
        assert!(
            slot.claim(&first.as_wire()).is_none(),
            "the superseded reservation can no longer open a dialog",
        );
        assert!(slot.claim(&second.as_wire()).is_some());
        assert!(
            slot.claim(&second.as_wire()).is_none(),
            "and a claimed one cannot be claimed twice",
        );
    }

    /// An open dialog and a running write both refuse a second export.
    #[test]
    fn a_committed_export_refuses_another() {
        let mut slot = SpectrumExportSlot::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();
        let reservation = slot
            .begin(&token, SpectrumExportFormat::Svg)
            .expect("a reservation");
        slot.claim(&reservation.as_wire()).expect("claimed");
        assert_eq!(
            slot.begin(&token, SpectrumExportFormat::Csv),
            Err(BeginExportRefusal::AlreadyExporting),
            "a dialog the user is standing in front of is not interrupted",
        );
        slot.begin_write();
        assert_eq!(
            slot.begin(&token, SpectrumExportFormat::Csv),
            Err(BeginExportRefusal::AlreadyExporting),
            "and neither are bytes going to disk",
        );
        assert!(slot.release_write(), "the write ends and the slot is free");
        assert!(slot.begin(&token, SpectrumExportFormat::Tsv).is_ok());
    }

    /// Cancelling returns the slot to rest, and forgetting drops the spectrum.
    #[test]
    fn cancelling_frees_the_slot_and_forgetting_drops_the_spectrum() {
        let mut slot = SpectrumExportSlot::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();
        let reservation = slot
            .begin(&token, SpectrumExportFormat::Svg)
            .expect("a reservation");
        assert!(slot.cancel(&reservation.as_wire()));
        assert!(
            !slot.cancel(&reservation.as_wire()),
            "cancelling a reservation that already ended changes nothing",
        );
        assert!(slot.begin(&token, SpectrumExportFormat::Svg).is_ok());
        slot.forget();
        assert_eq!(
            slot.begin(&token, SpectrumExportFormat::Svg),
            Err(BeginExportRefusal::Stale),
            "a forgotten spectrum is gone",
        );
    }

    /// A spectrum larger than one transfer exports whole.
    ///
    /// The defect this milestone exists to prevent. `SelectedSpectrumDto`
    /// carries at most `MAX_SPECTRUM_POINTS` of each array, so an export built
    /// from the webview's copy would write a file whose length is a property of
    /// the IPC bound rather than of the measurement -- and it would be wrong
    /// silently, because the arrays look complete for every spectrum smaller
    /// than the bound. One point past it is enough to tell the two apart.
    #[test]
    fn a_spectrum_larger_than_one_transfer_exports_whole() {
        let complete = super::super::dto::MAX_SPECTRUM_POINTS + 1;
        let mz: Vec<f64> = (0..complete).map(|point| point as f64).collect();
        let intensity: Vec<f64> = (0..complete).map(|point| (point % 7) as f64).collect();
        let source = spectrum(1, mz, intensity);

        let figure = figure_spec(&source).expect("specifiable");
        assert_eq!(
            figure.panels()[0].series()[0].len(),
            complete,
            "the figure draws every source point, not the transferred prefix",
        );

        let document = data_document(&source, SpectrumExportFormat::Csv).expect("a document");
        let rows = document
            .lines()
            .skip_while(|line| line.starts_with('#'))
            .skip(1)
            .filter(|line| !line.is_empty())
            .count();
        assert_eq!(
            rows, complete,
            "one record per source point, past the bound"
        );
        assert!(
            document.contains(&format!("#point_count,{complete}")),
            "and the declared count says so too",
        );
    }

    /// The suggested name is built from the index and the format alone.
    #[test]
    fn the_suggested_name_names_no_source() {
        for (format, expected) in [
            (SpectrumExportFormat::Svg, "mscanvas-spectrum-42.svg"),
            (SpectrumExportFormat::Csv, "mscanvas-spectrum-42.csv"),
            (SpectrumExportFormat::Tsv, "mscanvas-spectrum-42.tsv"),
        ] {
            assert_eq!(format.suggested_file_name(42), expected);
        }
        assert_eq!(SpectrumExportFormat::from_wire("png"), None);
        assert_eq!(
            SpectrumExportFormat::from_wire("svg"),
            Some(SpectrumExportFormat::Svg),
        );
    }
}
