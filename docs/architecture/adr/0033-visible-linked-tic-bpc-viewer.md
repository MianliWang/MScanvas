# ADR 0033 — The visible linked TIC/BPC viewer

Status: accepted
Date: 2026-08-23
Related: [0032](0032-viewer-interaction-and-viewport-state.md),
[0003](0003-msaccess-preview-spike.md),
[0028](0028-figure-renderer-and-semantic-specification.md),
[0030](0030-png-copy-plot-and-figure-settings.md)

## What this ADR is, and what it is not

**[ADR 0032](0032-viewer-interaction-and-viewport-state.md) owns the semantics.**
What a viewport is, when a hover stops being true, who may allocate a selection
revision, which of two viewport authorities wins, and where a visible value range
comes from are all settled there, as pure code with no React, no DOM and no
timers.

This ADR records only the visible adapter: which field of the wire answers which
question, where the one interaction state lives, how a browser event becomes one
of ADR 0032's events, and what the rendered evidence says. Nothing here restates
a rule from ADR 0032, and nothing here may contradict one.

Viewer Closure R1 is therefore a wiring slice. Its review should be about wiring.

## The scan model comes from the table that is loaded

`viewer/previewScanModel.ts` is the whole adapter, and it decides nothing:

| Question | Field |
|---|---|
| Which scan a selection commits | `SpectrumRow.index` |
| Where the row sits in the table | its position in `SpectrumTable.rows` |
| Where the scan is on the x axis | `SpectrumRow.retentionTime.value` |
| Whether a unit was reported | `SpectrumRow.retentionTime.unitKnown` |
| What TIC draws | `SpectrumRow.totalIonCurrent` |
| What BPC draws | `SpectrumRow.basePeakIntensity` |
| Whether the table is complete | `SpectrumTable.truncated` |

It maps those onto `ScanSource` and calls `buildScanModel`. Completeness,
ordering, the unit posture and every refusal stay in Layer A. The one fact the
adapter supplies that the wire does not carry is `tablePosition`: the table's
order is the order its rows arrived in and the trace's order is retention time,
and keeping both is what makes a tie decidable and what Previous/Next walks.

The model is built once per loaded preview, memoized on the preview's own
identity. Nothing rebuilds it for a pointer move, a zoom, a pan, a hover, a
trace toggle, a figure setting or a selected spectrum finishing its read.

### What TIC and BPC are, said out loud

**Per-scan values projected from the loaded spectrum table.** The visible caption
says exactly that, and says "Not a stored chromatogram record" beside it.

- No `PreviewOperation::Tic` was added, to `open_operations()`, to
  `required_operations()` or to backend availability.
- No new backend query of any kind. No new ProteoWizard process. **No Rust
  production change at all.**
- Nothing here claims the standalone `msaccess` TIC query succeeded. ADR 0003's
  posture is unchanged.

A future slice that reads a stored chromatogram record would be a different
source and would have to say so.

### Units

Retention time is **unreported** and intensity is **unreported**, and the axis
caption says both. No minutes, no seconds, no arbitrary units. A row that says a
unit was reported without saying which produces no model at all — ADR 0032's
`unsupported-retention-time-unit` — because an axis cannot be labelled with a
unit that was never named, and cannot honestly say none was reported either. A
provider that genuinely reports one needs the typed boundary widened to carry it.

## One selection, and where it lives

Before this slice `usePreviewWorkspace` held a `selectedIndex` of its own. That
was harmless while nothing else answered the question. R1 gives three surfaces
that commit a selection and two that must react to one, so the reducer's
selection is now the authority and `selectedIndex` is a read of it:

```
selectedIndex = viewerInteraction.selection?.index ?? null
```

There is no second writable selected-index state anywhere.

### The commit path

`selectSpectrum` is the one operation. The plot's click, the table's click, the
table's Enter and Space, Previous scan, Next scan and Retry all go through it,
and its order is the contract:

1. every existing request guard first — no loaded file, a busy backend, a
   conversion in flight, a backend this session has stopped trusting, and a
   repeat of the row already being read;
2. then the selected row is reconciled against the table that is loaded **now**,
   through a ref rather than a closure, because a click arriving during a
   preview change would otherwise be answered from the previous table. A row this
   preview does not contain is refused rather than guessed at: a commit carries
   the retention time its linked plot reveals it at, and there is nowhere honest
   to get one from;
3. then exactly one `selection-committed { index, retentionTime }`;
4. then the reducer allocates the revision;
5. then the existing selected-spectrum request starts.

A repeat that is still in flight is dropped at step 1, so it allocates neither a
revision nor a second ProteoWizard process. The same scan committed again after
its read settled is a **new** commit with a new revision, and linked views may
reveal for it again.

### Two race mechanisms, two questions

They are deliberately not merged.

| | Question it answers | Where it lives |
|---|---|---|
| `spectrumToken` | Which backend reply may be shown | `usePreviewWorkspace`, unchanged |
| `selection.revision` | Whether a linked view has acted on this commit | the reducer |

Select A, then B before A finishes: the persistent selection is B, both markers
are B, and A's late result — success or failure — cannot overwrite it, because
the request token refuses it. A failure does not unselect: the panel shows its
typed outcome and the scan stays where the user put it.

## The controller, and why it exists

`viewer/useViewerInteraction.ts` holds one `ViewerInteractionState` in one
ref/state pair, applies `viewerInteractionReducer` synchronously, publishes the
result to React, and **returns the state the reducer produced**.

That return value is the whole reason it exists. A native wheel listener has to
tag its debounced settle with the epoch the reducer assigned to the gesture it
just started, and a drag has to tag every later move with it — and React's
`useReducer` dispatch returns nothing, with the new state a render away. The
alternative would be for the adapter to mirror the counter, which is exactly the
race an epoch exists to remove.

An event the reducer refuses returns the state it was given, by identity, and the
controller publishes nothing — which is what lets a renderer resolve the nearest
scan on every pointer frame and dispatch freely.

It lives inside `usePreviewWorkspace` because `selectSpectrum`'s guards are
there, and a commit may only be dispatched after they accept. A component-level
copy of any part of it would be the second authority ADR 0032 exists to prevent.

## The adapters

Continuous pointer coordinates never leave `Chromatogram.tsx`. What crosses into
the contract is a resolved scan, an epoch and a domain.

**Hover.** On pointer movement: map the pointer's x to a retention time using
`renderedDomain(state)` as it is *now*, resolve `nearestScan` over the full
model, dispatch `hover-established { spectrumIndex }`. The guide rule is drawn
from that scan's own retention time under the range on screen at draw time —
never from a coordinate scaled when the observation was made, which is what left
PR #72's rule standing where the scan no longer was. Pointer leave and blur
dispatch `hover-cleared`; no other hover lifetime rule exists outside the
reducer's finalizer.

Writing the mutation for that last sentence turned up something worth recording.
**A cached hover coordinate is no longer reachable**, because ADR 0032's
finalizer drops a hover on any change of `renderedDomain`, and the x scale
depends on nothing else — so an observation is always drawn under the very domain
it was made in, and a cache of it cannot be stale. The invariant removed the
defect class rather than a test catching an instance of it.

The reachable member of that class is the **selected marker**, which is
persistent and deliberately *not* invalidated by the axis moving — the user still
selected that scan. A coordinate scaled when the selection was made and kept
would leave the rule standing where the scan no longer is, with nothing to clear
it. So the marker is derived from the scan's own retention time at draw time,
every time, and a test pins its position across a viewport change.

**Wheel.** One notch is planned before it is claimed. `planWheelGesture` asks
`zoomDomain` for the candidate range about the pointer and then asks the reducer
what that gesture would leave on screen once it settles; if that is the range
already shown, the adapter cancels nothing and dispatches nothing. Otherwise it
calls `preventDefault`, then `gesture-started` if no gesture is active and
`gesture-moved(epoch, …)` otherwise, with the epoch read back out of the
dispatch's own answer. A 120ms timer then emits `gesture-settled(epoch)`.
Resetting that timer is an efficiency; a stale settle is a reducer no-op by
identity, so correctness does not rest on `clearTimeout`. Why the claim comes
second, and never before the plan, is [below](#who-owns-a-pointer-gesture).

**Drag.** A press is not yet a pan. Past a 4px slop threshold on the **x** axis
the first move dispatches `gesture-started` and keeps the reducer-assigned epoch;
every later move computes `panDomain` from the domain the press began in and the
**total** displacement, so a long drag accumulates no drift. Pointer up settles,
pointer cancel cancels.

Two thresholds rather than one, because they answer different questions. Only
sideways travel can pan this plot, so that is what starts a gesture. But whether
the release is still a *click* is decided at pointer up against travel in **both**
directions: a press dragged 60px straight down starts no gesture — there is no
vertical pan to start — and must not commit a selection either, because every
selection is one ProteoWizard process and the user who dragged the pointer away
was not asking for one.

**Keyboard and buttons.** `+`/`=`, `-`/`_`, Left, Right, Home and `0` on the
focused plot, and Zoom in / Zoom out / Reset range as visible controls. All are
`viewport-step` or `viewport-reset`: committed at once, because a deliberate
instruction is not a gesture. The handler is on the plot itself, so no key is
intercepted from an unrelated input.

**Click.** Resolved through `nearestScan` over the full model, never from a
reduced vertex or a boundary intersection. One click is one commit and at most
one backend read.

## Drawing

The pipeline order is ADR 0032's and is not restated here. What the component
does is run it, in that order, and read the result:

```
model.points -> clipTrace(points, trace, renderedDomain)
             -> visibleExtent(every clipped trace)
             -> reduceVisible(clipped, renderedDomain)
             -> SVG path
```

- a trace has three drawing cardinalities, and only two of them are a polyline.
  No visible vertex draws nothing; two or more draw one `<path>`, never a node
  per scan. **One** visible vertex is the degenerate case and is drawn as a
  point at exactly that vertex's own coordinate — a complete acquisition of a
  single spectrum has a correct value and a correct axis, and `M x y` alone
  strokes nothing, so the panel drew a labelled axis over an empty plot for a
  run that had a measurement. Nothing invents a second x to give a line command
  a length: a horizontal segment would be a retention-time extent the run does
  not have, and would read as a scan that lasted. The point is rendering
  geometry and only that — it creates no `ScanPoint`, changes no
  `VisibleVertex`, is never resolved against by `nearestScan`, and does not
  touch the extent. A measured zero is drawn on the baseline rather than not
  drawn at all;
- a small fixed number of axis, marker and guide nodes;
- TIC solid and BPC dashed, in different colours **and** different dash patterns,
  so the two are told apart without seeing colour. Their point form keeps the
  same invariant by fill and size — a filled disc and a larger open ring —
  because a single-scan run can carry the same number in both series, and the
  two marks then land on one coordinate; a disc inside a ring is still two
  marks. The trace colours are the screen's design-system tokens and are
  deliberately not bound to the M4 figure Light/Dark export setting, which
  describes a document rather than a screen;
- the selected scan is a vertical rule **plus** a glyph, for the same reason;
- both traces hidden is an intentional visual state that keeps the axes, the
  markers and the navigation surface, and says "Both traces are hidden.";
- every coordinate is guarded against a zero or non-finite divisor, so a flat
  run, a single scan, a wholly negative run and a huge dynamic range all draw
  finite coordinates.

## The scan table

- one reveal formula, `revealScrollTop`, for the keyboard move and for an
  external selection alike;
- one local `SelectionConsumer`, acted on through `consumeSelection`. A new
  revision reveals, including one naming the scan already selected; the same
  revision never reveals twice, however many renders, resizes or gesture domains
  arrive in between, which is what keeps a scroll the user made from being
  undone;
- a reveal moves the roving tab stop and **never** calls `focus()`. The control
  that committed the selection keeps the keyboard;
- roving focus is unchanged: Arrow, Page, Home and End move focus only; Enter and
  Space commit;
- the table stays virtualized.

## What a scan step says it can do

`Previous scan` and `Next scan` are the first viewer controls to compute a
`disabled` state, and a control that advertises availability has to tell the
truth about it. Their capability is therefore two facts, not one:

```
canSelectNextScan = spectrumSelectionAvailable && nextScanIndex !== null
```

`spectrumSelectionAvailable` is the **global start lane** of the
selected-spectrum operation: a loaded run to select a row of, a backend this
session's verdict says is worth launching, and neither of the two things that
own the one backend lane already doing so. One rule, `canStartSpectrumSelection`,
with two readers — the operation asks it from refs inside a handler that may be
several commits older than the truth, and the interface asks it from rendered
state. Two handwritten expressions that merely looked alike is how the buttons
came to advertise a scan step for the length of a conversion queue and do nothing
when they were pressed.

The rule is deliberately **not** `canPreview`, and the difference is not
cosmetic. `canPreview` includes `previewBackendBusy`, which is true from the
moment a selected-spectrum read starts until it settles — but a selection of a
*different* scan is allowed to supersede an unresolved one. That is what
`spectrumToken` exists for, and it is the A → B contract this ADR records above.
Gating a scan step on it would take away a step the operation would have
accepted, during the very window in which a user who picked the wrong scan is
most likely to reach for it. `canPreview` also carries policy belonging to other
actions, which a scan step has no business inheriting.

What the rule does **not** try to answer is anything about a target: whether an
adjacent row exists is the step's own second fact, and whether the requested row
is in the table, or is that exact row already being read, are the operation's
target-specific checks. A control cannot be asked to predict a different answer
for every target; it can only be asked not to lie about the lane.

Two of the rendered facts are narrower than the ref the operation reads, and both
narrow towards refusing: a loaded preview rather than a retained handle — a
handle outlives the reading it was made for so that a backend change can offer
"read this again", but with no table on screen there is no row to step to — and
the interface's own conversion-busy rather than the queue slot's, which also
covers a retry or an adoption this document has dispatched and not been answered
on. The one edge the rendered form does not cover is the moment between
dispatching a conversion and reading the slot back, which every
conversion-gated control in this interface shares and which is not this adapter's
to change.

The operation remains the safety boundary. The rendered capability is the
truthful affordance, and a disabled step stays where it was rather than
disappearing.

## What a viewport control says it can do

`Zoom in`, `Zoom out` and `Reset range` share one rule:

> **A visible viewport action is available exactly when applying it would change
> the effective rendered domain.**

Not a list of boundaries. Every boundary falls out of the rule without being
named — full range has nothing wider to show, the narrowest viewport has nothing
narrower, a run whose scans share one retention time has neither, and a viewport
already showing the whole run has nothing to reset to. The three controls come
from one table and one planner, `planViewportAction`, so they cannot drift apart
the way they had: `Reset range` computed its own disabled state and told the
truth while the two zoom controls claimed to be available wherever they could be
pressed. `Zoom out` did that in the state the viewer *opens* in.

The planner is a projection and is never stored. It takes the interaction state
and an action, asks `zoomDomain` for the candidate range, and then asks the
**reducer** what that event would actually render. Both readers use it: the
render for `disabled`, and the press for whether to dispatch at all — planned
again from the live state, because the state can move between the render that
drew a button and the press that reaches it, and a boolean captured by an older
render is a claim about a state that has gone.

### Equality is by value, on the rendered domain

Both halves of that sentence are load-bearing, and the second one is the part
that is easy to get wrong.

Comparing `zoomDomain`'s own output against the range on screen would have
reintroduced the defect on a large class of runs. Canonical clamping recovers the
low edge as `full.high - span`, and that subtraction rounds: a run of 0.0125 to
453.9875 comes back as a low of 0.012499999999988631. Against the range on screen
that reads as a change — so `Zoom out` would have claimed availability — and the
reducer then recognises the result as the whole run, commits `null`, and shows
exactly what was already there. Asking what the reducer would *render* removes
the question rather than approximating an answer to it, and needs no epsilon.

By value, because the arithmetic is deterministic: a clamp that lands on the
range already shown produces the same numbers in a new object, and comparing
references would call that a change.

### The caption keeps its own projection

The axis caption still decides for itself whether to say "(full range)". Two
rules about one range is a maintenance hazard, so what makes keeping both safe is
written down rather than assumed: every path that sets a viewport goes through
`clampDomain`, so the rendered domain is always *inside* the run — and for a
range that is inside, "covers the whole run" and "is the whole run" are the same
predicate. `Reset range` is therefore available exactly when the caption does not
say "(full range)". A test pins the containment, so a future change that let a
rendered domain escape the run would show up there rather than as two controls
disagreeing.

### The same question, asked of a gesture

R1 shipped the wheel as a gesture that always claimed the event it was given, and
R1.1 left that alone deliberately: a wheel clamping at a boundary is not a control
advertising something it cannot do. What it *is*, once the panel sits in a column
that scrolls, is an event held and not used — which is a different defect with
the same cure. [Who owns a pointer gesture](#who-owns-a-pointer-gesture) states
the rule the wheel now shares, and what it does not share.

## Who owns a pointer gesture

The viewport controls' rule is about a button's claim to be pressable. The same
question is asked of the wheel, where the claim is a stronger one:

> **MSCanvas may claim a wheel event only when applying it through the canonical
> interaction contract would change the effective rendered domain.**

Cancelling a wheel event is a claim on it. The chromatogram sits at the top of
`.viewer-stack`, which scrolls: at 1366×768 with a real run loaded, the stack's
content is taller than the box it is in, and the wheel is how a reader reaches
the scan table and the selected-spectrum panel below the plot. A wheel the viewer
cancels and then does not use is a wheel that neither zoomed nor scrolled — so
the adapter plans first and claims second, and when it cannot consume the gesture
productively it does **not** call `preventDefault`, does **not** dispatch, and
leaves ordinary browser and ancestor scrolling available.

Not dispatching is half of the rule rather than a detail. An input this viewer
did not consume must leave nothing behind: no gesture, no epoch, no settle timer
that a later, real gesture would have to survive.

### The comparison is shared, and the gesture is projected through its settle

`planRenderedDomainTransition` is the one place the question "would this event
change the range on screen" is answered, and both the button planner and the
wheel planner call it. What the wheel needs that a button does not is the
**settle**.

A gesture's rendered domain is the clamped range it is holding. A *committed*
viewport goes through one more normalisation, where a range covering the whole
run becomes `null` — the run itself. Those differ, and the difference is exactly
the floating-point case that decides the button rule. For a run of 0.0125 to
453.9875, an outward notch at full range produces a gesture domain whose low edge
is `0.012499999999988631`, because clamping recovers a low as `full.high - span`
and that subtraction rounds. Compared as a transient that is a change — of one
part in a hundred million million, which no screen has ever shown — and the wheel
would be claimed for it, which is the defect wearing the repair's clothes.
Settled, the run comes back exactly, and the honest answer is that nothing moved.

So the planner applies the event, settles any gesture the reducer left active,
and compares rendered domains by value. Events that are not gestures settle
nothing and take the same path unchanged.

### Where the wheel is and is not the buttons

Shared: the productivity question, and nothing else. A wheel keeps its own step
(0.85 per notch against the buttons' 0.6), its own anchor — the retention time
under the pointer stays under the pointer, where a button always zooms about the
centre — and its own transient-gesture lifecycle with a reducer-assigned epoch
and a 120ms settle. The epoch is read out of the state, never allocated by the
adapter, so a notch cannot address a gesture that is not its own.

| State | Wheel in | Wheel out |
|---|---|---|
| positive-span run, whole run shown *(the opening state)* | **claimed** | released |
| an ordinary subrange | **claimed** | **claimed** |
| the narrowest viewport the wheel can reach | released | **claimed** |
| a run whose scans share one retention time | released | released |
| no run loaded | released | released |

A notch with `deltaY === 0` is not a zoom in either direction and is left alone
before anything is planned.

### The boundary converges rather than latching

`zoomDomain` floors the span it asks for rather than refusing, so a pointer that
moves between notches can leave the viewport a few parts in a quadrillion away
from where the floor was reached, and the next notch is then a real — and
completely invisible — change that the rule claims. It claims it once: the
arithmetic has converged by the following notch, and every later one is released.
The bound is what matters for the defect, and it is pinned by a test rather than
argued: the wheel comes free, and the range does not creep while it does.

### Drag, and touch

**Drag is unchanged and needed no repair.** The pan adapter cancels nothing — it
takes a pointer capture and releases it, and calls `preventDefault` nowhere — so
it never held an event it did not use.

**Touch scrolling over the plot is suppressed statically**, by
`.chromatogram-svg { touch-action: none }`, and R1.2 does not change that. It is
not the same shape of defect: `touch-action` is a declared intent to handle
touch gestures rather than a per-event claim made after the fact, and making it
conditional would require deciding what a touch drag over a chromatogram *means*
for this product — a pan, a scroll, or a selection — which is new product
semantics rather than adapter closure. Recorded here so the gap is visible, and
left for the interaction pass that owns touch.

### What the harness can and cannot prove

Stated plainly, because the evidence stops short of the thing the rule is
ultimately about.

**Proven.** That the listener shipped in the built bundle, registered non-passive
on the real element, reaches the same verdict the contract does; that
`WheelEvent.defaultPrevented` is false at every boundary and true wherever the
notch moves the axis; that nothing is dispatched for an unclaimed notch; and that
`.viewer-stack` really does have somewhere to scroll to at 1366×768.

**Not proven.** That an uncancelled wheel then scrolls that column. A WebDriver
`dispatchEvent` is not a user gesture, and neither headless Chrome nor WebView2
performs a native scroll for one however the listener answers. No test here
claims a synthetic wheel scrolled anything. What is left is the browser's own
contract for an uncancelled wheel over a scrollable ancestor, and the measured
overflow is what gives that contract something to act on.

## The R1 consumer set

**One selection revision, any number of consumers, no second authority.**

| Surface | Consumes the revision? | Why |
|---|---|---|
| `SpectrumTable` | **yes**, via `consumeSelection` | it has its own scroll position to bring the row back into |
| `Chromatogram` viewport | **no** | the reveal is the reducer's own `selection-committed` transition |
| `Chromatogram` marker | **no** | it is a projection of `selection.index`, not an effect |
| `SelectedSpectrumPanel` | **no** | it renders the request's own outcome |

The chromatogram deliberately has no consumer. Its viewport reveal already
happens inside `selection-committed`, and a component effect that called
`revealDomain` again would be PR #72's second viewport authority returning. A
consumer added to satisfy the wording rather than a need would be the same
mistake with better paperwork.

## Preview lifecycle

- opening or replacing a preview dispatches `preview-closed` where the request
  starts, so the outgoing interaction stops being authoritative before the reply
  lands and its pending settle becomes a stale epoch;
- a ready model dispatches `preview-loaded(fullDomain)` in a **layout** effect,
  guarded by the model's own identity, so the first painted frame already has an
  axis and a later render cannot re-announce and drop a fresh selection;
- a model that refuses leaves the viewport closed. The scan table stays usable
  and selecting a row through it still commits;
- clearing the workspace, removing the loaded row and a backend change that
  invalidates what is on screen all close the interaction the same way.

**Vendor-row focus changes nothing.** Focusing a Thermo RAW, Shimadzu LCD or
SCIEX WIFF row leaves the scan model, the interaction state, the committed and
transient viewports, the selected scan and the trace visibility exactly as they
were, and causes no backend viewer request. The focused workspace row is not the
loaded preview's authority; that distinction predates this slice and is
regression-tested at three levels.

## Unavailable states

Each `ScanModelRefusal` gets a sentence that names what happened rather than that
something did, and none of them blames the file for something the file did not
do. A truncated preview in particular has to read as a property of *this
preview*, because the scan table beside it is on screen and does show rows — so
it says the traces are drawn from the spectrum table, that this preview did not
load the complete table, and that drawing the rows it did load would be a
chromatogram of part of the run presented as the whole of it. **No partial trace
is ever drawn.**

The scan table beside it says, in the same situation, that Previous scan and Next
scan stop at the end of the loaded rows, which is not the end of the run.

## Performance

Structural rather than measured, because a threshold needs a hardware baseline
this slice does not claim:

- one SVG path per active trace, bounded reduced vertices, no per-scan node;
- the table stays windowed;
- nearest-scan is a binary search over the full model;
- pointer motion issues **zero** backend calls; so do zoom, pan and reset;
- deciding whether the viewer owns a wheel notch costs one reducer application
  and one settle of the result, both pure and both over a handful of numbers;
  nothing is measured, allocated per scan, or read from the DOM to answer it;
- the linear walk Previous and Next need to find the selected row is memoized on
  the table and the selected index, so it stays off the cursor's path — a
  selection near the end of a large table would otherwise have put two
  whole-table walks into most pointer frames;
- **no cache of any kind was added.** None is authorized by R1.

Hover is the one thing that happens at pointer frequency, and at a full-run zoom
over a large acquisition nearly every frame crosses into another scan. Two things
bound its cost. The reducer answers a repeat by identity, so a frame that does
not cross a scan publishes nothing at all. And the scan table, the
selected-spectrum panel, the roster and the run summary are memoized: none of
their props change on a hover, and a rendered test counts that inside a memo
boundary rather than asserting it in a comment.

## Layout

The viewer column is three panels: chromatogram, scan table, selected spectrum —
the run's shape, the scans it is made of, and the one scan the user chose.

Floors measured at 1366×768 and again at 960×640, not carried over from PR #72:

| Panel | Floor | What it is |
|---|---:|---|
| Chromatogram | 186px | 60px header of two control groups, 124px body: padding, the 52px the plot floors at, the axis caption's two lines and the readout |
| Scan table | 122px | 60px header beside its two buttons, 30px sticky column header, one complete 30px row |
| Selected spectrum | 202px | 55px of figure and data controls, then the plot |

With two 8px gaps that is **526px**, and the column measures 478px at 1366×768 —
so the column owns a scrollbar and scrolls by about 48px. That is the honest
trade for a third linked view in a shell that is exactly the window's height. The
alternative — giving each panel a share and letting the shortest clip — hides
controls rather than moving them, and a clipped control is gone rather than
small.

The scan table's header block takes a zero flex basis so its two buttons stay
beside the heading instead of wrapping onto a row the rows would pay for; the
sentence under the heading truncates through the ellipsis it already had.

Previous scan and Next scan are in the **scan table's** header rather than beside
the plot. The order they walk is the table's, and a preview whose chromatogram
cannot be drawn still has rows to step through.

## Accessibility

- the plot is keyboard focusable with a visible focus treatment, and every
  gesture has a labelled visible control: Zoom in, Zoom out, Reset range,
  Previous scan, Next scan;
- the trace toggles are labelled checkboxes inside a named group;
- the selected marker and the two traces are distinguished by shape as well as
  colour;
- the readout is the plot's `aria-describedby` and is deliberately **not** a live
  region. Which scan the pointer is over changes on most pointer frames at a
  full-run zoom, and a region announcing each of them would be noise rather than
  feedback. Coordinate inspection reaches a keyboard or screen-reader user
  through the persistent selected scan instead — named in that description, in
  the scan table's row marker, in the selected-spectrum panel and in the
  workspace's existing polite viewer region.

## Evidence

**Frontend suite:** 924 tests, counted at the close of R1.2. From R1: the
adapter's field mapping and every refusal; the controller's synchronous answer,
its ref/state agreement and its identity no-op; one-selection-authority, the
in-flight repeat, the refused index, the preview lifecycle and vendor-row focus
at the hook; the chromatogram's data sources, the clipped-extent regression and
its interpolation companion, the reduction, hover validity, click resolution,
both gestures, the keyboard and every unavailable state; the table's reveal
geometry and consumer; and the three-view linked flow with a render count taken
inside a memo boundary. From R1.1: a planner matrix over the viewport states,
each answer also checked against an independently constructed event, and the
render-versus-press interval. From R1.2: the same matrix for the wheel,
including the state no component can be put in — a viewer with no run loaded,
which draws no plot for a wheel to arrive at — and twelve cases at the
production adapter that assert the interaction state and
`WheelEvent.defaultPrevented` separately, because whether the viewport moved and
who the input belonged to are different failures.

**Browser QA:** 46 rendered viewer cases at 1366×768, 1920×1080 and 960×640,
with real hover, click, wheel, drag, keyboard and table interaction — including
the gesture-versus-selection race driven inside one script so it fits inside the
debounce, the hover invariant and its clamped-domain companion, and reveal
geometry measured against real rectangles rather than through the driver's own
`scrollIntoView`. R1.2 adds the wheel's ownership at every boundary and every
productive notch, taken from `WheelEvent.defaultPrevented` against the built
bundle, with `.viewer-stack`'s overflow measured at 1366×768 so the claim has a
column it would actually cost something. Zero newly introduced console errors,
warnings, unhandled rejections or uncaught exceptions.

**Scale QA:** the measured representative 36,319 scans. Observations, not SLAs:
21 rendered table rows, 1 trace path, 1,921 drawn vertices, 15 SVG nodes, ~0.6s
from activation to a drawn viewer, ~0.2s from click to a selected row, and zero
backend calls from any pointer or viewport interaction.

**Real Tauri QA:** 20 cases — the shipped bundle in WebView2 inside the real Rust
process, with `load_selected_spectrum` left real: the chromatogram drawn from the
document's own preview, both traces toggled, a click in the plot crossing the
production IPC boundary with the right index and settling, Previous/Next using
the same transport, the viewport moving without a single IPC call, and one
bounded wheel-ownership case whose only instrument is a dispatched event and its
own `defaultPrevented`.

**Live ProteoWizard evidence:** see BOOTSTRAP_STATUS for what was and was not run
in this environment.

## Deferred: telling a click surface that selection is unavailable

Recorded rather than carried silently.

The scan table's rows and the chromatogram's plot are both clickable throughout,
and a click on either commits nothing while the selected-spectrum lane is blocked
— a running conversion, an installation check, a backend resolved unavailable.
Neither surface says so. The behaviour predates this milestone in the table and
arrives with the plot in it, and it is one question rather than two: making one
of them speak up while the other stays silent, one panel below, would be worse
than the consistent silence they have now.

It is deliberately a different question from the one this milestone closed.
`Previous scan` and `Next scan` render a *computed availability claim*, and that
claim was false; a plain click surface makes no claim at all. Fixing the claim
was a wiring correction. Deciding how a click surface communicates temporary
unavailability — and doing it for both surfaces, without taking away the
hover, zoom and pan that need no backend — is a product decision about the whole
viewer.

**Target: M5 public-beta interaction hardening — viewer selection-availability
affordance consistency**, or an earlier dedicated bounded viewer-affordance slice
if it is pulled forward. **Scope:** decide consistently how the table-row and
chromatogram click surfaces communicate temporary selected-spectrum
unavailability, while preserving backend-free hover, zoom and pan.

## What R1 does not implement

Chromatogram CSV/TSV or SVG/PNG export; current-range export of anything; the
linked two-panel figure (FIG-006); M4.3; XIC (VIEW-007); spectrum zoom and pan;
multi-layer comparison; smoothing, baseline correction, peak picking,
normalization or relative intensity; an MS-level filter in the viewer;
vendor-format direct preview; a preview cache; a saved `FigureSpec`; a figure
composer.

## The M4.3 handoff

`ViewerInteractionState.committedDomain` is the authority a current-range export
will consume: `null` means the whole run, and otherwise a finite forward interval
inside it. What is deliberately not in it is the gesture, so an export taken
mid-drag cannot describe a range the user never settled on.

R1 implements no export. What it establishes, and tests directly, is the handoff:
during a gesture the rendered domain may differ from the committed one; a settle
makes the committed one the range that was reached; and a selection that cancels
a gesture leaves the committed range as the selection's own reveal, which the
stale settle cannot replace.
