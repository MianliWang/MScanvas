# ADR 0032 — Viewer interaction and viewport state

Status: accepted
Date: 2026-08-22
Supersedes: ADR 0031, which exists only on the frozen PR #72 branch and is not
part of canonical main. This ADR is the authority for interaction, viewport and
reveal semantics; ADR 0031's data posture — what TIC and BPC are made of, and
what they are not — stands and will be carried into R1 with it.
Related: [0003](0003-msaccess-preview-spike.md),
[0028](0028-figure-renderer-and-semantic-specification.md),
[0030](0030-png-copy-plot-and-figure-settings.md)

## Context

PR #72 built a linked TIC/BPC viewer that worked, and that bounded review kept
finding real, reachable defects in. Nine of them, over four rounds. The
repository's normal two-round policy stopped the milestone twice, a governance
exception closed the first batch, a second closed the next, and the round after
that produced three more.

Read individually they look unrelated: a scroll position, a tie-break, a stale
timer, a hard-coded sentence. Read together they are one thing. **Nobody had
written down who owns what.**

Nine findings, and the question each was really about:

| # | Finding | The question nobody had answered |
|---|---|---|
| 1 | Selected-row reveal suppressed when `focusRow` matched | Is the roving tab stop the same fact as visibility? |
| 2 | Duplicate-retention-time midpoint canonicalized too late | Which member of a tied group represents it? |
| 3 | Repeated same-index selection did not re-reveal | Is a selection a value or an event? |
| 4 | A retention-time unit state the frontend could not describe | May a type be wider than what can be rendered honestly? |
| 5 | `selectionRevision` consumed by the table, not the plot | Who may consume a selection commit? |
| 6 | Sticky-header height subtracted twice | Whose geometry is the reveal modelling? |
| 7 | Clipped overhang point set the y extent | Is the drawing derived from the data, or the extent from the drawing? |
| 8 | A pending wheel debounce overwrote a selection's reveal | Which of two viewport authorities wins? |
| 9 | Hover survived a zoom with stale geometry | How long is a derived coordinate valid? |

Every one of them is a question about ownership or precedence, and every one was
answered implicitly by the order React effects happened to run in.

So a tenth patch would have been the wrong move. This ADR records the model
first, as pure code with no React, no DOM and no timers, so that the visible
viewer can be built against something that already says what it means.

## PR #72 is frozen, not failed

PR #72 stays at `a9ff771acec731f90629ea7e4ebf7b2f359cbdca`, unmerged and
unrepaired. Its three newest findings remain open against that head as valid
evidence; closing them as fixed would be recording a repair that did not happen.

It is not wasted work. It is where the invariants below were discovered, and it
is the reason they are stated rather than assumed. Its rendered QA, its scale
observations and its data posture are all reusable in R1.

## Six state layers

The foundation names each, and keeps them in separate modules so a question
asked of the wrong one does not typecheck.

### A — the full scientific model (`viewer/scanModel.ts`)

Immutable per loaded preview. Per-scan facts only: spectrum index, table
position, scan number, MS level, retention time, TIC, BPC. No screen reduction,
no viewport intersections, no hover geometry.

**Nearest-scan resolution reads this and nothing else.** Not the reduced
vertices, and not a boundary intersection.

### B — the committed viewport (`viewer/viewport.ts`, held in the reducer)

The semantic retention-time range the user is looking at.

- `null` means the whole run — a state, not a range that happens to equal one;
- otherwise a finite, forward interval contained in the full domain.

This is the authority a current-range export may later consume. Nothing about a
gesture in progress is part of it, so an export taken mid-drag cannot describe a
range the user never settled on.

### C — the transient gesture

A wheel zoom or a drag pan that has not settled. It carries an **epoch** and is
not committed until it settles.

### D — the persistent selection

Exactly one `selectedIndex`, and exactly one monotonic `selectionRevision`.
Re-selecting the scan already selected is a **new commit**.

### E — hover

Transient coordinate inspection. No selection authority, no backend read, no
workspace state. It stores the pointer's retention time and the scan it resolved
to — never a scaled screen coordinate, which is what made finding 9 possible.

### F — render geometry (`viewer/renderGeometry.ts`)

Purely derived: clipped segments, boundary intersections, reduced vertices,
extents. **Not scientific data.**

## Precedence, stated once

### A selection supersedes a gesture

`selection-committed` does three things, in this order, and the order is the
contract:

1. the gesture is dropped, so its pending settle becomes a stale epoch;
2. the reveal is computed against the **committed** viewport, which is now the
   only viewport there is;
3. hover is cleared, because the axis may have just moved under it.

A keyboard step or a button supersedes a pending gesture the same way, for the
same reason: it is a later, deliberate instruction about the same viewport.

### A gesture after a selection is authoritative

Once revision *N* has been consumed, a pan or zoom the user makes is what the
viewport is. Revision *N* never pulls it back. Only *N+1* may reveal again.

### Stale gesture work is a no-op by identity

Every scheduled settle belongs to one epoch. If that epoch was cancelled,
superseded by another gesture, or invalidated by a new preview, then
`gesture-settled(staleEpoch)` returns **the very state it was given** —
`expect(next).toBe(previous)`.

Correctness here may not rest on `clearTimeout` winning a race. A timer is an
adapter: it eventually emits an event, and whether that event still means
anything is the reducer's decision.

Epochs are assigned by the reducer, not supplied by callers. Two adapters
allocating from one counter is exactly the race the epoch exists to remove.

### What is not a commit

Hover, pointer motion, gestures, table focus movement (arrow, page, Home, End)
and workspace-row focus never advance `selectionRevision`, never launch a
spectrum read and never cause a linked reveal.

## Consuming a selection

Each persistent consumer keeps one `lastConsumedRevision`. There is **one**
revision in the state; a consumer's bookmark is not a second selection.

| Situation | Behaviour |
|---|---|
| New revision, selected point inside the viewport | consume; no viewport change |
| New revision, point outside | consume; minimal reveal, span preserved |
| Same index, new revision | may reveal again |
| Same revision, new render or domain | no reveal |
| No selection | bookmark forgotten |

That is the whole rule, and it belongs to no surface — which is what makes
wiring a third consumer one call rather than a new idea. Finding 5 was
structural: the rule lived inside one component, so the other one silently did
not have it.

## Clipping, and the visible extent

A connected trace is piecewise linear between real scan values. For a viewport
`[low, high]`, every segment is clipped to that interval, and a segment crossing
an edge contributes a **linearly interpolated** vertex there.

Two vertex kinds, told apart by the type:

- `scan` — a real scan, carrying its `ScanPoint`;
- `boundary` — **not a scan.** No spectrum index, no way to acquire one, no
  hover or selection authority, and not a recomputed measurement. It exists only
  because a real line visibly crosses the edge.

**The visible y extent is derived from the clipped polyline**, plus zero.

PR #72 derived it from a source window that deliberately included one scan
outside each edge — the overhang that keeps a zoomed line meeting the axis. A
fully clipped peak could therefore set the axis. Verified before this slice
began: with scans at RT 9 = 9,000,000 and RT 10–13 = 90–120, a viewport of
10–13 produced `extent.high = 9,000,000`. Every visible feature flattened, and
the axis labelled with a number not on screen. Zooming into the valley after a
tall peak is the most ordinary thing anyone does with a chromatogram.

Both halves are pinned:

- the RT 9 **source vertex** must not set the extent;
- if the viewport's edge falls between RT 9 and RT 10, the **interpolated
  height at that edge** must, because it is on screen.

## Pipeline order

```
full source scans
  -> segments intersecting the x viewport
  -> clip, interpolating at the edges
  -> visible y extent
  -> screen reduction of the visible geometry
  -> render
```

Reduction runs **last**, on geometry that is already clipped, so it cannot move
what the axis says — asserted directly, not left to a comment.

Reduction keeps up to four vertices per column: first, lowest, highest, last. A
joined trace cannot use the stick spectrum's per-sign extreme rule, which draws
the line through each column's maxima and turns it into an upper envelope with
every trough removed.

## Table reveal geometry

The header is `position: sticky`, so it stays in normal flow and occupies its
own row height at the top of the track; the row canvas begins after it. A row at
canvas offset `rowTop` renders at

```
viewport y = headerHeight + rowTop - scrollTop
```

and is clear of the header exactly when `rowTop >= scrollTop`.

- `rowTop < scrollTop` → `scrollTop = rowTop`;
- `rowTop + rowHeight > scrollTop + (viewportHeight - headerHeight)` → scroll
  down the least that shows all of it;
- otherwise unchanged.

**The header is not subtracted again at the top edge.** PR #72 did that, from
misreading a WebDriver failure: a click intercepted by the column header had
been positioned by the driver's own `scrollIntoView`, which puts a target at the
container's top edge and therefore under a sticky header. That is the driver's
geometry. `revealScrollTop` models MSCanvas's layout and nothing else, and says
so in a comment so the mistake is not repeated.

## Retention-time units

Carried forward from PR #72 and unchanged. Current production reports the unit
as unreported: `UnitState` in `mscanvas-proteowizard` has exactly one variant,
`NotEmitted`, and the single projection maps it to `unit_known: false`.

A hypothetical `unitKnown: true` carries no unit identity, so it can be rendered
honestly in neither direction. It produces **no model** rather than a
half-described one, and one row claiming a unit is enough — "every row agreed"
is not a special path, because agreement does not supply the missing identity.

No known-unit support is implemented. A provider that genuinely reports one
needs the typed boundary widened to carry the unit itself; failing closed is
what forces that to be an explicit change.

## Findings mapped to invariants

`viewer/findingRegressionMap.test.ts` holds this table as executable assertions,
so it cannot drift from the code it describes.

| # | Invariant | Where |
|---|---|---|
| 1 | Reveal takes a scroll position and a row, and nothing about focus | `revealScrollTop` |
| 2 | Both neighbours are canonicalized to their group's earliest row before any comparison | `nearestScan` |
| 3 | A selection is an event; the same index with a newer revision is a new one | `consumeSelection` |
| 4 | A unit that cannot be named produces no model | `buildScanModel` |
| 5 | One revision, any number of consumers, each with its own bookmark | `consumeSelection` |
| 6 | The sticky header is in normal flow and is subtracted once | `revealScrollTop` |
| 7 | The extent comes from the clipped polyline | `clipTrace` + `visibleExtent` |
| 8 | A selection cancels a pending gesture before it can settle | `viewerInteractionReducer` |
| 9 | Hover does not survive a viewport change | `viewerInteractionReducer` |

## What R0 deliberately is not

No visible implementation. No chromatogram UI, no linked-selection wiring, no
Previous/Next, no pointer gestures, no change to production viewer behaviour.
`VIEW-002`, `VIEW-005` and `VIEW-006` remain **unimplemented in canonical main**.

No Rust change, no new preview operation, no cache, no IPC, no chart library and
no state-management dependency.

## The R1 entry contract

R1 builds the visible viewer against this foundation. Its review should be about
wiring, because the semantics are already decided here.

R1 must:

- hold one `ViewerInteractionState` per loaded preview and dispatch the events
  above rather than inventing effect-level rules;
- translate adapters into events: a wheel debounce emits `gesture-settled` with
  the epoch it was scheduled under, a drag end emits it directly, a keyboard
  step emits `viewport-step`;
- read `renderedDomain(state)` rather than choosing between the committed and
  gesture domains itself;
- give each linked view a `SelectionConsumer` and act on `consumeSelection`;
- resolve every click through `nearestScan` over the full model;
- draw from `clipTrace` and scale from `visibleExtent`, in that order;
- scroll the table with `revealScrollTop`, without taking DOM focus;
- carry PR #72's rendered QA forward — viewport geometry at three window sizes,
  real wheel/drag/click, the representative 36,319-scan scale, and the
  vendor-row focus regression.

R1 may not:

- add a second selection authority or a second viewport authority;
- derive an extent from anything but clipped geometry;
- resolve a scan from reduced or boundary vertices;
- store a scaled coordinate in hover;
- rely on `clearTimeout` for correctness.
