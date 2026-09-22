# UI/UX gap assessment against the accepted v5.11 direction

Status: assessment only. No design direction is reopened, no style selection is
re-run, and nothing here is a change authorization.

## What this is compared against, and with what

The reference is the tracked
[durable v5.11 baseline](DESIGN_SYSTEM.md#durable-v511-reference-baseline) --
its tokens, region compositions and density rules. The production side is the
**installed** application observed during the 2026-09-19 provider-free window,
from retained screenshots in `.tmp/m76-evidence/` (`gui-14-page2.png`,
`gui-16-app-tab3.png` and the crops), plus colour and geometry sampled from
those images.

Two limits shape everything below, and neither is worked around:

- **The roster was empty for the whole window.** ProteoWizard is on HOLD, so no
  acquisition ever entered the workspace. Every density, selection-state and
  row-composition rule in the baseline is therefore unobserved, not failed.
- **Focus could not be attributed.** The keyboard/screenshot route could not
  establish which control held focus at any moment, so anything about focus
  treatment is a candidate, not a finding.

Where there is no actual comparison, the entry is **to be observed**. Nothing is
asserted from the demo's appearance alone.

## Four sampled colour roles, and what they do not establish

Sampled from the rendered application and compared to the baseline tokens:

| Role | Baseline | Rendered | |
| --- | --- | --- | --- |
| Page background | `#f3f5f8` | `#f3f5f8` | exact |
| Border | `#dce3eb` | `#dce3eb` | exact |
| Primary / focus | `#1769d1` | `#1769d1` -- both the primary button fill and the active navigation underline | exact |
| Surface | white | `#ffffff` | match |

Four roles matched on an empty first-run screen. That is four sampled tokens
agreeing, and it is **not** whole-palette fidelity and not design fidelity:
every state token (hover, selected, checked, disabled, error, warning), every
plot colour and every surface that only appears with data was unreachable in
this window. What these four support is the narrower claim that a colour pass is
not where the observed shortfall lies -- the shortfall in what *was* observable
is composition, density, flow and feedback.

## A. Existing functionality -- observations against the baseline

These concern capabilities that already ship. Each entry states what the
screenshots establish and what they do not.

### A1. The default state renders two regions -- measured

Baseline composition for the Workbench is grouped roster left, dominant evidence
centre, **contextual metadata right**, at roughly 240px / flexible / 245px. The
implemented mapping in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#m72-consumer-mapping) records production
regions of **280px / flex / 245px**, with the roster deliberately wider than the
reference to keep wrapped names and separate selection controls legible.

Measured horizontally across the content row of `gui-14-page2.png`:

| Region | Extent | Width |
| --- | --- | --- |
| Roster panel | x 233-511 | **278px** |
| Gutter | x 512-524 | 12px |
| Evidence panel | x 525-1624 | **1099px**, running to the window edge |
| Contextual metadata | -- | **absent in this state** |

So this rendered state shows two regions. That is the whole finding: **a
screenshot of two columns establishes the rendered state, not the absence of the
implemented Details panel.** The panel is implemented -- `WorkbenchHeader` owns a
`Details` toggle whose enablement is `detailsAvailable`, a property of the
workspace, and the region it controls is `#workbench-inspector`. Three separate
things would each have to be observed on their own before anything here is a
gap:

1. **the request** -- `Details` was never toggled during the window;
2. **the available data** -- with an empty roster there is no acquisition for a
   contextual panel to describe, and the toggle is disabled in exactly that
   case, by design;
3. **the responsive projection** -- below 1050px the mapping folds auxiliary
   panels into header actions, so a narrow capture would show two regions even
   with data present and the panel requested.

None of those was established. What is established is only that the default
Workbench state, empty, at this one viewport, presents two regions.

**Settled by M8.2, from the code rather than from a frame.** The region is
implemented as `#workbench-inspector` and has been since M7.2. Its availability
was `preview.status === "loaded"` and nothing else, so the `Details` control was
disabled wherever no acquisition had been read -- including the Project surface,
where contextual metadata is exactly what belongs. That is the fact the
screenshot could not distinguish from "unimplemented", and it is why the
distinction mattered: one is missing code and the other is a gate. M8.2 widened
availability to be a property of the surface and put the provenance consumer in
that region. The remaining items below are still unobserved.

Roster width measured 278px against a ~1410px content width. Against the
implemented 280px mapping that is a match, not a deviation; the ~240px figure is
the v5.11 reference the mapping deliberately departed from, with its reason
recorded.

### A2. Empty state carries the whole screen

With no acquisitions, the 1099px evidence panel holds one centred line
("Inspect an acquisition" / "Install ProteoWizard to read a file"), and the
roster panel holds its own empty message plus an `Ungrouped 0` group. Roughly
78% of the content width is an empty surface whose only content is a sentence
about a missing backend.

The baseline's stated qualities are evidence-first and calm density. An empty
first-run screen is the one state where there is no evidence to be first, and
this is the state a new user actually meets. Whether the demo's first-run
composition differs here is **to be observed** -- the tracked baseline records
regions and tokens, not an empty-state composition, and no demo screenshot is in
the repository.

### A3. Missing-backend feedback: explanation strong, progression weak

Established from the window: the banner states the condition plainly, names both
remedies, and offers `Check again` and `Choose folder...`; the evidence pane
repeats the consequence. Against the baseline's "clear causality" this reads
well.

Two flow gaps are visible in the same frame:

- The banner and the centre pane say the same thing twice, in a state where the
  screen is otherwise empty.
- `Setting up ProteoWizard` sits under the banner as a disclosure whose expanded
  content was never opened, so whether it carries actual setup steps is **to be
  observed**.

Whether either recovery control leads anywhere is **to be observed**: neither was
actuated, so the post-recovery flow is unobserved.

### A4. Focus visibility -- candidate defect, unconfirmed

The baseline requires "visible focus has a 2px outline with offset". Across
several deliberate attempts the focused element could not be identified from
rendered frames, including a targeted attempt on the banner's `Check again` and
`Choose folder...` links, which render as permanently underlined text.

This is **not** a finding, and it is equally not evidence that focus treatment is
correct. The route established neither: it could not attribute focus to any
control, so the focused control and its rendered state are both unobserved and
the hypothesis stands open in both directions. It is the most likely real
accessibility gap and is exactly what `uia_observe.ps1` was prepared to settle,
by reading `HasKeyboardFocus` while a before/after frame pair is captured. If a
control demonstrably holds focus and no indicator is discernible, that is a
narrow product accessibility defect against the baseline and against WCAG 2.2
focus-visible -- to be investigated as a product repair, not patched around in a
test. Until that observation exists, neither "proved absent" nor "proved
correct" may be written down.

## B. Implemented but unobserved, versus genuinely later scope

These are two different things and were previously listed as one. Mixing them
would have counted shipped M7.2/M7.4 work as missing code.

**Implemented; unobserved in this provider-free empty-roster window.** Not gaps,
not future backend work, and not to be re-implemented. What they need is data in
the roster, which in this window there was none of.

| Baseline region | Implemented by | Why unobserved here |
| --- | --- | --- |
| Roster selection distinctions -- viewed acquisition, highlighted row, focus, and checked conversion membership as separate labels and cues | M7.2 | The roster was empty all window |
| Workbench evidence area -- dominant plots/scans and the retained plots/table/export flow | M7.2 / M7.3 | Same |
| Conversion and results -- compact configuration, precision segments, one compact summary with inspectable detail, figure controls beside preview | M7.4 | Same, plus the provider HOLD meant no conversion could run |

**Genuinely later scope.** Not built, and correctly not counted against this
build.

| Baseline region | Status |
| --- | --- |
| Persistent layer identity and provenance in figures | Not built; later M8 scope |
| Reusable QC summaries and report surfaces | Not built; later M8 scope |

## C. To be observed -- no actual comparison available

Recorded so they are neither claimed nor forgotten.

| Item | Why unobserved | What would settle it |
| --- | --- | --- |
| Roster density against the **implemented** 44/32px comfortable/compact row minima with wrapped names | Roster empty all window | Populate the roster and measure. The prototype's 61px acquisition-row minimum is **not** the production requirement: `DESIGN_SYSTEM.md` records 44/32px as a deliberate M7.1 production density that M7.2 preserves, and notes that copying an overridden token would not satisfy the consumer. Measuring against 61px would be measuring against the wrong number |
| Three selection states (viewed / drag-selected / checked) rendering as M7.2 implements them | No rows existed | Same |
| Right-hand contextual metadata region | `Details` never toggled, roster empty, one viewport only | Toggle `Details` with at least one acquisition present, at a viewport above 1050px, and re-measure the three regions |
| Settings composition: category navigation, label/help left, choice right | Settings never opened | Open Settings in the installed build |
| Simplified-Chinese application UI | Never switched | Switch language in real Settings |
| Constrained reflow at 960x640, and 1920x1080 | Only one viewport captured | Re-observe at the baseline's three viewports |
| Type scale (body 14 / labels 13 / captions 12), spacing scale, 6px/8px radii, 36px/32px control minimums | Not measurable reliably from these captures | Measure in a live inspected build |
| Empty-state composition versus the demo | No demo screenshot in the repository; baseline records tokens and regions only | Owner-held v5.11 material, per the baseline's custody note |

## How to use this

A3 is actionable against shipped code. A4 is the one candidate product defect
and has a prepared, unrun instrument. A1 is now an observation about one
rendered state, not an actionable gap: what it needs is the three separate
observations it names. Everything in C needs one bounded observation window
before it can be called a gap at all -- and several items in C would be settled
by the same window that settles A4.

Retained populated-UI evidence and the existing browser-composition fixtures are
the material to compare against for layout and interaction. Fixture evidence is
synthetic and must be labelled as such: it can assess composition, density and
interaction, and it establishes nothing about provider operation.

No item here justifies a style re-selection, a new reference-design contest, or
a colour change, and none of it is a reason to start the deferred guest campaign
to refresh screenshots.
