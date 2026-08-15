# ADR 0028 — Figure renderer and semantic specification foundation

- Status: Accepted as the foundation for M4 figure work. No visible export
  surface exists; FIG-001 through FIG-008 remain unimplemented
- Date: 2026-08-13

## Context

[The figure model](../FIGURE_MODEL.md) has carried a renderer-selection gate
since it was written: *do not commit the project to a renderer solely from
marketing examples*. M4 cannot start until that gate is closed, because every
later decision — export quality, PNG, linked panels, saved specifications —
inherits whatever is chosen here.

Two facts about the repository shaped the answer more than any library did.

The screen already renders spectra with no charting dependency, and it does so
by reducing to at most 900 columns and emitting every stick into **one** SVG
path. Measured: a 500,000-point spectrum costs 10–11 DOM elements and one
`<path>`, the same as a 20,000-point one.

And `mscanvas-plot-spec` was a scaffold with **no dependant anywhere in the
workspace** — no Rust code imported it, no serialized instance existed. Its
`PlotKind` forced every spectrum to be centroid or profile, and its
`Option<String>` unit conflated "the file reported nothing" with "this quantity
has no dimension". There was no version 1 contract to preserve; there was an
early sketch to replace.

## Decision

### One architecture, split by responsibility

**Screen: repository-owned TypeScript SVG. Export: repository-owned Rust.**
Different technologies, one semantic contract.

The contract is `FigureSpec`, owned in Rust, where the data already lives. The
screen and the export agree about science and disagree about drawing, which is
the requirement — sharing semantics was never the same as sharing a renderer.

The screen renderer is **unchanged by this milestone**. It was measured, it was
sufficient, and changing it to make a spike look complete would have risked
shipped behaviour for nothing.

### Why it won

**Semantic correctness first, and it was decisive rather than close.** The
contract makes `Unreported` a third representation rather than a missing
boolean, and the renderer refuses to join anything but established profile data:
joining centroid peaks would draw intensity at m/z values nobody measured, and
joining unreported points would assert the representation while drawing it.
`UnitState` keeps `Unreported` and `Dimensionless` apart for the same reason.
Negative intensity is preserved end to end.

**The export renderer is deterministic and headless.** Byte-identical across
renders, produced in `cargo test` with no DOM, no window and no stylesheet.

**The screen needs nothing added.** 500,000 points render in ~13 ms mean to a
constant 1-path DOM; a pointer lookup against the source domain costs ~80 ns. A
library would have replaced a working renderer with a dependency.

### Why the alternatives lost

**Candidate A — export by serializing the mounted DOM.** Measured on the
500,000-point scene: it exported **942 points, 0.19% of the source**, silently.
It carried the application's class names and no colour of its own, declared no
dimensions, carried no accessible title or description, and required a mounted
React tree. It fails the export criteria on five counts at once, and the first
one — exporting the screen's reduction as though it were the figure — is the
precise failure the export path exists to prevent.

**Candidate C — Observable Plot 0.6.17.** Installed, measured, removed. Its
simple output *is* byte-deterministic, so the blanket claim against it would
have been wrong; what is true is narrower and worse. Clipped plots are not
reproducible — clip-path ids come from a module-level counter, so the same
figure rendered twice in one process differs — and a visible-domain figure is
exactly a clipped plot. Its coordinates carry a half-pixel offset that resolves
differently on HiDPI and in headless runs. It emits no `<title>` or `<desc>`. It
needs jsdom to run without a browser. And it costs **+86.87 kB gzip, +99.2%** of
the shipped JavaScript, measured in this application with real tree-shaking.

**Excluded before measurement**, each on a fact no timing could change: uPlot has
no SVG code path at all and exports bitmaps; Chart.js is canvas-only by
maintainer decision; Plotly exports 100k-point traces as embedded raster;
ECharts has a real DOM-free SVG path but counter-derived ids and a build ~1.9×
the current bundle; Recharts, Victory and visx are React-DOM-coupled, which is
candidate A with a dependency attached. The details are in
[the evidence record](../../spikes/M4_FIGURE_RENDERER_SELECTION_EVIDENCE.md).

### The contract

`FigureSpec` holds ordered `PanelSpec`s, a figure size, a figure theme and its
own words. A panel holds its kind, two axes, a full domain, an optional visible
domain, a value domain that may reach below zero, ordered series and markers.

Three decisions inside it are load-bearing.

**`DataScope` is explicit.** A series is `FullSource` or `Reduced` with the
count it came from and the rule that made it. This is what makes "a full-range
export is not the screen's reduction" a checkable property rather than a
convention — and what lets a reduced figure disclose itself in its own
description.

**Arrays live in the specification, not behind a reference.** Rust already owns
the data; there is no persistence layer for a reference to point into, and
inventing an artifact identifier before artifacts exist would be a fiction the
next milestone would have to unpick.

**Validation is one boundary.** Every value is either unrepresentable when
invalid or refused at a constructor: mismatched axis lengths, non-finite
coordinates, unordered source data, backwards domains, a domain whose two ends
are finite but whose width is not, unbounded or non-printable labels, a
reduction claiming a source smaller than itself, a visible window outside the
full domain, a series holding a point outside the panel's own declared range, a
figure too small for the panels it declares — the per-panel floor is what leaves
room for a panel's two value-axis ends to be printed further apart than they are
tall, a legibility rule the contract has to carry because only it knows how many
panels share the height — a panel drawn as marks from zero
whose value range does not contain zero, a joined trace reduced by a rule that
keeps one extreme per sign, a marker placed where the panel's source does not
reach, a panel carrying two series of one style role, a reduction of a
non-empty source that kept no points — neither named rule can produce that,
since both keep at least one extreme from every column holding a source point,
so the figure would report a rule doing what the rule cannot — and a label
holding a character XML 1.0 forbids.

That last panel rule is refused rather than styled around, and it is stated
over roles rather than over any one of them. A role is exactly what a renderer
maps to a stroke, so two series sharing a role are drawn in one colour at one
width with nothing left to tell them apart — and a description naming both ids
under the same role cannot say which line is which either. It is a figure that
looks like a comparison and cannot be read as one. Written against
`Measurement` alone, the same rule left two baselines drawing the same grey
line as each other, which is why it belongs to the mapping and not to a member
of it. Telling more series apart needs a style system and a legend to decode
it, and a legend is figure layout: FIG-008, a named non-goal here. One
measurement read against one baseline stays representable and stays
distinguishable, in the drawing and in the words; an overlay of two
measurements is VIEW-008's multi-layer comparison, which should arrive with the
component that can draw it rather than as a figure that renders ambiguously
today.

Two of those are about the file rather than the drawing. A marker outside the
**full** domain can be drawn at no window at all, including a full-range export,
so it is an annotation that silently does not exist — refused, while a marker
inside the source but outside the current window stays valid, because that one
is exactly what reappears when the window widens. And `U+FFFE` and `U+FFFF` are
`char`s that are not control characters and are outside XML's `Char` production:
escaping does nothing for them, so a label carrying one produces a document no
parser will read, and the figure does not open at all.

The last of those is worth naming beside the zero-baseline rule, for the same
reason. `ExtremePerSignPerColumn` keeps a single value for an all-positive
column — the tallest — and joining those across columns draws the upper envelope
of the data rather than the data: every trough is gone and the whole trace sits
above the measurement, while each drawn point is individually real, so nothing
in the output can say so. Refused rather than left to the caller happening to
pick the other rule, and only in that direction: two sticks in a column is not a
misdrawing, so a discrete panel accepts either.

Decoding refuses a field this build does not know, at every depth. Ignoring one
turns a typo into a silent change of meaning: a misspelled `visible_domain`
decodes as *no window*, and a specification that asked for a selected range
becomes a full-source export with nothing in it to say so. An optional field is
exactly where that is invisible, because there is no missing-field error to
raise.

"Unrepresentable" is load-bearing rather than decorative, so every field
carrying a validated invariant is `pub(crate)` with a public read accessor. A
public field would have reduced the claim to *checked once*: a marker position
written to `NaN` after construction reached the renderer, where both domain
comparisons are false for `NaN`, and `x1="NaN"` was written into the document.
Reading is unrestricted; writing goes through a constructor or does not happen.
`Deserialize` is implemented rather than derived for the same reason, on **every
type that documents an invariant** — `FigureSpec`, `PanelSpec`, `SeriesSpec`,
`Marker`, `Domain`, `FigureSize`, and `Label` and `Caption`, whose private inner
string otherwise had a public door. A derived implementation is a second entry
point, and `serde_json::from_str::<FigureSpec>` (or `::<Label>`, decoded alone
and then handed to `with_title`) would have built the value field by field and
skipped every rule that [`FigureSpec::from_json`] applies. A newtype whose
invariant one entry point does not hold is a `String` with a longer name.

Listing them individually is the point rather than pedantry. Sealing only the
outermost three left `serde_json::from_str::<Domain>(r#"{"low":10,"high":0}"#)`
building an inverted domain whose `low`, `high` and `span` then contradicted the
sentence directly above them — and being reachable only through an outer
constructor that happens to revalidate is not the same as holding an invariant.

That splits the decode errors along a line worth stating: a value refused as it
is read never becomes a value, and reports `Malformed`; a document whose parts
are each readable and disagree with one another reports `Spec` with the rule
that failed. Sealing the fields closed the mutation route;
this closes the construction route beside it. `from_json` reads the wire shape
itself so that its refusals keep the `SpecError` that caused them rather than
arriving as a decoder message a caller would have to parse — and the wire shapes
therefore **nest**, each holding the wire form of its members rather than the
checked one. A tree whose parts validated themselves as they were read would
report every inner disagreement as a decoder message, which is the `SpecError`
this whole arrangement exists to preserve.
`with_markers` validates for the same reason — a second constructor that skips
the check is how a rule gets added in one place and bypassed in another.
Unordered data is **refused rather than sorted** — sorting would decide the file
meant something other than what it said, and the out-of-range check exists for
the same reason: the alternative was to clamp at render time, which draws a
value the measurement does not contain at a position it was never at.

The zero-baseline rule is the one worth naming, because it refuses something
that renders without complaint. A stick encodes its magnitude as a length from
zero, so against a range of `500 .. 9000` the baseline pins to the panel edge
and the drawing means something other than it appears to: measured before the
rule existed, a stick at 500 came out **0.000 units long** — invisible — and one
at 4,750 came out 181 of 362 units, exactly half, encoding its distance from 500
rather than its magnitude. Widening the range inside the renderer was the
alternative; it was rejected because the axis text would then have disagreed
with the drawing. A trace is exempt: it is a shape over the axis, and a value
range excluding zero merely zooms it.

Schema version stays `1`, because no version 1 instance ever existed. Decoding
refuses any other version rather than reading what it recognises.

### Reduction semantics

A reduction is a claim about which measurements were dropped, so the contract
names **two** rules rather than one, and a figure states which it used:

- `MinMaxPerColumn` — the greatest and the least value of each column, whatever
  their signs. Two points per column unless they are the same point.
- `ExtremePerSignPerColumn` — the greatest non-negative and the deepest negative
  value of each column. **One** point for an all-non-negative column, which is
  most columns of a raw intensity trace. Non-negative rather than positive
  because the boundary is `>= 0`: a column of measured zeros keeps a zero, and
  calling that the tallest *positive* value would assert a positive signal the
  column does not contain — in the screen's caption and in the exported
  `<desc>`, which share this sentence.

This is the rule `StickSpectrum` performs today, and the split exists because
naming it min/max would have been false for nearly every column it draws — a
false sentence the renderer writes into the exported `<desc>`, so the figure
itself would assert it. Both rules keep signal of both signs where both are
present, which is the property that matters after baseline subtraction, where
intensity is legitimately negative and keeping only the larger magnitude would
erase measured signal of the other sign.

The measured difference is in the evidence record: the same four scenes reduce
to 1,800 drawn points under `MinMaxPerColumn` and to 900–942 under
`ExtremePerSignPerColumn`.

Pointer lookup resolves against the **source** domain, not the drawn sample.
Against the drawn sample it would answer with a point the reduction happened to
keep.

A panel narrowed to a visible window still carries its whole source — that is
what makes a full-range export possible from the same specification — so the
renderer **clips** to the drawn window rather than projecting past its edges,
and breaks a joined trace at the boundary rather than bridging a region the
window deliberately excludes. Clipping skips rather than clamps: clamping would
stack every out-of-window point onto the boundary.

### Accessibility

Every exported figure carries `<title>` and `<desc>`, derived when not supplied
rather than omitted. A derived title reads every panel rather than the first:
a linked chromatogram above a spectrum is the figure this contract exists to
make possible, and naming it after whichever panel sits at the top tells anyone
holding only the title — a screen reader announcing the document, a file
browser, a reference manager — that a mixed figure is one of its halves. A
mixed figure is `Figure`, which is neutral rather than invented: a combined name
would have to decide an order and a relationship the specification does not
state. A supplied caption is added to the derived description
rather than substituted for it, so the most carefully prepared export is not the
one that drops its own disclosures. The description states what the file
reported about the representation — including that it reported nothing — names
any axis whose **unit** the source did not report, discloses reduction with the
source count, the reduced count and the rule — and, when a visible window shows
fewer points than the reduction holds, how many lie inside it, because reporting
the reduction's size as the number drawn made the disclosure disagree with the
figure — and counts negative values
**over the drawn window rather than the whole series**, because the sentence
says *drawn* and a windowed panel still carries its whole source. Colour is
written into the document rather than left to a stylesheet, so nothing depends
on a stylesheet that will not travel with the file.

Nor on hue. A baseline and a measurement are drawn in two colours and were
distinguished by nothing else, so a monochrome print, a rasterization or a
reader who does not know this palette lost which line was which — while
`SeriesSpec` was carrying a name for each of them that the document dropped.
Every figure names its series: the id the contract holds, and which is measured
data and which a reference line. The sentence says *series*, not *series drawn*
— a series is present in its panel whichever way the window falls, and an
empty one, or a discrete one whose samples all lie outside the visible domain,
would otherwise be named and then reported as undrawn two sentences later, with
one `<desc>` contradicting itself.

**Every** figure, not only one where two series could be confused. Attribution
between traces is what prompted this, but identity is not only attribution.
`id` is the one place the contract says *which* measurement a series is, and a
lone chromatogram drawn against "Retention time" and "Intensity" has axes that
cannot tell a reader whether they hold a total ion current, a base peak trace
or an extracted ion chromatogram. Dropping the name because nothing sat beside
it discarded the only semantic field separating them. Two narrower rules were
tried first and each was silent somewhere it mattered — per panel, which said
nothing for two panels holding one series each, and then per figure, which said
nothing for one.

A figure of more than one panel also numbers them, counting from the top. The
panels stack in the specification's order and the description is one run of
text, so without an ordinal a reader has the paragraphs and no way to attach
them to the plots. One panel is not numbered: an ordinal with nothing to order
is noise.

The unit disclosure is where the contract's third state survives export. An
unreported unit and a dimensionless one are both captioned with the bare label —
printing an empty bracket or a guess would display a fact the file never carried
— so without a sentence saying which, the distinction the contract makes dies at
the file boundary it exists to cross.

A panel with no measured point inside the range shown says so, and says which
kind of nothing it is. A window between two discrete peaks draws no path at
all, and so does an empty source; the file otherwise claimed centroid data and
left those indistinguishable from each other and from a renderer that had
failed. Whether there is no data or merely no drawing is the one thing an
export must never leave ambiguous. A joined trace crossing such a window is the
third case and keeps its own sentence, because something *is* drawn there —
interpolated between samples outside the window rather than measured inside it.

Colour is held to a contrast floor rather than chosen by eye. Every role is at
least 3:1 against its own theme's background, which is what WCAG asks of a
graphical object, and a test measures all of them in both themes. The light
baseline was `#9a9a9a` — 2.81:1 on white, drawn as a one-unit hairline, so the
reference line a reader measures against was the least visible thing in the
figure. Contrast is not visible to the eye that picks a hex value, which is why
it is checked rather than intended.

The negative count is over measured values. A trace can also be drawn below zero
without one — clipping interpolates at the window edge, so a segment entering
from a negative sample outside the window is drawn below the line while every
measured value inside it is positive. That gets its own sentence rather than a
count, because counting an interpolated point would put a number in the
description matching no row in any source file.

And it names the zero line only where the figure has one. The trace exemption
above lets a value range exclude zero, and against a range like `-10 .. -5` the
horizontal rule is pinned to the edge of the plotting area as that range's own
end. Naming it the zero line there hands the reader the wrong datum to measure
every depth against, and contradicts the value-axis ends the same document
prints. Both sentences that would name it ask first — the counted one and the
interpolated-crossing one, which is reachable on its own because a window that
clips a segment with neither sample inside it counts no negatives at all — and
a panel whose range excludes zero states that fact once, for the axis rather
than for the values, naming which edge the rule actually is.

Axis end labels take their precision from the **span**, not from the magnitude:
a visible window of `1000.1 .. 1000.4` labelled by magnitude printed `1000` at
both ends, so the exported axis claimed zero width. Roughly three significant
An end whose fixed-point form runs past 24 characters is stated as an exponent:
`Domain` accepts any finite pair, and `1e307` written out is 308 digits, which
is neither a number a reader can read nor a string an axis can hold. Otherwise:
roughly three significant
figures across the span, six decimals for readability, and escalation past that
— to seventeen, where an `f64` stops carrying more — when the two ends would
otherwise print the same number. Seventeen decimal *places* is not seventeen
significant digits, so a domain like `1e-20 .. 4e-20` exhausts them all and
still prints `0.000…` twice; that pair falls back to exponent notation. The
fallback triggers on the two strings colliding rather than on a magnitude
threshold, so an ordinary axis never sees it. A single-valued domain is exempt
from the escalation: its ends *are* one number, and escalating would print
digits it does not hold.

Exempt from the escalation, not from the fallback — and that distinction was
the defect. Printing one value's two ends identically is the truth; printing
them as a *different* number is not, and `1e-20 .. 1e-20` never collides with
itself, so the collision rule could not see it: both ends came out `0.000000`
and the axis stated zero for a measurement that is not zero. The fallback
therefore also triggers when the fixed-point form has rounded a non-zero value
away to nothing. A domain that genuinely is zero still prints as zero, because
the test is losing the value rather than being small.

A marker label is wrapped to the width available, clamped inside **its own
panel** — below the plotting area sit that panel's axis text and then the next
panel, so a block bounded by the page could cover the axis it annotates — and
stepped down past every label already placed in its panel — and, where the page
has no room for the block at any position, shrunk a point at a time until it
fits, to a floor below which it would be present without being readable. A
label that does not fit at any size is **not drawn**, and the description names
it: an unreadable annotation and a missing one look identical in the figure, and
only one of them says so. That is why the panels are rendered before the
description is written — the words have to be able to report what the drawing
actually did.
Stepping down cannot help a block taller than the room left for it: two
eight-line labels do not fit one under the other on a small figure however
politely they take turns. Smaller text is a real cost; text with another string
drawn over it is a total one, and shrinking keeps every character. Two markers at one
m/z is a legitimate figure — a precursor window and its monoisotopic peak — and
one annotation drawn over another leaves a figure that looks annotated and is
missing an annotation. On screen an overflowing label is usually survivable; an exported
file has no viewport to scroll, so the annotation would simply be absent while
the marker's line still drew and the figure still looked finished. Clamping
subsumes choosing a side — near the right edge it moves the text left of its
marker on its own — and wrapping is what covers the case a side choice cannot:
a label longer than the page fits on neither side of anything. Nothing is
elided; every character appears, the spaces included: wrapping cuts the label
into pieces and never rewrites it, and the document carries
`xml:space="preserve"` so a viewer does not collapse `sample  A` into
`sample A` either. This boundary refuses a label rather than repairing one, and
a layout step quietly editing the same string would be that decision made
twice, differently. The character width is an estimate, and has to
be, because measuring text needs a font this renderer deliberately does not
carry; it errs towards wrapping early, which costs a line break, rather than
late, which costs the annotation. A label that would reach the value axis's own
maximum, printed at the same size a unit away at the top-left of the plotting
area, drops one line rather than being drawn over it; every other marker keeps
its natural place.

A string is **shrunk before it is condensed**, and condensing is a last resort
rather than the first answer. `lengthAdjust="spacingAndGlyphs"` will squeeze any
string into any width, so a 120-character title on the narrowest figure the
contract accepts came out at 0.97 units a glyph at font-size 16 — inside the
document, inside its declared box, and completely unreadable. Text present but
illegible was not what *condensed beats absent* was weighing.

The heading and the axis captions then part company, because what they lose
differs. A heading that fits at no readable size is **not drawn**, and the
description says so; `<title>` still carries every character, so the words never
leave the file. An axis caption is **never dropped** — an unlabelled axis is a
worse figure than a small label, and there is no metadata element carrying an
axis name the way `<title>` carries a heading — so it shrinks to the floor and
condenses only what will not fit even there.

Every laid-out string — the visible title, both axis captions, all four numeric
axis ends, and every line of every marker label — declares the width it
occupies. The document embeds no
font, so the face is the viewer's choice and a per-character number is otherwise
a prediction about someone else's machine; an explicit `textLength` with
`lengthAdjust="spacingAndGlyphs"` makes it an instruction instead. The number
itself is an upper bound on a glyph — `1em` — rather than the mean advance of a
sans-serif face, so a line of `W`s cannot overflow what was reserved for it even
in a viewer that ignores the attribute. Axis captions, which are centred rather
than wrapped, are condensed into the space they have: condensed text is harder
to read, and absent text cannot be read at all.

A label is bounded by the **plotting area**, not by the page. Left of the frame
is the value axis's own gutter, where its caption is drawn rotated through the
whole plot height, and that caption is written after the markers — so a label
allowed onto the page at large was covered by it. An annotation belongs to the
plot it annotates, and bounding it there needs no further collision box to
discover that.

One residual limit follows from it, stated rather than smoothed over: at the
contract's minimum figure size a maximum-length marker label does not fit the
plotting area at any size it may shrink to, so it is not drawn and the
description names it. That is the honest end of the ladder rather than a
regression — the alternative was a block drawn across the axis text it sits
beside — but it does mean the smallest figures cannot carry the longest
annotations. Laying annotations out *around* the other text needs either real
font metrics or a component that owns figure layout, and that is FIG-008, a
named non-goal of this milestone.

A **baseline** is drawn as the reference line the contract calls it, joined even
in a panel of sticks — and the contract, not the renderer, is where that is
decided. `PanelSpec::joins` answers it once for the drawing and for the
validation that refuses a per-sign reduction for anything joined; while the
renderer held the opinion privately, a baseline reduced per sign in a stick
panel passed a check that only asked about the panel kind. The rule against joining centroid peaks is about
measurements, and a baseline is not one: it is a model with a value everywhere
between its samples, so joining asserts nothing the series did not already
claim — while drawing it as sticks from zero puts a row of extra peaks into a
spectrum and labels them background.

Two discrete measurements at one position are **disclosed**. `SeriesSpec`
accepts equal neighbouring domain values deliberately — the axis is
non-decreasing, not strictly increasing — so two marks can be drawn from the
same baseline at the same x in the same colour, and the shorter sits inside the
taller where nothing can see it. Refusing would reject a file that genuinely
reported two intensities at one m/z; offsetting one would draw a measurement at
a position nothing measured it at, which is the error the clipping rules exist
to avoid. So the words carry it, which is what the words are for.

A measured zero draws a short mark on the zero line rather than a stick of no
length, and the description says every drawn value is zero. A peakless spectrum
and a spectrum with no points are different facts about a sample, and they had
been the same picture.

A trace that reaches the drawn window always leaves a mark. A single sample, a
series whose samples repeat one position, and a zero-width visible window all
produce a path of bare move commands, which paints nothing and reads as *no
data* — the one thing an export must never be ambiguous about.

The screen's existing accessible posture is unchanged: `role="img"`, an
`aria-labelledby` heading and a `<figcaption>` that already states reduction and
unreported representation in words.

### Dependency and bundle result

**No production dependency was added, in either language.** The frontend
manifest is unchanged; the Rust crate gained nothing beyond `serde` and
`serde_json`, which it already had. A test pins the frontend production
dependency set so that adding a charting library later is a deliberate edit
rather than a transitive arrival.

### PNG, for M4.1

`resvg` 0.48.1, `Apache-2.0 OR MIT`, verified against crates.io. It uses no
system libraries for text and claims pixel-identical output across platforms;
determinism requires supplying font bytes rather than loading system fonts. It
is called from Rust, which keeps the export path in one place and avoids the
`@resvg/resvg-js` MPL-2.0 binding and `sharp`'s LGPL prebuilt binaries.

Nothing was added for this. It is a plan with verified facts behind it.

## What this does not claim

**That figure export exists.** It does not. There is no command, no button, no
dialog and no user-facing surface of any kind. FIG-001 through FIG-008 remain
unimplemented.

**That PNG works.** No PNG is produced anywhere in this milestone.

**That the screen renderer was proved fast enough to paint.** jsdom rasterizes
nothing. What was measured is the cost of producing a scene and the DOM it
produces, not the cost of painting it.

**That the screen consumes the contract today.** It does not. `StickSpectrum`
takes points and a boolean, draws sticks for every input, and knows nothing
about `FigureSpec`. The screen and the contract agree on the facts that matter —
both extrema per column, an unreported representation stated as unreported,
negative intensity preserved — but they agree by both being right rather than by
sharing a type. Wiring them together changes a shipped component's behaviour and
is the first thing M4.1 does; doing it here would have risked that behaviour to
make a spike look finished.

**That a continuous-trace screen path was measured.** None exists to measure.
The joined-trace rule is held today only by the Rust renderer and its tests.

**That the timings are a guarantee.** They moved by up to 4.6× across four runs
on one loaded laptop while the byte counts stayed identical. They are
order-of-magnitude facts about this machine.

**That unreported representation or unreported units mean anything.** The
contract carries them as unstated and the renderer says so. Neither this
document nor any output interprets them.

**That the drawn order is a scientific order.** It is the source order the file
carried, preserved.

**That a path-free figure is anonymous.** The contract carries no path, but it
carries the measurement, and a figure of somebody's acquisition is about
somebody's acquisition.

## Consequences

- M4.1 can implement visible SVG export against a contract that already refuses
  the mistakes the export path is most likely to make.
- A second renderer — PNG — attaches to the same contract without touching the
  screen.
- A linked chromatogram/spectrum figure is a second `PanelSpec` in an ordered
  list, not a new shape.
- The screen and the export can diverge in technology without diverging in
  meaning, which is the property that made the split worth having.
