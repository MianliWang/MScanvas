# ADR 0071 — XIC re-entry and the meaning of its first version (X0)

Status: **Accepted (2026-10-30)** by the owner: decisions X-1 and X-2 of
[the v5.11 owner decisions](../../development/OWNER_DECISIONS_V511.md#x-1-xic-re-entry-and-its-evidence-gates)
([owner decision](#owner-decision-2026-10-30)). Documentation only. Nothing
here is implemented, and XIC (VIEW-007) stays unavailable with its stated
reason until the X3 decision admits a candidate. The questions still open are
listed [at the end](#open-questions).
Related: [0005](0005-mzml-preview-boundary.md),
[0037](0037-viewer-completion-route.md) (XIC-D1, XIC-D2, XIC-D5),
[0041](0041-viewer-selection-availability.md),
[0044](0044-conversion-configuration-authority.md),
[0046](0046-post-m6-xic-provider-runtime-route-lock.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md) (decision 7),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md) (decision 1);
ADR 0070 (U7, the umbrella decision for computation over the reader's decoded
arrays, written in its own change).
Evidence: [M5.4](../../spikes/M5_XIC_SOURCE_EVIDENCE.md),
[M6.10](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md),
[PX.1](../../spikes/PX_1_XIC_PROVIDER_API_AUDIT.md),
[PX.3](../../spikes/PX_3_XIC_COMPARATIVE_EVIDENCE.md),
[PX.4](../../spikes/PX_4_XIC_PROVIDER_RUNTIME_DECISION.md),
[ADR 0056 R0](../../spikes/ADR0056_R0_REAL_FILE_COMPARISON.md), and the XIC
evaluation of 2026-10-30 with its critic pass (`XIC_EVALUATION.md`, planning
workspace, not committed; cited below as "the evaluation, §n").

## Context

**XIC was refused twice, each time for a reason about one candidate.**

| Record | Outcome | Decisive reason |
| --- | --- | --- |
| [M5.4](../../spikes/M5_XIC_SOURCE_EVIDENCE.md) | `XIC_SOURCE_REFUSED` | The measured `msaccess` build prints `tic`, `sic` and `slice` intensities at four fixed decimals, so a small positive sum reads as zero; `image` is a pseudo-2D gel |
| [M6.10](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md) | `REFUSED_WITH_EVIDENCE` | The `msaccess` identity was re-observed byte-identical; the re-entry trigger did not fire |
| [ADR 0046](0046-post-m6-xic-provider-runtime-route-lock.md) | Route lock | Fixed the semantics: one closed `[low, high]`, one MS level, a per-scan sum, eight per-scan states, the unit rules; "No ppm in the first scope" |
| [PX.3](../../spikes/PX_3_XIC_COMPARATIVE_EVIDENCE.md) | 76 PASS, 1 FAIL, 0 MISSING over 77 rows | B (mzdata) cannot read the legal namespace-prefixed fixture |
| [PX.4](../../spikes/PX_4_XIC_PROVIDER_RUNTIME_DECISION.md) | `XIC_PROVIDER_REFUSED` | B fails the frozen source-domain contract; A viable, not prototyped; C "not viable as defined", because the product read no mzML arrays |

**C's premise is gone.** ADR 0056's reader decodes m/z and intensity arrays
in-process. R0 measured it bit-exact against an independent Python decode and
mzdata on 87,756 and 72,638 arrays of two real files, both from one Orbitrap
Exploris 480 acquisition. The two defects behind the earlier refusals are
absent: there is no four-decimal serialization, and names resolve by
namespace. Slice 1 is merged (#157); the desktop calls the reader only from
slice 2, draft PR #175.

**The reader is not the XIC candidate as it stands.** Its refusals are a
viewing policy. They conflict with ADR 0046 or the frozen PX.3 oracle in at
least ten places (the evaluation, §4). For example, the table pass refuses a
file that declares no base peak, and all 71 synthetic inputs and the two
regenerated M5.4 inputs declare none.

**Re-entry needs a new record, not an amendment.** ADR 0046 §6: "Any
investigation beyond this matrix requires a new scope decision — a new record,
not an amendment to this one." The after-beta-1 plan, section 7.5, asks for "a
new scope record for a bounded project-owned mzML array decoder: a new
candidate, not a repair of PX's refused one, rerunning all 77 rows; a written
decision on reader work and dependency approval". This is that record
(roadmap item N-13, slice X0).

## Decisions

### 1. XIC re-enters through a new candidate, C′

The evaluation's option 2: a full XIC with stated profile semantics.

- **The candidate, C′,** is direction C of ADR 0046 §2, redefined: a
  project-owned XIC pass in a sibling module beside `mzml_reader.rs`.
  - It reuses the reader's bounded tokenizer, `DOCTYPE` and entity refusal,
    namespace resolution, param-group expansion, version rule, decode caps,
    base64 and inflate, exact widening, and its typed refusals of corrupt
    payloads and mismatched lengths.
  - It applies ADR 0046's per-scan state policy, not the reader's viewing
    refusals.
  - It sums with an exact superaccumulator (XIC-S3).
  - It captures the presence and value of `unitAccession`, `unitName` and
    `unitCvRef` on the m/z, retention-time and intensity declarations, as
    ADR 0046's PX.1 clarification requires.
- **It is a new candidate**, not a repair of B. It inherits no result from
  ADR 0056, from B or from `msaccess`, in either direction. Only the X3
  decision can admit it.
- **Not chosen:**
  - option 0, do nothing: VIEW-007 (P1) stays open;
  - option 1, centroid-only: the engine must still compute profile sums for
    the frozen rows, and a Thermo acquisition with profile MS1 viewed through
    View would be refused;
  - option 3, a precomputed index: about 400 MB for the R0 file (estimate) and
    a persistence model ADR 0046 §4 refuses. It waits for a measured need.

### 2. The written decision for this one computation

ADR 0056 decision 7: "Any computation over the decoded arrays is an algorithm,
and it needs its own record."

- **This is that record for one algorithm**, under U7's umbrella decision
  (ADR 0070): the per-scan sum of stored intensities whose m/z lies in a closed
  window. It allows nothing else. No smoothing, baseline, apex, fit, area,
  normalization or centroiding.
- **It reimplements no mature algorithm.** It is a projection of documented
  stored values.
- **The retention invariant is U7's.** ADR 0056 decision 4 keeps offsets and
  "never arrays"; ADR 0070 amends that once for every computation, and this
  record does not amend it a second time. The XIC pass holds one spectrum's
  arrays at a time and keeps only its per-scan result.
- **The reader module's decode invariant is amended for this pass.**
  `mzml_reader.rs` states that only that module decodes an array, "and only
  the m/z and intensity arrays of one selected spectrum". The XIC pass decodes,
  through those primitives, the arrays of every spectrum it evaluates, in one
  streaming pass in source order, one spectrum at a time. X1 writes the
  amendment into the module documentation with the code. The viewer's
  selected-spectrum read is unchanged.
- **No new dependency.** `quick-xml =0.41.0`, `base64 =0.22.1` and
  `flate2 =1.1.10` are already pinned workspace dependencies, and the exact sum
  uses only the standard library. This answers the plan's "dependency
  approval": none is needed.

### 3. What ADR 0046 still fixes

Everything in ADR 0046 §1, §3 and §4 that decision 4 does not name holds
unchanged, by citation:

- the source: an mzML file the session can already preview (ADR 0005); its
  snapshot identity; scan identity by `index` and `id`, in source order;
- one MS level, stated as an operand, never "all levels" and no default;
- one closed `[low, high]`, both ends inclusive, compared against stored values
  without rounding; `low > high` and any non-finite bound refuse; `low == high`
  is a legal zero-width window;
- the aggregation: the sum of in-window stored intensities, per scan;
- the eight per-scan states and their precedence;
- XIC-S2 (a uniformly undeclared m/z unit is served as unreported), XIC-S3
  (the exact sum, one final rounding, `SumNotRepresentable`) and XIC-S4
  (`NonFiniteIntensity`);
- the unit rules: differing units, or a declared unit beside an undeclared one,
  on m/z, retention time or intensity, refuse the whole query; the frozen
  oracle applies them to the raw attribute triple across every scan of the
  run, all MS levels; an incomplete declaration refuses;
- coverage over in-scope scans only, gaps never joined, duplicate retention
  times kept in source order;
- the query identity `(snapshot, ms_level, low, high, aggregation)`, separate
  from freshness;
- §3's evidence rules and §4's boundary: no queue, no scheduler, no new
  persistence, a typed argv, the shared semantic plot specification.

Two consequences, stated so that no reader takes them as gaps:

- **`Missing` stays one of the eight states**, and no frozen row expects it.
  ADR 0046 defines it as "the run's index declares the scan and the reader
  could not obtain it". A pass that trusts no `indexList` and reads in one pass
  never meets that case.
- **Zero in-scope scans is a complete answer.** The frozen answer for an MS1
  query on the all-MS2 `PXD081190` file is `Evaluated`, `complete: true`,
  `coverage_gaps: 0`, with 36,319 `ExcludedByMsLevel` rows (counted). The
  engine returns exactly that. The interface states that the file has no MS1
  scans and draws nothing.

### 4. Four departures from ADR 0046 §1

ADR 0056's Consequences make XIC re-entry depend on "ADR 0046's semantics
unchanged". Each change below alters what ADR 0046 §1 would serve. The owner
accepted each one as a departure (X-2), and that condition is superseded for
these four only. None changes any of the 77 frozen answers (counted, the
evaluation §5). Each needs its own fixtures outside the 77.

| | Departure | ADR 0046 §1 | This record |
| --- | --- | --- | --- |
| 1 | **ppm input** | "No ppm in the first scope"; ADR 0037 XIC-D1 recommends an absolute half-width first | A centre with either an absolute half-width in m/z or a tolerance in ppm (XIC-D1 option (d)). For ppm, Rust computes `half = centre * ppm / 1e6`, then `low = centre - half` and `high = centre + half`, in binary64 and in that order. The typed input and the resolved bounds, as shortest round-trip decimals, travel with the result. ppm never reaches the query: its identity is still `(snapshot, ms_level, low, high, aggregation)` |
| 2 | **Mixed polarity** | Served | P1: the polarity of each in-scope scan is read (MS:1000130 positive, MS:1000129 negative). A query whose in-scope scans declare different polarities, or a declared polarity beside an undeclared one, is refused whole. The polarity is reported at top level |
| 3 | **Mixed FAIMS compensation voltage** | Served | A query whose in-scope scans declare different FAIMS compensation voltages (MS:1001581), or one beside none, is refused whole. No real file with FAIMS has been measured |
| 4 | **Mixed representation** | Served | A query whose in-scope scans declare different representations (MS:1000127 centroid, MS:1000128 profile), or one beside none, is refused whole |

- **The four rules see in-scope scans only.** The R0 profile file is MS1
  profile and MS2 centroid, and a run-wide rule would refuse it. The unit rules
  stay run-wide, as frozen.
- **Scan windows are disclosed, not a ninth state.** A window outside a scan's
  declared scan window (MS:1000501, MS:1000500) reads as a measured zero,
  although the instrument never looked there. The result carries a top-level
  fact, and the trace a notice ("the window lies outside the scanned range of
  N scans"). Differing in-scope scan windows are disclosed the same way. Both
  need fixtures.
- **New facts sit at top level in the evidence output**, never inside `rows`,
  `observation` or `source_metadata`. The frozen comparator matches those
  exactly and drops extra top-level keys.
- **P1 reuses the reader-metadata lane's polarity reading** (R-1, #182). P2,
  polarity as an operand like the MS level, needs a
  state outside ADR 0046's eight, a new oracle and new rows. It is a later
  record, not this one.

### 5. Profile data is a sum of points, and S1 is decided

ADR 0046 made PX.4 XIC-S1's decision owner. PX.4 answered it only for its own
branch: "no profile XIC is offered on the non-admission branch". **The owner is
now S1's decision owner, and answers it here: the profile point sum is
offered.**

- **Profile:** labelled "sum of profile points, not an area". It is comparable
  only within one window and one acquisition setting. It scales with sampling
  density and with where the window cuts the peak, and it is not an integrated
  area. On Orbitrap data the sampling interval widens with m/z and changes with
  the resolution setting, so the sum is never comparable across analytes at
  different m/z, or across runs with different resolution. No surface, wire
  field or document calls it an area (ADR 0046 §1).
- **Centroid:** "sum of centroid intensities". A window narrower than the
  scan-to-scan centroid jitter makes the peak drop in and out, and those scans
  are measured zeros, not absences. The interface says so.
- **Not declared:** the quantity keeps its name, and the representation is
  reported as not reported. The declaration is taken, not verified.
- **On the wire** every `Measured` observation carries `quantity: "point_sum"`,
  as the frozen oracle writes it on centroid rows too. The displayed name is
  derived from the declared representation.
- **Nothing centroids.**

### 6. MS1 only in the first product scope

This answers ADR 0037 XIC-D2 for the product: the XIC is taken over MS1 scans,
and the level is shown beside the trace and recorded with it. The engine still
takes any MS level as an operand, as the frozen ledger tests. An MS2 XIC over
DDA data sums fragments of unrelated precursors, so it waits for precursor or
isolation-window scoping, in its own record.

### 7. The product domain is narrower than the evidence, and says so

In the product the XIC starts from an open preview, so the preview's open
refusals come first: a missing base peak or TIC, a missing MS level or scan
start time, a retention-time unit other than seconds or minutes, or more than
one `<scan>` refuses the open before the engine runs. The 77-row candidate is
the standalone engine, as B was. Most frozen synthetic inputs, among them
`multi_scan_equal`, could not be opened in the product.

ADR 0046 §1 defines the source as a previewable file, so this is not a
violation. **It is accepted and disclosed:** the interface states that the XIC
is offered on files the viewer opens, and a file the viewer refuses keeps the
viewer's stated reason. A route that does not depend on the strict table pass
is not taken.

### 8. The evidence gate

**Rerun all 77 rows against the frozen answers, on one final build:** 71
synthetic, 4 inherited and 2 representative rows; 68 `semantic`,
6 `honest_refusal`, 2 `must_disagree` and 1 `identity_refusal`; 153
invocations (counted from the frozen ledger).

- **The comparator stays frozen.** The oracle, both ledgers, the supplement,
  the answers and the inputs stay byte-identical, and `compare()` and
  `canonical()` are reused unchanged. Both runners, `harness.py` and
  `run-supplement.py`, hard-code B's executable, so each gets a new hashed
  revision beside the frozen one, never an edit to it. No XML normalization,
  prefix stripping or fallback.
- **The candidate contract:** argv
  `[exe, source, ms_level, low, high, snapshot_path, mode]`. It writes a
  snapshot of the exact bytes it read, whose SHA-256 equals the source's; it
  echoes `source_metadata` with raw attributes and origins; it reports
  `positions`, `decode_attempts`, `rt_unit` and `representation` per row; and
  it implements the three fault modes (`fault-identity`, `narrow-intensity`,
  `substitute-normalized`).
- **The fault modes never reach the product.** `test-support` cannot be in a
  release build (`crates/proteowizard/src/lib.rs` raises `compile_error!`
  without `debug_assertions`), and a public hook that alters the science would
  be a forging surface. So the pass is generic over a per-spectrum transform,
  the product instantiates only the identity, and the faults exist only in the
  package-scoped example
  (`cargo run -p mscanvas-proteowizard --release --example xic_candidate`),
  whose normal rows call the production entry point unchanged. If that cannot
  be done, the whole matrix runs on one dev/debug build. Builds are never
  spliced into one matrix.
- **Inputs are approved.** The two PX.3 representative files
  (CC-BY-SA-4.0, Zenodo records 20729183 and 20729093) may be reused for X2's
  candidate runs, and release-build resource observations may be taken on the
  R0 CC0 profile file (546,327,287 bytes, 43,878 spectra). Observations are
  recorded with their host and build, never as thresholds. No acquisition is
  downloaded unattended.

### 9. Practicality is judged on measurement

- **No number is set in advance.** The X3 decision follows the PX.4 pattern:
  the candidate is admitted only if every row passes and it is practical at the
  observed scale, judged on X2's measured release-build timings.
- **The planning estimate** is about 5–11 s per window on the R0 546 MB file,
  single thread, warm cache (an estimate, not a measurement). The one related
  measurement, 22.75 s, is a heavier workload and not a bound.
- **The product runs the traversal the evidence scores.** Seeking to recorded
  offsets, or decoding on more than one thread, is admitted only with a rerun
  that covers it. A declared observed m/z range never lets a spectrum go
  undecoded, because declarations are taken unverified.
- **Every window is a full pass**, and nothing is cached. The precomputed index
  waits for a measured need.

### 10. Lane and sequencing

- **The XIC pass takes ADR 0057's native-read lane one spectrum at a time**,
  never for a whole pass. It checks cancellation and supersession between
  spectra, so a selected-spectrum read interleaves with it. Progress shows
  spectra read out of the table's count, never an estimated time. ADR 0057
  decision 1 carries a dated note.
- **The engine (X1) starts after #175 merges**, because it builds beside
  `mzml_reader.rs`. It is coordinated with #161, whose branch changes `mzml.rs`,
  and it takes P1's polarity from the reader-metadata lane (R-1, #182).
- **The interface (X5) comes after `ui/v511-rebuild` (#164) merges** (FE-1).
  XIC-D5's throwaway rendering is measured on that layout.

## Slices

A slice is one working session, 0.3–1 calendar day (the after-beta-1 plan,
section 4).

| Slice | Content | Size | Gate |
| --- | --- | --- | --- |
| X0 | This record | 1 | Done: accepted 2026-10-30 |
| X1 | The engine: its own required-value set, full unit-attribute capture, equal multiple scans accepted, the oracle's decode order, a decode variant that keeps non-finite values, the superaccumulator, the state precedence, the run-wide unit rules, decision 4's rules, a cancellation hook; unit tests on new fixtures for each departure and for absent arrays at length 0 | 2–3 | #175 merged; coordinated with #161; polarity from #182; the integer-array question answered |
| X2 | The evidence adapter (the example), the fault modes, the snapshot, the two runner revisions, the 77-row run (153 invocations) on one build, release resource observations on the two representatives and the R0 file | 1–2 | The memory gate |
| X3 | The decision record (PX.4 pattern) and XIC-D5's throwaway rendering at three viewports on the v5.11 layout | 1 | Every row passes; #164 merged for the rendering |
| X4 | Runtime: the Tauri command, generation checks, the lane per spectrum, cancellation, supersession, the retained result, the DTO, error codes and resources; the gap-aware series in the shared plot specification; the XIC panel; exports if X-3 includes them | 2–3 | An admitted outcome, X-3 answered, its own authorization |
| X5 | Interface: the input, every ADR 0037 state, keyboard, linked selection, gap and disclosure copy, rendered QA | 2 | X4 published, `ui/v511-rebuild` merged, its own authorization |

**Total: 9–12 slices (L–XL).**

**X4 and X5 carry ADR 0046's PX.5 and PX.6 obligations**, by citation:

- the gap-aware representation in the shared semantic specification (a plot
  specification schema bump from 4);
- the partial or truncated read answered with typed coverage, or refused;
- ADR 0044's identity, revision and state split for stale replies;
- the source generation checked before and after the read;
- ADR 0046 §1's in-place-rewrite window, closed by a digest revalidated after
  the read or stated as a residual;
- ADR 0037's visible-XIC obligations: keyboard equivalence, rendered evidence
  at all three viewports for every listed state, coverage-gap disclosure, and
  selection only through `canStartSpectrumSelection` (ADR 0041).

## What this changes in other records, and what still holds

- **[ADR 0046](0046-post-m6-xic-provider-runtime-route-lock.md)** carries a
  dated note. It stays the authority for the semantics decision 3 lists. What
  changes is the route (this record), the four departures, and S1's owner.
- **[M5.4](../../spikes/M5_XIC_SOURCE_EVIDENCE.md)** carries a dated note.
  `XIC_SOURCE_REFUSED` still stands for the `msaccess` build it measured, and
  its re-entry gate for a different `msaccess` identity is unchanged. This
  record re-enters XIC through a different candidate, which inherits nothing
  from that build in either direction.
- **[PX.4](../../spikes/PX_4_XIC_PROVIDER_RUNTIME_DECISION.md)** is not edited.
  `XIC_PROVIDER_REFUSED` stands for B, and A stays viable, not prototyped and
  not rejected.
- **[ADR 0056](0056-project-owned-mzml-reader-for-viewing.md)** is not edited.
  Decision 7 is answered for this algorithm by decision 2 above, and its
  "ADR 0046's semantics unchanged" is superseded for the four departures only
  (decision 4). The retention invariant is ADR 0070's.
- **[ADR 0057](0057-conversion-capacity-and-viewing-during-conversion.md)**
  decision 1 carries a dated note on the lane (decision 10).
- **[ADR 0037](0037-viewer-completion-route.md)** is not edited. Decision 4
  answers XIC-D1 for the product with option (d), and decision 6 answers
  XIC-D2 with MS1. XIC-D5 stays open under X-3.
- **[The feature catalogue](../../product/FEATURE_CATALOG.md)**, VIEW-007, and
  **[the after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#75-evidence-gated-items)**,
  section 7.5, carry dated notes.

## Owner decision (2026-10-30)

The owner was shown the 20 decisions that block work now, among them X-1 and
X-2, each with its recommendation, and replied verbatim: "全部按推荐，继续"
("all as recommended, continue"). The same reply answered U7 with option (a),
which ADR 0070 records.

**X-1, XIC re-entry and its evidence gates: option 2.**

- §11.1: this scope record and the written decision for this computation are
  authorized, with the reader module's decode invariant amended for the pass
  (decisions 1 and 2).
- §11.6: the frozen PX.3 comparator stays byte-identical, with new hashed
  revisions of both runners (decision 8).
- §11.7: the PX.3 representative files may be reused, and resource
  observations taken on the R0 CC0 file (decision 8).
- §11.11: practicality is judged on X2's measured release timings, and no
  number is set in advance; the product runs the evaluated traversal; the
  precomputed index waits for a measured need (decision 9).
- §11.12: the pass takes the native-read lane per spectrum; the engine starts
  after #175 and is coordinated with #161; the interface comes after #164
  (decision 10).

**X-2, the first scope's semantics: all accepted.**

- §11.2: the four departures (ppm input; whole-query refusal of mixed polarity,
  mixed FAIMS compensation voltage and mixed representation among in-scope
  scans), with scan windows disclosed and not given a state (decision 4).
- §11.3: polarity rule P1 now, P2 in a later record (decision 4).
- §11.4: the profile point sum is offered, labelled "sum of profile points, not
  an area", comparable only within one window and one acquisition setting, and
  the owner is S1's decision owner (decision 5).
- §11.5: MS1 only in the first product scope (decision 6).
- §11.8: the preview's open refusals sit in front of the engine, and the
  narrower domain is disclosed (decision 7).

## Open questions

1. **X-3, XIC exports and panel** (before X4). Open; the recommendations are
   working defaults:
   - §11.9, exports: CSV/TSV, SVG, PNG and `Copy plot` in the first scope, as an
     explicit extension of ADR 0046 §5. Until X-3 is answered, ADR 0046 §5's
     routing of a reusable XIC export to a later milestone holds;
   - §11.10, XIC-D5: the trace in its own panel under the chromatogram, sharing
     the retention-time axis, with its own value axis, no dual axis and no
     normalization, its height measured on the v5.11 layout;
   - §11.13, the preview and engine divergences: kept, each with its reason
     stated in the interface, and aligned in ADR 0056's follow-up. The default
     stands.
2. **Integer arrays** (before X1's fixtures). The reader widens 32- and 64-bit
   integers up to 2^53 exactly and refuses larger ones. Either that refusal
   maps to `Unreadable`, which stretches "could not be decoded", or the
   superaccumulator sums 64-bit integers exactly. The frozen oracle decodes
   floats only, so either choice needs new rows with an independent reference.
3. **Carried to X4, not decided here:** whether a partial or truncated read is
   returned with typed coverage or refused, and whether the in-place-rewrite
   window is closed by a digest revalidated after the read or stated as a
   residual.
