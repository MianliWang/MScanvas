# MSCanvas roadmap

This roadmap sequences product risk; it is not the authoritative feature definition. See [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md) and [`docs/product/FEATURE_CATALOG.md`](docs/product/FEATURE_CATALOG.md).

## M0 — Feasibility spikes

- Validate user-installed ProteoWizard discovery and version reporting on Windows.
- Validate `msaccess` or another reviewed route for metadata, TIC/BPC and one spectrum without temporary full conversion.
- Validate `msconvert` process execution, progress parsing, cancellation and partial-output behavior.
- Compare three interactive workspace structures at 1366×768 with representative user tasks.
- Select an on-screen and export renderer after performance and SVG export spikes. **Done** — [ADR 0028](docs/architecture/adr/0028-figure-renderer-and-semantic-specification.md).

## M1 — Data workspace

- Real file/folder picker and Windows Explorer drag-and-drop.
- Logical dataset discovery, duplicate prevention and directory-dataset handling.
- Multi-select, remove selected, clear list, search/sort basics and empty/error states.
- Backend diagnostics and actionable first-run experience.

## M2 — Linked viewer

- Metadata summary, TIC/BPC, spectrum and virtualized scan table.
- Bidirectional linked selection, zoom/pan/reset and keyboard scan navigation.
- Lazy loading and bounded preview cache.

## M3 — Conversion workflow

- Typed conversion settings for mzML; keep mzXML gated until representative multi-source integrity checks pass.
- Queue, cancellation, retry, failure isolation and output-conflict handling.
- Transactional outputs and basic integrity checks.

## M4 — Figure and data export

The renderer foundation is selected and proved: one semantic specification, a
repository-owned screen renderer and a repository-owned Rust export renderer,
with no dependency added. The first visible slice has shipped.

**M4.0 — renderer selection.** Closed. See
[ADR 0028](docs/architecture/adr/0028-figure-renderer-and-semantic-specification.md).

**M4.1 — first visible spectrum export.** Closed. SVG figure export and
underlying CSV/TSV export for the currently selected mzML spectrum, at full
range, written from the complete spectrum Rust retained rather than from the
arrays the interface drew. See
[ADR 0029](docs/architecture/adr/0029-first-visible-spectrum-figure-and-data-export.md).

**M4.2 — PNG, Copy plot and figure settings.** Closed. PNG export and
`Copy plot` for the currently selected mzML spectrum at full range, both
rasterizing the same semantic figure the SVG export writes, plus user-selectable
width, height, PNG DPI and figure theme that SVG honours too. The
selected-spectrum snapshot lifecycle deferred by M4.1 is closed with it. See
[ADR 0030](docs/architecture/adr/0030-png-copy-plot-and-figure-settings.md).

**Viewer Closure R0 — the interaction and viewport state contract.** Closed, and
deliberately not visible. A first attempt at the linked TIC/BPC viewer
(PR #72) worked but drew nine real, reachable review findings across four rounds
-- a suppressed reveal, a late tie-break, a repeated commit nobody could see, a
stale settle overwriting a selection, an off-screen peak setting the y axis --
which read together were one thing: nothing said who owned the viewport, the
selection or the geometry. That PR is frozen as evidence rather than repaired a
tenth time.

R0 is the model those findings were about, written as pure TypeScript with no
React, no DOM and no timers: six separated state layers, one committed viewport
and one transient gesture with an epoch, one selection with a monotonic commit
revision that any number of linked views may consume, hover that cannot outlive
a viewport change, and geometry in which the visible value range comes from the
clipped polyline rather than from source points outside it. See
[ADR 0032](docs/architecture/adr/0032-viewer-interaction-and-viewport-state.md).

**VIEW-002, VIEW-005 and VIEW-006 remain unimplemented.** R0 ships no
chromatogram, no linked selection and no keyboard navigation; it ships the
contract the next slice builds them against.

Still outside it, and unchanged:

- Current-range export, which needs the committed viewport R0 defines and a
  visible viewer to choose one in.
- Chromatogram data export, and a linked chromatogram + spectrum figure
  template.
- XIC, spectrum zoom/pan, and multi-layer comparison.

## M5 — Public beta hardening

- Windows installer/signing plan, accessibility pass, crash/error diagnostics and public fixtures.
- Saved settings, layout persistence and beta feedback instrumentation that remains local-first.

## M6 — Artifact and QC foundation

- Project/artifact/run persistence and lineage.
- First reusable QC summaries and report surfaces.

## M7 — First analysis recipes

- Isolated worker contract and one or two reviewed recipes backed by mature packages.
- Recipe mode first; no generic workflow canvas until real needs justify it.

## M8 — Automation

- Stable CLI and schemas, then repo/user skills, then a narrow local MCP adapter.
