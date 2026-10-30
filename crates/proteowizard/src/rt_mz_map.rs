//! The RT × m/z map (ADR 0068, proposed): MS1 intensities binned into a raster
//! of bounded size.
//!
//! One forward pass over the MS1 spectra a spectrum table recorded, through one
//! file handle. Each spectrum is read by the viewing reader's selected read
//! (ADR 0056), so it is checked against the table and decoded under the same
//! caps and typed refusals, and this module decodes nothing itself. Spectra
//! outside the requested retention-time window are never read.
//!
//! Each cell holds the greatest stored intensity of the points that fall in it,
//! whatever the spectrum's representation; a cell no point fell in holds no
//! value, which is not zero. Nothing is smoothed, interpolated or centroided,
//! and a refused spectrum refuses the whole map rather than leaving a gap.

use std::io::{BufRead, BufReader, Seek};
use std::path::Path;

use thiserror::Error;

use crate::fs_guard;
use crate::mzml::MzmlScanError;
use crate::mzml_reader::{
    ArrayRole, ArrayUnit, MzmlRepresentation, MzmlSpectrumError, MzmlSpectrumRow,
    MzmlSpectrumTable, RetentionTimeUnit, read_selected_spectrum_from,
};
use crate::process::CancellationToken;

/// The most cells one map may hold, whatever the request asks for: about two
/// megapixels, 16 MiB of `f64`.
pub const MAX_MAP_CELLS: u64 = 1 << 21;

/// One view of the map: two closed ranges and the bins across each. Retention
/// time is in the unit the MS1 spectra declare, and nothing converts it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MapRequest {
    pub retention_time: (f64, f64),
    pub mz: (f64, f64),
    pub retention_time_bins: u32,
    pub mz_bins: u32,
}

/// Why a map was refused. No variant contains a path or document text, and no
/// refusal leaves a partial raster.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum MapError {
    #[error(
        "a map bound is not finite, or a range is empty, backwards, not finite or too narrow for its bins"
    )]
    InvalidBounds,
    #[error("a map axis has no bins, or the map would exceed its cell cap")]
    InvalidBins,
    #[error("the allocator refused the raster")]
    AllocationRefused,
    #[error("the spectrum table has no MS1 spectrum")]
    NoMs1Spectra,
    #[error("the MS1 spectra state different retention-time units, or only some state one")]
    MixedRetentionTimeUnits,
    #[error("the binned spectra state different {} units, or only some state one", .0.stable_id())]
    MixedArrayUnits(ArrayRole),
    #[error("the file could not be opened: {0}")]
    Unreadable(MzmlScanError),
    #[error("MS1 spectrum {index} was refused: {error}")]
    Spectrum {
        index: u64,
        error: MzmlSpectrumError,
    },
    #[error("the map was cancelled")]
    Cancelled,
}

impl MapError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::InvalidBounds => "map_bounds_invalid",
            Self::InvalidBins => "map_bins_invalid",
            Self::AllocationRefused => "allocation_refused",
            Self::NoMs1Spectra => "no_ms1_spectra",
            Self::MixedRetentionTimeUnits => "mixed_retention_time_units",
            Self::MixedArrayUnits(_) => "mixed_array_units",
            Self::Unreadable(error) => error.stable_id(),
            Self::Spectrum { error, .. } => error.stable_id(),
            Self::Cancelled => "cancelled",
        }
    }
}

/// What the table says about its MS1 spectra before any array is read: the
/// first view's ranges and the retention-time unit every map of it carries.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ms1Extent {
    retention_time: (f64, f64),
    retention_time_unit: RetentionTimeUnit,
    mz: Option<(f64, f64)>,
    spectra: u64,
}

impl Ms1Extent {
    /// The lowest and highest MS1 retention time. Equal for a single spectrum,
    /// which is not a range a map can be drawn over.
    #[must_use]
    pub const fn retention_time(&self) -> (f64, f64) {
        self.retention_time
    }

    #[must_use]
    pub const fn retention_time_unit(&self) -> RetentionTimeUnit {
        self.retention_time_unit
    }

    /// The lowest and highest observed m/z the spectra state (MS:1000528,
    /// MS:1000527); `None` unless every MS1 spectrum states both.
    #[must_use]
    pub const fn mz(&self) -> Option<(f64, f64)> {
        self.mz
    }

    #[must_use]
    pub const fn spectra(&self) -> u64 {
        self.spectra
    }
}

/// The MS1 extent of a table, refusing a table with no MS1 spectrum or with
/// mixed retention-time units, as ADR 0056 refuses a chromatogram.
pub fn ms1_extent(table: &MzmlSpectrumTable) -> Result<Ms1Extent, MapError> {
    let mut rows = table.rows().iter().filter(|row| row.ms_level() == 1);
    let first = rows.next().ok_or(MapError::NoMs1Spectra)?;
    let time = first.retention_time();
    let mut extent = Ms1Extent {
        retention_time: (time.value(), time.value()),
        retention_time_unit: time.unit(),
        mz: observed_mz(first),
        spectra: 1,
    };
    for row in rows {
        let time = row.retention_time();
        if time.unit() != extent.retention_time_unit {
            return Err(MapError::MixedRetentionTimeUnits);
        }
        let (low, high) = extent.retention_time;
        extent.retention_time = (low.min(time.value()), high.max(time.value()));
        extent.mz = extent
            .mz
            .zip(observed_mz(row))
            .map(|((low, high), (lowest, highest))| (low.min(lowest), high.max(highest)));
        extent.spectra += 1;
    }
    Ok(extent)
}

fn observed_mz(row: &MzmlSpectrumRow) -> Option<(f64, f64)> {
    row.lowest_observed_mz().zip(row.highest_observed_mz())
}

/// One computed view: the greatest stored intensity per cell, with what the
/// caption has to state.
#[derive(Clone, PartialEq)]
pub struct RtMzMap {
    request: MapRequest,
    retention_time_axis: Axis,
    mz_axis: Axis,
    retention_time_unit: RetentionTimeUnit,
    mz_unit: ArrayUnit,
    intensity_unit: ArrayUnit,
    /// Row-major by retention-time bin. `NEG_INFINITY`, the identity of `max`,
    /// is a cell no point fell in; the reader refuses non-finite values, so no
    /// stored value can be mistaken for it.
    cells: Vec<f64>,
    spectra: [u64; 3],
    points_binned: u64,
    points_outside_mz: u64,
}

impl RtMzMap {
    #[must_use]
    pub const fn request(&self) -> &MapRequest {
        &self.request
    }

    #[must_use]
    pub const fn retention_time_unit(&self) -> RetentionTimeUnit {
        self.retention_time_unit
    }

    /// The m/z array unit every binned spectrum declared; not declared when
    /// none did, or when no spectrum had a point.
    #[must_use]
    pub const fn mz_unit(&self) -> &ArrayUnit {
        &self.mz_unit
    }

    #[must_use]
    pub const fn intensity_unit(&self) -> &ArrayUnit {
        &self.intensity_unit
    }

    /// The greatest stored intensity in one cell, or `None` when no point fell
    /// in it. A measured zero is `Some(0.0)`.
    #[must_use]
    pub fn cell(&self, retention_time_bin: u32, mz_bin: u32) -> Option<f64> {
        if retention_time_bin >= self.request.retention_time_bins || mz_bin >= self.request.mz_bins
        {
            return None;
        }
        let at = retention_time_bin as usize * self.request.mz_bins as usize + mz_bin as usize;
        self.cells
            .get(at)
            .copied()
            .filter(|value| *value != f64::NEG_INFINITY)
    }

    /// The edges of one retention-time bin, `[lower, upper)`; the last bin
    /// also holds its upper edge. These are the edges the pass binned with.
    #[must_use]
    pub fn retention_time_edges(&self, retention_time_bin: u32) -> Option<(f64, f64)> {
        self.retention_time_axis.edges(retention_time_bin)
    }

    /// The edges of one m/z bin, as [`Self::retention_time_edges`].
    #[must_use]
    pub fn mz_edges(&self, mz_bin: u32) -> Option<(f64, f64)> {
        self.mz_axis.edges(mz_bin)
    }

    /// How many binned spectra declared this representation.
    #[must_use]
    pub const fn spectra(&self, representation: MzmlRepresentation) -> u64 {
        self.spectra[representation_slot(representation)]
    }

    #[must_use]
    pub const fn points_binned(&self) -> u64 {
        self.points_binned
    }

    /// Points of binned spectra whose m/z lies outside the requested range.
    #[must_use]
    pub const fn points_outside_mz(&self) -> u64 {
        self.points_outside_mz
    }
}

impl std::fmt::Debug for RtMzMap {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RtMzMap")
            .field("request", &self.request)
            .field("spectra", &self.spectra)
            .field("points_binned", &self.points_binned)
            .finish_non_exhaustive()
    }
}

const fn representation_slot(representation: MzmlRepresentation) -> usize {
    match representation {
        MzmlRepresentation::Profile => 0,
        MzmlRepresentation::Centroid => 1,
        MzmlRepresentation::NotDeclared => 2,
    }
}

/// Bins the MS1 spectra of the file the table was read from, after refusing
/// any non-regular, symlinked or reparse-point path. Holds one handle for the
/// pass and none after it returns.
pub fn bin_rt_mz_map(
    path: &Path,
    table: &MzmlSpectrumTable,
    request: MapRequest,
    cancel: &CancellationToken,
    progress: impl FnMut(u64, u64),
) -> Result<RtMzMap, MapError> {
    let (file, _length) = fs_guard::open_regular_file(path)
        .map_err(|error| MapError::Unreadable(MzmlScanError::from(error)))?;
    bin_rt_mz_map_from(
        BufReader::with_capacity(64 * 1024, file),
        table,
        request,
        cancel,
        progress,
    )
}

/// Bins the MS1 spectra from a seekable reader over the document the table was
/// read from. `progress` hears `(done, total)` after each spectrum, where
/// `total` counts the MS1 spectra inside the retention-time window; the token
/// is checked before each spectrum is read and once after the last.
pub fn bin_rt_mz_map_from<R: BufRead + Seek>(
    mut reader: R,
    table: &MzmlSpectrumTable,
    request: MapRequest,
    cancel: &CancellationToken,
    mut progress: impl FnMut(u64, u64),
) -> Result<RtMzMap, MapError> {
    let retention_time_unit = ms1_extent(table)?.retention_time_unit;
    let time_axis = Axis::new(request.retention_time, request.retention_time_bins)?;
    let mz_axis = Axis::new(request.mz, request.mz_bins)?;
    let cell_count = u64::from(request.retention_time_bins) * u64::from(request.mz_bins);
    if cell_count > MAX_MAP_CELLS {
        return Err(MapError::InvalidBins);
    }
    let cell_count = usize::try_from(cell_count).map_err(|_| MapError::InvalidBins)?;
    let mut cells = Vec::new();
    cells
        .try_reserve_exact(cell_count)
        .map_err(|_| MapError::AllocationRefused)?;
    cells.resize(cell_count, f64::NEG_INFINITY);

    let total = ms1_in_window(table, time_axis).count() as u64;
    let (mut mz_unit, mut intensity_unit) = (None, None);
    let mut spectra = [0; 3];
    let (mut points_binned, mut points_outside_mz) = (0, 0);
    let mut done = 0;
    for (position, row, time_bin) in ms1_in_window(table, time_axis) {
        if cancel.is_cancelled() {
            return Err(MapError::Cancelled);
        }
        let index = position as u64;
        let spectrum = read_selected_spectrum_from(&mut reader, table, index)
            .map_err(|error| MapError::Spectrum { index, error })?;
        spectra[representation_slot(row.representation())] += 1;
        let (mz, intensity) = (spectrum.mz(), spectrum.intensity());
        // An empty spectrum's absent arrays declare nothing, so only a spectrum
        // with points takes part in the units' agreement.
        if !mz.values().is_empty() {
            agree(&mut mz_unit, mz.unit(), ArrayRole::Mz)?;
            agree(&mut intensity_unit, intensity.unit(), ArrayRole::Intensity)?;
        }
        let row_start = time_bin * request.mz_bins as usize;
        for (&mz, &intensity) in mz.values().iter().zip(intensity.values()) {
            match mz_axis.bin(mz) {
                Some(mz_bin) => {
                    let cell = &mut cells[row_start + mz_bin];
                    *cell = cell.max(intensity);
                    points_binned += 1;
                }
                None => points_outside_mz += 1,
            }
        }
        done += 1;
        progress(done, total);
    }
    // A cancel during the last spectrum, or before an empty window, still
    // leaves no raster.
    if cancel.is_cancelled() {
        return Err(MapError::Cancelled);
    }
    Ok(RtMzMap {
        request,
        retention_time_axis: time_axis,
        mz_axis,
        retention_time_unit,
        mz_unit: mz_unit.unwrap_or(ArrayUnit::NotDeclared),
        intensity_unit: intensity_unit.unwrap_or(ArrayUnit::NotDeclared),
        cells,
        spectra,
        points_binned,
        points_outside_mz,
    })
}

/// The MS1 rows whose retention time falls in the window, with their table
/// position and retention-time bin. Read from the table alone.
fn ms1_in_window(
    table: &MzmlSpectrumTable,
    axis: Axis,
) -> impl Iterator<Item = (usize, &MzmlSpectrumRow, usize)> {
    table
        .rows()
        .iter()
        .enumerate()
        .filter(|(_, row)| row.ms_level() == 1)
        .filter_map(move |(position, row)| {
            Some((position, row, axis.bin(row.retention_time().value())?))
        })
}

fn agree(seen: &mut Option<ArrayUnit>, unit: &ArrayUnit, role: ArrayRole) -> Result<(), MapError> {
    match seen {
        Some(seen) if seen != unit => Err(MapError::MixedArrayUnits(role)),
        Some(_) => Ok(()),
        None => {
            *seen = Some(unit.clone());
            Ok(())
        }
    }
}

/// Equal-width bins over a closed range. Each bin is half-open, `[edge, next)`,
/// except the last, which also holds the upper bound itself.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Axis {
    low: f64,
    high: f64,
    /// The width of one bin.
    step: f64,
    bins: u32,
}

impl Axis {
    fn new((low, high): (f64, f64), bins: u32) -> Result<Self, MapError> {
        if bins == 0 {
            return Err(MapError::InvalidBins);
        }
        let width = high - low;
        if !(low.is_finite() && high.is_finite() && width.is_finite() && width > 0.0) {
            return Err(MapError::InvalidBounds);
        }
        let step = width / f64::from(bins);
        // Each edge is within about two units in the last place of the larger
        // bound, so a bin four of them wide keeps every edge above the last;
        // a narrower bin would have no width.
        if step < low.abs().max(high.abs()) * f64::EPSILON * 4.0 {
            return Err(MapError::InvalidBounds);
        }
        Ok(Self {
            low,
            high,
            step,
            bins,
        })
    }

    /// The lower edge of bin `k`, and the upper bound at `k == bins`. Edges
    /// never decrease and never pass the upper bound.
    fn edge(self, k: u32) -> f64 {
        if k >= self.bins {
            return self.high;
        }
        (self.low + self.step * f64::from(k)).min(self.high)
    }

    fn edges(self, k: u32) -> Option<(f64, f64)> {
        (k < self.bins).then(|| (self.edge(k), self.edge(k + 1)))
    }

    /// The bin `k` with `edge(k) <= value < edge(k + 1)`; the last bin also
    /// holds the upper bound.
    fn bin(self, value: f64) -> Option<usize> {
        if !(self.low..=self.high).contains(&value) {
            return None;
        }
        // A first guess; the quotient is not negative, and `as` floors and
        // saturates it. Rounding can put the guess one bin off an edge, so the
        // edges themselves decide.
        let guess = (((value - self.low) / self.step) as u32).min(self.bins - 1);
        let bin = if guess > 0 && value < self.edge(guess) {
            self.search(value, guess - 1)
        } else if guess + 1 < self.bins && value >= self.edge(guess + 1) {
            self.search(value, guess + 1)
        } else {
            guess
        };
        Some(bin as usize)
    }

    /// Walks from `bin` to the bin whose edges hold `value`: rarely needed,
    /// and more than one step only where rounding makes edges coincide. Kept
    /// out of line: the same loops inside `bin` added about 2 s to the
    /// measured 25-million-point profile pass.
    #[cold]
    fn search(self, value: f64, mut bin: u32) -> u32 {
        while bin > 0 && value < self.edge(bin) {
            bin -= 1;
        }
        while bin + 1 < self.bins && value >= self.edge(bin + 1) {
            bin += 1;
        }
        bin
    }
}

#[cfg(test)]
mod tests;
