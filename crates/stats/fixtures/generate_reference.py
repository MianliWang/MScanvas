# /// script
# requires-python = "==3.12.*"
# dependencies = ["numpy==2.5.4", "scipy==1.18.1", "statsmodels==0.15.0"]
# ///
"""Writes reference.json, the expected values mscanvas-stats is tested against.

Development only: nothing here ships, and scipy, statsmodels and numpy are not
dependencies of the product. The Rust tests read the committed JSON and never
run Python. Regenerate from the repository root with

    uv run crates/stats/fixtures/generate_reference.py

The inputs come from a seeded generator, so a rerun with the pinned versions
writes the same file. The versions actually used are recorded in the output.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import scipy
import scipy.stats
import statsmodels
from statsmodels.stats.multitest import multipletests

OUT = Path(__file__).with_name("reference.json")
COMMAND = "uv run crates/stats/fixtures/generate_reference.py"


def feature_major(matrix: np.ndarray) -> list[float | None]:
    """features x samples array, NaN for missing, as the crate's flat layout."""
    return [None if np.isnan(v) else float(v) for v in matrix.ravel()]


def bh(p: np.ndarray) -> np.ndarray:
    q_scipy = scipy.stats.false_discovery_control(p, method="bh")
    q_statsmodels = multipletests(p, method="fdr_bh")[1]
    assert np.max(np.abs(q_scipy - q_statsmodels)) <= 1e-15
    return q_scipy


def welch_case(rng: np.random.Generator) -> dict:
    a = list(range(12))
    b = list(range(12, 24))
    rows = []
    for shift in (0.0, 0.3, 1.0, 2.0, 4.0, 8.0, 16.0, 40.0, 100.0):
        for observed in ((3, 3), (5, 7), (12, 12)):
            row = np.full(24, np.nan)
            row[: observed[0]] = 16.0 + rng.normal(size=observed[0])
            row[12 : 12 + observed[1]] = 16.0 + shift + 0.5 * rng.normal(size=observed[1])
            rows.append(row)
    # One group constant, the other varying: still a valid Welch test.
    row = np.full(24, 15.0)
    row[12:] = 15.0 + rng.normal(size=12)
    rows.append(row)
    # Only one observed value in group A.
    row = 16.0 + rng.normal(size=24)
    row[1:12] = np.nan
    rows.append(row)
    # Both groups constant.
    row = np.full(24, 17.0)
    row[12:] = 18.0
    rows.append(row)
    logs = np.array(rows)
    intensities = np.exp2(logs)

    expected = []
    for row in intensities:
        x = np.log2(row[a][~np.isnan(row[a])])
        y = np.log2(row[b][~np.isnan(row[b])])
        if len(x) < 2 or len(y) < 2:
            expected.append({"unavailable": "too_few_observations"})
        elif np.all(x == x[0]) and np.all(y == y[0]):
            expected.append({"unavailable": "zero_variance"})
        else:
            test = scipy.stats.ttest_ind(x, y, equal_var=False)
            expected.append(
                {
                    "log2_fold_change": float(np.mean(x) - np.mean(y)),
                    "t": float(test.statistic),
                    "df": float(test.df),
                    "p": float(test.pvalue),
                    "observed_a": len(x),
                    "observed_b": len(y),
                }
            )
    tested = [i for i, e in enumerate(expected) if "p" in e]
    q = bh(np.array([expected[i]["p"] for i in tested]))
    return {
        "samples": 24,
        "features": len(rows),
        "values": feature_major(intensities),
        "a": a,
        "b": b,
        "expected": expected,
        "volcano": [
            {"feature": i, "q": float(qi)} for i, qi in zip(tested, q, strict=True)
        ],
    }


def bh_case() -> dict:
    p = np.array([0.01, 0.01, 0.2, 1.0, 1.0, 0.5, 3e-30, 0.049, 0.05, 0.051, 0.0, 0.7])
    return {"p": p.tolist(), "q": bh(p).tolist()}


def qc_case(rng: np.random.Generator) -> dict:
    samples = 20
    qc = [0, 4, 8, 12, 16]
    study = [s for s in range(samples) if s not in qc]
    rows = []
    for _ in range(8):
        rows.append(1e5 * np.exp(0.2 * rng.normal(size=samples)))
    rows[1][[3, 5, 7, 8]] = np.nan  # one QC and three study samples missing
    rows[2][qc[1:]] = np.nan  # one QC observed
    rows[3][qc] = 4.0e4  # identical QC values
    rows[4][:] = np.nan  # never observed
    values = np.array(rows)

    expected = []
    for row in values:
        x = row[qc][~np.isnan(row[qc])]
        entry = {
            "qc_detection_rate": len(x) / len(qc),
            "missing_fraction": int(np.isnan(row[study]).sum()) / len(study),
        }
        if len(x) < 2:
            entry["qc_rsd_percent"] = None
            entry["unavailable"] = "too_few_observations"
        else:
            entry["qc_rsd_percent"] = float(100.0 * np.std(x, ddof=1) / np.mean(x))
        expected.append(entry)
    return {
        "samples": samples,
        "features": len(rows),
        "values": feature_major(values),
        "qc": qc,
        "study": study,
        "expected": expected,
    }


def pca_reference(x: np.ndarray, scaling: str, components: int) -> dict:
    """x is samples x features, complete and varying."""
    centred = x - x.mean(axis=0)
    sd = x.std(axis=0, ddof=1)
    divisor = {"none": 1.0, "auto": sd, "pareto": np.sqrt(sd)}[scaling]
    scaled = centred / divisor
    u, s, vt = np.linalg.svd(scaled, full_matrices=False)
    # scikit-learn's svd_flip with u_based_decision=False: the largest-magnitude
    # loading of each component positive, the first on a tie.
    top = np.argmax(np.abs(vt), axis=1)
    signs = np.sign(vt[np.arange(vt.shape[0]), top])
    u, vt = u * signs, vt * signs[:, None]
    n = x.shape[0]
    return {
        "scaling": scaling,
        "components": components,
        "scores": (u[:, :components] * s[:components]).T.tolist(),
        "loadings": vt[:components].tolist(),
        "explained_variance": (s[:components] ** 2 / (n - 1)).tolist(),
        "explained_variance_ratio": (s[:components] ** 2 / np.sum(s**2)).tolist(),
    }


def pca_case(rng: np.random.Generator, samples: int, features: int) -> dict:
    factors = rng.normal(size=(samples, 3)) * np.array([3.0, 2.0, 1.0])
    weights = rng.normal(size=(3, features))
    x = 16.0 + factors @ weights + 0.3 * rng.normal(size=(samples, features))
    # Two features the crate must leave out: one missing in a single sample, one
    # constant.
    gappy = 16.0 + rng.normal(size=samples)
    gappy[1] = np.nan
    constant = np.full(samples, 12.5)
    full = np.column_stack([x[:, :2], gappy, x[:, 2:4], constant, x[:, 4:]])
    used = [f for f in range(full.shape[1]) if f not in (2, 5)]
    return {
        "samples": samples,
        "features": full.shape[1],
        "values": feature_major(full.T),
        "used_features": used,
        "excluded_features": [[2, "missing"], [5, "zero_variance"]],
        "cases": [pca_reference(x, scaling, 3) for scaling in ("none", "auto", "pareto")],
    }


def main() -> None:
    rng = np.random.default_rng(20261030)
    reference = {
        "generator": {
            "command": COMMAND,
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "statsmodels": statsmodels.__version__,
        },
        "welch": welch_case(rng),
        "benjamini_hochberg": bh_case(),
        "qc": qc_case(rng),
        "pca_wide": pca_case(rng, 12, 40),
        "pca_tall": pca_case(rng, 30, 6),
    }
    with OUT.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(reference, handle, indent=1)
        handle.write("\n")


if __name__ == "__main__":
    main()
