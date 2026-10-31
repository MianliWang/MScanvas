//! Statistics over a feature table: PCA, Welch's t-test with a log2 fold
//! change, Benjamini-Hochberg q-values, volcano rows and QC metrics
//! (ADR 0069).
//!
//! Pure functions, no I/O. A refusal is a [`StatsError`]; a number that cannot
//! be computed for one feature is an [`Unavailable`] reason, never a NaN and
//! never an invented value. Nothing is imputed: a missing value is `None` and
//! stays missing.

#![forbid(unsafe_code)]

use nalgebra::{DMatrix, SymmetricEigen};
use statrs::distribution::{ContinuousCDF, StudentsT};

/// The most samples a PCA accepts. The Gram route costs O(samples² ×
/// features); ADR 0069 records the time measured at this bound.
pub const MAX_PCA_SAMPLES: usize = 1_000;

/// The most cells (samples × features) a PCA accepts.
pub const MAX_PCA_CELLS: usize = 20_000_000;

/// Why a call was refused. Nothing is computed when one is returned.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum StatsError {
    #[error("the shape needs {expected} values, got {actual}")]
    ShapeMismatch { expected: usize, actual: usize },
    #[error("the value of feature {feature} in sample {sample} is not finite")]
    NonFinite { feature: usize, sample: usize },
    #[error("the value of feature {feature} in sample {sample} is not positive and has no log2")]
    NonPositive { feature: usize, sample: usize },
    #[error("sample {sample} is outside the {samples} samples")]
    SampleOutOfRange { sample: usize, samples: usize },
    #[error("sample {sample} is listed twice")]
    DuplicateSample { sample: usize },
    #[error("needs at least {needed} samples, got {actual}")]
    TooFewSamples { needed: usize, actual: usize },
    #[error("no feature has a value in every sample")]
    NoCompleteFeature,
    #[error("no complete feature varies across the samples")]
    ZeroVariance,
    #[error("{requested} components requested, {available} available")]
    ComponentsOutOfRange { requested: usize, available: usize },
    #[error("{samples} samples by {features} features is above the PCA bound")]
    TooLarge { samples: usize, features: usize },
    #[error("p-value {value} at {index} is not in [0, 1]")]
    InvalidPValue { index: usize, value: f64 },
    /// A value left the range of `f64`: it overflowed, or (for a PCA's Gram
    /// matrix) underflowed so far that its digits are lost.
    #[error("an intermediate value overflowed or underflowed")]
    Overflow,
    #[error("the eigen decomposition did not converge")]
    NotConverged,
}

/// Why one feature has no value for a statistic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unavailable {
    /// Fewer than two observed values (in either group, for a test).
    TooFewObservations,
    /// Every observed value is identical (in both groups, for a test). For
    /// PCA, also a standard deviation within n·ε·max|x|, which rounding alone
    /// can produce.
    ZeroVariance,
    /// The feature has a missing value; PCA uses complete features only.
    Missing,
    /// The mean is not positive, so a relative standard deviation is undefined.
    NonPositiveMean,
    /// An intermediate value overflowed.
    Overflow,
}

/// Feature-table values, feature-major: feature `f` in sample `s` is
/// `values[f * samples + s]`. `None` is a missing value.
#[derive(Debug, Clone, PartialEq)]
pub struct Matrix {
    samples: usize,
    features: usize,
    values: Vec<Option<f64>>,
}

impl Matrix {
    /// Refuses a length that does not match the shape and any non-finite value.
    pub fn new(
        samples: usize,
        features: usize,
        values: Vec<Option<f64>>,
    ) -> Result<Self, StatsError> {
        let expected = samples.saturating_mul(features);
        if values.len() != expected {
            return Err(StatsError::ShapeMismatch {
                expected,
                actual: values.len(),
            });
        }
        if let Some(at) = values
            .iter()
            .position(|v| v.is_some_and(|x| !x.is_finite()))
        {
            return Err(StatsError::NonFinite {
                feature: at / samples,
                sample: at % samples,
            });
        }
        Ok(Self {
            samples,
            features,
            values,
        })
    }

    pub fn samples(&self) -> usize {
        self.samples
    }

    pub fn features(&self) -> usize {
        self.features
    }

    fn feature(&self, feature: usize) -> &[Option<f64>] {
        &self.values[feature * self.samples..(feature + 1) * self.samples]
    }
}

/// Refuses an index outside the matrix, an index listed twice anywhere in
/// `sets`, and a set smaller than `min`.
fn check_sets(samples: usize, sets: &[&[usize]], min: usize) -> Result<(), StatsError> {
    let mut seen = vec![false; samples];
    for set in sets {
        if set.len() < min {
            return Err(StatsError::TooFewSamples {
                needed: min,
                actual: set.len(),
            });
        }
        for &sample in *set {
            let slot = seen
                .get_mut(sample)
                .ok_or(StatsError::SampleOutOfRange { sample, samples })?;
            if *slot {
                return Err(StatsError::DuplicateSample { sample });
            }
            *slot = true;
        }
    }
    Ok(())
}

fn observed(values: &[Option<f64>], set: &[usize]) -> Vec<f64> {
    set.iter().filter_map(|&s| values[s]).collect()
}

/// Mean and sample standard deviation (n − 1) of at least one value. The mean
/// is corrected by the mean of the residuals before the deviation is summed
/// around it (the corrected two-pass algorithm). The residuals are divided by
/// the largest of them before they are squared, so the squares can neither
/// overflow nor underflow; a deviation outside `f64` comes back non-finite, as
/// does a mean that overflowed. Identical values give exactly zero, which one
/// rounding of the mean would otherwise turn into a tiny positive deviation.
fn mean_sd(x: &[f64]) -> (f64, f64) {
    let first = x[0];
    if x.iter().all(|&v| v == first) {
        return (first, 0.0);
    }
    let n = x.len() as f64;
    let rough = x.iter().sum::<f64>() / n;
    let mean = rough + x.iter().map(|v| v - rough).sum::<f64>() / n;
    let scale = x.iter().map(|v| (v - mean).abs()).fold(0.0, f64::max);
    let squares: f64 = x
        .iter()
        .map(|v| {
            let r = (v - mean) / scale;
            r * r
        })
        .sum();
    (mean, scale * (squares / (n - 1.0)).sqrt())
}

/// One feature's two-sided Welch test on log2 values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Welch {
    /// mean(log2 A) − mean(log2 B), over the observed values.
    pub log2_fold_change: f64,
    pub t: f64,
    /// Welch-Satterthwaite degrees of freedom.
    pub df: f64,
    /// 2 · sf(|t|), never 1 − cdf, which underflows.
    pub p: f64,
    /// Observed values that entered the test from group A.
    pub observed_a: usize,
    /// Observed values that entered the test from group B.
    pub observed_b: usize,
}

/// A two-sided Welch test of group `a` against group `b` for every feature, on
/// the log2 of the observed intensities. Missing values are left out and
/// counted; a non-positive intensity in either group refuses the call, because
/// it has no log2 and flooring it would invent a value.
pub fn welch(
    intensities: &Matrix,
    a: &[usize],
    b: &[usize],
) -> Result<Vec<Result<Welch, Unavailable>>, StatsError> {
    check_sets(intensities.samples, &[a, b], 2)?;
    (0..intensities.features)
        .map(|feature| {
            let values = intensities.feature(feature);
            let a = observed_log2(values, a, feature)?;
            let b = observed_log2(values, b, feature)?;
            Ok(welch_one(&a, &b))
        })
        .collect()
}

fn observed_log2(
    values: &[Option<f64>],
    set: &[usize],
    feature: usize,
) -> Result<Vec<f64>, StatsError> {
    set.iter()
        .filter_map(|&sample| values[sample].map(|v| (sample, v)))
        .map(|(sample, v)| {
            if v > 0.0 {
                Ok(v.log2())
            } else {
                Err(StatsError::NonPositive { feature, sample })
            }
        })
        .collect()
}

fn welch_one(a: &[f64], b: &[f64]) -> Result<Welch, Unavailable> {
    if a.len() < 2 || b.len() < 2 {
        return Err(Unavailable::TooFewObservations);
    }
    let (mean_a, sd_a) = mean_sd(a);
    let (mean_b, sd_b) = mean_sd(b);
    let (na, nb) = (a.len() as f64, b.len() as f64);
    // log2 values lie within ±1075, so these squares stay in range.
    let (se_a, se_b) = (sd_a * sd_a / na, sd_b * sd_b / nb);
    let se = se_a + se_b;
    if se == 0.0 {
        return Err(Unavailable::ZeroVariance);
    }
    let log2_fold_change = mean_a - mean_b;
    let t = log2_fold_change / se.sqrt();
    // Each share divided by the sum first, so a tiny variance cannot underflow
    // when squared.
    let (share_a, share_b) = (se_a / se, se_b / se);
    let df = 1.0 / (share_a * share_a / (na - 1.0) + share_b * share_b / (nb - 1.0));
    // df is at least min(na, nb) − 1 ≥ 1 here, so the distribution exists.
    let distribution = StudentsT::new(0.0, 1.0, df).map_err(|_| Unavailable::ZeroVariance)?;
    Ok(Welch {
        log2_fold_change,
        t,
        df,
        p: 2.0 * distribution.sf(t.abs()),
        observed_a: a.len(),
        observed_b: b.len(),
    })
}

/// Benjamini-Hochberg q-values over exactly the family given, in its order.
pub fn benjamini_hochberg(p: &[f64]) -> Result<Vec<f64>, StatsError> {
    if let Some((index, &value)) = p
        .iter()
        .enumerate()
        .find(|(_, v)| !(0.0..=1.0).contains(*v))
    {
        return Err(StatsError::InvalidPValue { index, value });
    }
    let m = p.len() as f64;
    let mut order: Vec<usize> = (0..p.len()).collect();
    order.sort_by(|&i, &j| p[i].total_cmp(&p[j]));
    let mut q = vec![0.0; p.len()];
    let mut running = 1.0_f64;
    for (rank, &i) in order.iter().enumerate().rev() {
        running = running.min(p[i] * m / (rank + 1) as f64);
        q[i] = running;
    }
    Ok(q)
}

/// One tested feature on a volcano plot.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VolcanoRow {
    /// Index into the slice given to [`volcano`].
    pub feature: usize,
    pub log2_fold_change: f64,
    pub p: f64,
    pub q: f64,
}

/// One row per tested feature. The BH family is exactly the tested features of
/// `tests`, so filter before calling: q-values never change with a view.
pub fn volcano(tests: &[Result<Welch, Unavailable>]) -> Result<Vec<VolcanoRow>, StatsError> {
    let tested: Vec<(usize, &Welch)> = tests
        .iter()
        .enumerate()
        .filter_map(|(feature, test)| test.as_ref().ok().map(|w| (feature, w)))
        .collect();
    let p: Vec<f64> = tested.iter().map(|(_, w)| w.p).collect();
    let q = benjamini_hochberg(&p)?;
    Ok(tested
        .iter()
        .zip(q)
        .map(|(&(feature, w), q)| VolcanoRow {
            feature,
            log2_fold_change: w.log2_fold_change,
            p: w.p,
            q,
        })
        .collect())
}

/// One feature's quality-control metrics. Any present value counts as
/// detected, zero and negative ones included: the import maps "not detected"
/// to missing (ADR 0069, open question 7).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QcFeature {
    /// Fraction of the QC injections with a value.
    pub qc_detection_rate: f64,
    /// 100 · sd / mean of the observed QC values, raw scale, sd with n − 1.
    pub qc_rsd_percent: Result<f64, Unavailable>,
    /// Fraction of the study samples with no value.
    pub missing_fraction: f64,
}

/// QC metrics for every feature. `qc` and `study` may overlap; neither may be
/// empty or list a sample twice.
pub fn qc_metrics(
    intensities: &Matrix,
    qc: &[usize],
    study: &[usize],
) -> Result<Vec<QcFeature>, StatsError> {
    check_sets(intensities.samples, &[qc], 1)?;
    check_sets(intensities.samples, &[study], 1)?;
    Ok((0..intensities.features)
        .map(|feature| {
            let values = intensities.feature(feature);
            let in_qc = observed(values, qc);
            let missing = study.iter().filter(|&&s| values[s].is_none()).count();
            QcFeature {
                qc_detection_rate: in_qc.len() as f64 / qc.len() as f64,
                qc_rsd_percent: rsd_percent(&in_qc),
                missing_fraction: missing as f64 / study.len() as f64,
            }
        })
        .collect())
}

fn rsd_percent(x: &[f64]) -> Result<f64, Unavailable> {
    if x.len() < 2 {
        return Err(Unavailable::TooFewObservations);
    }
    let (mean, sd) = mean_sd(x);
    // An overflowed mean is not a non-positive one.
    if !mean.is_finite() {
        return Err(Unavailable::Overflow);
    }
    if mean <= 0.0 {
        return Err(Unavailable::NonPositiveMean);
    }
    let rsd = 100.0 * sd / mean;
    if rsd.is_finite() {
        Ok(rsd)
    } else {
        Err(Unavailable::Overflow)
    }
}

/// How each feature is scaled after mean-centring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scaling {
    /// Mean-centring only.
    None,
    /// Divided by its standard deviation (n − 1): unit variance.
    Auto,
    /// Divided by the square root of its standard deviation.
    Pareto,
}

/// A principal component analysis of the complete, varying features.
#[derive(Debug, Clone, PartialEq)]
pub struct Pca {
    /// Features that entered the decomposition, ascending.
    pub used_features: Vec<usize>,
    /// Features left out, ascending, each with why: missing or zero variance.
    pub excluded_features: Vec<(usize, Unavailable)>,
    /// `scores[c][s]`: sample `s` on component `c`.
    pub scores: Vec<Vec<f64>>,
    /// `loadings[c][i]`: the weight of `used_features[i]` on component `c`.
    /// Each component has unit length and its largest-magnitude weight
    /// positive (the first, on a tie), which fixes the sign.
    pub loadings: Vec<Vec<f64>>,
    /// Variance along each component: eigenvalue / (samples − 1).
    pub explained_variance: Vec<f64>,
    /// Each component's share of the scaled matrix's total variance.
    pub explained_variance_ratio: Vec<f64>,
}

/// PCA through the samples × samples Gram matrix, which is far cheaper than an
/// SVD of the wide matrix when samples ≪ features. Features with a missing
/// value or zero variance are left out and listed, never filled in.
pub fn pca(values: &Matrix, scaling: Scaling, components: usize) -> Result<Pca, StatsError> {
    let n = values.samples;
    if n < 2 {
        return Err(StatsError::TooFewSamples {
            needed: 2,
            actual: n,
        });
    }
    if n > MAX_PCA_SAMPLES || n.saturating_mul(values.features) > MAX_PCA_CELLS {
        return Err(StatsError::TooLarge {
            samples: n,
            features: values.features,
        });
    }

    let mut used_features = Vec::new();
    let mut excluded_features = Vec::new();
    let mut columns = Vec::new();
    for feature in 0..values.features {
        let Some(x) = values
            .feature(feature)
            .iter()
            .copied()
            .collect::<Option<Vec<f64>>>()
        else {
            excluded_features.push((feature, Unavailable::Missing));
            continue;
        };
        let (mean, sd) = mean_sd(&x);
        if !mean.is_finite() || !sd.is_finite() {
            return Err(StatsError::Overflow);
        }
        // A deviation within n·ε·max|x|, the order of the rounding error a
        // summed mean can carry (cf. Chan, Golub and LeVeque 1983), does not
        // resolve the feature from a constant; scaling it to unit variance
        // would weigh rounding noise like a real feature.
        let peak = x.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
        if sd <= n as f64 * f64::EPSILON * peak {
            excluded_features.push((feature, Unavailable::ZeroVariance));
            continue;
        }
        let divisor = match scaling {
            Scaling::None => 1.0,
            Scaling::Auto => sd,
            Scaling::Pareto => sd.sqrt(),
        };
        columns.extend(x.iter().map(|v| (v - mean) / divisor));
        used_features.push(feature);
    }
    if used_features.is_empty() {
        return Err(
            if excluded_features
                .iter()
                .any(|(_, why)| *why == Unavailable::ZeroVariance)
            {
                StatsError::ZeroVariance
            } else {
                StatsError::NoCompleteFeature
            },
        );
    }

    let x = DMatrix::from_vec(n, used_features.len(), columns);
    let gram = &x * x.transpose();
    if gram.iter().any(|v| !v.is_finite()) {
        return Err(StatsError::Overflow);
    }
    // An infinite trace would turn every ratio into 0; a zero or subnormal one
    // means the Gram matrix underflowed and lost its digits.
    let total = gram.trace();
    if !total.is_normal() {
        return Err(StatsError::Overflow);
    }
    // LAPACK's own iteration bound for the symmetric tridiagonal QR.
    let eigen =
        SymmetricEigen::try_new(gram, f64::EPSILON, 30 * n).ok_or(StatsError::NotConverged)?;
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&i, &j| eigen.eigenvalues[j].total_cmp(&eigen.eigenvalues[i]));

    // A component's loadings carry a relative error of about ε · λ₁ / λ through
    // the Gram route, so one with λ ≤ √ε · λ₁ is not resolved and not reported.
    let largest = eigen.eigenvalues[order[0]];
    if !largest.is_normal() {
        return Err(StatsError::Overflow);
    }
    let floor = largest * f64::EPSILON.sqrt();
    let rank = order
        .iter()
        .take_while(|&&i| eigen.eigenvalues[i] > floor)
        .count();
    let available = rank.min(n - 1).min(used_features.len());
    if components == 0 || components > available {
        return Err(StatsError::ComponentsOutOfRange {
            requested: components,
            available,
        });
    }

    let mut result = Pca {
        used_features,
        excluded_features,
        scores: Vec::with_capacity(components),
        loadings: Vec::with_capacity(components),
        explained_variance: Vec::with_capacity(components),
        explained_variance_ratio: Vec::with_capacity(components),
    };
    for &i in order.iter().take(components) {
        let lambda = eigen.eigenvalues[i];
        let singular = lambda.sqrt();
        let u = eigen.eigenvectors.column(i);
        let mut loading: Vec<f64> = x.tr_mul(&u).iter().map(|v| v / singular).collect();
        let mut score: Vec<f64> = u.iter().map(|v| v * singular).collect();
        let mut top = 0;
        for (j, v) in loading.iter().enumerate() {
            if v.abs() > loading[top].abs() {
                top = j;
            }
        }
        if loading[top] < 0.0 {
            loading.iter_mut().for_each(|v| *v = -*v);
            score.iter_mut().for_each(|v| *v = -*v);
        }
        result.scores.push(score);
        result.loadings.push(loading);
        result.explained_variance.push(lambda / (n - 1) as f64);
        result.explained_variance_ratio.push(lambda / total);
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
