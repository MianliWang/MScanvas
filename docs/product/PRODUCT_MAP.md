# Product map

## Product promise

MSCanvas is a local-first mass-spectrometry workbench that makes acquisition browsing, open-format conversion and scientific figure export substantially easier than legacy desktop workflows. Analysis can grow later through explicit modules backed by mature scientific packages.

## Primary users

- Researchers in proteomics, metabolomics, lipidomics and related LC/GC–MS fields.
- Core-facility operators and data managers handling batches of vendor acquisitions.
- Computational scientists who need mzML/mzXML and later reproducible analysis artifacts.

## Core jobs

1. Add a batch without fighting a file dialog or losing list state.
2. Confirm that the correct acquisition was opened and that the signal looks plausible.
3. Navigate between chromatogram, scan and spectrum without mental bookkeeping.
4. Convert selected or all acquisitions with understandable settings and recover from failures.
5. Export a clean figure and the data behind it.
6. Later, apply reviewed analysis recipes without learning package-specific APIs.

## Product layers

| Layer | Purpose | Early status |
|---|---|---|
| Data foundation | Projects, datasets, artifacts, runs, linked selection, cache | Required from M1 |
| Viewer / converter / figures | TIC/BPC, spectrum, scan table, conversion, queue, export | Primary product through M7 |
| Modular analysis | QC, signal, features, spectra, statistics, recipes | Deferred; architecture allowed |
| Automation | CLI, skills, MCP, workflow integrations | Deferred until contracts stabilize |

## Early workspaces

- **Data** — acquisitions, open files and derived artifacts.
- **Explore** — linked chromatogram, spectrum and scan table.
- **Convert** — semantic settings and output planning.
- **Figures** — export current views and later compose reusable figures.
- **Runs** — conversion and analysis jobs, logs, retry and results.

Only surfaces justified by an implemented workflow should appear in navigation. Empty future modes must not ship as dead UI.

## Priority meanings

- **P0** — needed to replace the target day-to-day MSConvertGUI workflow.
- **P1** — makes the product dependable and distinctly useful for regular research.
- **P2** — expands the workbench after core workflows prove themselves.
- **Later** — automation, extensibility or broad analysis that depends on stable foundations.

## Long-term exclusions

- Proprietary RAW-reader reimplementation or redistribution of restricted vendor components.
- Reimplementing mature algorithms merely to claim ownership of the stack.
- Arbitrary scripts or shell commands disguised as modules.
- Hidden scientific transformations, silent backend fallback or silent output overwrite.
- A collection of disconnected dashboards without shared artifacts, selection or lineage.
