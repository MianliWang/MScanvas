//! A saved figure specification (FIG-007, ADR 0062).
//!
//! A saved figure is a recipe, not a picture and not a copy of the data. It
//! records what one figure export was asked for -- which figure, over which
//! range, at which size, in which theme and with which words -- and which file
//! it was drawn from: a locator, and the byte length and SHA-256 that file had.
//! Reopening reads that file again, refuses it unless its bytes are the
//! recorded ones, and regenerates the figure through the builders the export
//! itself uses. No array is stored, so nothing here can draw a figure from data
//! that is not in the source.
//!
//! ## What is refused, and before what
//!
//! - A document that is not exactly what this build writes -- not JSON, an
//!   unknown field, a value outside its bounds, another or a newer version, or
//!   contents that no longer match the document's own digest -- is refused
//!   before any source is touched.
//! - A source that is missing, unreadable or different from the recorded bytes
//!   is refused with that reason. It is never re-rendered from whatever is at
//!   the location now.
//! - A regenerated figure whose data differs from the data recorded at save is
//!   refused, so a reader or a builder that came to read the same bytes
//!   differently cannot silently change the figure.
//!
//! ## No interface yet
//!
//! Nothing outside the tests reaches this module. The source is read through
//! [`FigureSourceReader`], handed the handle this module holds, which the
//! interface slice implements over the project-owned mzML reader; the tests
//! implement it with fixed data. What this module owns is the document, its
//! checks, the source identity, the view-cache refusal and the regeneration,
//! so the interface adds a dialog and a command and nothing that decides what a
//! figure is.
#![cfg_attr(
    not(test),
    expect(dead_code, reason = "wired by the saved-figure interface slice")
)]

use std::fs::File;
use std::io::Seek as _;
use std::path::{Component, MAIN_SEPARATOR, Path, PathBuf, Prefix};
use std::sync::Arc;

use mscanvas_plot_spec::spec::{
    DOUBLE_COLUMN_WIDTH_MM, Domain, FigureSize, FigureSpec, FigureTheme, Label, PrintSize,
    SINGLE_COLUMN_WIDTH_MM, SpecError,
};
use mscanvas_proteowizard::{SelectedSpectrumResult, Sha256Digest};
use serde::{Deserialize, Serialize};

use crate::local_document::{self, ReadRefusal};
use crate::project::observe::{Cancellation, UnavailableReason, hold_member};
use crate::project::record::{
    ContentBaseline, DecimalValue, Locator, locator_for, resolve, validate_locator,
};

use super::chromatogram::{
    ChromatogramSource, RangeRequest, RangeScope, ResolvedRange, TraceSet,
    figure_spec as chromatogram_figure, linked_figure_spec,
};
use super::dialog::SaveDialogFacts;
use super::dto::{PreviewErrorDto, spectrum_destination_unusable};
use super::export::{
    ResolvedSpectrumRange, SpectrumRangeRequest, figure_spec as spectrum_figure,
    publication_figure, resolve_spectrum_range, scan_outside_range, two_panel_minimum_height,
};
use super::figure::{DEFAULT_FIGURE_HEIGHT, DEFAULT_FIGURE_WIDTH, FigureRenderSettings, PngDpi};
use super::projection::settle_viewport_domain;
use super::scientific_output::write_named;
use super::service::{PreviewService, TableRowFacts};

#[cfg(test)]
mod tests;

/// What the document calls itself.
pub(super) const SAVED_FIGURE_FORMAT: &str = "mscanvas_saved_figure";

/// The one version of that document this build writes and reads.
pub(super) const SAVED_FIGURE_FORMAT_VERSION: u64 = 1;

/// The largest document this build reads.
///
/// A document holds a locator of at most 1,024 characters, three titles of at
/// most 120, and a handful of numbers and digests: a few kilobytes. The bound
/// is far above that and far below anything worth reading whole.
pub(super) const MAX_SAVED_FIGURE_BYTES: u64 = 64 * 1024;

/// How the save dialog presents a saved figure, and the one extension it has.
///
/// One token, because the destination check compares the final extension only:
/// `figure.msfigure.json` is a JSON file, not a saved figure.
pub(super) const SAVED_FIGURE_DIALOG: SaveDialogFacts = SaveDialogFacts {
    title: "Save figure specification",
    filter_label: "MSCanvas figure specification (*.msfigure)",
    filter_pattern: "*.msfigure",
    default_extension: "msfigure",
};

// ---------------------------------------------------------------------------
// What a saved figure is
// ---------------------------------------------------------------------------

/// The retention-time range a chromatogram, alone or above a linked scan, was
/// drawn over.
///
/// The range Rust resolved, never the one an interface asked for. Reopening
/// asks the regenerated source to resolve it again, through the same resolver
/// the export uses, so a window the source does not hold is refused rather
/// than clamped.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum SavedRetentionTimeRange {
    Full,
    Current(Domain),
}

impl SavedRetentionTimeRange {
    /// The range one export was taken over.
    pub(super) fn of(resolved: ResolvedRange) -> Self {
        match resolved.scope() {
            RangeScope::Full => Self::Full,
            RangeScope::Current => Self::Current(resolved.domain()),
        }
    }

    fn request(self) -> Option<RangeRequest> {
        match self {
            Self::Full => RangeRequest::from_wire("full", None, None),
            Self::Current(domain) => {
                RangeRequest::from_wire("current", Some(domain.low()), Some(domain.high()))
            }
        }
    }
}

/// Which figure a document regenerates, and what it is drawn over.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum SavedFigureKind {
    /// One selected spectrum, by its zero-based index in the source.
    Spectrum {
        index: u64,
        range: ResolvedSpectrumRange,
    },
    /// The chromatogram projected from the source's spectrum table.
    Chromatogram {
        range: SavedRetentionTimeRange,
        traces: TraceSet,
    },
    /// The chromatogram above the spectrum at `index`, linked by its marker.
    Linked {
        index: u64,
        range: SavedRetentionTimeRange,
        traces: TraceSet,
    },
}

/// A printed size's named width, kept so the interface can show which one was
/// chosen. Informational: the millimetres are what the figure is drawn at, and
/// a preset that disagrees with them is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PrintPreset {
    SingleColumn,
    DoubleColumn,
    Custom,
}

impl PrintPreset {
    /// The width this preset names, where it names one.
    fn width_mm(self) -> Option<f64> {
        match self {
            Self::SingleColumn => Some(SINGLE_COLUMN_WIDTH_MM),
            Self::DoubleColumn => Some(DOUBLE_COLUMN_WIDTH_MM),
            Self::Custom => None,
        }
    }
}

/// How large a saved figure is: pixels, or paper with its text and line sizes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum SavedSize {
    Pixels {
        width: u32,
        height: u32,
    },
    Print {
        print: PrintSize,
        preset: PrintPreset,
    },
}

/// Why a figure's settings are not ones this build can draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SettingsOutOfBounds;

/// Everything about a saved figure that is presentation rather than source.
///
/// Built only through [`Self::new`], so a value that exists is one the
/// figure builders accept.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct SavedFigureSettings {
    theme: FigureTheme,
    size: SavedSize,
    /// The user's own words, or `None` for the builder's default.
    title: Option<Label>,
    x_axis_title: Option<Label>,
    y_axis_title: Option<Label>,
    /// The resolution a raster export records. Kept because it is an export
    /// option the user chose; it changes no figure.
    raster_dpi: PngDpi,
}

impl SavedFigureSettings {
    /// Accepts one set of settings, or says that they are not drawable.
    ///
    /// # Errors
    ///
    /// [`SettingsOutOfBounds`] for a size no figure can have, a printed size
    /// whose text does not fit its paper, or a preset that names another width.
    pub(super) fn new(
        theme: FigureTheme,
        size: SavedSize,
        title: Option<Label>,
        x_axis_title: Option<Label>,
        y_axis_title: Option<Label>,
        raster_dpi: PngDpi,
    ) -> Result<Self, SettingsOutOfBounds> {
        let settings = Self {
            theme,
            size,
            title,
            x_axis_title,
            y_axis_title,
            raster_dpi,
        };
        settings.base_render().ok_or(SettingsOutOfBounds)?;
        settings.figure_size().map_err(|_| SettingsOutOfBounds)?;
        if let SavedSize::Print { print, preset } = size
            && preset
                .width_mm()
                .is_some_and(|width| width.to_bits() != print.width_mm().to_bits())
        {
            return Err(SettingsOutOfBounds);
        }
        Ok(settings)
    }

    pub(super) const fn theme(&self) -> FigureTheme {
        self.theme
    }

    pub(super) const fn size(&self) -> SavedSize {
        self.size
    }

    pub(super) const fn raster_dpi(&self) -> PngDpi {
        self.raster_dpi
    }

    /// The settings the figure builders are called with.
    ///
    /// A pixel figure is built at its own size, exactly as its export is. A
    /// printed one is built at the default and then given its paper by
    /// [`publication_figure`], which is how the export makes one.
    fn base_render(&self) -> Option<FigureRenderSettings> {
        let theme = match self.theme {
            FigureTheme::Light => "light",
            FigureTheme::Dark => "dark",
        };
        let (width, height) = match self.size {
            SavedSize::Pixels { width, height } => (width, height),
            SavedSize::Print { .. } => (DEFAULT_FIGURE_WIDTH, DEFAULT_FIGURE_HEIGHT),
        };
        FigureRenderSettings::from_wire(width, height, theme).ok()
    }

    /// The size the regenerated figure is drawn at.
    fn figure_size(&self) -> Result<FigureSize, SpecError> {
        match self.size {
            SavedSize::Pixels { width, height } => {
                FigureSize::new(f64::from(width), f64::from(height))
            }
            SavedSize::Print { print, .. } => FigureSize::printed(print),
        }
    }
}

/// One saved figure: what to regenerate, how to present it, and which bytes it
/// must be regenerated from.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct SavedFigureDocument {
    kind: SavedFigureKind,
    settings: SavedFigureSettings,
    /// Where the source is, relative to the document's own folder when the
    /// source is inside it, so the two can be moved together.
    locator: Locator,
    /// The source's byte length and SHA-256 when the figure was saved.
    baseline: ContentBaseline,
    /// The digest of the data the saved figure was drawn from. See
    /// [`data_digest`].
    data: Sha256Digest,
}

impl SavedFigureDocument {
    pub(super) const fn kind(&self) -> SavedFigureKind {
        self.kind
    }

    pub(super) const fn settings(&self) -> &SavedFigureSettings {
        &self.settings
    }

    pub(super) const fn locator(&self) -> &Locator {
        &self.locator
    }

    /// The document's bytes: pretty-printed JSON with `\n` line endings, sealed
    /// with the digest of its own contents.
    ///
    /// `None` only where SHA-256 itself is unavailable.
    pub(super) fn to_bytes(&self) -> Option<Vec<u8>> {
        seal(self.to_wire()?)
    }

    /// Reads one document, refusing anything this build did not write.
    ///
    /// # Errors
    ///
    /// A [`DocumentRefusal`] naming the first check that failed, in this order:
    /// the shape is not a saved figure at all, the version is not this build's,
    /// a field is unknown or of the wrong type, a value is outside its bounds,
    /// and the contents no longer match the document's own digest.
    pub(super) fn parse(bytes: &[u8]) -> Result<Self, DocumentRefusal> {
        // The format and the version are read leniently first, so a newer
        // document is reported as newer rather than as a field this build does
        // not know -- which is what a strict read of it would say.
        let probe: Probe = serde_json::from_slice(bytes).map_err(|_| DocumentRefusal::Malformed)?;
        if probe.format != SAVED_FIGURE_FORMAT {
            return Err(DocumentRefusal::NotASavedFigure);
        }
        if probe.format_version > SAVED_FIGURE_FORMAT_VERSION {
            return Err(DocumentRefusal::NewerVersion);
        }
        if probe.format_version != SAVED_FIGURE_FORMAT_VERSION {
            return Err(DocumentRefusal::UnsupportedVersion);
        }
        let wire: WireDocument =
            serde_json::from_slice(bytes).map_err(|_| DocumentRefusal::Malformed)?;
        let recorded =
            canonical_digest(&wire.document_sha256).ok_or(DocumentRefusal::OutOfBounds)?;
        let document = Self::from_wire(wire.clone())?;
        // Over the document as it was read, not as this build would write the
        // values it accepted: a document whose bytes say something its digest
        // does not is refused, whatever the difference is.
        let computed = contents_digest(&wire).ok_or(DocumentRefusal::DigestUnavailable)?;
        if computed != recorded {
            return Err(DocumentRefusal::DigestMismatch);
        }
        Ok(document)
    }

    /// The wire shape, with the document digest still empty.
    ///
    /// `None` is unreachable in practice: every number written here came out
    /// of a `Domain` or a `PrintSize`, both of which refuse a non-finite one.
    fn to_wire(&self) -> Option<WireDocument> {
        let figure = match self.kind {
            SavedFigureKind::Spectrum { index, range } => WireFigure::Spectrum {
                spectrum_index: index,
                mz_range: match range {
                    ResolvedSpectrumRange::Full => WireRange::Full {},
                    ResolvedSpectrumRange::Current(domain) => WireRange::of(domain)?,
                },
            },
            SavedFigureKind::Chromatogram { range, traces } => WireFigure::Chromatogram {
                retention_time_range: WireRange::of_retention_time(range)?,
                traces: WireTraces::of(traces),
            },
            SavedFigureKind::Linked {
                index,
                range,
                traces,
            } => WireFigure::Linked {
                spectrum_index: index,
                retention_time_range: WireRange::of_retention_time(range)?,
                traces: WireTraces::of(traces),
            },
        };
        let settings = &self.settings;
        let size = match settings.size {
            SavedSize::Pixels { width, height } => WireSize::Pixels { width, height },
            SavedSize::Print { print, preset } => WireSize::Print {
                width_mm: DecimalValue::of(print.width_mm())?,
                height_mm: DecimalValue::of(print.height_mm())?,
                text_pt: DecimalValue::of(print.text_pt())?,
                line_pt: DecimalValue::of(print.line_pt())?,
                preset: match preset {
                    PrintPreset::SingleColumn => WirePreset::SingleColumn,
                    PrintPreset::DoubleColumn => WirePreset::DoubleColumn,
                    PrintPreset::Custom => WirePreset::Custom,
                },
            },
        };
        let words = |label: &Option<Label>| label.as_ref().map(|label| label.as_str().to_owned());
        Some(WireDocument {
            format: SAVED_FIGURE_FORMAT.to_owned(),
            format_version: SAVED_FIGURE_FORMAT_VERSION,
            figure,
            settings: WireSettings {
                theme: settings.theme,
                size,
                title: words(&settings.title),
                x_axis_title: words(&settings.x_axis_title),
                y_axis_title: words(&settings.y_axis_title),
                raster_dpi: settings.raster_dpi.get(),
            },
            source: WireSource {
                locator: self.locator.clone(),
                baseline: self.baseline.clone(),
            },
            data_sha256: self.data.to_string(),
            document_sha256: String::new(),
        })
    }

    fn from_wire(wire: WireDocument) -> Result<Self, DocumentRefusal> {
        let bounds = DocumentRefusal::OutOfBounds;
        let kind = match wire.figure {
            WireFigure::Spectrum {
                spectrum_index,
                mz_range,
            } => SavedFigureKind::Spectrum {
                index: spectrum_index,
                range: match mz_range {
                    WireRange::Full {} => ResolvedSpectrumRange::Full,
                    WireRange::Current { low, high } => {
                        ResolvedSpectrumRange::Current(domain(&low, &high).ok_or(bounds)?)
                    }
                },
            },
            WireFigure::Chromatogram {
                retention_time_range,
                traces,
            } => SavedFigureKind::Chromatogram {
                range: retention_time_range.retention_time().ok_or(bounds)?,
                traces: traces.trace_set().ok_or(bounds)?,
            },
            WireFigure::Linked {
                spectrum_index,
                retention_time_range,
                traces,
            } => SavedFigureKind::Linked {
                index: spectrum_index,
                range: retention_time_range.retention_time().ok_or(bounds)?,
                traces: traces.trace_set().ok_or(bounds)?,
            },
        };

        let settings = wire.settings.settings().ok_or(bounds)?;
        // Two panels need the height two panels need. Asked here so a linked
        // figure too short to draw is refused as a document, before a source is
        // read for it.
        if matches!(kind, SavedFigureKind::Linked { .. })
            && !settings
                .figure_size()
                .is_ok_and(|size| size.height() >= two_panel_minimum_height())
        {
            return Err(bounds);
        }

        validate_locator(&wire.source.locator).map_err(|_| bounds)?;
        let baseline = wire.source.baseline;
        canonical_digest(&baseline.sha256).ok_or(bounds)?;
        let data = canonical_digest(&wire.data_sha256).ok_or(bounds)?;

        Ok(Self {
            kind,
            settings,
            locator: wire.source.locator,
            baseline,
            data,
        })
    }
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

/// The two fields that say which document this is, read before anything else.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Probe {
    format: String,
    format_version: u64,
}

/// The document as JSON. Every object refuses a field it does not declare, at
/// every depth: a misspelled field would otherwise be read as absent, and an
/// absent window is a different figure.
///
/// Every non-integer number is decimal text in the one spelling Rust's
/// shortest round trip gives, as in the project document: this build's JSON
/// parser can read a float one unit in the last place away from what was
/// written, and a window that moved by one bit would be a different window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireDocument {
    format: String,
    format_version: u64,
    figure: WireFigure,
    settings: WireSettings,
    source: WireSource,
    data_sha256: String,
    /// The SHA-256 of this document's compact serialization with this field
    /// empty. Integrity against a damaged or edited file, not authenticity:
    /// anyone can compute it.
    document_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
enum WireFigure {
    #[serde(rename_all = "camelCase")]
    Spectrum {
        spectrum_index: u64,
        mz_range: WireRange,
    },
    #[serde(rename_all = "camelCase")]
    Chromatogram {
        retention_time_range: WireRange,
        traces: WireTraces,
    },
    #[serde(rename_all = "camelCase")]
    Linked {
        spectrum_index: u64,
        retention_time_range: WireRange,
        traces: WireTraces,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "scope", deny_unknown_fields)]
enum WireRange {
    /// A struct variant with no fields rather than a unit one: `serde` lets an
    /// internally tagged *unit* variant carry any other field and drops it, so
    /// `{"scope": "full", "low": "9"}` would read as a full range.
    Full {},
    Current {
        low: DecimalValue,
        high: DecimalValue,
    },
}

impl WireRange {
    fn of(domain: Domain) -> Option<Self> {
        Some(Self::Current {
            low: DecimalValue::of(domain.low())?,
            high: DecimalValue::of(domain.high())?,
        })
    }

    fn of_retention_time(range: SavedRetentionTimeRange) -> Option<Self> {
        match range {
            SavedRetentionTimeRange::Full => Some(Self::Full {}),
            SavedRetentionTimeRange::Current(domain) => Self::of(domain),
        }
    }

    fn retention_time(&self) -> Option<SavedRetentionTimeRange> {
        Some(match self {
            Self::Full {} => SavedRetentionTimeRange::Full,
            Self::Current { low, high } => SavedRetentionTimeRange::Current(domain(low, high)?),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireTraces {
    tic: bool,
    bpc: bool,
}

impl WireTraces {
    const fn of(traces: TraceSet) -> Self {
        Self {
            tic: traces.tic(),
            bpc: traces.bpc(),
        }
    }

    /// The traces, where at least one is drawn: a figure of none is refused by
    /// the contract, so a document asking for one is not a figure.
    fn trace_set(&self) -> Option<TraceSet> {
        let traces = TraceSet::from_wire(self.tic, self.bpc);
        traces.any().then_some(traces)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireSettings {
    theme: FigureTheme,
    size: WireSize,
    // `null` is the builder's own words. Required to be written either way:
    // `serde` would otherwise read a missing `Option` as `None`, and a document
    // missing a field is not one this build wrote.
    #[serde(deserialize_with = "present")]
    title: Option<String>,
    #[serde(deserialize_with = "present")]
    x_axis_title: Option<String>,
    #[serde(deserialize_with = "present")]
    y_axis_title: Option<String>,
    raster_dpi: u32,
}

/// Reads an optional value that must be written, as `null` or as a value.
fn present<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

impl WireSettings {
    fn settings(self) -> Option<SavedFigureSettings> {
        let label = |text: Option<String>| -> Option<Option<Label>> {
            match text {
                None => Some(None),
                Some(text) => Label::new(text).ok().map(Some),
            }
        };
        let size = match self.size {
            WireSize::Pixels { width, height } => SavedSize::Pixels { width, height },
            WireSize::Print {
                width_mm,
                height_mm,
                text_pt,
                line_pt,
                preset,
            } => SavedSize::Print {
                print: PrintSize::new(
                    width_mm.number()?,
                    height_mm.number()?,
                    text_pt.number()?,
                    line_pt.number()?,
                )
                .ok()?,
                preset: match preset {
                    WirePreset::SingleColumn => PrintPreset::SingleColumn,
                    WirePreset::DoubleColumn => PrintPreset::DoubleColumn,
                    WirePreset::Custom => PrintPreset::Custom,
                },
            },
        };
        SavedFigureSettings::new(
            self.theme,
            size,
            label(self.title)?,
            label(self.x_axis_title)?,
            label(self.y_axis_title)?,
            PngDpi::from_wire(self.raster_dpi).ok()?,
        )
        .ok()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "unit", deny_unknown_fields)]
enum WireSize {
    Pixels {
        width: u32,
        height: u32,
    },
    #[serde(rename_all = "camelCase")]
    Print {
        width_mm: DecimalValue,
        height_mm: DecimalValue,
        text_pt: DecimalValue,
        line_pt: DecimalValue,
        preset: WirePreset,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WirePreset {
    SingleColumn,
    DoubleColumn,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireSource {
    locator: Locator,
    baseline: ContentBaseline,
}

/// A closed interval from two canonical decimals, where they make one.
fn domain(low: &DecimalValue, high: &DecimalValue) -> Option<Domain> {
    Domain::new(low.number()?, high.number()?).ok()
}

/// A digest spelled exactly as this build spells one: 64 upper-case
/// hexadecimal characters, as [`Sha256Digest`]'s own `Display` and the
/// project document's baselines write it.
fn canonical_digest(text: &str) -> Option<Sha256Digest> {
    let digest: Sha256Digest = text.parse().ok()?;
    (digest.to_string() == text).then_some(digest)
}

/// The digest of a document's contents: its compact serialization with the
/// document digest itself left empty.
fn contents_digest(wire: &WireDocument) -> Option<Sha256Digest> {
    let mut blank = wire.clone();
    blank.document_sha256 = String::new();
    let bytes = serde_json::to_vec(&blank).ok()?;
    Sha256Digest::calculate(&bytes).ok()
}

/// Writes one document's bytes with its digest filled in.
fn seal(mut wire: WireDocument) -> Option<Vec<u8>> {
    wire.document_sha256 = contents_digest(&wire)?.to_string();
    let mut bytes = serde_json::to_vec_pretty(&wire).ok()?;
    bytes.push(b'\n');
    Some(bytes)
}

/// The digest of the data a figure draws and of what the source said about it,
/// panel by panel, in order: each panel's kind (for a spectrum, the
/// representation the file stated) and the unit state of both axes; each
/// series' name, role, scope, sample marks and coordinates; and each marker's
/// position.
///
/// What the figure is *of*, and nothing about how it is presented: the size,
/// the theme, the titles and the wording of the caption are not in it. Two
/// regenerations from the same bytes by the same reader agree on it; a reader
/// or builder that came to read the same bytes differently -- other values,
/// another representation, a unit it now declares -- does not, and that is the
/// difference reopening refuses. Every length is written before what it counts,
/// so no two figures share one byte sequence.
fn data_digest(figure: &FigureSpec) -> Option<Sha256Digest> {
    fn count(bytes: &mut Vec<u8>, value: usize) {
        bytes.extend_from_slice(&(value as u64).to_le_bytes());
    }
    fn framed(bytes: &mut Vec<u8>, value: &impl Serialize) -> Option<()> {
        let encoded = serde_json::to_vec(value).ok()?;
        count(bytes, encoded.len());
        bytes.extend_from_slice(&encoded);
        Some(())
    }

    let mut bytes = Vec::new();
    count(&mut bytes, figure.panels().len());
    for panel in figure.panels() {
        framed(&mut bytes, &panel.kind())?;
        framed(&mut bytes, &panel.x_axis().unit)?;
        framed(&mut bytes, &panel.y_axis().unit)?;
        count(&mut bytes, panel.series().len());
        for series in panel.series() {
            framed(&mut bytes, series.id())?;
            framed(&mut bytes, &series.role())?;
            framed(&mut bytes, &series.scope())?;
            bytes.push(u8::from(series.marks_samples()));
            count(&mut bytes, series.x().len());
            for value in series.x().iter().chain(series.y()) {
                bytes.extend_from_slice(&value.to_bits().to_le_bytes());
            }
        }
        count(&mut bytes, panel.markers().len());
        for marker in panel.markers() {
            bytes.extend_from_slice(&marker.at().to_bits().to_le_bytes());
        }
    }
    Sha256Digest::calculate(&bytes).ok()
}

// ---------------------------------------------------------------------------
// Reading the source and regenerating
// ---------------------------------------------------------------------------

/// The complete spectrum table of one source, as the preview retains it.
pub(super) struct SourceTable {
    pub(super) rows: Arc<Vec<TableRowFacts>>,
    /// Whether the preview would show this table truncated. A truncated table
    /// has no chromatogram, here as on screen.
    pub(super) truncated: bool,
}

/// What regenerating a figure reads from its source, and nothing else.
///
/// `source` is the handle the save or the reopen measured the source through
/// and still holds, positioned at its first byte. A call reads the figure from
/// it and from nothing else -- never from data the session retained, a cache,
/// or the file opened again by its name -- so the bytes measured are the bytes
/// read. The interface slice implements it over the project-owned mzML
/// reader's reader-taking entry points, so a reopened figure is read exactly as
/// a previewed one is. A refusal is the reader's own error, carried through
/// unchanged.
pub(super) trait FigureSourceReader {
    /// Every row of the source's spectrum table.
    ///
    /// # Errors
    ///
    /// The reader's own refusal.
    fn spectrum_table(&self, source: &File) -> Result<SourceTable, PreviewErrorDto>;

    /// One complete spectrum, by its zero-based index.
    ///
    /// # Errors
    ///
    /// The reader's own refusal.
    fn spectrum(
        &self,
        source: &File,
        index: u64,
    ) -> Result<SelectedSpectrumResult, PreviewErrorDto>;
}

/// Why a figure could not be regenerated from a source whose bytes are right.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum RegenerationRefusal {
    /// The held source could not be returned to its first byte for a read.
    SourceNotRewound,
    /// The reader refused, and said why.
    SourceNotRead(PreviewErrorDto),
    /// The reader answered with a spectrum other than the one asked for.
    WrongSpectrum,
    /// The source's table is not one the viewer draws a chromatogram for.
    NoChromatogram,
    /// The saved range reaches outside the run.
    RangeOutsideSource,
    /// The linked spectrum is not a scan of the source's table.
    SelectedScanNotInTable,
    /// The linked scan lies outside the saved range.
    SelectedScanOutsideRange,
    /// The figure contract refused what the builders made.
    Spec(SpecError),
}

/// Builds the figure a saved one describes, from the source as it is now.
///
/// The export's own builders and nothing else: the spectrum, the chromatogram
/// and the linked figure are made by the functions their exports call, and a
/// printed size or an edited title is applied by [`publication_figure`]. A
/// second builder here would be a second answer to what the figure is.
fn regenerate(
    kind: SavedFigureKind,
    settings: &SavedFigureSettings,
    source: &File,
    reader: &dyn FigureSourceReader,
) -> Result<FigureSpec, RegenerationRefusal> {
    // Constructed settings always have one; asked again rather than assumed.
    let base = settings
        .base_render()
        .ok_or(RegenerationRefusal::Spec(SpecError::FigureSizeOutOfRange))?;
    let built = match kind {
        SavedFigureKind::Spectrum { index, range } => {
            let spectrum = read_spectrum(reader, source, index)?;
            let range = resolve_mz_range(&spectrum, range)?;
            spectrum_figure(&spectrum, base, range).map_err(RegenerationRefusal::Spec)?
        }
        SavedFigureKind::Chromatogram { range, traces } => {
            let chromatogram = read_chromatogram(reader, source)?;
            let resolved = resolve_range(&chromatogram, range)?;
            chromatogram_figure(&chromatogram, resolved, traces, base)
                .map_err(RegenerationRefusal::Spec)?
        }
        SavedFigureKind::Linked {
            index,
            range,
            traces,
        } => {
            let chromatogram = read_chromatogram(reader, source)?;
            let spectrum = read_spectrum(reader, source, index)?;
            // The exact row, reconciled by identity, as the linked export binds
            // it. Retention time is never the key.
            let row = chromatogram
                .row_for_spectrum(&spectrum)
                .ok_or(RegenerationRefusal::SelectedScanNotInTable)?;
            let resolved = resolve_range(&chromatogram, range)?;
            if scan_outside_range(resolved, row.retention_time()) {
                return Err(RegenerationRefusal::SelectedScanOutsideRange);
            }
            linked_figure_spec(&chromatogram, &spectrum, row, resolved, traces, base)
                .map_err(RegenerationRefusal::Spec)?
        }
    };
    let size = settings.figure_size().map_err(RegenerationRefusal::Spec)?;
    let words = |label: &Option<Label>| label.as_ref().map_or("", Label::as_str).to_owned();
    publication_figure(
        built,
        size,
        &words(&settings.title),
        &words(&settings.x_axis_title),
        &words(&settings.y_axis_title),
    )
    .map_err(RegenerationRefusal::Spec)
}

/// The held source at its first byte, for one reader call. A handle shares one
/// position with every clone of it, so the second read of a linked figure would
/// otherwise start where the first one ended.
fn from_start(source: &File) -> Result<&File, RegenerationRefusal> {
    let mut handle = source;
    handle
        .rewind()
        .map_err(|_| RegenerationRefusal::SourceNotRewound)?;
    Ok(source)
}

fn read_spectrum(
    reader: &dyn FigureSourceReader,
    source: &File,
    index: u64,
) -> Result<SelectedSpectrumResult, RegenerationRefusal> {
    let spectrum = reader
        .spectrum(from_start(source)?, index)
        .map_err(RegenerationRefusal::SourceNotRead)?;
    if spectrum.identity().index() != index {
        return Err(RegenerationRefusal::WrongSpectrum);
    }
    Ok(spectrum)
}

fn read_chromatogram(
    reader: &dyn FigureSourceReader,
    source: &File,
) -> Result<ChromatogramSource, RegenerationRefusal> {
    let table = reader
        .spectrum_table(from_start(source)?)
        .map_err(RegenerationRefusal::SourceNotRead)?;
    // The eligibility the viewer and the export apply, through their own
    // constructor.
    //
    // Read through `into_iter` so this line reads the same whether the
    // constructor answers an `Option` or a `Result` with its reason. When it
    // answers a reason (PR #175), `NoChromatogram` should carry it.
    ChromatogramSource::from_rows(&table.rows, table.truncated)
        .into_iter()
        .next()
        .ok_or(RegenerationRefusal::NoChromatogram)
}

/// Resolves a saved m/z window against the regenerated spectrum, through the
/// export's own resolver: a window the spectrum does not hold is refused, as
/// the export refuses it, rather than drawn as the full spectrum under a
/// caption that names the window.
fn resolve_mz_range(
    spectrum: &SelectedSpectrumResult,
    range: ResolvedSpectrumRange,
) -> Result<ResolvedSpectrumRange, RegenerationRefusal> {
    let window = range.domain();
    let request = SpectrumRangeRequest::from_wire(
        range.scope().stable_id(),
        window.map(|window| window.low()),
        window.map(|window| window.high()),
    )
    .ok_or(RegenerationRefusal::RangeOutsideSource)?;
    // A spectrum with no viewport domain has no window for one to be inside.
    resolve_spectrum_range(settle_viewport_domain(spectrum), request)
        .map_err(|_| RegenerationRefusal::RangeOutsideSource)
}

/// Resolves a saved range against the regenerated run, through the export's
/// own resolver.
fn resolve_range(
    chromatogram: &ChromatogramSource,
    range: SavedRetentionTimeRange,
) -> Result<ResolvedRange, RegenerationRefusal> {
    let request = range
        .request()
        .ok_or(RegenerationRefusal::RangeOutsideSource)?;
    chromatogram
        .resolve(request)
        .map_err(|_| RegenerationRefusal::RangeOutsideSource)
}

// ---------------------------------------------------------------------------
// Saving and reopening
// ---------------------------------------------------------------------------

/// Why a document is not one this build reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DocumentRefusal {
    /// Larger than [`MAX_SAVED_FIGURE_BYTES`]. Never read whole.
    TooLarge,
    /// Not JSON, missing a field, a field of the wrong type, or a field this
    /// build does not know, at any depth.
    Malformed,
    /// JSON, and another kind of document.
    NotASavedFigure,
    /// A saved figure of a version later than this build's.
    NewerVersion,
    /// A saved figure of a version this build never wrote.
    UnsupportedVersion,
    /// A value outside what this build accepts: a title, a size, a resolution,
    /// a range, a locator or a digest.
    OutOfBounds,
    /// The contents no longer match the document's own digest.
    DigestMismatch,
    /// SHA-256 itself was unavailable.
    DigestUnavailable,
}

/// Why a saved figure was not reopened.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum ReopenRefusal {
    /// Nothing is at the document's name.
    DocumentMissing,
    /// Something is there and could not be read as a file.
    DocumentUnreadable,
    Document(DocumentRefusal),
    /// Nothing is at the location the document names.
    SourceMissing,
    /// The source is there and no stable read of it could be made.
    SourceUnavailable(UnavailableReason),
    /// The source's bytes are not the bytes the figure was saved from.
    SourceChanged,
    Regeneration(RegenerationRefusal),
    /// The same bytes now regenerate a figure of different data.
    FigureChanged,
    /// SHA-256 itself was unavailable.
    DigestUnavailable,
}

impl ReopenRefusal {
    fn of_source(reason: UnavailableReason) -> Self {
        match reason {
            UnavailableReason::MissingAtCheckedLocation => Self::SourceMissing,
            other => Self::SourceUnavailable(other),
        }
    }

    /// The stable identifier the interface slice maps to its own words.
    pub(super) const fn stable_id(&self) -> &'static str {
        match self {
            Self::DocumentMissing => "saved_figure_document_missing",
            Self::DocumentUnreadable => "saved_figure_document_unreadable",
            Self::Document(refusal) => refusal.stable_id(),
            Self::SourceMissing => "saved_figure_source_missing",
            Self::SourceUnavailable(_) => "saved_figure_source_unavailable",
            Self::SourceChanged => "saved_figure_source_changed",
            Self::Regeneration(_) => "saved_figure_not_regenerated",
            Self::FigureChanged => "saved_figure_figure_changed",
            Self::DigestUnavailable => "saved_figure_digest_unavailable",
        }
    }
}

impl DocumentRefusal {
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::TooLarge => "saved_figure_document_too_large",
            Self::Malformed => "saved_figure_document_malformed",
            Self::NotASavedFigure => "saved_figure_not_a_saved_figure",
            Self::NewerVersion => "saved_figure_newer_version",
            Self::UnsupportedVersion => "saved_figure_unsupported_version",
            Self::OutOfBounds => "saved_figure_out_of_bounds",
            Self::DigestMismatch => "saved_figure_digest_mismatch",
            Self::DigestUnavailable => "saved_figure_digest_unavailable",
        }
    }
}

/// Why a figure was not saved.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum SaveRefusal {
    /// The source's location cannot be written as a locator this build would
    /// read back -- a network or device path, or a component that is not an
    /// ordinary name.
    SourceNotReferencable,
    /// The source is a file in the view cache (ADR 0060): a converted copy
    /// under this machine's application data that the cache may remove, not
    /// the acquisition the figure is of.
    SourceInViewCache,
    SourceMissing,
    SourceUnavailable(UnavailableReason),
    Regeneration(RegenerationRefusal),
    /// The source as it is now does not regenerate the figure on screen, so a
    /// document saved from it would reopen as a different figure.
    NotTheShownFigure,
    DigestUnavailable,
    /// The destination refused the write, in the export's own words.
    Write(PreviewErrorDto),
}

impl SaveRefusal {
    fn of_source(reason: UnavailableReason) -> Self {
        match reason {
            UnavailableReason::MissingAtCheckedLocation => Self::SourceMissing,
            other => Self::SourceUnavailable(other),
        }
    }

    /// The stable identifier the interface slice maps to its own words. A
    /// write refusal keeps the export's code.
    pub(super) fn stable_id(&self) -> &str {
        match self {
            Self::SourceNotReferencable => "saved_figure_source_not_referencable",
            Self::SourceInViewCache => "saved_figure_source_in_view_cache",
            Self::SourceMissing => "saved_figure_source_missing",
            Self::SourceUnavailable(_) => "saved_figure_source_unavailable",
            Self::Regeneration(_) => "saved_figure_not_regenerated",
            Self::NotTheShownFigure => "saved_figure_not_the_shown_figure",
            Self::DigestUnavailable => "saved_figure_digest_unavailable",
            Self::Write(error) => &error.kind,
        }
    }
}

/// Saves one figure as a document at `destination`, never over anything.
///
/// `shown` is the figure the user is looking at. The source is measured and
/// held, the figure is regenerated from it, and the document is written only
/// if what was regenerated is exactly `shown`: a document is never written
/// that would reopen as a figure other than the one it was saved from.
/// `view_cache` is the view cache's root (ADR 0060), where this application
/// has one; a source under it is refused. Answers the file name the document
/// was given.
///
/// # Errors
///
/// A [`SaveRefusal`]. A misnamed destination is refused before the source is
/// read; a destination that already holds something is refused by the writer,
/// which replaces nothing.
pub(super) fn save(
    kind: SavedFigureKind,
    settings: SavedFigureSettings,
    source: &Path,
    shown: &FigureSpec,
    reader: &dyn FigureSourceReader,
    destination: &Path,
    view_cache: Option<&Path>,
) -> Result<String, SaveRefusal> {
    PreviewService::require_named_document(destination, SAVED_FIGURE_DIALOG)
        .map_err(SaveRefusal::Write)?;
    let directory = destination
        .parent()
        .ok_or_else(|| SaveRefusal::Write(spectrum_destination_unusable()))?;

    // Held while the figure is regenerated, and the figure is read through
    // this handle, so the bytes measured are the bytes read: nothing can
    // write, rename or delete the source meanwhile.
    let held = hold_member(source, &Cancellation::default()).map_err(SaveRefusal::of_source)?;

    // Both sides in one spelling before one is made relative to the other: the
    // preview keeps its datasets' canonical, verbatim paths, and a save dialog
    // answers in the form a person typed. A folder that cannot be resolved is
    // the destination's fault, not the source's.
    let folder = canonical_user_form(directory)
        .ok_or_else(|| SaveRefusal::Write(spectrum_destination_unusable()))?;
    let named = canonical_user_form(source).ok_or(SaveRefusal::SourceNotReferencable)?;
    let locator = locator_for(&named, &folder);
    validate_locator(&locator).map_err(|_| SaveRefusal::SourceNotReferencable)?;
    // A cache that cannot be resolved does not exist yet, and nothing is in it.
    // Compared by whole components, so `view-cache-old` is not inside it.
    if view_cache
        .and_then(canonical_user_form)
        .is_some_and(|cache| named.starts_with(cache))
    {
        return Err(SaveRefusal::SourceInViewCache);
    }
    let figure =
        regenerate(kind, &settings, &held.file, reader).map_err(SaveRefusal::Regeneration)?;
    let baseline = ContentBaseline::observed(held.byte_length, held.digest);
    drop(held);

    if figure != *shown {
        return Err(SaveRefusal::NotTheShownFigure);
    }
    let data = data_digest(&figure).ok_or(SaveRefusal::DigestUnavailable)?;
    let document = SavedFigureDocument {
        kind,
        settings,
        locator,
        baseline,
        data,
    };
    let bytes = document.to_bytes().ok_or(SaveRefusal::DigestUnavailable)?;
    write_named(destination, SAVED_FIGURE_DIALOG, &bytes).map_err(SaveRefusal::Write)
}

/// A path canonicalized and then written as a person writes it, or `None` where
/// it cannot be canonicalized.
///
/// Canonical so that two spellings of one place -- a short 8.3 name, a
/// verbatim prefix -- compare as one; in the person's form because the
/// project's locator rule refuses the verbatim one.
fn canonical_user_form(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path)
        .ok()
        .map(|path| user_form(&path))
}

/// A verbatim drive path, `\\?\C:\data\run.mzML`, as `C:\data\run.mzML`.
///
/// Every other path is returned unchanged -- a verbatim network path among
/// them, which the locator rule then refuses, because a saved figure names a
/// local file.
fn user_form(path: &Path) -> PathBuf {
    let mut components = path.components();
    if let Some(Component::Prefix(prefix)) = components.next()
        && let Prefix::VerbatimDisk(letter) = prefix.kind()
    {
        let mut plain = PathBuf::from(format!("{}:{}", char::from(letter), MAIN_SEPARATOR));
        plain.extend(components.filter(|component| !matches!(component, Component::RootDir)));
        return plain;
    }
    path.to_path_buf()
}

/// One reopened figure: the document, and the figure regenerated from it.
#[derive(Debug, Clone)]
pub(super) struct ReopenedFigure {
    document: SavedFigureDocument,
    figure: FigureSpec,
}

impl ReopenedFigure {
    pub(super) const fn document(&self) -> &SavedFigureDocument {
        &self.document
    }

    pub(super) const fn figure(&self) -> &FigureSpec {
        &self.figure
    }
}

/// Reopens the saved figure at `document` and regenerates it.
///
/// The document is read and checked first; then its source is measured and
/// held, refused unless its bytes are the recorded ones, and regenerated
/// through the export's builders; then the data the figure draws is checked
/// against what was saved. Nothing is written anywhere.
///
/// # Errors
///
/// A [`ReopenRefusal`] naming the first check that failed.
pub(super) fn reopen(
    document: &Path,
    reader: &dyn FigureSourceReader,
) -> Result<ReopenedFigure, ReopenRefusal> {
    let bytes = match local_document::read_bounded(document, MAX_SAVED_FIGURE_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return Err(ReopenRefusal::DocumentMissing),
        Err(ReadRefusal::Oversized) => {
            return Err(ReopenRefusal::Document(DocumentRefusal::TooLarge));
        }
        Err(ReadRefusal::Unreadable | ReadRefusal::UnsafeTarget) => {
            return Err(ReopenRefusal::DocumentUnreadable);
        }
    };
    let saved = SavedFigureDocument::parse(&bytes).map_err(ReopenRefusal::Document)?;
    let directory = document.parent().ok_or(ReopenRefusal::DocumentUnreadable)?;
    let source = resolve(&saved.locator, directory)
        .map_err(|_| ReopenRefusal::Document(DocumentRefusal::OutOfBounds))?;

    let held = hold_member(&source, &Cancellation::default()).map_err(ReopenRefusal::of_source)?;
    if !saved.baseline.matches(held.byte_length, held.digest) {
        return Err(ReopenRefusal::SourceChanged);
    }
    let figure = regenerate(saved.kind, &saved.settings, &held.file, reader)
        .map_err(ReopenRefusal::Regeneration)?;
    drop(held);

    let data = data_digest(&figure).ok_or(ReopenRefusal::DigestUnavailable)?;
    if data != saved.data {
        return Err(ReopenRefusal::FigureChanged);
    }
    Ok(ReopenedFigure {
        document: saved,
        figure,
    })
}
