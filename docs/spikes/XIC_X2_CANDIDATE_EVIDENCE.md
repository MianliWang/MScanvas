# XIC X2 — candidate C′ over the 77 frozen rows

Status: **evidence only.** Date: 2026-11-04. Baseline: `origin/main` at `9f98504e`,
PR #207 merged. Authority: [ADR 0071](../architecture/adr/0071-xic-re-entry-and-its-first-version.md),
decisions 8 and 9, and the owner's X-1 and X-2. The decision this feeds is
[ADR 0072](../architecture/adr/0072-xic-candidate-decision-x3.md), which is Proposed.

**One final build of C′ passes all 77 rows: 77 PASS, 0 FAIL, 0 MISSING.** That
includes the legal namespace-prefixed row B failed, the three fault controls and all
30 named cases. All 153 planned invocations ran and all 74 repeat groups agree. 17 new
integer rows, beside the matrix and not in it, also pass.

Nothing changes on screen. No Tauri command, DTO or webview code changed. XIC
(VIEW-007) stays unavailable with its stated reason, and this record admits nothing.
No ProteoWizard program ran, no acquisition was downloaded, and no native or Tauri
spec ran.

## Identity and custody

| Binding | Exact identity |
| --- | --- |
| Scored executable, `xic_candidate.exe` | `a7c6705c95d1bd7165fa8a69342188ca735e85ebf38e4ceb578833571e201ad8` |
| Source manifest, listing `Cargo.toml`, `Cargo.lock`, `crates/proteowizard/Cargo.toml`, every `crates/proteowizard/src/**/*.rs` and the example | `6784450639e98e0d83f266d5bbbf7a134d8e282eced5bb92a4dbd3eb5794116e` |
| Build | `cargo build -p mscanvas-proteowizard --release --example xic_candidate --locked --target-dir target`, rustc 1.97.1 (8bab26f4f 2026-07-14), cargo 1.97.1 (c980f4866 2026-06-30), `x86_64-pc-windows-msvc`, release |
| `experiments/xic_x2/harness_x2.py` | `94782e519e0167f66b3f2e7acdf87b23d64ac782207705d0172d4fa55f2872ff` |
| `experiments/xic_x2/run_supplement_x2.py` | `6f00be3dac21c6943134932444d4d2c48d29e45ee6c1ac5255d14ead93f94398` |
| `experiments/xic_x2/combine_x2.py` | `6b106dd2b8de6054288fc773c69639fd92872bfebef6bdb3694c64fbc0f73b84` |
| `experiments/xic_x2/integer_rows.py` | `98261a2b1a1a95c8d8a391491beb5e20d11dbfd86f5c4cde43c23c51e1475eaa` |
| `experiments/xic_x2/observe_x2.py` | `7033db210f8a34f39135c7e2fe8c310d6d10d0912774c8b12b4382fe9ddfff47` |

`harness_x2.py identity` runs the build itself, refusing a tree whose sources or runners
are uncommitted, so this binary is the one these sources make. It ran at commit
`abc6b443`, on this branch. The manifest binds the build to its source by content, so a
later documentation commit does not unbind it. A reader recomputes it at the PR's head,
by the listing `identity` writes. `rust-toolchain.toml` pins the channel to 1.97.1, and the
manifest does not list that file. Read back after the run: all 189 run records under
`final-3/` state the runner digests in this table, and its four summaries state this
executable.

**The comparator is byte-identical.** Before anything else, every digest in
[PX.3's frozen artifact table](PX_3_XIC_COMPARATIVE_EVIDENCE.md#s3-and-s4-were-frozen-before-scoring)
and in the 10-file `FROZEN.json` and 43-file `SUPPLEMENT-FROZEN.json` was recomputed
and matched, as did all 77 inputs and both retained archives,
`px3-b-evidence.zip` (`be25076e…`) and `px3-approved-input-evidence-v2.zip`
(`74194d5f…`). None differed and none was missing. Each runner checks them again before
its first invocation. `compare()`, `peak()` and `js()` are imported from the frozen
`harness.py`, and `canonical()` from the frozen `oracle.py`, unedited, after their
digests are checked. The archives were only read: every command ran with `python -B`,
so not even bytecode was written there.

## What ran

`crates/proteowizard/examples/xic_candidate.rs` is the contract of ADR 0071 decision 8:
argv `[exe, source, ms_level, low, high, snapshot_path, mode]`.

- **The snapshot.** The source is copied to `snapshot_path`, which must not exist, and
  everything after that reads the copy, so it is the exact bytes read. The runners hash
  it against the frozen source digest after each invocation.
- **Normal rows** come from `read_xic`, the production entry point, unchanged. A file that
  cannot be opened or read exits non-zero, because that says nothing about the document
  and must not score as an honest refusal of one.
- **`positions`.** The frozen answers state each measured row's point positions, which
  the product has no use for and `XicResult` does not hold. A second pass over the same
  bytes records them, through a `XicSpectrumTransform` that changes nothing. Its result
  must equal the production result, and each row's count must equal its positions, or
  the process exits non-zero. Time and memory for the pass alone are below.
- **`source_metadata`** comes from the example's own small walk over the snapshot, with
  raw attributes and origins, on an evaluated result and on a unit or mixed refusal. It
  judges nothing. Its scans must match the production rows by index and native ID, in
  order, or the query is refused as `ScanCorrespondenceMismatch`. This is the observer
  #207's as-built table assigns to X2. It lives in the example, so X4's DTO still has to
  retain the attributes a unit refusal saw.
- **Top level.** Polarity, FAIMS voltage, representation, the scan-window disclosures,
  the reason of each `Unreadable` row and the pass time are top-level keys, which
  `canonical()` drops. Nothing new sits in `rows`, `observation` or `source_metadata`.

**The fault modes exist only in the example.** `fault-identity` breaks the
correspondence after the production pass. `narrow-intensity` and
`substitute-normalized` run `read_xic_from` with a transform that alters the science.
`read_xic` instantiates only `XicIdentity`, and no feature or flag reaches a fault from
the product. `test-support` is off: the example is package-scoped.

**No XML normalization, prefix stripping or fallback.** The inputs are handed over as
they are.

## The ledger

| | Count |
| --- | --- |
| Ledger rows | 77: 77 PASS, 0 FAIL, 0 MISSING |
| Named cases | 30 of 30 PASS |
| Expectations | 68 `semantic`, 6 `honest_refusal`, 2 `must_disagree`, 1 `identity_refusal` |
| Invocations | 153 of 153 planned, on one executable |
| Repeat groups | 74 of 74 agree byte for byte on canonical science |

The 73 rows of `harness_x2.py` and the 4 of `run_supplement_x2.py` ran on the same
executable, and `combine_x2.py` refuses two builds. No result from an earlier build is
in this matrix. Four earlier complete runs, while the example and runners were being
written and reviewed, on builds `46509d36…`, `02690522…`, `541880b9…` and `73266bea…`, also
passed 77 of 77. They are retained as superseded and are not part of this result. Their
source differs from this build's in the example only: where the pass is timed, one `match`
arm, how the echo reads a number with spaces around it, and how a read failure exits.
`crates/proteowizard/src` is the same in all five.

| Ledger row | ADR named case | Subjects | Status | Runs |
| --- | --- | --- | --- | --- |
| `mixed_mz_different` | mixed_mz_different | 7,8 | PASS | 2 |
| `mixed_mz_declared_absent` | mixed_mz_declared_absent | 7,8 | PASS | 2 |
| `uniform_absent_mz` | uniform_absent_mz | 7,8 | PASS | 2 |
| `incomplete_mz_empty` | incomplete_mz_empty | 7,8 | PASS | 2 |
| `incomplete_mz_whitespace` | incomplete_mz_whitespace | 7,8 | PASS | 2 |
| `incomplete_mz_name_only` | incomplete_mz_name_only | 7,8 | PASS | 2 |
| `incomplete_mz_cvref_only` | incomplete_mz_cvref_only | 7,8 | PASS | 2 |
| `incomplete_mz_name_cvref` | incomplete_mz_name_cvref | 7,8 | PASS | 2 |
| `mixed_rt_different` | mixed_rt_different | 7,8 | PASS | 2 |
| `mixed_rt_declared_absent` | mixed_rt_declared_absent | 7,8 | PASS | 2 |
| `uniform_absent_rt` | uniform_absent_rt | 7,8 | PASS | 2 |
| `incomplete_rt_empty` | incomplete_rt_empty | 7,8 | PASS | 2 |
| `incomplete_rt_whitespace` | incomplete_rt_whitespace | 7,8 | PASS | 2 |
| `incomplete_rt_name_only` | incomplete_rt_name_only | 7,8 | PASS | 2 |
| `incomplete_rt_cvref_only` | incomplete_rt_cvref_only | 7,8 | PASS | 2 |
| `incomplete_rt_name_cvref` | incomplete_rt_name_cvref | 7,8 | PASS | 2 |
| `mixed_intensity_different` | mixed_intensity_different | 7,8 | PASS | 2 |
| `mixed_intensity_declared_absent` | mixed_intensity_declared_absent | 7,8 | PASS | 2 |
| `uniform_absent_intensity` | uniform_absent_intensity | 7,8 | PASS | 2 |
| `incomplete_intensity_empty` | incomplete_intensity_empty | 7,8 | PASS | 2 |
| `incomplete_intensity_whitespace` | incomplete_intensity_whitespace | 7,8 | PASS | 2 |
| `incomplete_intensity_name_only` | incomplete_intensity_name_only | 7,8 | PASS | 2 |
| `incomplete_intensity_cvref_only` | incomplete_intensity_cvref_only | 7,8 | PASS | 2 |
| `incomplete_intensity_name_cvref` | incomplete_intensity_name_cvref | 7,8 | PASS | 2 |
| `nonfinite_intensity` | in_window_nonfinite_intensity | 7,8 | PASS | 2 |
| `overflow` | extreme_finite_overflow | 2,7,8 | PASS | 2 |
| `mz_nan_infinity` | mz_nan_vs_infinity | 7,8 | PASS | 2 |
| `unsorted` | unsorted_mz | 1,7,8 | PASS | 2 |
| `absent_rt` | absent_rt | 7,9,8 | PASS | 2 |
| `undeclared_ms` | undeclared_ms | 4,7,9,8 | PASS | 2 |
| `endpoints` | supplemental / inherited | 1,2,8 | PASS | 2 |
| `zero_width` | supplemental / inherited | 1,5,8 | PASS | 2 |
| `empty_window` | supplemental / inherited | 5,9,8 | PASS | 2 |
| `reversed` | supplemental / inherited | 7,8 | PASS | 2 |
| `nan_bound` | supplemental / inherited | 7,8 | PASS | 2 |
| `posinf_bound` | supplemental / inherited | 7,8 | PASS | 2 |
| `neginf_bound` | supplemental / inherited | 7,8 | PASS | 2 |
| `arithmetic` | supplemental / inherited | 2,7,8 | PASS | 2 |
| `stored_binary32` | supplemental / inherited | 1,2,8 | PASS | 2 |
| `duplicate_rt` | supplemental / inherited | 3,9,8 | PASS | 2 |
| `precedence` | supplemental / inherited | 4,7,9,8 | PASS | 2 |
| `overlap_nan` | supplemental / inherited | 7,8 | PASS | 2 |
| `overlap_overflow_nonfinite` | supplemental / inherited | 7,8 | PASS | 2 |
| `narrowing_fault` | supplemental / inherited | 2 | PASS | 1 |
| `outside_nonfinite` | supplemental / inherited | 7,8 | PASS | 2 |
| `empty_arrays` | supplemental / inherited | 5,7,8 | PASS | 2 |
| `centroid_declared` | supplemental / inherited | 2,7,8 | PASS | 2 |
| `representation_absent` | supplemental / inherited | 7,8 | PASS | 2 |
| `multi_scan_equal` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `rt_missing_value` | supplemental / inherited | 7,8 | PASS | 2 |
| `missing_array_list` | supplemental / inherited | 7,8 | PASS | 2 |
| `missing_scan_list` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `nan_mz_unreadable_intensity` | supplemental / inherited | 7,8 | PASS | 2 |
| `indexed` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `prefixed` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `truncated` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `inventory_count_mismatch` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `identity_fault` | supplemental / inherited | 9 | PASS | 1 |
| `px2_absent` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_contradictory` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_direct` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_incomplete_int_name` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_incomplete_mz_empty` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_incomplete_rt_space` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_mixed_mz` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_referenced` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_rt_absent` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_truncated` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_unknown` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `px2_unresolved` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `normalized_metadata_fault` | supplemental / inherited | 3,4,9 | PASS | 1 |
| `inherited_tiny.pwiz.1.1.mzML` | supplemental / inherited | 7,9,8 | PASS | 2 |
| `inherited_BBM_506_P110_31_MIA_004_30_calibrated.mzML` | supplemental / inherited | 4,9,8 | PASS | 2 |
| `inherited_lowint.mzML` | supplemental / inherited | 1,2,8,9 | PASS | 2 |
| `inherited_duprt.mzML` | supplemental / inherited | 3,8,9 | PASS | 2 |
| `representative_profile` | supplemental / inherited | 6,8 | PASS | 3 |
| `representative_centroid` | supplemental / inherited | 6,8 | PASS | 3 |

Three rows, by name:

- **`prefixed`** is the row that decided PX.4: B answered `CandidateReadIncomplete:EOF`
  on it. C′ answers the frozen three-point sum, 0.875, on both repeats. No input was
  rewritten.
- **`inherited_tiny.pwiz.1.1.mzML`**, the ISO-8859-1 row, passes on both repeats with
  its frozen answer, `Refused`, `MixedUnit:RT`, under the owner's answer of 2026-11-04,
  option `narrow`: a file declaring that label is read when every later byte is ASCII.
  This file has none above 127. The run is the rerun that answer asks for, on the final
  build.
- **`inherited_BBM_506_P110_31_MIA_004_30_calibrated.mzML`**, all MS2 under an MS1
  query, passes with `complete: true`, no gaps and 36,319 `ExcludedByMsLevel` rows with
  no decode attempt, the answer ADR 0071 decision 3 names.

The controls disagree with the oracle in the way they must. `narrow-intensity` reads
`1.0000000009313226` as `1.0`, and `substitute-normalized` reads a declared 120 s as 2.
Both stay `Evaluated`, so `must_disagree` scores a scientific disagreement.
`fault-identity` is refused as `ScanCorrespondenceMismatch`.

### Whether the run can fail

Four mutations of `mzml_xic.rs`, each built and run alone over the 73 rows and the 17
integer rows in a throwaway worktree and undone before the next, with the tree checked
clean each time. None is in this PR or in the matrix above. The supplement's 4 rows were
not part of these runs.

| Mutation | 73 rows, PASS / FAIL | 17 integer rows, PASS / FAIL | Rows it fails, among others |
| --- | --- | --- | --- |
| The window's lower bound open, `low < mz` | 51 / 22 | 10 / 7 | `endpoints`, `zero_width`, `stored_binary32`, `unsorted`, `int32_extremes` |
| No rounding up in the final binary64 | 72 / 1 | 16 / 1 | `arithmetic`, `int64_at_limit_sum_rounds_up` |
| Retention-time units not read | 35 / 38 | 0 / 17 | `mixed_rt_different`, `incomplete_rt_empty`, every integer row |
| The size rule on 64-bit integers not applied | 73 / 0 | 9 / 8 | `int64_above_limit_even`, `int64_two_to_60`, `int64_min`, `int64_mz_above_limit` |

The last row shows why the new rows are needed: no frozen row notices that mutation. Of the
9 integer rows it leaves passing, 5 stay within the limit, 1 is excluded and never decoded,
and 3 hold values `f64` cannot represent, which the reader's widening refuses by itself.

## New rows: integer arrays above 2^53

The frozen oracle decodes floats only, so no frozen row reaches an integer array. The
owner's answer to ADR 0071 open question 2, on 2026-11-03: "Refuse them as
`Unreadable`. No exact 64-bit integer summation. Intensities are not expected to reach
that size (a judgment, not a measurement). New rows with an independent reference are
still needed, as the ADR says."

These are those rows: **17 rows, 34 invocations, 17 PASS, every repeat agrees**, on the
executable above and beside the 77, not in them. `integer_rows.py` builds the fixtures
and derives each answer from their bytes with the Python standard library alone
(`ElementTree`, `base64`, `zlib`, `struct`, `Fraction`), importing no candidate code. Each
row also states its expected states and sums by hand, and `freeze` refuses answers that
disagree. The frozen `compare()` scores each row, and the runner also checks each
`Unreadable` row's array and its reason, `integer_beyond_2_pow_53`.

**Three freezes, one set of answers.** The first, `integer/INTEGER-FROZEN.json`
(`bb80b19c159cdc6802919e86d9e31d12261477beff63d2e33e20de1a246a3972`, 2026-11-04T10:54:28Z),
came before the candidate's first run on any of these rows. Its field
`candidate_runs_before_freeze: 0` is a statement and not a check: what shows the order is
that timestamp against the first scored folder's. Two reviews then changed the runner in
the same file, and a freeze binds that file, so `integer-2/INTEGER-FROZEN.json`
(`ac2b0e5d5e5a5153f89579aa23c48fdc2b6a014b8b929d207b0342d58b2fda63`) and
`integer-3/INTEGER-FROZEN.json`
(`6181025f6ddffba64f6c55bc3c60b6e39c224629e7d5c773ba4d8f38e8875213`) each supersede the one
before. The command that writes one refuses unless every input and answer digest equals
the earlier freeze's, and they do. No answer changed after a candidate saw these rows.

| Rows | Answer |
| --- | --- |
| An exact sum of `2^53 + 1` and of `2^53 + 3`, from values at the limit | `Measured`: `2^53` and `2^53 + 4`, ties to even |
| `-2^53`; a 64-bit m/z array within the limit; 32-bit extremes summing to -1 | `Measured` |
| `2^53 + 1` and `2^63 - 1`, which `f64` cannot hold | `Unreadable` |
| `2^53 + 2` and `2^60`, which it can; `2^53 + 2` uncompressed | `Unreadable` |
| `-(2^53 + 1)`, which it cannot hold; `-(2^53 + 2)` and `-2^63`, which it can | `Unreadable` |
| `2^60` outside the window, in the same array | `Unreadable` |
| `2^53 + 2` in the m/z array | `Unreadable`, array `Mz` |
| One such scan of three | That scan `Unreadable`, a gap; the other two `Measured` |
| Such a scan at MS2, under an MS1 query | `ExcludedByMsLevel`, not decoded, `complete` |

*As built, not an owner decision:* a value `f64` can represent is refused all the same,
and the negative side is judged by magnitude. The rows pin #207's reading of the answer,
and the reference states that reading, so these rows show the engine does what the
reading says and not that the reading is what the owner meant. Both readings were raised
after the decision page was published, and the reply of 2026-11-04 does not cover them.

## Release resource observations

Observed, never thresholds. Host: `Windows-11-10.0.26300-SP0`, `Intel64 Family 6 Model
154 Stepping 3`, 20 logical processors, 63.7 GiB. Release build, single thread. Three
serial runs per target. The source was read just before each set, so these are
warm-cache numbers. A cold read was not measured.

**The machine was never idle, and the time rose with the processor's load.** Other work ran
throughout. A separate loop over `Win32_Processor.LoadPercentage`, about one sample every
3 s, ran beside each set. It ran longer than the sets did, so the table counts only the
samples inside each set's own run, and they are few. The first two sets are this build. The
third is build `73266bea…`, about an hour earlier. Its `crates/proteowizard/src` is the same,
and its example differs only in how a read failure exits and in one helper's body.

| Set | Build | Run (UTC) | Processor load in the run, mean (lowest–highest), samples | Memory load |
| --- | --- | --- | --- | --- |
| First | `a7c6705c…` | 12:51:58–12:52:21 | 17% (2–40), 7 | 66–67% |
| Second | `a7c6705c…` | 12:53:20–12:53:47 | 53% (41–71), 9 | 64–66% |
| Third | `73266bea…` | 11:49:54–11:50:56 | 84% (66–100), 20 | 72–78% |

`read_xic` alone, on the source itself, with no snapshot, echo or positions (mode
`observe`), in seconds. Each cell is three serial runs.

| Source | Bytes | Query | Spectra read / decoded | Points in window | First set | Second set | Third set |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Profile representative (MS1) | 17,703,110 | MS1 `[105, 134]` | 931 / 931 | 1,679,804 | 0.143 / 0.135 / 0.132 | 0.138 / 0.148 / 0.155 | 0.284 / 0.378 / 0.306 |
| Centroid representative (DDA) | 39,965,112 | MS1 `[100, 102]` | 7,602 / 4,627 | 11,090 | 0.397 / 0.368 / 0.370 | 0.398 / 0.397 / 0.403 | 0.867 / 0.956 / 0.861 |
| R0 profile file, narrow window | 546,327,287 | MS1 `[524.259257355, 524.269742645]` | 43,878 / 2,748 | 1,988 | 3.274 / 3.411 / 3.229 | 3.884 / 4.137 / 3.827 | 8.394 / 8.568 / 8.219 |
| R0 profile file, whole scan range | 546,327,287 | MS1 `[360, 1300]` | 43,878 / 2,748 | 24,744,260 | 3.354 / 3.349 / 3.275 | 3.993 / 3.919 / 3.932 | 8.127 / 11.850 / 11.014 |

The window's width barely matters: 24,744,260 points in the window cost no more than 1,988.
Unsampled sets in the retained evidence, on builds with the same library, lie between these:
R0 took 4.287–6.166 s on `541880b9…` and 7.744–8.908 s on `73266bea…`. No idle machine was
available, so no number here is a best case.

Memory did not move with the time: the process's final Windows `PeakWorkingSetSize`, as
PX.3 read it, in the first set, in bytes. Across the three sets each target stays within
2.7% of its lowest.

| Source | Peak (bytes) |
| --- | --- |
| Profile representative | 5,443,584 / 5,447,680 / 5,427,200 |
| Centroid representative | 8,433,664 / 8,364,032 / 8,212,480 |
| R0, narrow window | 20,807,680 / 20,750,336 / 20,844,544 |
| R0, whole scan range | 20,828,160 / 20,824,064 / 20,869,120 |

The whole evidence invocation of this build, from process launch to exit: the snapshot
copy, both passes, the echo and the JSON.

| Row | Wall (s) | Peak (bytes) | stdout (bytes) |
| --- | --- | --- | --- |
| `representative_profile` | 0.354 / 0.354 / 0.378 | 47,943,680 / 47,951,872 / 47,603,712 | 12,200,561 |
| `representative_centroid` | 1.110 / 1.081 / 1.345 | 76,034,048 / 75,939,840 / 75,952,128 | 25,298,728 |
| `inherited_BBM_506_…_calibrated`, first repeat | 5.572 | 370,917,376 | 127,912,821 |

Context, not comparable: PX.3's B, a dev/debug build, took 2.06–2.14 s and 220 MB on the
profile file and 8.01–8.56 s and 683 MB on the centroid file, with its own output
included. The planning estimate for R0 was 5–11 s per window, an estimate.

R0 has no frozen answer, so it is observed and not scored. Its digest is
`823286559d48f48af0ff0a90d602b33e16791b42bdef46f8cdf44f2021de4fc3`. It is CC0.

The profile and centroid representatives are CC-BY-SA-4.0: profile, Johannes Rainer,
Sigurdur Smarason and Giuseppe Paglia (Zenodo 20729183); centroid, Michael Witting and
Johannes Rainer (Zenodo 20729093). They are reused as ADR 0071 decision 8 approves, and
no acquisition bytes are in this repository.

## What this evidence does not establish

- **Anything about the product's path.** The rows score the standalone engine. In the
  product the viewer's open refusals come first (ADR 0071 decision 7), and most frozen
  synthetic inputs could not be opened there.
- **The four departures.** No frozen row reaches ppm input or mixed polarity, FAIMS
  voltage or representation. Their fixtures are X1's, in `mzml_xic/tests.rs`, and no real
  FAIMS file has been measured.
- **What no frozen row reaches.** #207's as-built table lists where the engine and the
  oracle would differ on a document none of the 77 contains, among them an array with no
  known role, which the oracle refuses and the engine ignores, and an empty zlib payload.
  This run does not reach them, by construction.
- **The reason on the six `honest_refusal` rows.** The frozen comparison passes any refusal
  there, and the example labels every document refusal `MalformedMetadata`, a tripped cap
  included. The reasons here, which no comparison checks, are the same on both repeats:
  `missing_required_value` (`rt_missing_value`), `not_well_formed` (`truncated`,
  `px2_truncated`), `count_disagrees` (`inventory_count_mismatch`), `conflicting_term`
  (`px2_contradictory`) and `undefined_param_group` (`px2_unresolved`). None is a cap.
- **`Missing`.** No row expects it, and the pass never produces it (ADR 0071 decision 3).
- **Larger files, a cold read, or another host.** R0 is the largest file measured, and it
  is one acquisition on one instrument. Scaling past it is not measured.
- **X4's costs.** Lane handoffs, cancellation latency, and the digest the owner's
  A0071-Q3 answer asks for, which adds a read of the whole file, were not measured.

## Retained evidence

Local, as PX.3's is, and not published. `D:/MSCanvas-X2-20261104/`: `final-3/` holds the
build, each invocation's stdout, stderr, snapshot, canonical science and diagnostics,
the combined ledger, the scored integer rows and two sets of observations of this build;
`integer/`, `integer-2/` and `integer-3/` hold the three freezes; `discrimination/` the four
mutations; `superseded-0/` to `superseded-3/` the earlier runs, the third set of
observations in `superseded-3/observations-2/`; `superseded-discrimination/` and
`superseded-discrimination-2/` earlier runs of the mutations; `xic-d5/` the throwaway
rendering, with its patch. `MANIFEST.json` lists every file's length and SHA-256, and its
own digest is
`956f0ecfbd571994cab622841f010315d6959dc338e8da8d5a39cd40725499a1`.
