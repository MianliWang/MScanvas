# PX.3 — Direction B evidence, with a bounded evaluation set

Status: **evidence recorded; required evidence missing. Full matrix incomplete.**
Date: 2026-09-12. Product baseline: `39955ebb4c5ca8885bf9507dd07a3704ed0f2aff`.

The final standalone B candidate passes all **30 ADR named cases**, but fails one
applicable legal namespace-prefixed mzML input. Four required evidence rows remain
missing. This is a scientific evidence report with a negative result and named
input gaps, **not full PX.3 PASS, a PX.4 outcome or provider admission**.

**The owner explicitly selected only B for this evaluation. A remains viable,
not prototyped and not rejected; it is outside this evaluation set.** No comparison
establishes that B is better than A. C's earlier disposition is unchanged. A later
PX.4 decision must consume this declared evaluation set and the missing evidence;
it cannot count A as failed or exhausted. PX.4 requires separate authorization.
The ADR prerequisite explicitly accepts this published terminal missing-evidence
handoff for the owner-authorized B-only evaluation, consistent with its existing
missing-evidence-first route. This closes the prerequisite wording gap without
calling the incomplete matrix a completed/PASS experiment or issuing PX.4's outcome.

[ADR 0046](../architecture/adr/0046-post-m6-xic-provider-runtime-route-lock.md)
remains the route/semantic owner. The [PX.1 audit](PX_1_XIC_PROVIDER_API_AUDIT.md)
and [PX.2 prototype record](PX_2_XIC_BOUNDED_PROTOTYPES.md) are unchanged.
[M5.4](M5_XIC_SOURCE_EVIDENCE.md) supplies the inherited input identities and the
old executable's refusal, not this candidate's scientific or resource evidence.

## Recovered baseline and final candidate identity

Before any prototype work, the repository root, remote, local HEAD/main/origin/main
and remote main were rebound to the baseline above, tree
`10f3773ac0942d31818dcc1e72c2f67fa49d4664`. The worktree, index, untracked set and
stash were empty; there was one worktree and no active Git operation or observed
competing writer. Both review agents were read-only. The same baseline was checked
again before creating `docs/px3-direction-b-evidence`.

The original local PX.2 archive was verified as 947,692 bytes, SHA256
`ca5b0b5af6d3c8d4f814f797a896de6439765ce713c4dfe7ed5105235a7f88a9`.
All 205 entries and every contained manifest size/hash were checked before extraction;
duplicate/escaping paths and links were rejected. It was extracted to a new owned
directory outside the product repository. Original PX.2 archive/scratch and prior
failed runs were preserved, including the earlier dependency-resolution failure and
base64-panic run. Its final source was copied byte-exact and rebuilt before scoring.

| Identity | SHA256 / value |
| --- | --- |
| Unchanged full Cargo.lock | `9863e066c2574d699a39d0c36ea62a83c5037a3dd3f78dec6e076c43c8863e01` |
| Unchanged Cargo.toml | `c540ebbd304fc3070f03639f2adeb09414ccaeac913e052658c4e68909f19dbf` |
| Rebuilt baseline main.rs | `0446e631935c929fdea4c410fb1d0471322ac95b34553398d275b49a2747e506` |
| Rebuilt baseline executable | `ad2391a4cfb61382e332573644ea700e36ab8b4ffee8c9d56f6275e445f6cdcc` |
| Final `repaired-v1` main.rs | `cc474e1bcb7ad171efd8bc693b07124614cfefd0c8556f9bcbd72041ba31f926` |
| Final exact.rs | `5e3415395a4244896f5a0146fb6c0a07f37fd317470563aca6b55b2e9175c9a2` |
| Final source-manifest digest | `0986ed9bdb999892b114f5f40ae24554f3ef3513fa7f24b36f677730a9941990` |
| Final executable, 2,128,384 bytes | `7751cd0c46911098012d347867dbe032a76ad7f41db96454941243157d3ddf8b` |
| Final build identity.json | `8b35bbdee0e36e850c6686f931dfa42ae5638cc0767271e0aa1003653aa2bdba` |

The existing toolchain is Rust `1.97.1 (8bab26f4f 2026-07-14)`, Cargo
`1.97.1 (c980f4866 2026-06-30)`, `x86_64-pc-windows-msvc`, dev/debug build.
Both builds used `cargo build --locked --offline`. The final formatting check passed.
No package or toolchain was upgraded; production dependencies and lockfiles were not
edited. `mzdata =0.66.6` still disables default features and requests only `mzml` and
`miniz_oxide`; resolved mzdata features are `checksum, miniz_oxide, mzml`.
The bindata/meta/param/spectrum companions remain exactly `0.66.6`: bindata/spectrum
have `miniz_oxide`, meta/param have no enabled features. The archived full metadata
and feature tree retain the complete graph, including flate2 `1.1.10`'s existing
Rust/miniz backend. No A assembly, .NET, new scientific dependency or provider fallback
was loaded. No product code or runtime boundary was implemented.

## S3 and S4 were frozen before scoring

The protocol froze at **2026-09-12T06:02:55.749353Z**, before the first scored
candidate execution. Baseline compilation preceded this freeze; candidate execution
did not. Fixture construction, independent answers and discriminating preflight checks
were already available. PX.2 output did not set tolerances or select this rule.

| Frozen artifact | SHA256 |
| --- | --- |
| `protocol/PROTOCOL.md` | `e3a7340a937d2d48bf968270a538bdf18c36f3a2390e07177f762add503a4b6f` |
| `protocol/case-ledger.json` | `28812f6e078ae92c26d3aea6eb70cce8c486caa2407addbe3ae32cdb1e77f460` |
| `oracle.py` | `61743961ad7462e136163bb198d15590027ede50bd04c1bbd143409ade4b635f` |
| Synthetic oracle answers | `c01d5f1b2dfcc85ae3d7fa1c0d5ee52688734eecf0f5a95cfab3e19e8b936ef3` |
| Independent inherited references | `720c84687f2efdfd593d8ac10c75a6ea46142c6337f143f0ccd091619b194f51` |
| `harness.py` | `ae03b603b045337e4c12d30ef610e79633b943d53b1d4ef63bf4c35df3027eb2` |

**XIC-S3:** inputs are the actual stored IEEE binary32/binary64 source values,
including finite negatives, subnormals and signed zero. The explicit finite binary64
window is inclusive; binary32 m/z values promote exactly. Sum the selected finite
intensities as exact dyadic values conceptually, without intermediate rounding. Test
only the final exact sum against the closed range `[-f64::MAX, f64::MAX]`. Outside
that range yields `SumNotRepresentable`; inside it yields one binary64 rounding to
nearest, ties to even. Exact zero is canonical `+0`. Other sums are not refused merely
because they require more than 53 significant bits before rounding.

This is a deliberately conservative **exact-range rule**, not IEEE's rounded-infinity
threshold: `MAX + minsubnormal` is out of range even though rounding alone could
produce MAX. It makes the finite output domain explicit without silently clipping an
out-of-domain exact sum. `MAX + MAX - MAX` must produce MAX; intermediate overflow
is a candidate algorithm defect. No finite negative or large source input is excluded
to make a failing calculation pass. Pure addition on the binary64 subnormal grid
cannot yield a nonzero exact magnitude smaller than its minimum subnormal.

Agreement is **exact binary64 bits**, with no absolute/relative tolerance. Source
identity/order, declared attributes and their presence, array roles, membership
positions, point counts, state and coverage/completeness are also exact. A positive
reference never passes as zero. Decimal author text and candidate-rounded text are
not the source value. RT and units stay as declared; there is no inference/conversion.

**XIC-S4:** an in-window NaN or either intensity infinity yields
`NonFiniteIntensity`, with no sum. A nonfinite intensity outside the window alone
does not fail a scan. The existing state precedence is unchanged: missing scan;
declared MS-level selection without array decode; known unusable arrays including
m/z NaN; unreadable arrays; nonfinite intensity; final sum outside the range; measured.
Infinite m/z values simply lie outside finite windows. True zero, empty window,
undeclared level, exclusion, missing arrays, unreadability and coverage gaps remain
distinct. A missing RT does not drop the scan. Profile output is a **point sum**,
not an integrated area; S1 remains PX.4's, and D4/D5 ownership is untouched.

## Independent reference, construction and correction history

The reference uses only Python standard-library ElementTree namespace resolution,
base64, zlib, struct and Fraction. It inventories source index/id and resolves immediate
CV/group scope from original bytes independently of the candidate. Each decoded IEEE
value becomes `Fraction.from_float`; exact addition and one final rounding implement
S3. It imports no candidate decoder, projection, query, state logic or result parser.
Candidate JSON is used only by the comparison harness. Unsupported reference encoding
is **ReferenceUnavailable / missing evidence**, never evidence of scientific
`Unreadable`. Missing files, empty output, absent scans, parse failures and operational
timeouts remain in the ledger denominator.

Twenty preflight checks independently confirmed stored binary64/binary32 payloads,
endpoint-adjacent values, negative zero, subnormal and cancellation construction,
state precedence, reference-unavailable handling and comparator discrimination.
Mutations for dropped scans, positive-to-zero, negative-zero substitution, RT/unit
changes and f64-to-f32 narrowing were rejected. The stored narrowing sentinel is
one binary64 `1 + 2^-30`, not two separately representable inputs. The runtime
`narrow-intensity` fault also disagrees with the oracle as required.

Two isolated reviewers found reference defects **before freeze**: m/z NaN was checked
after intensity decode; unsupported encoding could be swallowed as `Unreadable`;
RT present-without-value could be treated as absent; optional absent list handling
and inherited subject tags were inaccurate. These were fixed with isolated derived
inputs and reviewed again. An encoded-length inconsistency in the NaN/decode overlap
fixture was corrected before freeze. Prior drafts are archived. A final pre-run
comparison-only normalization omits null `source_metadata` on refusals, equivalent to
absence; substantive metadata and expected science remain unchanged. FROZEN.json
binds that precise source. There were no post-score changes to protocol or oracle,
and no score was rescued by changing a tolerance.

The final adapter uses separate positive/negative 34-u64-limb sums on the `2^-1074`
grid, then subtracts once and rounds using guard/sticky/parity. A finite binary64
magnitude is below `2^2098` grid units; at most `u64::MAX` points sum in absolute
magnitude below `2^2162`, within 2176 bits. This bounded experiment adds no arbitrary
precision dependency or production engine. The arithmetic reviewer separately
admitted its capacity, sign, final-only range and rounding implementation.

The adapter's metadata projection now handles indexed roots, namespace-resolved names,
consistent multiple scan entries and absent optional lists. Both readers still consume
the **same immutable original byte allocation**. Source index/id and array-role
correspondence are checked before serving rows. The original allocation is captured
after evaluation and SHA256-compared with the independently bound source. No rewritten
XML is handed to mzdata. Each result binds source, query, run, protocol/oracle/ledger,
source/build/lock and executable identities. Canonical science is stored separately
from timings, PID, traversal diagnostics and stderr. The known base64 decoder panic
is caught narrowly and its diagnostic retained; this proves no production worker,
cancellation or process-isolation guarantee. No process is spawned per scan.

## Results and exact denominators

The single ledger has **77 case rows**, including exactly **30 unique ADR named
cases**. There are 71 task-owned synthetic file paths (including 12 unchanged PX.2
fixture copies), two recovered inherited file paths, two missing inherited file paths
and two unassigned representative roles. The 73 available paths contain 66 distinct
source digests. Thus file paths, distinct bytes and case rows are not interchangeable.

| Build / result unit | PASS | FAIL | MISSING |
| --- | --- | --- | --- |
| Rebuilt PX.2 baseline, 77 ledger rows | 61 | 12 | 4 |
| Final repaired-v1, same 77 rows | 72 | 1 | 4 |
| Final 30 ADR named cases | 30 | 0 | 0 |
| Available normal scientific case rows | 69 | 1 | 0 |
| Explicit negative-control rows | 3 | 0 | 0 |

The final build executed **143 of 153 planned invocations**: 140 normal invocations
(two per available normal case), plus three one-run fault controls. 141 invocation
outcomes passed their declared criterion; the two prefixed-input repeats failed it.
All **70 available canonical repeat comparisons agree byte-for-byte**, including the
repeatable refusal on the failing prefixed case; reproducibility alone is not scientific
correctness. Missing rows account for ten unexecuted planned invocations.

There are **356 explicit assertion groups**: one outcome/science comparison and one
same-snapshot comparison per executed invocation (286), plus 70 repeat comparisons.
354 pass and two outcome comparisons fail. Individual field comparisons are not
separately counted as tests. The expected inventory totals 36,440 source scan records
once across available case rows, including the whole-refused tiny metadata and fault
controls; this is **not 36,440 measured MS1 XIC points**. Counts are generated by
`derive_summary.py` from the ledger and retained results, not from returned-success rows.
The final matrix uses only repaired-v1; it does not splice passing baseline results.

| ADR subject | Located final evidence and limits |
| --- | --- |
| 1 — endpoints | `endpoints`, `zero_width`, `unsorted`, `stored_binary32` retain exact membership; inherited lowint remains missing |
| 2 — fractional/low | `arithmetic` (22 scans), binary32 source and singleton narrowing control distinguish positive/zero, rounding, cancellation and final range; original lowint is still missing |
| 3 — duplicate RT | New `duplicate_rt` and PX.2 direct controls keep separate source identities in non-monotonic source order; original duprt is missing |
| 4 — MS exclusion | Declared MS2 with corrupt arrays is excluded before decode; undeclared level remains unknown/gap; all 36,319 scans of the inherited MS2-only file stay source-identified exclusions under MS1 |
| 5 — empty window | Empty membership gives count0/sum+0 without dropping scan; zero intensity with a selected point has count1; empty paired arrays remain a distinct source shape |
| 6 — representative inputs/resources | Both roles missing owner-approved bytes and independent references; no MS1 representative wall-time/peak-memory result exists |
| 7 — invalid/under-declared | All 30 named cases pass, with separate incomplete/mixed-unit files; truncation refuses honestly; legal prefixed mzML is an applicable candidate failure |
| 8 — reproducibility | 70/70 available canonical repeat comparisons agree, but four required rows remain unexecuted; repeatable wrong refusal is not promoted to correct science |
| 9 — identity/completeness | Full independent inventories, source order, correspondence fault, missing RT/list/decode cases and truncation are checked; the prefixed source is known to contain a valid scan which mzdata cannot obtain |

Representative arithmetic counterexamples are retained with both builds:

| Stored input / purpose | Frozen expected answer | Baseline | Final |
| --- | --- | --- | --- |
| binary64 0.1, 0.2, 0.3 | `0x3fe3333333333333` | one-ULP mismatch | exact |
| `2^53, 1, -2^53` | 1 | 0 | 1 |
| `MAX, MAX, -MAX` | MAX | SumNotRepresentable | MAX |
| `MAX, minsubnormal` | SumNotRepresentable | Measured MAX | correct state |
| singleton `1 + 2^-30` | `0x3ff0000000400000` | source retained | retained; explicit f32 fault detected |
| minsubnormal / signed zero / cancellation / ties | exact bits, canonical +0, ties-to-even | recorded per scan | all 22 arithmetic scans agree |

### The applicable pinned-reader failure

`prefixed.mzML` is a namespace-equivalent version of a valid one-scan source, with
unchanged payload and declarations. Its independent reference is a three-point
sum of `0.875`. The repaired metadata projection sees that scan; mzdata returns
`CandidateReadIncomplete:EOF` on both runs. Result `complete:false` is honest,
but inability to serve this legal input **fails the defined source-domain check**.
It is neither N/A nor missing evidence.

The pinned source confirms the mechanism:
[mzdata 0.66.6 reader.rs](https://docs.rs/crate/mzdata/0.66.6/source/src/io/mzml/reader.rs)
uses `event.name()` and matches literal `b"spectrum"` at lines874–877, rather than
namespace-local element names; its end-element matching has the same shape.
The archived PX.2 source audit provides the pinned source copy. This is not repaired
by upgrading/patching/vendoring the reader, stripping prefixes or introducing another
decoder. Indexed-root and equal-multiple-scan controls **do pass** after adapter
repair; those PX.2 limitations were not relabelled as a narrower legal source domain.

## Input identities, permission and remaining gaps

The exact tiny bytes (25,072 bytes, SHA256
`711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83`) were recovered
from the previously authorized pinned
[ProteoWizard synthetic example](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML),
under Apache-2.0. Its four scans have mixed RT declarations; the frozen rule requires
whole-query `MixedUnit:RT`. This is a unit/identity result, not endpoint arithmetic.

The exact previously authorized PRIDE PXD081190 file identified in M5.4 was recovered
from its documented official location after live accession, CC0 license and advertised
size checks: 208,408,454 bytes, SHA256
`262d1178303cd934223239d5d93a3b842dca69da09cef58e95a39b950d26b7e8`.
All 36,319 scans are MS2. Its MS1 query establishes declared exclusion and source
reconciliation; it supplies **no MS1 representative or low-intensity result**.
The historical acquisition authorization script was read, not executed; no old
ProteoWizard measurement campaign was repeated.

| Required row | Exact missing material / next owner |
| --- | --- |
| inherited lowint | Original 14,540-byte `lowint.mzML`, SHA256 `e00e390a33d4028e638897f8abc3f608d2b2e9ff1a579f30b7f07468743680da`; owner to locate original task archive/bytes |
| inherited duprt | Original 10,023-byte `duprt.mzML`, SHA256 `87731cb1c49a2d4398d282365dc846e21fd095e4e0d49424ecd356b0e4b6c548`; owner to locate original task archive/bytes |
| MS1 profile representative | File-specific owner permission and independently derived reference remain absent; concrete request below |
| MS1 centroid representative | File-specific owner permission, confirmation of MS1 centroid declaration and independent reference remain absent; concrete request below |

New low-value and duplicate-RT synthetic bytes do not replace the two original hashes.
No unrelated private/laboratory directories were scanned for them. Missing rows are
not numerical failures and not N/A.

The owner was asked during synthetic work to approve these exact files, their processing,
independent stdlib/Fraction references and three serial resource observations:

- **Profile:** [20171016_POOL_POS_1_105-134.mzML](https://zenodo.org/records/20729183),
  exact download path `https://zenodo.org/records/20729183/files/20171016_POOL_POS_1_105-134.mzML`;
  17,703,110 bytes, published MD5 `4130309a9283c8b492660dbad1fd3670`, SHA256 not yet
  available. CC-BY-SA-4.0; Johannes Rainer, Sigurdur Smarason, Giuseppe Paglia.
  This is real MS1 profile pooled-serum data, restricted by its publisher to m/z105–134
  and RT0–260s; any resource result would be limited to that subset's scale.
- **Proposed centroid role:** [PestMix1_DDA.mzML](https://zenodo.org/records/20729093),
  exact download path `https://zenodo.org/records/20729093/files/PestMix1_DDA.mzML`;
  39,965,112 bytes, published MD5 `fecd8da680ee28f6205f212b4934acd0`, SHA256 not yet
  available. CC-BY-SA-4.0; Michael Witting, Johannes Rainer. Metadata confirms real
  Sciex6600 MS1/MS2 DDA but not yet the file's MS1 centroid declaration. The request
  explicitly includes that verification; a mismatch would leave the role missing,
  without automatically authorizing a replacement file.

No answer granting these file-specific requests was received before this record's
scientific closeout. **Neither file was downloaded or processed.** Public availability
is not approval. The reference plan is recorded, not an obtained independent answer.

The retained resource harness defines wall time from candidate process launch through
result and snapshot serialization, and Windows `GetProcessMemoryInfo` final
`PeakWorkingSetSize` as the process high-water resident working set. Host/build, input
scale, traversal, output size, diagnostics and three serial repetitions would accompany
an authorized representative run; the oracle would run outside candidate timing.
A 300-second watchdog is operational protection, not a scientific acceptance threshold.
There are **no representative observations to report**, and synthetic/inherited-MS2
telemetry is not substituted for them. PX.4's practicality judgment remains unstarted.

## Reproducible evidence and publication boundary

The new local scientific archive is `D:/MSCanvas-PX3-20260912/px3-b-evidence.zip`:
**SHA256 `be25076e6f9ef06acf482b92e2d9141bd68ca13c3eaeba98595736412c981977`**, `168,611,147` bytes.
Its manifest enumerates relative paths, byte lengths and SHA256 digests; every archived
entry was read back and verified (1,770 ZIP entries; manifest SHA256
`a4bbe025e2a45af80c0d2974f01ac6bb79970a5d0a382706c65aef9e7d78e97e`). It retains prototype sources, unchanged full lock,
resolved graph/features, baseline and final build/executable identities, original failed
runs, construction, oracle, frozen protocol/answers/ledger, all available input bytes,
stdout/stderr/snapshot captures, canonical results, diagnostics, requests and reviews.
The mutable Cargo build cache is excluded; exact scored executables and sources are
included. Prior PX.2 state is unchanged. Publication/closeout records are separate
appendable local sidecars; no source commit is needed to record the eventual merge.

This PR changes only this record, focused ADR0046 S3/S4 and B-only scope/status text,
and ROADMAP/BOOTSTRAP pointers. No product code, validator, workflow, production test,
lock or dependency change is included. Local repository validation is recorded with
its real result; the actual reviewed head must also satisfy Frontend, Rust and
Repository quality before a protected true merge with `--match-head-commit`.
The PR publication record owns the actual merge SHA, ordered parents/tree, natural
`push` / `main` workflow runs, ff-only local synchronization and cleanup of only
this task branch. A merge preview or PR CI is not that publication evidence.

The scientific handoff is:

```text
PX3_DIRECTION_B_EVIDENCE_RECORDED — REQUIRED EVIDENCE MISSING
FULL MATRIX INCOMPLETE; PX.4 EVIDENCE-BLOCKED HANDOFF READY
B FAILS THE DEFINED SCIENTIFIC CHECKS for the applicable prefixed mzML input;
all 30 named synthetic cases pass. This does not fill the missing matrix rows.
A: VIABLE, NOT PROTOTYPED, NOT REJECTED; OUTSIDE THIS EVALUATION SET
PX.4 NOT STARTED — SEPARATE AUTHORIZATION REQUIRED
XIC PROVIDER NOT ADMITTED; PRODUCTION XIC NOT IMPLEMENTED
M6 COMPLETE; M7 NOT STARTED
```

## Complete ledger

The table below is generated from the frozen case ledger and final results. Subject
numbers are associations; a row's overall FAIL does not erase a separately successful
repeatability assertion. Fault rows pass only when the named injected error is detected.
The original 15 and additional 15 named cases are visible individually, without a
mixed-unit refusal masking another invalid-unit condition.

| Ledger row | ADR named case | Subjects | Final status | Runs |
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
| `prefixed` | supplemental / inherited | 7,9,8 | FAIL | 2 |
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
| `inherited_lowint.mzML` | supplemental / inherited | 1,2,8,9 | MISSING | 0 |
| `inherited_duprt.mzML` | supplemental / inherited | 3,8,9 | MISSING | 0 |
| `representative_profile` | supplemental / inherited | 6,8 | MISSING | 0 |
| `representative_centroid` | supplemental / inherited | 6,8 | MISSING | 0 |
