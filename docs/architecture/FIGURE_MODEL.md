# Plot and figure model

## Goal

Screen inspection and scientific export should share semantics while supporting different layout/theme/output needs.

## PlotSpec

Implemented for the M4 scenes as `mscanvas_plot_spec::spec` (schema version 1).
The list below is the full intent; what exists today is the subset the measured
scenes and the next visible slice need — kind, representation, axes with an
explicit unit state, full and optional visible domains, a value domain that may
reach below zero, ordered series with an explicit data scope, markers and
semantic style roles.

Deliberately absent until something needs them: provenance and artifact
references, annotation layers beyond markers, and any chart grammar.

A renderer-independent specification should eventually describe:

- plot kind (chromatogram, profile spectrum, centroid spectrum, scatter/table-linked result);
- axes, units, scale and visible/full domain;
- series/layers and data references;
- current persistent selections and annotations;
- labels, legend and semantic style roles;
- provenance/source artifact references.

It must avoid embedding application component trees or backend-specific handles.

## FigureSpec

A FigureSpec composes one or more PlotSpecs with:

- rows/columns/panel spans;
- shared axes and alignment;
- figure dimensions, DPI and export theme;
- title/caption/legend rules;
- annotation layers;
- output format options;
- data/provenance references.

## Two export modes

- **Copy screenshot** — fast current plot representation for discussion.
- **Export figure** — clean export-specific render with no app chrome, explicit dimensions/theme and reproducible spec.

## Initial outputs

- PNG and SVG;
- current visible range or full data range;
- independent light/dark figure theme;
- optional title/legend/metadata caption;
- underlying CSV/TSV with units.

## Renderer selection gate — closed

Closed by [ADR 0028](adr/0028-figure-renderer-and-semantic-specification.md) and
[the M4.0 evidence record](../spikes/M4_FIGURE_RENDERER_SELECTION_EVIDENCE.md),
against measured scenes rather than examples: a 100k-point chromatogram, dense
profile and centroid spectra, the 500k selection bound, and the empty, flat,
single-point and all-negative edges.

**Selected: one semantic contract, two renderers.**

| | |
| --- | --- |
| Screen | repository-owned TypeScript SVG, unchanged by M4.0 |
| Export | repository-owned Rust, over `FigureSpec` |
| Contract | `mscanvas-plot-spec`, owned in Rust where the data already is |
| PNG (M4.1) | `resvg`, Apache-2.0 OR MIT, called from Rust |
| Added dependencies | **none**, in either language |

The two renderers share semantics and not drawing code. That is the point rather
than a compromise: the screen answers a pointer sixty times a second and the
export answers a publisher once, and the only thing they must agree about is
what the data means.

## What the selection actually settled

- A screen reduction is **not** the exported data. `DataScope` says which a
  series is, so a full-range export cannot silently be the screen's reduction —
  the failure mode measured in the rejected DOM-serialization candidate, which
  exported 942 of 500,000 points.
- A reduction states **which** rule it used. `MinMaxPerColumn` keeps the greatest
  and the least value of a column; `ExtremePerSignPerColumn` — what the screen
  performs — keeps the greatest non-negative and the deepest negative, which for an
  all-positive column is one value, not two. The exported description names the
  rule in words, so the distinction reaches the reader rather than staying in the
  code.
- An **unreported** spectrum representation is not centroid data, and an
  unreported unit is not a dimensionless one. Both are third states in the
  contract, and the exported description says so in words — the unit one has to,
  because an unreported and a dimensionless axis are captioned identically and
  the difference would otherwise not survive the export.
- The figure theme is the figure's own. Colour is written into the document, so
  a light figure is possible while the application stays dark and the file means
  the same thing wherever it is opened.
- Export runs headless. No window, no stylesheet, no mounted component tree, no
  browser screenshot.

## Still open

Everything visible. FIG-001 through FIG-008 are unimplemented: there is no copy
action, no export action, no save dialog, no PNG, no CSV/TSV, no saved
specification and no composer. M4.0 selected the foundation and proved it in
private; M4.1 is the first slice a user can reach.
