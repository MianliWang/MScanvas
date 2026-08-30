# ADR 0042 — M5 Viewer Completion: closure, refusal and handoff

Status: accepted
Date: 2026-08-30
Related: [0037](0037-viewer-completion-route.md),
[0038](0038-spectrum-viewport-authority-and-screen-projection.md),
[0039](0039-visible-spectrum-viewport-adapter.md),
[0040](0040-spectrum-range-export.md),
[0041](0041-viewer-selection-availability.md)

## What this ADR is

M5.8, the closure slice. It implements no viewer capability. It answers
[ADR 0037](0037-viewer-completion-route.md)'s exit criteria from published
evidence, closes the XIC branch under the outcome M5.4 measured, and hands what
M5 produced to M6 and M7.

**It is a citation document.** The scientific and runtime evidence stays where it
was written; nothing here is retold, because a retelling is a second thing that
can drift from the first.

```text
M5.0 COMPLETE   M5.1 COMPLETE   M5.2 COMPLETE   M5.3 COMPLETE
M5.4 COMPLETE — XIC_SOURCE_REFUSED
M5.5 NOT_APPLICABLE             M5.6 NOT_APPLICABLE
M5.7 COMPLETE   M5.8 COMPLETE

M5 COMPLETE     M6 NEXT / UNSTARTED
```

**`M5 COMPLETE` does not mean XIC exists.** It means every Viewer Completion
capability M5's evidence gates could honestly admit was delivered, and every one
they refused was recorded, given an owner and a re-entry path, and not
approximated.

## The eight exit criteria

| # | Criterion | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Spectrum viewport, both paths | **PASS** | [ADR 0038](0038-spectrum-viewport-authority-and-screen-projection.md), [ADR 0039](0039-visible-spectrum-viewport-adapter.md); `viewer/spectrumViewport.test.ts`, `SpectrumViewport.test.tsx`, `SpectrumViewportBinding.test.tsx`; `e2e/specs/m5.2-spectrum-viewport.{browser,tauri}.e2e.ts` |
| 2 | Selected-spectrum export, both paths | **PASS** | [ADR 0040](0040-spectrum-range-export.md); `SelectedSpectrumExport.test.tsx`, `SelectedSpectrumExportBinding.test.tsx`, `preview/export.rs` and `preview/tests.rs`; `e2e/specs/m5.3-spectrum-range-export.{browser,tauri}.e2e.ts` |
| 3 | A visible XIC | **NOT_APPLICABLE — evidence-gated refusal** | [`M5_XIC_SOURCE_EVIDENCE.md`](../../spikes/M5_XIC_SOURCE_EVIDENCE.md), outcome `XIC_SOURCE_REFUSED` |
| 4 | XIC linked selection | **NOT_APPLICABLE — `XIC_SOURCE_REFUSED`** | same; there is no XIC surface to select on |
| 5 | Selection availability | **PASS**, with the `convert` ref/render window named as a pre-existing exception the route excluded | [ADR 0041](0041-viewer-selection-availability.md); `viewerSelectionAuthority.test.tsx`, `SelectionAvailability.test.tsx`, `Chromatogram.test.tsx`, `SpectrumTable.test.tsx`; `e2e/specs/m5.7-selection-availability.{browser,tauri}.e2e.ts` |
| 6 | Multi-layer comparison | **DEFERRED** | M8 (layer identity and provenance), M9 (comparison semantics) |
| 7 | Bounded preview cache | **DEFERRED / OPTIMIZATION_ONLY** | M7, and only on a measurement showing a need |
| 8 | Vendor-format direct preview | **DEFERRED / EVIDENCE_GATED** | M6, behind its own evidence slice |

### Criterion 1, both paths

**Where a domain is admitted**, the committed m/z viewport zooms, pans and resets
by wheel, drag, keyboard and button; each control is offered exactly when
pressing it would change what is drawn; reset means the whole admitted source
domain; and the drawing is a bounded projection of the complete spectrum Rust
retains — so zooming past the transferred prefix shows retained observations
rather than the end of an array. Moving the viewport launches no ProteoWizard
operation and re-reads no acquisition: `SpectrumViewportBinding.test.tsx` pins
that a committed window asks for its projection once, asks again only under a
new generation, and *asks for nothing at all where the domain is refused*.

**Where the contract refuses a domain**, the refusal is explicit and no
substitute is manufactured — nothing sorts, reorders, min/maxes or normalizes the
source to invent one. No viewport control pretends to act. The spectrum stays
selected, stays drawn over its own points, and keeps the capabilities that remain
true of it.

Viewport availability is **per spectrum, never universal**, and this closure does
not describe it otherwise.

### Criterion 2, both paths

The five capability questions stay separate: valid source data, figure
admissibility, viewport-domain admissibility, full-source export and
current-range export.

**Where the domain and the figure contract admit**: Full and Current each over
SVG, PNG, `Copy plot`, CSV and TSV. **Where either refuses**: no viewport means
no `Current` scope at all — not a synthesised range and not a full-source export
wearing that name — the three figure formats keep their existing typed refusal,
and Full CSV and TSV still write.

Also proved, and each is a way this could have been quietly wrong: a window the
retained source does not have is **refused rather than clamped**
(`a_window_outside_the_retained_source_is_refused_rather_than_clamped` in
`preview/tests.rs`); a gesture in flight is not export authority — the
**committed** range is; the screen projection is never export authority, because
the range resolves in Rust against the retained snapshot; a discrete
representation draws only real in-range peaks and interpolates no boundary
observation; and an empty Current range is a truthful empty document rather than
an invented one.

### Criteria 3 and 4, closed as refused

M5.4 measured a real ProteoWizard `3.0.26013 (47b13cf)` installation and recorded
**`XIC_SOURCE_REFUSED`**. No query the build offers can serve as a general XIC
scientific source: four of its eight analysis queries cannot express an m/z window
at all, and of the four that can, `tic`, `sic` and `slice` serialize intensity at
four fixed decimal places — mapping a real low-intensity signal onto the same text
as a true zero — while `image` renders a gel with no per-scan quantity or
identity and produced no usable output on either pinned source.

So **M5.5 and M5.6 did not run**, no pseudo-XIC was substituted at any point, and
**no visible XIC exists**. Criterion 4 has no surface to be about: without an
admitted source there is no XIC to select on, and the one selected-scan authority
the chromatogram and the scan table share remains the product state. Neither is
skipped or outstanding; both are closed.

**The re-entry posture is exact, and narrower than it looks.** Another executable
does not inherit this evidence because its help text, signature or capability
grammar resembles the measured one — two builds can print identical help while
differing in the aggregation performed, the precision serialized and whether an
ordinary window aborts. Re-entry requires all of:

1. **an executable identity covered by fresh evidence** — the exact
   `msaccess.exe` digest, recorded in the spike's re-entry gate and checked by
   repository validation against the measured-build table it came from, plus the
   required exact help/capability grammar;
2. **a resolved numeric-fidelity answer** — either a serialization that preserves
   the zero/non-zero distinction over the mzML domain MSCanvas supports, or a
   precision control that is declared, measured to change `sumIntensity`
   serialization as required, and capability-gateable;
3. **re-measurement of everything this record establishes.** Not a formality and
   not covered by the first two: both defects M5.4 found — the four-decimal
   serialization and the singular-parabola abort on an ordinary wide window — are
   implementation properties **invisible in help text**, and so is the
   aggregation each query performs. A build can match the grammar, fix the
   precision, and still aggregate differently or fail on a window a reader would
   actually ask for.

**VIEW-007's owner is M6**, and the gate is the condition rather than the owner.
M6 is the milestone that measures this backend's capabilities against a build, so
a different `msaccess` is measured there or nowhere. If such a measurement admits
a source, the visible XIC becomes a viewer slice scheduled at that point — and a
reusable XIC artifact or export remains M9's, on M8 artifact identity, exactly as
it would have been had M5.4 admitted one. M9's backlog entry was written as *if
M5 admitted an XIC*, a condition that can no longer be met; it now covers XIC
re-entering after M5 instead, so the artifact this closure routes there has
somewhere to land.

### Criterion 5

Both surfaces that commit a scan — the chromatogram and the scan table — read one
selection-start authority, which carries its reason as well as its answer. An
unavailable selection gives **one** truthful explanation, in one accessibility
occurrence, that both surfaces point at, and every backend-free interaction stays
available while it says so. Operation-side and rendered readers share one rule:
the boolean the operation guards itself with is a projection of the same value
the surfaces render, over every combination of the lane's four facts.

The lane is the queue slot **or** a retry this document has dispatched. An
adoption and a diagnostics export are not the lane — neither claims the guarded
ref, and the operation accepts a click through both.

**One window remains where an activation can still do nothing without saying so,
and it is stated rather than smoothed over.** `convert` claims the guarded ref
the moment it dispatches, and no rendered value follows until the slot is read
back; inside that window the operation refuses while the surfaces still say
available. It is not a defect this slice introduced or could close: it is the
same window every conversion-gated control in this interface has, ADR 0037
recorded it before M5.7 began, and M5.7's scope excluded it explicitly because
closing it belongs to the conversion lane's contract rather than to a viewer
adapter. **Owner: M6**, if conversion's growth makes it worth closing.

So criterion 5 passes for the availability rule it is about — one authority, one
reason, one occurrence, nothing taken away that needs no backend — and does not
claim the conversion lane's own dispatch race was closed with it.

M4.4's P3-2 and P3-3 were closed by the same slice; their dispositions are in
[ADR 0037](0037-viewer-completion-route.md#m44-confirmation-findings-inherited-as-technical-debt).

## The three milestone-wide conditions

| Condition | Disposition | Evidence |
| --- | --- | --- |
| A — no unimplemented viewer feature described as implemented | **PASS** | audit below |
| B — every M5 control satisfies the frozen principles at all three responsive targets | **PASS** | evidence index below |
| C — the local gate set passes unchanged | **PASS** | M5.8's own run, recorded in `BOOTSTRAP_STATUS.md` |

### A — what the current surfaces say

Audited across `FEATURE_CATALOG.md`, `ROADMAP.md`, `BOOTSTRAP_STATUS.md` and the
accepted M5 ADRs. The current truths each of them states:

- **VIEW-007 is unimplemented**, and its evidence gate is answered
  `XIC_SOURCE_REFUSED` for the measured executable;
- **VIEW-008 is deferred**, to M8 and M9;
- **no XIC export exists**, and none is claimed;
- **M5.5 and M5.6 are `NOT_APPLICABLE`**;
- current-range selected-spectrum export is **conditional on a viewport
  existing**;
- valid source data is **not** described as universally figure- or
  viewport-admissible.

Historical prose stays historical. Route-lock text written before the measurement
discusses both branches as they were then planned, and that is correct history
rather than a claim about what was found — repository validation already
distinguishes the two, requiring the *current* status regions of all three
governed documents to carry the spike's outcome under their own identity.

### B — the responsive and interaction evidence index

Cited rather than re-run, because each was published with its measurements:

| Question | Where it was proved |
| --- | --- |
| 1920×1080, 1366×768, 960×640 | `m5.2-spectrum-viewport.browser`, `m5.3-spectrum-range-export.browser`, `m5.7-selection-availability.browser` |
| keyboard equivalence | the same three, plus `SpectrumViewport.test.tsx` and `SpectrumTable.test.tsx` |
| a control is offered only when pressing it would do something | ADR 0038/0039 productivity rule; ADR 0041 availability projection |
| accessible naming and live regions | ADR 0041; `SelectionAvailability.test.tsx` |
| scroll ownership | ADR 0039's measured column arithmetic; the viewer column's flex/grid split in ADR 0041 |
| no hidden or unreachable new control | the three browser suites' overflow and box assertions |

M5.8's own run of `e2e:browser` re-executed all nine browser suites against the
assembled current viewer, so the combined posture is confirmed rather than
assumed from three separate slices.

## Deferred work, with owners

| Item | Owner | Why it is not M5's |
| --- | --- | --- |
| VIEW-008 layer identity and provenance | **M8** | needs several runs loaded at once, a layer identity `FigureSpec` has no concept of |
| VIEW-008 comparison and normalization semantics | **M9** | a normalization this product has not admitted |
| Reusable XIC artifact/export, if XIC re-enters | **M9**, on M8 artifact identity | M5 writes no XIC artifact and claims none; it does **not** route to M6 or M7 |
| Bounded preview cache | **M7**, gated on measurement | M5 supplied no reason to introduce one |
| Chromatogram touch semantics | **M7** | deliberately undecided |
| Vendor-format direct preview | **M6**, behind its own evidence slice | conversion support is not direct-preview support |
| `convert` ref/render availability window | **M6**, if conversion's growth makes it worth closing | a conversion-lane contract question, not a viewer one; recorded before M5.7 and excluded from its scope |
| VIEW-007 re-entry | **M6**, for the re-measurement | M6 is the milestone that measures this backend's capabilities against a build, so it is where a different `msaccess` would be measured. Admission would schedule a new viewer slice at that point; a reusable XIC **export** stays M9's |

## M6 readiness

**The capability-evidence discipline, which is M5.4's durable output.** M6 widens
conversion; it should apply the same shape to `msconvert` that M5.4 applied to
`msaccess`:

```text
exact installed capability/signature
  → exact executable/build identity
  → representative and live measurement
  → scientific and runtime classification
  → admission, or an explicit evidence refusal
```

**Evidence does not transfer between executables because help text looks
identical.** That rule is ADR 0037's, was established by measurement, and applies
directly to CNV-002 mzXML, to any additional vendor family, and to any
direct-preview investigation M6 elects to open.

**The viewer/conversion lane boundary is frozen and inherited.** The queue slot
and a dispatched retry own the one backend lane; an adoption and a diagnostics
export do not; and `conversion.busy` is *not* synonymous with backend-lane
ownership. The `convert` ref/render window is handed over open, described, and
unclosed by design.

**Conversion support is not direct-preview support.** Thermo RAW, Shimadzu LCD
and SCIEX WIFF conversion evidence says nothing about whether `msaccess` can
serve metadata, spectrum table or binary preview directly against those sources.
M6 needs its own gate for that.

## M7 readiness

M7 inherits the frozen viewer action hierarchy and, with it, the principles M5
proved rather than asserted: **availability means activating would do what it
says**; an unavailable action has **one understandable reason**; live regions are
**mounted before they have anything to say** and collapsed out of flow rather
than out of the accessibility tree; keyboard equivalence; the three responsive
targets; and explicit scroll ownership.

M5.7's single selection-unavailability posture is the pattern to generalize to
click surfaces outside the viewer.

Explicitly deferred to M7: **chromatogram touch semantics**, still undecided; and
a **bounded preview cache**, only after measurement shows a need.

### Environment and QA residuals, inventoried rather than hidden

None of these is a product defect on current evidence, and none is reclassified
as one here:

- **the native save dialog is not automated** in the WebView2 session on the
  development machine — inherited from M4.4, and the boundary rules it would
  exercise are proved in Rust instead;
- **clipboard and window-focus limitations** in that session, which is why two
  real-shell copy cases fail there;
- **three wider Tauri suite failures** reproduced by M5.7 — one figure-settings
  theme default and two clipboard cases — each reproduced on `main` with the
  slice stashed and the binary rebuilt, and therefore environmental.

## The async-surface rule

ADR 0037 names two possible async surfaces. Both are answered.

**The spectrum screen projection — required on this branch, and delivered.** Its
fourteen questions are answered by ADR 0038's contract and ADR 0039's adapter,
and pinned by `SpectrumViewportBinding.test.tsx` and `SpectrumViewport.test.tsx`:

| Question | Where |
| --- | --- |
| identity | the window is asked for the spectrum's own admitted domain, and a projection belongs to the spectrum it was asked for |
| validation | a refused domain asks for nothing at all |
| loading, success, empty | the panel's own states; a spectrum reporting no points asks for nothing |
| partial posture | a bounded projection is never presented as the whole source |
| typed failure, retry | retry re-asks the same window under a new generation and moves nothing |
| supersession, stale response, old-result visibility | a late answer or a late failure for a replaced spectrum is discarded; two commits before an answer keep only the second |
| recovery | a refused window is not a reason to re-probe the backend |
| accessibility, rendered evidence | `SpectrumViewport.test.tsx` and `m5.2-spectrum-viewport.browser` |

**The XIC query — `NOT_APPLICABLE`, `XIC_SOURCE_REFUSED`.** Its fourteen-state
visible lifecycle was never implemented, because the scientific source gate
refused before M5.5 and M5.6 could run. Recorded rather than left silently
absent: the second async surface does not exist, and that is a decision with
evidence behind it.

## What this ADR does not do

- **It does not reopen the route.** ADR 0037 remains the route-lock and history
  authority, including the decisions taken before the outcome was known.
- **It does not restate evidence.** Every criterion above points at the document
  or the test that holds it.
- **It does not implement anything.** No production Rust, no frontend, no CSS, no
  new behaviour and no new tests for behaviour.
- **It does not start M6.**
