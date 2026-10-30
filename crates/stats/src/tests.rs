//! Every typed refusal and unavailable reason, BH monotonicity and ties, the
//! PCA sign and bounds, and NIST StRD for the two-pass variance. The reference
//! values from scipy and numpy are in `tests/reference.rs`.

use super::*;

/// A feature-major matrix from rows of `Some`/`None` values.
fn table(rows: &[&[Option<f64>]]) -> Matrix {
    let samples = rows.first().map_or(0, |r| r.len());
    Matrix::new(samples, rows.len(), rows.concat()).unwrap()
}

fn all(values: &[f64]) -> Vec<Option<f64>> {
    values.iter().copied().map(Some).collect()
}

#[test]
fn a_matrix_refuses_a_length_that_does_not_match_its_shape() {
    assert_eq!(
        Matrix::new(3, 2, vec![Some(1.0); 5]),
        Err(StatsError::ShapeMismatch {
            expected: 6,
            actual: 5
        })
    );
    assert_eq!(
        Matrix::new(usize::MAX, 2, vec![]),
        Err(StatsError::ShapeMismatch {
            expected: usize::MAX,
            actual: 0
        })
    );
}

#[test]
fn a_matrix_refuses_a_non_finite_value_and_names_where_it_is() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut values = vec![Some(1.0); 6];
        values[4] = Some(bad);
        assert_eq!(
            Matrix::new(3, 2, values),
            Err(StatsError::NonFinite {
                feature: 1,
                sample: 1
            })
        );
    }
    assert!(Matrix::new(3, 2, vec![None; 6]).is_ok());
}

#[test]
fn groups_are_refused_when_out_of_range_repeated_overlapping_or_too_small() {
    let m = table(&[&all(&[1.0, 2.0, 3.0, 4.0, 5.0])]);
    assert_eq!(
        welch(&m, &[0, 5], &[1, 2]),
        Err(StatsError::SampleOutOfRange {
            sample: 5,
            samples: 5
        })
    );
    assert_eq!(
        welch(&m, &[0, 0], &[1, 2]),
        Err(StatsError::DuplicateSample { sample: 0 })
    );
    assert_eq!(
        welch(&m, &[0, 1], &[1, 2]),
        Err(StatsError::DuplicateSample { sample: 1 })
    );
    assert_eq!(
        welch(&m, &[0], &[1, 2]),
        Err(StatsError::TooFewSamples {
            needed: 2,
            actual: 1
        })
    );
}

#[test]
fn welch_refuses_a_non_positive_intensity_in_a_group_but_not_outside_them() {
    for bad in [0.0, -3.0] {
        let m = table(&[
            &all(&[1.0, 2.0, 3.0, 4.0, 9.0]),
            &[Some(1.0), Some(2.0), Some(bad), Some(4.0), Some(bad)],
        ]);
        assert_eq!(
            welch(&m, &[0, 1], &[2, 3]),
            Err(StatsError::NonPositive {
                feature: 1,
                sample: 2
            })
        );
        // Sample 4 is in neither group, so its value is never read.
        let ok = table(&[&[Some(1.0), Some(2.0), Some(3.0), Some(4.0), Some(bad)]]);
        assert!(welch(&ok, &[0, 1], &[2, 3]).unwrap()[0].is_ok());
    }
}

#[test]
fn welch_leaves_out_missing_values_and_counts_what_entered() {
    let m = table(&[
        &[Some(1.0), Some(2.0), None, Some(4.0), Some(8.0), None],
        &[Some(1.0), None, None, Some(4.0), Some(8.0), Some(16.0)],
    ]);
    let tests = welch(&m, &[0, 1, 2], &[3, 4, 5]).unwrap();
    let first = tests[0].unwrap();
    assert_eq!((first.observed_a, first.observed_b), (2, 2));
    // log2 values 0, 1 against 2, 3.
    assert_eq!(first.log2_fold_change, -2.0);
    assert_eq!(tests[1], Err(Unavailable::TooFewObservations));
}

#[test]
fn welch_reports_zero_variance_instead_of_a_p_value() {
    let m = table(&[&all(&[0.1, 0.1, 0.1, 0.7, 0.7, 0.7])]);
    assert_eq!(
        welch(&m, &[0, 1, 2], &[3, 4, 5]).unwrap()[0],
        Err(Unavailable::ZeroVariance)
    );
}

#[test]
fn one_constant_group_still_gives_a_test_with_the_other_groups_df() {
    let m = table(&[&all(&[4.0, 4.0, 4.0, 2.0, 8.0, 32.0, 16.0])]);
    let test = welch(&m, &[0, 1, 2], &[3, 4, 5, 6]).unwrap()[0].unwrap();
    assert!((test.df - 3.0).abs() < 1e-12);
    assert!(test.p > 0.0 && test.p < 1.0);
}

#[test]
fn equal_means_give_p_one_and_a_huge_t_gives_a_tiny_positive_p() {
    let m = table(&[
        &all(&[2.0, 8.0, 4.0, 2.0, 8.0, 4.0]),
        &all(&[1.0, 1.0000001, 0.9999999, 1e30, 1.0000001e30, 0.9999999e30]),
    ]);
    let tests = welch(&m, &[0, 1, 2], &[3, 4, 5]).unwrap();
    assert_eq!(tests[0].unwrap().t, 0.0);
    assert_eq!(tests[0].unwrap().p, 1.0);
    // 1 − cdf would round to 0 long before this p.
    let tiny = tests[1].unwrap().p;
    assert!(tiny > 0.0 && tiny < 1e-30, "{tiny:e}");
}

#[test]
fn benjamini_hochberg_refuses_a_p_value_outside_zero_to_one() {
    for bad in [f64::NAN, -0.1, 1.5, f64::INFINITY] {
        assert!(matches!(
            benjamini_hochberg(&[0.5, bad]),
            Err(StatsError::InvalidPValue { index: 1, .. })
        ));
    }
    assert_eq!(benjamini_hochberg(&[]), Ok(vec![]));
}

#[test]
fn benjamini_hochberg_step_up_by_hand() {
    let q = benjamini_hochberg(&[0.01, 0.04, 0.03, 0.005]).unwrap();
    let expected = [0.02, 0.04, 0.04, 0.02];
    for (q, e) in q.iter().zip(expected) {
        assert!((q - e).abs() < 1e-15, "{q} against {e}");
    }
}

#[test]
fn tied_p_values_get_one_q_and_p_one_stays_one() {
    let q = benjamini_hochberg(&[0.02, 0.02, 0.02, 1.0, 1.0]).unwrap();
    assert!(q[..3].iter().all(|&v| v == q[0]));
    assert!((q[0] - 0.02 * 5.0 / 3.0).abs() < 1e-15);
    assert_eq!(&q[3..], &[1.0, 1.0]);
}

#[test]
fn q_values_rise_with_p_and_stay_between_p_and_one() {
    // A deterministic spread of p-values with repeats, in no particular order.
    let p: Vec<f64> = (0..200u64)
        .map(|i| ((i * 7919) % 101) as f64 / 100.0)
        .collect();
    let q = benjamini_hochberg(&p).unwrap();
    let mut order: Vec<usize> = (0..p.len()).collect();
    order.sort_by(|&i, &j| p[i].total_cmp(&p[j]));
    for pair in order.windows(2) {
        assert!(q[pair[0]] <= q[pair[1]]);
        if p[pair[0]] == p[pair[1]] {
            assert_eq!(q[pair[0]], q[pair[1]]);
        }
    }
    for (p, q) in p.iter().zip(&q) {
        assert!(p <= q && *q <= 1.0);
    }
}

#[test]
fn the_volcano_family_is_exactly_the_tested_features() {
    let m = table(&[
        &all(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
        &[Some(1.0), None, None, Some(4.0), Some(5.0), Some(6.0)],
        &all(&[1.0, 1.5, 1.2, 9.0, 8.0, 9.5]),
        &all(&[3.0, 3.0, 3.0, 3.0, 3.0, 3.0]),
    ]);
    let tests = welch(&m, &[0, 1, 2], &[3, 4, 5]).unwrap();
    let rows = volcano(&tests).unwrap();
    assert_eq!(rows.iter().map(|r| r.feature).collect::<Vec<_>>(), [0, 2]);
    let q = benjamini_hochberg(&[tests[0].unwrap().p, tests[2].unwrap().p]).unwrap();
    assert_eq!(rows.iter().map(|r| r.q).collect::<Vec<_>>(), q);
    assert_eq!(rows[1].log2_fold_change, tests[2].unwrap().log2_fold_change);
    assert_eq!(volcano(&[]).unwrap(), vec![]);
}

#[test]
fn qc_sets_are_refused_when_empty_out_of_range_or_repeated() {
    let m = table(&[&all(&[1.0, 2.0, 3.0])]);
    assert_eq!(
        qc_metrics(&m, &[], &[0]),
        Err(StatsError::TooFewSamples {
            needed: 1,
            actual: 0
        })
    );
    assert_eq!(
        qc_metrics(&m, &[0], &[]),
        Err(StatsError::TooFewSamples {
            needed: 1,
            actual: 0
        })
    );
    assert_eq!(
        qc_metrics(&m, &[3], &[0]),
        Err(StatsError::SampleOutOfRange {
            sample: 3,
            samples: 3
        })
    );
    assert_eq!(
        qc_metrics(&m, &[0], &[1, 1]),
        Err(StatsError::DuplicateSample { sample: 1 })
    );
    // QC and study sets may overlap.
    assert!(qc_metrics(&m, &[0, 1], &[0, 1, 2]).is_ok());
}

#[test]
fn qc_rsd_is_unavailable_with_fewer_than_two_values_a_non_positive_mean_or_overflow() {
    let m = table(&[
        &[Some(5.0), None, Some(1.0)],
        &all(&[-1.0, -2.0, 1.0]),
        &all(&[1e308, 1.7e308, 1.0]),
        &all(&[7.0, 7.0, 1.0]),
    ]);
    let metrics = qc_metrics(&m, &[0, 1], &[2]).unwrap();
    assert_eq!(
        metrics[0].qc_rsd_percent,
        Err(Unavailable::TooFewObservations)
    );
    assert_eq!(metrics[0].qc_detection_rate, 0.5);
    assert_eq!(metrics[1].qc_rsd_percent, Err(Unavailable::NonPositiveMean));
    assert_eq!(metrics[2].qc_rsd_percent, Err(Unavailable::Overflow));
    assert_eq!(metrics[3].qc_rsd_percent, Ok(0.0));
}

/// Two latent directions plus a little structure, all features complete.
fn varied(samples: usize, features: usize) -> Vec<Option<f64>> {
    (0..features)
        .flat_map(|f| {
            (0..samples).map(move |s| {
                let (s, f) = (s as f64, f as f64);
                Some(10.0 + (s * 0.7 + f).sin() * 3.0 + (s * 1.3 - f * 0.5).cos() * (1.0 + f * 0.1))
            })
        })
        .collect()
}

#[test]
fn pca_refuses_too_few_samples_and_too_many() {
    let one = Matrix::new(1, 2, vec![Some(1.0), Some(2.0)]).unwrap();
    assert_eq!(
        pca(&one, Scaling::Auto, 1),
        Err(StatsError::TooFewSamples {
            needed: 2,
            actual: 1
        })
    );
    let many = Matrix::new(MAX_PCA_SAMPLES + 1, 1, varied(MAX_PCA_SAMPLES + 1, 1)).unwrap();
    assert_eq!(
        pca(&many, Scaling::Auto, 1),
        Err(StatsError::TooLarge {
            samples: MAX_PCA_SAMPLES + 1,
            features: 1
        })
    );
}

#[test]
fn pca_without_a_complete_varying_feature_is_refused_with_the_reason() {
    let gappy = table(&[&[Some(1.0), None, Some(3.0)], &[None, Some(2.0), Some(3.0)]]);
    assert_eq!(
        pca(&gappy, Scaling::Auto, 1),
        Err(StatsError::NoCompleteFeature)
    );
    let flat = table(&[&[Some(1.0), None, Some(3.0)], &all(&[0.3, 0.3, 0.3])]);
    assert_eq!(pca(&flat, Scaling::Auto, 1), Err(StatsError::ZeroVariance));
}

#[test]
fn pca_lists_what_it_left_out_and_never_fills_it_in() {
    let m = table(&[
        &all(&[1.0, 2.0, 4.0, 3.0]),
        &[Some(1.0), None, Some(2.0), Some(5.0)],
        &all(&[2.0, 2.0, 2.0, 2.0]),
        &all(&[5.0, 1.0, 2.0, 2.5]),
    ]);
    let result = pca(&m, Scaling::Auto, 1).unwrap();
    assert_eq!(result.used_features, [0, 3]);
    assert_eq!(
        result.excluded_features,
        [(1, Unavailable::Missing), (2, Unavailable::ZeroVariance)]
    );
    assert_eq!(result.loadings[0].len(), 2);
    assert_eq!(result.scores[0].len(), 4);
}

#[test]
fn pca_refuses_more_components_than_the_data_has() {
    let m = Matrix::new(3, 10, varied(3, 10)).unwrap();
    assert_eq!(
        pca(&m, Scaling::Auto, 0),
        Err(StatsError::ComponentsOutOfRange {
            requested: 0,
            available: 2
        })
    );
    assert_eq!(
        pca(&m, Scaling::Auto, 3),
        Err(StatsError::ComponentsOutOfRange {
            requested: 3,
            available: 2
        })
    );
    // One varying feature has one direction, however many samples.
    let line = table(&[&all(&[1.0, 2.0, 4.0, 3.0, 5.0])]);
    assert_eq!(
        pca(&line, Scaling::None, 2),
        Err(StatsError::ComponentsOutOfRange {
            requested: 2,
            available: 1
        })
    );
    // Two identical features are still one direction.
    let twins = table(&[&all(&[1.0, 2.0, 4.0, 3.0]), &all(&[1.0, 2.0, 4.0, 3.0])]);
    assert_eq!(
        pca(&twins, Scaling::None, 2),
        Err(StatsError::ComponentsOutOfRange {
            requested: 2,
            available: 1
        })
    );
}

#[test]
fn pca_refuses_an_overflowing_matrix_instead_of_returning_nan() {
    let m = table(&[&all(&[1e308, -1e308, 0.0])]);
    assert_eq!(pca(&m, Scaling::None, 1), Err(StatsError::Overflow));
}

#[test]
fn pca_signs_are_fixed_and_reruns_are_identical() {
    let m = Matrix::new(8, 25, varied(8, 25)).unwrap();
    let first = pca(&m, Scaling::Pareto, 3).unwrap();
    assert_eq!(first, pca(&m, Scaling::Pareto, 3).unwrap());
    for loading in &first.loadings {
        let top =
            loading.iter().copied().fold(
                0.0_f64,
                |best, v| if v.abs() > best.abs() { v } else { best },
            );
        assert!(top > 0.0);
        let length: f64 = loading.iter().map(|v| v * v).sum();
        assert!((length - 1.0).abs() < 1e-12);
    }
    // Two samples are enough for one component.
    let two = Matrix::new(2, 3, varied(2, 3)).unwrap();
    let result = pca(&two, Scaling::Auto, 1).unwrap();
    assert!((result.explained_variance_ratio[0] - 1.0).abs() < 1e-12);
}

/// NIST StRD univariate summary statistics, NumAcc1 and NumAcc4: a one-pass
/// variance loses every digit on these, a two-pass one keeps them. Without the
/// residual correction the NumAcc4 mean is 1e-14 off.
#[test]
fn the_variance_is_two_pass_on_nist_numacc1_and_numacc4() {
    let (mean, var) = mean_var(&[10000001.0, 10000003.0, 10000002.0]);
    assert_eq!(mean, 10000002.0);
    assert_eq!(var.sqrt(), 1.0);

    let mut numacc4 = vec![10000000.2];
    for _ in 0..500 {
        numacc4.extend([10000000.1, 10000000.3]);
    }
    let (mean, var) = mean_var(&numacc4);
    assert!((mean - 10000000.2).abs() <= 1e-15 * 10000000.2);
    // The data are decimal; their nearest doubles are 1.9e-9 apart, so the
    // certified 0.1 is met to that representation, not to 15 digits.
    assert!((var.sqrt() - 0.1).abs() <= 1e-8 * 0.1, "{:e}", var.sqrt());
}
