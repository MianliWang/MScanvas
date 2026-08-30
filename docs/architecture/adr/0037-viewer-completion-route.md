# ADR 0037 — Viewer Completion is the next milestone, and this is its route

Status: accepted, amended 2026-08-30

**Route fulfilled, with one criterion narrowed at closure.** M5 is complete on
the `XIC_SOURCE_REFUSED` branch. Criterion 5 carries a named exception for the
conversion lane's dispatch race, added by M5.8 and stated where the criteria are;
it is a narrowing, not a reading this document always had. The closure record is
[ADR 0042](0042-viewer-completion-closure-and-handoff.md) -- which answers the
exit criteria below, closes criteria 3 and 4 as evidence-gated, and names an
owner for everything deferred. This document remains the route-lock and history
authority and is **not** rewritten as though the outcome had always been known.

Amended by M5.4's measurement in two places, both in
[XIC-D4](#xic-d4--which-query-is-the-source): D4 is `USER_DECISION_REQUIRED` only
where the evidence admits **two or more** sources, and scientific evidence is
bound to an exact executable identity rather than to a help text. M5.4 measured
zero admissible sources, so the route outcome is `XIC_SOURCE_REFUSED`.
Date: 2026-08-27
Related: [0003](0003-msaccess-preview-spike.md),
[0028](0028-figure-renderer-and-semantic-specification.md),
[0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0032](0032-viewer-interaction-and-viewport-state.md),
[0033](0033-visible-linked-tic-bpc-viewer.md),
[0034](0034-chromatogram-export-and-range-scope.md),
[0036](0036-linked-chromatogram-spectrum-figure.md)

## What this ADR is, and what it is not

It is a route lock. M4 closed with the linked two-panel figure, and the sequence
that followed M4 in `ROADMAP.md` was written before the viewer existed: it sent
the project from figure export straight to public-beta hardening, then to an
artifact model, while the scientific viewing workflow those milestones would be
hardening and persisting was still missing several of its own capabilities.

This ADR replaces that sequence with the product priority, records the live gap
audit the priority was decided from, and fixes the exact slice route for M5.

**It implements nothing.** No Rust behaviour, no React behaviour, no backend
operation, no reducer, no export, no dependency and no lockfile changes with it.
Every classification below is taken from the code and the measured evidence in
this repository rather than from what the previous roadmap said.

## The sequence

| | Milestone | Why here |
|---|---|---|
| M5 | Viewer Completion | The mzML viewing workflow is the product's first real answer, and it is incomplete in ways a reader meets in normal use. |
| M6 | Conversion Completion | Conversion is reachable and bounded. Widening it is worth doing against a viewer that can inspect what it produced. |
| M7 | UI/UX + Public Product Hardening | Consolidation and redesign come after the surfaces exist, not between them. |
| M8 | Artifact / Run / QC Foundation | Persistence and lineage are worth building for a product whose capabilities have stopped moving. |
| M9 | Analysis Recipes | Needs the artifact model beneath it. |
| M10 | Automation / CLI / MCP | Needs stable schemas from everything above. |

M0 to M4 are unchanged in meaning and stay closed. The former M5 to M8 had not
started; their content moves, and where it moves is recorded in
[`ROADMAP.md`](../../../ROADMAP.md).

This is not a reversal. M4.4's own handoff already said it — *the next planning
priority is viewer completion first, conversion completion second, and then
broader UI/UX and product hardening*
([ADR 0036](0036-linked-chromatogram-spectrum-figure.md)) — while `ROADMAP.md`
still sent the project somewhere else. This ADR is where the two stop
disagreeing.

**Reading a milestone number written before this ADR.** Historical ADRs are not
edited to follow a renumbering; they said what was true when they were written.
A future-milestone number in one of them resolves through this table:

| Written as | Now |
| --- | --- |
| M5 — public beta hardening | M7, except the viewer selection-availability affordance, which is M5.7 |
| M6 — artifact and QC foundation | M8 |
| M7 — first analysis recipes | M9 |
| M8 — automation | M10 |

## The live viewer gap audit

Read from the implementation. Every row cites what was inspected.

### Spectrum zoom, pan and reset — REQUIRED_FOR_M5, where a domain is admissible

[`StickSpectrum.tsx`](../../../apps/desktop/src/features/mzml-preview/StickSpectrum.tsx)
is a pure function of the transferred `mz` and `intensity` arrays and the
backend's reported `mzLow`/`mzHigh`. It recomputes `domainLow` and `domainHigh`
from those inputs on every render and holds no state at all. There is no m/z
viewport anywhere in the application: `ViewerInteractionState` in
[`interactionState.ts`](../../../apps/desktop/src/features/mzml-preview/viewer/interactionState.ts)
carries exactly one `fullDomain` and one `committedDomain`, both of type
`RetentionTimeDomain`.

So the selected spectrum is a drawing with no viewport, in a viewer whose other
panel has a fully specified one. That is the largest remaining gap in the
viewing workflow, and it is the one every other M5 capability is measured
against.

**Required does not mean universal.** A viewport needs an authoritative finite
forward m/z domain, and the scientific contract cannot always establish one:
`SeriesSpec::new` answers a non-ascending `x` with `SpecError::SourceNotOrdered`,
which mzML permits and nothing here sorts. That spectrum is valid source data and
has no viewport, and M5 delivers the refusal rather than a domain it had to
invent.

**And a domain needs something to draw.** `MAX_SPECTRUM_POINTS` bounds one
transfer, so a large spectrum reaches the webview as a prefix marked `truncated`
— which means a viewport spanning the complete source would pan into blank space
over peaks Rust is holding. So M5.1 owns a second contract beside the domain: a
bounded, viewport-scoped **screen projection** taken from the complete retained
snapshot. See M5.1.

### Selected-spectrum `Current range` export — REQUIRED_FOR_M5, and doubly dependent

`spectrum_panel` in
[`export.rs`](../../../apps/desktop/src-tauri/src/preview/export.rs) builds one
series at `DataScope::FullSource` and takes the panel's domain from the points
themselves. It never calls `with_visible_domain`. `RangeRequest` and
`ResolvedRange` in
[`chromatogram.rs`](../../../apps/desktop/src-tauri/src/preview/chromatogram.rs)
exist for the chromatogram alone and carry a retention-time `Domain`; no
spectrum command accepts a range argument.

The mechanism is already proved for the other axis. `chromatogram_panel` keeps
the source series complete and declares `with_visible_domain` plus
`with_visible_value_domain` for a current range, while the data document filters
records. A selected-spectrum current-range export is that same shape over m/z —
**and it has no authority to read.** `ViewerInteractionState.committedDomain` is
what the chromatogram's `Current range` consumes; the spectrum has no
equivalent, so there is nothing for a range chooser on that surface to mean.

This is why the route puts the viewport first. Inventing a `Current` scope for
the spectrum before a committed m/z viewport exists would mean inventing what
"current" refers to, which is the mistake ADR 0032 was written after.

And it depends on the viewport twice over: on the viewport being **built**, which
is M5.1 and M5.2, and on one being **available for this spectrum**, which the
scientific contract decides per spectrum. Where no domain is admissible there is
no committed viewport, so there is no `Current` scope — while the full-source
CSV and TSV that spectrum already exports are untouched, because a data document
is one record per retained source point in source order and needs no ordering.

### XIC (VIEW-007) — REQUIRED_FOR_M5, behind an evidence gate

The audit found more than the roadmap did, and also less.

**More.** `PreviewOperation::Tic { ms_level }` already exists in
[`command.rs`](../../../crates/proteowizard/src/command.rs), is capability-gated
in [`capability.rs`](../../../crates/proteowizard/src/capability.rs) and is
parsed by `parse_tic` in
[`preview.rs`](../../../crates/proteowizard/src/preview.rs) into a `TicResult`
of per-scan points, each carrying a `SpectrumIdentity`, an MS level, a retention
time and a summed intensity. The signature that gate requires is:

```text
tic [mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]
```

That `mz=` window is an extracted-ion chromatogram computed by the backend from
the file. It is not a projection of anything the webview holds. Separately,
[`docs/spikes/M0_PROTEOWIZARD_SPIKE.md`](../../spikes/M0_PROTEOWIZARD_SPIKE.md)
records that the installed `msaccess` help declared a `sic` query alongside
`tic` — a second candidate source.

**Less.** None of that is live, and none of it has been run as an XIC.
`open_operations()` in
[`backend.rs`](../../../apps/desktop/src-tauri/src/preview/backend.rs) returns
`Metadata`, `RunSummary` and `SpectrumTable`, and nothing else in this product
issues a `Tic` operation — which is why
[`chromatogram.rs`](../../../apps/desktop/src-tauri/src/preview/chromatogram.rs)
says so in its own header. `PreviewOperation::Tic` carries no `mz` field, and
`analysis_command()` emits the literal `tic delimiter=tab`, so no m/z window can
reach the backend today. `sic` has never been captured in this repository: no
signature constant, no capability requirement, no parser, no measurement.

The M0 spike measured an unfiltered TIC and an `msLevel 2` filtered TIC on a
four-spectrum synthetic fixture and rated both **B** — derived summed intensity,
index-ordered, one tiny `en-US` file. It measured **no** m/z-windowed query at
all, on any file.

So the source exists in the sense that a real one is plausibly reachable, and
does not exist in the sense that anything here has proved it. **The route
therefore puts a dedicated evidence slice before any XIC production work**, and
records the two alternatives it refuses.

**Not derived from the loaded table.** `SpectrumRow` carries a base peak m/z, a
base peak intensity, a total ion current and a precursor m/z per scan. That is
enough to *look* like an XIC and is not one: selecting the scans whose base peak
happens to fall inside a window, at their base peak intensity, silently returns
zero for every scan that has plenty of signal in the window but a taller peak
somewhere else. It would be at its most wrong exactly where an analyst is
looking — a co-eluting ion that is never the base peak. An XIC needs intensity
*as a function of m/z* inside each scan, and no per-scan summary is that.

**Not derived by re-reading the run.** The only route to real m/z-resolved data
short of a new operation is the `binary` query. This repository's typed
`SpectrumByIndex` asks for one index, so extracting an ion that way is 36,319
backend processes for the measured representative acquisition. The backend's
declared grammar does carry a range form —
`index=<spectrumIndexLow>[,<spectrumIndexHigh>]` — which nothing here has ever
issued or measured, and it refuses itself on size rather than on effort: one
operation's output is bounded at `MAX_PREVIEW_TEXT_BYTES`, 8 MiB, and **refused
whole rather than interpreted in part** above it, while a whole run's binary at
the precision of 8 this product requests is orders of magnitude past that.

Either shape also puts the extraction in the webview, which the repository's own
rule forbids without qualification: *large scientific arrays must not be copied
repeatedly through React state* ([`AGENTS.md`](../../../AGENTS.md)). That is not
an implementation of this feature but a different and much worse one.

### XIC linked selection — REQUIRED_FOR_M5 where XIC is admitted, with no new authority

Classified together with XIC and gated the same way: this exists only if there is
an XIC to link, so on `XIC_SOURCE_REFUSED` it is `NOT_APPLICABLE` rather than
outstanding.

Where there is one, there is one selection authority and it stays one. `Selection` in
`interactionState.ts` holds an index, a monotonic `revision` the reducer assigns
and a retention time; `consumeSelection` is the bookmark every linked view keeps
into it. `TicPoint` already carries a `SpectrumIdentity` with the spectrum
index, so an XIC point can name a scan through the existing commit path without
a second scan-selection authority being created.

An XIC's x axis is retention time — the same axis, over the same run, as the
chromatogram beside it. It would therefore consume `ViewerInteractionState`
rather than own a second one.

### Viewer selection-availability affordance consistency — REQUIRED_FOR_M5

`spectrumSelectionAvailable` is computed in
[`usePreviewWorkspace.ts`](../../../apps/desktop/src/features/mzml-preview/usePreviewWorkspace.ts)
and reaches exactly two consumers: `canSelectPreviousScan` and
`canSelectNextScan`.
[`PreviewWorkspace.tsx`](../../../apps/desktop/src/features/mzml-preview/PreviewWorkspace.tsx)
passes a bare `onSelect` to both `Chromatogram` and `SpectrumTable`. So the
plot and every table row stay clickable while the selected-spectrum read lane is
blocked — a running conversion, an installation check, a backend resolved
unavailable — and neither surface says so. ADR 0033 recorded this deferral with
its reason.

It is required for M5 rather than deferred to M7 for a reason the audit
establishes rather than assumes: **M5 adds more lane-dependent surfaces.** The
selected spectrum's range export joins the one scientific export lane, which
multiplies the state in which a control looks actionable and commits nothing —
and that happens on both XIC branches, which is why this criterion is
unconditional. Where XIC is admitted it adds a third click surface on top, making
the same rule cover more. Adding surfaces to an unstated rule is what makes the
rule expensive to state later.

### Multi-layer comparison (VIEW-008) — DEFER, and not to M7

Its dependency surface is larger than a viewer slice, and each dependency was
checked:

- **One preview, by contract.** The frontend `PreviewState` holds a single
  `Preview`. In Rust, `open_preview` takes a session-wide ticket whose comment
  states the reason: *there is only one chromatogram the user is looking at and
  only one that may be exported.* Layers mean N of them, live at once.
- **No layer identity.** `FigureSpec` has `StyleRole::Measurement`,
  `SecondaryMeasurement` and `Baseline` — semantic roles for quantities, not
  identities for sources. Nothing in the specification can say *which run* a
  series came from, and `SeriesSpec` deliberately carries no part of a path,
  handle or display name.
- **No normalization.** Two runs' intensities are not comparable as drawn, and
  neither axis carries a unit. Making them comparable means choosing a
  normalization — an analysis concept this product has not admitted.
- **The selection would gain a dimension.** One selected scan of one run is the
  contract every linked view consumes. A selected scan *of a layer* is a
  different type.

Layer identity and provenance belong to the artifact model, and normalization
belongs with the analysis concepts. **Owner: M8 for the enabling contract, M9
for the comparison semantics.** VIEW-008 cannot honestly be scheduled before the
artifact model exists, and forcing it into M5 would mean inventing all four of
the above inside a viewer slice.

### Touch gestures over the chromatogram — DEFER_TO_M7_UI_UX

`.chromatogram-svg { touch-action: none }` in
[`app.css`](../../../apps/desktop/src/app/app.css) is a static declaration, not
a per-event claim, so a touch drag over the plot scrolls nothing. ADR 0033
closed the wheel and left this exactly as it found it, because closing it means
deciding what a touch drag over a chromatogram *means*.

Nothing in M5 makes that decision necessary for correctness: every M5 capability
is reachable by pointer and by keyboard, and the M5 route requires keyboard
equivalence for each new control. **Owner: M7.**

### Bounded preview cache — OPTIMIZATION_ONLY

There is no cache, and that is a recorded position rather than an omission:
`interpret_spectrum` in
[`service.rs`](../../../apps/desktop/src-tauri/src/preview/service.rs) says
requests stay direct and uncached. The measurement behind it is in the M0 spike:
24 deterministic indices over three passes on a **36,319-spectrum** file, backend
p50 `164 ms`, p95 `186`–`194 ms`, max `199 ms`, with no degradation by index
position or repetition.

The audit asked whether M5's own capabilities change that answer, and they do
not. A spectrum viewport re-draws a spectrum already in hand and reads nothing.
An XIC is **one** backend operation per XIC — not one per scan — so it adds a
single read to a session, not a navigation pattern. **Nothing in M5 is an
argument for a cache**, and M5 will not add one on the strength of the roadmap
having once listed it. **Owner: M7, gated on a measurement that shows a need.**

### Vendor-format direct preview — DEFER_EVIDENCE_GATED

`open_preview` refuses a row whose source kind is not previewable with
`dataset_not_previewable()`, and says why: nothing in this product reads a
vendor acquisition directly. Three vendor families convert, and **conversion
support is not direct-preview support** — the conversion evidence proves
`msconvert` writes a correct mzML from those acquisitions, and says nothing
about whether `msaccess` can answer metadata, table and binary queries against
them.

**Owner: M6, behind its own evidence slice.** It is not an M5 exit criterion and
it is not automatically an M6 one either.

## What M5 is, stated as a boundary

M5 completes the scientific mzML viewing workflow **as far as its evidence gates
allow**, and records what they refuse.

Unconditionally, at M5's exit a reader can: see a run's shape over retention time
and zoom into it; see one scan's spectrum, and zoom into that **wherever the
scientific contract can establish an m/z domain over it without altering the
source**; export the spectrum over the whole source, and over the range they
chose wherever that viewport exists; and never be offered a selection — or a
viewport, or a range — the session cannot honestly perform.

A spectrum whose m/z sequence the ordered-series contract does not admit is
valid source data with no viewport and no `Current` scope. M5 says so rather
than sorting it.

Conditionally — on `XIC_SOURCE_ADMITTED` — a reader can also extract one ion's
chromatogram from a proved backend source and select a scan on it. On
`XIC_SOURCE_REFUSED` that capability is not delivered, its refusal and the
measurement behind it are recorded, and VIEW-007 is reassigned to a named owner
and re-entry gate. **`M5 COMPLETE` does not by itself mean XIC exists**; it means
every viewer capability that could honestly be admitted under M5's evidence gates
was delivered, and every one that could not was recorded rather than
approximated.

It is not a redesign, it is not persistence, and it is not analysis.

## The M5 async-surface rule

M5 introduces user-visible surfaces that wait for an answer, and three review
findings arrived as one defect: **each was specified on its success path and
little else.** `apps/desktop/AGENTS.md` already requires every async surface to
have loading, empty, success, partial and error states; what was missing was the
route saying which questions a slice must answer before it may close.

So the rule is stated once, here, and each slice that introduces such a surface
answers it rather than restating it. **A slice introducing an asynchronous
user-visible surface cannot close by proving only the happy path.**

1. **Request identity.** What source, owner, parameters and revision does the
   request describe?
2. **Input validity.** What is rejected before launch, with what reason? Invalid
   input never silently becomes a different request.
3. **Loading.** What is rendered while a request is pending, and which controls
   stay usable?
4. **Success with data.** Which exact request does the result describe, and how
   is it bound to its source and parameters?
5. **Successful empty result.** Where the source contract permits it, empty is a
   valid scientific outcome and must not look like loading or failure.
6. **Partial result.** Either explicitly admitted and typed with truthful
   coverage semantics, or explicitly impossible. Never folded into success.
7. **Typed failure.** Capability, parser, service and projection failures are
   distinguishable from an empty scientific result, and retryability is explicit.
8. **Retry.** Which exact request is retried, and while what remains current?
9. **Supersession.** Which newer source, selection, viewport or query makes an
   outstanding request obsolete?
10. **Stale response.** A stale answer never overwrites newer authority, and is
    discarded rather than surfaced as a current error.
11. **Old result visibility.** Old scientific or screen data is never displayed
    under a newer source, viewport, query, label or axis in a way that reads as
    current.
12. **Recovery.** The transitions after retry, reset, source change and selection
    change are defined.
13. **Accessibility.** Loading, empty, failure and recovery carry truthful
    accessible names and status behaviour, without duplicate announcements.
14. **Rendered evidence.** The user-visible states are exercised at 1920×1080,
    1366×768 and 960×640, with keyboard behaviour where the surface is
    interactive.

M5 introduces exactly two such surfaces: the **spectrum screen projection**
(M5.1/M5.2) and the **XIC query** (M5.5/M5.6). Each answers all fourteen below.
Neither may become a substitute scientific authority: the complete retained Rust
spectrum stays the source, and these are projections and results drawn from it.

## The M5 route

Nine slices. Each names one authority, and the dependency order is the order in
which one authority becomes readable by the next.

**The graph has two branches, because M5.4 has two valid outcomes.** M5.4 is an
evidence gate, and a gate that may only open is not one. Both branches reach
M5.8; neither is an implementation failure.

| Outcome | Graph |
| --- | --- |
| `XIC_SOURCE_ADMITTED` | M5.0 → M5.1 → M5.2 → M5.3 → **M5.4 → M5.5 → M5.6** → M5.7 → M5.8 |
| `XIC_SOURCE_REFUSED` | M5.0 → M5.1 → M5.2 → M5.3 → **M5.4** → M5.7 → M5.8 |

On the refusal branch M5.5 and M5.6 are `NOT_APPLICABLE` rather than skipped or
outstanding, M5.7 runs against the viewer's existing selection surfaces, and
M5.8 records the refusal, its evidence and where XIC goes next. Every slice
below whose existence depends on the outcome says so on its own **Condition**
line, so the branch is read from the slices rather than inferred from this
table.

### M5.0 — orientation and route lock

**Objective.** Replace the stale post-M4 sequence with the product priority,
audit the live viewer against the implementation, and fix the route below.
**Owning authority.** Roadmap, product and architecture documentation.
**User-visible result.** None. Documentation only.
**Evidence.** The repository's local gates, unchanged and green.
**Non-goals.** Any production change whatsoever.
**Predecessor.** M4 complete at `b77e5e8`.
**Exit.** This ADR, the renumbered roadmap and the product documents agree, and
no unimplemented viewer feature is described as implemented.

### M5.1 — the spectrum viewport authority, and the screen-projection foundation

**Objective.** A committed m/z viewport with the same properties ADR 0032
established for retention time — one committed range, one transient gesture with
an epoch, total and deterministic arithmetic, and no React, DOM or timers — over
the spectra that have a domain, and an explicit refusal for those that do not.
The arithmetic's totality is over any *range* asked of an admitted domain; it
never means every spectrum has one. **And the contract by which a viewport
obtains something to draw**, which is a bounded projection of the retained source
rather than the arrays the webview happens to hold.
**Owning authority.** A viewport contract in
`apps/desktop/src/features/mzml-preview/viewer/`, and the boundary that answers
**whether** a spectrum has an authoritative m/z domain, where it does which, and
what a given committed domain looks like on a screen.
**User-visible result.** None. The model arrives before the surface, for the
reason ADR 0032 exists.
**Major evidence.** Unit tests over the contract, and the full-domain
constraint stated below, tested rather than assumed — on **both** of its paths:
a spectrum whose source domain the scientific contract admits, including one
whose transferred arrays are truncated, and a spectrum whose source domain that
contract refuses. For the truncated admissible one, that a projection over a
committed domain **beyond the transferred prefix** carries the retained source's
own observations.
**Hard non-goals.** No second scan-selection authority. No new state layer in
`ViewerInteractionState` that a chromatogram consumer can read by accident. No
export change. **No Rust parsing, source-retention or scientific-export
behaviour change beyond the bounded projection of the already-retained complete
source m/z domain that the viewport authority contract requires.**
**Predecessor.** M5.0.
**Exit.** A conditional invariant, and both halves are proved:

> For every spectrum whose scientific source/domain contract admits a viewport
> domain, M5.1 exposes **exactly that authoritative domain**. For every spectrum
> whose contract refuses one, viewport-domain availability is **explicitly
> refused**, and no substitute domain is inferred.

Where a domain is admitted, a `Current` scope has something unambiguous to refer
to. Where it is refused, there is no `Current` scope to refer to anything — and
that is the answer, not a gap.

One constraint this audit fixes rather than leaving to the slice. The screen and
the export renderer currently disagree about a spectrum's m/z domain on purpose:
`StickSpectrum` widens the drawn domain to cover the reported `mzLow`/`mzHigh`
*and* the transferred points, while `domain_of` in `export.rs` takes the first
and last of the series the figure contract has **already admitted as ordered**,
and documents why it refuses the reported pair.
A viewport built over the screen's wider domain could commit a range the export
renderer's source does not have, and the rule M5.3 inherits from the
chromatogram is that Rust answers such a range with `RangeRefusal::OutsideSource`
rather than clamping it — which is exactly the defect `clampDomain`'s own comment
records for retention time, where the viewer's clamping could produce a range
Rust would refuse. **The m/z viewport's
full domain must be the one the export source has.**

That invariant is what forces the narrowed non-goal above, and it has a second
consequence the route states rather than discovers: **a valid selected spectrum
does not imply an available viewport domain.**

**Two distinct questions, and they must not collapse into one.** Whether the
spectrum is valid source data is one; whether the scientific contract can
establish an authoritative finite forward m/z domain over it **without altering
the source** is another. mzML does not require an ordered m/z array and nothing
here sorts one, so the second question genuinely has a `no` answer for data the
first question calls perfectly good. `SeriesSpec::new` answers it: a non-ascending
`x` is `SpecError::SourceNotOrdered`, and `Domain::new` refuses an inverted pair
as `SpecError::DomainInverted`, so there is no first/last to take. That spectrum
is not corrupt — its CSV and TSV still write, one record per retained source
point in source order — and the figure this product cannot draw for it is the
existing recorded refusal rather than something M5 introduces.

So the projection is a projection of **availability**, never a fabrication of a
domain. The route requires this shape:

- **Rust remains the source authority, and evaluates admissibility.** It reads
  the complete retained selected-spectrum snapshot through the **same
  admissibility and domain contract that governs the scientific figure** — not a
  second, laxer reading invented for the viewport.
- **Where that contract establishes a domain, Rust projects it.** A bounded pair
  — two numbers — from the complete retained snapshot. Not the retained spectrum,
  and above all not a widened transfer bound: recovering endpoints is never a
  reason to send more of the arrays.
- **Where that contract refuses, React receives an explicit refused state**
  rather than invented endpoints. A tagged or optional availability is the
  natural shape; M5.1 owns the semantics and the authority, and the field's name
  and exact type belong to the slice that writes it.
- **A new field, not a reused one.** `SelectedSpectrum` already carries
  `mzLow`/`mzHigh`, and those are the backend's *separately reported* pair —
  a second reading of the same spectrum, which `domain_of` refuses precisely
  because the two can disagree. Overloading them would make the viewport and the
  export renderer silently describe different things again, and would leave
  nowhere to say `refused`.
- **A truncated but otherwise admissible spectrum still gets its domain from the
  complete retained Rust snapshot**, never from the transferred prefix.
- **A refused spectrum does not obtain a domain by any other route.** Not by
  sorting or reordering the `(m/z, intensity)` observations; not by taking
  `[min(m/z), max(m/z)]`; not by using first and last where that produces an
  inverted domain; and not from the transferred arrays, SVG geometry, axis
  ticks, DOM state, rendered viewport state or pointer coordinates.

**Nothing is sorted, reordered, normalised, interpolated or otherwise
transformed to manufacture a viewport.** Where the existing scientific contract
cannot admit a domain without changing the source, MSCanvas refuses the viewport
rather than changing the science.

#### Four layers, frozen separately

The defect this route nearly shipped was one layer standing in for another, so
they are named apart and never substituted.

**The scientific source.** The complete selected spectrum Rust retains. Exact,
complete, session-scoped, Rust-owned, bound to the selected spectrum, and
revoked when that selection or source stops being current. It exists already,
because scientific export must not depend on truncated frontend arrays.

**The screen projection.** What React receives in order to draw. Derived from the
complete retained source, permitted to reduce point count for screen use, and
**not a scientific source, never export authority, and never allowed to invent a
measurement.**

**The viewport authority.** The committed m/z range. Never reconstructed from
screen points, SVG geometry, DOM state, axis ticks, pointer coordinates or a
truncated prefix.

**Scientific export.** A sibling projection of the same retained source. Never
`screen projection → export`; always `complete retained source + requested
scientific scope → export`.

#### What a viewport is given to draw

A domain without data is how a truncated spectrum acquires a viewport that pans
into a lie. `MAX_SPECTRUM_POINTS` bounds what one transfer carries, and a
spectrum over it arrives as a prefix — so a viewport whose *domain* spans the
complete source while its *data* stops at that prefix shows empty space over a
region where Rust holds real peaks and the export writes them. **A bound on
transfer is not permission to present a prefix as the whole source.**

So the route adds the missing half:

```text
complete retained SelectedSpectrumResult in Rust
        ↓
committed m/z viewport
        ↓
bounded screen projection for that viewport
        ↓
React drawing
```

The projection must:

- cover the requested committed viewport;
- come from the complete retained snapshot;
- keep the payload bounded, without requiring any complete raw-array transfer;
- launch no ProteoWizard process and re-read no source file because a viewport
  moved;
- invent no m/z value and no intensity;
- introduce no interpolation for a discrete spectrum;
- never present an arbitrary prefix as if it covered the full source domain.

Where every source observation inside the requested viewport fits the screen
budget, an exact bounded projection is right. Where there are too many, a
**deterministic bounded screen reduction** is used, and it must select **actual
source observations**, preserve materially visible extrema, keep meaningful
signal of both signs where applicable, and never let an arbitrary neighbour stand
in for a tall peak. It is a drawing rule, not scientific aggregation, and it is
never the source an export reads. `StickSpectrum`'s existing per-column reduction
is the prior art: it keeps the greatest non-negative and deepest negative
measured value in each column rather than inventing one.

#### Reset is the whole admitted domain, not the prefix

For an admitted truncated spectrum, the full or reset view may **not** mean *draw
the prefix and label the axis with the complete domain*. The authoritative full
domain comes from the retained source, and the reset view receives a bounded
projection **across that whole admitted domain** — so a spectrum of more than
`MAX_SPECTRUM_POINTS` still shows a truthful bounded overview of all of itself.
This is not solved by raising the raw frontend array bound to the complete
spectrum.

#### Zoom re-projects the source, it does not re-zoom the overview

A single full-domain overview is not enough. When the committed viewport
narrows, a **new** bounded projection is derived from the complete retained
source restricted to that committed domain, so detail the overview had to drop
appears on zooming in. Repeatedly zooming into an already-reduced overview is the
thing this forbids: the complete retained spectrum is the source of every screen
projection, at every zoom level.

#### A different spectrum is a different viewport context

Discarding an outstanding projection settles the *result*. It does not settle the
**range authority**, and leaving that unsaid is how a viewport zoomed on one scan
survives onto another that does not have that range — after which the interface
offers `Current` for a domain the new source lacks and Rust answers
`RangeRefusal::OutsideSource`, or a viewport simply cannot be drawn.

**The decision: a committed selection change to a different spectrum identity
starts a new spectrum viewport context.** The previous spectrum's absolute m/z
viewport is not preserved, not intersected with the new spectrum, and not clamped
into it and called continuity. Two spectra do not share one authoritative m/z
navigation state merely because they occupy the same panel.

**The new spectrum has an admitted domain.** The old spectrum's transient gesture
is superseded; every outstanding projection request it owns is superseded; its
viewport and projection stop being current UI authority; the new spectrum's
authoritative **full admitted source domain** becomes its committed reset
viewport; the projection request for that domain enters loading; and the bounded
full-domain projection is requested from the retained snapshot. **The old
projection is never drawn beneath the new spectrum's axes.**

**The new spectrum has a refused domain.** The old transient gesture and
outstanding projection work are superseded, the old committed viewport stops
being authority, and the new spectrum enters the explicit viewport-refused state:
no domain is manufactured, no `Current` scope is exposed, and whatever
source-data capability that spectrum truthfully has is preserved.

**The same spectrum identity is not a reset.** Re-rendering or re-delivering the
same current result changes nothing. Implementations may use the owner, revision
and token machinery this project already has; M5.0 freezes the semantics rather
than the field names.

The transitions M5.1 and M5.2 must prove: admitted A to admitted B with
overlapping domains; admitted A to admitted B with **disjoint** domains; admitted
to refused; refused to admitted; a projection outstanding for A when B is
selected; a transient gesture active on A when B is selected; and a stale A
projection arriving after B became current. **No case may retain A's viewport
authority for B.**

#### The projection request has a whole lifecycle

The projection is an async surface, so it answers the rule above.

**Identity.** A request is bound tightly enough that its answer can only become
current for the exact state it describes — the dataset or source owner, the
selected spectrum's identity or token, the committed viewport revision or domain,
and a request generation where one is needed. The invariant, not the
serialisation: *a result for an older spectrum or an older committed viewport
cannot become the drawing for a newer one.*

**Loading.** When a commit requires a new projection, the surface enters an
explicit loading state. The previous projection is **not** rendered under the new
committed axes, missing data is **not** drawn as an empty spectrum, and the
committed viewport is **not** rolled back because a drawing is pending — the
committed domain remains the authority, and the screen says its drawing is being
produced. Unrelated navigation, scan selection and Previous/Next included, stays
usable unless another authority independently forbids it.

**Success.** A still-current result is displayed; it covers the committed
viewport, reduces or contains actual source observations, invents nothing, and is
not export authority.

**Empty.** A committed viewport may truthfully contain no reported observation.
That is a successful empty result, distinguishable from loading, from projection
failure and from viewport refusal — and for a discrete spectrum nothing is
interpolated to avoid an empty view.

**Partial: refused.** A bounded reduction is complete *screen coverage* of the
requested domain, not a partial scientific result, so no new completeness
semantics are invented for display. A projection is therefore a complete bounded
screen representation, an explicit empty result, or a typed failure. **If truthful
coverage of the requested domain cannot be produced within the admitted bound,
the request fails explicitly rather than returning an undisclosed partial
drawing.**

**Typed failure.** At minimum distinguishable: a retained spectrum or token no
longer current or revoked; a superseded request; an inconsistent internal
viewport request; and a service failure for the still-current request. A
superseded request is **not** a current user error. When a still-current request
fails, the committed viewport domain is retained, an explicit error state is
rendered for that domain, the old projection is not drawn under the new axes,
`Retry` appears only where the failure is retryable, `Reset` is preserved where
reset is meaningful recovery, there is no silent fall back to Full, and no empty
data is fabricated. **The scientific source is not reclassified as invalid
because a drawing failed.**

**Retry.** Repeats the exact failed request for the still-current spectrum,
committed viewport and source ownership; a changed selection or viewport
invalidates it. It creates a new generation and re-enters loading, and it
re-runs no ProteoWizard, re-reads no acquisition, changes no scientific source
authority and moves no viewport.

**Supersession.** A different spectrum selected, a viewport committed again, a
preview or source replaced or revoked, or a dataset removed or cleared where
ownership requires revocation. A superseded response — success **or** failure —
is discarded: it replaces no current data, surfaces no stale error, and restores
no old viewport.

**And a failed drawing does not redefine the science.** `Current` scientific
export is defined by the current retained source, the committed viewport domain
and the export lane — never by whether a screen projection succeeded. So the
route may keep `Current` export available while the projection for that same
range is in error, provided the interface makes the projection error explicit, so
a reader never mistakes a failed drawing for empty science. **Scientific export
correctness is not coupled to screen-projection completeness.**

M5.0 implements none of this. What is fixed here is the contract the future
slice owes, and the boundary it may cross to meet it. **M5.1 is therefore no
longer "project two endpoint numbers"**: it owns the admitted/refused domain
state, the authoritative complete domain where admissible, the bounded projection
of screen data from the retained source, projection request and result ownership,
bounded IPC semantics, stale and revoked selection behaviour, no acquisition
re-read, and no export from a screen projection — plus the selection-to-viewport
migration above and the projection request's whole lifecycle. **M5.1 proves that
state machine before M5.2 builds visible gestures on it.**

### M5.2 — the visible spectrum viewport

**Objective.** Make the spectrum viewport reachable where there is one: wheel,
drag, keyboard and visible buttons, over the selected-spectrum panel — and make
its absence honest where there is not.
**Owning authority.** The spectrum panel's own adapter, consuming M5.1 —
**including M5.1's availability answer**, which this slice reads rather than
second-guesses.
**User-visible result.** For a spectrum whose domain is admitted, the selected
spectrum zooms, pans and resets. For one whose domain is refused, the panel says
the viewport is unavailable, in the posture the frozen principles require of any
unavailability, and the spectrum itself is still shown and still selected.
**Major evidence.** Rendered interaction QA at 1920×1080, 1366×768 and 960×640
**for both availability states**; keyboard equivalence for every pointer action;
wheel ownership decided by the same rule ADR 0033's R1.2 established — a wheel is
claimed only where applying it would change the effective rendered domain, which
over a refused spectrum is nowhere, so the page keeps its wheel. And for a
truncated admissible spectrum, the case this slice exists to get right:
**panning or zooming into a source region beyond the original frontend prefix
surfaces the observations Rust retained, rather than false blank space.**
**Hard non-goals.** No touch semantics. No restyling of the panel beyond the
controls this slice adds. No change to what the spectrum's caption claims about
its reduction. **No local-only viewport authority**: where M5.1 refuses a domain,
this slice does not derive one from the transferred arrays or from the drawing to
keep its controls working, and no control pretends to operate. **No second
scientific source authority**, and no export taken from what is on screen.
**Predecessor.** M5.1.
**Exit.** Where a domain is admitted, every viewport control on the spectrum
panel is available exactly when pressing it would change what is drawn; a
committed viewport draws the retained source over that whole domain including
beyond the transferred prefix; and no viewport interaction re-reads the
acquisition. Where a domain is refused, no viewport control claims to act, the
reason is stated where the reader meets it, the spectrum stays selected, and the
rest of the viewer — the chromatogram, the scan table, scan navigation and the
spectrum's own full-source data export — stays usable.

#### The backend rule, stated correctly

An earlier draft of this slice forbade *any* backend read on a viewport change,
and that was too wide: it is what left a truncated spectrum with a domain it
could pan across and no data to show there. The invariant is narrower and is
about **source acquisition**, not about talking to Rust:

> A viewport interaction must not re-read the acquisition, launch another
> ProteoWizard operation, or establish a second scientific source authority.

It **may** ask Rust to project the committed viewport from the complete selected
spectrum Rust already holds in memory. That is an in-process projection of a
snapshot this session already read, not a re-acquisition of the source, and it is
the only way a bounded transfer and a complete domain can both be true.

#### Transient and committed are different questions

The interaction model this product already has is preserved, and no projection
call is made per pointer frame.

**Transient.** While a wheel or drag is in progress, immediate feedback comes
from the screen representation already in hand. That transient state is **not**
scientific range authority, and it triggers no source re-read and no projection
request.

**Committed.** When the viewport commits, the committed domain becomes the range
authority, a bounded projection is requested for it, and the result is applied
**only if it is still current**.

Staleness is handled the way this repository already handles it — a revision,
epoch or token that says which request an answer belongs to. A stale projection
may never overwrite a newer viewport, a newer selected spectrum, or a newer
dataset or open state. What it must not do is become a second spectrum truth: one
retained source, one viewport authority, one drawing derived from them.

#### The states M5.2 must render and test

Ready; a transient gesture; committed-projection loading; a successful non-empty
projection; a successful **empty** projection; a retryable error; a non-retryable
or refused state where applicable; reset recovery; a stale or superseded result
rejected; and the selection-migration cases M5.1 froze. Rendered at 1920×1080,
1366×768 and 960×640, with keyboard equivalence where a control exists, under the
accessible naming and live-region rules the frozen principles set — and **without
adding a duplicate-announcement debt while satisfying them**, since this
repository already carries one as inherited M4.4 debt.

Two proofs are named because they are the ones an implementation would otherwise
skip:

- **panning or zooming into a source region beyond the original frontend prefix
  surfaces the observations Rust retained, rather than false blank space**;
- **an old projection is never drawn beneath a newer committed domain or a newly
  selected spectrum.**

M5.0 does not design the unavailable state or the projection's shape; it requires
the route to be able to represent both truthfully.

### M5.3 — selected-spectrum `Current range` export

**Objective.** For a selected spectrum the figure contract admits: SVG, PNG,
`Copy plot`, CSV and TSV, over the committed m/z viewport as well as the full
source. For one it refuses: the existing typed refusal stands for the three
figure formats, CSV and TSV keep working over the full source, and there is an
honest absence of the `Current` scope. **Which formats a spectrum supports is a
property of that spectrum, not of this slice.**
**Owning authority.** Rust. The range is resolved against the retained spectrum,
never against the transferred arrays and never against the screen's reduced
sticks — which after M5.1 includes the bounded screen projection, whose whole
purpose is to be a drawing.
**User-visible result.** A range chooser on the selected-spectrum surface,
matching the chromatogram's.
**Major evidence.** A range the retained spectrum does not have is refused rather
than clamped; the window is resolved against the retained snapshot; and the
figure/data behaviour follows the **representation**, tested per representation
rather than as one rule. See the constraint below.
**Hard non-goals.** No second export lane — the one scientific export lane
serves this too. No linked data document. No change to the linked two-panel
figure's rule that the lower panel is always the complete spectrum. **No
interpolated boundary value for a discrete spectrum**, under any range.
**Predecessor.** M5.1 and M5.2.
**Exit.** Two paths, and both are proved.

**Where M5.1 admitted a domain.** A selected spectrum exports over Full or
Current from the retained source, in **every format that spectrum already
supports** — all five where the figure contract admits it, and the two data
formats where it does not; `Current` reads the committed viewport and nothing in
flight; and the window's figure/data behaviour matches the representation the
source admitted.

Figure admissibility and domain admissibility are asked of the same contract and
usually answer together — an unordered array refuses both — but they are not the
same question, and this slice does not assume one from the other. M5.3 adds no
format to a spectrum and takes none away: it adds a **range** to the formats the
product already offers it.

**And the rule generalises.** Unordered m/z is the refusal this repository has
proved, not the only one `SeriesSpec` and `Domain` can raise. Any other refusal
found later inherits the same posture — **fail closed**: no viewport, no
`Current` scope, the existing typed refusal preserved, the source untouched. What
it must never receive is an ad-hoc normalisation invented to make that one case
drawable.

#### The states this route must keep apart

Written as a table because the two findings this section repairs were both a
collapse of it.

| Spectrum / request | Viewport | Screen data | Full-source export | `Current` export |
| --- | --- | --- | --- | --- |
| Ordered, untruncated, domain admitted | yes | exact bounded projection | all five | all five |
| Ordered, truncated, domain admitted | yes | bounded projection of the **retained** source | all five | all five |
| Unordered / domain refused | **no** | panel draws as before; no projection manufactured | CSV, TSV; typed figure refusal preserved | **none** |
| Reset / full view, truncated | whole admitted domain | bounded overview of **all** of it, never the prefix | — | — |
| Zoomed committed viewport | narrowed | **re-projected from the source**, not re-zoomed from the overview | — | — |
| Panned beyond the transferred prefix | unchanged | the retained source's own observations | — | — |
| Committed window holding no reported peak | yes | nothing to draw there | — | empty figure **and** empty data document |
| Selection changes with a projection outstanding | **reset to the new spectrum's full admitted domain** | old request superseded; stale answer discarded; old drawing never shown under the new axes | — | — |
| Selection changes to a domain-refused spectrum | **cleared; explicit refusal** | no projection manufactured | that spectrum's own | **none** |
| Viewport changes twice with an older request outstanding | newest committed domain | both stale answers discarded | — | — |
| Projection pending for the committed domain | unchanged, still authority | explicit loading; **not** the previous drawing, **not** an empty spectrum | unchanged | still available on its own conditions |
| Projection fails while still current | retained | typed error for that domain; `Retry` where retryable; `Reset` preserved | unchanged | **still available** — a failed drawing is not empty science |
| Projection returns nothing for the domain | unchanged | successful **empty**, distinct from loading, failure and refusal | unchanged | empty figure and empty data document |

Five capabilities, thirteen states, one rule each. No wording in this route may
answer them with a single flag.

**Where M5.1 refused one.** There is **no `Current` scope** — not a synthesised
range, not a sorted source, not `[min, max]`, not a silent fall back to Full, and
never a full-source export labelled as a current range. Whatever full-source
export the product already truthfully offers for that spectrum stays exactly as
it is: its CSV and TSV write, because a data document is one record per retained
source point in source order and needs no ordering at all, and its figure
availability stays governed by the existing figure contract rather than by
anything this slice adds. A range control that has no viewport to read is not
offered, and no second range authority is created to give it one.

One constraint this audit fixes rather than leaving to the slice, because the
obvious reading of M4.3 is wrong here.

M4.3's rule is that a figure draws the segment crossing a window edge while a
data document contains scans, so a window between two samples is a figure with a
line through it and a table with no rows. **That rule belongs to a chromatogram,
which is a polyline**, and carrying it to the m/z axis would require exactly what
this repository already refuses. `crates/plot-spec/src/svg.rs` filters discrete
marks rather than clipping them, and states why: *a stick outside the window is a
measurement outside the window, and inventing one at the boundary would draw
intensity at an m/z nobody measured*.

So the behaviour follows the representation, and only one branch is reachable
today:

- **`Unreported`, and any centroid or other discrete-marker representation.**
  The figure draws only genuinely reported peaks whose m/z falls inside the
  admitted window. No boundary intensity is interpolated, and no line is drawn
  through an m/z that was never measured. A window containing no reported peak
  is a **figure and a data document that are both empty**, and both are correct
  answers about the sample. This is the branch the product is in: the boundary
  emits no profile/centroid marker, so `spectrum_panel` maps the one state it
  can receive to `SpectrumRepresentation::Unreported`.
- **A representation authoritatively established as continuous profile
  samples.** Only such a representation may admit continuous clipping with an
  interpolated boundary value, because only there does the source assert a value
  between its own samples. Nothing in this product establishes one today, so
  **this must not be written as a universal M5.3 requirement** and must not be
  reached by assuming a representation the file did not report.

The invariant underneath both branches, and the one M5.3 is accountable to:
**figure filtering follows the admitted spectrum representation; a data document
never invents a source measurement.** CSV and TSV contain reported source points
and nothing else, at any range, under any representation.

**Scientific export never derives from the screen.** M5.1 introduces a second
thing that looks like spectrum data — the bounded projection a viewport draws —
and this is the slice where substituting one for the other would be easiest and
worst. The composition is fixed:

```text
committed viewport domain + complete retained Rust spectrum -> scientific export
```

and never `bounded screen projection -> scientific export`. The consequence worth
stating: a screen projection that is **loading or in error changes nothing**
about whether `Current` export is available, because export reads the retained
source and the committed domain rather than the drawing. Where both are true at
once, the interface makes the projection's error explicit so a reader never
mistakes a failed drawing for empty science. Concretely: a
`Current` CSV or TSV contains the real source records inside the committed
domain; a `Current` figure is built from the complete retained source restricted
to that domain; figure behaviour follows the admitted representation; a discrete
spectrum still gains no boundary interpolation; screen reduction never alters an
exported value; and **how many points the screen drew has no effect on what the
export contains**. A viewport reduced to 900 columns and an export of 400,000
points describe the same range, and only one of them is the measurement.

**Five capabilities, and they are not one boolean.** This slice is where they
would most easily be confused, so the route separates them:

1. whether the spectrum is **valid source data**;
2. whether the figure contract can **admit it as a figure**;
3. whether an authoritative **viewport domain** can be established over it
   without altering it;
4. what **full-source export** it supports;
5. what **current-range export** it supports.

A descending m/z array answers those *yes, no, no, CSV and TSV write, and none* —
five answers, not one. No document in this route may collapse them.

### M5.4 — XIC source and capability evidence

**Objective.** Decide, from a live measured run against a real ProteoWizard
installation, whether an acceptable XIC source exists and which query it is.
**Owning authority.** A spike document under `docs/spikes/`, and the capability
contract in `crates/proteowizard`.
**User-visible result.** None.
**Major evidence.** A **candidate pipeline**, not two queries treated
differently:

```text
discover live candidate -> read its exact installed signature
  -> classify: applicable, or excluded by that signature
  -> measure every still-applicable candidate
  -> compare the scientific and runtime evidence
  -> admit one source, or record an evidence-complete refusal
```

Concretely: complete help captured from the installed build for both `tic` and
`sic`, including `sic`'s exact signature, which this repository has never held;
each candidate then classified as below; and **every candidate still classified
applicable measured to one standard** — `tic mz=<low>,<high>` and any applicable
`sic` form alike — on a representative acquisition and on the pinned synthetic
fixture.

#### M5.4 candidate evidence dimensions

The standard is this finite list. It is the dimension vocabulary the spike's
candidate-standard matrix must use, and repository validation requires the two to
name exactly the same dimensions — so a dimension added here is unanswerable
until the evidence owner classifies it for every candidate.

| # | Dimension |
| --- | --- |
| 1 | Invocation / accepted parameter form |
| 2 | m/z-window semantics |
| 3 | Output shape / schema |
| 4 | Retention-time values / ordering |
| 5 | Identity reconciliation |
| 6 | MS-level behaviour |
| 7 | Aggregation / quantity |
| 8 | No-signal behaviour |
| 9 | Duplicate-retention-time behaviour |
| 10 | Completeness / byte bound |
| 11 | Malformed / error behaviour |
| 12 | Repeatability |
| 13 | Numeric fidelity |

Each is answered per measured candidate as a located result, or as an explicit
`NOT_APPLICABLE` carrying its reason. Two carry their own history. **Aggregation**
is read from the pinned ProteoWizard commit rather than inferred from a query's
name. **Numeric fidelity** is in the standard because M5.4 measured a build whose
serialization alone invalidated an otherwise plausible source, and because the
re-entry gate already requires a resolved answer for it.

An exit code of 0 is not evidence of correctness — the M0 spike already recorded
that `msaccess` exits 0 for an unavailable spectrum and for unsupported input —
semantics are never inferred from the name `sic`, and no output is reinterpreted
to make it fit the product.
**Hard non-goals.** No production XIC. No product semantics chosen because a
library supports them. No frontend work.
**Predecessor.** M5.0. Independent of M5.1–M5.3, so it may run alongside them.
**Exit.** One of two recorded outcomes, and the outcome selects the branch.
`XIC_SOURCE_ADMITTED`: a named query with a named aggregation, a named ordering,
a named completeness bound and a capability requirement that can gate it.
`XIC_SOURCE_REFUSED`: an **evidence-complete** refusal, which means all six of:
`tic mz=` received the required measured investigation; every candidate the live
installed backend surfaced was classified; every candidate still plausibly
applicable was measured to that same standard; every unmeasured candidate carries
an explicit signature-based exclusion; no pseudo-XIC or approximation was
substituted; and the record says what was measured, what was excluded and why.
**No candidate may be left between "signature captured" and "milestone
capability refused".** On refusal XIC leaves M5 by the rule below — **it is never
approximated**, and the audit's refusals stand: no base-peak-window substitute,
no reconstruction from the incomplete frontend arrays, and no
one-backend-process-per-spectrum workaround over the measured 36,319-spectrum
acquisition.

#### Closing a candidate: measured, or excluded by its own signature

The defect this repairs let `tic mz=` be measured, `sic`'s signature merely
captured, and a refusal recorded — leaving a query whose name means *selected ion
chromatogram* untested while VIEW-007 was deferred. **The rule:**

> `XIC_SOURCE_REFUSED` may be recorded only once every live candidate that
> remains plausibly capable according to its installed signature has either been
> measured to the required scientific and runtime standard, or been excluded by
> evidence showing that its signature alone proves it cannot satisfy the
> contract.

This is not *execute everything help prints*. It is conditional on the signature
still being plausibly applicable, and it applies to `sic` exactly as to any
candidate a later audit turns up.

**`SIC_CANDIDATE_APPLICABLE`** — the installed signature still plausibly
describes a query that could answer the XIC contract. It must then be executed
and measured before a refusal is permitted, at the standard above.

**`SIC_CANDIDATE_EXCLUDED_BY_SIGNATURE`** — the signature itself settles it. The
record must state the exact installed signature observed, the XIC requirement the
candidate would have to satisfy, the feature or limitation in that signature
making it inapplicable, and why execution could not change that conclusion. The
kind of thing that can count, only where the signature actually supports it: the
required m/z-window input cannot be expressed; the query plainly describes a
different quantity; the required scan or MS-level scope cannot be represented;
the required result identity cannot be produced. **None of that may be
invented**, and an ambiguous signature is `SIC_CANDIDATE_APPLICABLE` and gets
measured.

**What is never an exclusion.** That MSCanvas has no `sic` parser; that this
repository holds no signature constant for it; that `PreviewOperation::Tic` does
not expose it; that no production route invokes it. Those are facts about this
application, not evidence about the installed backend's capability. *Not
implemented here*, *not parsed here* and *not yet measured* are none of them
*not supported there*.

**Five states, kept apart** so a later re-evaluation against another build can
read the record: candidate absent from the installed backend; present but
excluded by signature; present and plausible but not yet measured; measured and
rejected; measured and admitted. They do not collapse into one `unsupported`
bucket.

**A conclusion belongs to the build that produced it.** Absence of `sic` in one
build does not generalise to all builds, success in one does not generalise
either, and signature semantics do not carry across builds without evidence.
M5.4 records the provider identity the repository's existing ProteoWizard
evidence conventions already use rather than inventing a parallel version model.

**And measurement does not oblige admission.** A measured `sic` may still be
rejected; admission needs evidence supporting a contract M5.5 can implement
without approximation. If neither `tic mz=` nor any remaining applicable
candidate satisfies it, refusal is the right answer. What changed is only **how
much evidence a refusal must close**, never that refusal is available.

**And "not measured" is not an answer at all.** Where the execution environment
lacks the real ProteoWizard installation or the representative source an
applicable candidate needs, M5.4 records neither outcome: it reports an evidence
blocker and stops. Fixtures can prove parsing and deterministic behaviour later;
they cannot stand in for a live capability measurement.

### M5.5 — the XIC model and runtime

**Condition.** `XIC_SOURCE_ADMITTED` only. On `XIC_SOURCE_REFUSED` this slice is
`NOT_APPLICABLE` and is never attempted from an unproved source.
**Objective.** The typed operation, its capability gate, its parser, its DTO and
its service path.
**Owning authority.** Rust: `PreviewOperation`, `require_preview_operation`, the
preview interpreter, and the preview service.
**User-visible result.** None.
**Major evidence.** The operation refuses what the installed backend does not
declare; the parser refuses a malformed, reordered or incomplete result whole
rather than in part, matching `parse_spectrum_table`'s rule; unit posture matches
what the boundary establishes and no more.
**Hard non-goals.** No frontend. No second selection authority. No cache.
**Predecessor.** M5.4, and the decisions it forces (below) being answered.
**Exit.** An XIC can be requested and typed end to end in Rust; a build whose
backend cannot serve one says so before a process is launched; and the **typed
request, result and failure vocabulary** the visible surface needs exists —
including whether the admitted source can produce a partial or truncated result
at all. M5.5 owns those semantics; M5.6 owns their presentation.

**The partial question is answered here, not improvised later.** M5.4 and M5.5
must establish whether the chosen source can return a partial or truncated XIC.
If partial is scientifically meaningful and reachable, it carries typed coverage
and completeness facts that M5.6 discloses; otherwise partial output is
**refused** rather than displayed as complete success. Nothing about partial
semantics is invented in M5.0.

### M5.6 — the visible XIC, and linked selection

**Condition.** `XIC_SOURCE_ADMITTED` only. On `XIC_SOURCE_REFUSED` this slice is
`NOT_APPLICABLE`.
**Objective.** Make the XIC reachable, and make a scan chosen on it the same
selection every other view already follows.
**Owning authority.** The existing `ViewerInteractionState`. The XIC consumes
it; it does not extend it with a selection of its own.
**User-visible result.** A typed m/z window produces a trace over the same
retention-time axis, its settings are stated beside it, and clicking it selects
a scan that the chromatogram marker, the table row and the spectrum panel all
follow.
**Major evidence.** One commit revision consumed by every view including the new
one; a selection committed on the XIC reaching the other three; a scan the loaded
table does not contain refused rather than marked; keyboard equivalence for the
input and the trace; and **rendered evidence for every state below** at 1920×1080,
1366×768 and 960×640 — an invalid draft, loading, a successful trace, a
successful empty result, a retryable error, a retry, a superseded request, and
linked selection unavailable where no current selectable trace exists.
**Hard non-goals.** No second scan-selection authority. No multi-XIC overlay. No
normalization, smoothing, baseline correction or peak picking. No claim about
the m/z unit the file did not report. **No XIC export.** Concretely: no XIC SVG
export, no XIC PNG export, no XIC CSV or TSV export, and no statement anywhere
that such an artifact exists. None of the exit criteria asks for one, M4 owns the
export lane, and a fourth surface on it is a decision of its own rather than a
consequence of the trace existing. Everything an adopted decision has to say is
carried by the visible trace contract instead.

**Where a reusable XIC export goes.** M9. An XIC is a derived analytical
quantity rather than a second view of something the file contains, and M9 is
where derived analytical results and their reusable form are owned, on top of
M8's artifact identity. That is a routing decision this ADR makes and a future
independently authorised route amendment may revisit; **it may not be pulled
into M5**, and no M5 slice owns it.
**Predecessor.** M5.5.
**Exit.** VIEW-007's acceptance holds — a typed m/z and window produce a trace
whose settings and unit posture are explicit — the viewer still has exactly one
selected scan, and **every state of the request lifecycle below is reachable,
truthful and rendered.**

#### The XIC request lifecycle

A spinner is not the repair. This is the second async surface M5 introduces, so
it answers the same fourteen questions, and the answers are frozen here while
their *scientific* parameters stay open: the five `USER_DECISION_REQUIRED` items
are **not** decided here, and whatever is eventually admitted becomes the input
this contract validates and displays.

**Draft, then commit.** The reader edits request parameters as a **draft**, and
editing is not scientific query authority. Before submission the draft is
validated against whichever D1–D5 answers were admitted: an invalid draft is
shown as invalid where the reader is, launches **no** backend request, and
**never silently alters the currently committed successful trace**. A valid
explicit submission snapshots the exact parameters and makes that request
current. M5.0 fixes none of the control's shape or labels.

**Loading.** A submitted request enters an explicit loading state bound to that
exact request and the current dataset and preview authority. The **old trace is
not presented under the new request's window, MS-level or aggregation labels** —
M5 keeps no result history, so the simple and honest route is not to show the
previous trace as current while a new request loads — and pending work is never
rendered as *no signal*.

**Success.** The trace is rendered together with enough visible contract to read
it truthfully — the window, unit and tolerance posture, MS-level scope,
aggregation and source-query identity the frozen posture already requires. Linked
scan selection reuses the existing authority; **no XIC-specific selected-scan
authority is created.**

**Empty.** A scientifically valid query that returns no signal is an explicit
empty result, distinguishable visually and accessibly from invalid input, from
loading, from capability failure and from parser or service failure. **No
zero-valued signal is fabricated** unless the admitted source contract itself
defines zeros.

**Partial.** Per M5.5: either typed and disclosed, or refused. Never shown as
complete success.

**Typed failure and recovery.** The route covers the failures the admitted source
and runtime can actually produce — capability, parser, backend or service
execution, and stale or revoked source ownership. A still-current failure shows a
typed error posture rather than empty scientific data, offers `Retry` only where
retry is meaningful, **preserves the exact failed request parameters** for it, and
silently changes no window, MS level, aggregation or source query. A retry
repeats that same committed request while its owner is still current; if the
source or the parameters changed, the old retry is superseded.

**Supersession.** A dataset or preview change, a removed or revoked source, or a
newer committed request obsoletes a pending one. Stale success **and** stale
failure are discarded: neither replaces the current trace or state, and neither
surfaces stale messaging as though it described the current request.

**Selection availability.** Only a **current successful trace with selectable
points** may take part in linked scan selection. During invalid input, loading, an
empty result, a failure or a superseded state, the XIC surface does not pretend a
scan point can be selected. That behaviour is an input to M5.7's
selection-availability audit, and the chromatogram's and scan table's existing
selection authority is unchanged.

### M5.7 — selection-availability affordance consistency

**Objective.** Decide once how every click surface in the viewer communicates
that a selection cannot be performed right now, and apply it to all of them.
**Owning authority.** One availability rule, read by every viewer click surface
that exists when this slice runs — the chromatogram and the scan table always,
and the XIC as well on `XIC_SOURCE_ADMITTED`, where its own lifecycle already
says a point is selectable only on a current successful trace. This slice
reconciles that with the lane rule rather than restating either.
**User-visible result.** A click surface that cannot commit says so, in terms of
what the reader can change, without taking away the hover, zoom and pan that
need no backend.
**Major evidence.** Each blocked lane exercised — a running conversion, an
installation check, a backend resolved unavailable — on every click surface;
the backend-free interactions proved still live in each; accessible naming and
live-region behaviour matching the principles M5.0 froze.
**Hard non-goals.** No restyling beyond what the message requires. No change to
the lane rule itself. No new disabled state on an action that does work.
**Predecessor.** *Conditional.* On `XIC_SOURCE_ADMITTED`, M5.6 — so the rule is
applied to the complete surface set at once rather than to a set that then
grows. On `XIC_SOURCE_REFUSED`, M5.3, because the surface set is then already
complete at the chromatogram and the scan table and there is nothing further to
wait for. **M5.6 is not an unconditional predecessor**: making it one would make
the milestone unreachable on the branch M5.4 is allowed to take.
**Exit.** No viewer surface accepts a click that commits nothing without saying
why, and no surface that can act has been closed by this slice. XIC-specific
availability behaviour is part of this exit **only** where XIC was admitted and
implemented.

### M5.8 — Viewer Completion closure and handoff

**Objective.** Prove the exit criteria, record what M5 did not do and hand the
named readiness to M6 and M7 — and, on `XIC_SOURCE_REFUSED`, record the refusal,
the measurement that produced it, and the future owner and re-entry gate XIC is
reassigned to.
**Owning authority.** Documentation and the full local gate set.
**User-visible result.** None.
**Major evidence.** The exit criteria below, each answered with a citation.
**Hard non-goals.** No new capability.
**Predecessor.** M5.3 and M5.7. Reachable on both branches, because neither of
those is conditional.
**Exit.** Every item in the exit criteria is answered yes with evidence, closed
as `NOT_APPLICABLE` under a recorded evidence refusal, or deferred with a named
owner and reason. No item is left silent.

**Closed 2026-08-30.** Criteria 1, 2 and 5 PASS; 3 and 4 are `NOT_APPLICABLE`
under `XIC_SOURCE_REFUSED`; 6, 7 and 8 are deferred with owners. The dispositions,
their evidence and the M6/M7 handoff are in
[ADR 0042](0042-viewer-completion-closure-and-handoff.md).

## M5 exit criteria

M5 is complete when, and only when:

| # | Criterion | Required for M5? |
|---|---|---|
| 1 | Where the scientific source/domain contract admits a domain, the selected spectrum has a committed m/z viewport that zooms, pans and resets by wheel, drag, keyboard and button, offers each control exactly when pressing it would change what is drawn, and **draws the retained source across that whole domain — including beyond the transferred prefix — without re-reading the acquisition**; and where that contract refuses one, the viewport is explicitly unavailable and no substitute domain is inferred | **Yes**, both paths |
| 2 | The selected spectrum exports over the full source in **every format that spectrum already supports** — all five where the figure contract admits it, CSV and TSV where it refuses it, with the existing typed refusal preserved for the three figure formats — and over the committed m/z range **where a viewport exists**, with a range the source does not have refused rather than clamped. Where no viewport exists there is no `Current` scope | **Yes**, both paths |
| 3 | An XIC is produced from a backend source proved by a live measured run, with its query, aggregation, MS-level applicability, window and unit posture carried by the visible trace where the reader can see them | **Only on `XIC_SOURCE_ADMITTED`** — see the rule below |
| 4 | A scan selected on the XIC is the one selection every other view follows, through the existing commit revision | **Only on `XIC_SOURCE_ADMITTED`** |
| 5 | No viewer click surface accepts a click that commits nothing without saying why, and every backend-free interaction stays available while it says so | **Yes** |
| 6 | Multi-layer comparison | **No** — M8 for layer identity and provenance, M9 for comparison semantics |
| 7 | A bounded preview cache | **No** — M7, and only on a measurement that shows a need |
| 8 | Vendor-format direct preview | **No** — M6, behind its own evidence slice |

Three further conditions apply to the milestone as a whole: no unimplemented
viewer feature is described as implemented anywhere in the repository; every M5
control satisfies the frozen principles below at all three responsive targets;
and the local gate set passes unchanged.

**Amended 2026-08-30 by M5.8: criterion 5 carries one named exception.** It is a
**narrowing of the criterion, decided at closure**, and not a reading it always
had -- this document did not mention the case until now.

The criterion is met by the viewer: both surfaces that commit a scan read one
availability rule, an unavailable selection gives one truthful explanation, and
nothing backend-free is taken away while it says so. What is carved out is the
**conversion lane's dispatch race**: `convert` claims the guarded ref the moment
it dispatches, and no rendered value follows until the queue slot is read back,
so for that interval an activation is refused while both surfaces still say
available. Inside it, a click does commit nothing without saying why.

Why it is carved out rather than fixed. The window is **not a viewer property**:
it belongs to `convert` claiming a lane before the slot confirms it, it is shared
by every conversion-gated control in this application, it predates M5, and no
M5 slice created or widened it. Closing it means changing the conversion lane's
contract, which a viewer adapter cannot do and a documentation slice must not.
Holding a viewer criterion hostage to another lane's contract would make the
milestone unreachable for a reason that has nothing to do with the viewer.

**Owner: M6**, if conversion's growth makes it worth closing. Recorded in
[ADR 0042](0042-viewer-completion-closure-and-handoff.md) with the same wording,
and named in the product surfaces that describe the behaviour, so no reader is
told the viewer is exceptionless.

**No criterion assumes every spectrum is renderable, and none requires M5 to make
one renderable.** A valid mzML spectrum may carry an m/z sequence the
ordered-series contract does not admit. That spectrum is not corrupt: it is
selectable, it is drawn by the panel as before, and its full-source CSV and TSV
still write. What it does not get is a viewport, a `Current` scope, or a figure —
and the figure it does not get is the **existing** typed refusal, not
functionality M5 is expected to fabricate. M5 delivers those refusals rather than
sorting the source to avoid them, and criterion 2 asks each spectrum only for the
formats it already supports. **Valid
source data, figure admissibility, viewport-domain admissibility, full-source
export and current-range export are five different questions**, and no criterion
above answers more than one of them.

**No criterion requires an XIC export, and none may.** M5 writes no XIC SVG, PNG,
CSV or TSV, claims no such artifact, and assigns a future reusable XIC export to
M9. Criterion 3 is satisfied by what the **visible trace** carries, which is why
it is worded that way.

**The rule for criteria 3 and 4.** M5.4 has two legitimate outcomes, and the
milestone means something different but equally complete under each.

**`XIC_SOURCE_ADMITTED`.** M5.4 establishes an acceptable scientific and runtime
source. M5.5 and M5.6 are then required, criteria 3 and 4 both apply, M5's exit
includes a visible XIC, and that XIC participates in the existing linked
scan-selection authority rather than a second one.

**`XIC_SOURCE_REFUSED`.** M5.4 cannot establish one. Then the refusal evidence is
preserved; **no approximation is substituted**; M5.5 and M5.6 are
`NOT_APPLICABLE`; criteria 3 and 4 are closed **explicitly as evidence-gated and
not applicable** rather than passed over in silence; VIEW-007 is reassigned to a
named future owner with the re-entry gate that would let it be reconsidered; and
M5 may still become COMPLETE once every remaining required Viewer Completion
criterion is met. In that outcome `M5 COMPLETE` **does not mean XIC exists.**

What may not happen under either outcome is XIC shipping from a source the
evidence did not establish. A viewer that draws a trace nobody can defend is
worse than a viewer that does not draw it.

## Product decisions this route surfaces rather than guesses

Recorded as `USER_DECISION_REQUIRED`. None of them is settled by the
authoritative documents or the code, and each changes what gets built. M5.4
supplies the measurement several of them should be answered against; M5.5 cannot
start until they are answered.

**Where an adopted answer has to appear, and where it may not.** M5 builds no
XIC export — no SVG, no PNG, no CSV, no TSV — so an adopted decision is carried
by the **visible XIC trace contract** and by what the runtime exposes beside it,
never by an exported artifact. Concretely, a shipped XIC must truthfully carry,
where the reader can see it: the exact m/z window it was taken over; the unit and
tolerance posture that window is expressed in; the MS-level scope; the
aggregation performed inside the window; the identity of the backend query that
produced it; the value-axis posture; and any other adopted decision needed to
read the trace for what it is. Each recommendation below is written against that
contract, and none of them may be read as a requirement on a document M5 does
not write.

### XIC-D1 — how the reader expresses the m/z window, and in what unit

**Question.** Is the window given as an absolute m/z pair, as a centre plus an
absolute half-width, or as a centre plus a relative tolerance in ppm — and what
is the default?

**What the evidence settles and does not.**
`docs/product/FEATURE_CATALOG.md` VIEW-007 requires "typed m/z and tolerance",
so typed input is not in question. The backend takes an **absolute** window:
`mz=<mzLow>[,<mzHigh>]`. A ppm tolerance would therefore be converted to an
absolute window by MSCanvas. Separately, the boundary reports no unit for a
spectrum's values at all — `SelectedSpectrumResult.value_units` is
`UnitState::NotEmitted` and the panel renders "Value units: Not reported". That
one answer covers the m/z axis as well as the intensity axis: `spectrum_panel`
gives both axes the same state, and says why — the backend reports one answer
for the arrays rather than one per axis. So this product cannot currently label
an m/z window "Da" without stating something the file did not.

**Options.** (a) absolute low/high pair, passed through unchanged; (b) centre
plus absolute half-width, converted to a pair; (c) centre plus ppm, converted to
a pair by MSCanvas; (d) (b) and (c) with an explicit unit selector.

**Consequences.** (a) and (b) send the backend exactly what the reader typed and
require no unit claim. (c) makes MSCanvas perform a scientific conversion whose
result the document must then state, and does so against values whose unit the
file never reported.

**Recommended default, if one is wanted.** (b) — a centre and an absolute
half-width, carried by the visible trace as an absolute m/z window with no unit
name, matching the unit posture the chromatogram already keeps. It is the
smallest honest thing the evidenced source can serve. ppm can be added later
without changing what the trace has already claimed; the reverse is not true.

### XIC-D2 — which MS levels an XIC covers

**Question.** Is an XIC taken over MS1 scans only, over every scan in the run, or
over a level the reader chooses?

**What the evidence settles and does not.** `tic` supports an MS-level filter
through `--filter "msLevel <N>"`, and `TicCapability` already grades an
installation's support for it across four states — down to
`SupportedMsLevelFilterUnverified`, where the grammar is declared but no example
confirms it — so a filtered XIC is expressible and separately gateable. Nothing
chooses whether to use it. The chromatogram beside it draws **every** scan the
table holds,
at any MS level, so an XIC that silently filtered to MS1 would not describe the
same scan set as the trace above it — while an XIC that summed a window across
MS1 and MS2 scans together is not a quantity most readers would defend.

**Options.** (a) MS1 only, stated; (b) every scan, matching the chromatogram,
stated; (c) the reader chooses, defaulting to one of the above.

**Consequences.** (a) is the conventional reading and makes the XIC's scan set
differ from the chromatogram's without saying so unless it is said. (b) keeps
the two traces describing one scan set and can produce a scientifically odd
sum. (c) costs a control and a stated default.

**Recommended default, if one is wanted.** (c) defaulting to (a), with the level
named beside the trace itself. It is the only option under which the reader can
tell which scans were summed without being told separately.

### XIC-D3 — what is aggregated inside the window

**Question.** Is each point the **sum** of the intensities inside the window, or
the **maximum** — an extracted base peak rather than an extracted total?

**What the evidence settles and does not.** The M0 spike read ProteoWizard's
pinned `RegionTIC.cpp` and recorded that `tic` reports a **sum of the binary
intensities**, which is why `TicIntensityOrigin` has exactly one variant,
`RecomputedSummedIntensity`. That establishes what the evidenced query does. It
does not establish what this product should offer: the chromatogram already
offers both a total and a base-peak trace over the whole m/z range, and a reader
who has both there may reasonably expect both here.

**Options.** (a) sum only, as the evidenced query produces it; (b) sum and
maximum, if M5.4 finds a query that yields the maximum; (c) sum, with maximum
recorded as a later slice.

**Consequences.** (b) depends entirely on M5.4 finding a second source; it is
not derivable from a summed result. (a) and (c) are the same build and differ
only in what is written down.

**Recommended default.** (c). Ship the aggregation the evidence proves and name
it in the trace's own caption, exactly as the chromatogram names its derived
origin where it is drawn, and record the maximum as unbuilt rather than implying
it.

### XIC-D4 — which query is the source

**Question.** `tic` with an `mz=` window, or `sic`?

**What the evidence settles and does not.** `tic`'s signature is pinned in this
repository, its parser exists and its capability gate exists — but its `mz=`
form has never been run. `sic` is a name in a help listing from one recorded
spike and nothing else: no signature, no output shape, no ordering, no
aggregation, no measurement. This is an evidence question first and a product
decision only if M5.4 finds both usable.

**M5.4 is what makes option (b) answerable.** Its candidate pipeline classifies
`sic` from its installed signature and **measures it wherever that signature
leaves it plausibly applicable**, so the output evidence this decision asks for
is evidence the route actually collects. Nothing here presumes either outcome:
`sic` may prove better, may prove unusable, or may be excluded by its signature
before it is ever run.

**Options.** (a) `tic` with `mz=`, reusing the existing parser and gate; (b)
`sic`, if its signature and output prove to describe an XIC more directly; (c)
neither, if the measurement refuses both.

**Consequences.** (a) is the smallest change and reuses proved code. (b) may
carry different aggregation or ordering semantics, and would need its own
signature constant, capability requirement and parser. (c) triggers the rule for
exit criterion 3.

**Recommended default.** Do not choose before M5.4. If both prove usable, prefer
(a) for the reason the repository already applies elsewhere: the narrower change
against proved code.

#### Amended 2026-08-29: D4 is conditional on how many sources survive

The sentence this replaces read: *"This stays `USER_DECISION_REQUIRED`" — the
repair to M5.4's evidence gate settles how a candidate is closed, not which
candidate wins.* That was written before any candidate had been measured, and it
is unconditional in a way the rest of this section is not: two paragraphs above
it already says D4 "is an evidence question first and a product decision **only
if M5.4 finds both usable**". The two readings disagreed, and M5.4 met the case
that separates them.

**The rule, by how many candidates the evidence admits:**

| Admissible backend sources | D4 |
| --- | --- |
| zero | **not applicable.** The route is `XIC_SOURCE_REFUSED`; there is no source to choose. |
| exactly one | **evidence-determined.** There is no product choice between viable backend sources. |
| two or more | **`USER_DECISION_REQUIRED`.** Evidence establishes the options; governance chooses between them. |

This supersedes the unconditional wording, and only that wording. Everything else
in this section stands, including that M5.4 settles *how* a candidate is closed
and that nothing may presume an outcome before the measurement.

**What M5.4 measured.** Zero admissible sources; the recorded outcome is
`XIC_SOURCE_REFUSED`. So D4 is closed as **not applicable under the refusal
branch**, and M5.5 and M5.6 follow that branch. Which candidates were measured,
why each was rejected, and what a future attempt must re-measure are owned by
[`docs/spikes/M5_XIC_SOURCE_EVIDENCE.md`](../../spikes/M5_XIC_SOURCE_EVIDENCE.md)
and are deliberately not restated here.

#### Amended 2026-08-29: evidence is bound to an executable, not to a help text

Nothing in this ADR previously said what a measured capability conclusion may be
carried to. M5.4 needed that rule and it is recorded here because it outlives the
slice:

> Scientific evidence is transferable only to an executable identity explicitly
> covered by that evidence.

Two builds can print identical help — identical query signature, identical filter
grammar, identical `TicCapability` — while differing in the aggregation they
perform, the numeric precision they serialize, and whether an ordinary window
aborts. A gate that admits on grammar alone admits an implementation nobody
measured. Any future XIC admission, or re-entry after this refusal, requires an
exact executable identity covered by measurement **and** the required exact
capability grammar.

### XIC-D5 — where the XIC is drawn, and against which value axis

**Question.** Is the XIC an additional trace inside the existing chromatogram
panel, or its own panel with its own value axis?

**What the evidence settles and does not.** Nothing settles it. The consequence
is measurable and severe: a chromatogram's total ion current sums every ion in
every scan, and an XIC sums one narrow window, so on a shared linear intensity
axis the XIC is drawn as a flat line on the baseline for most real acquisitions.
`PanelSpec` carries its own value domain and `FigureSpec` has carried a
`Vec<PanelSpec>` since ADR 0028, so both shapes are expressible in a figure. On
screen the question is a measurement, and this ADR does not have it: what M4.4
measured is the height its *export surface* gained, not the height a third plot
would take from the viewer column.

**Options.** (a) one panel, shared value axis; (b) one panel, second value axis;
(c) its own panel below the chromatogram, sharing the retention-time axis and the
viewport.

**Consequences.** (a) is usually unreadable. (b) puts two incommensurable
quantities on one plot with two scales, which invites the reader to compare
heights that cannot be compared. (c) costs vertical space in a column that is
already measured at 614px at 1366×768, and that measurement has to be redone.

**Recommended default.** (c), with the height cost measured at all three
responsive targets before the slice is accepted, exactly as M4.4 measured its
own section. It is the only option in which neither trace's axis lies about the
other.

## UI/UX principles frozen for M5

M5 adds several viewer controls before M7's consolidation. These are frozen so
those controls do not grow inconsistently. **They are not a redesign**: nothing
here restyles the application, introduces a design-system dependency, replaces
the component architecture, touches the workspace or conversion surfaces, or
performs visual polish. M7 owns all of that.

1. **Action hierarchy.** A viewer panel's controls sit in its header's existing
   control row where one exists; a disclosure never adds a row to a panel body
   that clips. Primary, secondary and link affordances keep their current
   meanings.
2. **Disabled and unavailable posture.** A control is available exactly when
   activating it would do what it says. Where it is closed, the reason names
   something the reader can change. An unavailability that arrives while the
   reader is elsewhere is announced; becoming available again is not.
3. **Loading, busy and result posture.** A running operation names the surface
   it belongs to and stops claiming a subject it no longer describes. Results
   are reported in a live region rather than a dialog, carry both the summary
   and the part the reader must act on, and are dismissible.
4. **Viewer panel ownership.** One panel owns one question. A panel does not
   render another's result, and shared occupancy — the one scientific export
   lane — closes controls without borrowing the other surface's words.
5. **Keyboard equivalence.** Every pointer interaction a viewer control offers
   has a keyboard route to the same commit. Focus is never taken from the
   control that committed an action.
6. **Accessible naming and live regions.** Every control's accessible name says
   what it acts on, so two surfaces offering the same verb are distinguishable.
   A live region is mounted from first paint and emptied, never mounted with its
   message.
7. **Responsive evidence targets.** 1920×1080, 1366×768 and 960×640. A control
   added by an M5 slice is proved reachable, hit-testable and operable at all
   three, and any height a slice adds is measured at all three.
8. **Scroll ownership.** The accepted arrangement stands: the viewer column
   scrolls, an export surface owns its own scroll, and a plot claims a wheel
   only where applying it would change the effective rendered domain.

## What M5 prepares for M6 and M7 without implementing either

**For M6 — Conversion Completion.** M5.4 extends the repository's
capability-evidence discipline to a second `msaccess` query family: a signature
captured from the installed build, a requirement that gates the operation before
a process starts, and a live measurement recorded as a spike. M6 needs exactly
that shape to widen conversion — CNV-002's mzXML gate and any further vendor
family are the same question asked of `msconvert`. M5.7 also settles how the
viewer behaves while a conversion holds the backend, which is the boundary M6
will press on hardest as conversion grows. No conversion behaviour changes in
M5.

**For M7 — UI/UX and Public Product Hardening.** The principles above are frozen
here and applied by every M5 slice, so M7 consolidates a coherent set rather
than reconciling drift across controls that grew separately. M5.7 produces the
single unavailability posture M7 generalizes beyond the viewer. M5.2's viewport
controls arrive under the same availability rule ADR 0033 established, so M7
inherits one rule rather than three. Touch semantics and the preview cache are
named as M7's with their reasons, so M7 starts with a scoped list rather than a
survey. No restyling happens in M5.

## Inherited from M4, carried truthfully

M4 is complete and is not reopened. These are recorded so M5 does not inherit
them silently.

### Environment residuals from M4.4, still open

- **The native save dialog is not automated.** It does not appear inside the
  automated WebView2 session on the development machine, and all five
  pre-existing M4.2 native cases fail there in the same way. Product code was
  not changed to automate it; the boundary rules it would exercise are proved at
  the Rust boundary instead.
- **`Copy plot`'s finished outcome is not proved on the real WebView.** That
  Windows session's clipboard cannot be opened by any process, so the case skips
  and prints why. The clipboard path itself is exercised in Rust.
- **Live ProteoWizard evidence was NOT RUN for M4.4.**
- **Different-owner and non-reconciling-row linked cases are proved at the Rust
  boundary only.** The seeded session holds one dataset and one spectrum;
  reaching a second of either needs a real ProteoWizard installation.

The third of these is the one M5 must act on rather than merely record: **M5.4
requires a live measured run**, so an M5 executing on a machine with no real
ProteoWizard installation cannot complete criterion 3 and must stop at that
slice rather than substitute a fixture for a measurement.

### A factual correction that does not reopen M4

M4.4's frontend test count is **1,051**, measured on `b77e5e8`. Two documents
said 1,050 — a count from the commit before the closure round added one — and
both are corrected in place. Nothing else about M4.4's evidence changes, and no
milestone claim moves.

### M4.4 confirmation findings, inherited as technical debt

M4.4's final confirmation review recorded four findings. They did not block M4
completion, none of them had been repaired when this route was written, and each
was inherited here as explicit debt rather than represented as fixed. This
route-lock slice changed no production code, so it repaired none of them; what it
did was give each one an owning M5 slice.

Each was re-confirmed against `b77e5e8` while this route was written, and the
location is cited so the next reader does not have to find it again.

**Amended 2026-08-30 by M5.8: all four are now closed.** The findings below are
left exactly as recorded, because they are the history this document exists to
keep; each carries its disposition, verified against `main` at closure rather
than assumed from the slice that owned it.

| Finding | Disposition | Verified |
| --- | --- | --- |
| P3-1 | **CLOSED by M5.3** | `_validate_linked_pair_module_adds_no_route` in `scripts/check_repo.py` |
| P3-2 | **CLOSED by M5.7** | the linked section's comment in `ChromatogramExportPanel.tsx` |
| P3-3 | **CLOSED by M5.7** | one accessible occurrence, announcement intact |
| P3-4 | **CLOSED by M5.3** | the block sits on `scientificExportBusy` in `usePreviewWorkspace.ts` |

**P3-1 — the single-constructor guard has a scanning blind spot.**
`_validate_linked_pair_has_one_constructor` in
[`scripts/check_repo.py`](../../../scripts/check_repo.py) asks
`functions_naming` which functions call `LinkedPair::new`, and
`functions_naming` recognises a function definition only at exactly four spaces
of indentation. `mod linked_pair` sits at column zero in
[`export.rs`](../../../apps/desktop/src-tauri/src/preview/export.rs), so its
`impl` block is at four and every method inside it — `new` included — is at
eight. A wrapper function added *inside* that module and calling the constructor
would therefore not be seen as its own function, and the guard's
`builders == {"linked_pair"}` comparison would not describe it.

What is **not** affected: there is no current production bypass; the compiler
half of the boundary is intact, because the private fields inside
`mod linked_pair` still make a struct literal a compile error everywhere else
and `LinkedPair::new` is still `pub(super)`; and the cross-file rules that pin
the two single-source readers as private and unused by siblings are unchanged.
The debt is that one repository rule is weaker than it reads.

**Owner: M5.3**, the first M5 slice that changes `preview/export.rs`, with M5.8
as the backstop.

**CLOSED by M5.3**, and the backstop was not needed.
`_validate_linked_pair_module_adds_no_route` reads `mod linked_pair` directly
rather than through `functions_naming`, so the four-space blind spot cannot
apply: it holds the module to a closed method list, rejects `LinkedPair::new` and
`Self::new` called from inside the module, and requires exactly one `Self {`
literal -- the two ways in that the module's private fields make legal here and
nowhere else. A wrapper added inside the module now fails the rule that could not
see it.

**P3-2 — a comment describing a shape that was replaced.** The first comment
block above the linked section in
[`ChromatogramExportPanel.tsx`](../../../apps/desktop/src/features/mzml-preview/ChromatogramExportPanel.tsx)
still says the section is *one sentence, in one element that is a live region
from the start* — the `42ba0a2`-era shape. `8efdd59` replaced it: the shipped
composition is two elements, a visible paragraph that is not live and a separate
hidden live region, which the comment block immediately below it describes
correctly. The two comments now disagree about the code they sit on.

**Owner: M5.7**, which rewrites this section's availability messaging.

**CLOSED by M5.7.** The comment now describes the composition the file has: one
sentence at a time, in whichever of two elements the reader's situation calls
for, and never both.

**P3-3 — the linked refusal is in the accessibility tree twice.** When the
linked section cannot be used, the same sentence is rendered by the visible
paragraph *and* by the hidden `aria-live` region beside it. `visually-hidden`
removes an element from the page, not from the accessibility tree, so a reader
traversing the section meets the refusal once as the paragraph the three buttons
point `aria-describedby` at, and again as the live region's content.

**This remains a known P3 and must not be described as fixed.** It is not the
live-region defect `42ba0a2` and `8efdd59` closed — announcement works — it is
duplication in what a traversal reads.

**Owner: M5.7.** It is the same question that slice exists to settle: how a
surface says it cannot be used right now, once, in a way a screen reader hears
once.

**CLOSED by M5.7.** One permanent live region carries the refusal *visibly* and
empties on recovery; the ordinary description is a separate element rendered only
when there is no refusal. One accessible occurrence in either state, announcement
intact, and becoming usable stays silent. Collapsed out of flow rather than with
`display: none`, which would have taken the region out of the accessibility tree
and left it arriving with its first sentence -- pinned, along with the single
occurrence, by tests.

**P3-4 — a documentation block separated from what it documents.** In
[`usePreviewWorkspace.ts`](../../../apps/desktop/src/features/mzml-preview/usePreviewWorkspace.ts),
the block beginning *Whether the session's one scientific export lane is
occupied* documents `scientificExportBusy`, and the
`useState<LinkedFigureExportState>` declaration M4.4 introduced sits between the
two. This is the third instance of one insertion mistake: `42ba0a2` moved two
stranded comments, `8efdd59` corrected one of those moves, and this one was not
found by either.

**Owner: M5.3**, which adds the selected spectrum's range scope in this region
of the file.

**CLOSED by M5.3.** The `useState<LinkedFigureExportState>` declaration now sits
above the block, and the block sits directly on the `scientificExportBusy` it
documents, with nothing between them.

M5 inherited all four. None of them was a reason to reopen M4, and none of them
was repaired by this documentation-only slice -- M5.3 and M5.7 repaired them, and
M5.8 verified each against `main` and recorded the disposition above.

## Consequences

- The next milestone finishes the viewer instead of hardening an unfinished one.
- XIC gains an evidence gate in front of it, and the gate is a real branch: the
  slice graph, the boundary statement and the exit criteria all reach closure on
  either outcome, so the one scientific capability M5 could most easily fake
  cannot be faked quietly — and refusing it does not strand the milestone.
- `M5 COMPLETE` is defined by what the evidence admitted rather than by a fixed
  feature list, and says which of the two it means.
- A valid scientific source need not be renderable. Where the existing figure and
  domain contract cannot admit a viewport without changing the source, MSCanvas
  refuses the viewport rather than changing the science — and the route says that
  in the slices rather than leaving it to whoever meets the first descending m/z
  array.
- Five product decisions that would otherwise have been made by whoever wrote
  the code are visible before the code exists.
- Multi-layer comparison stops being described as a near-term viewer feature and
  gains named owners for the contracts it actually needs.
- Two milestones' worth of previously planned work is renumbered, and nothing
  M0–M4 recorded changes meaning.
