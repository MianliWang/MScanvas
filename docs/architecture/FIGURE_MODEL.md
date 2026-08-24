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
| PNG | `resvg` 0.48.1, Apache-2.0 OR MIT, called from Rust — added in M4.2 |
| Added dependencies | none in M4.0; three in M4.2, all Rust and all for pixels |

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

## First visible slice — M4.1

Closed by [ADR 0029](adr/0029-first-visible-spectrum-figure-and-data-export.md).
The selected mzML spectrum can be exported as an SVG figure, and the same
spectrum's points as CSV or TSV.

The property that milestone is about is where the data comes from. The webview
receives at most `MAX_SPECTRUM_POINTS` of each array because that projection
carries a *drawing*; the complete `SelectedSpectrumResult` stays in Rust, in one
session slot, and the webview receives an opaque token naming it. An export
command names a spectrum and never carries one, so what reaches the file cannot
be what reached the browser — the defect would otherwise be silent, because the
transferred arrays look complete for every spectrum smaller than the bound.

The figure and the data document are **siblings over that one source**. The rows
are not read out of SVG coordinates and the figure is not drawn from the rows.

| | |
| --- | --- |
| Scope | the currently selected mzML spectrum, full range |
| Figure | one panel, one measurement series, `DataScope::FullSource`, no visible domain |
| Representation | `Unreported` — the backend emits no profile/centroid marker |
| Units | `Unreported` on both axes — the backend emits no array unit |
| Data schema | spectrum CSV/TSV v1: `#` metadata preamble, header row, one record per source point |
| Saving | Rust-owned native dialog, no overwrite, private-sibling publication, no path crosses to React |
| Figure size and theme | M4.1 fixed 1200×640 light; **M4.2 makes both the user's**, defaulting to the same figure |

## Second slice — M4.2

PNG, `Copy plot`, and the figure settings all three figure outputs share.

| | |
| --- | --- |
| Raster pipeline | `FigureSpec` → the same deterministic SVG → `resvg` → RGBA8 → `png` |
| Second renderer | **none** — PNG is the vector figure on a pixel grid, and `Copy plot` is that path stopped one step earlier |
| Width and height | the final dimensions: an SVG is authored at them, a PNG contains exactly that many pixels |
| DPI | metadata only, written to `pHYs` as `round(dpi / 0.0254)` pixels a metre; it reaches neither the SVG nor the data documents |
| Raster bound | 32 megapixels, checked before allocation — a vector document can describe a figure a raster one cannot hold |
| Typography | the machine's own fonts; no font is vendored or fetched, and a machine that resolves none refuses the raster formats and keeps SVG |
| Clipboard | write-only, from Rust; the interface never receives an image and has no capability to read one |
| Determinism | same bytes for the same figure **within one environment**; no cross-machine claim, because installed fonts decide glyphs |

See [ADR 0030](adr/0030-png-copy-plot-and-figure-settings.md).

## Still open

FIG-004 is partial: selected-spectrum CSV/TSV exists, chromatogram data export
does not. FIG-006 through FIG-008 are unimplemented. There is no current-range
export, no XIC, no linked figure, no saved specification and no composer, and the
screen renderer still does not consume `FigureSpec` — screen and export agree by
both being right rather than by sharing a type.

TIC and BPC now exist on screen, with a retention-time viewport a user zooms and
pans. That closes the second half of the sentence above and makes the first half
answerable rather than hypothetical: **the range a current-range export would
describe is `ViewerInteractionState.committedDomain`** — `null` for the whole
run, otherwise a finite forward interval inside it. It is deliberately not the
gesture in progress, so an export taken mid-drag cannot describe a range the user
never settled on, and it is deliberately not the SVG's coordinates, the visible
ticks or anything a pointer holds. Nothing consumes it yet. See
[ADR 0032](adr/0032-viewer-interaction-and-viewport-state.md) and
[ADR 0033](adr/0033-visible-linked-tic-bpc-viewer.md).

The screen chromatogram is not drawn from a `PlotSpec`. It reads the same
scientific model the rest of the viewer does and draws with the repository's own
SVG, exactly as the stick spectrum does; the linked figure that would need a
shared specification is FIG-006, and it is not built. What the two already agree
on is the posture that matters — an unreported unit stays unreported, a reduction
is disclosed rather than presented as the data, and a value below zero is drawn
below zero.
