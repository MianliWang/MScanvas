# MSCanvas roadmap

This roadmap sequences product risk; it is not the authoritative feature definition. See [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md) and [`docs/product/FEATURE_CATALOG.md`](docs/product/FEATURE_CATALOG.md).

## M0 — Feasibility spikes

- Validate user-installed ProteoWizard discovery and version reporting on Windows.
- Validate `msaccess` or another reviewed route for metadata, TIC/BPC and one spectrum without temporary full conversion.
- Validate `msconvert` process execution, progress parsing, cancellation and partial-output behavior.
- Compare three interactive workspace structures at 1366×768 with representative user tasks.
- Select an on-screen and export renderer after performance and SVG export spikes. **Done** — [ADR 0028](docs/architecture/adr/0028-figure-renderer-and-semantic-specification.md).

## M1 — Data workspace

- Real file/folder picker and Windows Explorer drag-and-drop.
- Logical dataset discovery, duplicate prevention and directory-dataset handling.
- Multi-select, remove selected, clear list, search/sort basics and empty/error states.
- Backend diagnostics and actionable first-run experience.

## M2 — Linked viewer

- Metadata summary, TIC/BPC, spectrum and virtualized scan table.
- Bidirectional linked selection, zoom/pan/reset and keyboard scan navigation.
- Lazy loading and bounded preview cache.

## M3 — Conversion workflow

- Typed conversion settings for mzML; keep mzXML gated until representative multi-source integrity checks pass.
- Queue, cancellation, retry, failure isolation and output-conflict handling.
- Transactional outputs and basic integrity checks.

## M4 — Figure and data export

The renderer foundation is selected and proved: one semantic specification, a
repository-owned screen renderer and a repository-owned Rust export renderer,
with no dependency added. **The milestone is complete**: the selected spectrum,
the chromatogram and the linked two-panel figure of the two all export as
figures and — for the two single sources — as data.

**M4.0 — renderer selection.** Closed. See
[ADR 0028](docs/architecture/adr/0028-figure-renderer-and-semantic-specification.md).

**M4.1 — first visible spectrum export.** Closed. SVG figure export and
underlying CSV/TSV export for the currently selected mzML spectrum, at full
range, written from the complete spectrum Rust retained rather than from the
arrays the interface drew. See
[ADR 0029](docs/architecture/adr/0029-first-visible-spectrum-figure-and-data-export.md).

**M4.2 — PNG, Copy plot and figure settings.** Closed. PNG export and
`Copy plot` for the currently selected mzML spectrum at full range, both
rasterizing the same semantic figure the SVG export writes, plus user-selectable
width, height, PNG DPI and figure theme that SVG honours too. The
selected-spectrum snapshot lifecycle deferred by M4.1 is closed with it. See
[ADR 0030](docs/architecture/adr/0030-png-copy-plot-and-figure-settings.md).

**Viewer Closure R0 — the interaction and viewport state contract.** Closed, and
deliberately not visible. A first attempt at the linked TIC/BPC viewer
(PR #72) worked but drew nine real, reachable review findings across four rounds
-- a suppressed reveal, a late tie-break, a repeated commit nobody could see, a
stale settle overwriting a selection, an off-screen peak setting the y axis --
which read together were one thing: nothing said who owned the viewport, the
selection or the geometry. That PR is frozen as evidence rather than repaired a
tenth time.

R0 is the model those findings were about, written as pure TypeScript with no
React, no DOM and no timers: six separated state layers, one committed viewport
and one transient gesture with an epoch, one selection with a monotonic commit
revision that any number of linked views may consume, hover that cannot outlive
a viewport change, and geometry in which the visible value range comes from the
clipped polyline rather than from source points outside it. See
[ADR 0032](docs/architecture/adr/0032-viewer-interaction-and-viewport-state.md).

**Viewer Closure R1 — the visible linked TIC/BPC viewer.** Closed.
**VIEW-002, VIEW-005 and VIEW-006 are implemented.** The viewer column is three
linked panels: the run's shape over retention time, the scans it is made of, and
the one scan the user chose.

TIC and BPC are per-scan values projected from the loaded spectrum table — each
scan's own total ion current and base peak intensity, at its own retention time.
Not a stored chromatogram record, and the caption says so; neither axis carries a
unit, because nothing that crosses the boundary establishes one. A preview that
did not load the complete table draws no trace at all and says why.

There is one selected scan and one commit revision, held by R0's reducer: a
click in the plot, a click or Enter in the table, and Previous/Next all commit
through one operation, and the marker, the row and the spectrum follow that one
commit. The plot zooms, pans and resets by wheel, drag, keyboard and button, and
none of it reads the backend. R1 is a wiring slice over ADR 0032, and adds no
Rust change, no backend query, no cache and no dependency. See
[ADR 0033](docs/architecture/adr/0033-visible-linked-tic-bpc-viewer.md).

**Viewer Closure R1.1 — the visible adapter.** Closed with R1. The first review
of the visible viewer ran to a fourth round, and its last finding was that the
viewport control group advertised `Zoom in` and `Zoom out` as available where
pressing them changed nothing — in the state the viewer opens in, and for a run
whose scans share one retention time. That PR was frozen as evidence rather than
patched again, and R1.1 was taken from its exact reviewed head so the whole slice
arrives together.

R1.1 replaces three separate availability answers with one rule: a visible
viewport action is available exactly when applying it would change the effective
rendered domain. Every boundary follows from it without being named. See
[ADR 0033](docs/architecture/adr/0033-visible-linked-tic-bpc-viewer.md).

**Viewer Closure R1.2 — pointer-gesture ownership.** Closed with R1. R1.1's pull
request was frozen at its reviewed head in turn, and R1.2 was taken from that
head. The chromatogram had been cancelling the browser's default action for every
non-zero wheel delta, including where the viewport provably cannot move — so at
full range, on a laptop window where the viewer column scrolls, a wheel over the
plot neither zoomed nor let the reader reach the panels below it.

R1.2 makes wheel ownership a consequence of R1.1's rule: MSCanvas may claim a
wheel event only when applying it through the canonical interaction contract
would change the effective rendered domain. Where it cannot, it cancels nothing
and dispatches nothing, and ordinary scrolling stays available. Touch scrolling
over the plot remains statically suppressed and is recorded as open. See
[ADR 0033](docs/architecture/adr/0033-visible-linked-tic-bpc-viewer.md).

**Viewer Closure R1.3 — wheel input normalization.** Closed with R1. R1.2's pull
request was frozen at its reviewed head in turn, and R1.3 was taken from that
head. Its review found that the wheel read one bit of the event — the sign of
`deltaY` — and applied a fixed step per event, so the zoom rate was decided by how
many `WheelEvent` objects a device chose to emit rather than by how far the user
scrolled: from the whole run to the narrowest viewport took 57 events whatever
those events said, and a device that reports a gesture as a stream of small
deltas reached maximum zoom from one flick.

R1.3 reads both `deltaY` and `deltaMode` and maps them continuously, so that
splitting one gesture into more events cannot change where it lands. R1.2's
ownership rule is untouched: magnitude decides what the wheel asks for, and
productivity still decides whether MSCanvas may claim the event. Parity between
physical devices is not claimed — no such measurement was made. See
[ADR 0033](docs/architecture/adr/0033-visible-linked-tic-bpc-viewer.md).

**M4.3 — chromatogram export, over the full run or the current range.** Closed.
The run the viewer draws is now a scientific document: SVG, PNG and `Copy plot`
for the figure, CSV/TSV for the data, each over the whole run or over the range
the viewer has committed to.

The source is the complete per-scan facts Rust retained when the preview was
read — never the bounded rows the interface received, never the screen's clipped
or reduced geometry — and a run whose table could not be transferred whole has no
chromatogram export, because it has no chromatogram on screen. `Current range`
reads the committed viewport and nothing else: a zoom or pan still in flight is
a drawing rather than a decision, and Rust refuses a range the run does not have
rather than clamping it.

A figure and a data file are siblings over one snapshot and one resolved range,
and differ in one place on purpose: a figure draws the segment crossing a window
edge, and a data document contains scans, so a range between two scans is a
figure with a line through it and a table with no rows. Data exports carry both
measured columns whatever the screen shows. One scientific export lane now
serves the spectrum and the chromatogram together. See
[ADR 0034](docs/architecture/adr/0034-chromatogram-export-and-range-scope.md).

**M4.3.2 — a saved file is named as what it holds.** Closed with M4.3. Every
export that opens a native save dialog refuses a destination whose extension does
not describe the document it was asked to write, rather than renaming it: a CSV
published as `trace.svg` is read as an SVG by everything downstream, and the
reachability is a user typing a name. The no-overwrite transaction is unchanged
and composes in front of it. See
[ADR 0035](docs/architecture/adr/0035-export-filename-format-integrity.md).

**M4.4 — the linked two-panel figure.** Closed. **FIG-006 is implemented.** The
run on screen and the scan selected in it export as one figure of two ordered
panels: the chromatogram above, marked at that scan, and the scan's complete
spectrum below. SVG, PNG and `Copy plot`, from the chromatogram's own export
surface, over the full run or the range the viewer has committed to.

It adds no source. Both halves were already separately exportable, and what this
slice decides is what it means to say they describe the same thing: one
operation reads both tokens without letting go, proves one dataset owns them, and
reconciles the selected spectrum against the **exact retained row** at its index.
Same dataset is necessary and not sufficient, and retention time is never the
key — scans may share one, so a lookup by time could not say which was selected.
The marker's coordinate is the matched row's own number, and nothing the
interface holds can move it.

A selected scan outside the requested range is a refusal rather than a widening,
a pan or a settled gesture. The lower panel is always the complete spectrum,
because a chromatogram range says where a scan sits in a run and not which of its
peaks are real. There is no linked data document: a combined table would have to
interleave two different measurements or drop the link.

No contract change was needed. The renderer has carried a `Vec<PanelSpec>` since
ADR 0028; `FigureSpec`'s schema version stays 2, and the two-panel minimum height
of 260 is the contract's own arithmetic rather than a number written down beside
it. The one scientific export lane now serves three surfaces. See
[ADR 0036](docs/architecture/adr/0036-linked-chromatogram-spectrum-figure.md).

What M4 left outside it:

- A saved `FigureSpec` (FIG-007) and a figure composer (FIG-008). Still outside.
- Current-range export of a *selected spectrum*. **Delivered since, by M5.3**,
  for a spectrum whose m/z viewport the scientific figure contract admits.
- XIC and multi-layer comparison. Still outside.
- Spectrum zoom/pan. **Delivered since, by M5.2**, for a spectrum whose m/z
  domain the scientific figure contract admits.

## M5 — Viewer Completion

**Complete, on the `XIC_SOURCE_REFUSED` branch.** M4 finished the export lane;
the viewing workflow it exports from was missing capabilities a reader meets in
normal use. M5 completed it before conversion is widened and before the product
is redesigned. The closure record — every exit criterion with its disposition and
evidence, the deferred owners, and the M6/M7 handoff — is
[ADR 0042](docs/architecture/adr/0042-viewer-completion-closure-and-handoff.md).

**`M5 COMPLETE` does not mean XIC exists.** It means every Viewer Completion
capability the evidence gates could honestly admit was delivered, and every one
they refused was recorded, given an owner and a re-entry path, and not
approximated.

- M5.0 — **complete** (route lock, documentation only).
- M5.1 — **complete** (the m/z viewport authority and the bounded projection).
- M5.2 — **complete** (the visible spectrum viewport).
- M5.3 — **complete** (selected-spectrum `Current range` export).
- M5.4 — **complete** (XIC source and capability evidence);
  outcome **`XIC_SOURCE_REFUSED`**.
- M5.5 — **`NOT_APPLICABLE`** (the XIC model and runtime).
- M5.6 — **`NOT_APPLICABLE`** (the visible XIC, and linked selection).
- M5.7 — **complete** (selection-availability affordance consistency).
- M5.8 — **complete** (Viewer Completion closure and handoff).

**Zoom, pan and reset reach a spectrum whose domain is admitted, and only
those.** A spectrum the figure contract cannot give an authoritative finite
forward m/z domain — mzML permits an m/z array the ordered-series contract
refuses, and nothing here sorts one — keeps an explicit refusal instead. It
stays selected, stays drawn over its own points, and still exports as full-source
CSV and TSV. "The selected spectrum zooms" is true per spectrum, never
universally.

The route, its exit criteria, the live gap audit it was decided from and the
five product decisions it surfaces are in
[ADR 0037](docs/architecture/adr/0037-viewer-completion-route.md). In summary:

- **M5.0 — orientation and route lock.** This slice. Documentation only.
- **M5.1 — the spectrum viewport authority, and the screen-projection
  foundation.** **Closed.** A committed m/z viewport with the properties ADR 0032
  established for retention time, over the domain the scientific figure contract
  admits — and an explicit refusal where it admits none, because mzML permits an
  m/z sequence that contract will not accept and nothing here sorts one. Plus the
  contract by which a viewport obtains something to draw: a bounded,
  viewport-scoped projection of the complete spectrum Rust retains, because
  `MAX_SPECTRUM_POINTS` bounds one transfer and a prefix must never be presented
  as the whole source. No surface yet — and none added: M5.1 is the model, the
  Rust authority and the bounded projection, with every visible control left to
  M5.2. See [ADR 0038](docs/architecture/adr/0038-spectrum-viewport-authority-and-screen-projection.md).
- **M5.2 — the visible spectrum viewport.** **Closed.** Where a domain is
  admitted, the selected spectrum zooms, pans and resets by wheel, drag,
  keyboard and button, and a committed viewport draws the retained source across
  its whole domain — including past the transferred prefix — without re-reading
  the acquisition or launching ProteoWizard. Where a domain is refused, the
  panel says so, the spectrum stays selected and drawn, and no control pretends
  to act. An adapter over M5.1 and nothing more: no Rust file changed, no
  command was added, and the two sentences that described the drawing as the
  transferred prefix were corrected because a viewport made them false. See
  [ADR 0039](docs/architecture/adr/0039-visible-spectrum-viewport-adapter.md).
- **M5.3 — selected-spectrum `Current range` export.** **Closed.** Every format
  that spectrum already supports — all five where the figure contract admits it,
  CSV and TSV where it refuses it — over the full source, and over the committed
  m/z range wherever a viewport exists, resolved in Rust against the retained
  spectrum and refused rather than clamped where that spectrum does not have the
  window. Where no viewport exists there is no `Current` scope — no synthesised
  range, no sorted source, and no full-source export labelled as a current one.
  A range figure keeps the complete source series and declares a window over it,
  scaled from the observations that window holds so an off-window peak cannot
  flatten it; a discrete representation draws only real in-range peaks and
  interpolates no boundary value, and a data document invents no measurement at
  any range. Full data documents stay schema version 1 byte for byte, and a range
  is schema version 2 with the resolved bounds and both point counts in it. The
  linked two-panel figure is untouched: its lower panel is still the complete
  selected spectrum. This slice added a **range** to what a spectrum already
  exported; it added no format and built no figure the existing contract refuses.
  See [ADR 0040](docs/architecture/adr/0040-spectrum-range-export.md).
- **M5.4 — XIC source and capability evidence.** **Closed, outcome
  `XIC_SOURCE_REFUSED`.** An evidence slice, measured against a real ProteoWizard
  `3.0.26013 (47b13cf)` installation on the pinned synthetic fixture, the pinned
  public representative acquisition and a generated low-intensity fixture. Of the
  build's eight analysis queries four cannot express an m/z window at all and are
  excluded by their own signature; the four that can were each measured and each
  rejected, on two grounds rather than one — `tic`, `sic` and `slice` on a
  serialization that cannot distinguish a real low-intensity signal from a true
  zero, and `image` independently, on its own output contract, which is a
  rendered gel with no per-scan quantity or identity. The measurements, the
  candidate-standard matrix that closes every candidate to one standard, and the
  six refusal conditions are in
  [the spike](docs/spikes/M5_XIC_SOURCE_EVIDENCE.md), which is the authority for
  all of them and is not restated here.

  **XIC is refused for this executable, not for all time.** The re-entry gate is
  the three conditions
  [the spike](docs/spikes/M5_XIC_SOURCE_EVIDENCE.md) records — including
  re-measuring everything that record establishes, because aggregation and the
  singular-parabola abort cannot be read off a help text — and it is cited rather
  than restated in a shorter form. Owner: M6. No XIC was implemented, no
  approximation was substituted, and no production code changed.
- **M5.5 — the XIC model and runtime.** **`NOT_APPLICABLE`.** It was conditional
  on an admitted source, and M5.4 measured a refusal. The typed operation, its
  capability gate, its parser and its service path are not built, and are not
  approximated from a source that cannot produce the science.
- **M5.6 — the visible XIC, and linked selection.** **`NOT_APPLICABLE`**, for the
  same reason.
- **M5.7 — selection-availability affordance consistency.** **Closed.** One rule
  for how every viewer surface that commits a scan says it cannot right now,
  applied to both of them at once: the chromatogram and the scan table read one
  selection authority, which now carries its reason as well as its answer, and
  the viewer states that reason once for both of them to point at. **A blocked
  selection blocks committing a scan, not reading the run**: hover, zoom, pan,
  the range controls, the trace toggles, scrolling, virtualization and roving
  focus all stay live, because none of them asks the backend for anything.
  Neither surface is disabled or made inert. The slice also closes the two
  inherited M4.4 P3 debts in the linked figure section, whose refusal had been
  present in the accessibility tree twice. See
  [ADR 0041](docs/architecture/adr/0041-viewer-selection-availability.md).
- **M5.8 — Viewer Completion closure and handoff.** **Closed.** Documentation
  only: no production code, no new capability. Criteria 1, 2 and 5 PASS from
  published evidence — criterion 5 against a text M5.8 **narrowed** at closure to
  carve out the conversion lane's dispatch race, which is the one exit criterion
  this closure changed rather than merely proved; 3 and 4 are closed
  **`NOT_APPLICABLE`** under the measured refusal rather than passed over; 6, 7
  and 8 are deferred with named owners. It
  also closed M5.4's deferred synthetic `slice` record — the run was re-verified
  against a re-hashed executable and source and reproduces byte-identically — and
  reconciled ADR 0037's four inherited M4.4 debts, all four of which M5.3 and
  M5.7 had in fact closed. See
  [ADR 0042](docs/architecture/adr/0042-viewer-completion-closure-and-handoff.md).

M5 is complete when the selected spectrum has a committed viewport wherever the
scientific contract admits one and an honest refusal wherever it does not, the
spectrum exports over the full source and over that range wherever it exists, no
viewer click surface accepts a click that commits nothing without saying why, and
M5.4's outcome has been carried through.

**That fourth condition carries one named exception**, added to the criterion
itself at closure rather than assumed: for the interval between starting a
conversion and its queue state being read back, an activation is refused before
either surface has caught up. It is the conversion lane's dispatch race, shared
by every conversion-gated control here and older than M5, and its owner is M6.
See [ADR 0037](docs/architecture/adr/0037-viewer-completion-route.md#m5-exit-criteria).

**A valid scientific source need not be renderable.** Where the existing figure
and domain contract cannot admit a viewport without changing the source, MSCanvas
refuses the viewport rather than sorting, reordering or normalising the
measurement to manufacture one. Such a spectrum stays selectable and stays
exportable as full-source data.

**And the screen is a drawing, never the science.** The complete spectrum Rust
retains stays the scientific source; a viewport receives a bounded projection of
it for the committed domain, refreshed as that domain changes; and scientific
export is always taken from the retained source rather than from what the screen
was given.

**XIC is conditional on M5.4, and both outcomes complete the milestone.**
M5.4 measured `XIC_SOURCE_REFUSED`, so this is the branch M5 is on: M5.5 and
M5.6 are `NOT_APPLICABLE`, the refusal and its measurement are recorded, those
criteria are closed explicitly as evidence-gated rather than passed over, and
VIEW-007 is reassigned to **M6** for the re-measurement, behind the re-entry
gate the spike records. **`M5 COMPLETE`
does not mean XIC exists** — it means every viewer capability that could honestly
be admitted was delivered and the rest was recorded rather than approximated from
a source that cannot produce it.

D4 is **not applicable** under this branch: ADR 0037's amended rule makes it a
product decision only where the evidence admits two or more sources, and it
admitted none. D1, D2, D3 and D5 are moot for the same reason; the evidence
gathered about each is preserved in the spike for whoever re-enters. On `XIC_SOURCE_REFUSED`
M5.5 and M5.6 are `NOT_APPLICABLE`, the refusal and its measurement are recorded,
those criteria are closed explicitly as evidence-gated rather than passed over,
and VIEW-007 is reassigned to a named owner and re-entry gate. In that outcome
`M5 COMPLETE` does **not** mean XIC exists — it means every viewer capability
that could honestly be admitted was delivered and the rest was recorded rather
than approximated from data that cannot produce it.

M5 also builds **no XIC export** — no SVG, no PNG, no CSV, no TSV, and no claim
that one exists. A future reusable XIC export belongs to M9.

Explicitly **not** M5 exit criteria: multi-layer comparison, a bounded preview
cache, and vendor-format direct preview. Each is deferred below with its owner.

## M6 — Conversion Completion

**Started. The route is locked, the conversion lane has one availability
authority, the installed `msconvert` has been measured against M6's finite
candidate set, what a conversion is asked to do is now a type, and the ownership
boundary the visible settings sit on is decided; the M6.4 replacement
implementation is the next slice.**

The route, the live conversion gap audit it was decided from, the nine product
decisions it surfaces, the twelve exit criteria and the M7/M8 seams are in
[ADR 0043](docs/architecture/adr/0043-conversion-completion-route.md), and the
conversion-configuration ownership boundary is in
[ADR 0044](docs/architecture/adr/0044-conversion-configuration-authority.md).
Twelve slices, plus one authority interlude:

- M6.0 — **complete** (route lock, documentation only).
- M6.1 — conversion-lane authority. **complete.**
- M6.2 — `msconvert` capability and evidence. **complete.**
- M6.3 — typed `ConversionIntent`. **complete.**
- M6.4A — conversion configuration authority boundary. **complete**
  (documentation only).
- M6.4 — visible settings, and a truthful plan. **replacement implementation
  next.** A first attempt is unmerged evidence on PR #95; see below.
- M6.5 — destination authority. **not started.**
- M6.6 — destination and conflict UX, including the destructive question.
- M6.7 — convert selected, convert all.
- M6.8 — cancellation, capacity, and truthful progress.
- M6.9 — output completion and adoption.
- M6.10 — evidence-gated side routes.
- M6.11 — closure.

**M6.4 was attempted once and is not published.** The attempt is on
`feat/m6.4-visible-conversion-settings` / PR #95, which stopped four times: each
bounded correction round closed the findings it was given and was stopped by
something that closing introduced. The nine admitted semantics really are
selectable there, and the plan really is Rust's answer — but the slice reached
that by reconstructing several Rust-owned authorities in React and writing each
new repair by hand against the others.

So M6.4A was inserted rather than a fifth repair attempted. It decides, in [ADR
0044](docs/architecture/adr/0044-conversion-configuration-authority.md), who owns
installation truth, who owns conversion-capability truth, the receipt that binds them,
what React retains, and at what granularity availability exists — and carries a
hundred-and-thirty-seven-obligation finding ledger the replacement must prove, so that
nothing PR #95 measured has to be rediscovered. PR #95 stays open as implementation
evidence until the replacement has extracted its tests, copy and behaviour; nothing from
it is on `main`.

**M6.1 was first because the audit found the conversion lane had no single
availability authority**, and it is now closed. `convert` claimed a ref as it
dispatched while every rendered answer waited for the queue slot to be read back;
the handler's own guard was strictly narrower than the rendered one, so the
divergence ran in both directions; and an arriving read could lower a claim a
handler had just raised. One typed lane now decides, with a reason and a message,
and the operation and every control that offers a conversion read projections of
it — on the pattern the viewer proved in
[ADR 0041](docs/architecture/adr/0041-viewer-selection-availability.md). Every
later slice adds a control that must say truthfully whether pressing it will do
something, and each of them now has one rule to ask.

**M6.2 measured the installed build rather than reading its help.** Twelve
candidates, twelve terminal states: nine admitted on a decoded output, two refused on a
decoded output, one evidence-blocked with what is missing and who owns it. Four findings
change what later slices may assume. The provider's precision default is
**mixed** — m/z at 64 bits, intensity narrowed to 32 — so every conversion this
product has performed has silently narrowed its intensities, and M6.3 types that
decision rather than inheriting it. `--zlib` is **already the default**, so the
"compression" control M6.4 was going to offer would have changed nothing unless
it could also turn compression off. And mzXML **drops the spectra of a
non-default source file silently and then declares the count it did not write**,
which is the comparison CNV-002 is gated on. And the wavelet picker `cwt`
**silently returned one of three source peaks** on a spectrum it accepted without
error, where the default picker recovered all three bit-exactly — a rejection
scoped to this evidence and re-openable only by a representative profile
acquisition. The record is
[M6.2's evidence document](docs/spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md); the
disposition remains M6.10's.

**M6.3 turned that evidence into a type, and the useful part of it was never the
list of options.** What M6.2 produced is an *incomplete composition graph*: five
axes span forty-eight combinations, and nine of them were measured. Individual
capability supported is not the same claim as arbitrary composition supported,
and until this slice nothing in the code said so. `ConversionIntent` has private
fields and no public constructor; the only way to get one is to look five values
up in a nine-row admitted table that names its evidence per row, and the other
thirty-nine answer `None`. What the evidence rejected or never reached is
unnameable rather than merely unused — mzXML has no variant, no processing
variant carries a picker name or a scope, and no admitted row composes
centroiding with an MS-level filter, because that pair was never run. The two
policy types that used to answer the same question a second time are gone, the
queue binds one intent and a retry re-reads it, and integrity now asks the
output whether it did *what was asked* — per array width across both record
lists, compression established per array in both directions, the exact requested
population, and the processing each spectrum's own `dataProcessing` reference
selects, compared against what the source already carried. Two rounds of
exact-head review shaped that contract: a requested transformation must not be
rejected for doing what the evidence says it does, a comparison the request put
outside the question must not be recorded as one that passed, and silence — an
absent record, an unresolved reference, a history merely copied through — is
unverified rather than proof. The planner also proves the *live* executable
declares the exact invocation each intent emits, rather than trusting that M6.2's
executable and today's are the same build. Nothing visible changed: the product
still converts under the shipped intent and still emits the same two flags.

**The audit also found the boundary beneath M6 is stronger than this backlog
implied**, and the route is shaped accordingly: destinations are already admitted
by Windows object identity and revalidated on retry, finalization is already
handle-bound and taken only after the integrity contract passes, termination
already uses an owned Job Object, progress already refuses a percentage, and
conversion capability is already bound to an exact `msconvert.exe` digest per
vendor family. Most of M6 is giving that boundary an honest product surface. The
genuinely new work is measuring what the installed `msconvert` does with the
settings this product wants to offer, and making one rule decide whether a
conversion action may start.

**Nothing in M6 is completed by a measurement going a particular way.** mzXML,
vendor-format direct preview, whether a further vendor family opens at all, and
XIC re-entry each end in a stated disposition — admitted, refused with evidence,
or evidence-blocked with the missing evidence and its owner named. **None of them
has to be admitted for M6 to complete; each of them has to be answered.**
Reaching a terminal disposition is exit criterion 11; being admitted is not a
criterion at all. **The other eleven criteria are core product truths and must
each be proved `PASS`** — deferred, refused or evidence-blocked is not a way to
close one of those, and where a core criterion cannot be proved, M6 is not
complete. The two backlog bullets below that call vendor-format direct
preview and VIEW-007 re-measurement “not an exit criterion” are about admission
in exactly that sense, and are read under this distinction — as is VIEW-007's
“closed by that fact”, which is a refusal carried with evidence rather than a
fourth kind of ending.

M5 hands it two things beyond the backlog below. The **capability-evidence
discipline** M5.4 established — exact installed signature, exact executable
identity, live measurement, classification, then admission or an explicit
refusal — applies directly to widening `msconvert`, and evidence does not
transfer between executables because help text looks identical. And the
**viewer/conversion lane boundary** M5.7 froze: the queue slot and a dispatched
retry own the one backend lane, an adoption and a diagnostics export do not, and
the `convert` ref/render window was handed over open and described rather than
claimed closed. M6.1 closed that window, and widened the lane's first half by one
fact: a dispatched *conversion* owns it too, which is what the viewer's selection
guard had been unable to see.

- Widen the typed conversion settings the interface can actually express:
  CNV-002's mzXML gate, CNV-004 to CNV-007's processing and compression choices,
  and CNV-003's output-location choices.
- Queue work beyond the current bounds, **measurement-gated, and neither an exit
  criterion nor a route requiring a disposition**: a re-evaluated queue bound and
  per-item cancellation. Both are admitted only on M6.8's measurement of what an
  `msconvert` run actually is **and on its ownership outcome** — a per-item cancel
  is refused where the spawn-to-Job window stays open. Under that outcome a stop
  of a launched conversion does not settle as a successful cancellation at all:
  it settles `CancellationFailed` / `StopFailed` and quarantines the session,
  because an empty Job is not an empty tree while a descendant can be created
  before ownership exists. The queue stays finitely
  bounded whatever that measurement says, and removing an item from a queue
  already running is refused outright: membership is bound when the queue is
  created. See
  [ADR 0043](docs/architecture/adr/0043-conversion-completion-route.md).
- **Whether a further evidenced vendor family opens at all**, answered once as a
  single decision rather than family by family. This one *is* on the closed
  side-route set, so it must reach a terminal disposition before M6 closes; what
  it need not do is end admitted.
- **Vendor-format direct preview**, behind its own evidence slice. Deferred from
  M5 with a recorded reason: `open_preview` refuses a non-mzML row today, and
  conversion support is not direct-preview support — the conversion evidence
  proves `msconvert` writes a correct mzML, and says nothing about whether
  `msaccess` can answer preview queries against a vendor acquisition. It is not
  automatically an M6 exit criterion either.
- **VIEW-007 re-measurement, conditional and not an exit criterion.** M5 assigned
  XIC's re-entry here because M6 is the milestone that measures this backend
  against a build. The trigger is a **different measured `msaccess` identity**:
  where M6 measures one — for a direct-preview slice, for a widened `msconvert`
  distribution, or because the installation changed — it also answers the spike's
  three-part gate, which needs an executable identity and capability grammar
  covered by fresh evidence, a resolved numeric-fidelity answer, and
  re-measurement of everything the record establishes. Where M6 measures no new
  identity, this item is closed by that fact and no XIC work is owed. Admission
  would schedule a viewer slice at that point; it does not make one an M6
  deliverable. See
  [ADR 0042](docs/architecture/adr/0042-viewer-completion-closure-and-handoff.md)
  and [the spike](docs/spikes/M5_XIC_SOURCE_EVIDENCE.md).

## M7 — UI/UX and public product hardening

M5 hands it the interaction principles it proved rather than asserted:
availability means activating would do what it says; an unavailable action has
one understandable reason; live regions are mounted before they have anything to
say; keyboard equivalence; the three responsive targets; and explicit scroll
ownership. M5.7's single selection-unavailability posture is the pattern to
generalize outside the viewer. Chromatogram touch semantics and a bounded preview
cache are deferred here, the second only on a measurement showing a need.

- Consolidation and redesign of the surfaces M5 and M6 complete, owning the
  principles M5.0 froze rather than inheriting drift across them.
- Windows installer/signing plan, accessibility pass, crash/error diagnostics and
  public fixtures.
- Saved settings, layout persistence and beta feedback instrumentation that
  remains local-first.
- **Touch gestures over the chromatogram.** The plot declares
  `touch-action: none`, so a touch drag over it scrolls nothing, and unlike a
  wheel that is a static declaration rather than a claim made per event. Closing
  it means deciding what a touch drag over a chromatogram means — a pan, a
  scroll, or a selection — which is product semantics rather than adapter
  wiring. Recorded by Viewer Closure R1.2, which closed the wheel and left this
  as it found it. Not required for any M5 capability's correctness: every M5
  control is reachable by pointer and by keyboard. See
  [ADR 0033](docs/architecture/adr/0033-visible-linked-tic-bpc-viewer.md).
- **A bounded preview cache, if a measurement shows one is needed.** There is
  none today and that is a recorded position: selections stay direct and
  uncached, and the M0 spike measured 24 deterministic indices over three passes
  on a 36,319-spectrum file at p50 `164 ms`, p95 `186`–`194 ms`, max `199 ms`
  with no degradation. Nothing in M5 argues for one — a spectrum viewport reads
  nothing, and an XIC is one backend operation per XIC rather than one per scan.

## M8 — Artifact, run and QC foundation

- Project/artifact/run persistence and lineage.
- First reusable QC summaries and report surfaces.
- **Layer identity and provenance**, which multi-layer comparison needs and
  which no current contract provides: `FigureSpec` carries semantic style roles
  for quantities, not identities for sources, and `SeriesSpec` deliberately
  carries no part of a path, handle or display name.

## M9 — First analysis recipes

- Isolated worker contract and one or two reviewed recipes backed by mature
  packages.
- Recipe mode first; no generic workflow canvas until real needs justify it.
- **A reusable XIC export**, if an XIC ever exists. M5 measured
  `XIC_SOURCE_REFUSED` and built neither a trace nor an artifact, so the
  condition this entry was written under — *if M5 admitted one* — can no longer
  be met. It is **not** thereby closed: re-entry is M6's, behind the spike's
  three-part gate, and if a measured build admits a source the visible trace
  becomes a viewer slice scheduled then. An XIC is a derived analytical quantity
  rather than a second view of something the file contains, so its reusable form
  still belongs with the milestone that owns derived analytical results, on top
  of M8's artifact identity. See
  [ADR 0037](docs/architecture/adr/0037-viewer-completion-route.md) and
  [ADR 0042](docs/architecture/adr/0042-viewer-completion-closure-and-handoff.md).
- **Multi-layer comparison (VIEW-008)** belongs here for its semantics, on top of
  M8's layer identity. Deferred from M5 with a recorded dependency audit: the
  application holds one preview by contract — Rust's open ticket states that
  there is only one chromatogram the user is looking at and only one that may be
  exported — two runs' intensities are not comparable without a normalization
  this product has not admitted, and a selected scan *of a layer* is a different
  type from the one selected scan every linked view consumes. See
  [ADR 0037](docs/architecture/adr/0037-viewer-completion-route.md).

## M10 — Automation

- Stable CLI and schemas, then repo/user skills, then a narrow local MCP adapter.
