# ADR 0039 — The visible spectrum viewport is an adapter, and the drawing is never ahead of the axes

Status: accepted
Date: 2026-08-28
Related: [0032](0032-viewer-interaction-and-viewport-state.md),
[0033](0033-visible-linked-tic-bpc-viewer.md),
[0037](0037-viewer-completion-route.md),
[0038](0038-spectrum-viewport-authority-and-screen-projection.md)

Supersedes one rule of [ADR 0033](0033-visible-linked-tic-bpc-viewer.md): its
`ctrlKey` is not given a meaning section, replaced by
[the cross-axis ownership rule below](#a-modified-input-is-the-hosts-and-that-is-a-cross-axis-rule).

## What this ADR is

M5.2, the slice that makes the m/z viewport [ADR 0038](0038-spectrum-viewport-authority-and-screen-projection.md)
built reachable. That ADR remains the semantic authority and this one does not
restate it: what is recorded here is the handful of **adapter** decisions the
visible surface forced, each of which had a plausible alternative that is wrong
for a reason worth writing down.

Nothing scientific changed. No Rust file was touched, no command was added, no
export behaviour moved, and `MAX_SPECTRUM_POINTS` was not raised. M5.1's
`project_selected_spectrum` turned out to be sufficient, which is the outcome a
published boundary is supposed to have.

## Where the reducer lives, and why it is not in the plot

The obvious home for a viewport is the component that draws it. That is wrong
here, and the reason is the one thing M5.1 was most emphatic about.

The gesture epoch and the projection generation are **monotonic across the
session, never per spectrum** — because their whole job is to tell a late answer
about the spectrum just replaced from a current one about the spectrum now
selected. A reducer created when a component mounts restarts them when that
component mounts. And the selected-spectrum panel unmounts its plot on every
selection: a spectrum load passes through `loading`, which draws no plot at all.
So a component-local reducer would restart both counters at *exactly* the moment
a request for the previous spectrum is still outstanding, which is the race
written out in full.

The reducer therefore lives in `usePreviewWorkspace`, beside the one
`ViewerInteractionState` and for the same reason, and the panel receives it.

**The cost is real and is accepted.** `SelectedSpectrumPanel` is memoised, and
until now no interaction state reached its props at all; now its own viewport
does, so a drag over the spectrum plot re-renders the panel per frame. The memo
still earns its keep — a conversion poll, a roster reply and above all the
*chromatogram's* hover still do not reach it — and a frame of the interaction
the reader is currently performing on this panel is a much cheaper thing than a
late answer landing under the wrong axes. The comment on that memo now says so
rather than continuing to claim what stopped being true. (A figure setting was
never among the things it kept out: `figureSettings` has always been one of this
panel's props.)

## `idle` is the whole request rule

There is no list of places that must remember to ask Rust for a drawing.

`idle` is the contract's own word for *this viewport has a window and no drawing
that answers it*, and M5.1 arranged for exactly the transitions that change the
committed window — a selection, a settle, a step, a reset — to leave it there.
So one effect asks whenever the state is `ready` and the projection is `idle`,
and that is the entire policy: a transition that changes the committed window
gets a request, and one that does not, does not. A gesture leaves the projection
alone, so a drag makes no requests at all until it settles.

Retry is the same call. Same spectrum, same committed window, same retained
source, new generation — so a retry and a first request cannot come to ask
different questions, and there is no second code path to keep in step.

## The failure's sentence is a lookup, not a second opinion

`projection-failed` carries retryability and not a message, which is right: the
contract is about which request an answer belongs to, not about what to say
about it. But something has to say it.

The wording is therefore kept beside **the generation it arrived for**, and read
back only while the reducer says that generation is the failure it is currently
in. That is a lookup keyed by the contract's own identifier rather than a second
frontend record of which failure is current — which is the thing ADR 0038
forbids, because a second race guard is a thing that can disagree.

Retryability is read as `failure.retryable === true` rather than for truthiness.
`isPreviewError` accepts an object carrying only a kind and a summary, so the
field can arrive undefined, and a failure this side cannot classify is not given
a retry button that might do nothing.

## The drawing is never ahead of the axes, and the surface still holds still

M5.1's rule is that a previous drawing stops being current for a newly committed
window. The naive rendering of that is to replace the plot with a loading
placeholder — and doing so takes the focusable element out of the document in
the middle of an interaction, so a keyboard user who has just pressed `+` loses
focus, and a wheel listener bound to that node is left bound to nothing.

So the plot is **always** rendered for an admitted viewport, over the range on
screen, and what changes is whether it has any sticks in it. A committed window
whose drawing has not arrived draws its axes and nothing else, and says so. The
result satisfies the rule more strictly than a placeholder would — no points are
shown under axes they do not answer — while leaving the surface, its focus and
its listener exactly where they were.

Four drawing states are named in the type rather than inferred, so the caption
cannot claim something the picture does not support: the transferred prefix, a
committed window's drawing, a committed window with no drawing yet, and a
gesture in progress being stretched from the drawing already in hand. Only the
last two are new, and both exist because a caption that said *"drawn as 0 sticks
of 0 observations"* while a request was outstanding would be a false statement
about the spectrum.

## A pointer frame is applied, and not published

`apps/desktop/AGENTS.md` says to keep pointer-move and cursor-frame data out of
React state, and a drag is a stream of them. The first version of this adapter
published every one: `gesture-moved` reached `setState`, the workspace and the
panel re-rendered, and the plot's reduction ran again — once per browser pointer
frame, for a change one number wide.

So the transport now separates two things that had been one. Every event is
**applied**: the reducer decides all of them and the held ref is always current,
which is what an adapter reading a reducer-assigned epoch depends on. Only a
transition the rendered surface has to know about is **published**. A gesture
starting is — a gesture now exists, an epoch was allocated, and the caption
becomes a transient one. A gesture settling or being cancelled is. What is not
is the gesture *moving*.

The predicate is a property of the two states rather than a second opinion about
the contract's events: `gesture-moved` is the one transition that rebuilds the
gesture and carries every other field through by reference, so two states
identical everywhere but the gesture's own range *are* a frame. Nothing has to
know which event was dispatched.

**Which leaves the drawing to move itself.** Taking frames off the render path
must not turn a drag into "nothing happens until you let go", so the adapter
transforms the sticks layer directly: a pan is a translate and a wheel zoom a
scale about the pointer, both exact, both one attribute, and neither a second
pass over the projection. The axis numbers and the range line are written beside
it, because a drawing that moves under numbers that do not is worse than one
that does not move.

Two consequences are deliberate. The transient caption **names no range** — a
gesture is drawn between two renders, so a number written there would be the
range the gesture began at, sitting under a plot that has since moved; the range
line carries the live numbers instead. And the transform is reset after *every*
render rather than at the end of a gesture, which is what makes it survive a
projection answering mid-drag: React has just drawn the range it holds, so any
transform left over is wrong by definition.

## Ownership extends from the wheel to the keyboard

ADR 0033's R1.2 rule — *a wheel is claimed only where applying it would change
the effective rendered domain* — is applied here unchanged. What is new is that
the same rule now governs keys.

The chromatogram calls `preventDefault()` for any key it recognises, including
one that does nothing at the edge of the run. That was defensible when the plot
was the only thing under the pointer; on a panel that scrolls inside a column
that scrolls, a key that changes nothing and is swallowed anyway is the keyboard
form of the wheel defect this repository already fixed once. So a viewport key
is claimed only when the transition it names was productive, and at a boundary
it falls through to the surface it sits in. The chromatogram keeps its own
answer to *that* question: it still claims any key it recognises, productive or
not, and revisiting it is its slice's decision rather than this one's.

A second, different ownership question turned out to span both plots, and the
section after next records it. The two are worth keeping apart: *productivity*
is about this product's semantics and is answered per axis; *whose input this
is* is not about semantics at all, and is answered once.

## A modified input is the host's, and that is a cross-axis rule

Review found that both plots claimed inputs the window around them already owns.
A Ctrl+wheel over either plot zoomed its axis and cancelled the event; Ctrl+0
with either plot focused reset a scientific range and swallowed the accelerator.
Neither adapter was wrong about *what the input would do*. Both were wrong about
*whether it was theirs*.

### Why this supersedes a decision that was correct when it was made

[ADR 0033](0033-visible-linked-tic-bpc-viewer.md) decided that `ctrlKey` would be
given no meaning, because reading it as a trackpad pinch is a guess about
hardware from a modifier key. **That reasoning is not reversed here.** Nothing in
this repository classifies a device, no pinch semantics were added, and touch
remains deferred. MSCanvas still cannot tell a physical Ctrl+mouse wheel from a
precision touchpad pinch that Chromium represents as one, and it does not try.

What changed is evidence about the *host* rather than about hardware. WebView2
enables its zoom controls by default — `IsZoomControlEnabled` — and names
Ctrl+Plus, Ctrl+Minus and Ctrl+mouse wheel as the inputs those controls use.
This repository disables none of that: `tauri.conf.json` sets no zoom or
accelerator option and the Rust window setup applies none, both verified before
the rule was written rather than assumed.

So the question is not *what device produced this event*, which a viewer cannot
answer, but *is this input already spoken for*, which it can:

> A Ctrl-modified wheel and a Ctrl-, Meta- or Alt-modified key are the host's.
> A scientific viewport does not claim them.

The old rule and the new one disagree about exactly one thing, and only one
sentence of ADR 0033 is withdrawn: *Ctrl-wheel over the plot is a zoom of the
run, like any other wheel.* Its test is replaced by tests that pin the opposite,
on both axes.

### Released before anything is read

For a modified wheel the guard is the first statement in the listener, ahead of
the pointer-anchor calculation, the delta normalization, the plan, the
`preventDefault()`, the dispatch, the epoch and the settle timer. That ordering
is asserted rather than described: a component test reads the plot's
`getBoundingClientRect` spy and finds a released wheel cost the panel no layout
at all. For a modified key the guard is the first statement in the handler, so
no transition is planned and nothing is cancelled.

A released input must not be half-taken. The evidence asks for both halves every
time -- the reducer's own state unchanged **by identity**, and
`defaultPrevented` false -- because a surface that moved nothing but cancelled
the event would still have taken the accelerator away.

### Shift is not on the list, and that is load-bearing

On common layouts `+` is produced by holding Shift, so a guard that rejected
Shift would disable the ordinary zoom shortcut while protecting no accelerator
at all. Ctrl, Meta and Alt are what turn a character into an application or
browser accelerator; Shift is how one of this product's own shortcuts arrives.
Ctrl+Shift+`+` is still released, because Ctrl is there. Both suites pin the
Shift-produced `+` and the Ctrl+Shift form beside each other, and a mutation
that adds `shiftKey` to the predicate is killed by them.

Shift-, Alt- and Meta-modified *wheels* are given no meaning, because none has a
published WebView zoom meaning and inventing one would be the same guess this
rule exists to avoid, in the other direction. ADR 0033's point survives there
intact, and a test now pins it against Shift rather than against Ctrl.

### One predicate, still two authorities

`viewer/hostInputOwnership.ts` holds the policy for both plots, and sharing it
does not make the axes one authority any more than sharing `wheelInput.ts` does:
it decides nothing about a range, knows no domain, and has no axis in it. Two
copies would be two places for the policy to drift, and the drift would be
invisible -- the two plots would simply come to disagree about which keystrokes
the window still owns. The reducers, the state machines and the
`RetentionTimeDomain` / `MzDomain` brands stay exactly as separate as they were.

### What the rendered evidence can and cannot say

The browser and real-WebView2 suites both drive these inputs and read
`defaultPrevented` off the real DOM. What they establish is that **MSCanvas does
not claim the event**, which is what leaves the host's documented accelerator
path available. What they do not establish is that the WebView then zoomed: a
dispatched event is not a user gesture and no engine performs its native zoom
for one, however the listener answers. Proving that would need OS-level input
synthesis, which was not added for this. The specs say so in place rather than
letting a green check imply more than it measured.

## `touch-action: pan-y`, deliberately not `none`

The chromatogram takes every touch. Copying that here would have removed the
only way to scroll the selected-spectrum panel on a touch screen, because this
panel is a scroll container inside another one and its content is routinely
taller than its box.

The axis this viewport navigates is horizontal, so horizontal travel is claimed
and vertical travel stays the browser's. A vertical drag then arrives as a
pointer cancel, which the contract already answers by abandoning the gesture
rather than committing it. No touch or pinch semantics are added; this is the
narrowest declaration that lets a horizontal drag exist without taking anything
away.

## Two surfaces offering the same verb

`Zoom in` was already a button in this window. A second one would have made
`getByRole("button", { name: "Zoom in" })` ambiguous — which the existing
chromatogram tests do unscoped — but the test breakage is the symptom rather
than the problem. A reader being read the interface rather than looking at it
would meet two controls with one name and no way to tell which plot each moves.

So the labels name their axis: `Zoom in m/z`, `Zoom out m/z`, `Reset m/z range`.
The visible text *is* the accessible name; nothing is overridden with an
`aria-label` that a sighted user could not read back.

## One element says it, and says it once

The status line is visible text **and** the live region, in one element carrying
one string, empty while a current drawing is on screen. The alternative shape —
a visible paragraph plus a hidden `aria-live` twin carrying the same sentence —
is exactly the inherited M4.4 P3-3 debt, where `visually-hidden`'s `clip-path`
removes an element from the page but not from the accessibility tree and a
reader traversing the panel meets the sentence twice. ADR 0037 binds this slice
to satisfy the live-region rules *without adding another instance of it*.

It uses `aria-live="polite"` without `role="status"`, which is this
application's own shape for a region that is also its own visible text. The role
would additionally have made it the second thing in the panel answering to
`status`, beside the export result.

The range line beside it is deliberately **not** a live region: it changes on
every frame of a drag, and a region announcing each of them would be noise. It
is half of the plot's accessible description instead, which is the same decision
the chromatogram's readout records.

## Two sentences that quietly became false

A truncated spectrum used to be described by a notice saying *only the drawing is
limited to the first N points*, and by an accessible summary saying *the drawing
covers the first N of those points*. Both were true of a panel with no viewport.

Where a viewport is admitted, neither is: every committed range is drawn from the
complete spectrum Rust retained, and the transferred prefix has stopped being
what the drawing is taken from. Leaving those sentences in place would have made
the panel's own words the thing contradicting the milestone — a reader panning
past m/z 302.5 would be told the drawing stops there while looking at points
beyond it. Both now branch on whether this spectrum has a viewport, and the
no-viewport wording is untouched.

## Two defects the evidence found, and neither was visible to review

**Zooming out at full range did not always land back on the full range.** A zoom
holds a point and scales both edges away from it, and recovering an edge from a
centre rounds — so for a spectrum of m/z 110.3 to 500 it produced a low of
110.30000000000001, whose span is smaller than the source's by one part in ten
thousand million million. `isFullMzDomain` compares edges, so the reducer did not
recognise that as the whole spectrum: it committed a *subrange*, the caption
stopped saying full range, `Reset m/z range` lit up, `Zoom out m/z` offered to do
it again, and the wheel was cancelled for it — so the column underneath stopped
scrolling for an event nothing could see.

Measured over 121 plausible m/z domains: **nine of them at the centre anchor a
button uses, and twenty-one — about one in six — at some anchor a wheel can land
on.** The same rounding reaches the narrowest window from the other direction,
where it moves a window that has no width left to give.

The retention-time planner answers this by projecting a gesture through its
settle, and that turns out to change no verdict at all: `committedForm` can
answer `null` only where the clamped window already equals the source by value,
which is exactly where the unsettled comparison already said unchanged. What
rescues the well-behaved domains is `clampMzDomain` holding the low edge to the
source, which catches the half that round *below* `full.low` and none of the half
that round above.

So the repair is upstream of the rounding, and states as limits what
`clampMzDomain` already enforces: a zoom asking for at least the whole spectrum
**is** the whole spectrum, and one asking for no more than the narrowest window
that spectrum allows **is** that window, built where it already sits. Neither is
an epsilon.

The second of those was got wrong once on the way, in the direction nobody
notices. Refusing the last step outright is also inert at the floor, and it left
`Zoom in m/z` disabled while the contract would still have narrowed the window --
by up to 40% of its width -- which is the availability rule broken by a control
saying there is nothing to do when there is. Holding the low edge instead reaches
the floor *and* rests there: the width becomes the floor exactly, and the window
is built by a computation that reproduces itself, so asking again returns the
same answer rather than drifting a unit in the last place per notch. What that
costs is the last step of a ten-thousand-fold zoom shrinking toward the window's
left edge instead of toward the cursor -- at most two-thirds of the floor, which
is 0.0067% of the spectrum.

**The retention-time planner shares the arithmetic and is not repaired here.**
`viewportAction.ts` is ADR 0033's, its rendered evidence is the chromatogram's,
and folding a change to a shipped surface into this slice would be changing
something M5.2 has no evidence for. Recorded as P3 for whichever slice next owns
that planner.

**A pan at a saturated edge reported a real action.** The two limits above were
stated for zoom only, and the planner handed pan straight to `panMzDomain`,
whose clamp recovers a width by subtracting endpoints and rounds the same way:
`{525.15, 1000.3}` panned right to `{525.1500000000001, 1000.3}`. Forty-eight of
1,452 windows built flush against one edge did it. `pannedTo` now states the
edges in values — a window cannot begin before the spectrum does or end after it
— and governs the keyboard planner and the drag adapter alike, because fixing
only the planner would have left the identical defect under a finger.

Its two internal branches overlap: the resting guard and the edge-landing
construction each close the flush case on their own, measured over 400,000
random windows. Removing either alone is therefore undetectable, and both are
kept because together they make the limit hold by construction rather than by
the arithmetic happening to round back.

**A press outlived the spectrum it began on.** `pointerdown` remembers the window
on screen; the selection can then move — from the table, the chromatogram, or
Previous and Next — while the button is still down. A gesture already started is
safe by its epoch, because the new context never issued it. A press that has not
started one carries no epoch to be refused by, and its remembered window belongs
to the *previous* spectrum: the first move after the change started a gesture on
the new spectrum at a range taken from the old one's, clamped in and offered as
though someone had navigated there. That is precisely the continuity
`selectSpectrum` documents that it refuses to invent, leaking through the
adapter's own record rather than through the reducer. The press now records which
spectrum it began on and moves nothing once that is no longer the selected one.

Both were found by evidence rather than by reading: the first by measuring the
planner across many domains and anchors, the second by an independent reading of
the adapter's press record against what the contract promises. Both are pinned by
tests that fail when the repair is removed.

**And the repaired caption then gave a false reason.** Basing "every one of them
is drawn" on the stick count was right; the sentence it fell through to said
*more were measured here than this drawing has columns*, and `columnCount` is
`min(900, drawnFrom)` — so below nine hundred observations there are exactly as
many columns as observations and never fewer. Two peaks at m/z 120 and 130 in a
window of 100 to 200 collapse into one of two available columns, and the columns
were not the constraint. The reason given is now the one true on both sides of
the boundary: observations that share a screen column are kept as that column's
greatest non-negative and deepest negative measured observation.

## What is deliberately not offered

A spectrum with **no points** keeps the empty state it already had and gains no
viewport surface. Its domain is admitted and zero wide, so every control would
be inert and every drawing empty; three disabled buttons beside a sentence that
has already said there is nothing here is not saying it better. The zero-width
case the availability rule still owes is reachable — and tested — through a
spectrum whose points share one m/z.

A **press that selects nothing.** The spectrum plot is not the chromatogram's
scan-selection surface, and the gesture adapter being useful prior art is not a
reason to inherit its click semantics. Peak, ion, annotation and scan selection
from a spectrum click would each be new product semantics.

## Evidence

**Frontend tests: 1,275**, up from 1,093. One hundred and seventy over the new
surface, in three suites, plus four over the drawing itself. The planner's 95
hold one rule across six viewport states and every wheel input the arithmetic can
and cannot read, and two of them are the limits above, over the domains measured
to round the wrong way. The component's 70 assert, of every wheel and every key,
the two facts that are not the same failure — whether the domain moved, and
whether the browser event was claimed — and cover the drag's slop threshold, its
single epoch, its computation from the press origin *against the clamp*, its
settle, its cancel, a secondary pointer that replaces nothing, a wheel arriving
mid-drag that is neither claimed nor scheduled, a press held across a spectrum
change that moves nothing, every asynchronous state including the successful
empty window and the proof that it reads as none of loading, failure or refusal,
and a committed window whose old drawing is gone rather than shown beneath it.
The binding's 13 are about the wiring a single-spectrum test cannot see: stale
success, stale failure, two commits before the first answer, a selection that
changes while a request is outstanding, a refused spectrum that asks for nothing,
a redelivery that asks again for nothing, one bounded drawing kept however far
the reader pans, a window asked for from Rust's domain rather than from the
arrays this document holds, and an export that a committed window leaves alone.

**Twenty-five mutations**, applied one at a time and restored byte-for-byte,
with the hash checked after each. Twenty-two failed the check aimed at them: a wheel
always claimed and a wheel never claimed; a control offered where the reducer
would render nothing new; the previous drawing kept under a newly committed
range; a drawing asked for on every pointer frame; a stale drawing accepted; a
refused viewport taking a domain from the transferred arrays; a gesture's range
drawn as though committed; the drawing's own points deciding the range it is
drawn over; a pan accumulated from frame deltas; a second pointer taking the
press from the first; a press keeping its window across a spectrum change; both
limits removed so the candidate is the raw arithmetic again, and the narrow limit
put back the way that stops one step short; the caption reading Rust's reduction
flag; a failed range captioned as one still on its way; and an empty plot
claiming every intensity is the same; the caption blaming a shortage of columns;
both directions of the pan saturation, removed for every consumer; every pointer
frame publishing to React again; a transient transform surviving the render that
should have reset it; the roadmap calling M5 unstarted; and the feature catalog
listing spectrum zoom and pan as unimplemented.

Three survived and are reported as **equivalent mutants** rather than coverage
gaps. Recording a failure's message the contract refused — recording a failure's message the contract refused — survived
and is reported as an **equivalent mutant** rather than a coverage gap: the
message is read back by the contract's own generation, so a stale one could not
be shown even if it were stored. And `pannedTo`'s two internal branches, each of
which closes the flush case without the other over 400,000 measured windows.

**Rust tests: 1,303, unchanged.** No Rust file was edited. That is the claim this
slice most wanted to be able to make.

**Rendered browser QA** covers both availability states at 1920×1080, 1366×768
and 960×640 — the admitted one for its controls, its drawing area and their not
overlapping; the refused one for the reason it states, which is a paragraph
rather than a row of buttons and is the thing a narrow window clips first. It
drives real wheel, pointer and keyboard input, asserts `defaultPrevented` and the
rendered range as separate facts, reads the projection call ledger to prove a
drag asks for nothing until it settles, and carries the truncated-source proof: a
retained domain of 300–900 whose transferred prefix ends at 302.5, navigated past
it, drawing observations that could only have come from Rust.

**Real-Tauri QA** keeps `project_selected_spectrum` live against the real
process, so the domain, the drawing and the refusals are the ones the shipped
boundary produces.
