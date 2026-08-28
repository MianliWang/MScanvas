//! What a spectrum viewport is allowed to know, and what it is given to draw.
//!
//! ## Two questions, and they are not the same one
//!
//! **Does this spectrum have a viewport at all?** A viewport needs an
//! authoritative finite forward m/z domain, and the scientific figure contract
//! cannot always establish one: mzML does not require an ordered m/z array and
//! nothing here sorts one, so a legal spectrum can be valid source data with no
//! domain. That spectrum is not corrupt -- its CSV and TSV still write -- and
//! this module answers `Refused` rather than inventing endpoints for it.
//!
//! **What does a committed range look like on a screen?** The complete spectrum
//! Rust retained is the scientific source, and `MAX_SPECTRUM_POINTS` bounds what
//! one transfer carries -- so a viewport spanning the whole source while its data
//! stops at that prefix would draw blank space over peaks this session is
//! holding. The answer is a **bounded screen projection** taken from the
//! retained source for the range asked of it.
//!
//! ## What a projection is, and is not
//!
//! A drawing. It may reduce point count to fit a screen budget, and every value
//! it carries is a value the source measured. It never invents an m/z or an
//! intensity, never reorders the source to make it drawable, never normalises,
//! never interpolates, and **never becomes export authority**: scientific export
//! is a sibling projection of the same retained source, taken from the complete
//! arrays rather than from anything a screen was given.
//!
//! ## One admissibility answer, not two
//!
//! The domain a viewport navigates is the domain the *figure* would draw over,
//! decided by the same rule through
//! [`mscanvas_plot_spec::spec::validate_measurement_coordinates`], which
//! `SeriesSpec::new` itself calls. A second, more permissive reader for the
//! viewport is exactly how the screen and the export renderer came to describe
//! different things before.

use mscanvas_plot_spec::spec::{Domain, SpecError, validate_measurement_coordinates};

use mscanvas_proteowizard::SelectedSpectrumResult;

/// The most columns a screen projection reduces to.
///
/// The same figure the on-screen stick renderer draws at, and for the same
/// reason: a spectrum can carry far more points than a display has columns, so
/// the bound is a property of the drawing rather than of the measurement.
pub(super) const MAX_PROJECTION_COLUMNS: usize = 900;

/// The most points one projection may carry.
///
/// Two per column, because a column can hold measured signal of both signs and
/// dropping either would erase one. Named here rather than left as an implied
/// product of the constant above, so a reader can check the payload bound
/// without doing the arithmetic themselves.
pub(super) const MAX_PROJECTION_POINTS: usize = MAX_PROJECTION_COLUMNS * 2;

/// Whether a retained spectrum has an m/z domain a viewport may navigate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum ViewportDomain {
    /// The scientific contract established this domain over the complete
    /// retained source.
    Admitted(Domain),
    /// The contract could not establish one without altering the source.
    Refused(DomainRefusal),
}

/// Why no viewport domain could be established.
///
/// Carried as a reason rather than a bare `None` so the interface can say what
/// the reader is looking at instead of only that something is missing. Each
/// variant is a verdict of the figure contract, not a judgement about whether
/// the file is good: a refused spectrum is still valid source data and still
/// exports as CSV and TSV.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DomainRefusal {
    /// The m/z array is not non-decreasing.
    ///
    /// mzML permits this and nothing here sorts one. The figure contract
    /// refuses such a series, so the viewport refuses it too rather than
    /// reordering the measurement to obtain a domain.
    SourceNotOrdered,
    /// A coordinate cannot be placed on an axis.
    NotFinite,
    /// The two arrays disagree about how many points the spectrum has.
    AxisLengthMismatch,
    /// The endpoints do not form a domain the contract accepts.
    DomainUnusable,
}

impl DomainRefusal {
    /// The refusal a figure error maps to.
    ///
    /// Exhaustive over what the shared validator and `Domain::new` can answer
    /// for this input, with everything else folded into the domain refusal
    /// rather than silently admitted: a verdict this module cannot name is
    /// still a verdict that no domain was established.
    fn from_spec_error(error: SpecError) -> Self {
        match error {
            SpecError::SourceNotOrdered => Self::SourceNotOrdered,
            SpecError::NotFinite => Self::NotFinite,
            SpecError::AxisLengthMismatch => Self::AxisLengthMismatch,
            _ => Self::DomainUnusable,
        }
    }
}

/// The m/z domain the scientific figure would draw this spectrum over.
///
/// The one place the question is answered. It reads the complete retained
/// source -- never a transferred prefix, never the separately reported
/// `mz_low`/`mz_high` pair, which is a second reading of the same spectrum that
/// the export renderer already documents its refusal of -- and it borrows the
/// arrays rather than copying them, because asking whether a spectrum is
/// drawable should not cost a duplicate of it.
pub(super) fn viewport_domain(spectrum: &SelectedSpectrumResult) -> ViewportDomain {
    let mz = spectrum.mz_values();
    if let Err(error) = validate_measurement_coordinates(mz, spectrum.intensity_values()) {
        return ViewportDomain::Refused(DomainRefusal::from_spec_error(error));
    }
    // The ends of an admitted series are its extremes, which is what the
    // validator above has just established. An empty spectrum has no points to
    // take a range from and gets the one domain that claims nothing -- the same
    // answer `domain_of` gives the exported figure, so the two agree there too.
    let domain = match (mz.first(), mz.last()) {
        (Some(low), Some(high)) => Domain::new(*low, *high),
        _ => Domain::new(0.0, 0.0),
    };
    match domain {
        Ok(domain) => ViewportDomain::Admitted(domain),
        Err(error) => ViewportDomain::Refused(DomainRefusal::from_spec_error(error)),
    }
}

/// Why a projection could not be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProjectionRefusal {
    /// This spectrum has no viewport domain at all.
    NoViewportDomain(DomainRefusal),
    /// The requested window is not a window.
    WindowUnusable,
    /// The requested window reaches outside the retained source's own domain.
    ///
    /// Refused rather than clamped, for the reason the chromatogram's range
    /// already gives: a request for a window this source does not have is a
    /// request about something else, and quietly answering with the nearest one
    /// that does fit answers a question nobody asked.
    WindowOutsideSource,
}

/// One bounded drawing of one committed m/z window.
///
/// Every value in it came out of the retained source. `source_points` is how
/// many source observations the window actually holds, which is what makes
/// `reduced` checkable rather than a claim: a reduction says fewer points are
/// drawn than were measured there, and a reader can see both numbers.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct ScreenProjection {
    window: Domain,
    mz: Vec<f64>,
    intensity: Vec<f64>,
    source_points: usize,
    reduced: bool,
}

impl ScreenProjection {
    pub(super) const fn window(&self) -> Domain {
        self.window
    }

    pub(super) fn mz(&self) -> &[f64] {
        &self.mz
    }

    pub(super) fn intensity(&self) -> &[f64] {
        &self.intensity
    }

    /// How many source observations the requested window holds.
    pub(super) const fn source_points(&self) -> usize {
        self.source_points
    }

    /// Whether fewer points are drawn than the window measured.
    pub(super) const fn reduced(&self) -> bool {
        self.reduced
    }

    /// Whether the window holds no reported observation at all.
    ///
    /// A successful answer rather than a failure: a range of a spectrum may
    /// truthfully contain nothing, and for a discrete spectrum nothing is
    /// interpolated to avoid saying so. The wire carries the empty arrays
    /// themselves, so this exists for the tests that name the property.
    #[cfg(test)]
    pub(super) fn is_empty(&self) -> bool {
        self.mz.is_empty()
    }
}

/// Draws one committed window of one retained spectrum.
///
/// # Errors
///
/// Refuses a spectrum with no viewport domain, a window that is not a finite
/// forward interval, and a window reaching outside the source's own domain.
pub(super) fn project(
    spectrum: &SelectedSpectrumResult,
    low: f64,
    high: f64,
) -> Result<ScreenProjection, ProjectionRefusal> {
    let source = match viewport_domain(spectrum) {
        ViewportDomain::Admitted(domain) => domain,
        ViewportDomain::Refused(refusal) => {
            return Err(ProjectionRefusal::NoViewportDomain(refusal));
        }
    };
    let window = Domain::new(low, high).map_err(|_| ProjectionRefusal::WindowUnusable)?;
    if window.low() < source.low() || window.high() > source.high() {
        return Err(ProjectionRefusal::WindowOutsideSource);
    }

    let mz = spectrum.mz_values();
    let intensity = spectrum.intensity_values();
    // The array is non-decreasing -- the domain above established that -- so the
    // window is one contiguous run and finding it costs a search rather than a
    // scan of the whole spectrum.
    let start = mz.partition_point(|value| *value < window.low());
    let end = mz.partition_point(|value| *value <= window.high());
    let source_points = end.saturating_sub(start);

    if source_points <= MAX_PROJECTION_POINTS {
        // Everything the window holds fits the budget, so the drawing is the
        // measurement: no reduction, no rule to explain, nothing dropped.
        return Ok(ScreenProjection {
            window,
            mz: mz[start..end].to_vec(),
            intensity: intensity[start..end].to_vec(),
            source_points,
            reduced: false,
        });
    }

    Ok(reduce(
        window,
        &mz[start..end],
        &intensity[start..end],
        source_points,
    ))
}

/// Keeps the extremes of each column, at the m/z the source measured them.
///
/// The posture the on-screen stick renderer already established, restated where
/// the complete source lives: each column keeps its greatest non-negative and
/// its deepest negative observation, **both**, because a column holding +100 and
/// -90 must draw both and keeping only the larger magnitude erases measured
/// signal of the other sign. Keeping extremes is also what makes a reduction
/// safe to look at -- a tall peak can never be replaced by a shorter neighbour,
/// and no value is drawn that the window does not contain.
///
/// Points are emitted in ascending m/z so the result is a series the same
/// ordering rule admits.
fn reduce(window: Domain, mz: &[f64], intensity: &[f64], source_points: usize) -> ScreenProjection {
    let span = window.high() - window.low();
    let columns = MAX_PROJECTION_COLUMNS;
    // Two candidates per column, held by the m/z they were measured at.
    let mut highest: Vec<Option<(f64, f64)>> = vec![None; columns];
    let mut lowest: Vec<Option<(f64, f64)>> = vec![None; columns];

    for (value, height) in mz.iter().copied().zip(intensity.iter().copied()) {
        let fraction = if span > 0.0 {
            (value - window.low()) / span
        } else {
            0.0
        };
        // `columns - 1` for the window's own upper edge, which lands at exactly
        // one and would otherwise index past the end.
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "the fraction is clamped into [0, 1] and columns is small"
        )]
        let column = ((fraction.clamp(0.0, 1.0) * columns as f64) as usize).min(columns - 1);
        let slot = if height >= 0.0 {
            &mut highest[column]
        } else {
            &mut lowest[column]
        };
        match slot {
            Some((_, kept)) => {
                let better = if height >= 0.0 {
                    height > *kept
                } else {
                    height < *kept
                };
                if better {
                    *slot = Some((value, height));
                }
            }
            None => *slot = Some((value, height)),
        }
    }

    let mut points: Vec<(f64, f64)> = Vec::with_capacity(MAX_PROJECTION_POINTS);
    for column in 0..columns {
        for kept in [highest[column], lowest[column]].into_iter().flatten() {
            points.push(kept);
        }
    }
    // By measured m/z, so a column that kept both signs emits them in the order
    // the source has them rather than in the order this loop happened to visit.
    points.sort_by(|left, right| left.0.total_cmp(&right.0));

    let drawn = points.len();
    let (mz, intensity) = points.into_iter().unzip();
    ScreenProjection {
        window,
        mz,
        intensity,
        source_points,
        // A reduction that dropped nothing is not one, and saying otherwise
        // would make a caption claim measurements were removed when none were.
        reduced: drawn < source_points,
    }
}

#[cfg(test)]
mod tests;
