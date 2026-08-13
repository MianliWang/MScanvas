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

The renderer foundation is selected and proved in private: one semantic
specification, a repository-owned screen renderer and a repository-owned Rust
export renderer, with no dependency added. Everything below is still
unimplemented — selecting a renderer is not exporting a figure.

- Copy screenshot; PNG and SVG figure export.
- Current/full range, light figure theme and underlying CSV/TSV export.
- Linked chromatogram + spectrum figure template.

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
