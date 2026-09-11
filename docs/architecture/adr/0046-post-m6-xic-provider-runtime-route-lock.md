# ADR 0046 — Post-M6 XIC Provider / Runtime Interlude route lock (PX.0)

Status: **accepted. `PX.0 COMPLETE`.**
Date: 2026-09-11
Related: [0045](0045-conversion-completion-closure-and-handoff.md),
[0043](0043-conversion-completion-route.md),
[0042](0042-viewer-completion-closure-and-handoff.md),
[0044](0044-conversion-configuration-authority.md),
[0041](0041-viewer-selection-availability.md),
[0038](0038-spectrum-viewport-authority-and-screen-projection.md),
[0037](0037-viewer-completion-route.md),
[0005](0005-mzml-preview-boundary.md)

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
at ProteoWizard revision `47b13cf`, with a second build-specific abort recorded
beside it, and the spike found no precision control anywhere in the installed
help. An extracted-ion chromatogram remains a legitimate scientific quantity.
Whether *another* provider or a different runtime can serve it at the precision
required is a question worth asking once, in its own place.

This interlude is a **small bridge to the approved frontend work**, not a new
analysis platform and not an open research programme. It answers six subjects
once each, and stops.

## 1. The first useful scientific scope

**Start from the admitted boundary and widen nothing.** The source is a local
mzML file the session has already admitted and can already preview under
[ADR 0005](0005-mzml-preview-boundary.md). **Direct vendor preview is not
reopened** — it is M6.10's route 2, disposed `EVIDENCE_BLOCKED` — and **no RAW
family is added**. The proposed first query is one closed m/z window, at one MS
level, over one snapshot, aggregated one way.

| Semantic | The proposal |
| --- | --- |
| Source snapshot identity | The dataset identity the session already resolves — `FileIdentity` (volume serial plus the whole Windows file ID) and the content digest. A result names the snapshot it ran on; a changed identity invalidates the result rather than silently re-running it |
| Scan identity and order | The source's own `index` and `id`, in **source order**. Retention time is never the key: M5.4 measured two spectra sharing one retention time and kept them as two rows, with `rt` reading non-monotonically |
| MS-level selection | Exactly one MS level, stated as an operand. There is no implicit "all levels", and no default |
| m/z bounds and endpoint policy | A closed interval `[low, high]`, **both endpoints inclusive**, compared against the source's stored values without rounding. `low == high` is a legal zero-width window. `low > high` is a **refusal**, never an empty result — M5.4 measured a reversed window exiting `0` with no output, which is the failure this policy forbids |
| Units | The unit the source declares for its m/z array. Where the source declares none the window is expressed in the source's own numeric domain and the result carries that as unreported, exactly as the viewer's existing unit posture does. **No ppm and no centre-plus-radius form in the first scope** |
| Aggregation | The **sum** of the intensities of source points whose m/z lies in the closed window, per scan. Nothing else. Not a baseline correction, not an interpolated apex, not a fitted peak |
| Retention-time association | Each result point carries its scan's declared retention time as an **attribute of the scan**, never as an identity or an ordering key |
| Duplicate retention times | Preserved as separate result points in source order. Never merged, never summed together, never reordered |

**A measured zero is not any other answer.** Per scan the result is exactly one
of six states, and the first of them carries a point count so that two different
zeros stay different:

| State | What it means |
| --- | --- |
| `Measured { sum, points_in_window }` | The scan was read and the window evaluated. `sum` may be `0`; `points_in_window` may be `0`. These are measurements |
| `ExcludedByMsLevel` | The scan exists and the query's own MS-level operand filtered it out |
| `NoMzDomain` | The scan carries no authoritative finite forward m/z domain. The existing projection rule already refuses one rather than inventing endpoints, and this state carries that refusal instead of reporting a sum |
| `Unreadable` | The scan's arrays are present and could not be decoded |
| `Missing` | The run's index declares the scan and the reader could not obtain it at all |
| `Absent` | The run's index does not declare the scan. Reachable only where a caller names an index; an enumeration over the run never produces it |

**Profile and centroided data are both in scope, and the quantity is named
honestly for each.** The aggregation is the same in both: a sum of in-window
point intensities. Over centroided data that is a sum of peak intensities. Over
profile data it is a **point sum and not an integrated peak area**, and no
surface, wire field or document may call it one. **Nothing centroids silently** —
that is a standing product rule, not a new one. Where the source declares
neither acquisition mode the result reports the declaration as unreported and the
quantity keeps its name.

**Two scientific choices are open, and each has a named decision owner.** They
are not an implementer's to guess:

| | Open choice | Decision owner |
| --- | --- | --- |
| **XIC-S1** | Whether a profile source's point sum is offered at all in the first scope, or withheld pending an integration semantics. PX.2 may compute one, labelled a point sum | **PX.4**, on PX.3's profile evidence. Blocks PX.6 |
| **XIC-S2** | The unit posture where a source declares no m/z unit — reported as unreported, or the source refused for this query | **PX.1**, because it is a property of what a reader exposes. Blocks PX.3's oracle |

## 2. Bounded candidate directions

**At most three architectural approaches, not a catalogue of MS libraries.**
Unused slots stay unused; none of the three is required to survive PX.1.

| | Direction | What it is, and what it is not |
| --- | --- | --- |
| **A** | A corrected or differently-versioned ProteoWizard interface | A *different measured executable identity*, or a ProteoWizard interface that does not serialize through the passive analyzers. The four-decimal defect is a source-level literal, so a candidate here must be a build or an interface where that is not the path a value takes |
| **B** | A mature reader or API behind a local worker | Maintained, lawfully licensed, run in a project-owned worker under Rust's existing process and filesystem ownership. A name in a shortlist is **not** proof of compatibility or admission: PX.1 establishes licence, maintenance, API surface and numeric contract before any name is carried forward |
| **C** | Minimal aggregation over a lawful full-data source the project already reads | A narrow, project-owned per-scan window sum over mzML arrays this product already reads. **Not** permission to reimplement a proprietary reader, and not a general analysis engine |

**The refused `msaccess` binary is a control, not a contender.** Its identity is
pinned by M5.4's re-entry gate and was re-observed unchanged by M6.10. It is
carried as a historical counterexample and is not rerun until it passes.
**A different executable inherits its result in neither direction**: a new build
is neither admitted for resembling a measured one nor refused for sharing its
name.

PX.1 selects viable candidates and PX.2 prototypes only those. **Installing a new
dependency or a provider still requires explicit approval inside the slice that
needs it**, under the standing dependency policy.

## 3. Evidence that can actually decide

**M5.4's defects and re-entry requirements are carried by citation, not
retold** — the low-positive/zero serialization problem, the window failure,
and the aggregation and scan-identity questions all live in
[the spike](../../spikes/M5_XIC_SOURCE_EVIDENCE.md), whose dimension vocabulary
is [ADR 0037's](0037-viewer-completion-route.md#m54-candidate-evidence-dimensions)
and is validator-held.

**The oracle is established before a candidate runs.** It is either a fixture
whose arrays are known by construction, with its expected window sum derived
independently of every candidate, or a representative acquisition with an
independently derived reference. **A candidate agreeing with itself is not a
reference**, and two candidates agreeing is corroboration rather than an oracle.

The finite future matrix covers these subjects and no others:

| | Subject | What it has to discriminate |
| --- | --- | --- |
| 1 | Window endpoints | A point exactly at `low` and one exactly at `high` are both in |
| 2 | Fractional and low intensities | A positive sum below the candidate's representation or serialization resolution stays distinguishable from zero. This is the requirement M5.4's measured build failed |
| 3 | Duplicate retention times | Two scans at one time stay two result points with their own sums |
| 4 | MS-level exclusion | An excluded scan is `ExcludedByMsLevel`, never a zero |
| 5 | Empty windows | `points_in_window: 0` with `sum: 0`, and no scan dropped from the result |
| 6 | Representative inputs for the proposed domain | **MS1** acquisitions, one profile and one centroided |
| 7 | Malformed input | Truncated and invalid sources, a reversed window, a non-finite bound. **Exit code is never semantic evidence** |
| 8 | Reproducibility | Repeats of one invocation on one snapshot agree byte for byte |

**Two borrowings are forbidden by name.** The pinned representative acquisition
is **MS2-only** and is not MS1 evidence. A centroided acquisition is not profile
evidence. **Mathematical synthetic fixtures and representative acquisitions
answer different questions** and neither substitutes for the other: a synthetic
fixture establishes arithmetic, an acquisition establishes behaviour at scale.

**Identity is preserved on every result.** Source snapshot digest, provider
identity — an executable digest, or a library version *and* build — and runtime,
recorded per result. **No result inherits another build's evidence.** Any new
representative acquisition needs its licence and provenance recorded before use;
no acquisition is downloaded unattended. **A truncated webview array, plot pixels,
a smoothed preview or rounded text is never the scientific source.**

## 4. The minimal runtime boundary

**Every reuse point below already exists.** This route adds no architecture.

| Reuse point | What is already there |
| --- | --- |
| Filesystem and process ownership | Rust owns both. The webview holds an opaque handle and a display name, never a path, and never spawns a process |
| Retained full data and bounded reads | Rust retains the complete spectrum as the scientific source, with the scanner's existing bounded-read limits |
| Transfer bounds | A screen projection is a **drawing** bounded for a display; scientific export is a sibling projection taken from the complete arrays. An XIC result is a scientific result and carries its own bound, not the drawing's |
| Resource limits and cancellation | The conversion runner's ownership disposition and fail-closed cancellation are the precedent. **An XIC query is not a queue and must not become one** |
| Source identity | The per-operation revalidation the preview already performs against `FileIdentity` |
| Stale-reply rejection | [ADR 0044's](0044-conversion-configuration-authority.md) three-way split: an **identity** compared only for equality, an **ordering revision** where a lower value is stale and cannot replace a higher, and a **state** saying whether a verdict exists. An XIC query reuses that shape rather than a counter |

**Query identity is not freshness.** A query's identity is its operands —
snapshot identity, MS level, `low`, `high`, aggregation. Two queries with equal
operands are the same query. Freshness and order are the separate revision token.
**A scientific query changes its result only for its own operands.** Zoom and pan
may request a new display projection of a result that already exists; they do not
recompute the science and do not mint a new query.

**Refused outright**: a generic plugin ABI, a global scheduler, UI-owned process
spawning, silent fallback between providers, forced migration of an existing
runtime, and any new persistence model. **Performance budgets are not invented
here.** Each is justified in the slice that measures it; M5's recorded selection
timings are M5's and are not an XIC budget.

## 5. User and product handoff

**PX.6, if it is ever reached, delivers one minimal honest XIC interaction in the
existing surface.** It consumes one scientific result and the **existing**
scan-selection authority from [ADR 0041](0041-viewer-selection-availability.md).
It adds no selection authority and no second availability rule.

**M7 owns the approved v5.11-style shell**, motion, grouped dragging,
localization and overall layout. None of that is redesigned here, and the
completed frontend-stack preflight is not restarted. **M8 owns durable artifact,
run and lineage models. A reusable XIC artifact or export stays M9's**, on M8
artifact identity, exactly as ADR 0042 routed it.

**A rejected or blocked route leaves an explicit unavailable state** — a stated
reason in the existing availability posture — **not a simulated trace**, not a
placeholder plot, and not an automatic broader research phase.

## 6. Bounded completion

**The initial matrix is finite and is the whole of it**: at most three candidate
directions, against the eight evidence subjects above, over the two pinned
fixtures, M5.4's two generated fixtures, and **at most two** new representative
acquisitions — one MS1 profile, one MS1 centroided — each subject to a recorded
permission decision.

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
| **PX.2** bounded prototypes | Can a viable direction express the query of §1 at all? | A throwaway prototype per selected direction, outside the product | PX.1 viability; explicit approval for any install | Prototype code outside the shipped product; Markdown | The prototype computes the §1 query on a fixture whose oracle already exists | A prototype that cannot express the query stops that direction. **Compiling is not evidence** |
| **PX.3** comparative evidence | What does each prototype actually measure, against an independent oracle? | The completed evidence matrix, per direction | PX.2; the oracle established first; fixture permissions recorded | Markdown; evidence files | Every cell is a located result or an explicit not-applicable with its reason | A missing permission or absent representative input is recorded as such and routes PX.4 to `EVIDENCE_BLOCKED` |
| **PX.4** provider / runtime decision | Which one of the four outcomes does the evidence support? | One terminal outcome, with the semantics and evidence it rests on | PX.3 complete over the finite matrix | Markdown | The outcome is derivable from the matrix by a reader who re-checks it | Every outcome is terminal for this interlude. **None of them revokes `M6 COMPLETE`** |
| **PX.5** runtime, **only if admitted** | What is the minimal runtime that serves one query inside the existing boundary? | A narrow typed operation behind the existing boundary | `XIC_PROVIDER_ADMITTED`, **and its own authorization** | Rust, types, tests, under the §4 boundary | The boundary rules of §4 hold, proved rather than asserted | Does **not** run merely because PX.4 admitted. No plugin ABI, no scheduler, no persistence |
| **PX.6** minimal visible XIC, **only if admitted** | What is the smallest honest visible interaction over one result? | One interaction in the existing surface | PX.5 published, **and its own authorization** | Frontend, tests, rendered validation | Rendered validation of the real interaction, including its unavailable state | Does **not** run merely because PX.5 passed. No layout redesign; M7 still owns the shell |

## PX.4's four outcomes, and what each permits

The vocabulary is [ADR 0043's](0043-conversion-completion-route.md) and is not
extended here. **A route lock is none of them.**

| Outcome | What it establishes | What it permits next | What it does not do |
| --- | --- | --- | --- |
| `XIC_PROVIDER_ADMITTED` | A candidate has **implementable semantics and evidence for the actual source domain** — not merely a promising API or a successful compilation | PX.5 may be *authorized*; PX.6 only after PX.5 is published and separately authorized | Does not implement anything, and does not itself authorize PX.5 |
| `XIC_PROVIDER_REFUSED` | No candidate in the matrix serves the §1 query at the required fidelity, with the located reason | **M7 proceeds under an explicit recorded handoff.** XIC stays unavailable with a stated reason | Does not start a replacement-provider search, and does not revoke `M6 COMPLETE` |
| `EVIDENCE_BLOCKED` | The question could not be decided on obtainable evidence — typically a fixture permission or an absent representative acquisition, named exactly, with its owner | **M7 proceeds.** Re-entry is a new scope decision naming the missing input | No PX.5, no PX.6, no unattended acquisition, no relaxed threshold |
| `ARCHITECTURE_DECISION_REQUIRED` | A candidate is scientifically viable but its runtime placement is an architecture question this interlude may not settle alone | A named architecture decision in its own record. **M7 proceeds** meanwhile | No PX.5 and no PX.6 until that decision exists |

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
distinctions, and all four of M6.10's dispositions. This record changes no M6
exit criterion.

## Residual carried into this route

| Residual | Scope and evidence | Owner | Why it does not defeat this route |
| --- | --- | --- | --- |
| `ConversionPanel.test.tsx` — *restores Convert focus even when the plan is momentarily gone* — fails intermittently | Tracked in [issue #112](https://github.com/MianliWang/MScanvas/issues/112), which holds the run, attempt and assertion identities. **Root cause undetermined** | The first production UI/integration slice that touches `ConversionPanel` or its focus-restoration path, expected in **M7** | It is a frontend residual with an owner. A flaky test does not reopen a published milestone, and this route writes no code |
