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
coordinates, unordered source data, backwards domains, unbounded or
non-printable labels, a reduction claiming a source smaller than itself, a
visible window outside the full domain. Unordered data is **refused rather than
sorted** — sorting would decide the file meant something other than what it
said.

Schema version stays `1`, because no version 1 instance ever existed. Decoding
refuses any other version rather than reading what it recognises.

### Reduction semantics

The rule is named in the contract — `MinMaxPerColumn` — and it is the one the
screen already performs: the highest **and** the lowest value of each column,
both kept, because intensity is legitimately negative after baseline
subtraction and keeping only the larger magnitude would erase measured signal of
the other sign.

Pointer lookup resolves against the **source** domain, not the drawn sample.
Against the drawn sample it would answer with a point the reduction happened to
keep.

### Accessibility

Every exported figure carries `<title>` and `<desc>`, derived when not supplied
rather than omitted. The description states what the file reported about the
representation — including that it reported nothing — and discloses reduction
with both counts and the rule. Colour is written into the document rather than
left to a stylesheet, so nothing depends on hue alone or on a stylesheet that
will not travel with the file.

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
