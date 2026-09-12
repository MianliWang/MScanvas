# ADR 0046 — Post-M6 XIC Provider / Runtime Interlude route lock (PX.0)

Status: **accepted. `PX.0 COMPLETE`.**
Date: 2026-09-11
Amended: 2026-09-11 (PX.1) — **XIC-S2 is closed** at its row below, on baseline
`6c324aa94a4c34e626d6bc2a79af1f8b125426d8`. The superseded wording is kept
struck through there rather than deleted. Three statements that depended on that
choice being open — the §1 units row, §3's subject 7, and §6's fixture split —
are corrected with it. The PX.1 clarification below distinguishes genuine unit
absence from incomplete declarations without changing that answer, and names
their derived invalid-input cases and refusal oracle in §6.
**The PX.1 amendment touched no other decision in this record**, and the
route is unchanged. See [the PX.1 audit](../../spikes/PX_1_XIC_PROVIDER_API_AUDIT.md).

Amended: 2026-09-12 (PX.3) — **XIC-S3 and XIC-S4 are closed before the
first scored run** under the separately authorized B-only evaluation. The decisions
below and [PX.3 evidence](../../spikes/PX_3_XIC_COMPARATIVE_EVIDENCE.md) bind the
exact agreement rule and results. A remains viable, not prototyped and not rejected,
outside this evaluation set; B-only evidence is neither a comparison against A nor
a production provider selection. PX.4 is not started. Other semantics, the thirty
named cases and the S1/D4/D5 decision owners are unchanged.

Related: [0045](0045-conversion-completion-closure-and-handoff.md),
[0043](0043-conversion-completion-route.md),
[0042](0042-viewer-completion-closure-and-handoff.md),
[0044](0044-conversion-configuration-authority.md),
[0041](0041-viewer-selection-availability.md),
[0038](0038-spectrum-viewport-authority-and-screen-projection.md),
[0037](0037-viewer-completion-route.md),
[0005](0005-mzml-preview-boundary.md),
[M6.10's terminal ledger](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#the-terminal-ledger)

**This record locks the route for the Post-M6 XIC Provider / Runtime Interlude
and does nothing else.** It admits no provider, selects no runtime, implements no
XIC, and reports no performance or scientific-correctness result. A route lock is
none of PX.4's four provider outcomes.

**Entering the interlude was separately authorized.**
[ADR 0045](0045-conversion-completion-closure-and-handoff.md) established that
`M6 COMPLETE` is the interlude's *gate*, and that meeting a gate is not entering
it. The gate was met on `91bedca35de5165d67edef7586b8bc7b3a1c6dc5`; entry is
authorized by the PX.0 instruction this record answers, not by M6's closure.
**M6's exit criteria are untouched, `M6 COMPLETE` stands, and M7 has not
started.** Nothing here relitigates M6 or makes this route easier by moving it.

Baseline: `91bedca35de5165d67edef7586b8bc7b3a1c6dc5`. Documentation only.

## What this route is for

[M5.4](../../spikes/M5_XIC_SOURCE_EVIDENCE.md) ended `XIC_SOURCE_REFUSED`. That
refusal is about **one measured executable's implementation**, not about the
science: the decisive defect is a literal `setprecision(4)` in `RegionTIC.cpp:156`
at ProteoWizard revision `47b13cf` — a revision that executable does not itself
report, which is why the gate is its digest — with a second build-specific abort
recorded beside it, and **no supported way to request greater `tic` precision in
that build**. The installed help's only `precision` token belongs to a different
analyzer that cannot express an m/z window.
An extracted-ion chromatogram remains a legitimate scientific quantity.
Whether *another* provider or a different runtime can serve it at the precision
required is a question worth asking once, in its own place.

This interlude is a **small bridge to the approved frontend work**, not a new
analysis platform and not an open research programme. It answers six subjects
once each, and stops.

## 1. The first useful scientific scope

**Start from the admitted boundary and widen nothing.** The source is a local
mzML file the session has already admitted and can already preview under
[ADR 0005](0005-mzml-preview-boundary.md). **Direct vendor preview is not
reopened** — it is route 2 of
[M6.10's terminal ledger](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#the-terminal-ledger),
disposed `EVIDENCE_BLOCKED` there rather than here — and **no RAW family is
added**. The proposed first query is one closed m/z window, at one MS
level, over one snapshot, aggregated one way.

| Semantic | The proposal |
| --- | --- |
| Source snapshot identity | **Exactly what the session resolves for an mzML row today**, and no more: `FileIdentity` (volume serial plus the whole Windows file ID), and the retained source generation the preview already revalidates against — identity, byte length and modification time. **No content digest is taken for an mzML source.** `accept_mzml_file` records none, only a SCIEX bundle carries one, and [ADR 0005](0005-mzml-preview-boundary.md) records why: hashing the file around every preview would cost more than the preview. A result names the snapshot it ran on and a changed generation invalidates it rather than silently re-running. **Closing the remaining in-place-rewrite window needs digest capture *and revalidation after the provider has read*, which is new work PX.5 would owe** — hashing alone stamps a result with a digest the provider may not have consumed, and the preview boundary already resolves this shape by rechecking after the read rather than before it — it is not something this boundary already provides, and this record does not claim it does |
| Scan identity and order | The source's own `index` and `id`, in **source order**. Retention time is never the key: M5.4 measured two spectra sharing one retention time and kept them as two rows, with `rt` reading non-monotonically |
| MS-level selection | Exactly one MS level, stated as an operand. There is no implicit "all levels", and no default |
| m/z bounds and endpoint policy | A closed interval `[low, high]`, **both endpoints inclusive**, compared against the source's stored values without rounding. `low == high` is a legal zero-width window. **`low > high` and any non-finite bound are both refusals**, never an empty result. Both halves are needed: `low > high` is false for a NaN, so a policy refusing only the reversed case would let a malformed request fall through into a certified `Measured { sum: 0 }`. M5.4 measured both failures on the refused build — a reversed window exiting `0` with no output, and a non-finite window silently returning the **unwindowed** result |
| Units | The unit the source declares for its m/z array. Where the source declares none, the proposal is that the window is expressed in the source's own numeric domain and the result carries that as unreported, as the viewer's existing unit posture does. **Whether such a source is served at all was XIC-S2, and PX.1 closed it: it is served, with the unit preserved as unreported.** See the row below. **No ppm in the first scope.** The query's operands are `low` and `high` and only those; where a surface takes a **centre and an absolute tolerance** — which is what VIEW-007's acceptance row asks a user to type — it normalizes to that closed interval *before* a query exists, so one input form does not become a second semantics |
| Aggregation | The **sum** of the intensities of source points whose m/z lies in the closed window, per scan. Nothing else. Not a baseline correction, not an interpolated apex, not a fitted peak |
| Retention-time association | Each result point carries its scan's declared retention time as an **attribute of the scan**, never as an identity or an ordering key. Where a source declares no retention time, or no retention-time unit, the result carries that as declared-absent rather than substituting a number — the scanner already models both, including a unit that was not emitted. **A run is refused for this query, rather than converted or mixed, when its scans disagree about a unit on *any* of the three axes — m/z, retention time or intensity — whether by *differing* declared units or by a declared unit beside an undeclared one**: the scanner recognizes seconds and minutes and already has a name for the disagreement, plotting raw values across it would put 60 seconds after 2 minutes, and one `UnitState` per axis cannot honestly label a trace whose points are partly known and partly unreported. **The m/z axis matters most and is easiest to miss**: applying one `[low, high]` across scans whose m/z units differ accumulates physically different windows into a single number. XIC-S2 is a narrower question — what to do when the **whole source** declares no m/z unit — and does not reach disagreement within one run. Conversion is a transformation this product has not admitted, so the first scope fails closed; admitting one is a later decision, not an implementer's. **A scan with no declared retention time cannot be placed on a retention-time axis**, so it is excluded from a plotted trace and **counted as a coverage gap** in the completeness facts PX.5 owns. It is **never silently dropped**, and PX.6 discloses the gap rather than presenting the trace as a complete success. **The same holds for every state that is not `Measured` — except `ExcludedByMsLevel`**: none of the others carries a plottable value, each counts as a coverage gap, and PX.6 may not connect neighbouring measurements across one and call the trace complete. **The shared plot contract cannot express that today** — a chromatogram connects adjacent points, a series refuses a non-finite separator, and a panel refuses two series in one role — so a **gap-aware representation in the shared semantic specification is work PX.5 owes**, with PX.6 consuming it. Bypassing the shared contract is not the alternative: that rule is a standing architecture rule, and drawing across a gap is the dishonesty this row exists to prevent. **Coverage is measured over the in-scope scans only.** A scan the MS-level operand correctly excluded is not missing data, and counting it would report a complete MS1 trace over a mixed run as almost entirely gaps. `MsLevelUndeclared` **does** count, because whether it belonged in scope is precisely what is unknown |
| Duplicate retention times | Preserved as separate result points in source order. Never merged, never summed together, never reordered **in the result**. **The drawing is a different question**: the shared plot contract requires a non-decreasing domain axis, so a result whose retention times run non-monotonically — which M5.4's duplicate-RT fixture produces — cannot be handed to it as-is. PX.6 derives a **stable retention-time-ordered screen projection** from the authoritative result, which keeps source order, scan identity and the original order among equal times. Neither reordering the result nor bypassing the axis rule is admitted: the first loses identity, the second draws a line running backwards in time |

**A measured zero is not any other answer.** Per scan the result is exactly one
of eight states, and the first of them carries a point count so that two
different zeros stay different:

| State | What it means |
| --- | --- |
| `Measured { sum, points_in_window, intensity_unit }` | The scan was read and the window evaluated. `sum` may be `0`; `points_in_window` may be `0`. These are measurements. **The intensity unit the source declared travels with the value**, or its declared absence does — VIEW-007 asks for a trace with explicit units and the proposal states explicit chromatogram intensity units, and a sum with no unit beside it cannot satisfy either |
| `ExcludedByMsLevel` | The scan **declares** an MS level and the query's own MS-level operand filtered it out |
| `MsLevelUndeclared` | The scan declares no MS level, so the operand neither matched nor excluded it. The existing mzML scanner already models an undeclared level as a first-class case and counts it; this state carries that rather than guessing a level in either direction |
| `NoUsableArrays` | The scan does not carry a usable pair of arrays — one absent, the two disagreeing in length, **or the m/z array carrying a `NaN`, which makes window membership undecidable for that scan** — every comparison against it is false, so a bare interval test silently drops the point while an array-validating reader refuses the scan, and both would otherwise pass the matrix. **An infinite m/z is not this case**: it compares normally and simply falls outside any finite window, so it is excluded like any out-of-window point and the scan stays `Measured`. Refusing a scan for a non-finite value the window never reaches is the whole-array drawability semantics the paragraph below rejects. A spectrum with **no intensity array at all** is a case this repository has already measured, and it is not an m/z-domain problem |
| `Unreadable` | Both arrays are present and could not be decoded |
| `Missing` | The run's index declares the scan and the reader could not obtain it at all |
| `NonFiniteIntensity` | The window contains a point whose intensity is not finite. **XIC-S4 was decided before PX.3 scoring: report this state, with no sum; do not silently exclude the in-window nonfinite point.** A nonfinite intensity outside the window alone does not fail the scan |
| `SumNotRepresentable` | Every in-window intensity is finite, and their final exact sum lies outside the chosen finite output range, as fixed by XIC-S3. It exists so the rule above holds without exception: **a `sum` is never non-finite**, and an overflow is reported rather than returned as one |

**The states are resolved in this order, and the first that applies wins.**
`Missing`, then the MS-level operand on **declared metadata without decoding any
array** (`MsLevelUndeclared`, or `ExcludedByMsLevel`), then `NoUsableArrays`,
then `Unreadable`, then accumulation (`NonFiniteIntensity` or
`SumNotRepresentable`), then `Measured`. Without this an excluded scan with an
undecodable array matches two states at once, and a candidate that filters
before decoding disagrees with one that decodes before filtering **on the same
input** — which would make the oracle ambiguous rather than the candidate wrong.

**Ordering of the m/z array is not a precondition, and the viewport's drawability rule is
deliberately not reused.** A sum is taken over a set, so a legal mzML spectrum
whose m/z array is unsorted has a well-defined in-window sum even though the
existing rule refuses to *draw* it — that rule also refuses on a non-finite value
anywhere in either array, including far outside the window. Borrowing it here
would answer a refusal where a measurement exists, against §4's own rule that a
scientific result is not the drawing's.

**Profile and centroided data are both in scope, and the quantity is named
honestly for each.** The aggregation is the same in both: a sum of in-window
point intensities. Over centroided data that is a sum of peak intensities. Over
profile data it is a **point sum and not an integrated peak area**, and no
surface, wire field or document may call it one. **Nothing centroids silently** —
that is a standing product rule, not a new one. Where the source declares
neither acquisition mode the result reports the declaration as unreported and the
quantity keeps its name. **The declaration is taken as declared and is not
verified by this query** — M5.4's pinned synthetic fixture is a measured case
where stored metadata and the actual arrays disagree.

**Five choices were open, each with a named decision owner. XIC-S2 is closed
by PX.1; XIC-S3 and XIC-S4 are closed by the separately authorized PX.3 below.
XIC-S1 and XIC-D5 remain with their original decision owners:**

| | Choice | Decision owner |
| --- | --- | --- |
| **XIC-S1** | Whether a profile source's point sum is offered at all in the first scope, or withheld pending an integration semantics. PX.2 may compute one, labelled a point sum | **PX.4**, on PX.3's profile evidence. Blocks PX.6 |
| **XIC-S2** | ~~The unit posture where a source declares no m/z unit — reported as unreported, or the source refused for this query.~~ **DECIDED by PX.1, 2026-09-11: a source whose m/z unit is uniformly undeclared is served, with the unit preserved as unreported.** The dimension is established by the array's own controlled-vocabulary role, which this repository's scanner already reads as `ArrayKind::Mz`, so genuine absence of a unit declaration is a labelling fact rather than an ambiguous quantity — and the answer is representable without inventing a state, since `mscanvas-plot-spec`'s `UnitState::Unreported` is documented *“The file reported no unit. Nothing may be displayed as one.”* **This is a new semantic policy, not an inherited one**: the shipped viewer never reads the m/z unit declaration at all, so it cannot have decided this. **It licenses no inference, default or conversion**, and does not touch the mixed-unit refusal beside it. PX.3 now scores subject 7's missing-m/z-unit fixture against that fixed answer rather than against a branch | **PX.1 — closed.** See [the PX.1 audit](../../spikes/PX_1_XIC_PROVIDER_API_AUDIT.md#xic-s2--decided) |
| **XIC-S3** | **DECIDED by PX.3, 2026-09-12, before its first scored run:** use the actual stored IEEE binary32/binary64 values, including finite negatives, subnormals and signed zeros. Membership uses inclusive finite binary64 bounds with exact binary32 promotion. Conceptually sum selected finite intensities exactly as dyadic values. If the **final exact sum** lies outside `[-f64::MAX, f64::MAX]`, return `SumNotRepresentable`; otherwise round once to binary64, nearest with ties to even, and canonical `+0` for exact zero. This is a conservative exact-range policy, **not IEEE rounded-infinity overflow**: `MAX + minsubnormal` is out of range, while `MAX + MAX - MAX` is MAX. No finite source intensity is excluded to avoid a failure. Agreement requires exact binary64 bits, with no atol/rtol; source identity/order, declarations, membership/counts, states and coverage also match exactly. Inputs are decoded source values, not decimal author strings or candidate output | **PX.3 — closed.** The pre-run protocol, independent reference, rounding/subnormal/cancellation/range cases and exact artifact hashes are in [PX.3 evidence](../../spikes/PX_3_XIC_COMPARATIVE_EVIDENCE.md#s3-and-s4-were-frozen-before-scoring). This fixes arithmetic, not S1, provider admission or production implementation |
| **XIC-D5** | **ADR 0037's own open decision, carried under its own name.** Where the XIC is drawn and against which value axis — a trace inside the existing chromatogram panel, or its own panel with its own value domain. Nothing in the evidence settles it and the consequence is severe: a total ion current sums every ion in every scan while an XIC sums one narrow window, so on a shared linear intensity axis the XIC is a flat baseline line for most real acquisitions **Answered after PX.4 and before PX.5 is authorized**, on PX.3's evidence, with the chosen placement's height cost measured at all three responsive targets — **in a bounded throwaway rendering outside the product, on the same footing as PX.2's prototypes**, since PX.4 writes only Markdown and PX.6 comes after the slice this decision gates. The measurement is evidence for a decision, not a product change. **Not PX.5's to make and not deferred to PX.6**: ADR 0037 states that its runtime slice *cannot start until these decisions are answered*, and a typed operation, DTO and service path frozen before the value-axis posture is settled is exactly what that forbids. It is a decision alongside XIC-D4, not a slice. **Not M7's**: M7 owns the shell and overall layout, not where this one quantity is drawn |
| **XIC-S4** | **DECIDED by the explicit PX.3 authorization and fixed before its first scored run:** any in-window NaN or positive/negative infinity intensity produces `NonFiniteIntensity`, with no sum. Do not silently discard that point. A nonfinite intensity outside the window alone does not fail the scan. Existing state precedence is unchanged: known m/z NaN is `NoUsableArrays`, while an infinite m/z lies outside every finite window | **PX.3 — closed.** Bound with the same pre-run protocol as XIC-S3. This is distinct from whole-array drawability and changes no other decision owner |

**XIC-S2 declaration boundary, clarified by PX.1.** Undeclared means all unit
attributes are absent after resolving direct and referenced parameters at their
source use site; an unexpanded parameter-group reference is not absence.
A missing `unitAccession` with `unitName` or `unitCvRef`
present, or an empty/whitespace-only accession, is an incomplete declaration:
refuse it under subject 7's invalid-input boundary, retaining the observed
attributes, rather than treating it as served-and-unreported. An unrecognized
nonempty accession is still declared and its value must be preserved. Future
metadata support must keep presence and values for all three attributes on m/z,
RT and intensity declarations; the current scanner's temporary accession capture
and interpreted RT markers do not supply that record. This is required future
work, not an implemented reader or a measured result. The incomplete-unit
derivatives and their refusal oracle are explicitly enumerated in §6; the
generic truncated-read oracle does not establish this distinction. Other
decision owners remain unchanged.

## 2. Bounded candidate directions

**At most three architectural approaches, not a catalogue of MS libraries.**
Unused slots stay unused; none of the three is required to survive PX.1.

| | Direction | What it is, and what it is not |
| --- | --- | --- |
| **A** | A corrected or differently-versioned ProteoWizard interface | A *different measured executable identity*, or a ProteoWizard interface that does not serialize through the passive analyzers. The four-decimal defect is a source-level literal, so a candidate here must be a build or an interface where that is not the path a value takes. **A candidate that is a different measured `msaccess` identity is VIEW-007's own re-entry trigger and must additionally satisfy M5.4's three-part gate in full** — a covered executable identity and help/capability grammar, a resolved numeric-fidelity answer, and re-measurement of everything that record establishes. **This route does not narrow that gate** |
| **B** | A mature reader or API behind a local worker | Maintained, lawfully licensed, run in a project-owned worker under Rust's existing process and filesystem ownership. A name in a shortlist is **not** proof of compatibility or admission: PX.1 establishes licence, maintenance, API surface and numeric contract before any name is carried forward. **The standing prohibition on vendoring proprietary SDKs, DLLs or restricted vendor readers applies here unchanged** — this is the direction it governs, and no licence finding relaxes it |
| **C** | Minimal aggregation over a lawful full-data source the project already reads | A narrow, project-owned per-scan window sum over mzML arrays this product already reads. **Not** permission to reimplement a proprietary reader, and not a general analysis engine |

**The refused `msaccess` binary is a control, not a contender.** Its identity is
pinned by M5.4's re-entry gate and was re-observed unchanged by M6.10. It is
carried as a historical counterexample, and what would reopen it is M5.4's
re-entry gate on a **different digest**, never another run of the same binary.
**A different executable inherits its result in neither direction**: a new build
is neither admitted for resembling a measured one nor refused for sharing its
name.

PX.1 selects viable candidates and PX.2 prototypes only those. **Installing a new
dependency or a provider still requires explicit approval inside the slice that
needs it**, under the standing dependency policy.

## 3. Evidence that can actually decide

**M5.4's defects and re-entry requirements are carried by citation** — the
low-positive/zero serialization problem, the window failures, and the aggregation
and scan-identity questions all live in
[the spike](../../spikes/M5_XIC_SOURCE_EVIDENCE.md), whose matrix answers
[ADR 0037's](0037-viewer-completion-route.md#m54-candidate-evidence-dimensions)
thirteen dimensions and is validator-held **against that vocabulary**. The
subjects below are derived from those dimensions for this route's question; they
are **not** that vocabulary and are not validator-held.

**Help text is not implementation evidence.** M5.4's durable governance output
applies here unchanged: a query name, a signature, a filter grammar, a declared
capability and a release string are each insufficient. PX.1's audit reads
documentation and produces **viability**, never admission — both of M5.4's
decisive defects were invisible in help text.

**The oracle is established before a candidate runs.** It is either a fixture
whose arrays are known by construction, with its expected window sum derived
independently of every candidate, or a representative acquisition with an
independently derived reference. **A candidate agreeing with itself is not a
reference**, and two candidates agreeing is corroboration rather than an oracle.
**Where no independent reference for a representative acquisition can be
obtained, that arm is simply unavailable** and PX.4 routes to `EVIDENCE_BLOCKED`
naming it — substituting a second candidate is the move the previous sentence
forbids. Obtaining such a reference is a repository-owner decision, like the
fixture permissions.

The finite future matrix covers these subjects and no others:

| | Subject | What it has to discriminate |
| --- | --- | --- |
| 1 | Window endpoints | A point exactly at `low` and one exactly at `high` are both in |
| 2 | Fractional and low intensities | A positive sum below the candidate's representation or serialization resolution stays distinguishable from zero. This is the requirement M5.4's measured build failed |
| 3 | Duplicate retention times | Two scans at one time stay two result points with their own sums, **in source order**. M5.4's fixture puts them at non-adjacent indices precisely so a reordering is as visible as a merge |
| 4 | MS-level exclusion | An excluded scan is `ExcludedByMsLevel`, never a zero **and never a coverage gap**, and a scan **declaring no level at all** is `MsLevelUndeclared`, which no inherited fixture carries — a candidate that guesses a level, drops the scan or returns zero must fail here. **Includes the overlapping case**: a scan that is both excluded and undecodable reports the earlier state in the stated order, so filter-first and decode-first candidates cannot disagree |
| 5 | Empty windows | `points_in_window: 0` with `sum: 0`, and no scan dropped from the result |
| 6 | Representative inputs for the proposed domain | **MS1** acquisitions, one profile and one centroided. PX.3 also **records observed wall time and peak memory** per candidate here — as observations attributed to their host and build, **never as thresholds** |
| 7 | Malformed and under-declared input | Truncated and invalid sources, a reversed window, a non-finite bound, **a source declaring no m/z-array unit, one with retention-time values but no retention-time unit, one declaring no intensity unit, and runs whose scans declare *differing* retention-time or intensity units** — the differing-unit runs must be **refused**; the retention-time and intensity omissions must be **preserved** rather than silently supplied, and no declared unit may be dropped; and **the missing m/z-array unit is scored against XIC-S2's decided answer: preserved as unreported**, PX.1 having closed that choice, so a candidate that refuses such a source now fails this subject rather than satisfying a branch. All of it is scored because these postures are otherwise provable only from an API surface this record refuses as evidence — **a non-finite intensity inside the window** — the case **XIC-S4** now answers as `NonFiniteIntensity` — and **finite intensities whose sum is not representable**, which must reach `SumNotRepresentable` rather than an infinite `sum`. Neither case is carried by any inherited fixture. **Exit code is never semantic evidence** |
| 8 | Reproducibility | Repeats of one invocation on one snapshot agree byte for byte |
| 9 | **Scan-identity reconciliation** | Index and id survive the MS-level operand — M5.4 measured a build that **renumbered** them under a filter — and an omitted scan stays distinguishable from one the run does not have. **A scan declaring no retention time is reported as a coverage gap, never omitted.** §1's identity, order and `Missing` all rest on this, so the matrix cannot decide without it |

**Two borrowings are forbidden by name.** The pinned representative acquisition
is **MS2-only** and is not MS1 evidence. A centroided acquisition is not profile
evidence. **Mathematical synthetic fixtures and representative acquisitions
answer different questions** and neither substitutes for the other: a synthetic
fixture establishes arithmetic, an acquisition establishes behaviour at scale.

**Identity is preserved on every result.** Source snapshot digest — **hashed
deliberately for an evidence run, as M5.4 did for all four of its sources, not
read from the product boundary, which takes no mzML digest** — plus provider
identity, an executable digest or a library version *and* build, and runtime,
recorded per result. **No result inherits another build's evidence.** Any new
representative acquisition needs its licence and provenance recorded before use;
no acquisition is downloaded unattended. **A truncated webview array, plot pixels,
a smoothed preview or rounded text is never the scientific source.**

## 4. The minimal runtime boundary

**Every reuse point below already exists.** This route adds no architecture.

| Reuse point | What is already there |
| --- | --- |
| Filesystem and process ownership | Rust owns both. The webview holds an opaque handle and a display name, **never an absolute path**, and never spawns a process |
| Retained full data and bounded reads | Rust retains the complete spectrum as the scientific source, with the scanner's existing bounded-read limits |
| Transfer bounds | A screen projection is a **drawing** bounded for a display; scientific export is a sibling projection taken from the complete arrays. An XIC result is a scientific result and carries its own bound, not the drawing's |
| Resource limits and cancellation | The conversion runner's ownership disposition and fail-closed cancellation are the precedent. **An XIC query is not a queue and must not become one** |
| Source identity | The per-operation revalidation the preview already performs against `FileIdentity` |
| Stale-reply rejection | [ADR 0044's](0044-conversion-configuration-authority.md) three-way split: an **identity** compared only for equality, an **ordering revision** where a lower value is stale and cannot replace a higher, and a **state** saying whether a verdict exists. An XIC query reuses that shape. What is refused is a bare counter whose meaning each caller supplies, not a monotonic token |

**Query identity is not freshness.** A query's identity is its operands —
snapshot identity, MS level, `low`, `high`, aggregation. Two queries with equal
operands are the same query. Freshness and order are the separate revision token.
**A scientific query changes its result only for its own operands.** Zoom and pan
may request a new display projection of a result that already exists; they do not
recompute the science and do not mint a new query.

**Refused outright**: a generic plugin ABI, a global scheduler, UI-owned process
spawning, silent fallback between providers, forced migration of an existing
runtime, and any new persistence model. Also unchanged and unnamed elsewhere
here: a backend is invoked through a **typed argv array, never a shell string**;
a rendered trace consumes the **shared semantic plot/figure specification**; and
a dependency needs approval **with a rationale**, not approval alone.
**Performance budgets are not invented here, and the question is not left
unowned either**: PX.3 records the observations on the representative inputs and
PX.4 judges practicality against them, so no slice inherits an unmeasured
threshold. Each budget is justified in the slice that measures it — and the
worked example is a warning rather than a precedent:
the selection timings sometimes reached for are **M0's**, recorded there as
advisory and never as thresholds. They are not M5's, and they are not an XIC
budget.

## 5. User and product handoff

**PX.6, if it is ever reached, delivers one minimal honest XIC interaction in the
existing surface.** It consumes one scientific result, and where it commits a
scan it goes through the **existing** selection-start authority —
`canStartSpectrumSelection`, from
[ADR 0041](0041-viewer-selection-availability.md). **It adds no second selection
authority.** Stated precisely, because ADR 0041 governs *committing a scan* and
deliberately decided nothing about XIC, and §1's query carries no scan operand at
all: any availability question an XIC raises is **PX.6's to answer inside that
one authority**, not something ADR 0041 has already answered.

**VIEW-007's acceptance row still governs what a user types.** It asks for typed
m/z and tolerance with explicit units and settings; §1 keeps `low` and `high` as
the only query operands and normalizes a centre-and-tolerance input to them at
the boundary. PX.6 therefore satisfies that row rather than quietly narrowing it,
and nothing here revises the feature contract.

**M7 owns the application shell**, motion, localization and overall layout, and
none of it is designed or reopened here. **The one placement question this route
does own is XIC-D5** — where the XIC is drawn and against which value axis —
because it is a property of the quantity rather than of the shell. ADR 0037
states that its runtime slice **cannot start until such decisions are
answered**, so XIC-D5 is settled after PX.4 and **before PX.5 is authorized** —
not inside the slice that renders.

**What was accepted of v5.11 is a
destination/conflict organization inside the existing conversion surface** — the
prototype explicitly does **not** authorize its shell, its simulated capabilities
or its style overrides, and nothing in this record promotes it to an approved
shell. The locked frontend stack is not reopened either. **M8 owns durable
artifact, run and lineage models. A reusable XIC artifact or export stays M9's**,
on M8 artifact identity, exactly as ADR 0042 routed it.

**A rejected or blocked route leaves an explicit unavailable state** — a stated
reason in the existing availability posture — **not a simulated trace**, not a
placeholder plot, and not an automatic broader research phase.

## 6. Bounded completion

**The initial matrix is finite and is the whole of it**: at most three candidate
directions, against the nine evidence subjects above, over the two pinned
fixtures, M5.4's two generated fixtures, and **generated fixtures carrying thirty
named cases none of the inherited four does, split so that no case masks
another**: the original fifteen cases below, plus fifteen incomplete-unit
derivatives named after them. PX.1 makes those invalid-input derivatives explicit
within subject 7; it adds no candidate direction or acquisition.
**The separately authorized PX.3 evaluation set is B only.** A remains viable,
not prototyped and not rejected, outside this set. This bounds this evaluation,
not the scientific input matrix or a production provider choice. It establishes
no superiority over A and does not exhaust A. The [PX.3 record](../../spikes/PX_3_XIC_COMPARATIVE_EVIDENCE.md)
reports its obtained results and explicit missing evidence; any separately authorized
PX.4 must consume that declared set rather than silently counting A as a failed
candidate. No PX.4 outcome is made here.

The unit-disagreement runs are refused whole by §1, so each needs its own file —
and **one per refusal condition, not one per axis**, because a file that refuses
the query proves only the condition it carries. That is **six**: for each of m/z,
retention time and intensity, one run with differing declared units and one where
a declared unit sits beside an undeclared one.
The **missing m/z-array unit** case needed its own file only while XIC-S2 might
have answered that such a source is refused. **PX.1 decided it is served**, so it
no longer refuses the query, no longer masks anything, and rejoins the shared
file. The remaining nine may share a file: a source declaring no m/z-array unit,
whose expected result is XIC-S2's decided answer; a non-finite intensity inside
the window; an extreme finite intensity whose final exact sum exceeds the chosen finite output range; a `NaN` in
the m/z array and an infinity outside the window, which must be told apart; an
**unsorted m/z array**, whose window sum must still be taken over the set; a
scan declaring no retention time; a scan declaring no MS level at all; a run
where **no** scan declares a retention-time unit; and one where **no** scan
declares an intensity unit. The two unit-absence cases are uniform deliberately:
a run mixing a declared unit with an undeclared one is refused, and each such
run has its own fixture above.

**Fifteen incomplete-unit derivatives, with a fixed refusal oracle.** For each
of the five variants below, derive one otherwise valid single-scan mzML copy
for each axis: **m/z, retention time and intensity**. Keep its array role, MS
level, RT value and numeric payload valid, and alter only the named unit
attributes on the selected axis. Each of the **five variants times three axes**
has its own file, so another invalid declaration or a mixed-unit run cannot
mask it. These are the additional fifteen named cases, making **thirty** with
the original fifteen. They are derived synthetic inputs, not new acquisitions.

| Variant | Source unit attributes on the selected axis | Expected result for each of the three axes |
| --- | --- | --- |
| Empty accession | Set `unitAccession=""`; retain the fixture's other unit attributes | Whole query refused for incomplete unit declaration; observed attribute presence and values retained |
| Whitespace accession | Set `unitAccession=" "`; retain the other unit attributes | Same refusal and retention |
| Name without accession | Remove `unitAccession` and `unitCvRef`; retain `unitName` | Same refusal and retention |
| CV reference without accession | Remove `unitAccession` and `unitName`; retain `unitCvRef` | Same refusal and retention |
| Name and CV reference without accession | Remove `unitAccession`; retain both `unitName` and `unitCvRef` | Same refusal and retention |

For every row, a served result labelled unreported, a measured zero, or a silent
partial success **fails subject 7**. The original genuinely undeclared m/z case
remains served-as-unreported; it is not one of these invalid declarations. No
fixture is generated or executed by PX.1.

**Plus other truncated and invalid copies derived from those fixtures**, which
subject 7 scores **for honesty rather than for shape**: for truncation the oracle
is that a candidate
**does not present a truncated read as a complete result**, which a whole-query
refusal and a typed partial carrying coverage both satisfy and a silent prefix
fails. This does not replace the stricter explicit refusal oracle for the
incomplete-unit derivatives above. That is decidable before PX.3's first scored run and does **not**
pre-empt the typed partial contract, which stays PX.5's. Derived rather than newly
acquired, so the set stays closed. **And at most two** new representative
acquisitions — one MS1 profile, one MS1 centroided — each subject to a recorded
permission decision **owned by the repository owner**.

**The decision checkpoint is PX.4.** Missing permissions or data, and failed
candidates, produce a **recorded answer with a next owner**. They do not cause
unattended acquisition downloads, additional candidates, or numeric thresholds
made more permissive until something passes. **Any investigation beyond this
matrix requires a new scope decision** — a new record, not an amendment to this
one. **No conceivable XIC functionality is a prerequisite for M7.**

## The slice route

One table, and it is the owner of these dependencies. Other documents link here
rather than restating them.

| Slice | Question | Output | Prerequisites | Allowed writes | Acceptance evidence | Stopping conditions |
| --- | --- | --- | --- | --- | --- | --- |
| **PX.0** route lock | What is the bounded route, and what decides it? | This record | `M6 COMPLETE`, plus explicit entry authorization | Markdown only | The six subjects answered once each; the route and outcome branches consistent with this table | Complete on publication. It admits nothing |
| **PX.1** provider / API audit | Which of the at most three directions is viable enough to prototype? | A viability finding per direction, with licence, maintenance, API surface and numeric contract; **XIC-S2** decided | PX.0 | Markdown; no dependency added | Each direction reaches viable or not-viable with a located reason. A shortlist name alone is never a finding | Zero viable directions ends the interlude at PX.4 as `XIC_PROVIDER_REFUSED`. A viable direction does **not** authorize PX.2 by itself |
| **PX.2** bounded prototypes | Can a viable direction express the query of §1 at all? | A throwaway prototype per selected direction, outside the product | PX.1 viability, **and its own authorization** — needed even for a direction requiring no install; plus explicit approval for any install | Prototype code outside the shipped product; Markdown | The prototype computes the §1 query on a fixture whose oracle already exists | A prototype that cannot express the query stops that direction; every direction stopping here reaches PX.4 directly. **Compiling is not evidence** |
| **PX.3** comparative evidence | What does each prototype actually measure, against an independent oracle? | The completed evidence matrix, per direction | PX.2; the oracle established first; fixture permissions recorded | Markdown; evidence files | Every cell is a located result or an explicit not-applicable with its reason | A missing permission or absent representative input is recorded as such and routes PX.4 to `EVIDENCE_BLOCKED` |
| **PX.4** provider / runtime decision | Which one of the four outcomes does the evidence support? | One terminal outcome, with the semantics and evidence it rests on — and on the admitted branch, **the one candidate it names**. **Ordered, and an empty set means different things at each step.** First, if the matrix could not be completed for want of evidence, the outcome is `EVIDENCE_BLOCKED`. Otherwise, if PX.3 left no numerically correct candidate — including every direction exhausted earlier — it is `XIC_PROVIDER_REFUSED`. Then apply practicality: if that leaves none, still `XIC_PROVIDER_REFUSED`, because those candidates were measured and found wanting. **Only then**, with at least one correct and practical candidate in hand, keep those whose **runtime placement is settled**; **if that leaves none, the outcome is `ARCHITECTURE_DECISION_REQUIRED`**, which is otherwise unreachable. An unsettled candidate beside a settled one is simply not a contender, and does not block the settled one. Then, among the survivors that remain, exactly one means admission is evidence-determined, and two or more means PX.4 pauses for a **recorded XIC-D4 governance decision naming one** and consumes it, because no amount of evidence determines a governance choice | PX.3 complete over the finite matrix; **or, for the separately owner-authorized B-only evaluation, a published terminal PX.3 evidence-gap handoff naming the required missing input, permission or independent reference and its owner**, as §3/§6 already route and that task's authorization explicitly requires. This is not full-matrix completion or PASS; a **separately authorized PX.4** may consume it through the existing missing-evidence-first decision order, without counting A as failed. **Or** every direction already exhausted in PX.1 or PX.2 — **early exhaustion reaches PX.4 directly**, and the matrix is then empty by record rather than unfinished. PX.3's survivors are the numerically correct candidates; **practicality is PX.4's own first step**, not a PX.3 filter and not an entry condition | Markdown | The outcome is derivable from what the earlier slices recorded by a reader who re-checks it — and, on a multi-candidate admitted branch, from the recorded XIC-D4 decision it consumed | **Every outcome is terminal for PX.4** — it is the interlude's one decision and is not retaken. Three of the four also end the interlude; `XIC_PROVIDER_ADMITTED` ends the decision and leaves the conditional implementation branch open, which PX.5 may enter only under its own authorization. **None of them revokes `M6 COMPLETE`** |
| **PX.5** runtime, **only if admitted** | What is the minimal runtime that serves one query inside the existing boundary? | A narrow typed operation behind the existing boundary, **and the gap-aware representation §1 requires of the shared semantic specification** | `XIC_PROVIDER_ADMITTED`, **and XIC-D5 answered**, **and its own authorization** | Rust, types, tests, under the §4 boundary | The boundary rules of §4 hold, proved rather than asserted. **The gap-aware representation exists and is tested here**, because PX.6 may write only frontend, tests and rendered validation and so cannot add it later, and without it a trace is drawn across a coverage gap. **And the partial question is answered here rather than improvised later**, exactly as [ADR 0037](0037-viewer-completion-route.md) assigns it to the runtime slice: establish whether the admitted source can return a partial or truncated result at all, and if it can, carry **typed coverage and completeness facts**; otherwise **refuse partial output rather than present it as a complete success** | Does **not** run merely because PX.4 admitted. No plugin ABI, no scheduler, no persistence |
| **PX.6** minimal visible XIC, **only if admitted** | What is the smallest honest visible interaction over one result? | One interaction in the existing surface | PX.5 published, **and its own authorization** | Frontend, tests, rendered validation | **[ADR 0037's visible-XIC obligations, carried by citation and not replaced](0037-viewer-completion-route.md)**: keyboard equivalence for the input and the trace, and rendered evidence at all three viewports for an invalid draft, loading, a successful trace, a successful empty result, a retryable error, a retry, a superseded request, and linked selection unavailable — **plus disclosure of any coverage gap the result carries**, so a trace missing points is never shown as a complete success. This table owns the route's dependencies, **not** the rendered-validation obligations, which stay where they were written | Does **not** run merely because PX.5 passed. No layout redesign; M7 still owns the shell |

## PX.4's four outcomes, and what each permits

The vocabulary is [ADR 0043's](0043-conversion-completion-route.md) and is not
extended here. **A route lock is none of them.**

| Outcome | What it establishes | What it permits next | What it does not do |
| --- | --- | --- | --- |
| `XIC_PROVIDER_ADMITTED` | **Exactly one named candidate** has **implementable semantics and evidence for the actual source domain** — not merely a promising API or a successful compilation. **It must also be practical at the scale PX.3 observed**, judged against those observations rather than a number invented earlier. **Where two or more candidates survive *both* filters below — practicality and settled runtime placement — [ADR 0037's XIC-D4 rule](0037-viewer-completion-route.md) applies unchanged**: one such survivor is evidence-determined, two or more is `USER_DECISION_REQUIRED` and **governance chooses**. The count is taken over that filtered set and never over PX.3's unfiltered survivors, or one body of evidence would support two mutually exclusive outcomes. Neither PX.4 nor PX.5 picks between viable candidates on its own | PX.5 may be *authorized* against **that named candidate**; PX.6 only after PX.5 is published and separately authorized | Does not implement anything, and does not itself authorize PX.5 |
| `XIC_PROVIDER_REFUSED` | No candidate in the matrix serves the §1 query, with the located reason. **This is also where a measured-and-impractical candidate lands** — numerically correct, and too slow or too large at the observed scale. Its evidence was obtained, so it is not `EVIDENCE_BLOCKED`, and its runtime placement is not the open question, so it is not `ARCHITECTURE_DECISION_REQUIRED` | **M7 proceeds under an explicit recorded handoff.** XIC stays unavailable with a stated reason | Does not start a replacement-provider search, and does not revoke `M6 COMPLETE` |
| `EVIDENCE_BLOCKED` | The question could not be decided on obtainable evidence — typically a fixture permission or an absent representative acquisition, named exactly, with its owner | **M7 proceeds.** Re-entry is a new scope decision naming the missing input | No PX.5, no PX.6, no unattended acquisition, no relaxed threshold |
| `ARCHITECTURE_DECISION_REQUIRED` | A candidate is scientifically viable but its runtime placement is an architecture question this interlude may not settle alone | A named architecture decision in its own record. **M7 proceeds** meanwhile | No PX.5 and no PX.6. **Terminal, and it ends the interlude like the other two non-admission outcomes**: the architecture record may authorize a fresh slice, and it does not resume PX.5, which takes `XIC_PROVIDER_ADMITTED` and nothing else |

**All four are handoff exits.** Rejection, missing evidence and an unresolved
architecture decision each end with a next owner rather than another search.

## What this record does not create

No XIC. No selected provider. No runtime. No new milestone numbering — the
provisional PX vocabulary is retained and its dependencies refined. No new
ledger, specification or skill. No performance, admission or
scientific-correctness claim of any kind.

**M6's published results are carried unchanged**: the CNV-D2 source-domain
qualification, the typed conversion intent, the output-only validation limit, the
five per-item judgements, explicit adoption, M6.8's runtime, type and policy
distinctions, and all four dispositions of
[M6.10's ledger](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#the-terminal-ledger),
which stays their sole authority. This record changes no M6 exit criterion.

## Residual carried into this route

| Residual | Scope and evidence | Owner | Why it does not defeat this route |
| --- | --- | --- | --- |
| `ConversionPanel.test.tsx` — *restores Convert focus even when the plan is momentarily gone* — fails intermittently | Tracked in [issue #112](https://github.com/MianliWang/MScanvas/issues/112), which holds the run, attempt and assertion identities. **Root cause undetermined** | The first production UI/integration slice that touches `ConversionPanel` or its focus-restoration path, expected in **M7** | It is a frontend residual with an owner. A flaky test does not reopen a published milestone, and this route writes no code |
