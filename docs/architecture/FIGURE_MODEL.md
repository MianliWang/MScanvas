# Plot and figure model

## Goal

Screen inspection and scientific export should share semantics while supporting different layout/theme/output needs.

## PlotSpec

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

## Renderer selection gate

Do not commit the project to a renderer solely from marketing examples. Spike:

- 100k+ chromatogram points with interaction/downsampling;
- dense centroid/profile spectra;
- linked pointer performance;
- crisp SVG export and text measurement;
- accessibility and headless/export behavior;
- maintenance and bundle cost.
