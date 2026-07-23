# Analysis capability map

Analysis is deferred, not prohibited. This document prevents both premature platform work and architecture that blocks sensible growth.

## Integration policy

- Prefer mature, actively maintained packages or command-line tools.
- Wrap them in typed MSCanvas modules with reviewed defaults, schemas and tests.
- Keep normal UI phrased in scientific intent, not package API names.
- Run Python/third-party analysis out of process.
- Persist result artifacts and lineage; do not leave results only in transient plot state.

## Candidate capability families

| Family | Examples | Candidate backends | Earliest product form |
|---|---|---|---|
| QC | scan/MS-level summaries, TIC statistics, blank/sample and batch drift | pyOpenMS/OpenMS, NumPy/SciPy, reviewed custom glue | QC recipe + report |
| Signal processing | smoothing, baseline, filtering, normalization, explicit centroiding | OpenMS/pyOpenMS | previewable recipe |
| Feature processing | mass detection, chromatogram construction, deconvolution, isotope grouping, alignment, gap filling | OpenMS/pyOpenMS and reviewed tools | recipe producing feature artifacts |
| Spectral analysis | cleaning, similarity, consensus, clustering, library matching | matchms, OpenMS and reviewed libraries | spectrum recipe + match table |
| Statistics | PCA, clustering, missingness, correlation, differential summaries | NumPy/SciPy/scikit-learn/stats packages | analysis recipe + figures/tables |
| Domain workflows | untargeted metabolomics, MS2 review, targeted extraction | compositions of typed modules | curated recipe packs |

## Promotion gate for a module

Before a module becomes a supported product capability, require:

1. a named user decision/job;
2. lawful, maintainable backend access;
3. typed compatible inputs and outputs;
4. explained defaults and units;
5. cancellation/progress/error behavior;
6. public or legally usable fixtures;
7. scientific conformance tests and known limitations;
8. result views and export behavior;
9. provenance/lineage fields;
10. packaging and support-cost assessment.

A generic workflow canvas is not the first analysis feature. Curated recipes should prove repeated composition needs before graph editing is introduced.
