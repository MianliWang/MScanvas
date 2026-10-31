# ADR 0069 — A statistics engine in Rust: PCA, Welch's test, Benjamini-Hochberg and QC metrics

Status: **Proposed** 2026-10-30. Its dependency request is approved: owner
decision D7, 2026-10-30 (decision 2). The definitions that change numbers are
open questions for the owner, decision D9 ([at the end](#open-questions-for-the-owner)).
The library implements the recommended answer to each and changes if the owner
chooses another. The library is `crates/stats` (`mscanvas-stats`). Nothing calls
it: no Tauri command and no interface, because the governance amendment that
un-defers analysis in `AGENTS.md` is still the owner's decision.
Related: [0028](0028-figure-renderer-and-semantic-specification.md),
[0047](0047-first-windows-beta-scope-and-implementation-route.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md) (the dependency-approval
pattern).
Evidence: the statistics research lane of 2026-10-30 and its throwaway spike
(local scratch, not committed), and the measurements of this slice, under
[Evidence](#evidence).

## Context

On 2026-10-30 the owner directed that analysis is no longer deferred and is to
be planned and built. The v5.11 statistics page (统计与质控) shows PCA scores,
a volcano plot (log2 fold change against −log10 q) and QC metrics over a
feature table. Track A of the analysis plan computes these in Rust over an
imported feature table, with no Python runtime. Its step A3 is this record and
the library.

`AGENTS.md` says: "Reuse mature scientific backends; do not reimplement
proprietary RAW readers or mature algorithms without a written decision." This
record is that written decision. Numerical linear algebra and special functions
come from libraries (decision 2). Closed-form formulas whose correctness can be
checked against a reference to machine precision are project-owned (decision 3).

Python was not chosen. The pinned analysis runtime has numpy but no
t-distribution, so a volcano plot there would need scipy, about 118 MB more on
Windows. That runtime is also development-only until its release record lands.
Putting the statistics there would tie the dashboard to the runtime release and
add a process round trip to every change of scaling or threshold.

## Decisions

### 1. A pure crate

`crates/stats` is a library with no Tauri, no I/O and no serde. It is separate
from `mscanvas-core`, whose `AGENTS.md` says it "must not depend on … a concrete
scientific backend", so `nalgebra` reaches only this crate. `mscanvas-desktop`
does not depend on it yet. The command that does is a later slice, after the
governance amendment and the feature-table import.

### 2. Dependencies (owner decision D7)

**Approved by the owner on 2026-10-30, in chat**, in reply to the request to add
`nalgebra` and `statrs` for the Rust statistics crate. The owner's message,
verbatim: "批准". The approval covers the two crates below and the transitive
crates they pull in. It does not cover `kodama`: clustering was not asked for,
and v5.11's heatmap does not cluster.

| Crate | Pin | Licence | Features |
| --- | --- | --- | --- |
| `nalgebra` | `=0.35.0` | Apache-2.0 | `default-features = false, features = ["std"]` (`std` pulls `matrixmultiply`; `macros` is off) |
| `statrs` | `=0.19.1` | MIT | `default-features = false`, no features |

- **`statrs` without its defaults** (`std`, `nalgebra`, `rand`) compiles as a
  `no_std` crate (`#![cfg_attr(not(feature = "std"), no_std)]`). Its `std`
  feature only forwards `approx/std` and `num-traits/std`, which `nalgebra`'s
  `std` already enables in this graph. It requires `num-traits` with `libm`,
  which is why `libm` is compiled.
- **Toolchain.** Both declare `rust-version = "1.89.0"`. The workspace declares
  `1.97` and `rust-toolchain.toml` pins 1.97.1, so both are met.
- **Pins** are in `[workspace.dependencies]`, in the `=` style of ADR 0056's
  `base64` and `flate2`.

**The lockfile delta**, measured against `origin/main` at `7ac5a219`: 504
`[[package]]` entries become 522, which is `mscanvas-stats` and 17 third-party
packages.

| Compiled into `mscanvas-stats` (12) | Licence |
| --- | --- |
| `nalgebra` 0.35.0, `simba` 0.10.2, `approx` 0.5.1 | Apache-2.0 |
| `statrs` 0.19.1, `libm` 0.2.16 | MIT |
| `matrixmultiply` 0.3.11, `rawpointer` 0.2.1 | MIT/Apache-2.0 |
| `num-complex` 0.4.6, `num-integer` 0.1.47, `num-rational` 0.4.2 | MIT OR Apache-2.0 |
| `wide` 1.7.1, `safe_arch` 1.2.0 | Zlib OR Apache-2.0 OR MIT |

- **Locked but never built (5):** `glam` 0.30.10, 0.31.1, 0.32.1 and 0.33.12,
  and `num-bigint` 0.4.8, all MIT OR Apache-2.0. `nalgebra` (`glam030?/std`)
  and `num-rational` (`num-bigint?/std`) name them only in weak features.
  Cargo records such optional dependencies in `Cargo.lock` without enabling
  them, and `cargo tree -p mscanvas-stats` lists none of them.
- **Already locked and reused:** `num-traits` 0.2.19 (gaining its `libm` edge),
  `typenum`, `bytemuck`, `autocfg` and `thiserror` 2.0.20.
- **One unrelated re-resolution was reverted.** Cargo also rewrote `os_pipe`'s
  `windows-sys` from 0.45.0 to 0.61.2, which `os_pipe`'s range allows. The
  lockfile keeps 0.45.0, and `cargo metadata --locked` accepts it.

So the count is 12 compiled crates and 5 locked-only ones. The research's
"12 new crates" could not be reproduced at the time, because the spike kept no
lockfile; the 12 compiled crates are the same twelve it named.

**The shipped binary does not change.** `cargo tree -p mscanvas-desktop --target
x86_64-pc-windows-msvc -e normal,no-proc-macro` is the walk
`scripts/generate_notices.py` makes. It lists 235 packages, none of them new, so
`THIRD_PARTY_NOTICES.md` does not change. Every licence above is in that
script's `KNOWN_LICENCE_TERMS`, so the notices regenerate without a new licence
class once a desktop command depends on the crate. No `NOTICE` file is in the
published `nalgebra`, `simba` or `approx` crate, so Apache-2.0 §4(d) adds
nothing today. Dependabot's cargo entry covers the workspace root with
`dependency-name: "*"`, so the new crates are already in scope.

**Development only, not covered by D7:** numpy 2.5.4, scipy 1.18.1 and
statsmodels 0.15.0, pinned in the fixture generator (decision 7), which `uv`
runs. They are not dependencies of the product, and neither CI nor the tests
run them. Their own dependencies (pandas, patsy and others) are not pinned.

### 3. What the library computes

The input is a `Matrix` of feature-table values, feature-major, with `None` for
a missing value. A non-finite value refuses the matrix.

| Quantity | Definition, as implemented |
| --- | --- |
| log2 fold change | mean(log2 A) − mean(log2 B), over the observed values of each group |
| Welch's test | t = (mean A − mean B) / √(s²A/nA + s²B/nB) on log2 values; Welch-Satterthwaite df; two-sided p = 2·sf(\|t\|) from `statrs`' Student's t, never 1 − cdf |
| Benjamini-Hochberg | the step-up q = min over ranks ≥ i of p·m/rank, capped at 1, over exactly the family passed |
| Volcano rows | (fold change, p, q) for each tested feature; the BH family is exactly the tested features of the slice passed |
| Variance | n − 1; the corrected two-pass algorithm, with the residuals divided by the largest before squaring, so no square overflows or underflows; identical values give exactly 0 |
| QC detection rate | QC injections with a value / QC injections |
| QC RSD | 100 · sd / mean of the observed QC values, raw scale; needs 2 values and a positive mean |
| Missing fraction | study samples with no value / study samples |
| PCA | complete, varying features, where varying is sd > n·ε·max\|x\| (a smaller sd is within the rounding error of the mean, cf. Chan, Golub and LeVeque 1983, and is `ZeroVariance`); mean-centred; scaled by none, auto (sd) or Pareto (√sd); eigen decomposition of the samples × samples Gram matrix; scores = U·√λ; loadings = Xᵀ·u/√λ, of unit length; explained variance = λ/(n − 1); ratio = λ/trace |

A value that cannot be computed for one feature is a typed `Unavailable` reason:
`TooFewObservations`, `ZeroVariance`, `Missing`, `NonPositiveMean` or `Overflow`.
A refused call is a typed `StatsError`:

- `ShapeMismatch` and `NonFinite` for the matrix;
- `SampleOutOfRange`, `DuplicateSample` (also across the two groups) and
  `TooFewSamples` for sample sets;
- `NonPositive` for a log2 input;
- `NoCompleteFeature`, `ZeroVariance`, `ComponentsOutOfRange`, `TooLarge`,
  `Overflow` and `NotConverged` for PCA;
- `InvalidPValue` for BH.

The crate forbids `unsafe` code. No input panics it.

### 4. Missing and non-positive values in this slice: excluded or refused, never imputed

- **Welch.** A missing value is left out and counted (`observed_a`,
  `observed_b`). Fewer than two observed values in a group gives
  `TooFewObservations`. That feature is then not tested and is not in the BH
  family. Both groups constant gives `ZeroVariance`, not a p-value. One constant
  group is still a valid test.
- **PCA.** A feature with any missing value is left out and listed as `Missing`.
  No 1/5-minimum and no zero is filled in. A zero-variance feature is left out
  and listed as `ZeroVariance`.
- **QC.** A missing value counts toward the missing fraction and against the
  detection rate. Any present value counts as detected and enters the RSD,
  zero and negative ones included. That holds only because the import maps
  "not detected" to missing (open question 7).
- **A non-positive intensity** in either tested group refuses the call, naming
  the feature and the sample. It has no log2, and flooring it would invent a
  value. A zero in a feature table may mean "not detected" or may be an export
  artefact. The import slice must say which, and record any mapping of "not
  detected" to missing.

### 5. Inputs, precision, determinism and bounds

- **Where the numbers come from:** a feature-table artifact in a later slice
  (the imported table first, then the untargeted engine's). Nothing feeds the
  crate today.
- **Precision:** `f64` throughout.
- **Determinism:**
  - The same input gives bit-identical output on one machine (tested).
  - The PCA sign is fixed: each component's largest-magnitude loading is
    positive, the first one on a tie. This is scikit-learn's `svd_flip` with
    `u_based_decision=False`, so exports are stable across reruns.
  - Across CPUs results agree within the tolerances, not bit for bit, because
    `matrixmultiply` picks its SIMD kernels at run time.
  - Everything runs on one thread (`matrixmultiply`'s threading feature is
    off).
- **Bounds:**
  - PCA refuses more than `MAX_PCA_SAMPLES` = 1,000 samples or more than
    `MAX_PCA_CELLS` = 20,000,000 cells (`TooLarge`).
  - Measured on 2026-10-30, release build, one thread, Intel Core i7-12700H, one
    `pca` call with auto scaling and 5 components: 200 × 20,000 in 0.11 s,
    500 × 20,000 in 0.61 s and 1,000 × 20,000 (the bound) in 3.39 s.
  - Welch and QC are O(samples × features) and have no bound beyond the matrix.
  - Above the bound, a top-k Lanczos solver or `faer` would be the upgrade.
    Either needs its own decision.
- **Rank:** a component with λ ≤ √ε·λ₁ is not reported. Through the Gram route
  its loadings carry a relative error of about ε·λ₁/λ, so it is not resolved.
  Asking for more components than are resolved, or more than n − 1, is
  `ComponentsOutOfRange`.
- **Convergence:** the symmetric eigen solver is bounded to 30·n sweeps,
  LAPACK's own bound, and reports `NotConverged` past it rather than looping.

### 6. What is never done

- **No q-value without a recorded family.** q comes only from
  `benjamini_hochberg` over the slice the caller passes. `volcano`'s family is
  the tested features of its slice. Filters are applied before the call, so a
  view filter never changes a q-value. The family is stored with the result in
  the artifact slice.
- **No silent NaN.** Non-finite input is refused. Overflow is the `Overflow`
  error or reason. In PCA, so is a non-finite mean, standard deviation, trace
  or largest eigenvalue, and a Gram matrix whose trace underflowed below the
  smallest normal double (an unscaled matrix of values near 1e-170).
- **No imputation, no normalisation, no drift or batch correction** (classes D,
  E and F below).
- **No floor for log2,** and no p-value for an untestable feature.
- **No clustering.**

### 7. Reference tests

- **The generator:** `crates/stats/fixtures/generate_reference.py`.
  - It is development only. Its PEP 723 header pins Python 3.12, numpy 2.5.4,
    scipy 1.18.1 and statsmodels 0.15.0.
  - From the repository root: `uv run crates/stats/fixtures/generate_reference.py`.
  - It writes `crates/stats/fixtures/reference.json` from a seeded generator,
    and records the versions it used.
  - Rust tests read the JSON. Python never runs at test time.
- **The references:**
  - Welch: `scipy.stats.ttest_ind(equal_var=False)` on numpy's log2.
  - BH: `scipy.stats.false_discovery_control(method="bh")`, asserted equal to
    statsmodels' `multipletests(method="fdr_bh")` within 1e-15.
  - QC RSD: numpy.
  - PCA: numpy's SVD with the same sign rule, on a 12 × 42 and a 30 × 8
    matrix. Each matrix has one feature missing in one sample and one constant
    feature. Each is run with no, auto and Pareto scaling.

| Quantity | Tolerance | Worst measured |
| --- | --- | --- |
| log2 fold change, t, df | 1e-12 · max(1, \|x\|) | 3.6e-15, 8.8e-15, 2.5e-16 |
| p (smallest 7.3e-32), for df up to 2e4 | 1e-10 relative | 1.0e-13 |
| q from BH on the same p (ties, p = 0 and p = 1) | 1e-14 relative | 1.3e-16 |
| q in the volcano (carries the p error) | 1e-10 relative | 1.0e-13 |
| QC detection rate, missing fraction | exact | exact |
| QC RSD | 1e-12 · max(1, \|x\|) | 7.3e-16 |
| PCA scores, loadings | 1e-10 · max(1, \|x\|), no sign alignment | 2.8e-14, 9.7e-16 |
| PCA explained variance, ratio | 1e-10 · max(1, \|x\|) | 2.4e-15, 4.4e-16 |

The worst deviations were measured at commit `30b08db3`, before the
deviation's residuals were rescaled; the reference tests pass at these
tolerances after that change too. The fixture's Welch df are at most about 22. Against scipy 1.18.1, `statrs`'
`sf` is within 3.3e-12 relative up to df 2e4, but 7.9e-11 at df 1e5 and
3.8e-10 at df 1e6 (t = 2), so the p tolerance holds up to df 2e4, far above a
cohort's.

**Unit tests** cover:

- every `StatsError` and `Unavailable` path;
- BH's step-up by hand, ties, p = 1, and monotonicity on a 200-value family
  with repeats;
- a p-value below 1e-30 where 1 − cdf would be 0, and p = 1 at t = 0;
- the PCA sign rule and identical reruns;
- values whose squares overflow (1e200) or underflow (1e-170), an overflowing
  trace or eigenvalue, and a spread within rounding, which is `ZeroVariance`;
- NIST StRD NumAcc1 (sd exactly 1) and NumAcc4 (mean exact, sd within 1e-8
  relative, the precision of its decimal data as doubles).

## Classes that are out of scope

Each needs its own approval and record before any code exists:

- **D, value-changing:** normalisation (sum/TIC, median, PQN, internal
  standard).
- **E, value-inventing:** imputation (1/5-minimum, half-minimum, zero, kNN,
  random forest, QRILC).
- **F, value-correcting:** drift and batch correction (QC median alignment,
  QC-RLSC/LOESS, QC-RSC, SERRF).

The D-ratio and the blank ratio belong with the class-C filters (ANA-002). The
blank reference (mean or maximum) is the owner's decision.

## Open questions for the owner

Decision D9. Each answer below is the recommended one and is what the library
does today; another answer changes the named function.

1. **The log2 fold-change definition.**
   - (a) mean(log2 A) − mean(log2 B). **Recommended and implemented:** the test
     runs on log2 values, so the volcano's two axes describe one scale.
   - (b) log2(mean A / mean B), MZmine's. Choose it for MZmine parity.
2. **The t-test variant.**
   - Two-sided Welch, at least 2 observed values per group. **Recommended and
     implemented.** The observed counts are reported, so a low-power mark below
     3 is the interface's choice.
   - Alternatives: Student's pooled-variance t, which assumes equal variances;
     one-sided tests; Mann-Whitney U, a different statistic with its own
     record.
3. **The BH family.**
   - Every feature with a valid test in the run, after the recorded class-C
     filters, stored with the result. **Recommended and implemented** as
     "exactly the tested features of the slice passed".
   - Alternatives: the visible subset, as the v5.11 demo does, refused because
     q would change with a view; Benjamini-Yekutieli, valid under any
     dependence and more conservative.
4. **PCA centring and scaling.**
   - Mean-centring always. Auto scaling is the dashboard default (as in v5.11),
     with Pareto and none offered. Log2 is applied by the caller before PCA, in
     the prepared-matrix slice. **Recommended and implemented.**
   - Alternatives: median centring, range or vast scaling (not implemented).
5. **The variance denominator.**
   - n − 1 everywhere, as scipy's `ddof=1` and R's `sd`. **Recommended and
     implemented.**
   - Alternative: n.
6. **Missing values in this slice.**
   - Excluded with a recorded reason, never imputed (decision 4). **Recommended
     and implemented.**
   - Alternatives: a labelled 1/5-minimum per feature as a PCA opt-in, with a
     count of replaced cells, which is class E and needs approval; zero.
7. **Non-positive intensities.**
   - The call is refused, and the import slice maps "not detected" to missing
     with its own record. **Recommended and implemented.**
   - Alternative: the research's own recommendation, treating them as missing
     and counting them.
8. **The QC RSD scale.**
   - Raw-scale 100·sd/mean, as Broadhurst et al. 2018 and the demo do.
     **Recommended and implemented.**
   - Alternative: a log-based RSD.

## Alternatives rejected

- **Project-owned t-distribution and eigen code:** reimplements mature numerics
  without need.
- **scipy in the Python runtime:** about 118 MB, and it waits for the runtime
  release.
- **`ndarray-linalg`:** a LAPACK backend needs gcc, gfortran or Intel MKL on
  Windows.
- **`linfa`:** far larger than the need.
- **`faer`:** kept as the upgrade path if `nalgebra` is too slow, which it is
  not at the bound.

## Consequences

- `Cargo.lock` gains 18 entries, and CI compiles 12 more crates for the
  workspace's tests. The shipped binary and its notices do not change until a
  desktop command depends on the crate.
- The statistics commands, the Statistics/QC page and the QC filters build on
  this library. Each still needs the governance amendment, the feature-table
  import and its own slice.

## Evidence

- **The spike** of 2026-10-30, throwaway, rustc 1.95.0. It matched scipy 1.18.1
  to about 1e-13 for Welch, BH and PCA, and timed the Gram route at 0.11 s for
  200 × 20,000 and 4.2 s for 1,000 × 20,000.
- **This slice**, on 2026-10-30 with rustc 1.97.1:
  - the reference tests above;
  - the PCA times in decision 5;
  - the lockfile delta in decision 2;
  - the shipped-tree walk in decision 2.

## What this amends

Nothing while Proposed. `AGENTS.md`'s "Analysis is deferred" is amended by the
owner's governance decision, not by this record.
