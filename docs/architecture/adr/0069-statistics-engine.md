# ADR 0069 — A statistics engine in Rust: PCA, Welch's test, Benjamini-Hochberg and QC metrics

Status: **Accepted** 2026-11-03; Proposed 2026-10-30. The owner approved the
dependencies on 2026-10-30 (S-1, which the research synthesis calls D7; decision
2) and answered the definitions that change numbers on 2026-11-03 (S-2, which it
calls D9, with S-3, S-4, S-5, CK-3 and CK-5; decision table version 2026-11-03.2;
[the answers](#the-owners-answers)). They are cited here by id and date; the
first records PR, #212, writes them into section 1d of
[`OWNER_DECISIONS_V511.md`](../../development/OWNER_DECISIONS_V511.md). The
library is `crates/stats` (`mscanvas-stats`). Nothing calls
it: no Tauri command and no interface. The governance amendment that
un-defers analysis in `AGENTS.md` was decided by the owner on 2026-10-30 (G1);
the command waits for the feature-table import and its own slice.
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
feature-table import; the governance amendment it waited for was decided on
2026-10-30 (G1).

### 2. Dependencies (owner decision S-1)

**Approved by the owner on 2026-10-30, in chat**, in reply to the request to add
`nalgebra` and `statrs` for the Rust statistics crate. The owner's message,
verbatim: "批准". The approval covers the two crates below and the transitive
crates they pull in. It does not cover `kodama`: clustering was not asked for,
and v5.11's heatmap does not cluster. S-2.13 (2026-11-03) closes that item: no
clustering in the first version, so no `kodama`.

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

**The lockfile delta**, derived again at admission as S-1 asks, on 2026-11-04
against `origin/main` at `9d52e39d` (first measured at `7ac5a219`, with the same
numbers): 504 `[[package]]` entries become 522, which is `mscanvas-stats` and 17
third-party packages. The merge's `Cargo.lock` diff adds 166 lines and removes
none.

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
`scripts/generate_notices.py` makes. In the script's format, with repeats folded,
it lists 198 packages, identically at `9d52e39d` and at this branch's merge of it
(`cbfe6e00`): 194 third-party, the count `THIRD_PARTY_NOTICES.md` prints, and the
four project crates. None of the 17 is among them, and
`generate_notices.py --check` passes, so `THIRD_PARTY_NOTICES.md` does not
change. The 235 this record first gave was a miscount: it counted a repeat's
`(*)` line as a package. Every licence above is in that
script's `KNOWN_LICENCE_TERMS`, so the notices regenerate without a new licence
class once a desktop command depends on the crate. No `NOTICE` file is in the
published `nalgebra`, `simba` or `approx` crate, so Apache-2.0 §4(d) adds
nothing today. Dependabot's cargo entry covers the workspace root with
`dependency-name: "*"`, so the new crates are already in scope.

**Development only, as S-1 says:** numpy 2.5.4, scipy 1.18.1 and
statsmodels 0.15.0, pinned in the fixture generator (decision 7), which `uv`
runs. Its outputs are committed and nothing from it ships. The three are not
dependencies of the product, and neither CI nor the tests run them. Their own dependencies (pandas, patsy and others) are not pinned.

### 3. What the library computes

The input is a `Matrix` of feature-table values, feature-major, with `None` for
a missing value. A non-finite value refuses the matrix.

| Quantity | Definition, as implemented |
| --- | --- |
| log2 fold change | mean(log2 A) − mean(log2 B), over the observed values of each group |
| Welch's test | t = (mean A − mean B) / √(s²A/nA + s²B/nB) on log2 values; Welch-Satterthwaite df; two-sided p = 2·sf(\|t\|) from `statrs`' Student's t, never 1 − cdf; where that p is above 1/2, p = 1 − I_x(1/2, df/2) with x = t²/(df + t²), `statrs`' regularized incomplete beta, because sf works from 1 − x and returns exactly 1 for \|t\| below about 3e-8·√df; the term subtracted is below 1/2, so nothing cancels |
| Benjamini-Hochberg | the step-up q = min over ranks ≥ i of p·m/rank, capped at 1, over exactly the family passed |
| Volcano rows | (fold change, p, q) for each tested feature; the BH family is exactly the tested features of the slice passed |
| Variance | n − 1; the corrected two-pass algorithm, with the residuals divided by the largest before squaring, so no square overflows or underflows; identical values give exactly 0 |
| QC detection rate | QC injections with a value / QC injections |
| QC RSD | 100 · sd / mean of the observed QC values, raw scale; needs 2 values and a positive mean |
| Missing fraction | study samples with no value / study samples |
| PCA | complete, varying features, where varying is sd > n·ε·max\|x\|; a smaller sd is `ZeroVariance`. The bound is the worst-case rounding error of a naively summed mean (cf. Chan, Golub and LeVeque 1983), a conservative heuristic: it also drops a resolvable spread below about n·ε relative, such as [1e15, 1e15, 1e15, 1e15 + 1] (sd 0.5, exact), which QC and Welch treat as varying; mean-centred; scaled by none, auto (sd) or Pareto (√sd); eigen decomposition of the samples × samples Gram matrix; scores = U·√λ; loadings = Xᵀ·u/√λ, of unit length; explained variance = λ/(n − 1); ratio = λ/trace |

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
  `observed_b`; S-2.6). Fewer than two observed values in a group gives
  `TooFewObservations`. That feature is then not tested and is not in the BH
  family. Both groups constant gives `ZeroVariance`, not a p-value. One constant
  group is still a valid test. *Those last two sentences are as built
  (2026-10-30), not an owner decision.*
- **PCA.** A feature with any missing value is left out and listed as `Missing`,
  S-2.8's default. No zero is filled in. A zero-variance feature is left out
  and listed as `ZeroVariance` (S-2.10).
- **PCA's opt-in, the single class-E case admitted.** S-2.8 (a), 2026-11-03: a
  labelled 1/5-minimum per feature, with the replaced cell count on the figure
  and in the export. It assumes every missing value is below the detection
  limit. The row says choosing it is the approval and that it needs its record:
  this paragraph is that record. The crate does not implement it yet. It is
  built with its first caller (N-A7).
- **QC.** A missing value counts toward the missing fraction and against the
  detection rate. Any present value counts as detected and enters the RSD,
  zero and negative ones included. That holds only because the import maps
  "not detected" to missing (question 7). *As built (2026-10-30), not an owner
  decision.*
- **A non-positive intensity** in either tested group refuses the call, naming
  the feature and the sample (S-2.7 (b)). It has no log2, and flooring it would
  invent a value. One such value hides the whole volcano until the user goes
  back to the import and declares it again. A zero in a feature table may mean
  "not detected" or may be an export
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
- **Bounds** (*as built, 2026-10-30, not an owner decision*):
  - PCA refuses more than `MAX_PCA_SAMPLES` = 1,000 samples or more than
    `MAX_PCA_CELLS` = 20,000,000 cells (`TooLarge`).
  - Measured on 2026-10-30, release build, one thread, Intel Core i7-12700H, one
    `pca` call with auto scaling and 5 components: 200 × 20,000 in 0.11 s,
    500 × 20,000 in 0.61 s and 1,000 × 20,000 (the bound) in 3.39 s.
  - Welch and QC are O(samples × features) and have no bound beyond the matrix.
  - Above the bound, a top-k Lanczos solver or `faer` would be the upgrade.
    Either needs its own decision.
  - **A record mismatch, stated here and not fixed.** Section 7 of
    [`ROADMAP_V511_AND_ANALYSIS.md`](../../development/ROADMAP_V511_AND_ANALYSIS.md)
    gives N-A1 a gate of PCA timing at 10^5 × 500 on Actions. That is 5e7 cells,
    above `MAX_PCA_CELLS`, so the crate refuses it as `TooLarge`, and no such run
    exists. The bound stays. The measured top is the local 1,000 × 20,000 in
    3.39 s. Raising the bound needs a real table and its own timing, and N-A7
    decides that.
- **Rank** (*as built, 2026-10-30, not an owner decision*): a component with
  λ ≤ √ε·λ₁ is not reported. Through the Gram route
  its loadings carry a relative error of about ε·λ₁/λ, so it is not resolved.
  Asking for more components than are resolved, or more than n − 1, is
  `ComponentsOutOfRange`.
- **Convergence** (*as built, 2026-10-30, not an owner decision*): the symmetric
  eigen solver is bounded to 30·n sweeps,
  LAPACK's own bound, and reports `NotConverged` past it rather than looping.

### 6. What is never done

- **No q-value without a recorded family** (S-2.4). q comes only from
  `benjamini_hochberg` over the slice the caller passes. `volcano`'s family is
  the tested features of its slice. Filters are applied before the call, so a
  view filter never changes a q-value. The family is stored with the result in
  the artifact slice.
- **No silent NaN.** Non-finite input is refused. Overflow is the `Overflow`
  error or reason. In PCA, so is a non-finite mean, standard deviation or
  trace, a Gram matrix whose trace underflowed below the smallest normal double
  (an unscaled matrix of values near 1e-170), and a zero or subnormal largest
  eigenvalue. That last one occurs only under a normal trace: λ₁ ≤ trace, so
  with a finite trace the eigenvalue cannot overflow.
- **No imputation, no normalisation, no drift or batch correction in the crate
  today.** What the owner admitted arrives with its first caller
  ([classes D, E and F](#classes-d-e-and-f-what-was-admitted)).
- **No floor for log2,** and no p-value for an untestable feature.
- **No clustering** (S-2.13).

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
| p (smallest 7.3e-32), for df up to 2e4, t near 0 included (checked from \|t\| = 1e-8) | 1e-10 relative | 1.0e-13 |
| q from BH on the same p (ties, p = 0 and p = 1) | 1e-14 relative | 1.3e-16 |
| q in the volcano (carries the p error) | 1e-10 relative | 1.0e-13 |
| QC detection rate, missing fraction | exact | exact |
| QC RSD | 1e-12 · max(1, \|x\|) | 7.3e-16 |
| PCA scores, loadings | 1e-10 · max(1, \|x\|), no sign alignment | 2.8e-14, 9.7e-16 |
| PCA explained variance, ratio | 1e-10 · max(1, \|x\|) | 2.4e-15, 4.4e-16 |

The worst deviations were measured at commit `30b08db3`, before the
deviation's residuals were rescaled; the reference tests pass at these
tolerances after that change too. The worst p and volcano q deviations,
measured again after p above 1/2 moved to the complement, are still 1.0e-13.

The fixture's Welch df are at most about 22 and its \|t\| at least 0.10.
Against scipy 1.18.1, `statrs`' `sf` is within 3.3e-12 relative at df 1e3 and
2e4 (t = 2, 5 and 10), but 7.9e-11 at df 1e5 and 3.8e-10 at df 1e6 (t = 2).
Near t = 0, `sf` alone is 7.98e-7 off at df 1e3 and t = 1e-6, where it returns
exactly 1; the crate's p, with the complement above 1/2, is within 4.5e-12 at
df 2, 10, 1e3 and 2e4 for t from 1e-8 to 2. So the p tolerance holds up to
df 2e4, far above a cohort's.

**Unit tests** cover:

- every `StatsError` and `Unavailable` path, except `NotConverged`, which no
  input is known to produce, and `TooLarge` at the cell bound, which needs a
  matrix of 20 million cells (the sample bound is tested);
- BH's step-up by hand, ties, p = 1, and monotonicity on a 200-value family
  with repeats;
- a p-value below 1e-30 where 1 − cdf would be 0, p = 1 at t = 0, and p within
  1e-12 of its closed form or series for t from 7e-10 to 0.3 at df 1, 2 and
  1e3;
- the PCA sign rule, its tie going to the first feature, and identical reruns;
- values whose squares overflow (1e200) or underflow (1e-170), an overflowing
  trace, a subnormal largest eigenvalue under a normal trace, and a spread
  within rounding, which is `ZeroVariance`;
- NIST StRD NumAcc1 (sd exactly 1) and NumAcc4 (mean exact, sd within 1e-8
  relative, the precision of its decimal data as doubles).

### 8. Which cell states a statistic uses

ADR 0067 decision 7 (#184, still Proposed at 2026-11-04, not on `main`) leaves
this to this record. As proposed at `b3802085`, its table has six states; B-6.5
(2026-11-03) makes the engine's discard a seventh, `engineDiscarded`.

| State | In a statistic | Basis |
| --- | --- | --- |
| `measured`, `imported` | enters | S-2.6 says observed values and no row names the states: a reading, not an owner decision |
| `reintegrated` | does not enter, for now | CK-3, which asks about tests |
| `engineImputed` | never | ADR 0067 decision 7, which says a test |
| `engineDiscarded` | never | B-6.5 makes it a state, a whole fit's failure and not a finding about one feature; that it never enters is a reading, not an owner decision |
| `missing`, `undecided` | have no value | ADR 0067 decision 7 |

CK-3 and ADR 0067 speak of tests. Applying them to PCA and the QC metrics too is
a reading, not an owner decision.

Track A tables hold only `imported` and `missing`. The rest are left out and
counted apart from missing. Whether `undecided` counts in a QC denominator is
[open](#still-open).

## Classes D, E and F: what was admitted

What was admitted arrives with its first caller. None of it is in the crate
today.

- **D, value-changing: admitted (S-3.1), built in N-A10.** Sum over the features
  present in all samples, median, PQN and internal standard. The default is none
  and the originals are kept. PQN's reference is the QC median with at least 3
  QC, otherwise all non-blank samples, and the result says which (S-3.3). PQN
  sum-normalises first, then takes the median of the quotients (S-3.4). An
  absolute multi-file overlay is enough for VIEW-008, labelled not normalised
  (S-3.2).
- **E, value-inventing: only S-2.8's opt-in** (decision 4).
  S-4.2's pick of random forest and QRILC is a direction, not an admission: CK-5
  schedules it after A-22's backfill results, with no effort and no dependency
  now. Half-minimum, zero and kNN are not admitted.
- **F, value-correcting: diagnostics only (S-4.1).** No correction until a user
  asks. QC median alignment, QC-RLSC/LOESS, QC-RSC and SERRF are not admitted.

## ANA-002: the QC recipe's definitions (S-5)

Answered on 2026-11-03. The crate computes QC detection, QC RSD and missing
fraction today. The D-ratio and the blank ratio are added to it with their first
caller, N-A9.

| Id | Definition |
| --- | --- |
| S-5.1 | Rust computes five metrics: QC detection, QC RSD, D-ratio, blank ratio and missing fraction. RT drift, mass error and injection-order plots are display only |
| S-5.2 | Filters exclude and keep a rejected list with a reason per feature |
| S-5.3 | Defaults: detection above 70 %, RSD below 30 %, D-ratio below 50 % |
| S-5.4 | Defaults: blank ratio at least 5, missing at most 30 %, on by default |
| S-5.5 | The blank reference is the maximum of the detected blanks |
| S-5.6 | A feature absent from every blank is kept |
| S-5.7 | D-ratio = 100·sd_QC/sd_sample |
| S-5.8 | The sample side of the blank ratio is the observed mean of the control and treatment samples |

## The owner's answers

S-2, answered on 2026-11-03 (decision table version 2026-11-03.2). The numbers
are those of the open questions this section replaces; the crate's comments cite
them. Each answer is what the library does today, except where the last column
says otherwise. S-3, S-4 and CK-5 are under classes D, E and F above, and S-5
under ANA-002.

| Question | Id | Answer | In the crate |
| --- | --- | --- | --- |
| 1. log2 fold change | S-2.1 | mean(log2 A) − mean(log2 B). The numbers differ from MZmine's log2 of the ratio of means | Implemented |
| 2. The test | S-2.2 | Two-sided Welch | Implemented |
| 2. Group size | S-2.3 | Fewer than 2 per group refused; fewer than 3 marked low power, in the interface and in exports | The refusal, and the observed counts. The mark is the caller's (N-A8) |
| 3. BH family | S-2.4, S-2.14 | Benjamini-Hochberg over every valid test of the run, after the recorded filters | BH over exactly the tested features of the slice passed. The filters and the stored family are the caller's |
| 4. PCA scaling | S-2.9 | Auto by default, Pareto and none offered | All three. The default is the caller's (N-A7) |
| 4. Near-zero variance | S-2.10 | Excluded and counted, with the rounding bound as implemented (decision 3) | Implemented |
| 4. PCA sign | S-2.12 | Fixed by the largest loading | Implemented |
| 5. Variance denominator | S-2.5 | n − 1 | Implemented |
| 6. Missing, in a test | S-2.6 | Observed values only; missing left out and counted | Implemented |
| 6. Missing, in PCA | S-2.8 (a) | Complete features by default; a labelled 1/5-minimum per feature as an opt-in (decision 4) | The default. The opt-in is not built |
| 7. Non-positive intensities | S-2.7 (b) | A zero or negative value reaching the test refuses the whole run, naming feature and sample. The recommendation text in `OWNER_DECISIONS_V511.md` S-2 (treated as missing) was not chosen | Implemented |
| 8. QC RSD scale | S-2.11 | Raw scale, 100·sd/mean | Implemented |
| Not numbered | S-2.13 | No clustering in the first version, sorted by group and q, so no `kodama` | Nothing to build |
| Not numbered | CK-3 `no` | Backfilled cells do not enter tests for now. A-22 measures, then the owner decides | Decision 8 |

### As built, not an owner decision

Dated 2026-10-30. No row above answers these, and they stand until one does:

- mean-centring always, and log2 applied by the caller before PCA (S-2.9 names
  only the scaling);
- the numerics of decisions 3 and 5, such as the corrected two-pass deviation, p
  above 1/2 through its complement and single-threaded determinism;
- what decisions 4 and 5 mark in place: a constant group in Welch, a present QC
  value counting as detected, the PCA bounds, the rank floor and the sweep bound.

### Still open

Not answered here:

- CK-3's decision after A-22's measurement.
- A0067-D6, where an imported table is stored. It has no effect here, since
  nothing calls the crate.
- Raising the PCA bound (decision 5), for N-A7.
- S-3.4's source check: the row notes the source's step is not yet checked.
- S-5.7's note that the source says non-Gaussian data should be transformed
  first or use MAD.
- Whether `undecided` counts in a QC denominator. No Track A table holds one.

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
  this library. Each still needs the promotion gate in
  [`ANALYSIS_CAPABILITY_MAP.md`](../../product/ANALYSIS_CAPABILITY_MAP.md),
  which G1 kept (2026-10-30), the feature-table import and its own slice.
- The D-ratio, the blank ratio, the 1/5-minimum and normalisation change the
  crate when their first callers arrive (N-A9, N-A7, N-A10).

## Evidence

- **The spike** of 2026-10-30, throwaway, rustc 1.95.0. It matched scipy 1.18.1
  to about 1e-13 for Welch, BH and PCA, and timed the Gram route at 0.11 s for
  200 × 20,000 and 4.2 s for 1,000 × 20,000.
- **This slice**, on 2026-10-30 with rustc 1.97.1:
  - the reference tests above;
  - the PCA times in decision 5;
  - the lockfile delta in decision 2;
  - the shipped-tree walk in decision 2.
- **Admission**, on 2026-11-04: the lockfile delta and the shipped-tree walk
  derived again at `9d52e39d` and `cbfe6e00` (decision 2).

## What this amends

Nothing. `AGENTS.md`'s "Analysis is deferred" (line 19) was
amended by the owner's governance decision G1 of 2026-10-30, applied by #194,
not by this record. Decision 8 is the part ADR 0067 decision 7 leaves to the
statistics record.
