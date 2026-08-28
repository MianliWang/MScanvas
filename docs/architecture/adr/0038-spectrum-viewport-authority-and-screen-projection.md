# ADR 0038 — A viewport navigates the figure's domain and draws a projection of the source

Status: accepted
Date: 2026-08-28
Related: [0028](0028-figure-renderer-and-semantic-specification.md),
[0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0032](0032-viewer-interaction-and-viewport-state.md),
[0034](0034-chromatogram-export-and-range-scope.md),
[0037](0037-viewer-completion-route.md)

## What this ADR is

M5.1, the first production slice of Viewer Completion. It records the concrete
types and boundaries chosen for the contracts
[ADR 0037](0037-viewer-completion-route.md) fixed; that ADR remains the route
authority and this one does not restate it.

**Nothing is visible.** No zoom, pan or reset control, no wheel or drag, no
loading or error surface. M5.2 makes this viewport reachable; M5.1 proves the
state machine and the source boundary it will stand on.

## Two questions Rust answers, and the frontend does not

**Does this spectrum have a viewport?** It needs an authoritative finite forward
m/z domain, and the scientific figure contract cannot always establish one. mzML
does not require an ordered m/z array and nothing here sorts one, so a legal
spectrum can be valid source data with no domain.

**What does one window of it look like?** The complete spectrum Rust retains is
the scientific source, and `MAX_SPECTRUM_POINTS` bounds what one transfer
carries — so a viewport spanning the whole source while its data stops at that
prefix would draw blank space over peaks this session is holding.

Neither is answerable in the webview. `mz` and `intensity` arrive bounded,
`mzLow`/`mzHigh` are the backend's separately reported pair which the figure's
own domain rule refuses, and neither settles the question for a truncated
spectrum. So both answers come from Rust, over the snapshot the export lane
already retains.

## One admissibility rule, shared rather than reimplemented

The domain a viewport navigates **is** the domain the figure would draw over. A
second, more permissive reader for the viewport is how a screen and an export
renderer come to describe different things, so there is not one:
`SeriesSpec::new`'s coordinate validation is factored into
`validate_measurement_coordinates`, which the constructor itself calls, and both
sides reach it through one predicate over borrowed slices — same rules, same
order, same errors, and asking whether a spectrum is drawable costs no copy of
it.

**Coordinate validity alone is not drawability**, which is the correction Round 2
forced. A spectrum whose every value is finite can still span `-f64::MAX` to
`f64::MAX`, whose width is infinity — and a renderer dividing by it writes `NaN`,
which is why `Domain` refuses such a span. So the shared primitive is
`measurement_domains`, which settles the coordinates *and* both axes in one call
and is the only drawability predicate either side asks: `spectrum_panel` builds
its panel from the domains it returns, and `viewport_domain` admits a viewport
exactly when it succeeds. The two cannot answer differently, because they are one
call.

`viewport_domain` therefore answers `Admitted(Domain)` exactly where
`spectrum_panel` would accept the series, and `Refused(DomainRefusal)` with the
contract's own verdict otherwise — naming *which* question failed, so an
intensity axis the figure will not draw is never reported as unordered or
non-finite m/z. An empty spectrum admits the domain that claims nothing, a
single value at zero — the same answer the exported figure gets, because it is
the same call.

**A refusal is a fact about drawability, never about the source.** Such a
spectrum stays selected, is drawn by the panel as before, and still exports as
CSV and TSV. Nothing is sorted, reordered, normalised or interpolated to obtain
a domain.

## One identity, two readers

The session already retains one complete spectrum, named by an opaque
session-scoped token. The viewport resolves **that** token rather than
introducing a parallel identity: no second cache, no second scientific source,
no second lifetime to keep in step. `SpectrumExportToken` is renamed
`RetainedSpectrumToken` to say what it identifies instead of which consumer came
first; the wire field stays `exportToken`, because what it names has not changed
and renaming it would churn every command that carries one without making
anything truer.

Staleness and revocation come free: `spectrum_for` already refuses a token this
session no longer holds, and the projection reuses it. A projection also takes
**no export lane** — a drawing is not a file, so a reader may pan while one is
being written.

## The bounded screen projection

`complete retained snapshot → committed m/z window → bounded projection →
React`. The window must be inside the source's own domain and is **refused
rather than clamped** where it is not, for the reason M4.3's range already gives.
Because the array is non-decreasing the window is one contiguous run, so it is
found by binary search rather than a scan.

Where the window's observations fit `MAX_PROJECTION_POINTS` the projection is
exact. Where they do not, a deterministic reduction keeps, per column, the
greatest non-negative and the deepest negative **measured** observation at the m/z
the source measured it — `StickSpectrum`'s posture, restated where the complete
source lives. Both signs, because a column holding +100 and −90 must draw both
and keeping the larger magnitude erases measured signal of the other sign.

The bound is `MAX_PROJECTION_COLUMNS = 900`, two per column, so
`MAX_PROJECTION_POINTS = 1_800`. Named rather than implied so a reader can check
the payload bound without doing the arithmetic. **`MAX_SPECTRUM_POINTS` is not
raised** to solve this: the answer to a bounded transfer is a projection, not a
larger transfer.

A projection carries `sourcePoints` and `reduced` beside the arrays, so a reader
sees how many observations the window holds as well as how many were drawn —
`reduced` is checkable rather than a claim.

**Empty is success.** A window may truthfully hold no reported point; nothing is
interpolated to avoid saying so. **Partial is refused**: a bounded reduction is
complete *screen coverage*, so a projection is a complete bounded drawing, an
explicit empty one, or a typed failure — never an undisclosed partial.

## The screen is never the science

Scientific export is a sibling projection of the same retained snapshot, taken
from the complete arrays. There is no `screen projection → export` path and the
types make one awkward to add: `ScreenProjection` exists only as the return of
`project_spectrum` and no document writer sees it. Behaviourally, committing a
viewport leaves a full-source export byte-for-byte identical, which is tested.

## A different spectrum is a different viewport context

The frontend state machine is separate from `ViewerInteractionState` on purpose.
That contract owns the linked run — one retention-time domain, one selected
scan, one commit revision every linked view consumes — and merging the axes would
put a range read for the wrong one a field access away. `MzDomain` is nominally
distinct from `RetentionTimeDomain`, so the substitution does not compile.

A committed selection change to a different spectrum **starts a new context**:
the previous absolute m/z window is not preserved, not intersected and not
clamped in. Two spectra do not share one m/z navigation state merely by
occupying one panel — and a window carried across would be offered as `Current`
for a range the new source may not have. The same token arriving again is a
redelivery, and resets nothing.

## The projection request's lifecycle

Success is not the only state. A commit enters `loading` bound to a generation;
the previous drawing stops being current for the new axes rather than being
shown beneath them; a stale success **and** a stale failure are both no-ops by
identity, so correctness never rests on a callback being cancelled in time; and a
still-current failure keeps the committed window while carrying its own
retryability.

**The two counters never restart.** A gesture epoch and a projection generation
are monotonic across the session: neither restarts when a different spectrum is
selected, neither restarts on `spectrum-cleared`, and a value issued for one
spectrum is never issued again for the next. They live on every state variant
rather than on `ready` alone, so there is no state in which the sequence begins
again.

Restarting them is not merely untidy, it is the race. If spectrum A still has a
request outstanding when B is selected and asks, a per-spectrum counter gives
both requests the same number — and A's late answer then satisfies B's, putting
A's data under B's axes. `interactionState.ts` recorded exactly this about its
own two counters and carries them across a preview change for the same reason.

**Which leaves two facts that are compatible and both explicit.** The viewport
*context* resets when the selected spectrum changes — a new full domain, no
committed window, no gesture, no drawing. The event *identifiers* do not, because
their whole job is to tell a late answer about the old context from a current one
about the new.

## What M5.1 deliberately leaves

Every visible control, the loading and error surfaces, and the adapters that turn
gestures into these events — all M5.2. The `Current`-range export that will
consume the committed window — M5.3.

## Evidence

**Rust: 1,303 tests**, up from 1,262. Twenty-three over the projection module — domain
admission and refusal, window refusal rather than clamping, exact and reduced
drawings, extrema and both signs preserved, determinism, and a window past any
transfer prefix. Eleven through the whole service — the DTO's domain, an
unordered spectrum refused and left alone while its CSV still writes, a stale
token refused, an empty window, a bounded drawing, no backend operation, no
export lane, and a full-source export unchanged across a projection.

**Frontend: 1,090 tests**, up from 1,051. Thirty-nine over the pure viewport:
selection migration across overlapping and disjoint domains, admitted↔refused in
both directions, redelivery that does not reset, gesture epochs and stale
settles, the projection lifecycle including empty success, retryable and
non-retryable failure, retry as a new generation, stale success and stale
failure, two commits before the first answer, a late answer *and* a late failure
for one spectrum while the next has a request outstanding, a stale gesture settle
across a selection, the same across a cleared selection, and the m/z
arithmetic's totality.

**One measured finding, recorded rather than assumed.** `MAX_SPECTRUM_POINTS`
truncation is **not reachable through the text parser**: one formatted point is
about twenty-five bytes, so `MAX_PREVIEW_TEXT_BYTES` refuses a spectrum that
large first. The retained-source property is therefore proved over spectra built
directly, and a service test pins the reachability itself so a later reader does
not have to rediscover it.

**Eleven mutations**, applied one at a time and restored byte-for-byte: the
frontend prefix used as the source domain; an outside-source window clamped
instead of refused; a reduction emitting a value the source did not measure; an
unordered spectrum admitted anyway; a stale token answered; a selection change
inheriting the previous window; a stale projection answer accepted; the counters
restarted per spectrum; the value-domain half of the drawability predicate
bypassed; and drawability re-settled inside the projection path, by two separate
routes — one caught by the counting test, one by the repository guard. Each
failed the check aimed at it.
