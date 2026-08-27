# ADR 0037 — Viewer Completion is the next milestone, and this is its route

Status: accepted
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

### Spectrum zoom, pan and reset — REQUIRED_FOR_M5

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

### Selected-spectrum `Current range` export — REQUIRED_FOR_M5, and dependent

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
and zoom into it; see one scan's spectrum **and zoom into that**; export either
over the whole source or over the range they chose; and never be offered a
selection the session cannot perform.

Conditionally — on `XIC_SOURCE_ADMITTED` — a reader can also extract one ion's
chromatogram from a proved backend source and select a scan on it. On
`XIC_SOURCE_REFUSED` that capability is not delivered, its refusal and the
measurement behind it are recorded, and VIEW-007 is reassigned to a named owner
and re-entry gate. **`M5 COMPLETE` does not by itself mean XIC exists**; it means
every viewer capability that could honestly be admitted under M5's evidence gates
was delivered, and every one that could not was recorded rather than
approximated.

It is not a redesign, it is not persistence, and it is not analysis.

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

### M5.1 — the spectrum viewport authority

**Objective.** A committed m/z viewport with the same properties ADR 0032
established for retention time: one committed range, one transient gesture with
an epoch, total and deterministic arithmetic, and no React, DOM or timers.
**Owning authority.** A viewport contract in
`apps/desktop/src/features/mzml-preview/viewer/`, and the boundary that tells it
which m/z domain the spectrum has.
**User-visible result.** None. The model arrives before the surface, for the
reason ADR 0032 exists.
**Major evidence.** Unit tests over the contract, and the full-domain
constraint stated below, tested rather than assumed — including for a spectrum
whose transferred arrays are truncated.
**Hard non-goals.** No second scan-selection authority. No new state layer in
`ViewerInteractionState` that a chromatogram consumer can read by accident. No
export change. **No Rust parsing, source-retention or scientific-export
behaviour change beyond the bounded projection of the already-retained complete
source m/z domain that the viewport authority contract requires.**
**Predecessor.** M5.0.
**Exit.** The m/z viewport answers, for any input, with a finite forward
interval inside the spectrum's own domain, and a `Current` scope has something
unambiguous to refer to.

One constraint this audit fixes rather than leaving to the slice. The screen and
the export renderer currently disagree about a spectrum's m/z domain on purpose:
`StickSpectrum` widens the drawn domain to cover the reported `mzLow`/`mzHigh`
*and* the transferred points, while `domain_of` in `export.rs` takes the first
and last of the ordered points and documents why it refuses the reported pair.
A viewport built over the screen's wider domain could commit a range the export
renderer's source does not have, and the rule M5.3 inherits from the
chromatogram is that Rust answers such a range with `RangeRefusal::OutsideSource`
rather than clamping it — which is exactly the defect `clampDomain`'s own comment
records for retention time, where the viewer's clamping could produce a range
Rust would refuse. **The m/z viewport's
full domain must be the one the export source has.**

That invariant is what forces the narrowed non-goal above. The transferred
arrays are bounded at `MAX_SPECTRUM_POINTS` and a spectrum over it arrives as a
prefix marked `truncated`, so for that spectrum the complete first and last
ordered points exist **only** in the `SelectedSpectrumResult` Rust retained. A
frontend-only slice could not establish its own authority there: it would have
either to take a domain from a prefix, describing a spectrum the file does not
contain, or to take `mzLow`/`mzHigh`, which the export renderer documents its
refusal of. So M5.1 may include a strictly bounded contract projection, and the
route requires it to have this shape:

- **Rust remains the source authority.** The endpoints come from the complete
  retained selected-spectrum snapshot, computed the same way the export
  renderer's own domain is.
- **React receives a bounded domain pair — two numbers.** Not the retained
  spectrum, and above all not a widened transfer bound: recovering endpoints is
  never a reason to send more of the arrays.
- **A new field, not a reused one.** `SelectedSpectrum` already carries
  `mzLow`/`mzHigh`, and those are the backend's *separately reported* pair —
  a second reading of the same spectrum, which `domain_of` refuses precisely
  because the two can disagree. Overloading them would make the viewport and the
  export renderer silently describe different things again.
- **React infers the source domain from nothing else.** Not the truncated
  arrays, not SVG geometry, not axis ticks, not DOM state, not rendered viewport
  state, and not pointer coordinates.

M5.0 implements none of this. What is fixed here is the contract the future
slice owes, and the boundary it may cross to meet it.

### M5.2 — the visible spectrum viewport

**Objective.** Make the spectrum viewport reachable: wheel, drag, keyboard and
visible buttons, over the selected-spectrum panel.
**Owning authority.** The spectrum panel's own adapter, consuming M5.1.
**User-visible result.** The selected spectrum zooms, pans and resets.
**Major evidence.** Rendered interaction QA at 1920×1080, 1366×768 and 960×640;
keyboard equivalence for every pointer action; wheel ownership decided by the
same rule ADR 0033's R1.2 established — a wheel is claimed only where applying
it would change the effective rendered domain.
**Hard non-goals.** No backend read on any viewport change. No touch semantics.
No restyling of the panel beyond the controls this slice adds. No change to
what the spectrum's caption claims about its reduction.
**Predecessor.** M5.1.
**Exit.** Every viewport control on the spectrum panel is available exactly when
pressing it would change what is drawn, and no control reads the backend.

### M5.3 — selected-spectrum `Current range` export

**Objective.** SVG, PNG, `Copy plot`, CSV and TSV for the selected spectrum over
the committed m/z viewport as well as the full source.
**Owning authority.** Rust. The range is resolved against the retained spectrum,
never against the transferred arrays or the screen's reduced sticks.
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
**Exit.** A selected spectrum exports over Full or Current in all five formats,
from the retained source, `Current` reads the committed viewport and nothing in
flight, and the window's figure/data behaviour matches the representation the
source admitted.

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

### M5.4 — XIC source and capability evidence

**Objective.** Decide, from a live measured run against a real ProteoWizard
installation, whether an acceptable XIC source exists and which query it is.
**Owning authority.** A spike document under `docs/spikes/`, and the capability
contract in `crates/proteowizard`.
**User-visible result.** None.
**Major evidence.** Complete help from the installed build captured for both
`tic` and `sic`, including `sic`'s exact signature, which this repository has
never held; `tic mz=<low>,<high>` executed on a representative acquisition and
on the pinned synthetic fixture; the output's shape, ordering, completeness
against `MAX_PREVIEW_TEXT_BYTES`, behaviour for a window containing no signal,
and whether its scan identities reconcile with the spectrum table's; the
aggregation the pinned ProteoWizard source actually performs inside the window,
read from the pinned commit rather than inferred.
**Hard non-goals.** No production XIC. No product semantics chosen because a
library supports them. No frontend work.
**Predecessor.** M5.0. Independent of M5.1–M5.3, so it may run alongside them.
**Exit.** One of two recorded outcomes, and the outcome selects the branch.
`XIC_SOURCE_ADMITTED`: a named query with a named aggregation, a named ordering,
a named completeness bound and a capability requirement that can gate it.
`XIC_SOURCE_REFUSED`: a recorded refusal saying an acceptable source was not
established, with the measurement that refused it. On refusal XIC leaves M5 by
the rule below — **it is never approximated**, and the audit's refusals stand:
no base-peak-window substitute, no reconstruction from the incomplete frontend
arrays, and no one-backend-process-per-spectrum workaround over the measured
36,319-spectrum acquisition.

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
**Exit.** An XIC can be requested and typed end to end in Rust, and a build whose
backend cannot serve one says so before a process is launched.

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
one; a selection committed on the XIC reaching the other three; a scan the
loaded table does not contain refused rather than marked; rendered QA at the
three viewport targets; keyboard equivalence for the input and the trace.
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
whose settings and unit posture are explicit — and the viewer still has exactly
one selected scan.

### M5.7 — selection-availability affordance consistency

**Objective.** Decide once how every click surface in the viewer communicates
that a selection cannot be performed right now, and apply it to all of them.
**Owning authority.** One availability rule, read by every viewer click surface
that exists when this slice runs — the chromatogram and the scan table always,
and the XIC as well on `XIC_SOURCE_ADMITTED`.
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

## M5 exit criteria

M5 is complete when, and only when:

| # | Criterion | Required for M5? |
|---|---|---|
| 1 | The selected spectrum has a committed m/z viewport that zooms, pans and resets by wheel, drag, keyboard and button, reads no backend, and offers each control exactly when pressing it would change what is drawn | **Yes** |
| 2 | The selected spectrum exports over the full source or the committed m/z range, as SVG, PNG, `Copy plot`, CSV and TSV, from the retained spectrum, with a range the source does not have refused rather than clamped | **Yes** |
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
completion, **none of them has been repaired**, and each is inherited here as
explicit debt rather than represented as fixed. This route-lock slice changes no
production code, so it repairs none of them; what it does is give each one an
owning M5 slice.

Each was re-confirmed against `b77e5e8` while this route was written, and the
location is cited so the next reader does not have to find it again.

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

**P3-2 — a comment describing a shape that was replaced.** The first comment
block above the linked section in
[`ChromatogramExportPanel.tsx`](../../../apps/desktop/src/features/mzml-preview/ChromatogramExportPanel.tsx)
still says the section is *one sentence, in one element that is a live region
from the start* — the `42ba0a2`-era shape. `8efdd59` replaced it: the shipped
composition is two elements, a visible paragraph that is not live and a separate
hidden live region, which the comment block immediately below it describes
correctly. The two comments now disagree about the code they sit on.

**Owner: M5.7**, which rewrites this section's availability messaging.

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

M5 inherits all four. None of them is a reason to reopen M4, and none of them is
repaired by this documentation-only slice.

## Consequences

- The next milestone finishes the viewer instead of hardening an unfinished one.
- XIC gains an evidence gate in front of it, and the gate is a real branch: the
  slice graph, the boundary statement and the exit criteria all reach closure on
  either outcome, so the one scientific capability M5 could most easily fake
  cannot be faked quietly — and refusing it does not strand the milestone.
- `M5 COMPLETE` is defined by what the evidence admitted rather than by a fixed
  feature list, and says which of the two it means.
- Five product decisions that would otherwise have been made by whoever wrote
  the code are visible before the code exists.
- Multi-layer comparison stops being described as a near-term viewer feature and
  gains named owners for the contracts it actually needs.
- Two milestones' worth of previously planned work is renumbered, and nothing
  M0–M4 recorded changes meaning.
