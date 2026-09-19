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

## What the gap is *not*: colour

Sampled from the rendered application and compared to the baseline tokens:

| Role | Baseline | Rendered | |
| --- | --- | --- | --- |
| Page background | `#f3f5f8` | `#f3f5f8` | exact |
| Border | `#dce3eb` | `#dce3eb` | exact |
| Primary / focus | `#1769d1` | `#1769d1` -- both the primary button fill and the active navigation underline | exact |
| Surface | white | `#ffffff` | match |

The palette already matches the accepted baseline at every point measured. The
shortfall is in composition, density, flow and feedback, and a colour pass would
not touch any of it.

## A. Existing functionality -- gaps against the baseline

These concern capabilities that already ship and could be judged.

### A1. The third region is not rendered -- measured

Baseline composition for the Workbench is grouped roster left, dominant evidence
centre, **contextual metadata right**, at roughly 240px / flexible / 245px.

Measured horizontally across the content row of `gui-14-page2.png`:

| Region | Extent | Width |
| --- | --- | --- |
| Roster panel | x 233-511 | **278px** |
| Gutter | x 512-524 | 12px |
| Evidence panel | x 525-1624 | **1099px**, running to the window edge |
| Contextual metadata | -- | **absent in this state** |

So the rendered shell is two regions, not three. `Details` does appear in the
top-right global actions with `Acquisitions` active, so it is plausible that
`Details` toggles the third region -- **that was never toggled during the window,
so whether the right region exists behind it is to be observed.** What is
established is only that the default Workbench state does not present it.

Roster width 278px against a ~1410px content width is wider than the reference's
240px-of-1366 proportion. Recorded as an observation; the baseline calls these
reference values, not pass/fail thresholds.

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

This is **not** yet a finding: the route could not confirm those elements held
focus. It is the single most likely real accessibility gap and is exactly what
`uia_observe.ps1` was prepared to settle, by reading `HasKeyboardFocus` while a
before/after frame pair is captured. If the element demonstrably holds focus and
no indicator is discernible, that is a narrow product accessibility defect
against the baseline and against WCAG 2.2 focus-visible -- to be investigated as
a product repair, not patched around in a test.

## B. Demo capabilities that depend on a later real backend

Not gaps in shipped work. They cannot be judged until the capability exists, and
must not be counted against the current build.

| Baseline region | Depends on |
| --- | --- |
| Workbench evidence area -- dominant plots/scans, viewed-row inset accent, drag-selection fill, membership checkbox as three independent states | Acquisitions in the roster, which today requires provider-backed reading |
| Conversion and results -- compact configuration, precision segments, one compact summary with inspectable detail, figure controls beside preview | Admitted vendor conversion, on HOLD |
| Layer identity and provenance in figures | Not built; M8 scope |
| Reusable QC summaries and report surfaces | Not built; M8 scope |

## C. To be observed -- no actual comparison available

Recorded so they are neither claimed nor forgotten.

| Item | Why unobserved | What would settle it |
| --- | --- | --- |
| Roster density: 61px acquisition-row minimum, wrapped names | Roster empty all window | Populate the roster. **To verify first:** whether adding files to the roster is provider-free, or whether admission itself needs the backend |
| Three selection states (viewed / drag-selected / checked) | No rows existed | Same |
| Right-hand contextual metadata region | `Details` never toggled | Toggle `Details` and re-measure the three regions |
| Settings composition: category navigation, label/help left, choice right | Settings never opened | Open Settings in the installed build |
| Simplified-Chinese application UI | Never switched | Switch language in real Settings |
| Constrained reflow at 960x640, and 1920x1080 | Only one viewport captured | Re-observe at the baseline's three viewports |
| Type scale (body 14 / labels 13 / captions 12), spacing scale, 6px/8px radii, 36px/32px control minimums | Not measurable reliably from these captures | Measure in a live inspected build |
| Empty-state composition versus the demo | No demo screenshot in the repository; baseline records tokens and regions only | Owner-held v5.11 material, per the baseline's custody note |

## How to use this

A1 and A3 are actionable against shipped code. A4 is the one candidate product
defect and has a prepared, unrun instrument. Everything in C needs one bounded
observation window before it can be called a gap at all -- and several items in C
would be settled by the same window that settles A4.

No item here justifies a style re-selection, and none is a colour change.
