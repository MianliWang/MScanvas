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
    AxisSpec, Caption, DataScope, Domain, FigureSpec, Label, MIN_FIGURE_CHROME_HEIGHT,
    MIN_PANEL_HEIGHT, MeasurementRefusal, PanelSpec, PlotKind, SeriesSpec, SpecError,
    SpectrumRepresentation, StyleRole, UnitState, measurement_domains,
};
use mscanvas_proteowizard::{
    SelectedSpectrumResult, SpectrumRepresentationState, UnitState as SourceUnitState,
};

use super::chromatogram::{
    ChromatogramExportFormat, ChromatogramSource, LinkedFigureFormat, RangeRefusal, RangeRequest,
    ResolvedRange, TraceSet,
};
use super::dialog::SaveDialogFacts;
use super::figure::{FigureRenderSettings, PngDpi, RasterFailure, encode_png, rasterize};
use super::projection::{self, ProjectionRefusal, ViewportDomain};
use super::selection::DatasetId;

/// The version a **full-source** data document answers to.
///
/// Written into every data document beside the format name, so a file that
/// outlives this build says which rules it was written under rather than
/// leaving a reader to infer them from the columns. Two fields rather than one
/// compound: a reader that recognises the format and not the version needs to
/// be able to say so, and splitting a joined field to find out would be a parse
/// rule of its own.
///
/// **Frozen at 1.** This is the document M4.1 shipped and its shape already
/// means *the complete spectrum*: the same source writes the same bytes it
/// always did, and a reader holding one of those files needs no new rule to
/// read it. A range is expressed by [`SPECTRUM_DATA_CURRENT_SCHEMA_VERSION`]
/// instead, because silently changing what version 1 means is the one thing a
/// schema version exists to prevent.
pub(super) const SPECTRUM_DATA_FULL_SCHEMA_VERSION: u32 = 1;

/// The version a **current-range** data document answers to.
///
/// A separate version rather than an extra key on version 1. The two documents
/// answer different questions -- one is the spectrum, the other is a window of
/// it -- and a v1 reader meeting a `range_scope` it does not know would have to
/// guess whether the rows it is holding are all of them. They are not, so it is
/// told in the one field it is guaranteed to look at.
///
/// Version 2 is self-describing: it carries the resolved m/z bounds, the
/// complete source point count and the exported point count as **separate**
/// keys, so a reader can tell what was written from the file alone, with no
/// interface, no viewport and no session to ask.
pub(super) const SPECTRUM_DATA_CURRENT_SCHEMA_VERSION: u32 = 2;

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
    Png,
    Csv,
    Tsv,
}

impl SpectrumExportFormat {
    /// The stable identifier this format is named by across the boundary.
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
    /// The figure formats are the ones the size and theme settings apply to,
    /// and the ones a raster budget or a missing font can refuse. The data
    /// formats are neither, which is what keeps a figure setting from reaching
    /// a data file.
    pub(super) const fn is_figure(self) -> bool {
        matches!(self, Self::Svg | Self::Png)
    }

    /// Reads one format the webview asked for, refusing anything else.
    ///
    /// Closed rather than parsed loosely: the webview names one of three
    /// documents this boundary knows how to write, and an unrecognised name is
    /// a request MSCanvas has no answer for rather than one to guess at.
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
                title: "Export spectrum figure",
                filter_label: "SVG figure (*.svg)",
                filter_pattern: "*.svg",
                default_extension: "svg",
            },
            Self::Png => SaveDialogFacts {
                title: "Export spectrum figure",
                filter_label: "PNG image (*.png)",
                filter_pattern: "*.png",
                default_extension: "png",
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
            Self::Svg | Self::Png => None,
            Self::Csv => Some(','),
            Self::Tsv => Some('\t'),
        }
    }

    /// The name the save dialog offers first.
    ///
    /// Built from the spectrum's index, the scope and nothing else. No part of
    /// the source path, the workspace handle or the dataset's display name
    /// reaches a file name this boundary proposes -- and **no m/z number does
    /// either**. A range in a file name would be a float rendered into a path,
    /// which is a naming rule this repository does not have and a reader cannot
    /// rely on; the exact bounds live in the document, where a reader can read
    /// them.
    ///
    /// The full-source name is unchanged, because the document it names is
    /// unchanged.
    pub(super) fn suggested_file_name(self, index: u64, scope: SpectrumRangeScope) -> String {
        match scope {
            SpectrumRangeScope::Full => format!("mscanvas-spectrum-{index}.{}", self.stable_id()),
            SpectrumRangeScope::Current => {
                format!("mscanvas-spectrum-{index}-current.{}", self.stable_id())
            }
        }
    }
}

/// How much of one retained spectrum an export covers.
///
/// Deliberately **not** `chromatogram::RangeScope`. The two enumerations spell
/// the same two words about two different axes, and a single type shared
/// between them would make passing a retention-time decision to an m/z export a
/// plain value -- which is exactly the substitution `MzDomain` exists to
/// prevent on the other side of the boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SpectrumRangeScope {
    /// Every observation the retained spectrum holds.
    ///
    /// Needs no viewport domain, which is the property that keeps CSV and TSV
    /// writing for a spectrum the figure contract refuses to draw.
    Full,
    /// The m/z window the viewport has committed to.
    Current,
}

impl SpectrumRangeScope {
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
///
/// A request and never an authority. The numbers in it are the viewport's
/// committed window as the interface believes it to be; whether the retained
/// spectrum actually has that window is settled by
/// [`SpectrumSnapshot::resolve`], against the source rather than against this.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct SpectrumRangeRequest {
    scope: SpectrumRangeScope,
    /// The committed m/z window, for a current-range request that has one.
    ///
    /// `None` is not a missing answer. It is the viewport saying it has
    /// committed no narrower window, so the current range *is* the whole
    /// admitted domain -- a real state, resolved from the snapshot rather than
    /// filled in here with a subrange invented to look different from `Full`.
    domain: Option<Domain>,
}

impl SpectrumRangeRequest {
    /// Reads one range request, refusing anything that is not one.
    ///
    /// Two numbers become a `Domain` here, which is what refuses a non-finite
    /// or an inverted pair before any snapshot is consulted. Whether the
    /// *source* has that window is a different question, answered at
    /// [`SpectrumSnapshot::resolve`] where the source is known.
    ///
    /// A half-present pair is refused rather than repaired. `low` with no
    /// `high` is not a window, and choosing one for it would be inventing the
    /// range the caller failed to state.
    pub(super) fn from_wire(scope: &str, low: Option<f64>, high: Option<f64>) -> Option<Self> {
        let scope = SpectrumRangeScope::from_wire(scope)?;
        let domain = match (scope, low, high) {
            // A full-source export needs no window and is not given one.
            // Sending one with it is a contradiction rather than extra
            // information, so it is refused instead of ignored -- ignoring it
            // would export something other than what the caller described.
            (SpectrumRangeScope::Full, None, None) => None,
            (SpectrumRangeScope::Full, _, _) => return None,
            (SpectrumRangeScope::Current, None, None) => None,
            (SpectrumRangeScope::Current, Some(low), Some(high)) => {
                Some(Domain::new(low, high).ok()?)
            }
            (SpectrumRangeScope::Current, _, _) => return None,
        };
        Some(Self { scope, domain })
    }
}

/// The range one export was actually taken over.
///
/// Closed, and the two variants carry different things because they *are*
/// different things. `Full` has no bounds to carry: it is the whole retained
/// source, and it resolves for a spectrum that has no domain at all. `Current`
/// always carries the exact interval Rust agreed to, so every document, file
/// name and confirmation downstream describes one resolved fact rather than
/// re-deriving it from a viewport that may have moved since.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum ResolvedSpectrumRange {
    Full,
    Current(Domain),
}

impl ResolvedSpectrumRange {
    pub(super) const fn scope(self) -> SpectrumRangeScope {
        match self {
            Self::Full => SpectrumRangeScope::Full,
            Self::Current(_) => SpectrumRangeScope::Current,
        }
    }

    /// The interval this export covers, where it is a window.
    pub(super) const fn domain(self) -> Option<Domain> {
        match self {
            Self::Full => None,
            Self::Current(domain) => Some(domain),
        }
    }
}

/// Why a spectrum range could not be exported over.
///
/// Kept apart from the projection's refusals even where the words would be
/// similar: a drawing that cannot be produced and a document that cannot be
/// written are different answers to a reader, and one of them is about a file
/// they were about to be asked where to save.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SpectrumRangeRefusal {
    /// The window reaches outside the retained source's own m/z domain.
    ///
    /// Refused rather than clamped. A request for a window this spectrum does
    /// not have is a request about something else, and quietly exporting the
    /// nearest one that does fit would answer a question nobody asked -- in a
    /// file that would look like the answer to the one they did.
    OutsideSource,
    /// A current range was asked for on a spectrum that has no viewport domain.
    ///
    /// The ordinary interface never offers `Current` for such a spectrum, so
    /// this is a forged or a stale request. It is refused with its own reason
    /// rather than answered with the full source, because a full-source export
    /// labelled as a current range would be a file that misstates itself. The
    /// contract's own verdict is carried so a reader is told *which* question
    /// failed rather than only that one did.
    NoViewportDomain(projection::DomainRefusal),
}

/// Why a viewport could not be given a drawing.
///
/// Two layers, kept apart because they are answered by different owners and
/// mean different things to a reader. `Stale` is this session's lifecycle
/// saying the spectrum that was asked about is not the one it holds any more --
/// select it again. `Source` is the scientific contract's own verdict about the
/// spectrum and the window, which selecting again would not change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SpectrumProjectionRefusal {
    /// The named spectrum is not what this session retains.
    Stale,
    /// The spectrum or the window itself was refused.
    Source(ProjectionRefusal),
}

/// One session-scoped name for one retained spectrum.
///
/// Opaque on purpose. It is a counter, it names nothing outside this session,
/// and it is meaningless to anything that did not receive it from this slot --
/// so a webview holding one has been told which spectrum this session retains
/// and nothing whatever about where that spectrum came from.
///
/// **One identity, two readers.** The scientific export lane resolves it to
/// write a file, and the viewport resolves it to project a window of the same
/// retained spectrum onto a screen. Both are readings of one snapshot rather
/// than two sources, which is why this is named for what it identifies instead
/// of for the first thing that consumed it. The wire field is still
/// `exportToken`: renaming it would churn every command that already carries
/// one without making anything truer, and what it names has not changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct RetainedSpectrumToken(u64);

impl RetainedSpectrumToken {
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
#[derive(Debug, Clone, PartialEq)]
pub(super) struct SpectrumSnapshot {
    token: RetainedSpectrumToken,
    /// Which dataset this spectrum was read from.
    ///
    /// The minimum needed to answer one question: when rows are removed, is
    /// this one of them. A `DatasetId` is a number this session allocated and
    /// only Rust can turn into a path, so carrying it here adds no way to learn
    /// where the file is -- and it is never serialized, never sent to the
    /// webview, and never written down.
    owner: DatasetId,
    spectrum: Arc<SelectedSpectrumResult>,
    /// Whether this spectrum is drawable, settled once when it was retained.
    ///
    /// Drawability is a property of the source rather than of any one request
    /// about it, and this source is immutable behind the `Arc` beside it -- so
    /// the verdict is established at installation and carried, rather than
    /// re-established by every reader. It cannot go stale independently: it
    /// lives and dies with the exact snapshot it describes, and a replaced or
    /// revoked spectrum takes its verdict with it. There is no second
    /// invalidation lifecycle because there is no second thing to invalidate.
    ///
    /// `Copy`, and small: two intervals or a refusal. Nothing about a *window*
    /// is cached here -- a viewport still draws from the complete source every
    /// time, so zooming in still reveals observations an overview had to drop.
    viewport_domain: ViewportDomain,
}

impl SpectrumSnapshot {
    pub(super) const fn token(&self) -> RetainedSpectrumToken {
        self.token
    }

    pub(super) fn spectrum(&self) -> &SelectedSpectrumResult {
        &self.spectrum
    }

    /// The drawability verdict settled when this spectrum was retained.
    pub(super) const fn viewport_domain(&self) -> ViewportDomain {
        self.viewport_domain
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

    /// Agrees a requested range with what this retained spectrum actually has.
    ///
    /// **The one range resolver for a selected-spectrum export.** Every format
    /// -- both figures, both data documents and the clipboard -- reaches its
    /// range through here, so there is no second place a window could be agreed
    /// to differently.
    ///
    /// The authority is this snapshot: the complete arrays Rust retained and
    /// the [`ViewportDomain`] settled when they were retained. Never the
    /// transferred prefix, never the backend's separately reported
    /// `mz_low`/`mz_high` pair, and never a screen projection -- a projection is
    /// a drawing, and this module never sees one.
    ///
    /// `Full` resolves without consulting the domain at all. That is not an
    /// oversight to be tidied away: a data document is one record per retained
    /// source point in source order and needs no ordering to write, which is
    /// what keeps CSV and TSV available for a spectrum whose figure contract
    /// refuses it a viewport.
    ///
    /// # Errors
    ///
    /// Refuses a window outside the source's own domain -- rather than clamping
    /// it -- and refuses a current range asked of a spectrum that has no domain.
    pub(super) fn resolve(
        &self,
        request: SpectrumRangeRequest,
    ) -> Result<ResolvedSpectrumRange, SpectrumRangeRefusal> {
        let window = match request.scope {
            SpectrumRangeScope::Full => return Ok(ResolvedSpectrumRange::Full),
            SpectrumRangeScope::Current => request.domain,
        };
        // Answered from the verdict this snapshot has carried since it was
        // retained. Re-reading the arrays could not produce a different answer:
        // the source is immutable behind its `Arc`, so the same spectrum always
        // gets the same verdict.
        let source = match self.viewport_domain {
            ViewportDomain::Admitted(domain) => domain,
            ViewportDomain::Refused(refusal) => {
                return Err(SpectrumRangeRefusal::NoViewportDomain(refusal));
            }
        };
        let Some(window) = window else {
            // Nothing narrower is committed, so the current range is the whole
            // authoritative admitted domain. Resolved from the snapshot rather
            // than fabricated as a subrange to make `Current` look unlike
            // `Full`, and it stays a current-range export because that is what
            // was chosen and what the document will say.
            return Ok(ResolvedSpectrumRange::Current(source));
        };
        if window.low() < source.low() || window.high() > source.high() {
            return Err(SpectrumRangeRefusal::OutsideSource);
        }
        Ok(ResolvedSpectrumRange::Current(window))
    }
}

/// Which chromatogram one export writes.
///
/// The same shape as a spectrum snapshot and for the same reasons: the science
/// is held by handle rather than copied, the owner is the minimum needed to
/// answer "was this dataset removed", and the token is a counter that names
/// nothing outside this session.
#[derive(Debug, Clone)]
pub(super) struct ChromatogramSnapshot {
    token: ChromatogramExportToken,
    owner: DatasetId,
    source: ChromatogramSource,
}

impl ChromatogramSnapshot {
    pub(super) const fn token(&self) -> ChromatogramExportToken {
        self.token
    }

    pub(super) const fn source(&self) -> &ChromatogramSource {
        &self.source
    }

    pub(super) const fn owner(&self) -> DatasetId {
        self.owner
    }
}

/// Which preview open owns the right to name the session's chromatogram.
///
/// **Not a dataset, not a request epoch, not a backend generation and not a
/// path.** The per-dataset request epoch answers "may these facts commit for
/// *this* dataset", and two opens of two different datasets are each current by
/// it at the same time -- correctly, because they are answers to different
/// questions. There is only ever one chromatogram a webview is looking at, so
/// installing one has to be decided by a single order across every open, and
/// that order is this.
///
/// It is session-scoped, monotonic, and never crosses to the webview. The
/// frontend keeps its own counter for discarding stale replies; the two
/// independently encode the same latest-open-wins semantic at their own
/// boundary, and neither gets to tell the other which completion is current.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PreviewOpenTicket(u64);

/// One session-scoped name for one retained chromatogram.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ChromatogramExportToken(u64);

impl ChromatogramExportToken {
    pub(super) fn as_wire(self) -> String {
        self.0.to_string()
    }

    fn from_wire(value: &str) -> Option<Self> {
        value.parse::<u64>().ok().map(Self)
    }
}

/// What a claimed chromatogram reservation hands to the code that writes it.
#[derive(Debug, Clone)]
pub struct ClaimedChromatogramExport {
    pub(super) snapshot: ChromatogramSnapshot,
    pub(super) format: ChromatogramExportFormat,
    pub(super) range: ResolvedRange,
    pub(super) traces: TraceSet,
    /// How to draw it, for the formats that are drawn.
    ///
    /// `None` for a data document, and that absence is the point rather than a
    /// convenience. A CSV is the same list of numbers whatever size a figure
    /// would have been, so a reservation for one that carried a width would be
    /// carrying an answer to a question nobody asked -- and the moment it is
    /// there, something can read it. The same shape `dpi` already has below,
    /// for the same reason: only the output that has a resolution holds one.
    pub(super) settings: Option<FigureRenderSettings>,
    pub(super) dpi: Option<PngDpi>,
}

impl ClaimedChromatogramExport {
    /// How this export is drawn.
    ///
    /// Only a figure has an answer, and every caller is already inside a branch
    /// that decided this is one -- the same contract [`Self::dpi`] has for a
    /// PNG. A data document never reaches here, because nothing about how a
    /// figure would have looked reaches a list of numbers.
    pub(super) fn figure_settings(&self) -> FigureRenderSettings {
        self.settings
            .expect("a figure export reserved the settings it is drawn at")
    }

    /// How this export's save dialog presents itself.
    #[must_use]
    pub const fn dialog(&self) -> SaveDialogFacts {
        self.format.dialog()
    }

    /// The name that dialog offers first.
    #[must_use]
    pub fn suggested_file_name(&self) -> String {
        self.format.suggested_file_name(self.range.scope())
    }
}

/// What a claimed linked reservation hands to the code that writes it.
///
/// **Both snapshots, taken together.** The pair is what this export is about, so
/// it is bound once at BEGIN and never rebound: the user may select another scan
/// or open another run while the save dialog is open, and what is written is
/// still the figure they asked for.
///
/// `selected_retention_time` is the retained table row's own number, carried
/// here so the writer cannot go looking for it again in a source that has since
/// moved on. `selected_index` is the same spectrum index the caption names.
#[derive(Debug, Clone)]
pub struct ClaimedLinkedFigureExport {
    pub(super) chromatogram: ChromatogramSnapshot,
    pub(super) spectrum: SpectrumSnapshot,
    pub(super) selected_index: u64,
    pub(super) selected_retention_time: f64,
    pub(super) format: LinkedFigureFormat,
    pub(super) range: ResolvedRange,
    pub(super) traces: TraceSet,
    pub(super) settings: FigureRenderSettings,
    pub(super) dpi: Option<PngDpi>,
}

impl ClaimedLinkedFigureExport {
    /// How this export's save dialog presents itself.
    #[must_use]
    pub const fn dialog(&self) -> SaveDialogFacts {
        self.format.dialog()
    }

    /// The name that dialog offers first.
    #[must_use]
    pub fn suggested_file_name(&self) -> String {
        self.format
            .suggested_file_name(self.selected_index, self.range.scope())
    }
}

/// The two retained sources one linked operation names.
///
/// One value rather than two loose strings, because the pair is what a linked
/// figure is about. These are never read apart -- the operation below takes both
/// or neither -- and a signature carrying them separately is a signature that
/// reads as though either could be supplied on its own.
#[derive(Debug, Clone, Copy)]
pub(super) struct LinkedTokens<'a> {
    pub(super) chromatogram: &'a str,
    pub(super) spectrum: &'a str,
}

/// The one place a [`LinkedPair`] can come into existence.
///
/// A module rather than a convention. The fields below are private to it, so the
/// only way to make a pair -- anywhere in this file, and a fortiori in any
/// sibling module of `preview` -- is [`LinkedPair::new`], which is visible to
/// `export` alone. What no compiler can say is *which* function inside `export`
/// may call it, and that is the one fact `check_repo.py` pins.
///
/// The alternative was a rule that read braces. It could not tell a construction
/// from `let LinkedPair { .. } = pair` or from an `impl LinkedPair` block, so it
/// failed on correct code while a constructor spelled another way walked past
/// it. A type cannot be talked around.
mod linked_pair {
    use super::{ChromatogramSnapshot, ResolvedRange, SpectrumSnapshot};

    /// Two snapshots proved to describe one scan, and the range they will be
    /// drawn over.
    ///
    /// Not a retained identity. This is what one linked operation decided at the
    /// moment it began, and it lives only as long as that operation does --
    /// which is why there is no third token beside the chromatogram's and the
    /// spectrum's.
    #[derive(Debug, Clone)]
    pub(in crate::preview) struct LinkedPair {
        chromatogram: ChromatogramSnapshot,
        spectrum: SpectrumSnapshot,
        selected_index: u64,
        selected_retention_time: f64,
        range: ResolvedRange,
    }

    impl LinkedPair {
        /// Builds one pair.
        ///
        /// Visible to `export` and to nothing else, so a sibling module cannot
        /// assemble two snapshots it read separately into something that claims
        /// they were read together. Which function inside `export` may call this
        /// is pinned by `check_repo.py`: exactly the one operation that proves
        /// the two sources are one scan.
        pub(super) const fn new(
            chromatogram: ChromatogramSnapshot,
            spectrum: SpectrumSnapshot,
            selected_index: u64,
            selected_retention_time: f64,
            range: ResolvedRange,
        ) -> Self {
            Self {
                chromatogram,
                spectrum,
                selected_index,
                selected_retention_time,
                range,
            }
        }

        pub(in crate::preview) const fn chromatogram(&self) -> &ChromatogramSnapshot {
            &self.chromatogram
        }

        pub(in crate::preview) const fn spectrum(&self) -> &SpectrumSnapshot {
            &self.spectrum
        }

        pub(in crate::preview) const fn selected_index(&self) -> u64 {
            self.selected_index
        }

        pub(in crate::preview) const fn selected_retention_time(&self) -> f64 {
            self.selected_retention_time
        }

        pub(in crate::preview) const fn range(&self) -> ResolvedRange {
            self.range
        }

        /// Takes the pair apart, for the reservation that carries it onward.
        ///
        /// Consuming rather than copying: what comes out is no longer a pair,
        /// so nothing downstream can be mistaken for one. Putting it back
        /// together is [`Self::new`], which is where the proof lives.
        pub(super) fn into_parts(
            self,
        ) -> (
            ChromatogramSnapshot,
            SpectrumSnapshot,
            u64,
            f64,
            ResolvedRange,
        ) {
            (
                self.chromatogram,
                self.spectrum,
                self.selected_index,
                self.selected_retention_time,
                self.range,
            )
        }
    }
}

pub(super) use linked_pair::LinkedPair;

/// One export that has been claimed, whichever source it is of.
///
/// The lane below holds one of these at a time, which is the whole point: two
/// scientific exports cannot be in flight because there is one place for the
/// claim to live. A linked figure is a third *surface* and not a third lane --
/// it draws two of the sources at once, and while it is being written neither
/// of them may start an export of its own.
#[derive(Debug, Clone)]
pub enum ClaimedExport {
    Spectrum(ClaimedSpectrumExport),
    Chromatogram(ClaimedChromatogramExport),
    LinkedFigure(ClaimedLinkedFigureExport),
}

/// Where every scientific export of this session is.
///
/// **One lane, two sources.** A selected spectrum and a chromatogram are
/// separately visible surfaces with separately retained science, and each keeps
/// its own snapshot -- but there is exactly one answer to "may another
/// scientific export begin now", and it lives here rather than in a disabled
/// button. Two native save dialogs for one window is not a state this
/// application can be in, and a clipboard rasterization racing a file write is
/// two claims on the same memory that nothing on screen would explain.
///
/// It holds no path at any point.
#[derive(Debug)]
pub(super) struct ScientificExportSlots {
    /// One counter for both kinds. A token is an identity rather than an index,
    /// so nothing needs them to be dense per source -- and one sequence makes it
    /// impossible for a spectrum token and a chromatogram token to read the
    /// same, which is one fewer way for a stale one to be mistaken for a live
    /// one.
    next_token: u64,
    next_reservation: u64,
    /// The spectrum a new export may be started for.
    spectrum: Option<SpectrumSnapshot>,
    /// The chromatogram a new export may be started for.
    ///
    /// Installed only for a preview the visible viewer would draw. A truncated
    /// table has no chromatogram on screen, and Rust holding more rows than the
    /// webview received is not a reason to open an export door onto a
    /// capability the product does not otherwise have.
    chromatogram: Option<ChromatogramSnapshot>,
    /// The next preview open's ticket, and the one that has the chromatogram.
    ///
    /// Kept here rather than beside the workspace because this is the thing
    /// being ordered: the question is which completion may install a
    /// chromatogram, and the answer has to be read and acted on without letting
    /// go in between. A generation compared under one lock and installed under
    /// another is the same race with an extra step.
    next_preview_open: u64,
    latest_preview_open: PreviewOpenTicket,
    lane: ExportState,
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
        /// Everything this export writes, taken when the reservation was
        /// issued. Held here rather than read from the slots at claim time, so
        /// a selection, a preview, a viewport or a settings change that lands
        /// in between cannot move an export that has already been started onto
        /// different science.
        export: ClaimedExport,
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
    /// The range this export was resolved to **when it began**.
    ///
    /// Held here rather than re-read at write time, which is the whole point of
    /// resolving at BEGIN. By the time the writer runs the user has been in a
    /// modal dialog and may have zoomed, panned or reset the viewport twice
    /// over; what is written is the range they asked for, and what the outcome
    /// reports is that same range.
    pub(super) range: ResolvedSpectrumRange,
    pub(super) settings: FigureRenderSettings,
    pub(super) dpi: Option<PngDpi>,
}

impl ClaimedSpectrumExport {
    /// How this export's save dialog presents itself.
    #[must_use]
    pub const fn dialog(&self) -> SaveDialogFacts {
        self.format.dialog()
    }

    /// The name that dialog offers first.
    ///
    /// Built from the spectrum's index, the format and the scope, and from
    /// nothing that came out of a path. No m/z number reaches it.
    #[must_use]
    pub fn suggested_file_name(&self) -> String {
        self.format
            .suggested_file_name(self.snapshot.index(), self.range.scope())
    }
}

impl Default for ScientificExportSlots {
    fn default() -> Self {
        Self {
            // Both begin at one, so zero is never a live identifier.
            next_token: 1,
            next_reservation: 1,
            spectrum: None,
            chromatogram: None,
            // Tickets are issued from one, so the ticket nothing holds is zero
            // and no open can ever be mistaken for the session's initial state.
            next_preview_open: 1,
            latest_preview_open: PreviewOpenTicket(0),
            lane: ExportState::Idle,
        }
    }
}

impl ScientificExportSlots {
    fn issue_token(&mut self) -> u64 {
        let token = self.next_token;
        self.next_token = self
            .next_token
            .checked_add(1)
            .expect("a session retains fewer than u64::MAX exportable sources");
        token
    }

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
        let token = RetainedSpectrumToken(self.issue_token());
        // Settled here, once, while the complete reading is in hand. Every
        // later reader of this snapshot -- the panel's own domain answer and
        // every viewport projection over it -- takes this result rather than
        // walking the arrays again to reach it.
        let viewport_domain = projection::settle_viewport_domain(&spectrum);
        let snapshot = SpectrumSnapshot {
            token,
            owner,
            spectrum: Arc::new(spectrum),
            viewport_domain,
        };
        self.spectrum = Some(snapshot.clone());
        snapshot
    }

    /// Starts one preview open and hands back the ticket that names it.
    ///
    /// Two things happen here, and they are one decision. This open becomes the
    /// only one that may install a chromatogram, and the chromatogram the
    /// previous open installed stops being current **immediately** -- not when
    /// this one succeeds, because it may not succeed, and the preview it
    /// replaced is already off the screen either way. A newer open that fails
    /// leaves no chromatogram at all rather than resurrecting the old one, which
    /// is exactly what the webview does with the preview itself.
    ///
    /// An export already begun is untouched. It holds its own snapshot, taken
    /// when its reservation was issued, and moving the viewer is not a reason to
    /// cancel a file that is already being written.
    pub(super) fn begin_preview_open(&mut self) -> PreviewOpenTicket {
        let ticket = PreviewOpenTicket(self.next_preview_open);
        self.next_preview_open = self
            .next_preview_open
            .checked_add(1)
            .expect("a session opens fewer than u64::MAX previews");
        self.latest_preview_open = ticket;
        self.chromatogram = None;
        ticket
    }

    /// Installs, or revokes, the chromatogram one *completed* preview open owns.
    ///
    /// The ownership test and the installation are one critical section on
    /// purpose. Reading "am I still the latest open", letting go, and installing
    /// afterwards is the race this exists to close: a newer open can begin in
    /// that gap and the older completion would still win.
    ///
    /// Which is why there is no way to ask the question on its own. The slot
    /// answers "may this open install", never "is this open current", and the
    /// installer below is private -- so the two halves cannot be taken apart at
    /// a call site. Splitting them means adding to this type, where it is
    /// visible, rather than reordering two lines somewhere else.
    ///
    /// Three outcomes, and the difference between the last two is the whole
    /// point:
    ///
    /// - **stale** -- another open has begun since. Nothing is touched. An older
    ///   completion may not install, and may not revoke either: the chromatogram
    ///   it would be taking away belongs to the preview the user is looking at.
    /// - **current, with a source** -- it becomes the one a new export may name.
    /// - **current, with none** -- this run has no chromatogram on screen, so the
    ///   session has none. Install *or* revoke, never neither.
    pub(super) fn reconcile_preview_chromatogram(
        &mut self,
        ticket: PreviewOpenTicket,
        owner: DatasetId,
        source: Option<ChromatogramSource>,
    ) -> Option<ChromatogramSnapshot> {
        // Asked and acted on without letting go, which is the whole mechanism.
        // `&mut self` is the slot's lock: no other open can begin between this
        // comparison and the write below, so there is no window in which a
        // completion that read "I am current" installs after it stopped being.
        if ticket != self.latest_preview_open {
            return None;
        }
        match source {
            Some(source) => Some(self.install_chromatogram(owner, source)),
            None => {
                self.chromatogram = None;
                None
            }
        }
    }

    /// Retains one chromatogram as the one a new export may name.
    ///
    /// Takes the source already decided to be exportable rather than deciding
    /// here: whether a run is one the viewer would draw is a scientific
    /// question, and it is answered where the science is.
    ///
    /// Private, and that is load-bearing. Every production installation goes
    /// through [`Self::reconcile_preview_chromatogram`], so there is no path by
    /// which a completion can install without first proving it is the open the
    /// session is currently on -- the ordering rule cannot be forgotten at a
    /// call site because there are no call sites outside this file.
    fn install_chromatogram(
        &mut self,
        owner: DatasetId,
        source: ChromatogramSource,
    ) -> ChromatogramSnapshot {
        let token = ChromatogramExportToken(self.issue_token());
        let snapshot = ChromatogramSnapshot {
            token,
            owner,
            source,
        };
        self.chromatogram = Some(snapshot.clone());
        snapshot
    }

    /// Forgets the retained spectrum.
    ///
    /// Called wherever the panel stops naming it: the read failed, the spectrum
    /// was unavailable, a preview was opened over it, or the list was cleared.
    /// An export under way keeps its own handle and finishes; what this ends is
    /// the ability to start a *new* one against the old token.
    pub(super) fn forget(&mut self) {
        self.spectrum = None;
    }

    /// Forgets the retained chromatogram.
    pub(super) fn forget_chromatogram(&mut self) {
        self.chromatogram = None;
    }

    /// Which chromatogram the slot holds, if it holds one.
    ///
    /// Test-only. Every production reader names a token and is answered by
    /// [`Self::chromatogram_for`]; this exists so a test can say "and now there
    /// is none at all", which is a state no token could describe.
    #[cfg(test)]
    pub(super) fn current_chromatogram_token(&self) -> Option<ChromatogramExportToken> {
        self.chromatogram.as_ref().map(ChromatogramSnapshot::token)
    }

    /// Which spectrum the slot holds, if it holds one.
    ///
    /// Read before a spectrum read begins so the revocation afterwards can tell
    /// "the read I am revoking for is still the current one" from "something
    /// newer arrived while I was waiting".
    pub(super) fn current_token(&self) -> Option<RetainedSpectrumToken> {
        self.spectrum.as_ref().map(|snapshot| snapshot.token)
    }

    /// Forgets the retained spectrum only if it is still the one named here.
    ///
    /// Spectrum reads are not serialized against each other: two can be in
    /// flight, and the later one can reach the backend gate first, install its
    /// snapshot, and be the spectrum on screen by the time the earlier one comes
    /// back to say it failed. Revoking unconditionally there would take away the
    /// spectrum the user is actually looking at -- the panel keeps showing it,
    /// because the frontend discards the superseded answer, and only the export
    /// would fail, as stale, for a reason nothing on screen explains.
    ///
    /// Answers whether it dropped anything.
    pub(super) fn forget_if_current(&mut self, expected: Option<RetainedSpectrumToken>) -> bool {
        let Some(expected) = expected else {
            return false;
        };
        if self.current_token() != Some(expected) {
            return false;
        }
        self.spectrum = None;
        true
    }

    /// Forgets whatever these datasets own.
    ///
    /// Removing rows around the preview is not a reason to revoke what the user
    /// is reading -- the frontend keeps the preview open in exactly that case,
    /// and a slot that forgot anyway would refuse the next export of science
    /// still on screen. Answers whether it dropped anything.
    pub(super) fn forget_if_owned_by(&mut self, removed: &[DatasetId]) -> bool {
        let mut dropped = false;
        if self
            .spectrum
            .as_ref()
            .is_some_and(|snapshot| removed.contains(&snapshot.owner()))
        {
            self.spectrum = None;
            dropped = true;
        }
        if self
            .chromatogram
            .as_ref()
            .is_some_and(|snapshot| removed.contains(&snapshot.owner()))
        {
            self.chromatogram = None;
            dropped = true;
        }
        dropped
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
        self.spectrum
            .as_ref()
            .map(|snapshot| Arc::downgrade(&snapshot.spectrum))
    }

    /// Whether an export has reached something a second one must not disturb.
    ///
    /// A dialog the user is standing in front of, or bytes going to disk. An
    /// *unclaimed* reservation is neither: it is a document having asked and not
    /// yet followed through, and refusing on it is what would let one reload
    /// between the two commands wedge the slot for the rest of the session.
    ///
    /// Asked of the one lane, so the answer is the same whichever source is
    /// asking. A chromatogram export cannot begin while a spectrum's picker is
    /// open, and neither can the reverse.
    const fn is_committed(&self) -> bool {
        matches!(
            self.lane,
            ExportState::Writing | ExportState::AwaitingDestination { claimed: true, .. }
        )
    }

    /// Issues one reservation for one already-bound export.
    ///
    /// Refuses while an export is committed, and supersedes an unclaimed
    /// reservation rather than refusing on it. Two dialogs for one session stay
    /// impossible -- claiming is what opens one, and a superseded reservation
    /// can no longer be claimed -- while a document that reloaded after asking
    /// leaves nothing behind that a later export has to wait for.
    fn reserve(
        &mut self,
        export: ClaimedExport,
    ) -> Result<SpectrumReservationId, BeginExportRefusal> {
        if self.is_committed() {
            return Err(BeginExportRefusal::AlreadyExporting);
        }
        let reservation = SpectrumReservationId(self.next_reservation);
        self.next_reservation = self
            .next_reservation
            .checked_add(1)
            .expect("a session issues fewer than u64::MAX export reservations");
        self.lane = ExportState::AwaitingDestination {
            reservation,
            claimed: false,
            export,
        };
        Ok(reservation)
    }

    /// Reads back the retained spectrum this token names.
    ///
    /// The token is checked against the snapshot rather than trusted: a webview
    /// that has been holding one across a newer selection is naming science this
    /// session no longer has, and the honest answer is that it is gone rather
    /// than a file of whatever is current now.
    fn spectrum_for(&self, token: &str) -> Result<SpectrumSnapshot, BeginExportRefusal> {
        let requested = RetainedSpectrumToken::from_wire(token).ok_or(BeginExportRefusal::Stale)?;
        self.spectrum
            .as_ref()
            .filter(|snapshot| snapshot.token == requested)
            .ok_or(BeginExportRefusal::Stale)
            .cloned()
    }

    /// Hands back the retained spectrum this token names, for a viewport to draw.
    ///
    /// The viewport's reader of the same snapshot the export lane reads, and
    /// deliberately **not** a second source: it resolves the token the same way
    /// and refuses a stale one the same way.
    ///
    /// It hands back the snapshot rather than the drawing, and that is the whole
    /// point of its shape. A snapshot is an `Arc` handle -- cloning one is a
    /// refcount bump, never a copy of the arrays -- so the caller can let go of
    /// this lock and then do the projection's own work, which walks the complete
    /// spectrum. Reducing hundreds of thousands of points while holding the
    /// slot would stall every export operation for the length of a pan.
    ///
    /// It also does not touch the export lane. A projection is a drawing, so it
    /// neither reserves the lane nor waits for one that is busy: a reader may
    /// pan a spectrum while a file of it is being written.
    ///
    /// # Errors
    ///
    /// Refuses a token this session no longer holds.
    pub(super) fn retained_spectrum_for(
        &self,
        token: &str,
    ) -> Result<SpectrumSnapshot, SpectrumProjectionRefusal> {
        self.spectrum_for(token)
            .map_err(|_| SpectrumProjectionRefusal::Stale)
    }

    /// Reads back the retained chromatogram this token names.
    fn chromatogram_for(&self, token: &str) -> Result<ChromatogramSnapshot, BeginExportRefusal> {
        let requested =
            ChromatogramExportToken::from_wire(token).ok_or(BeginExportRefusal::Stale)?;
        self.chromatogram
            .as_ref()
            .filter(|snapshot| snapshot.token == requested)
            .ok_or(BeginExportRefusal::Stale)
            .cloned()
    }

    /// Binds one selected-spectrum export and reserves the lane for it.
    ///
    /// Asked in this order deliberately. "Already exporting" means wait; "no
    /// longer loaded" means select the spectrum again -- and a stale token
    /// answered with the first would send someone to wait for an export whose
    /// finishing cannot help them.
    ///
    /// The range is resolved here, against the snapshot the token named, and
    /// the resolved range is what the export carries from this moment on. A
    /// viewport that moves while the picker is open changes nothing about a file
    /// already being written.
    pub(super) fn begin(
        &mut self,
        token: &str,
        format: SpectrumExportFormat,
        request: SpectrumRangeRequest,
        settings: FigureRenderSettings,
        dpi: Option<PngDpi>,
    ) -> Result<SpectrumReservationId, BeginExportRefusal> {
        let snapshot = self.spectrum_for(token)?;
        let range = snapshot
            .resolve(request)
            .map_err(BeginExportRefusal::from)?;
        self.reserve(ClaimedExport::Spectrum(ClaimedSpectrumExport {
            snapshot,
            format,
            range,
            settings,
            dpi,
        }))
    }

    /// Binds one chromatogram export and reserves the lane for it.
    ///
    /// The range is resolved here, against the snapshot the token named, and
    /// the resolved range is what the export carries from this moment on. A
    /// viewport that moves while the picker is open changes nothing about a file
    /// already being written.
    pub(super) fn begin_chromatogram(
        &mut self,
        token: &str,
        format: ChromatogramExportFormat,
        request: RangeRequest,
        traces: TraceSet,
        settings: Option<FigureRenderSettings>,
        dpi: Option<PngDpi>,
    ) -> Result<SpectrumReservationId, BeginExportRefusal> {
        let snapshot = self.chromatogram_for(token)?;
        let range = snapshot
            .source()
            .resolve(request)
            .map_err(|refusal| match refusal {
                RangeRefusal::OutsideSource => BeginExportRefusal::RangeOutsideSource,
            })?;
        // A figure of no series is not a figure of nothing, and the contract
        // refuses one. Answered here rather than at the renderer so the refusal
        // names what the user can change.
        if format.is_figure() && !traces.any() {
            return Err(BeginExportRefusal::NoVisibleTrace);
        }
        self.reserve(ClaimedExport::Chromatogram(ClaimedChromatogramExport {
            snapshot,
            format,
            range,
            traces,
            settings,
            dpi,
        }))
    }

    /// Binds one linked two-panel figure and reserves the one scientific lane.
    ///
    /// **One acquisition, one moment.** Everything this figure is about is
    /// decided here, while the slot is held: which chromatogram, which spectrum,
    /// that they are the same scan, which range, whether the scan is inside it,
    /// which traces were on screen and how it is to be drawn. Reading one token,
    /// letting go, and reading the other would let the pair describe two
    /// different instants -- the very thing a linked figure claims it does not.
    ///
    /// The order below is the order the refusals should reach a reader in: what
    /// this session no longer holds, then what does not go together, then what
    /// cannot be drawn.
    ///
    /// # Errors
    ///
    /// Refuses a stale token, a pair that is not one scan, a selected scan
    /// outside the requested range, a figure with no visible trace, a figure too
    /// short for two panels, and a lane that is already busy.
    pub(super) fn begin_linked_figure(
        &mut self,
        tokens: LinkedTokens<'_>,
        format: LinkedFigureFormat,
        request: RangeRequest,
        traces: TraceSet,
        settings: FigureRenderSettings,
        dpi: Option<PngDpi>,
    ) -> Result<SpectrumReservationId, BeginExportRefusal> {
        let (chromatogram, spectrum, selected_index, selected_retention_time, range) = self
            .linked_pair(tokens, request, traces, settings)?
            .into_parts();
        self.reserve(ClaimedExport::LinkedFigure(ClaimedLinkedFigureExport {
            chromatogram,
            spectrum,
            selected_index,
            selected_retention_time,
            format,
            range,
            traces,
            settings,
            dpi,
        }))
    }

    /// Binds one linked figure and commits the lane straight to writing.
    ///
    /// A copy has no destination to choose, so there is nothing to come back
    /// from and no reservation to claim. Everything the pair is about is decided
    /// by the same operation a save uses, so the two cannot come to disagree
    /// about what a linked figure is.
    ///
    /// # Errors
    ///
    /// The same refusals [`Self::begin_linked_figure`] answers with.
    pub(super) fn begin_linked_figure_copy(
        &mut self,
        tokens: LinkedTokens<'_>,
        request: RangeRequest,
        traces: TraceSet,
        settings: FigureRenderSettings,
    ) -> Result<LinkedPair, BeginExportRefusal> {
        let pair = self.linked_pair(tokens, request, traces, settings)?;
        if self.is_committed() {
            return Err(BeginExportRefusal::AlreadyExporting);
        }
        self.lane = ExportState::Writing;
        Ok(pair)
    }

    /// Everything a linked figure is about, decided in one acquisition.
    ///
    /// **One moment, both sources.** Reading one token, letting go, and reading
    /// the other would let the pair describe two different instants -- the very
    /// thing a linked figure claims it does not.
    ///
    /// What makes that impossible is the shape rather than a convention. Both
    /// callers below hold `&mut self` for the whole of their own operation, and
    /// the two readers this uses -- [`Self::chromatogram_for`] and
    /// [`Self::spectrum_for`] -- are private to this file, so no code outside it
    /// can read one of the two and then read the other under a second
    /// acquisition of the slot. Splitting the pair means adding to this type,
    /// where it is visible, rather than reordering two lines somewhere else.
    ///
    /// The order is the order the refusals should reach a reader in: what this
    /// session no longer holds, then what does not go together, then what cannot
    /// be drawn.
    fn linked_pair(
        &self,
        tokens: LinkedTokens<'_>,
        request: RangeRequest,
        traces: TraceSet,
        settings: FigureRenderSettings,
    ) -> Result<LinkedPair, BeginExportRefusal> {
        let chromatogram = self.chromatogram_for(tokens.chromatogram)?;
        let spectrum = self.spectrum_for(tokens.spectrum)?;

        // Same dataset first, because two snapshots of different files cannot be
        // one scan however well their indices line up.
        if chromatogram.owner() != spectrum.owner() {
            return Err(BeginExportRefusal::LinkedSourceMismatch);
        }
        // Then the exact row, reconciled by identity. Retention time is not an
        // identity: scans may share one.
        let row = chromatogram
            .source()
            .row_for_spectrum(spectrum.spectrum())
            .ok_or(BeginExportRefusal::LinkedSourceMismatch)?;
        let selected_retention_time = row.retention_time();
        let selected_index = spectrum.spectrum().identity().index();

        let range = chromatogram
            .source()
            .resolve(request)
            .map_err(|refusal| match refusal {
                RangeRefusal::OutsideSource => BeginExportRefusal::RangeOutsideSource,
            })?;
        // The link has to be visible in the figure that claims to make it. A
        // marker outside the drawn range would be a linked figure with nothing
        // linked, and widening the range to fit would export something other
        // than what was asked for. Edges count as inside.
        if selected_retention_time < range.domain().low()
            || selected_retention_time > range.domain().high()
        {
            return Err(BeginExportRefusal::SelectedScanOutsideRange);
        }
        if !traces.any() {
            return Err(BeginExportRefusal::NoVisibleTrace);
        }
        // Two panels need more height than one, and the contract knows how much.
        // Asked here so a figure that could not be built never opens a dialog.
        if !fits_two_panels(settings) {
            return Err(BeginExportRefusal::FigureTooShort);
        }

        Ok(LinkedPair::new(
            chromatogram,
            spectrum,
            selected_index,
            selected_retention_time,
            range,
        ))
    }

    /// Claims one issued reservation, so its save dialog may be shown.
    ///
    /// Claiming once is the rule. A second claim of the same reservation is a
    /// second dialog for one export, and answering it would leave two windows
    /// able to publish the same file.
    ///
    /// **The surface is checked before the claim is committed**, and that order
    /// is the whole of this function. Each save command names its own kind, and
    /// a reservation of the other one is not its to open a dialog for -- but
    /// marking the lane claimed on the way to refusing it would leave the lane
    /// committed with no dialog, no writer and nothing to cancel it. Every later
    /// scientific export of the session would then be refused as "already
    /// exporting", for a reason nothing on screen could explain, until the
    /// application was restarted.
    ///
    /// The two kinds share one reservation counter, so a chromatogram's
    /// reservation is a perfectly well-formed spectrum reservation: a document
    /// that reloaded and replayed a stored identifier reaches exactly this.
    fn claim_matching<Claimed>(
        &mut self,
        reservation: &str,
        of_this_kind: impl FnOnce(&ClaimedExport) -> Option<Claimed>,
    ) -> Option<Claimed> {
        let requested = SpectrumReservationId::from_wire(reservation)?;
        let ExportState::AwaitingDestination {
            reservation: held,
            claimed,
            export,
        } = &mut self.lane
        else {
            return None;
        };
        if *held != requested || *claimed {
            return None;
        }
        let picked = of_this_kind(export)?;
        *claimed = true;
        Some(picked)
    }

    /// Claims one issued reservation as a selected-spectrum export.
    pub(super) fn claim_spectrum(&mut self, reservation: &str) -> Option<ClaimedSpectrumExport> {
        self.claim_matching(reservation, |export| match export {
            ClaimedExport::Spectrum(claimed) => Some(claimed.clone()),
            ClaimedExport::Chromatogram(_) | ClaimedExport::LinkedFigure(_) => None,
        })
    }

    /// Claims one issued reservation as a chromatogram export.
    pub(super) fn claim_chromatogram(
        &mut self,
        reservation: &str,
    ) -> Option<ClaimedChromatogramExport> {
        self.claim_matching(reservation, |export| match export {
            ClaimedExport::Chromatogram(claimed) => Some(claimed.clone()),
            ClaimedExport::Spectrum(_) | ClaimedExport::LinkedFigure(_) => None,
        })
    }

    /// Claims one issued reservation as a linked two-panel figure export.
    ///
    /// Its own claim, for the reason the other two have theirs: each save
    /// command names the kind it is for, and the kind is checked *before* the
    /// lane is marked claimed. A linked reservation handed to the chromatogram's
    /// save command is refused and stays claimable by its own.
    pub(super) fn claim_linked_figure(
        &mut self,
        reservation: &str,
    ) -> Option<ClaimedLinkedFigureExport> {
        self.claim_matching(reservation, |export| match export {
            ClaimedExport::LinkedFigure(claimed) => Some(claimed.clone()),
            ClaimedExport::Spectrum(_) | ClaimedExport::Chromatogram(_) => None,
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
        } = &self.lane
        else {
            return false;
        };
        if *held != requested {
            return false;
        }
        self.lane = ExportState::Idle;
        true
    }

    /// Moves a claimed export from choosing a destination to writing one.
    pub(super) fn begin_write(&mut self) {
        self.lane = ExportState::Writing;
    }

    /// Claims the one lane for an operation with no dialog.
    ///
    /// Copy plot renders the same figure a PNG export would and puts it on the
    /// clipboard, so it belongs in the same lane: two of these at once are two
    /// rasterizations competing for memory, and one of them would win the
    /// clipboard for reasons the user cannot see. It needs no reservation
    /// because there is no destination to choose and nothing to come back from
    /// -- it commits immediately, which is also what makes it uninterruptible
    /// by a second operation.
    pub(super) fn begin_copy(
        &mut self,
        token: &str,
        request: SpectrumRangeRequest,
    ) -> Result<(SpectrumSnapshot, ResolvedSpectrumRange), BeginExportRefusal> {
        let snapshot = self.spectrum_for(token)?;
        // Resolved before the lane is taken, for the reason every refusal
        // ordering here follows: a copy that could not have been drawn should
        // not first make every other scientific action unavailable.
        let range = snapshot
            .resolve(request)
            .map_err(BeginExportRefusal::from)?;
        if self.is_committed() {
            return Err(BeginExportRefusal::AlreadyExporting);
        }
        self.lane = ExportState::Writing;
        Ok((snapshot, range))
    }

    /// Claims the one lane for a chromatogram clipboard operation.
    pub(super) fn begin_chromatogram_copy(
        &mut self,
        token: &str,
        request: RangeRequest,
        traces: TraceSet,
    ) -> Result<(ChromatogramSnapshot, ResolvedRange), BeginExportRefusal> {
        let snapshot = self.chromatogram_for(token)?;
        let range = snapshot
            .source()
            .resolve(request)
            .map_err(|refusal| match refusal {
                RangeRefusal::OutsideSource => BeginExportRefusal::RangeOutsideSource,
            })?;
        if !traces.any() {
            return Err(BeginExportRefusal::NoVisibleTrace);
        }
        if self.is_committed() {
            return Err(BeginExportRefusal::AlreadyExporting);
        }
        self.lane = ExportState::Writing;
        Ok((snapshot, range))
    }

    /// Ends this write, however it went.
    ///
    /// Only a write. A successful export has already returned the lane to idle
    /// by the time the guard falls, and another export may have reserved it in
    /// between -- clearing that would refuse a file somebody else is in the
    /// middle of choosing.
    pub(super) fn release_write(&mut self) -> bool {
        if matches!(self.lane, ExportState::Writing) {
            self.lane = ExportState::Idle;
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
    /// The named science is not what this session holds.
    Stale,
    /// The requested range reaches outside the run it was asked of.
    ///
    /// Not clamped to the nearest range that does fit. A request for a window
    /// this source does not have is a request about something else, and quietly
    /// exporting the nearest thing would answer a question nobody asked.
    ///
    /// Raised on both axes, and each surface says it in its own words: a
    /// retention-time refusal and an m/z refusal are the same *shape* of
    /// mistake and are not the same sentence to the person reading it.
    RangeOutsideSource,
    /// A current range was asked of a spectrum that has no viewport domain.
    ///
    /// The interface does not offer `Current` for such a spectrum, so reaching
    /// here means a forged or a stale request -- and the answer is a refusal
    /// rather than the full source, because a complete export labelled as a
    /// current range is a file that misstates itself. Nothing is sorted, and
    /// neither the reported `mz_low`/`mz_high` pair nor a first/last or
    /// min/max of the array is used to manufacture the range the contract
    /// declined to establish.
    ///
    /// Only a spectrum can raise this. A chromatogram's range authority is its
    /// retained retention-time domain, which every eligible run has.
    NoViewportDomain,
    /// A figure was asked for with no measured trace visible.
    ///
    /// A panel of no series is refused by the contract, and rightly: a blank
    /// plotting area cannot be told from a renderer that failed. The data
    /// export beside it stays available, because hiding a trace is a
    /// presentation choice rather than a decision to drop measured science.
    NoVisibleTrace,
    /// The two sources a linked figure was asked for do not describe one scan.
    ///
    /// Same dataset is necessary and not sufficient: the selected spectrum has
    /// to be a scan of the *retained table* this chromatogram was built from,
    /// reconciled by identity rather than by retention time, which scans may
    /// share. A disagreement is refused rather than resolved in favour of one
    /// of the two.
    LinkedSourceMismatch,
    /// The selected scan is not inside the chromatogram range that was asked
    /// for.
    ///
    /// A user may select a scan and then pan away from it, and that is an
    /// ordinary thing to do. What a linked figure may not do is widen the range
    /// back, move the viewer, or draw a marker outside its own panel and still
    /// call the result linked.
    SelectedScanOutsideRange,
    /// The figure is too short to hold two panels.
    ///
    /// A one-panel figure remains valid at heights this refuses: the contract's
    /// minimum grows with the number of panels, and only the linked surface has
    /// two.
    FigureTooShort,
}

impl From<SpectrumRangeRefusal> for BeginExportRefusal {
    /// Exhaustive rather than wildcarded, so a range refusal added to the
    /// resolver has to be given a lane answer here instead of falling into a
    /// default that happens to compile.
    fn from(refusal: SpectrumRangeRefusal) -> Self {
        match refusal {
            SpectrumRangeRefusal::OutsideSource => Self::RangeOutsideSource,
            SpectrumRangeRefusal::NoViewportDomain(_) => Self::NoViewportDomain,
        }
    }
}

/// The least height a two-panel figure can be drawn at.
///
/// The contract's own arithmetic rather than a number copied beside it: the
/// chrome a figure always needs, plus one panel's minimum for each panel it
/// holds. A one-panel figure keeps its own smaller minimum, which is why this is
/// asked only of the linked surface.
pub(super) fn two_panel_minimum_height() -> f64 {
    MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT * 2.0
}

/// Whether these settings can hold two panels.
fn fits_two_panels(settings: FigureRenderSettings) -> bool {
    f64::from(settings.height()) >= two_panel_minimum_height()
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
pub(super) fn figure_spec(
    spectrum: &SelectedSpectrumResult,
    settings: FigureRenderSettings,
    range: ResolvedSpectrumRange,
) -> Result<FigureSpec, SpecError> {
    let panel = ranged_spectrum_panel(spectrum, range)?;
    Ok(
        FigureSpec::new(settings.theme(), settings.size(), vec![panel])?
            .with_title(Label::new(format!(
                "Spectrum {}",
                spectrum.identity().index()
            ))?)
            .with_caption(Caption::new(spectrum_caption(spectrum, range))?),
    )
}

/// What a spectrum figure says about itself.
///
/// The full-source sentence is **unchanged**, down to its wording, because the
/// document it describes is unchanged. A current-range figure needs its own,
/// and what it has to establish is what a reader would otherwise get wrong:
/// that the series is still the complete spectrum, that the window is what is
/// drawn, and how many of the source's observations fall inside it. A figure
/// that said only "current range" would leave a reader unable to tell this from
/// a picture of a screen.
fn spectrum_caption(spectrum: &SelectedSpectrumResult, range: ResolvedSpectrumRange) -> String {
    let source_points = spectrum.mz_values().len();
    match range.domain() {
        None => format!(
            "Complete selected spectrum, {source_points} points. Representation {UNREPORTED}; m/z \
             and intensity units {UNREPORTED}."
        ),
        Some(window) => format!(
            "Selected spectrum over m/z {} to {}, {} of {source_points} measured points in that \
             range. The complete spectrum is the figure's source series and the range is the \
             window drawn over it; nothing is interpolated at either edge. Representation \
             {UNREPORTED}; m/z and intensity units {UNREPORTED}.",
            window.low(),
            window.high(),
            points_within(spectrum, window).count(),
        ),
    }
}

/// The source observations inside one m/z window, edges included.
///
/// **Real reported observations only, in source order.** The one filter both a
/// current-range figure's window arithmetic and a current-range data document
/// read, so the drawing and the table cannot come to disagree about which
/// measurements the range holds. Nothing is interpolated at an edge and nothing
/// is sorted: an admitted source is already non-decreasing, and preserving the
/// order the source has is the rule rather than producing one.
fn points_within(
    spectrum: &SelectedSpectrumResult,
    window: Domain,
) -> impl Iterator<Item = (f64, f64)> + '_ {
    spectrum
        .mz_values()
        .iter()
        .copied()
        .zip(spectrum.intensity_values().iter().copied())
        .filter(move |(at, _)| *at >= window.low() && *at <= window.high())
}

/// The panel one export draws, over the range it was resolved for.
///
/// Full is [`spectrum_panel`] and nothing else, so a full-source figure is the
/// same specification byte for byte as it was before ranges existed.
///
/// Current is that **same panel with a window declared on it**. The series
/// stays the complete source at [`DataScope::FullSource`]; the full m/z domain
/// and the full value domain stay the source's own; and what the range changes
/// is which part of it the renderer draws. A figure built from a subset array
/// would be a picture of a screen wearing a scientific document's name.
///
/// # Errors
///
/// Answers with the contract's own refusal, including a window the panel's full
/// domain does not contain.
fn ranged_spectrum_panel(
    spectrum: &SelectedSpectrumResult,
    range: ResolvedSpectrumRange,
) -> Result<PanelSpec, SpecError> {
    let panel = spectrum_panel(spectrum)?;
    let Some(window) = range.domain() else {
        return Ok(panel);
    };
    // A current range that covers the whole spectrum declares no window, so it
    // canonicalizes to the figure a full-source export draws. Declaring one
    // would be a narrowing the figure does not have -- and the chromatogram
    // reached the same conclusion for the same reason.
    if window.low() <= panel.full_domain().low() && window.high() >= panel.full_domain().high() {
        return Ok(panel);
    }
    let (low, high) = visible_value_extent(spectrum, window);
    panel
        .with_visible_domain(window)?
        .with_visible_value_domain(Domain::new(low, high)?)
}

/// The intensity range a current-range spectrum figure is scaled to.
///
/// From the observations the window actually holds, **and zero**, which is the
/// baseline a discrete spectrum's marks are measured from: a stick's length is
/// what a reader reads as its magnitude, so an axis that did not contain zero
/// would make every mark in the window a lie about its own size.
///
/// This is the whole reason the window exists. A spectrum carrying a peak of
/// nine million at some other m/z must still declare that peak in its
/// `value_domain` -- it is in the document, and it comes back into view when the
/// window widens -- but scaling the drawing to it would flatten an ordinary
/// window into a line along the bottom of the panel. The off-window science is
/// not deleted to obtain the scale; the axis is told which part of it is being
/// shown, and the renderer says so in words.
///
/// **No boundary value is interpolated.** For the representation this product
/// is actually in, a value between two measured m/z is a value nobody measured,
/// so a window holding no reported peak scales to zero-to-zero -- an honest
/// empty window rather than a fabricated one.
fn visible_value_extent(spectrum: &SelectedSpectrumResult, window: Domain) -> (f64, f64) {
    let (mut low, mut high) = (0.0_f64, 0.0_f64);
    for (_, value) in points_within(spectrum, window) {
        low = low.min(value);
        high = high.max(value);
    }
    (low, high)
}

/// The selected spectrum as one panel, with no figure around it.
///
/// Factored out for the same reason the chromatogram's is: the linked figure's
/// lower panel must be the *same* spectrum the single-panel export draws, down
/// to the representation and unit posture, rather than a second reading of the
/// same result.
///
/// # Errors
///
/// Answers with the contract's own refusal. A spectrum whose m/z values are not
/// non-decreasing, or which carries a value the contract will not accept, is
/// refused here rather than drawn into a figure that misstates it.
pub(super) fn spectrum_panel(spectrum: &SelectedSpectrumResult) -> Result<PanelSpec, SpecError> {
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

    // Asked of the borrowed arrays, before either is copied, and asked through
    // the one predicate the spectrum viewport also asks. A second reading of
    // "drawable" here is how a screen and an exported figure come to describe
    // different scenes; there is not one.
    let domains = measurement_domains(spectrum.mz_values(), spectrum.intensity_values())
        .map_err(MeasurementRefusal::into_spec_error)?;

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
        domains.domain(),
        domains.value_domain(),
        vec![series],
    )?;

    Ok(panel)
}

/// Renders one selected spectrum as the SVG document a user receives.
///
/// # Errors
///
/// Answers with the contract's refusal where the spectrum cannot be specified.
pub(super) fn svg_document(
    spectrum: &SelectedSpectrumResult,
    settings: FigureRenderSettings,
    range: ResolvedSpectrumRange,
) -> Result<String, SpecError> {
    Ok(mscanvas_plot_spec::svg::render(&figure_spec(
        spectrum, settings, range,
    )?))
}

/// Why one figure could not be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FigureFailure {
    /// The spectrum could not be specified as a figure at all.
    Unspecifiable,
    /// It could be specified, but not turned into pixels.
    Raster(RasterFailure),
}

/// Renders one selected spectrum as the pixels a PNG or the clipboard receives.
///
/// The same `FigureSpec` and the same SVG the vector export writes, put on a
/// pixel grid. There is no second scientific renderer here and there must never
/// be one: two of them would be two answers to what the figure says, and the
/// user would have no way to know which file they were holding.
pub(super) fn figure_raster(
    spectrum: &SelectedSpectrumResult,
    settings: FigureRenderSettings,
    range: ResolvedSpectrumRange,
) -> Result<super::figure::FigureRaster, FigureFailure> {
    let svg = svg_document(spectrum, settings, range).map_err(|_| FigureFailure::Unspecifiable)?;
    rasterize(&svg, settings.width(), settings.height()).map_err(FigureFailure::Raster)
}

/// Rasterizes one figure that has already been specified.
///
/// The pixels every figure surface produces come through here, so a raster of a
/// chromatogram and a raster of a spectrum are the same renderer at the same
/// size rather than two paths that happen to agree.
pub(super) fn raster_of(
    figure: &FigureSpec,
    settings: FigureRenderSettings,
) -> Result<super::figure::FigureRaster, FigureFailure> {
    let svg = mscanvas_plot_spec::svg::render(figure);
    rasterize(&svg, settings.width(), settings.height()).map_err(FigureFailure::Raster)
}

/// Encodes one already-specified figure as the PNG a user receives.
pub(super) fn png_of(
    figure: &FigureSpec,
    settings: FigureRenderSettings,
    dpi: PngDpi,
) -> Result<Vec<u8>, FigureFailure> {
    let raster = raster_of(figure, settings)?;
    encode_png(&raster, dpi.get()).map_err(FigureFailure::Raster)
}

/// Renders one selected spectrum as the PNG document a user receives.
pub(super) fn png_document(
    spectrum: &SelectedSpectrumResult,
    settings: FigureRenderSettings,
    dpi: PngDpi,
    range: ResolvedSpectrumRange,
) -> Result<Vec<u8>, FigureFailure> {
    let raster = figure_raster(spectrum, settings, range)?;
    encode_png(&raster, dpi.get()).map_err(FigureFailure::Raster)
}

/// Renders one selected spectrum as the data document a user receives.
///
/// One writer for both scopes, deliberately. The preamble differs because the
/// two documents answer different questions; **the records are one loop**, so a
/// full-source document and a current-range one cannot come to disagree about
/// how a measurement is written, in what order, or in what form.
///
/// # Schema, version 1 -- the full source
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
/// Unchanged since M4.1 and deliberately frozen. Its shape already means *the
/// complete spectrum*, so the same source writes the same bytes it always did.
///
/// # Schema, version 2 -- one committed m/z range
///
/// The same document about a window of the same spectrum, and self-describing
/// enough to be read with no interface, no viewport and no session to ask:
///
/// ```text
/// #format,mscanvas_spectrum_export
/// #schema_version,2
/// #spectrum_index,42
/// #range_scope,current
/// #source_point_count,4
/// #exported_point_count,2
/// #range_low,100.5
/// #range_high,100.75
/// #representation,unreported
/// #mz_unit,unreported
/// #intensity_unit,unreported
/// mz,intensity
/// 100.5,12
/// 100.75,0
/// ```
///
/// Two counts rather than one. `point_count` in version 1 is unambiguous
/// because the two numbers are the same there; in a ranged document they are
/// not, and a single key would leave a reader unable to tell whether the rows
/// they hold are all the spectrum has.
///
/// `range_low` and `range_high` are the range **Rust resolved**, not the one the
/// interface asked for -- so a file records the window it was actually taken
/// over even if the viewport moved while it was being written.
///
/// **Only reported source observations, at any version.** The records are the
/// measurements whose m/z falls inside the inclusive interval, in the order the
/// source has them. No boundary value is interpolated into a data document
/// under any representation: a row for one would assert a measurement the
/// instrument never made. A range holding none writes zero records, and that is
/// a successful export.
///
/// The preamble uses the same delimiter as the records, so one split rule reads
/// the whole file, and every preamble line begins with `#` so a reader that
/// wants only the table can skip them without knowing what they say. An empty
/// spectrum is the same document with a zero count and no records after the
/// header: the representation and unit states survive in a file with no rows,
/// which is the case a bare two-column table could not describe at all.
///
/// **No quoting rule exists, because no field can need one.** Every preamble
/// key is a fixed ASCII identifier, every preamble value is either an integer,
/// a finite `f64` or one of this module's fixed state words, and every record
/// field is a number. None of them can contain a delimiter, a quote or a line
/// break, and a test asserts that over the whole document rather than trusting
/// it.
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
    range: ResolvedSpectrumRange,
) -> Option<String> {
    let delimiter = format.delimiter()?;
    let representation = match spectrum.representation() {
        SpectrumRepresentationState::NotEmitted => UNREPORTED,
    };
    let unit = match spectrum.value_units() {
        SourceUnitState::NotEmitted => UNREPORTED,
    };

    let source_points = spectrum.mz_values().len();
    // Collected once, because both the preamble's exported count and the
    // records below are the same answer to the same question. Counting one way
    // for the header and iterating another way for the rows is how a document
    // comes to state a number its own table contradicts.
    let records: Vec<(f64, f64)> = match range.domain() {
        None => spectrum
            .mz_values()
            .iter()
            .copied()
            .zip(spectrum.intensity_values().iter().copied())
            .collect(),
        Some(window) => points_within(spectrum, window).collect(),
    };

    let mut document = String::with_capacity(96 + records.len() * 24);
    let index = spectrum.identity().index().to_string();
    let preamble: Vec<(&str, String)> = match range.domain() {
        None => vec![
            ("format", SPECTRUM_DATA_FORMAT_ID.to_owned()),
            (
                "schema_version",
                SPECTRUM_DATA_FULL_SCHEMA_VERSION.to_string(),
            ),
            ("spectrum_index", index),
            ("point_count", source_points.to_string()),
            ("representation", representation.to_owned()),
            ("mz_unit", unit.to_owned()),
            ("intensity_unit", unit.to_owned()),
        ],
        Some(window) => vec![
            ("format", SPECTRUM_DATA_FORMAT_ID.to_owned()),
            (
                "schema_version",
                SPECTRUM_DATA_CURRENT_SCHEMA_VERSION.to_string(),
            ),
            ("spectrum_index", index),
            ("range_scope", range.scope().stable_id().to_owned()),
            ("source_point_count", source_points.to_string()),
            ("exported_point_count", records.len().to_string()),
            ("range_low", window.low().to_string()),
            ("range_high", window.high().to_string()),
            ("representation", representation.to_owned()),
            ("mz_unit", unit.to_owned()),
            ("intensity_unit", unit.to_owned()),
        ],
    };
    for (key, value) in preamble {
        document.push('#');
        document.push_str(key);
        document.push(delimiter);
        document.push_str(&value);
        document.push('\n');
    }
    document.push_str("mz");
    document.push(delimiter);
    document.push_str("intensity\n");
    // One record per retained source point, in source order. Never sorted: an
    // admitted source is already non-decreasing, and what this preserves is the
    // order the source has rather than an order this loop imposes.
    for (at, value) in records {
        document.push_str(&at.to_string());
        document.push(delimiter);
        document.push_str(&value.to_string());
        document.push('\n');
    }
    Some(document)
}

/// How many source observations one resolved range covers.
///
/// The count an outcome reports as *exported*, answered from the same filter the
/// document's records come from. A figure reports it too: a current-range
/// figure draws exactly these observations, so a reader is told the same number
/// whichever output they took.
pub(super) fn exported_point_count(
    spectrum: &SelectedSpectrumResult,
    range: ResolvedSpectrumRange,
) -> usize {
    match range.domain() {
        None => spectrum.mz_values().len(),
        Some(window) => points_within(spectrum, window).count(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::chromatogram::RangeScope;
    use super::super::service::TableRowFacts;
    use super::*;
    use mscanvas_plot_spec::spec::DataScope;
    use mscanvas_plot_spec::spec::FigureTheme;

    /// The dataset a slot test's spectrum came from.
    ///
    /// Which one rarely matters here -- the slot tests are about the token and
    /// the reservation, not about ownership -- so they share one, and the tests
    /// that *are* about ownership name a second explicitly.
    /// The figure every pre-existing test was written against.
    ///
    /// M4.1 exported one size and one theme, and these tests asserted that
    /// document. Settings are a control now, so the value they were implicitly
    /// using is named here -- the assertions below are unchanged because the
    /// default is unchanged.
    fn defaults() -> FigureRenderSettings {
        FigureRenderSettings::default()
    }

    /// One accepted physical resolution, for the one format that records one.
    fn resolution(value: u32) -> PngDpi {
        PngDpi::from_wire(value).expect("an accepted resolution")
    }

    /// The resolution a reservation for this format would carry: one for the
    /// raster export, and none at all for the outputs that record none.
    fn dpi_for(format: SpectrumExportFormat) -> Option<PngDpi> {
        matches!(format, SpectrumExportFormat::Png).then(PngDpi::default)
    }

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
        let figure = figure_spec(
            &spectrum(7, vec![100.0, 200.0], vec![10.0, 20.0]),
            defaults(),
            ResolvedSpectrumRange::Full,
        )
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
        let figure = figure_spec(
            &spectrum(1, vec![100.0], vec![5.0]),
            defaults(),
            ResolvedSpectrumRange::Full,
        )
        .expect("specifiable");
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
        let figure = figure_spec(
            &spectrum(1, vec![1.0, 2.0, 3.0], vec![-4.0, 0.0, 9.0]),
            defaults(),
            ResolvedSpectrumRange::Full,
        )
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
        let positive = figure_spec(
            &spectrum(1, vec![1.0], vec![9.0]),
            defaults(),
            ResolvedSpectrumRange::Full,
        )
        .expect("specifiable");
        assert_eq!(positive.panels()[0].value_domain().low(), 0.0);
    }

    /// A spectrum with no peaks is one empty measurement, never a panel of no
    /// series.
    #[test]
    fn an_empty_spectrum_is_one_empty_measurement() {
        let figure = figure_spec(
            &spectrum(3, Vec::new(), Vec::new()),
            defaults(),
            ResolvedSpectrumRange::Full,
        )
        .expect("an empty spectrum exports");
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
        let figure = figure_spec(
            &spectrum(42, vec![100.0, 200.0], vec![1.0, 2.0]),
            defaults(),
            ResolvedSpectrumRange::Full,
        )
        .expect("specifiable");
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
        let first =
            svg_document(&source, defaults(), ResolvedSpectrumRange::Full).expect("specifiable");
        let second =
            svg_document(&source, defaults(), ResolvedSpectrumRange::Full).expect("specifiable");
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
            ResolvedSpectrumRange::Full,
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
        let csv = data_document(
            &source,
            SpectrumExportFormat::Csv,
            ResolvedSpectrumRange::Full,
        )
        .expect("csv");
        let tsv = data_document(
            &source,
            SpectrumExportFormat::Tsv,
            ResolvedSpectrumRange::Full,
        )
        .expect("tsv");
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
        assert_eq!(
            data_document(
                &source,
                SpectrumExportFormat::Svg,
                ResolvedSpectrumRange::Full
            ),
            None
        );
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
            let document = data_document(&source, format, ResolvedSpectrumRange::Full)
                .expect("a data document");
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
            let document = data_document(&source, format, ResolvedSpectrumRange::Full)
                .expect("a data document");
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
                &data_document(&source, format, ResolvedSpectrumRange::Full)
                    .expect("a data document"),
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
            ResolvedSpectrumRange::Full,
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
        let figure =
            figure_spec(&source, defaults(), ResolvedSpectrumRange::Full).expect("specifiable");
        let series = &figure.panels()[0].series()[0];
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            let parsed = records(
                &data_document(&source, format, ResolvedSpectrumRange::Full)
                    .expect("a data document"),
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
        let mut slot = ScientificExportSlots::default();
        let first = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let stale = first.token().as_wire();
        // A newer selection replaces the retained spectrum.
        let second = slot.install(owner(1), spectrum(2, vec![200.0], vec![2.0]));
        assert_ne!(stale, second.token().as_wire(), "each spectrum has its own");
        assert_eq!(
            slot.begin(
                &stale,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
            Err(BeginExportRefusal::Stale),
            "the older spectrum is gone rather than answered with the newer one",
        );
        // The spectrum that is actually loaded exports.
        assert!(
            slot.begin(
                &second.token().as_wire(),
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .is_ok()
        );
    }

    /// A claimed export finishes from the spectrum it claimed.
    #[test]
    fn a_claimed_export_is_unaffected_by_a_later_selection() {
        let mut slot = ScientificExportSlots::default();
        let first = slot.install(owner(1), spectrum(1, vec![100.0, 200.0], vec![1.0, 2.0]));
        let reservation = slot
            .begin(
                &first.token().as_wire(),
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a reservation");
        let claimed = slot
            .claim_spectrum(&reservation.as_wire())
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
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();
        let first = slot
            .begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a reservation");
        // Unclaimed, so a second request supersedes it rather than being
        // refused -- which is what stops a reload between the two commands
        // wedging the slot for the rest of the session.
        let second = slot
            .begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("an unclaimed reservation is superseded");
        assert!(
            slot.claim_spectrum(&first.as_wire()).is_none(),
            "the superseded reservation can no longer open a dialog",
        );
        assert!(slot.claim_spectrum(&second.as_wire()).is_some());
        assert!(
            slot.claim_spectrum(&second.as_wire()).is_none(),
            "and a claimed one cannot be claimed twice",
        );
    }

    /// An open dialog and a running write both refuse a second export.
    #[test]
    fn a_committed_export_refuses_another() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();
        let reservation = slot
            .begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a reservation");
        slot.claim_spectrum(&reservation.as_wire())
            .expect("claimed");
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
            Err(BeginExportRefusal::AlreadyExporting),
            "a dialog the user is standing in front of is not interrupted",
        );
        slot.begin_write();
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
            Err(BeginExportRefusal::AlreadyExporting),
            "and neither are bytes going to disk",
        );
        assert!(slot.release_write(), "the write ends and the slot is free");
        assert!(
            slot.begin(
                &token,
                SpectrumExportFormat::Tsv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            )
            .is_ok()
        );
    }

    /// Cancelling returns the slot to rest, and forgetting drops the spectrum.
    #[test]
    fn cancelling_frees_the_slot_and_forgetting_drops_the_spectrum() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();
        let reservation = slot
            .begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a reservation");
        assert!(slot.cancel(&reservation.as_wire()));
        assert!(
            !slot.cancel(&reservation.as_wire()),
            "cancelling a reservation that already ended changes nothing",
        );
        assert!(
            slot.begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            )
            .is_ok()
        );
        slot.forget();
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
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

        let figure =
            figure_spec(&source, defaults(), ResolvedSpectrumRange::Full).expect("specifiable");
        assert_eq!(
            figure.panels()[0].series()[0].len(),
            complete,
            "the figure draws every source point, not the transferred prefix",
        );

        let document = data_document(
            &source,
            SpectrumExportFormat::Csv,
            ResolvedSpectrumRange::Full,
        )
        .expect("a document");
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
            (SpectrumExportFormat::Png, "mscanvas-spectrum-42.png"),
            (SpectrumExportFormat::Csv, "mscanvas-spectrum-42.csv"),
            (SpectrumExportFormat::Tsv, "mscanvas-spectrum-42.tsv"),
        ] {
            assert_eq!(
                format.suggested_file_name(42, SpectrumRangeScope::Full),
                expected
            );
        }
        // Closed rather than parsed loosely, which is the property this asserts
        // -- the vocabulary grew by one in M4.2 and is still a list rather than
        // a pattern.
        assert_eq!(SpectrumExportFormat::from_wire("jpeg"), None);
        assert_eq!(SpectrumExportFormat::from_wire("pdf"), None);
        assert_eq!(SpectrumExportFormat::from_wire("PNG"), None);
        assert_eq!(
            SpectrumExportFormat::from_wire("svg"),
            Some(SpectrumExportFormat::Svg),
        );
        assert_eq!(
            SpectrumExportFormat::from_wire("png"),
            Some(SpectrumExportFormat::Png),
        );
        // Which formats a figure setting reaches, and which it does not.
        assert!(SpectrumExportFormat::Svg.is_figure());
        assert!(SpectrumExportFormat::Png.is_figure());
        assert!(!SpectrumExportFormat::Csv.is_figure());
        assert!(!SpectrumExportFormat::Tsv.is_figure());
    }

    // -----------------------------------------------------------------------
    // M4.2. The figure a user chooses, the pixels it becomes, and the lane the
    // whole of it runs in.
    // -----------------------------------------------------------------------

    /// Settings that differ from the defaults in every field that has one.
    fn other_settings() -> FigureRenderSettings {
        FigureRenderSettings::from_wire(640, 480, "dark").expect("a figure")
    }

    #[test]
    fn a_stale_token_is_stale_even_while_another_operation_runs() {
        // Two refusals, and they send the user somewhere different. "Already
        // exporting" means wait; "no longer loaded" means select the spectrum
        // again. A token that can never become valid must not be answered with
        // the one that says waiting will help.
        let mut slot = ScientificExportSlots::default();
        let first = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let reservation = slot
            .begin(
                &first.token().as_wire(),
                SpectrumExportFormat::Png,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                Some(PngDpi::default()),
            )
            .expect("the first export begins");
        slot.claim_spectrum(&reservation.as_wire())
            .expect("claimed");

        // The spectrum is replaced while the dialog stands open.
        let second = slot.install(owner(1), spectrum(2, vec![200.0], vec![2.0]));

        assert_eq!(
            slot.begin(
                &first.token().as_wire(),
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            ),
            Err(BeginExportRefusal::Stale),
            "the old token names a spectrum this session no longer has"
        );
        // The one that *is* current gets the other refusal, which is the one
        // waiting can resolve.
        assert_eq!(
            slot.begin(
                &second.token().as_wire(),
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        assert_eq!(
            slot.begin_copy(
                &first.token().as_wire(),
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            ),
            Err(BeginExportRefusal::Stale),
        );
    }

    #[test]
    fn a_claim_freezes_the_settings_the_export_began_with() {
        // The user is about to be in a modal dialog. A settings change that
        // lands while they are standing in it must not move an export that has
        // already started onto a different figure: what is written is what was
        // asked for.
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0, 200.0], vec![1.0, 2.0]));
        let reservation = slot
            .begin(
                &snapshot.token().as_wire(),
                SpectrumExportFormat::Png,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                Some(PngDpi::default()),
            )
            .expect("the export begins");

        let claimed = slot
            .claim_spectrum(&reservation.as_wire())
            .expect("claimed");

        assert_eq!(claimed.settings, defaults());
        assert_ne!(claimed.settings, other_settings());
        assert_eq!(claimed.dpi, Some(PngDpi::default()));
        // And the bytes follow the claim rather than anything read again.
        let dpi = claimed.dpi.expect("a PNG reservation carries a resolution");
        let asked = png_document(
            claimed.snapshot.spectrum(),
            claimed.settings,
            dpi,
            ResolvedSpectrumRange::Full,
        )
        .expect("a png");
        let decoded = png::Decoder::new(std::io::Cursor::new(&asked));
        let reader = decoded.read_info().expect("the PNG parses");
        assert_eq!(reader.info().width, defaults().width());
        assert_eq!(reader.info().height, defaults().height());
    }

    #[test]
    fn a_copy_takes_the_lane_and_holds_it_against_every_other_operation() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();

        let (copying, copied_range) = slot
            .begin_copy(
                &token,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
            )
            .expect("the copy takes the lane");
        assert_eq!(copying.token(), snapshot.token());
        assert_eq!(copied_range, ResolvedSpectrumRange::Full);

        // Every other figure operation, and both data formats: one lane.
        for format in [
            SpectrumExportFormat::Svg,
            SpectrumExportFormat::Png,
            SpectrumExportFormat::Csv,
            SpectrumExportFormat::Tsv,
        ] {
            assert_eq!(
                slot.begin(
                    &token,
                    format,
                    SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                    defaults(),
                    dpi_for(format)
                ),
                Err(BeginExportRefusal::AlreadyExporting),
                "{format:?} waits for the copy"
            );
        }
        assert_eq!(
            slot.begin_copy(
                &token,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            ),
            Err(BeginExportRefusal::AlreadyExporting),
            "and so does a second copy"
        );

        // The refusals disturbed nothing: the copy still ends its own way.
        assert!(slot.release_write());
        slot.begin(
            &token,
            SpectrumExportFormat::Svg,
            SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
            defaults(),
            None,
        )
        .expect("the lane is free again");
    }

    #[test]
    fn a_write_holds_the_lane_and_an_unclaimed_reservation_does_not() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let token = snapshot.token().as_wire();

        // Unclaimed: superseded rather than refused, which is the M4.1
        // semantics a reload between the two commands depends on.
        slot.begin(
            &token,
            SpectrumExportFormat::Svg,
            SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
            defaults(),
            None,
        )
        .expect("a reservation is issued");
        slot.begin(
            &token,
            SpectrumExportFormat::Csv,
            SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
            defaults(),
            None,
        )
        .expect("an unclaimed reservation is superseded");
        slot.begin_copy(
            &token,
            SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
        )
        .expect("and a copy supersedes it too");

        // Writing: closed to everything.
        slot.begin_write();
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        assert_eq!(
            slot.begin_copy(
                &token,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
    }

    #[test]
    fn the_figure_is_drawn_at_the_size_and_theme_that_were_chosen() {
        let source = spectrum(4, vec![100.0, 200.0], vec![1.0, 2.0]);

        let chosen = other_settings();
        let figure =
            figure_spec(&source, chosen, ResolvedSpectrumRange::Full).expect("specifiable");
        assert!((figure.size().width() - f64::from(chosen.width())).abs() < f64::EPSILON);
        assert!((figure.size().height() - f64::from(chosen.height())).abs() < f64::EPSILON);
        assert_eq!(figure.theme(), FigureTheme::Dark);

        // And the default reproduces exactly what M4.1 exported.
        let default =
            figure_spec(&source, defaults(), ResolvedSpectrumRange::Full).expect("specifiable");
        assert!((default.size().width() - 1_200.0).abs() < f64::EPSILON);
        assert!((default.size().height() - 640.0).abs() < f64::EPSILON);
        assert_eq!(default.theme(), FigureTheme::Light);
    }

    #[test]
    fn the_svg_has_no_physical_resolution_to_ignore() {
        // DPI describes how large a raster image is meant to be on paper. A
        // vector document has no pixels to describe, and this is now stated in
        // the types: `svg_document` takes a `FigureRenderSettings`, which has
        // no resolution in it, so there is no value a caller could vary here to
        // move the bytes. That is stronger than asserting two documents match,
        // because a future author cannot reintroduce the dependency without
        // changing the signature.
        //
        // What can still be asserted is the other half: the resolution the
        // raster format does record changes only the record. The same figure
        // asked for at 96 and at 600 differs in its bytes -- the `pHYs` chunk --
        // and decodes to identical pixels.
        let source = spectrum(2, vec![100.0, 200.0], vec![3.0, 4.0]);
        let settings = FigureRenderSettings::from_wire(400, 300, "light").expect("a figure");

        let vector = svg_document(&source, settings, ResolvedSpectrumRange::Full).expect("an svg");
        assert!(vector.contains("<svg"));

        let at_ninety_six = png_document(
            &source,
            settings,
            resolution(96),
            ResolvedSpectrumRange::Full,
        )
        .expect("a png");
        let at_six_hundred = png_document(
            &source,
            settings,
            resolution(600),
            ResolvedSpectrumRange::Full,
        )
        .expect("a png");
        assert_ne!(at_ninety_six, at_six_hundred, "the record differs");
        assert_eq!(
            decoded_pixels(&at_ninety_six),
            decoded_pixels(&at_six_hundred),
            "and nothing else does",
        );
    }

    #[test]
    fn a_figure_setting_never_changes_a_data_document() {
        // A size, a resolution and a theme are properties of a drawing. The
        // measurement is the same measurement whatever it is being drawn at,
        // and a byte of difference here would mean a figure setting had reached
        // the data -- which is the one thing schema v1 must never depend on.
        let source = spectrum(9, vec![100.5, 200.25, 300.0], vec![1.0, -2.0, 0.0]);
        let baseline_csv = data_document(
            &source,
            SpectrumExportFormat::Csv,
            ResolvedSpectrumRange::Full,
        )
        .expect("a document");
        let baseline_tsv = data_document(
            &source,
            SpectrumExportFormat::Tsv,
            ResolvedSpectrumRange::Full,
        )
        .expect("a document");

        for (settings, dpi) in [
            (
                FigureRenderSettings::from_wire(200, 180, "light").expect("a figure"),
                300,
            ),
            (
                FigureRenderSettings::from_wire(8_000, 4_000, "dark").expect("a figure"),
                72,
            ),
            (
                FigureRenderSettings::from_wire(1_200, 640, "dark").expect("a figure"),
                1_200,
            ),
        ] {
            // Read as well as varied, so the loop still moves every figure
            // setting the boundary accepts and not merely the ones the vector
            // document happens to consume.
            resolution(dpi);
            // The figure is drawn differently every time, which is the point:
            // the data is asked for beside it and does not move.
            let figure =
                svg_document(&source, settings, ResolvedSpectrumRange::Full).expect("an svg");
            assert!(figure.contains("<svg"));
            assert_eq!(
                data_document(
                    &source,
                    SpectrumExportFormat::Csv,
                    ResolvedSpectrumRange::Full
                )
                .expect("a document"),
                baseline_csv,
            );
            assert_eq!(
                data_document(
                    &source,
                    SpectrumExportFormat::Tsv,
                    ResolvedSpectrumRange::Full
                )
                .expect("a document"),
                baseline_tsv,
            );
        }
    }

    #[test]
    fn a_png_is_the_requested_pixels_and_records_the_requested_resolution() {
        // Parsed from the final bytes rather than from anything on the way to
        // them: what a user opens is the file, and the file is what has to be
        // right.
        let source = spectrum(5, vec![100.0, 200.0, 300.0], vec![10.0, 0.0, -5.0]);

        for (width, height, dpi) in [
            (200_u32, 180_u32, 72_u32),
            (1_200, 640, 300),
            (900, 500, 600),
        ] {
            let settings =
                FigureRenderSettings::from_wire(width, height, "light").expect("a figure");
            let bytes = png_document(
                &source,
                settings,
                resolution(dpi),
                ResolvedSpectrumRange::Full,
            )
            .expect("a png");

            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "the PNG signature");
            let decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
            let mut reader = decoder.read_info().expect("the PNG parses");
            {
                let info = reader.info();
                assert_eq!(info.width, width);
                assert_eq!(info.height, height);
                assert_eq!(info.color_type, png::ColorType::Rgba);
                assert_eq!(info.bit_depth, png::BitDepth::Eight);

                let dimensions = info.pixel_dims.expect("pHYs is present");
                assert_eq!(dimensions.unit, png::Unit::Meter);
                let expected = super::super::figure::pixels_per_metre(dpi);
                assert_eq!(dimensions.xppu, expected);
                assert_eq!(dimensions.yppu, expected);
                assert_eq!(super::super::figure::dpi_of(dimensions.xppu), dpi);
            }

            // And the pixels themselves: opaque everywhere, and not all one
            // colour, which is what a figure with no geometry would be.
            let mut pixels = vec![0; reader.output_buffer_size().expect("a bounded image")];
            let frame = reader.next_frame(&mut pixels).expect("the image decodes");
            let pixels = &pixels[..frame.buffer_size()];
            assert!(
                pixels.chunks_exact(4).all(|pixel| pixel[3] == 255),
                "no alpha holes"
            );
            let first = &pixels[..4];
            assert!(
                pixels.chunks_exact(4).any(|pixel| pixel != first),
                "the figure drew something"
            );
        }
    }

    #[test]
    fn the_same_png_comes_out_twice_on_one_machine() {
        // Within one environment. Across machines the installed font
        // implementation decides the glyphs, and this repository makes no claim
        // about that.
        let source = spectrum(6, vec![100.0, 200.0], vec![1.0, 2.0]);
        let settings = FigureRenderSettings::from_wire(400, 300, "dark").expect("a figure");

        assert_eq!(
            png_document(
                &source,
                settings,
                resolution(300),
                ResolvedSpectrumRange::Full
            )
            .expect("a png"),
            png_document(
                &source,
                settings,
                resolution(300),
                ResolvedSpectrumRange::Full
            )
            .expect("a png"),
        );
    }

    #[test]
    fn a_light_png_differs_from_a_dark_one() {
        let source = spectrum(7, vec![100.0, 200.0], vec![1.0, 2.0]);
        let light = FigureRenderSettings::from_wire(400, 300, "light").expect("a figure");
        let dark = FigureRenderSettings::from_wire(400, 300, "dark").expect("a figure");

        assert_ne!(
            png_document(&source, light, resolution(300), ResolvedSpectrumRange::Full)
                .expect("a png"),
            png_document(&source, dark, resolution(300), ResolvedSpectrumRange::Full)
                .expect("a png"),
        );
    }

    #[test]
    fn every_spectrum_a_figure_accepts_also_rasterizes() {
        // The shapes the scientific tests already pin, put through the pixel
        // path as well -- an empty measurement, a single point, everything at
        // zero, and a range wide enough to collapse a mark onto the baseline.
        let settings = FigureRenderSettings::from_wire(400, 300, "light").expect("a figure");
        for source in [
            spectrum(0, Vec::new(), Vec::new()),
            spectrum(1, vec![100.0], vec![1.0]),
            spectrum(2, vec![100.0, 200.0], vec![0.0, 0.0]),
            spectrum(3, vec![100.0, 200.0], vec![-1.0, -1e20]),
            spectrum(4, vec![100.0, 200.0], vec![1.0, 1e20]),
        ] {
            let bytes = png_document(
                &source,
                settings,
                resolution(300),
                ResolvedSpectrumRange::Full,
            )
            .expect("every specifiable figure draws");
            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        }
    }

    #[test]
    fn a_machine_with_no_usable_font_refuses_the_pixels_and_keeps_the_vector() {
        // The one raster failure that would otherwise be invisible: a figure
        // with its words missing still looks like a figure. So the pixel
        // formats fail closed, and the vector one -- which keeps the text as
        // text and needs no typeface -- is still there.
        let source = spectrum(8, vec![100.0, 200.0], vec![1.0, 2.0]);
        let settings = defaults();
        let svg = svg_document(&source, settings, ResolvedSpectrumRange::Full).expect("an svg");

        assert_eq!(
            super::super::figure::rasterize_without_fonts(&svg, 400, 300),
            Err(RasterFailure::NoUsableFont),
        );
        // The same document, with fonts, is drawable -- so the refusal is about
        // the machine rather than about this figure.
        assert!(rasterize(&svg, 400, 300).is_ok());
        // And the vector export never depended on a font at all.
        assert!(svg.contains("<svg"));
        assert!(svg.contains("font-family"));
    }

    #[test]
    fn a_copy_and_a_png_draw_the_same_pixels() {
        // Copy plot is the PNG path stopped one step earlier. Not a second
        // renderer, not a second size, and not DPI-dependent -- the clipboard
        // has no physical resolution to record.
        let source = spectrum(11, vec![100.0, 200.0], vec![4.0, 5.0]);
        let settings = FigureRenderSettings::from_wire(300, 200, "dark").expect("a figure");

        // `figure_raster` takes no resolution, and that is the point: there is
        // no argument here to get wrong. A clipboard image is RGBA and a size,
        // with nowhere for a `pHYs` chunk to live.
        let copied =
            figure_raster(&source, settings, ResolvedSpectrumRange::Full).expect("a raster");
        assert_eq!(copied.width(), 300);
        assert_eq!(copied.height(), 200);

        // And the same pixels the PNG encodes, at either resolution.
        for dpi in [96, 600] {
            let encoded = png_document(
                &source,
                settings,
                resolution(dpi),
                ResolvedSpectrumRange::Full,
            )
            .expect("a png");
            assert_eq!(decoded_pixels(&encoded), copied.rgba());
        }
    }

    /// The pixels a PNG actually contains, decoded from the final bytes.
    fn decoded_pixels(bytes: &[u8]) -> Vec<u8> {
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().expect("the PNG parses");
        let mut pixels = vec![0; reader.output_buffer_size().expect("a bounded image")];
        let frame = reader.next_frame(&mut pixels).expect("the image decodes");
        pixels.truncate(frame.buffer_size());
        pixels
    }

    #[test]
    fn a_failed_read_does_not_revoke_a_spectrum_that_arrived_after_it() {
        // Spectrum reads are not serialized against each other. A later request
        // can reach the backend gate first, install its snapshot and be the
        // spectrum on screen by the time an earlier one comes back to say it
        // failed. Revoking unconditionally there takes away the spectrum the
        // user is actually looking at -- the panel keeps showing it, because the
        // frontend discards the superseded answer, and only the export fails, as
        // stale, for a reason nothing on screen explains.
        let mut slot = ScientificExportSlots::default();
        let older = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let newer = slot.install(owner(1), spectrum(2, vec![200.0], vec![2.0]));

        // The older read finishes last and fails. It revokes only what it owned.
        assert!(
            !slot.forget_if_current(Some(older.token())),
            "the older read no longer owns the slot"
        );
        assert_eq!(slot.current_token(), Some(newer.token()));
        slot.begin(
            &newer.token().as_wire(),
            SpectrumExportFormat::Svg,
            SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
            defaults(),
            None,
        )
        .expect("the spectrum on screen is still exportable");

        // And when the failing read *is* the one that owns the slot, it does
        // revoke -- which is the half that closes the lifecycle.
        assert!(slot.forget_if_current(Some(newer.token())));
        assert_eq!(slot.current_token(), None);
    }

    #[test]
    fn revoking_against_nothing_revokes_nothing() {
        // A read that began when the slot was empty owns nothing, so a failure
        // afterwards must not take away whatever arrived in the meantime.
        let mut slot = ScientificExportSlots::default();
        let arrived = slot.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));

        assert!(!slot.forget_if_current(None));
        assert_eq!(slot.current_token(), Some(arrived.token()));
    }

    // ------------------------------------------- one lane, two scientific sources

    /// One exportable run, for the lane tests.
    fn seeded_chromatogram() -> ChromatogramSource {
        let rows = std::sync::Arc::new(vec![
            super::super::service::TableRowFacts::for_test(0, Some(1), 1, 1.0, false, 100.0, 40.0),
            super::super::service::TableRowFacts::for_test(1, Some(2), 1, 2.0, false, 300.0, 120.0),
        ]);
        ChromatogramSource::from_rows(&rows, false).expect("an exportable run")
    }

    fn full_range() -> RangeRequest {
        RangeRequest::from_wire("full", None, None).expect("a full request")
    }

    fn tic_only() -> TraceSet {
        TraceSet::from_wire(true, false)
    }

    /// A chromatogram export cannot begin while a spectrum's picker is open.
    ///
    /// One lane across both surfaces, and this is what having one means: a
    /// claimed reservation is a dialog somebody is standing in front of, and a
    /// second scientific export is refused there rather than by a disabled
    /// button in a document that may have reloaded.
    #[test]
    fn a_claimed_spectrum_export_refuses_a_chromatogram_one() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(1, vec![100.0], vec![1.0]))
            .token()
            .as_wire();
        let chromatogram = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();
        let reservation = slots
            .begin(
                &spectrum,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a first export");
        slots
            .claim_spectrum(&reservation.as_wire())
            .expect("its dialog");

        assert_eq!(
            slots.begin_chromatogram(
                &chromatogram,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        // And the clipboard operation is the same lane.
        assert_eq!(
            slots
                .begin_chromatogram_copy(&chromatogram, full_range(), tic_only())
                .err(),
            Some(BeginExportRefusal::AlreadyExporting),
        );
    }

    /// And the reverse, which is the half a second lane would have hidden.
    #[test]
    fn a_claimed_chromatogram_export_refuses_a_spectrum_one() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(1, vec![100.0], vec![1.0]))
            .token()
            .as_wire();
        let chromatogram = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();
        let reservation = slots
            .begin_chromatogram(
                &chromatogram,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            )
            .expect("a first export");
        slots
            .claim_chromatogram(&reservation.as_wire())
            .expect("its dialog");

        assert_eq!(
            slots.begin(
                &spectrum,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        assert_eq!(
            slots.begin_copy(
                &spectrum,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
    }

    /// A clipboard operation of either kind closes the lane while it runs.
    #[test]
    fn a_copy_of_either_kind_holds_the_lane() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(1, vec![100.0], vec![1.0]))
            .token()
            .as_wire();
        let chromatogram = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();

        slots
            .begin_copy(
                &spectrum,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
            )
            .expect("a spectrum copy");
        assert_eq!(
            slots
                .begin_chromatogram_copy(&chromatogram, full_range(), tic_only())
                .err(),
            Some(BeginExportRefusal::AlreadyExporting),
        );
        assert!(slots.release_write());

        slots
            .begin_chromatogram_copy(&chromatogram, full_range(), tic_only())
            .expect("a chromatogram copy");
        assert_eq!(
            slots.begin_copy(
                &spectrum,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        assert!(slots.release_write());
    }

    /// An unclaimed reservation is superseded rather than refused, across kinds.
    ///
    /// The accepted semantics, unchanged: a document that asked and then
    /// reloaded leaves nothing behind for a later export to wait for. Two
    /// dialogs stay impossible because claiming is what opens one.
    #[test]
    fn an_unclaimed_reservation_is_superseded_by_either_surface() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(1, vec![100.0], vec![1.0]))
            .token()
            .as_wire();
        let chromatogram = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();

        let first = slots
            .begin(
                &spectrum,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a spectrum reservation");
        let second = slots
            .begin_chromatogram(
                &chromatogram,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            )
            .expect("a chromatogram reservation supersedes an unclaimed one");

        assert!(
            slots.claim_spectrum(&first.as_wire()).is_none(),
            "the superseded reservation can no longer open a dialog"
        );
        assert!(slots.claim_chromatogram(&second.as_wire()).is_some());
    }

    /// A claim answers with the kind it was made for, and no other.
    #[test]
    fn a_claim_carries_the_surface_it_belongs_to() {
        let mut slots = ScientificExportSlots::default();
        let chromatogram = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();
        let reservation = slots
            .begin_chromatogram(
                &chromatogram,
                ChromatogramExportFormat::Tsv,
                full_range(),
                tic_only(),
                None,
                None,
            )
            .expect("a reservation");

        let chromatogram = slots
            .claim_chromatogram(&reservation.as_wire())
            .expect("its claim");
        assert_eq!(chromatogram.format, ChromatogramExportFormat::Tsv);
        assert_eq!(chromatogram.range.scope(), RangeScope::Full);
        assert_eq!(
            chromatogram.suggested_file_name(),
            "mscanvas-chromatogram-full.tsv"
        );
        assert_eq!(chromatogram.dialog().title, "Export chromatogram data");
    }

    // --------------------------------------------- what a token stops naming

    /// A token from a preview this session has replaced is refused.
    #[test]
    fn a_replaced_chromatogram_is_no_longer_exportable() {
        let mut slots = ScientificExportSlots::default();
        let first = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();
        let second = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();

        assert_ne!(first, second);
        assert_eq!(
            slots.begin_chromatogram(
                &first,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::Stale),
            "an old token is never rebound to whatever is current now"
        );
        assert!(
            slots
                .begin_chromatogram(
                    &second,
                    ChromatogramExportFormat::Csv,
                    full_range(),
                    tic_only(),
                    None,
                    None,
                )
                .is_ok()
        );
    }

    /// An export already under way finishes against the run it started with.
    #[test]
    fn an_export_in_flight_keeps_the_run_it_claimed() {
        let mut slots = ScientificExportSlots::default();
        let token = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token();
        let reservation = slots
            .begin_chromatogram(
                &token.as_wire(),
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            )
            .expect("a reservation");
        let claimed = slots
            .claim_chromatogram(&reservation.as_wire())
            .expect("its claim");

        // A newer preview lands while the picker is open.
        slots.install_chromatogram(owner(1), seeded_chromatogram());

        assert_eq!(claimed.snapshot.token(), token);
    }

    /// Removing the dataset the run came from revokes it; removing another does
    /// not.
    #[test]
    fn only_the_owning_dataset_revokes_a_chromatogram() {
        let mut slots = ScientificExportSlots::default();
        let token = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();

        assert!(!slots.forget_if_owned_by(&[owner(2)]));
        assert!(
            slots
                .begin_chromatogram(
                    &token,
                    ChromatogramExportFormat::Csv,
                    full_range(),
                    tic_only(),
                    None,
                    None,
                )
                .is_ok()
        );

        assert!(slots.forget_if_owned_by(&[owner(1)]));
        assert_eq!(
            slots.begin_chromatogram(
                &token,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::Stale),
        );
    }

    /// A figure with no visible trace is refused before anything is reserved.
    #[test]
    fn a_figure_with_no_trace_is_refused_and_leaves_the_lane_alone() {
        let mut slots = ScientificExportSlots::default();
        let token = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();
        let hidden = TraceSet::from_wire(false, false);

        assert_eq!(
            slots.begin_chromatogram(
                &token,
                ChromatogramExportFormat::Svg,
                full_range(),
                hidden,
                Some(defaults()),
                None,
            ),
            Err(BeginExportRefusal::NoVisibleTrace),
        );
        // The data export beside it is untouched: hiding a trace is a choice
        // about a plot, not a decision to leave measured science out of a file.
        assert!(
            slots
                .begin_chromatogram(
                    &token,
                    ChromatogramExportFormat::Csv,
                    full_range(),
                    hidden,
                    None,
                    None,
                )
                .is_ok()
        );
    }

    /// A range the run does not have is refused at begin.
    #[test]
    fn a_forged_range_is_refused_at_begin() {
        let mut slots = ScientificExportSlots::default();
        let token = slots
            .install_chromatogram(owner(1), seeded_chromatogram())
            .token()
            .as_wire();
        let outside = RangeRequest::from_wire("current", Some(-50.0), Some(5_000.0))
            .expect("a well-formed request");

        assert_eq!(
            slots.begin_chromatogram(
                &token,
                ChromatogramExportFormat::Csv,
                outside,
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::RangeOutsideSource),
        );
    }

    /// A reservation claimed through the other surface's command leaves the lane
    /// exactly as it was.
    ///
    /// Round 1 of M4.3's review found this, and it is the failure mode that
    /// makes the ordering worth stating: the two kinds share one reservation
    /// counter, so a chromatogram's identifier is a perfectly well-formed
    /// spectrum reservation, and a document that reloaded and replayed a stored
    /// one reaches this. Marking the lane claimed on the way to refusing it
    /// would leave it committed with no dialog, no writer and nothing to cancel
    /// it -- and every later scientific export of the session would be refused
    /// as "already exporting" for a reason nothing on screen could explain.
    #[test]
    fn a_claim_through_the_wrong_command_does_not_wedge_the_lane() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        let chromatogram = slots.install_chromatogram(owner(1), seeded_chromatogram());
        let reservation = slots
            .begin_chromatogram(
                &chromatogram.token().as_wire(),
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            )
            .expect("a chromatogram reservation");

        // The spectrum's save command, handed the chromatogram's reservation.
        assert!(slots.claim_spectrum(&reservation.as_wire()).is_none());

        // The lane is not committed: the reservation it holds can still be
        // claimed by the command it belongs to.
        assert!(
            slots.claim_chromatogram(&reservation.as_wire()).is_some(),
            "the refused claim left the reservation intact"
        );
        slots.cancel(&reservation.as_wire());

        // And a later export of either surface still begins.
        assert!(
            slots
                .begin(
                    &spectrum.token().as_wire(),
                    SpectrumExportFormat::Csv,
                    SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                    defaults(),
                    None,
                )
                .is_ok(),
            "a mismatched claim did not wedge the session"
        );
    }

    /// The same, in the other direction.
    #[test]
    fn a_spectrum_reservation_claimed_as_a_chromatogram_leaves_the_lane_open() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots.install(owner(1), spectrum(1, vec![100.0], vec![1.0]));
        slots.install_chromatogram(owner(1), seeded_chromatogram());
        let reservation = slots
            .begin(
                &spectrum.token().as_wire(),
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .expect("a spectrum reservation");

        assert!(slots.claim_chromatogram(&reservation.as_wire()).is_none());
        assert!(slots.claim_spectrum(&reservation.as_wire()).is_some());
    }

    // ------------------------------------- which preview open owns the chromatogram

    /// A second exportable run, told apart from the first by how long it is.
    fn other_chromatogram() -> ChromatogramSource {
        let rows = std::sync::Arc::new(vec![
            super::super::service::TableRowFacts::for_test(0, Some(1), 1, 10.0, false, 100.0, 40.0),
            super::super::service::TableRowFacts::for_test(
                1,
                Some(2),
                1,
                20.0,
                false,
                300.0,
                120.0,
            ),
            super::super::service::TableRowFacts::for_test(
                2,
                Some(3),
                1,
                30.0,
                false,
                500.0,
                220.0,
            ),
        ]);
        ChromatogramSource::from_rows(&rows, false).expect("an exportable run")
    }

    /// One whole preview open, in the two halves the service performs it in.
    fn preview_open(
        slots: &mut ScientificExportSlots,
        dataset: DatasetId,
        source: Option<ChromatogramSource>,
    ) -> Option<ChromatogramSnapshot> {
        let ticket = slots.begin_preview_open();
        slots.reconcile_preview_chromatogram(ticket, dataset, source)
    }

    /// An older open cannot install over the preview the user is looking at.
    ///
    /// Round 2 of M4.3's review found this, and two *different* datasets are
    /// what make it reachable. The per-dataset request epoch is not an ordering
    /// between them: each open is the newest request for its own dataset, so
    /// both are current by that test, and whichever completion arrived last used
    /// to own the one chromatogram the session has -- which is the older open
    /// whenever the newer file is the faster read.
    #[test]
    fn an_older_preview_open_cannot_install_over_a_newer_one() {
        let mut slots = ScientificExportSlots::default();
        // Both opens begin, in the order the user asked for them.
        let older = slots.begin_preview_open();
        let newer = slots.begin_preview_open();

        // The newer one is the faster read and comes back first.
        let visible = slots
            .reconcile_preview_chromatogram(newer, owner(2), Some(other_chromatogram()))
            .expect("the open the user is waiting for installs");

        // The older one comes back afterwards, carrying a perfectly valid
        // description of a dataset that is still registered.
        assert!(
            slots
                .reconcile_preview_chromatogram(older, owner(1), Some(seeded_chromatogram()))
                .is_none(),
            "an open the session has already passed installs nothing",
        );
        assert_eq!(slots.current_chromatogram_token(), Some(visible.token()));
        // And what the webview is holding still names the run on its screen.
        assert_eq!(
            slots
                .chromatogram_for(&visible.token().as_wire())
                .expect("the visible run is still exportable")
                .source()
                .scan_count(),
            3,
        );
    }

    /// While a newer open is still reading, the session has no chromatogram.
    ///
    /// The other order of the same race, and the one that says what "newer open
    /// wins" has to mean: not "the newest completion wins", which is the defect,
    /// but "only the newest *intent* may speak at all". This mirrors the webview
    /// exactly -- it is in its opening state, showing neither run.
    #[test]
    fn an_older_open_finishing_first_installs_nothing_and_revokes_the_previous_run() {
        let mut slots = ScientificExportSlots::default();
        let previous = preview_open(&mut slots, owner(1), Some(seeded_chromatogram()))
            .expect("a run on screen");
        let previous_token = previous.token().as_wire();

        let older = slots.begin_preview_open();
        let newer = slots.begin_preview_open();
        // Beginning took the previous run away at the moment the user asked,
        // rather than whenever a read happens to finish.
        assert_eq!(slots.current_chromatogram_token(), None);
        assert_eq!(
            slots
                .begin_chromatogram_copy(&previous_token, full_range(), tic_only())
                .err(),
            Some(BeginExportRefusal::Stale),
        );

        // The older open finishes while the newer one is still reading.
        assert!(
            slots
                .reconcile_preview_chromatogram(older, owner(1), Some(seeded_chromatogram()))
                .is_none(),
        );
        assert_eq!(
            slots.current_chromatogram_token(),
            None,
            "a run the user has moved past does not become the exportable one",
        );

        // Then the open they are actually waiting for lands.
        let visible = slots
            .reconcile_preview_chromatogram(newer, owner(2), Some(other_chromatogram()))
            .expect("the newest open installs");
        assert_eq!(slots.current_chromatogram_token(), Some(visible.token()));
    }

    /// A newer open that fails does not resurrect the run it replaced.
    ///
    /// The webview does not either: it shows the failure, not the preview from
    /// before. Restoring the old chromatogram here would leave Rust offering an
    /// export of a run that is no longer on any screen.
    #[test]
    fn a_newer_preview_open_that_fails_leaves_no_chromatogram_at_all() {
        let mut slots = ScientificExportSlots::default();
        let previous = preview_open(&mut slots, owner(1), Some(seeded_chromatogram()))
            .expect("a run on screen");
        let previous_token = previous.token().as_wire();

        // It begins and never comes back: an unreadable file, a backend that
        // stopped, a source that changed underneath it.
        let _abandoned = slots.begin_preview_open();

        assert_eq!(slots.current_chromatogram_token(), None);
        assert_eq!(
            slots.begin_chromatogram(
                &previous_token,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::Stale),
        );
    }

    /// The current open of a run with no chromatogram leaves the session none.
    ///
    /// Install *or* revoke, never neither. A truncated table, an empty run or
    /// one whose retention times this build cannot read has no chromatogram on
    /// screen, and keeping the previous one would let an export reach a run the
    /// viewer stopped drawing.
    #[test]
    fn the_current_open_of_an_ineligible_run_revokes_the_previous_chromatogram() {
        let mut slots = ScientificExportSlots::default();
        preview_open(&mut slots, owner(1), Some(seeded_chromatogram())).expect("a run on screen");

        assert!(preview_open(&mut slots, owner(2), None).is_none());
        assert_eq!(slots.current_chromatogram_token(), None);
    }

    /// A *stale* open of an ineligible run revokes nothing.
    ///
    /// This is the distinction the whole rule turns on. "Current and ineligible"
    /// means the session has no chromatogram; "stale, whatever it found" means
    /// this completion has no say at all -- and letting it revoke would take the
    /// export away from the run the user is looking at, for a reason nothing on
    /// screen could explain.
    #[test]
    fn a_stale_open_of_an_ineligible_run_does_not_revoke_the_visible_one() {
        let mut slots = ScientificExportSlots::default();
        let older = slots.begin_preview_open();
        let newer = slots.begin_preview_open();
        let visible = slots
            .reconcile_preview_chromatogram(newer, owner(2), Some(other_chromatogram()))
            .expect("the newest open installs");

        // The older read finished, and its run has no chromatogram.
        assert!(
            slots
                .reconcile_preview_chromatogram(older, owner(1), None)
                .is_none(),
        );

        assert_eq!(
            slots.current_chromatogram_token(),
            Some(visible.token()),
            "a completion the session has passed revokes nothing",
        );
    }

    /// The ticket test and the installation never come apart.
    ///
    /// A completion that decided it was current, let the slot go, and installed
    /// afterwards would be the same race with one more step in it: a newer open
    /// can begin in that gap and the older completion would still win. Driven
    /// from two threads through one lock, the invariant is unconditional --
    /// whichever order the lock grants, an open a newer one has passed never
    /// leaves its run as the exportable one.
    #[test]
    fn a_completion_racing_a_newer_open_never_leaves_the_older_run_installed() {
        use std::sync::Mutex;

        for _ in 0..200 {
            let slots = Arc::new(Mutex::new(ScientificExportSlots::default()));
            let older = slots
                .lock()
                .expect("an uncontended lock")
                .begin_preview_open();

            let completing = {
                let slots = Arc::clone(&slots);
                std::thread::spawn(move || {
                    slots
                        .lock()
                        .expect("the other thread does not panic")
                        .reconcile_preview_chromatogram(
                            older,
                            owner(1),
                            Some(seeded_chromatogram()),
                        )
                })
            };
            let opening = {
                let slots = Arc::clone(&slots);
                std::thread::spawn(move || {
                    slots
                        .lock()
                        .expect("the other thread does not panic")
                        .begin_preview_open()
                })
            };
            completing.join().expect("the completion finished");
            opening.join().expect("the newer open began");

            assert_eq!(
                slots
                    .lock()
                    .expect("both threads finished")
                    .current_chromatogram_token(),
                None,
                "either the completion installed and the newer open took it away, or the \
                 completion was already stale -- both leave nothing exportable",
            );
        }
    }

    /// An export already claimed finishes from the run it was begun on.
    ///
    /// ADR 0029's principle, across a preview replacement: the snapshot is taken
    /// when the reservation is issued and is never rebound. Opening another run
    /// while the picker is open moves what a *new* export would name; it does
    /// not cancel a file the user is in the middle of choosing a destination
    /// for, and it does not switch that file onto different science.
    #[test]
    fn a_claimed_chromatogram_export_survives_a_newer_preview_open() {
        let mut slots = ScientificExportSlots::default();
        let visible = preview_open(&mut slots, owner(1), Some(seeded_chromatogram()))
            .expect("a run on screen");
        let visible_token = visible.token().as_wire();
        let reservation = slots
            .begin_chromatogram(
                &visible_token,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            )
            .expect("a reservation");
        let claimed = slots
            .claim_chromatogram(&reservation.as_wire())
            .expect("its dialog");

        // The user opens another run while that dialog is still open.
        let next = slots.begin_preview_open();
        let installed = slots
            .reconcile_preview_chromatogram(next, owner(2), Some(other_chromatogram()))
            .expect("the newer open installs");

        // What is being written is still the run it was begun from.
        assert_eq!(claimed.snapshot.source().scan_count(), 2);
        // And the lane is still committed, so the newly visible run cannot
        // start a second export over the top of it.
        assert_eq!(
            slots.begin_chromatogram(
                &installed.token().as_wire(),
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );

        // Once it ends, the newly visible run exports and the replaced one is
        // stale for anything new.
        slots.begin_write();
        assert!(slots.release_write());
        assert!(
            slots
                .begin_chromatogram(
                    &installed.token().as_wire(),
                    ChromatogramExportFormat::Csv,
                    full_range(),
                    tic_only(),
                    None,
                    None,
                )
                .is_ok(),
        );
        slots.cancel(&reservation.as_wire());
        assert_eq!(
            slots
                .begin_chromatogram_copy(&visible_token, full_range(), tic_only())
                .err(),
            Some(BeginExportRefusal::Stale),
        );
    }

    // ------------------------------------ the linked pair, and what makes it one
    //
    // A linked figure is one operation over two sources that already exist. Same
    // dataset is where the check starts and not where it ends: two snapshots of
    // one run can still describe two different moments, so the pair has to
    // reconcile to *one retained row* by identity before anything is drawn.
    //
    // Retention time is never that identity. Scans may share one, and a lookup
    // by time could not say which of them was selected.

    /// One retained row, named the way these tests read them.
    fn row(index: u64, scan: u64, retention_time: f64, tic: f64, bpi: f64) -> TableRowFacts {
        TableRowFacts::for_test(index, Some(scan), 1, retention_time, false, tic, bpi)
    }

    /// A run of three scans at three distinct retention times.
    ///
    /// Distinct on purpose: it is what lets an assertion about the marker's
    /// position say *which* row supplied it.
    fn paired_chromatogram() -> ChromatogramSource {
        let rows = std::sync::Arc::new(vec![
            row(0, 1, 10.0, 100.0, 40.0),
            row(1, 2, 20.0, 300.0, 120.0),
            row(2, 3, 30.0, 500.0, 220.0),
        ]);
        ChromatogramSource::from_rows(&rows, false).expect("an exportable run")
    }

    fn both_traces() -> TraceSet {
        TraceSet::from_wire(true, true)
    }

    fn no_traces() -> TraceSet {
        TraceSet::from_wire(false, false)
    }

    fn current_range(low: f64, high: f64) -> RangeRequest {
        RangeRequest::from_wire("current", Some(low), Some(high)).expect("a current request")
    }

    /// A current-range request from a viewer that has committed nothing.
    fn current_whole_run() -> RangeRequest {
        RangeRequest::from_wire("current", None, None).expect("a current request with no window")
    }

    /// Figure settings of one height, at a width every figure accepts.
    fn linked_settings(height: u32) -> FigureRenderSettings {
        FigureRenderSettings::from_wire(1_200, height, "light").expect("an accepted figure size")
    }

    /// One session holding a chromatogram and a spectrum of the same run.
    ///
    /// The spectrum is index 1, so the row it must reconcile with is the middle
    /// one -- a position an off-by-one in either direction would miss.
    fn paired_slots() -> (ScientificExportSlots, String, String) {
        let mut slots = ScientificExportSlots::default();
        let spectrum_token = slots
            .install(owner(1), spectrum(1, vec![100.0, 200.0], vec![10.0, 90.0]))
            .token()
            .as_wire();
        let chromatogram_token = slots
            .install_chromatogram(owner(1), paired_chromatogram())
            .token()
            .as_wire();
        (slots, chromatogram_token, spectrum_token)
    }

    /// Begins one linked SVG export, answering the refusal.
    fn begin_linked(
        slots: &mut ScientificExportSlots,
        chromatogram: &str,
        spectrum: &str,
        request: RangeRequest,
        traces: TraceSet,
        settings: FigureRenderSettings,
    ) -> Result<SpectrumReservationId, BeginExportRefusal> {
        slots.begin_linked_figure(
            pair_of(chromatogram, spectrum),
            LinkedFigureFormat::Svg,
            request,
            traces,
            settings,
            None,
        )
    }

    /// The two tokens one linked operation names.
    fn pair_of<'a>(chromatogram: &'a str, spectrum: &'a str) -> LinkedTokens<'a> {
        LinkedTokens {
            chromatogram,
            spectrum,
        }
    }

    /// Whether the lane is free enough for a new scientific export to begin.
    ///
    /// Asked by starting one and returning it, so the probe cannot decide the
    /// next question's answer by leaving a reservation standing.
    fn lane_is_free(slots: &mut ScientificExportSlots, chromatogram: &str) -> bool {
        match slots.begin_chromatogram(
            chromatogram,
            ChromatogramExportFormat::Csv,
            full_range(),
            tic_only(),
            None,
            None,
        ) {
            Ok(reservation) => {
                slots.cancel(&reservation.as_wire());
                true
            }
            Err(_) => false,
        }
    }

    /// Two snapshots of two different runs are not one scan.
    ///
    /// The first thing asked, because two tables of two files can line their
    /// indices up perfectly and still describe nothing in common. Both the save
    /// and the clipboard operation answer it, because they are the same bind.
    #[test]
    fn a_linked_figure_refuses_two_sources_of_different_runs() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(1, vec![100.0, 200.0], vec![10.0, 90.0]))
            .token()
            .as_wire();
        // A second dataset, whose table would answer `row_for_spectrum` happily
        // if ownership were not asked first: it has a row at position 1.
        let chromatogram = slots
            .install_chromatogram(owner(2), paired_chromatogram())
            .token()
            .as_wire();

        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum,
                full_range(),
                both_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::LinkedSourceMismatch),
        );
        assert_eq!(
            slots
                .begin_linked_figure_copy(
                    pair_of(&chromatogram, &spectrum),
                    full_range(),
                    both_traces(),
                    linked_settings(640),
                )
                .err(),
            Some(BeginExportRefusal::LinkedSourceMismatch),
        );
        // And nothing was reserved on the way to refusing.
        assert!(lane_is_free(&mut slots, &chromatogram));
    }

    /// Same owner is necessary and not sufficient.
    ///
    /// The row at the spectrum's position exists and is the wrong row. A lookup
    /// that stopped at "is there a row here" would accept this and draw a
    /// marker at a scan the user did not select; the identity reconciliation is
    /// what refuses it.
    ///
    /// Reachable rather than contrived: a table whose reported indices are not a
    /// gapless ascending run puts a different scan at every position after the
    /// gap, and nothing in the format promises they are.
    #[test]
    fn a_linked_figure_refuses_a_row_whose_identity_does_not_reconcile() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(1, vec![100.0, 200.0], vec![10.0, 90.0]))
            .token()
            .as_wire();
        let rows = std::sync::Arc::new(vec![
            row(0, 1, 10.0, 100.0, 40.0),
            // Position 1, spectrum index 7. Found, and not this spectrum's.
            row(7, 8, 20.0, 300.0, 120.0),
        ]);
        let source = ChromatogramSource::from_rows(&rows, false).expect("an exportable run");
        // The position the lookup uses does hold a row, so what follows is a
        // refusal the identity check produced rather than an empty table.
        assert_eq!(source.scan_count(), 2);
        let chromatogram = slots
            .install_chromatogram(owner(1), source)
            .token()
            .as_wire();

        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum,
                full_range(),
                both_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::LinkedSourceMismatch),
        );
        assert!(lane_is_free(&mut slots, &chromatogram));
    }

    /// A spectrum the retained table has no row for at all is refused.
    #[test]
    fn a_linked_figure_refuses_a_spectrum_beyond_the_retained_table() {
        let mut slots = ScientificExportSlots::default();
        let spectrum = slots
            .install(owner(1), spectrum(9, vec![100.0, 200.0], vec![10.0, 90.0]))
            .token()
            .as_wire();
        let chromatogram = slots
            .install_chromatogram(owner(1), paired_chromatogram())
            .token()
            .as_wire();

        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum,
                full_range(),
                both_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::LinkedSourceMismatch),
        );
    }

    /// Two scans at one retention time are two scans.
    ///
    /// **Retention time is not scan identity.** Rows 1 and 2 share 20.0 here,
    /// and selecting the second must pair with the second: a lookup by time
    /// would find the first and would be wrong in a way no assertion about the
    /// marker's *position* could see, because both rows are at the same
    /// position. What tells them apart is the identity the pair reconciles and
    /// the measured values that row carries.
    #[test]
    fn duplicate_retention_times_pair_by_identity_rather_than_by_time() {
        let rows = std::sync::Arc::new(vec![
            row(0, 1, 10.0, 100.0, 40.0),
            // The first row at 20.0, which a lookup by retention time finds.
            row(1, 2, 20.0, 300.0, 120.0),
            // The second row at 20.0, which is the one selected below.
            row(2, 3, 20.0, 900.0, 700.0),
            row(3, 4, 30.0, 500.0, 220.0),
        ]);
        let source = ChromatogramSource::from_rows(&rows, false).expect("an exportable run");
        let selected = spectrum(2, vec![100.0, 200.0], vec![10.0, 90.0]);

        let matched = source
            .row_for_spectrum(&selected)
            .expect("the second row at that time is this spectrum's row");
        assert_eq!(
            matched.identity().index(),
            2,
            "the row that reconciles, not the first row sharing the time",
        );
        assert!(
            (matched.total_ion_current() - 900.0).abs() < f64::EPSILON,
            "and it carries the second row's own measurement, not the first's",
        );
        assert!(
            (matched.retention_time() - 20.0).abs() < f64::EPSILON,
            "both rows are at 20.0, which is exactly why the time cannot decide",
        );

        // And the same answer through the operation an export actually uses.
        let mut slots = ScientificExportSlots::default();
        let spectrum_token = slots.install(owner(1), selected).token().as_wire();
        let chromatogram_token = slots
            .install_chromatogram(owner(1), source)
            .token()
            .as_wire();
        let reservation = begin_linked(
            &mut slots,
            &chromatogram_token,
            &spectrum_token,
            full_range(),
            both_traces(),
            linked_settings(640),
        )
        .expect("a pair of one run");
        let claimed = slots
            .claim_linked_figure(&reservation.as_wire())
            .expect("its dialog");
        assert_eq!(claimed.selected_index, 2);
        assert!((claimed.selected_retention_time - 20.0).abs() < f64::EPSILON);
    }

    /// The marker's coordinate is the matched retained row's own number.
    ///
    /// Not the spectrum's reported retention time, which is a different reading
    /// of the same quantity and is 0.0 for the spectra these tests build, and
    /// not anything an interface could send: the bind takes no retention time
    /// at all. A figure whose marker came from either would be asserting a scan
    /// was acquired when it was not.
    #[test]
    fn the_marker_position_comes_from_the_retained_row() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        let reservation = begin_linked(
            &mut slots,
            &chromatogram,
            &spectrum_token,
            full_range(),
            both_traces(),
            linked_settings(640),
        )
        .expect("a pair of one run");
        let claimed = slots
            .claim_linked_figure(&reservation.as_wire())
            .expect("its dialog");

        assert_eq!(claimed.selected_index, 1);
        assert!(
            (claimed.selected_retention_time - 20.0).abs() < f64::EPSILON,
            "the row's own retention time, which is {}",
            claimed.selected_retention_time,
        );
        // The other reading of the same quantity, which is not what was used.
        assert!(
            claimed.spectrum.spectrum().retention_time().value().abs() < f64::EPSILON,
            "the spectrum reports its own retention time and it is not this one",
        );
    }

    // ------------------------------------------------------------ the range matrix
    //
    // Full, a current range that resolves to the whole run, and a current range
    // with the selected scan at its low edge, at its high edge, inside it,
    // below it and above it. Inclusive edges, no epsilon, and a range the
    // selected scan is outside of is refused rather than widened.

    /// Every range a linked figure may be asked for, and what it answers.
    ///
    /// The run is 10.0, 20.0, 30.0, and the spectrum `paired_slots` installs is
    /// index 1, at 20.0.
    #[test]
    fn the_selected_scan_must_be_inside_the_range_that_would_be_drawn() {
        for (request, what) in [
            (full_range(), "the whole run"),
            (current_whole_run(), "a viewer that has committed nothing"),
            (
                current_range(20.0, 30.0),
                "the selected scan at the low edge",
            ),
            (
                current_range(10.0, 20.0),
                "the selected scan at the high edge",
            ),
            (current_range(10.0, 30.0), "the selected scan inside"),
        ] {
            let (mut slots, chromatogram, spectrum_token) = paired_slots();
            let reservation = begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum_token,
                request,
                both_traces(),
                linked_settings(640),
            )
            .unwrap_or_else(|refusal| panic!("{what} is a linked figure: {refusal:?}"));
            let claimed = slots
                .claim_linked_figure(&reservation.as_wire())
                .expect("its dialog");
            assert!(
                claimed.selected_retention_time >= claimed.range.domain().low()
                    && claimed.selected_retention_time <= claimed.range.domain().high(),
                "{what}: the marker is inside the panel that carries it",
            );
        }

        // Index 0 sits at 10.0 and index 2 at 30.0, so the first case selects
        // below its range and the second selects above it.
        for (index, request, what) in [
            (0, current_range(20.0, 30.0), "a scan below the range"),
            (2, current_range(10.0, 20.0), "a scan above the range"),
        ] {
            let mut slots = ScientificExportSlots::default();
            let spectrum_token = slots
                .install(
                    owner(1),
                    spectrum(index, vec![100.0, 200.0], vec![10.0, 90.0]),
                )
                .token()
                .as_wire();
            let chromatogram = slots
                .install_chromatogram(owner(1), paired_chromatogram())
                .token()
                .as_wire();

            assert_eq!(
                begin_linked(
                    &mut slots,
                    &chromatogram,
                    &spectrum_token,
                    request,
                    both_traces(),
                    linked_settings(640),
                ),
                Err(BeginExportRefusal::SelectedScanOutsideRange),
                "{what} is refused rather than drawn",
            );
            // Nothing was reserved on the way to refusing, so the refusal costs
            // the session nothing and the next export begins normally.
            assert!(
                lane_is_free(&mut slots, &chromatogram),
                "{what}: no reservation",
            );
        }
    }

    /// A current range is carried exactly as it was asked for.
    ///
    /// No epsilon on the edges and no widening to fit the selection: what the
    /// export writes is the window the viewer committed to, and the scope it
    /// records is the one the user chose.
    #[test]
    fn an_accepted_linked_range_is_neither_clamped_nor_widened() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        let reservation = begin_linked(
            &mut slots,
            &chromatogram,
            &spectrum_token,
            current_range(15.0, 25.0),
            both_traces(),
            linked_settings(640),
        )
        .expect("a range the selected scan is inside");
        let claimed = slots
            .claim_linked_figure(&reservation.as_wire())
            .expect("its dialog");

        assert!((claimed.range.domain().low() - 15.0).abs() < f64::EPSILON);
        assert!((claimed.range.domain().high() - 25.0).abs() < f64::EPSILON);
        assert_eq!(claimed.range.scope(), RangeScope::Current);
        assert!(
            !claimed.range.covers_everything(),
            "a window inside the run is not the run",
        );
    }

    /// A current-range request with no window is the whole run, and says so.
    #[test]
    fn a_current_range_with_no_window_stays_a_current_range_export() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        let reservation = begin_linked(
            &mut slots,
            &chromatogram,
            &spectrum_token,
            current_whole_run(),
            both_traces(),
            linked_settings(640),
        )
        .expect("a viewer that has committed nothing still exports");
        let claimed = slots
            .claim_linked_figure(&reservation.as_wire())
            .expect("its dialog");

        assert_eq!(claimed.range.scope(), RangeScope::Current);
        assert!(claimed.range.covers_everything());
        assert!((claimed.range.domain().low() - 10.0).abs() < f64::EPSILON);
        assert!((claimed.range.domain().high() - 30.0).abs() < f64::EPSILON);
    }

    /// A range the run does not have is refused rather than clamped to one.
    #[test]
    fn a_linked_range_outside_the_run_is_refused() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum_token,
                current_range(0.0, 30.0),
                both_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::RangeOutsideSource),
        );
    }

    // ---------------------------------------------------------- 259 and 260

    /// Two panels need the height two panels need.
    ///
    /// The contract computes both floors from the same two constants, so this
    /// pins the *boundary* rather than a number written down twice: 259 is
    /// refused for a linked figure and 260 is accepted.
    #[test]
    fn a_linked_figure_needs_the_two_panel_minimum_height() {
        assert!(
            (two_panel_minimum_height() - 260.0).abs() < f64::EPSILON,
            "the contract's own arithmetic is {}",
            two_panel_minimum_height(),
        );

        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum_token,
                full_range(),
                both_traces(),
                linked_settings(259),
            ),
            Err(BeginExportRefusal::FigureTooShort),
        );
        // Refused before anything was reserved, so a figure that could not be
        // built never opens a dialog and never wedges the lane.
        assert!(lane_is_free(&mut slots, &chromatogram));
        // The clipboard operation answers the same, and it is the same bind.
        assert_eq!(
            slots
                .begin_linked_figure_copy(
                    pair_of(&chromatogram, &spectrum_token),
                    full_range(),
                    both_traces(),
                    linked_settings(259),
                )
                .err(),
            Some(BeginExportRefusal::FigureTooShort),
        );

        let reservation = begin_linked(
            &mut slots,
            &chromatogram,
            &spectrum_token,
            full_range(),
            both_traces(),
            linked_settings(260),
        )
        .expect("the two-panel minimum is a height a linked figure is drawn at");
        assert!(slots.claim_linked_figure(&reservation.as_wire()).is_some());
    }

    /// The single-panel minimum is untouched by the two-panel one.
    ///
    /// Both single-source exports still begin at 259 and at the one-panel floor
    /// itself. A linked figure needing more room is not a reason for a spectrum
    /// to need it.
    #[test]
    fn the_single_panel_minimum_height_is_unchanged() {
        for height in [180, 259] {
            let (mut slots, chromatogram, spectrum_token) = paired_slots();
            let reservation = slots
                .begin(
                    &spectrum_token,
                    SpectrumExportFormat::Svg,
                    SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                    linked_settings(height),
                    None,
                )
                .unwrap_or_else(|refusal| panic!("a spectrum at {height}: {refusal:?}"));
            assert!(slots.cancel(&reservation.as_wire()));

            let reservation = slots
                .begin_chromatogram(
                    &chromatogram,
                    ChromatogramExportFormat::Svg,
                    full_range(),
                    tic_only(),
                    Some(linked_settings(height)),
                    None,
                )
                .unwrap_or_else(|refusal| panic!("a chromatogram at {height}: {refusal:?}"));
            assert!(slots.cancel(&reservation.as_wire()));
        }
    }

    /// A figure with nothing on screen to draw is refused, as the single-source
    /// figure already is.
    #[test]
    fn a_linked_figure_with_both_traces_hidden_is_refused() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum_token,
                full_range(),
                no_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::NoVisibleTrace),
        );
        assert!(lane_is_free(&mut slots, &chromatogram));
    }

    // ------------------------------------------- three kinds, nine claims

    /// The three scientific reservation kinds, by the name a reader uses.
    const RESERVATION_KINDS: [&str; 3] = ["spectrum", "chromatogram", "linked"];

    /// Reserves the lane for one of the three kinds.
    fn reserve_kind(
        slots: &mut ScientificExportSlots,
        kind: &str,
        chromatogram: &str,
        spectrum: &str,
    ) -> SpectrumReservationId {
        match kind {
            "spectrum" => slots
                .begin(
                    spectrum,
                    SpectrumExportFormat::Svg,
                    SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                    defaults(),
                    None,
                )
                .expect("a spectrum reservation"),
            "chromatogram" => slots
                .begin_chromatogram(
                    chromatogram,
                    ChromatogramExportFormat::Svg,
                    full_range(),
                    tic_only(),
                    Some(defaults()),
                    None,
                )
                .expect("a chromatogram reservation"),
            _ => slots
                .begin_linked_figure(
                    pair_of(chromatogram, spectrum),
                    LinkedFigureFormat::Svg,
                    full_range(),
                    both_traces(),
                    defaults(),
                    None,
                )
                .expect("a linked reservation"),
        }
    }

    /// Claims one reservation through the command one kind names, and answers
    /// whether that command accepted it.
    fn claim_kind(slots: &mut ScientificExportSlots, kind: &str, reservation: &str) -> bool {
        match kind {
            "spectrum" => slots.claim_spectrum(reservation).is_some(),
            "chromatogram" => slots.claim_chromatogram(reservation).is_some(),
            _ => slots.claim_linked_figure(reservation).is_some(),
        }
    }

    /// Every reservation is claimable by its own command and by no other.
    ///
    /// Nine cases, and the six refusals are what this is for. Each save command
    /// names the kind it is for, and a reservation of another kind is a
    /// perfectly well-formed identifier for it -- the three share one counter,
    /// so a document that reloaded and replayed a stored one reaches exactly
    /// this.
    ///
    /// **The kind is checked before the lane is marked claimed.** Marking it on
    /// the way to refusing would leave the lane committed with no dialog, no
    /// writer and nothing to cancel it, and every later scientific export of the
    /// session would be refused as "already exporting" until the application was
    /// restarted. So each wrong-kind case asserts three separate things: the
    /// refusal, that the reservation is still claimable by its own command, and
    /// that a later export can still begin.
    #[test]
    fn every_reservation_is_claimable_by_its_own_command_and_by_no_other() {
        for reserved in RESERVATION_KINDS {
            for claiming in RESERVATION_KINDS {
                let (mut slots, chromatogram, spectrum_token) = paired_slots();
                let reservation =
                    reserve_kind(&mut slots, reserved, &chromatogram, &spectrum_token).as_wire();

                assert_eq!(
                    claim_kind(&mut slots, claiming, &reservation),
                    reserved == claiming,
                    "a {reserved} reservation claimed as a {claiming} export",
                );
                if reserved != claiming {
                    assert!(
                        claim_kind(&mut slots, reserved, &reservation),
                        "a {reserved} reservation refused as a {claiming} export is still \
                         claimable by its own command",
                    );
                }

                // And the lane is not wedged by any of the nine: cancelling the
                // claimed reservation returns it, and the next export begins.
                assert!(
                    slots.cancel(&reservation),
                    "{reserved}/{claiming}: cancellable",
                );
                assert!(
                    lane_is_free(&mut slots, &chromatogram),
                    "{reserved}/{claiming}: a later scientific export still begins",
                );
            }
        }
    }

    /// A wrong-kind claim leaves the lane exactly as it found it.
    ///
    /// The sharper half of the case above: after the refusal the reservation is
    /// still *unclaimed*, so the pre-existing supersede rule still applies to it
    /// -- which a lane marked claimed on the way to refusing would have turned
    /// into "already exporting" for the rest of the session.
    #[test]
    fn a_wrong_kind_claim_neither_commits_nor_releases_the_lane() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        let reservation =
            reserve_kind(&mut slots, "linked", &chromatogram, &spectrum_token).as_wire();

        assert!(!claim_kind(&mut slots, "chromatogram", &reservation));
        let superseding = reserve_kind(&mut slots, "spectrum", &chromatogram, &spectrum_token);
        assert!(
            !claim_kind(&mut slots, "linked", &reservation),
            "the superseded linked reservation can no longer be claimed",
        );
        assert!(slots.claim_spectrum(&superseding.as_wire()).is_some());
    }

    /// A linked figure holds the one lane against both of the surfaces it draws.
    #[test]
    fn a_claimed_linked_export_refuses_both_single_source_exports() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        let reservation =
            reserve_kind(&mut slots, "linked", &chromatogram, &spectrum_token).as_wire();
        assert!(claim_kind(&mut slots, "linked", &reservation));

        assert_eq!(
            slots.begin(
                &spectrum_token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        assert_eq!(
            slots.begin_chromatogram(
                &chromatogram,
                ChromatogramExportFormat::Csv,
                full_range(),
                tic_only(),
                None,
                None,
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
        assert_eq!(
            slots
                .begin_copy(
                    &spectrum_token,
                    SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
                )
                .err(),
            Some(BeginExportRefusal::AlreadyExporting),
        );
        assert_eq!(
            slots
                .begin_chromatogram_copy(&chromatogram, full_range(), tic_only())
                .err(),
            Some(BeginExportRefusal::AlreadyExporting),
        );
    }

    /// And the reverse: neither single-source export lets a linked one begin.
    #[test]
    fn a_claimed_single_source_export_refuses_a_linked_one() {
        for holder in ["spectrum", "chromatogram"] {
            let (mut slots, chromatogram, spectrum_token) = paired_slots();
            let reservation =
                reserve_kind(&mut slots, holder, &chromatogram, &spectrum_token).as_wire();
            assert!(claim_kind(&mut slots, holder, &reservation));

            assert_eq!(
                begin_linked(
                    &mut slots,
                    &chromatogram,
                    &spectrum_token,
                    full_range(),
                    both_traces(),
                    linked_settings(640),
                ),
                Err(BeginExportRefusal::AlreadyExporting),
                "a claimed {holder} export holds the lane against a linked figure",
            );
            assert_eq!(
                slots
                    .begin_linked_figure_copy(
                        pair_of(&chromatogram, &spectrum_token),
                        full_range(),
                        both_traces(),
                        linked_settings(640),
                    )
                    .err(),
                Some(BeginExportRefusal::AlreadyExporting),
                "and against a linked copy",
            );
        }
    }

    /// Either token going stale refuses the pair, and says so as one fact.
    ///
    /// A reader cannot act on *which* of the two moved -- both mean the figure
    /// they asked for is not the one on screen now -- so both answer the same
    /// refusal.
    #[test]
    fn a_stale_half_refuses_the_whole_pair() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        slots.forget();
        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum_token,
                full_range(),
                both_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::Stale),
        );

        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        slots.forget_chromatogram();
        assert_eq!(
            begin_linked(
                &mut slots,
                &chromatogram,
                &spectrum_token,
                full_range(),
                both_traces(),
                linked_settings(640),
            ),
            Err(BeginExportRefusal::Stale),
        );
    }

    /// The pair a claimed export holds is the pair it began on.
    ///
    /// Selecting another scan while the dialog is open moves what is on screen
    /// and moves nothing about the file being written.
    #[test]
    fn a_claimed_linked_export_keeps_the_pair_it_began_on() {
        let (mut slots, chromatogram, spectrum_token) = paired_slots();
        let reservation = begin_linked(
            &mut slots,
            &chromatogram,
            &spectrum_token,
            full_range(),
            both_traces(),
            linked_settings(640),
        )
        .expect("a pair of one run");
        let claimed = slots
            .claim_linked_figure(&reservation.as_wire())
            .expect("its dialog");

        // The user selects another scan while the dialog is open.
        let newer = slots.install(owner(1), spectrum(2, vec![300.0, 400.0], vec![5.0, 6.0]));
        assert_ne!(newer.token().as_wire(), spectrum_token);

        assert_eq!(claimed.selected_index, 1);
        assert!((claimed.selected_retention_time - 20.0).abs() < f64::EPSILON);
        assert_eq!(claimed.spectrum.index(), 1);
    }

    // ------------------------------------------- the single-panel documents
    //
    // M4.4 factored `spectrum_panel` out of `figure_spec` so a linked figure's
    // lower panel could be the *same* panel this export draws. A refactor that
    // changed what the single-panel export writes would be a silent regression
    // in a document users have already saved, and no assertion about a
    // property of the figure would notice a difference in its bytes.
    //
    // So what is pinned is the document. The fixture was rendered on canonical
    // main, before the refactor, and is byte-identical after it.

    /// The spectrum the golden document was rendered from.
    ///
    /// Chosen to exercise the parts a refactor could disturb: an index in the
    /// title, fractional and integral m/z, a zero intensity, and a value that
    /// is not the largest so the axis has somewhere to end.
    fn golden_spectrum() -> SelectedSpectrumResult {
        spectrum(
            7,
            vec![100.5, 200.25, 300.0, 400.125, 500.0],
            vec![10.0, 90.0, 0.0, 45.5, 22.25],
        )
    }

    /// The selected-spectrum SVG is byte for byte what it was.
    #[test]
    fn the_single_panel_spectrum_document_is_unchanged() {
        let document = svg_document(&golden_spectrum(), defaults(), ResolvedSpectrumRange::Full)
            .expect("specifiable");
        assert_eq!(
            document,
            include_str!("../../../../../fixtures/plot-golden/spectrum-full-source.svg"),
            "the single-panel spectrum export is unchanged by the linked figure",
        );
    }

    // --------------------------------------------- M5.3: full source, or one
    // committed m/z range
    //
    // Every case below asks the same question in a different place: does this
    // export describe the retained spectrum and the range that was agreed to,
    // or something that merely looks like it. The two things that could stand
    // in for the science -- a screen projection and a transient gesture -- do
    // not appear in this module at all, which is the strongest form the answer
    // takes.

    /// A spectrum whose peaks sit either side of a window, for the range tests.
    ///
    /// The nine-million peak is deliberately placed so the range tests can put
    /// it outside their window: it is the value that must stay in the document,
    /// stay out of that range's records, and not set the scale of a drawing
    /// that does not show it.
    fn ranged_spectrum() -> SelectedSpectrumResult {
        spectrum(
            42,
            vec![100.0, 110.0, 120.0, 130.0, 140.0],
            vec![5.0, 20.0, 9_000_000.0, 8.0, 3.0],
        )
    }

    /// One retained snapshot of a spectrum, as the slot would install it.
    fn retained(source: SelectedSpectrumResult) -> SpectrumSnapshot {
        ScientificExportSlots::default().install(owner(1), source)
    }

    /// The range a current request for `[low, high]` resolves to.
    fn resolve_current(snapshot: &SpectrumSnapshot, low: f64, high: f64) -> ResolvedSpectrumRange {
        snapshot
            .resolve(
                SpectrumRangeRequest::from_wire("current", Some(low), Some(high))
                    .expect("a well-formed current request"),
            )
            .expect("a range the source has")
    }

    /// One preamble value out of a data document.
    fn preamble_value(document: &str, key: &str, delimiter: char) -> String {
        document
            .lines()
            .take_while(|line| line.starts_with('#'))
            .find_map(|line| {
                let (name, value) = line[1..].split_once(delimiter)?;
                (name == key).then(|| value.to_owned())
            })
            .unwrap_or_else(|| panic!("the document carries #{key}"))
    }

    /// A current range with no narrower window is the whole admitted domain.
    ///
    /// Not a full-source export wearing another name, and not a subrange
    /// invented to make the option look different: Rust resolves it from the
    /// snapshot's own domain, and it stays a current-range export because that
    /// is what was chosen.
    #[test]
    fn a_current_range_with_nothing_committed_resolves_to_the_whole_domain() {
        let snapshot = retained(ranged_spectrum());
        let resolved = snapshot
            .resolve(SpectrumRangeRequest::from_wire("current", None, None).expect("a request"))
            .expect("the whole admitted domain");
        assert_eq!(
            resolved,
            ResolvedSpectrumRange::Current(Domain::new(100.0, 140.0).expect("an interval")),
        );
        assert_eq!(resolved.scope(), SpectrumRangeScope::Current);
    }

    /// A committed subrange resolves to exactly itself.
    #[test]
    fn a_committed_subrange_resolves_to_exactly_that_window() {
        let snapshot = retained(ranged_spectrum());
        assert_eq!(
            resolve_current(&snapshot, 105.0, 135.0),
            ResolvedSpectrumRange::Current(Domain::new(105.0, 135.0).expect("an interval")),
        );
    }

    /// Both edges are inclusive, and a peak exactly on one is exported.
    #[test]
    fn a_current_range_includes_a_peak_on_either_edge() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let document = data_document(
            &source,
            SpectrumExportFormat::Csv,
            resolve_current(&snapshot, 110.0, 130.0),
        )
        .expect("a document");
        assert_eq!(
            records(&document, ','),
            vec![(110.0, 20.0), (120.0, 9_000_000.0), (130.0, 8.0)],
            "the observations at both edges are inside the range",
        );
    }

    /// A zero-width range is valid, and keeps a peak measured exactly there.
    #[test]
    fn a_zero_width_current_range_is_valid() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let resolved = resolve_current(&snapshot, 120.0, 120.0);
        assert_eq!(
            resolved,
            ResolvedSpectrumRange::Current(Domain::new(120.0, 120.0).expect("an interval")),
        );
        let document =
            data_document(&source, SpectrumExportFormat::Csv, resolved).expect("a document");
        assert_eq!(
            records(&document, ','),
            vec![(120.0, 9_000_000.0)],
            "a range of one m/z keeps the observation measured there",
        );
    }

    /// A valid range holding no reported peak is a successful empty document.
    ///
    /// Not an error, and nothing is interpolated to avoid saying so: a window
    /// of a spectrum may truthfully contain nothing.
    #[test]
    fn an_empty_current_range_writes_a_document_with_no_records() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let resolved = resolve_current(&snapshot, 121.0, 129.0);
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            let document = data_document(&source, format, resolved).expect("a document");
            assert!(
                records(&document, delimiter).is_empty(),
                "no observation lies in this range, and none is invented for it",
            );
            assert_eq!(
                preamble_value(&document, "exported_point_count", delimiter),
                "0",
            );
            assert_eq!(
                preamble_value(&document, "source_point_count", delimiter),
                "5",
            );
        }
    }

    /// An empty current range still draws, as an empty figure.
    #[test]
    fn an_empty_current_range_is_a_figure_rather_than_a_refusal() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let figure = figure_spec(
            &source,
            defaults(),
            resolve_current(&snapshot, 121.0, 129.0),
        )
        .expect("an empty range is a figure, not a failure");
        let panel = &figure.panels()[0];
        assert_eq!(
            panel.visible_domain(),
            Some(Domain::new(121.0, 129.0).expect("an interval")),
        );
        assert_eq!(
            panel.visible_value_domain(),
            Some(Domain::new(0.0, 0.0).expect("an interval")),
            "an empty window scales to the baseline rather than to a value it does not show",
        );
        assert_eq!(
            panel.series()[0].x().len(),
            5,
            "the complete source stays the figure's series; only the window narrows",
        );
    }

    /// A range the retained spectrum does not have is refused, not clamped.
    #[test]
    fn a_current_range_outside_the_source_is_refused_rather_than_clamped() {
        let snapshot = retained(ranged_spectrum());
        for (low, high) in [(90.0, 130.0), (110.0, 150.0), (0.0, 1.0), (200.0, 300.0)] {
            assert_eq!(
                snapshot.resolve(
                    SpectrumRangeRequest::from_wire("current", Some(low), Some(high))
                        .expect("a well-formed request"),
                ),
                Err(SpectrumRangeRefusal::OutsideSource),
                "a window this spectrum does not have is a request about something else",
            );
        }
    }

    /// A pair that is not an interval never reaches a snapshot at all.
    #[test]
    fn a_malformed_range_is_unrepresentable() {
        for (scope, low, high) in [
            // Inverted.
            ("current", Some(130.0), Some(110.0)),
            // Not finite.
            ("current", Some(f64::NAN), Some(120.0)),
            ("current", Some(110.0), Some(f64::INFINITY)),
            // Half present: not a window, and choosing the other end would be
            // inventing the range the caller failed to state.
            ("current", Some(110.0), None),
            ("current", None, Some(130.0)),
            // A full-source export needs no window, so carrying one is a
            // contradiction rather than extra information.
            ("full", Some(110.0), Some(130.0)),
            ("full", Some(110.0), None),
            // A scope this boundary does not know.
            ("visible", None, None),
            ("", None, None),
        ] {
            assert_eq!(
                SpectrumRangeRequest::from_wire(scope, low, high),
                None,
                "{scope} {low:?} {high:?} is not a range this boundary accepts",
            );
        }
    }

    /// A current range asked of a spectrum with no viewport domain is refused.
    ///
    /// Never answered with the full source under a current-range name, and
    /// nothing is sorted, reordered or read from the reported bounds to
    /// manufacture the domain the contract declined to establish.
    #[test]
    fn a_current_range_on_a_domain_refused_spectrum_is_refused() {
        // Descending m/z: legal mzML, and a series the figure contract refuses.
        let snapshot = retained(spectrum(3, vec![200.0, 100.0], vec![1.0, 2.0]));
        assert!(matches!(
            snapshot.viewport_domain(),
            ViewportDomain::Refused(projection::DomainRefusal::SourceNotOrdered),
        ));
        for request in [
            SpectrumRangeRequest::from_wire("current", None, None).expect("a request"),
            SpectrumRangeRequest::from_wire("current", Some(100.0), Some(200.0))
                .expect("a request"),
        ] {
            assert_eq!(
                snapshot.resolve(request),
                Err(SpectrumRangeRefusal::NoViewportDomain(
                    projection::DomainRefusal::SourceNotOrdered
                )),
            );
        }
    }

    /// The same spectrum's full-source export is untouched by that refusal.
    ///
    /// A viewport refusal is a fact about drawability, never about the source:
    /// the data documents still write, because one record per retained point in
    /// source order needs no ordering at all.
    #[test]
    fn a_domain_refused_spectrum_still_exports_its_full_source_data() {
        let source = spectrum(3, vec![200.0, 100.0], vec![1.0, 2.0]);
        let snapshot = retained(source.clone());
        assert_eq!(
            snapshot.resolve(
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            ),
            Ok(ResolvedSpectrumRange::Full),
            "a full-source export needs no domain and is not asked for one",
        );
        let document = data_document(
            &source,
            SpectrumExportFormat::Csv,
            ResolvedSpectrumRange::Full,
        )
        .expect("a document");
        assert_eq!(
            records(&document, ','),
            vec![(200.0, 1.0), (100.0, 2.0)],
            "in source order, which is not m/z order and is not made into one",
        );
        assert_eq!(preamble_value(&document, "schema_version", ','), "1");
    }

    /// A range document carries source observations in source order.
    ///
    /// The rule is order *preservation*, not "sort by m/z". For an admitted
    /// source the two happen to agree, and this pins which of them is the rule.
    #[test]
    fn a_current_range_preserves_source_order_and_sorts_nothing() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let document = data_document(
            &source,
            SpectrumExportFormat::Csv,
            resolve_current(&snapshot, 100.0, 140.0),
        )
        .expect("a document");
        assert_eq!(
            records(&document, ','),
            vec![
                (100.0, 5.0),
                (110.0, 20.0),
                (120.0, 9_000_000.0),
                (130.0, 8.0),
                (140.0, 3.0),
            ],
        );
    }

    /// No boundary value is interpolated into a data document.
    ///
    /// A range whose edges fall between two measured m/z contains the
    /// observations inside it and nothing else. A row for an edge would assert
    /// a measurement the instrument never made -- and this is the one place
    /// M4.3's chromatogram rule deliberately does not carry across, because a
    /// chromatogram is a polyline and a spectrum here is not.
    #[test]
    fn a_current_range_never_invents_a_boundary_record() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let document = data_document(
            &source,
            SpectrumExportFormat::Csv,
            resolve_current(&snapshot, 115.0, 125.0),
        )
        .expect("a document");
        assert_eq!(
            records(&document, ','),
            vec![(120.0, 9_000_000.0)],
            "only the measured peak inside the window; no value at 115 or 125",
        );
    }

    /// A discrete current figure draws only the peaks the range holds.
    ///
    /// The series is still the complete source -- the science is not deleted to
    /// make a picture -- and the window is what decides what is drawn. The
    /// renderer filters discrete marks rather than clipping them, so no line is
    /// drawn through an m/z nobody measured.
    #[test]
    fn a_discrete_current_figure_draws_only_real_in_range_peaks() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let figure = figure_spec(
            &source,
            defaults(),
            resolve_current(&snapshot, 105.0, 135.0),
        )
        .expect("specifiable");
        let panel = &figure.panels()[0];
        assert!(
            matches!(
                panel.kind(),
                PlotKind::Spectrum {
                    representation: SpectrumRepresentation::Unreported
                }
            ),
            "the representation is the one the boundary reports, not one inferred",
        );
        assert!(
            !panel.joins(&panel.series()[0]),
            "an unreported representation draws discrete marks, never a joined trace",
        );
        assert_eq!(panel.series()[0].scope(), DataScope::FullSource);
        assert_eq!(
            panel.series()[0].x(),
            &[100.0, 110.0, 120.0, 130.0, 140.0],
            "the complete measurement stays in the document",
        );
        assert_eq!(
            panel.visible_domain(),
            Some(Domain::new(105.0, 135.0).expect("an interval")),
        );
    }

    /// An off-window peak does not set the scale of the window that is drawn.
    ///
    /// Nine million at m/z 120 must stay in the source series and stay out of
    /// the value axis of a window that does not contain it -- otherwise an
    /// ordinary range is flattened into a line along the bottom of the panel.
    #[test]
    fn an_off_window_peak_does_not_scale_a_current_figure() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let figure = figure_spec(
            &source,
            defaults(),
            resolve_current(&snapshot, 125.0, 140.0),
        )
        .expect("specifiable");
        let panel = &figure.panels()[0];
        assert_eq!(
            panel.value_domain(),
            Domain::new(0.0, 9_000_000.0).expect("an interval"),
            "the whole measurement is still declared, so it returns when the window widens",
        );
        assert_eq!(
            panel.visible_value_domain(),
            Some(Domain::new(0.0, 8.0).expect("an interval")),
            "the axis is scaled to what this window can legitimately show",
        );
        assert_eq!(
            panel.displayed_value_domain(),
            Domain::new(0.0, 8.0).expect("an interval"),
        );
    }

    /// A window holding negative signal keeps zero and its own minimum.
    #[test]
    fn a_current_window_of_negative_values_keeps_the_zero_baseline() {
        let source = spectrum(
            4,
            vec![10.0, 20.0, 30.0, 40.0],
            vec![-4.0, -9.0, 500.0, 2.0],
        );
        let snapshot = retained(source.clone());
        let figure = figure_spec(&source, defaults(), resolve_current(&snapshot, 10.0, 20.0))
            .expect("specifiable");
        assert_eq!(
            figure.panels()[0].visible_value_domain(),
            Some(Domain::new(-9.0, 0.0).expect("an interval")),
            "a stick's length is read from zero, so zero stays on the axis",
        );

        // And a window holding both signs keeps both.
        let both = figure_spec(&source, defaults(), resolve_current(&snapshot, 20.0, 40.0))
            .expect("specifiable");
        assert_eq!(
            both.panels()[0].visible_value_domain(),
            Some(Domain::new(-9.0, 500.0).expect("an interval")),
        );
    }

    /// A current range covering the whole spectrum declares no window.
    ///
    /// It canonicalizes to the figure a full-source export draws, because a
    /// window that narrows nothing is a narrowing the figure does not have.
    #[test]
    fn a_current_range_covering_everything_declares_no_window() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let figure = figure_spec(
            &source,
            defaults(),
            resolve_current(&snapshot, 100.0, 140.0),
        )
        .expect("specifiable");
        assert_eq!(figure.panels()[0].visible_domain(), None);
        assert_eq!(figure.panels()[0].visible_value_domain(), None);
    }

    /// The current-range data document is schema 2, and says everything a
    /// reader needs with no interface to ask.
    #[test]
    fn the_current_range_document_carries_its_own_schema_and_both_counts() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let document = data_document(
            &source,
            SpectrumExportFormat::Csv,
            resolve_current(&snapshot, 110.0, 130.0),
        )
        .expect("a document");
        for (key, value) in [
            ("format", "mscanvas_spectrum_export"),
            ("schema_version", "2"),
            ("spectrum_index", "42"),
            ("range_scope", "current"),
            ("source_point_count", "5"),
            ("exported_point_count", "3"),
            ("range_low", "110"),
            ("range_high", "130"),
            ("representation", "unreported"),
            ("mz_unit", "unreported"),
            ("intensity_unit", "unreported"),
        ] {
            assert_eq!(preamble_value(&document, key, ','), value, "#{key}");
        }
        assert!(
            !document.contains("#point_count"),
            "the ambiguous single count belongs to version 1 and is not carried into version 2",
        );
    }

    /// The full-source data document is schema 1, unchanged.
    #[test]
    fn the_full_source_document_stays_schema_one() {
        let document = data_document(
            &ranged_spectrum(),
            SpectrumExportFormat::Csv,
            ResolvedSpectrumRange::Full,
        )
        .expect("a document");
        assert_eq!(preamble_value(&document, "schema_version", ','), "1");
        assert_eq!(preamble_value(&document, "point_count", ','), "5");
        for absent in [
            "range_scope",
            "range_low",
            "range_high",
            "exported_point_count",
        ] {
            assert!(
                !document.contains(&format!("#{absent}")),
                "version 1 gains no field: #{absent}",
            );
        }
    }

    /// Both scopes write the same record for the same measurement.
    ///
    /// One writer, one record loop. A full document and a range document over
    /// the same observations are the same bytes below the header, so the two
    /// cannot drift into disagreeing about how a number is written.
    #[test]
    fn both_scopes_write_a_measurement_identically() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let full = data_document(
            &source,
            SpectrumExportFormat::Csv,
            ResolvedSpectrumRange::Full,
        )
        .expect("a document");
        let current = data_document(
            &source,
            SpectrumExportFormat::Csv,
            resolve_current(&snapshot, 100.0, 140.0),
        )
        .expect("a document");
        assert_eq!(records(&full, ','), records(&current, ','));
    }

    /// A range document has no field that could need a quoting rule.
    #[test]
    fn a_current_range_document_needs_no_quoting_rule() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        for (format, delimiter) in [
            (SpectrumExportFormat::Csv, ','),
            (SpectrumExportFormat::Tsv, '\t'),
        ] {
            let document = data_document(&source, format, resolve_current(&snapshot, 105.0, 135.0))
                .expect("a document");
            assert!(
                !document.contains('"') && !document.contains('\r'),
                "no field can contain a quote or a stray line ending",
            );
            for line in document.lines() {
                assert!(
                    line.split(delimiter).count() >= 2,
                    "every line splits into fields: {line}",
                );
            }
        }
    }

    /// A current figure says what it is, and does not claim to be a reduction.
    #[test]
    fn a_current_figure_caption_names_the_range_and_both_counts() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        let figure = figure_spec(
            &source,
            defaults(),
            resolve_current(&snapshot, 110.0, 130.0),
        )
        .expect("specifiable");
        let caption = figure.caption().expect("a caption").as_str().to_owned();
        assert!(caption.contains("m/z 110 to 130"), "{caption}");
        assert!(caption.contains("3 of 5 measured points"), "{caption}");
        assert!(caption.contains("complete spectrum"), "{caption}");
        assert!(
            caption.contains("nothing is interpolated"),
            "the reader is told the edges hold no invented value: {caption}",
        );
        let lowered = caption.to_lowercase();
        assert!(
            !lowered.contains("screen") && !lowered.contains("reduc"),
            "a scientific figure is never labelled as a drawing of a screen: {caption}",
        );
    }

    /// The full figure's caption is exactly the sentence it always was.
    #[test]
    fn the_full_source_caption_is_unchanged() {
        let figure = figure_spec(&ranged_spectrum(), defaults(), ResolvedSpectrumRange::Full)
            .expect("specifiable");
        assert_eq!(
            figure.caption().expect("a caption").as_str(),
            "Complete selected spectrum, 5 points. Representation unreported; m/z and intensity \
             units unreported.",
        );
    }

    /// A range export's suggested name says which scope it is, and no more.
    #[test]
    fn a_current_export_suggests_a_scope_disambiguated_name() {
        for (format, full, current) in [
            (
                SpectrumExportFormat::Svg,
                "mscanvas-spectrum-42.svg",
                "mscanvas-spectrum-42-current.svg",
            ),
            (
                SpectrumExportFormat::Png,
                "mscanvas-spectrum-42.png",
                "mscanvas-spectrum-42-current.png",
            ),
            (
                SpectrumExportFormat::Csv,
                "mscanvas-spectrum-42.csv",
                "mscanvas-spectrum-42-current.csv",
            ),
            (
                SpectrumExportFormat::Tsv,
                "mscanvas-spectrum-42.tsv",
                "mscanvas-spectrum-42-current.tsv",
            ),
        ] {
            assert_eq!(
                format.suggested_file_name(42, SpectrumRangeScope::Full),
                full,
                "the full-source name is unchanged",
            );
            let suggested = format.suggested_file_name(42, SpectrumRangeScope::Current);
            assert_eq!(suggested, current);
            assert_eq!(
                suggested.matches('.').count(),
                1,
                "no floating-point range reaches a file name: {suggested}",
            );
        }
    }

    /// The exported count is the source count for a full export, and the
    /// in-range count for a range.
    #[test]
    fn the_exported_count_distinguishes_the_source_from_the_range() {
        let source = ranged_spectrum();
        let snapshot = retained(source.clone());
        assert_eq!(
            exported_point_count(&source, ResolvedSpectrumRange::Full),
            5
        );
        assert_eq!(
            exported_point_count(&source, resolve_current(&snapshot, 110.0, 130.0)),
            3,
        );
        assert_eq!(
            exported_point_count(&source, resolve_current(&snapshot, 121.0, 129.0)),
            0,
            "zero exported points is an answer, not a failure",
        );
    }

    /// The range is fixed when the export begins.
    ///
    /// The viewport may move -- and the selection may be replaced -- while the
    /// user is in the save dialog. What is written is the window they asked
    /// for, because the claim carries it rather than looking it up again.
    #[test]
    fn the_claimed_range_does_not_follow_a_viewport_that_moves() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), ranged_spectrum());
        let token = snapshot.token().as_wire();
        let reservation = slot
            .begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("current", Some(110.0), Some(130.0))
                    .expect("a request"),
                defaults(),
                None,
            )
            .expect("a reservation");
        let claimed = slot
            .claim_spectrum(&reservation.as_wire())
            .expect("claimable once");
        assert_eq!(
            claimed.range,
            ResolvedSpectrumRange::Current(Domain::new(110.0, 130.0).expect("an interval")),
        );
        assert_eq!(
            claimed.suggested_file_name(),
            "mscanvas-spectrum-42-current.csv",
        );
        // The reader now selects another spectrum entirely. It does not reach
        // the claim: an export already begun finishes from what it claimed.
        slot.install(owner(1), spectrum(99, vec![1.0, 2.0], vec![1.0, 1.0]));
        assert_eq!(
            claimed.range,
            ResolvedSpectrumRange::Current(Domain::new(110.0, 130.0).expect("an interval")),
        );
        let document = data_document(claimed.snapshot.spectrum(), claimed.format, claimed.range)
            .expect("a document");
        assert_eq!(preamble_value(&document, "spectrum_index", ','), "42");
        assert_eq!(preamble_value(&document, "range_low", ','), "110");
        assert_eq!(preamble_value(&document, "range_high", ','), "130");
    }

    /// A stale token is refused before any range is looked at.
    #[test]
    fn a_current_range_under_a_stale_token_is_refused_as_stale() {
        let mut slot = ScientificExportSlots::default();
        let first = slot.install(owner(1), ranged_spectrum());
        let stale = first.token().as_wire();
        slot.install(owner(1), spectrum(43, vec![100.0, 140.0], vec![1.0, 2.0]));
        assert_eq!(
            slot.begin(
                &stale,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("current", Some(110.0), Some(130.0))
                    .expect("a request"),
                defaults(),
                None,
            ),
            Err(BeginExportRefusal::Stale),
            "the spectrum a range was chosen for is gone; nothing is exported for the newer one",
        );
    }

    /// A forged current range for a domain-refused spectrum refuses at the lane.
    #[test]
    fn the_lane_refuses_a_current_range_for_a_domain_refused_spectrum() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), spectrum(3, vec![200.0, 100.0], vec![1.0, 2.0]));
        let token = snapshot.token().as_wire();
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("current", None, None).expect("a request"),
                defaults(),
                None,
            ),
            Err(BeginExportRefusal::NoViewportDomain),
        );
        // And the full-source export of the same spectrum is unaffected.
        assert!(
            slot.begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .is_ok(),
            "a viewport refusal is not a source failure",
        );
    }

    /// An out-of-source range refuses at the lane rather than reserving it.
    #[test]
    fn the_lane_refuses_an_out_of_source_range_and_stays_free() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), ranged_spectrum());
        let token = snapshot.token().as_wire();
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("current", Some(90.0), Some(130.0))
                    .expect("a request"),
                defaults(),
                None,
            ),
            Err(BeginExportRefusal::RangeOutsideSource),
        );
        assert!(
            slot.begin(
                &token,
                SpectrumExportFormat::Svg,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            )
            .is_ok(),
            "a refused range leaves the one lane free",
        );
    }

    /// A copy claims the lane and its range together.
    #[test]
    fn a_copy_resolves_its_range_with_its_claim() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), ranged_spectrum());
        let token = snapshot.token().as_wire();
        let (copied, range) = slot
            .begin_copy(
                &token,
                SpectrumRangeRequest::from_wire("current", Some(110.0), Some(130.0))
                    .expect("a request"),
            )
            .expect("the copy takes the lane");
        assert_eq!(copied.token(), snapshot.token());
        assert_eq!(
            range,
            ResolvedSpectrumRange::Current(Domain::new(110.0, 130.0).expect("an interval")),
        );
        // One lane: nothing else may begin while it is held.
        assert_eq!(
            slot.begin(
                &token,
                SpectrumExportFormat::Csv,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request"),
                defaults(),
                None,
            ),
            Err(BeginExportRefusal::AlreadyExporting),
        );
    }

    /// A copy of an unusable range never takes the lane.
    #[test]
    fn a_copy_of_a_refused_range_leaves_the_lane_free() {
        let mut slot = ScientificExportSlots::default();
        let snapshot = slot.install(owner(1), ranged_spectrum());
        let token = snapshot.token().as_wire();
        assert_eq!(
            slot.begin_copy(
                &token,
                SpectrumRangeRequest::from_wire("current", Some(1.0), Some(2.0))
                    .expect("a request"),
            )
            .err(),
            Some(BeginExportRefusal::RangeOutsideSource),
        );
        assert!(
            slot.begin_copy(
                &token,
                SpectrumRangeRequest::from_wire("full", None, None).expect("a full request")
            )
            .is_ok(),
            "a refused copy did not claim the lane on its way out",
        );
    }

    /// The linked figure's lower panel is the complete spectrum, at any scope.
    ///
    /// ADR 0036's rule, and M5.3 does not touch it: `spectrum_panel` takes no
    /// range, so there is nothing a range chooser could hand it. The assertion
    /// below is what a reader can check; the signature is what makes it true.
    #[test]
    fn the_linked_lower_panel_ignores_every_spectrum_range() {
        let source = ranged_spectrum();
        let panel = spectrum_panel(&source).expect("specifiable");
        assert_eq!(panel.visible_domain(), None);
        assert_eq!(panel.visible_value_domain(), None);
        assert_eq!(
            panel.series()[0].x(),
            &[100.0, 110.0, 120.0, 130.0, 140.0],
            "the whole spectrum, never narrowed to a range chosen for its own export",
        );
        // And it is the same panel the full-source figure draws.
        let figure =
            figure_spec(&source, defaults(), ResolvedSpectrumRange::Full).expect("specifiable");
        assert_eq!(figure.panels()[0].series()[0].x(), panel.series()[0].x());
    }

    /// A range beyond any transfer prefix still exports the retained source.
    ///
    /// The webview receives a bounded prefix; the export reads the complete
    /// arrays Rust retained. A window past the end of that prefix is where the
    /// two would visibly disagree if the export were ever taken from what the
    /// screen was given.
    #[test]
    fn a_range_beyond_the_transfer_prefix_exports_retained_observations() {
        let count = super::super::dto::MAX_SPECTRUM_POINTS + 500;
        #[expect(
            clippy::cast_precision_loss,
            reason = "the indices here are far below the f64 integer limit"
        )]
        let mz: Vec<f64> = (0..count).map(|at| at as f64).collect();
        #[expect(
            clippy::cast_precision_loss,
            reason = "the values here are a small repeating cycle"
        )]
        let intensity: Vec<f64> = (0..count).map(|at| (at % 17) as f64).collect();
        let source = spectrum(1, mz, intensity);
        let snapshot = retained(source.clone());
        // Entirely past the prefix a transfer would have carried.
        #[expect(
            clippy::cast_precision_loss,
            reason = "the bound is far below the f64 integer limit"
        )]
        let prefix_end = super::super::dto::MAX_SPECTRUM_POINTS as f64;
        let (low, high) = (prefix_end + 100.0, prefix_end + 200.0);
        let resolved = resolve_current(&snapshot, low, high);
        let document =
            data_document(&source, SpectrumExportFormat::Csv, resolved).expect("a document");
        let rows = records(&document, ',');
        assert_eq!(rows.len(), 101, "every retained observation in the window");
        assert_eq!(rows[0].0, low);
        assert_eq!(rows[rows.len() - 1].0, high);
        for (at, value) in &rows {
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "these are the whole-number m/z this fixture was built from"
            )]
            let index = *at as usize;
            #[expect(
                clippy::cast_precision_loss,
                reason = "the values here are a small repeating cycle"
            )]
            let expected = (index % 17) as f64;
            assert_eq!(*value, expected, "the source's own values");
        }
        assert_eq!(
            preamble_value(&document, "source_point_count", ','),
            count.to_string(),
            "the complete retained count, not the transferred prefix",
        );
        // And the figure over the same range draws from the complete series.
        let figure = figure_spec(&source, defaults(), resolved).expect("specifiable");
        assert_eq!(figure.panels()[0].series()[0].x().len(), count);
    }
}
