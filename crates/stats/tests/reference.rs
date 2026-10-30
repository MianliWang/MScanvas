//! The crate against values numpy 2.5.4, scipy 1.18.1 and statsmodels 0.15.0
//! computed for the same inputs (`fixtures/reference.json`, written by
//! `fixtures/generate_reference.py`; Python is never run here).
//!
//! Tolerances, per quantity, as |actual − expected| ≤ tol · max(1, |expected|)
//! unless noted:
//! - log2 fold change, t, df: 1e-12;
//! - p: 1e-10 relative to p itself, down to the smallest p in the fixture
//!   (about 7e-32);
//! - q from BH on the same p: 1e-14 relative; q in the volcano, whose p carry
//!   the p tolerance: 1e-10 relative;
//! - QC detection rate and missing fraction: exact; QC RSD: 1e-12;
//! - PCA scores, loadings, explained variance and its ratio: 1e-10, with the
//!   sign fixed the same way on both sides, so no sign alignment.

use mscanvas_stats::{
    Matrix, Scaling, Unavailable, benjamini_hochberg, pca, qc_metrics, volcano, welch,
};
use serde_json::Value;

fn reference() -> Value {
    serde_json::from_str(include_str!("../fixtures/reference.json")).unwrap()
}

fn matrix(case: &Value) -> Matrix {
    let values = case["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(Value::as_f64)
        .collect();
    Matrix::new(
        usize_of(&case["samples"]),
        usize_of(&case["features"]),
        values,
    )
    .unwrap()
}

fn usize_of(value: &Value) -> usize {
    usize::try_from(value.as_u64().unwrap()).unwrap()
}

fn indices(value: &Value) -> Vec<usize> {
    value.as_array().unwrap().iter().map(usize_of).collect()
}

fn floats(value: &Value) -> Vec<f64> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect()
}

#[track_caller]
fn close(actual: f64, expected: f64, tolerance: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= tolerance * expected.abs().max(1.0),
        "{what}: {actual:e} against {expected:e}"
    );
}

#[track_caller]
fn relative(actual: f64, expected: f64, tolerance: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= tolerance * expected.abs(),
        "{what}: {actual:e} against {expected:e}"
    );
}

fn reason(name: &str) -> Unavailable {
    match name {
        "too_few_observations" => Unavailable::TooFewObservations,
        "zero_variance" => Unavailable::ZeroVariance,
        "missing" => Unavailable::Missing,
        other => panic!("unknown reason {other}"),
    }
}

#[test]
fn welch_and_volcano_match_scipy_and_statsmodels() {
    let case = &reference()["welch"];
    let tests = welch(&matrix(case), &indices(&case["a"]), &indices(&case["b"])).unwrap();
    let expected = case["expected"].as_array().unwrap();
    assert_eq!(tests.len(), expected.len());
    for (feature, (test, want)) in tests.iter().zip(expected).enumerate() {
        if let Some(name) = want["unavailable"].as_str() {
            assert_eq!(*test, Err(reason(name)), "feature {feature}");
            continue;
        }
        let test = test.as_ref().unwrap();
        close(
            test.log2_fold_change,
            want["log2_fold_change"].as_f64().unwrap(),
            1e-12,
            "log2 fold change",
        );
        close(test.t, want["t"].as_f64().unwrap(), 1e-12, "t");
        close(test.df, want["df"].as_f64().unwrap(), 1e-12, "df");
        relative(test.p, want["p"].as_f64().unwrap(), 1e-10, "p");
        assert_eq!(test.observed_a, usize_of(&want["observed_a"]));
        assert_eq!(test.observed_b, usize_of(&want["observed_b"]));
    }

    let rows = volcano(&tests).unwrap();
    let want = case["volcano"].as_array().unwrap();
    assert_eq!(rows.len(), want.len());
    for (row, want) in rows.iter().zip(want) {
        assert_eq!(row.feature, usize_of(&want["feature"]));
        relative(row.q, want["q"].as_f64().unwrap(), 1e-10, "volcano q");
    }
}

#[test]
fn benjamini_hochberg_matches_scipy_and_statsmodels() {
    let case = &reference()["benjamini_hochberg"];
    let q = benjamini_hochberg(&floats(&case["p"])).unwrap();
    for (actual, expected) in q.iter().zip(floats(&case["q"])) {
        relative(*actual, expected, 1e-14, "q");
    }
}

#[test]
fn qc_metrics_match_numpy() {
    let case = &reference()["qc"];
    let metrics = qc_metrics(
        &matrix(case),
        &indices(&case["qc"]),
        &indices(&case["study"]),
    )
    .unwrap();
    let expected = case["expected"].as_array().unwrap();
    assert_eq!(metrics.len(), expected.len());
    for (metric, want) in metrics.iter().zip(expected) {
        assert_eq!(
            metric.qc_detection_rate,
            want["qc_detection_rate"].as_f64().unwrap()
        );
        assert_eq!(
            metric.missing_fraction,
            want["missing_fraction"].as_f64().unwrap()
        );
        match want["unavailable"].as_str() {
            Some(name) => assert_eq!(metric.qc_rsd_percent, Err(reason(name))),
            None => close(
                metric.qc_rsd_percent.unwrap(),
                want["qc_rsd_percent"].as_f64().unwrap(),
                1e-12,
                "QC RSD",
            ),
        }
    }
}

fn check_pca(name: &str) {
    let case = &reference()[name];
    let values = matrix(case);
    let excluded: Vec<(usize, Unavailable)> = case["excluded_features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| (usize_of(&pair[0]), reason(pair[1].as_str().unwrap())))
        .collect();
    for want in case["cases"].as_array().unwrap() {
        let scaling = match want["scaling"].as_str().unwrap() {
            "none" => Scaling::None,
            "auto" => Scaling::Auto,
            "pareto" => Scaling::Pareto,
            other => panic!("unknown scaling {other}"),
        };
        let result = pca(&values, scaling, usize_of(&want["components"])).unwrap();
        assert_eq!(result.used_features, indices(&case["used_features"]));
        assert_eq!(result.excluded_features, excluded);
        let what = format!("{name} {scaling:?}");
        for (key, actual) in [("scores", &result.scores), ("loadings", &result.loadings)] {
            let expected = want[key].as_array().unwrap();
            assert_eq!(actual.len(), expected.len());
            for (actual, expected) in actual.iter().zip(expected) {
                let expected = floats(expected);
                assert_eq!(actual.len(), expected.len());
                for (a, e) in actual.iter().zip(expected) {
                    close(*a, e, 1e-10, &format!("{what} {key}"));
                }
            }
        }
        for (key, actual) in [
            ("explained_variance", &result.explained_variance),
            ("explained_variance_ratio", &result.explained_variance_ratio),
        ] {
            for (a, e) in actual.iter().zip(floats(&want[key])) {
                close(*a, e, 1e-10, &format!("{what} {key}"));
            }
        }
    }
}

#[test]
fn pca_of_a_wide_matrix_matches_numpy_svd() {
    check_pca("pca_wide");
}

#[test]
fn pca_of_a_tall_matrix_matches_numpy_svd() {
    check_pca("pca_tall");
}
