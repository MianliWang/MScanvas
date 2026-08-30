# ADR 0041 — Selection availability governs committing a scan, not reading a run

Status: accepted
Date: 2026-08-30
Related: [0032](0032-viewer-interaction-and-viewport-state.md),
[0036](0036-linked-chromatogram-spectrum-figure.md),
[0037](0037-viewer-completion-route.md),
[0038](0038-spectrum-viewport-authority-and-screen-projection.md),
[0039](0039-visible-spectrum-viewport-adapter.md)

## What this ADR is

M5.7, the slice that gives every viewer surface which can commit a scan one
truthful availability posture. [ADR 0037](0037-viewer-completion-route.md)
remains the route authority. What is recorded here is the rule the viewer now
holds, and the three decisions inside it that had a plausible alternative worth
writing down.

On the `XIC_SOURCE_REFUSED` branch the complete set of surfaces that commit a
scan is two: the chromatogram, and the scan table's row click, `Enter`, `Space`
and the two scan steps. M5.7 closes those and adds none.

## One selection-start authority, and it now carries its reason

`canStartSpectrumSelection` was the rule and it answered yes or no. The operation
guarded itself with it from refs; the interface read it from rendered state to
decide what a control could advertise. That much is unchanged, including what is
deliberately *not* in it — an adjacent row, a row already being read, or another
unresolved selected-spectrum read, which a newer selection of a different scan is
allowed to supersede.

What changed is that a boolean could gate a handler and could tell a reader
nothing. So every surface that wanted to explain itself had to decide again what
was wrong, and that is a second authority however carefully it is written. The
rule now returns:

```ts
type SpectrumSelectionAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: SpectrumSelectionUnavailableReason; message: string };
```

and the boolean is `status === "available"`. One value, one message, every
committing surface reading it.

**Precedence names the fact that decides, not the one that lasts longest.**
Several blockers hold at once, and the order is: nothing to select from; a check
owning the backend lane; a settled verdict this session will not launch against;
a conversion. The second ranks *above* the third rather than below it, and that
was the correction: a check reports the backend as not usable for as long as it
runs, so reading that as a verdict tells the reader their installation is broken
every time it is looked at. A conversion is last, because naming it while one of
the other two also holds would promise that waiting is enough.

**Messages name something on screen or something the reader can change.** A lane,
a ref, a token or a mutex is true and useless — it describes the machinery that
refused rather than the situation the reader is in. There is no message for
`available`: an explanation beside a working control is a reason to doubt it.

## Unavailable selection does not disable inspection or navigation

The rule this slice exists to hold:

> Selection availability governs whether a scan may be **committed**, not whether
> data already on screen may be read.

A conversion owning the backend lane says nothing about whether the run in the
viewer can be inspected. Everything that needs no backend therefore stays live
while selection is blocked:

- the chromatogram keeps hover and coordinate inspection, wheel zoom, drag pan,
  its keyboard viewport shortcuts, `Zoom in` / `Zoom out` / `Reset range` under
  their own productivity rule, and the TIC/BPC toggles;
- the scan table keeps scrolling, virtualization, `Arrow`/`Page`/`Home`/`End`
  roving focus, readable and focusable rows, and the selected row's marker.

Two implementations were rejected outright. `pointer-events: none` would take the
whole plot away, including the reading. Marking the plot or the grid `disabled`
would say the same thing to a screen reader — that this run cannot be examined —
which is false, and false in the direction that hurts the reader who is waiting.
`aria-disabled` is used, but on the **rows**, which genuinely cannot be
activated, and not on the grid, which can still be navigated.

The one thing a blocked click does keep doing is moving the table's roving tab
stop. The click still meant *I am here*; taking that away as well would be a
second surprise on top of the one the reader already has.

## One explanation, in one place, announced once

The viewer says why once, and both surfaces point at it by `aria-describedby`.

A sentence per surface would be the same sentence twice, and a screen reader
meeting the second copy has no way to know it has already been told. That was
also the shape of the two M4.4 P3 debts this slice owns and closes in the linked
figure section: a visible refusal plus a visually-hidden `aria-live` copy of it
announced correctly and put the sentence in the accessibility tree twice.

The pattern used in both places:

- **one permanent live region**, mounted whether or not it has anything to say.
  A region that arrives in the same commit as its text is not being watched when
  the text arrives — React reconciles same-typed siblings in one slot, so the
  node is reused and `aria-live` lands with the mutation itself;
- it holds **only the refusal**, and empties on recovery. Becoming usable is the
  state nobody needs telling about, and a region that filled with the ordinary
  description would read it aloud;
- it is the **visible** sentence rather than a hidden twin, so there is one
  occurrence;
- `:empty` collapses it, so an available viewer costs exactly what it did before;
- its `id` exists only while it has text, so no control is described by a promise
  of an explanation that is not there.

The viewer's notice sits above the three measured panels in a flex column rather
than as a fourth grid row. A fourth track would have cost 8px of gap permanently,
whether or not it had anything in it, and the three floors were measured against
a 768px window where that arithmetic decides whether a control is still inside
the column.

## The lane is the queue slot, not the conversion panel

`conversion.busy` is the conversion panel's notion of having work in flight, and
it includes a dispatched retry, an adoption and a diagnostics export. None of
those launches a ProteoWizard process or touches the preview, and the operation's
own guard reads the queue slot alone -- so `selectSpectrum` accepts a click
through all three.

The rendered projection read the wider value. Before this slice that closed two
scan-step buttons; here it would have closed the chromatogram and every row of
the table, and told the reader a conversion was running while a diagnostics text
file finished being written. **A surface that refuses where the operation accepts
is not the safe direction when it is also saying something untrue.**

So the lane is one predicate with two readers, the same shape the selection rule
itself has: `busyRef` for the handler and `backendLaneBusy` for the interface,
both from `ownsTheBackendLane`. The panel keeps its wider `busy` for its own
controls, which is what it is for.

## What this ADR does not decide

- **The lane rule itself.** Its four facts are unchanged, and it is still not
  `canPreview`.
- **The operation-side guard.** It stays, and stays read from refs, even though
  the interface no longer dispatches commits it knows will be refused. A handler
  can be several commits older than the truth; the rendered posture is a report
  of the boundary, not the boundary.
- **The conversion ref/render window.** Between `convert` claiming the conversion
  lane in a ref and the rendered busy following, the operation refuses while the
  rendered posture still says available. Every conversion-gated control in this
  interface has that window, and closing it belongs to the conversion lane's own
  contract.
- **Anything about XIC.** M5.4 refused it for the measured executable, so the
  surfaces closed here are the ones that exist.
