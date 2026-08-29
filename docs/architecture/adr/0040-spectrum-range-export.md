# ADR 0040 — A spectrum exports over its full source or one committed m/z range

Status: accepted
Date: 2026-08-29
Related: [0028](0028-figure-renderer-and-semantic-specification.md),
[0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0034](0034-chromatogram-export-and-range-scope.md),
[0036](0036-linked-chromatogram-spectrum-figure.md),
[0037](0037-viewer-completion-route.md),
[0038](0038-spectrum-viewport-authority-and-screen-projection.md),
[0039](0039-visible-spectrum-viewport-adapter.md)

## What this ADR is

M5.3, the slice that lets the committed m/z viewport
[ADR 0038](0038-spectrum-viewport-authority-and-screen-projection.md) built and
[ADR 0039](0039-visible-spectrum-viewport-adapter.md) made reachable become a
range a scientific export can be taken over.
[ADR 0037](0037-viewer-completion-route.md) remains the route authority and this
one does not restate it. [ADR 0034](0034-chromatogram-export-and-range-scope.md)
settled what a range means for a chromatogram; what is recorded here is the
handful of decisions the **m/z axis** forced, each of which had a plausible
alternative that is wrong for a reason worth writing down.

**M5.3 adds a range, not a format.** A selected spectrum exported as SVG, PNG,
`Copy plot`, CSV and TSV before this slice and exports as exactly those after it.
Which of them a particular spectrum supports is a property of that spectrum and
was not touched: where the figure contract refuses an ordered domain, the three
figure outputs keep their existing typed refusal and the two data outputs keep
working, because a data document is one record per retained source point in
source order and needs no ordering at all.

## Full and Current are different shapes, not one shape with a flag

```rust
enum ResolvedSpectrumRange {
    Full,
    Current(Domain),
}
```

`Full` carries no bounds, and that is the load-bearing half. A full-source export
resolves for a spectrum that has **no domain at all** — it never asks the
viewport question — which is precisely what keeps CSV and TSV available for the
unordered m/z array mzML permits and nothing here sorts. A shape carrying an
optional pair would have made "the range of a full export" a thing a caller
could read, and the honest answer to it is that there is not one.

`Current` always carries the exact interval Rust agreed to. Every document, file
name and confirmation downstream reads that one resolved fact rather than
re-deriving it from a viewport that may have moved since.

The request the webview sends is the chromatogram's shape and deliberately not
the chromatogram's *type*. `SpectrumRangeDto` and `ChromatogramRangeDto` carry
the same three fields about two different axes, and one type shared between them
would make handing a retention-time range to a spectrum export a thing that
compiles. The frontend keeps the axes apart with the `MzDomain` brand ADR 0038
introduced; Rust keeps them apart by having two types.

**No cast is added around that brand.** The request is built by reading `low` and
`high` off a committed domain, which needs no assertion — serialising the domain
itself would have needed one, and weakening the separation for the sake of a wire
shape is the wrong trade.

## One resolver, against the retained snapshot

`SpectrumSnapshot::resolve` is the only place a spectrum range is agreed to.
Every format reaches its range through it: both figures, both data documents and
the clipboard. Its authority is the complete arrays Rust retained and the
`ViewportDomain` settled when they were retained — never the transferred prefix,
never the backend's separately reported `mz_low`/`mz_high` pair, and never a
screen projection.

That last one is the substitution this slice existed to make impossible, and the
types do most of the work: `ScreenProjection` exists only as the return of
`project_spectrum`, no document writer sees one, and nothing in
`preview/export.rs` imports it.

Two refusals, both typed and path-free:

- **outside the source** — refused, never clamped, for the reason M4.3's range
  already gives. A window this spectrum does not have is a request about
  something else.
- **no viewport domain** — a `Current` range asked of a spectrum the contract
  refuses. The interface does not offer it, so reaching this is a forged or a
  stale request; it is refused rather than answered with the full source, because
  a complete export written under a current-range name is a file that misstates
  itself. Nothing is sorted, and neither the reported bounds nor a first/last or
  min/max of the array is used to manufacture the domain the contract declined.

Each has its own sentence on the spectrum surface. `RangeOutsideSource` is raised
on both axes — the shape of the mistake is shared — but the chromatogram's
sentence names a *retention-time* range, and reporting that to someone who chose
an m/z window would send them to the wrong control.

## The figure is the same panel with a window declared on it

`spectrum_panel` is unchanged and takes no range. A current-range figure is that
panel plus a declared window:

```text
complete source SeriesSpec at DataScope::FullSource
        + the source's own full m/z and value domains
        + the resolved visible m/z domain
        + the visible value domain
```

Three properties follow, and each is a thing that could have gone wrong:

- **A full-source figure is byte-for-byte what it was**, because it is literally
  the same call. The golden `spectrum-full-source.svg` fixture is unchanged.
- **The science is not deleted to make a picture.** The nine-million peak at some
  other m/z stays in the series and stays in `value_domain`, and comes back into
  view when the window widens.
- **The linked figure cannot inherit a spectrum range**, because
  `spectrum_panel` has no parameter to pass one through. ADR 0036's rule that the
  lower panel is the complete selected spectrum is preserved by the signature
  rather than by a convention.

A current range that covers the whole spectrum declares no window and
canonicalizes to the full-source figure. A window that narrows nothing is a
narrowing the figure does not have — the chromatogram reached the same conclusion
for the same reason.

### The visible value domain, on an axis measured from zero

`PanelSpec::visible_value_domain` is M4.3's contract extension, reused. What the
m/z axis changes is **how the window is computed**, and this is where carrying
the chromatogram's rule across would have been wrong.

A chromatogram is a polyline, so its visible value window includes the
interpolated height where a segment crosses each edge. A spectrum here is drawn
as discrete marks rising from zero. So the window is the actual source
observations inside the interval, **and zero** — because a stick's length is what
a reader reads as its magnitude, and an axis that did not contain zero would make
every mark in the window a lie about its own size.

A window holding no reported peak scales to zero-to-zero. That is an honest empty
window rather than a fabricated one.

## Representation decides figure filtering, and nothing decides data filtering

The rule [ADR 0037](0037-viewer-completion-route.md) fixed rather than leaving to
this slice, and it is the reason this ADR does not have one range rule:

- **`Unreported`, and any discrete-marker representation.** The figure draws only
  genuinely reported peaks whose m/z falls inside the inclusive window. No
  boundary intensity is interpolated and no line is drawn through an m/z that was
  never measured. `crates/plot-spec/src/svg.rs` filters discrete marks rather
  than clipping them and states why. **This is the branch the product is in**:
  the boundary emits no profile or centroid marker, so `spectrum_panel` maps the
  one state it can receive to `SpectrumRepresentation::Unreported`.
- **A representation authoritatively established as continuous profile samples.**
  Only such a representation may admit continuous clipping with an interpolated
  boundary value, because only there does the source assert a value between its
  own samples. Nothing in this product establishes one, and nothing here was
  changed to claim one.

**A data document never invents a measurement, at any range, under any
representation.** Even if a future profile figure interpolates a boundary for
drawing geometry, the table beside it does not gain a row for it.

## Data schema: version 1 stays Full, version 2 is the range

Version 1's shape already means *the complete spectrum*, so it is frozen. The
same source writes the same bytes it always did, and a reader holding one of
those files needs no new rule.

A range is version 2:

```text
#format,mscanvas_spectrum_export
#schema_version,2
#spectrum_index,42
#range_scope,current
#source_point_count,4
#exported_point_count,2
#range_low,100.5
#range_high,100.75
#representation,unreported
#mz_unit,unreported
#intensity_unit,unreported
mz,intensity
100.5,12
100.75,0
```

**Two counts rather than one.** In version 1 the source count and the exported
count are the same number, so `point_count` is unambiguous there. In a ranged
document they are not, and a single key would leave a reader unable to tell
whether the rows they hold are all the spectrum has.

`range_low` and `range_high` are the range **Rust resolved**, so a file records
the window it was actually taken over even if the viewport moved while it was
being written.

The two documents share one writer and one record loop. The preambles differ
because the questions differ; the records cannot, or a full document and a range
document over the same observations could come to disagree about how a number is
written.

## Source order, not m/z order

A range document keeps the source points satisfying `low <= mz <= high`, edges
included, **in the order the source has them**. For an admitted source that is
m/z order, and the rule is nevertheless order *preservation* rather than sorting:
the full-source document of a refused spectrum writes its descending array
exactly as the instrument reported it, and a range document is the same loop.

Zero rows is a successful export. A zero-width range is valid, and if the source
measured something at that m/z the range keeps it.

## The range is fixed at BEGIN

A selected-spectrum export claims the exact retained snapshot, the exact resolved
range, the format and the figure settings, all at the moment it begins. The user
is then in a modal dialog and may zoom, pan or reset twice over; what is written
is the window they asked for, and the outcome reports that same window.

Which is why `SpectrumExportOutcomeDto` carries the range rather than the
interface reading it back. "Saved the current range" is a sentence that stops
being true while it is being read.

The frontend follows the same rule in both directions, and the difference is the
point: the finished-export message is built from the outcome alone and does not
move, while the range **note** beside it does follow the viewport, because it
describes what the *next* export would cover.

## The scope belongs to a spectrum's export context

Frozen deliberately, because each of these is a way a range chosen for one
measurement could quietly be applied to another:

| | scope |
| --- | --- |
| initial selection | `full` |
| a different spectrum selected | reset to `full` |
| viewport admitted | both offered |
| viewport refused | `Current` disappears; effective scope is `full` |
| refused, then admitted again | `full` — no hidden choice resurrected |
| zoom, pan or reset of the same spectrum | unchanged |

The effective scope is **derived** rather than stored a second time. A stored one
could disagree with the reducer for exactly one render — the render in which a
refusal arrives — and that is the render in which an export would be sent with a
`Current` scope the spectrum cannot answer.

## Projection state does not control Current export

Once a committed domain exists, `Current` export is independent of whether its
screen drawing is idle, loading, ready, successfully empty, retryably failed or
non-retryably failed. Export reads the retained source and the committed domain;
the drawing is neither. **A failed drawing is not empty science**, and the
interface makes the projection's error explicit so a reader never mistakes one
for the other.

## One lane, and a range is not a concurrency class

The single scientific export lane serves the selected spectrum, the chromatogram,
the linked figure and both `Copy plot` surfaces, and M5.3 adds nothing to it. A
range is a property of an export claim.

The range chooser itself is deliberately **not** closed while the lane is busy. A
scope is a decision about the next export rather than a claim on the lane, and
closing it would leave a reader unable to prepare while a file is being written,
for no safety this side owns.

## Suggested names carry a scope and no number

`mscanvas-spectrum-{index}-current.{ext}`, with the full-source names unchanged
because the documents they name are unchanged. **No m/z reaches a file name**: a
range in a path would be a float rendered into a naming rule this repository does
not have, and the exact bounds live in the document where a reader can read them.

## Consequences

- A reader can export the peaks they are looking at, and the file says which
  peaks those are without an interface to ask.
- Five capabilities stay separate: a valid source, a drawable figure, an
  admissible viewport domain, full-source export and range export. A viewport
  refusal is not a source failure and a figure refusal does not close a data
  export.
- The screen has two things that look like spectrum data — the bounded projection
  and the retained source — and only one of them can reach a file, by
  construction rather than by discipline.
- The linked two-panel figure is unchanged, and stays unchanged because the panel
  builder it shares has no range to be given.
- One more schema version exists, and version 1 still means what it meant.

## Evidence

**Rust: 1,349 tests**, up from 1,303. Thirty-two over the range contract and the
two documents — the resolver's four answers and its two refusals, inclusive
edges, zero width, an empty window, a malformed pair refused before any snapshot
is consulted, source-order filtering, no interpolated boundary record, a discrete
figure drawing only real in-range peaks, an empty range as a figure, an
off-window peak not scaling the window, both signs of a negative window, schema 2
metadata and both counts, schema 1 unchanged, one record loop across both scopes,
the caption, the file names, a claimed range surviving a selection replacement,
and a window past any transfer prefix drawing the retained source. Fourteen
through the whole service — both documents end to end, the two typed refusals in
m/z words, a domain-refused spectrum keeping its data exports and its figure
refusal, no source reread and no re-settled drawability, a failing projection
changing nothing, and one lane across the surfaces.

**Frontend: 1,339 tests**, up from 1,313. Twenty-six over the chooser and the
lifecycle: both scopes offered and neither offered, the exact note, the
gesture sentence, focus not taken, the chooser open while the lane is busy, the
scope's six lifecycle rules, the committed window sent and the transient one not,
a newly committed window taken before any drawing succeeds, `Current` surviving a
loading and a failed projection, both counts and the bounds in a finished result,
a result that does not move when the viewport does, and the linked figure
carrying the chromatogram's range and no m/z at all.

**Full-source zero delta** is proved two ways. The golden
`spectrum-full-source.svg` fixture is unchanged, and CSV, TSV and SVG were
captured for four representative spectra before the builders were touched and
compared byte for byte afterwards.

**Rendered browser QA** covers the chooser at 1920×1080, 1366×768 and 960×640 —
both options pressable, the plot and the actions still reachable, and the column
still owning its scroll — and drives real wheel input to prove that what the
shipped bundle sends is the committed window. It covers the refused viewport, a
failed drawing, an empty range, a begin-time result that survives a later
viewport move, and a linked export that carries no m/z.

**Real-Tauri QA** keeps the selected-spectrum export and copy boundary live, so
the range, the refusals and the outcome are the ones the shipped boundary
produces. The production save dialog remains unautomatable in this environment
and is reported as NOT RUN rather than as a pass; file content is proved by the
deterministic Rust writer evidence instead.

**M4.4 P3-1 is closed here**, with the mutation evidence its owner slice owed:
three unauthorized constructor routes nested inside `mod linked_pair`, all three
of which the guard passed before this slice and each of which is now caught by
two independent rules. **M4.4 P3-4 is closed here** by restoring the
`scientificExportBusy` documentation block to the declaration it describes, with
no runtime change.
