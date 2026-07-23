# MSCanvas

## Product & Engineering Source of Truth

**Status:** Pre-alpha proposal and repository contract  
**Updated:** 2026-07-23  
**License:** Apache-2.0  
**Canonical repository:** `MianliWang/MScanvas`  
**Initial target:** Windows desktop  
**Primary stack:** Rust + Tauri 2 + React + TypeScript

This document is the authoritative high-level reference for product, UX, architecture and development decisions. Before non-trivial work, Codex and human contributors must read this file, the nearest applicable `AGENTS.md`, and the focused specifications linked below. Detailed feature acceptance criteria live in `docs/product/FEATURE_CATALOG.md`; this proposal defines the intent and boundaries those details must preserve.

---

## 1. Executive summary

MSCanvas is a modern, free, open-source and local-first workspace for mass-spectrometry data. Its first releases focus on the workflows that legacy tools make unnecessarily difficult:

1. add vendor RAW files or folders through normal drag-and-drop and file pickers;
2. curate a batch with familiar multi-selection, remove-selected and one-action clear-list behavior;
3. inspect acquisition metadata, TIC/BPC, scans and mass spectra through linked views;
4. convert vendor data to mzML or mzXML through a mature external backend such as ProteoWizard;
5. manage per-file progress, cancellation, failure isolation and retry;
6. export the viewed chromatogram or spectrum as a clean scientific figure and export the underlying data.

MSCanvas does not initially reimplement proprietary RAW readers or mature scientific algorithms. It creates a better product layer around established backends and, later, may orchestrate reviewed packages such as OpenMS/pyOpenMS, matchms and general numerical/statistical libraries through typed, isolated modules.

The first product is therefore a **viewer + converter + figure workspace**. Analysis is a deferred capability, not a permanent exclusion.

---

## 2. Name and positioning

**Product name:** MSCanvas  
**Executable / future CLI:** `mscanvas`

`MS` communicates mass spectrometry. `Canvas` describes a workspace capable of holding linked chromatograms, spectra, tables, annotations, figures and future analysis results without limiting the product to conversion alone.

**English positioning**

> A modern open-source workspace for mass spectrometry data.

**Chinese positioning**

> 一个现代、免费、开源的质谱数据查看、转换、科研作图与模块化分析工作台。

The name remains subject to formal trademark, package-name and domain review before a public branded release.

---

## 3. Problem statement

ProteoWizard and other scientific backends already solve much of the underlying format-conversion problem. The major unmet need is product quality:

- legacy conversion GUIs cannot reliably support ordinary drag-and-drop batch curation;
- clearing or rebuilding a conversion list can require restarting the application;
- directory-formatted datasets such as `.d` or some `.raw` datasets are awkward to add safely;
- backend flags expose implementation details rather than scientific intent;
- users cannot easily inspect a RAW file before conversion;
- chromatogram, scan and spectrum views are often fragmented or visually dated;
- queue, cancellation, retry and failure explanations are weak;
- exported screenshots are not publication-oriented figures;
- adding analysis often leads to deeply nested menus and giant modal parameter forms.

MSCanvas treats UI/UX, discoverability, recovery and scientific transparency as first-class functionality rather than decoration.

---

## 4. Target users and jobs to be done

### Primary users

- researchers in proteomics, metabolomics, lipidomics and related LC/GC–MS fields;
- core-facility operators and data managers handling batches of acquisitions;
- scientists preparing open-format data for MZmine, OpenMS, GNPS, R, Python or custom workflows;
- computational scientists who later need reproducible artifacts, CLI execution and workflow integration.

### Core jobs

1. **Build a batch quickly** — add many files/folders, identify duplicates and unsupported items, and change the list without restarting.
2. **Confirm the data** — verify the acquisition, instrument context, RT range, MS levels and signal before processing.
3. **Navigate naturally** — select an RT or scan and see the chromatogram marker, scan table, spectrum and metadata update together.
4. **Convert safely** — choose understandable settings, know whether centroiding or filtering occurs, and avoid silent overwrite.
5. **Recover from failure** — understand a plain-language error, fix it and retry only the affected item.
6. **Create scientific output** — export a clean plot and the numerical data behind it.
7. **Grow into analysis** — later apply reviewed recipes without learning package-specific APIs or arbitrary scripts.

---

## 5. Product principles

1. **Function before fashion.** Visual patterns are judged by task fit, hierarchy, accessibility, evidence area, performance and prototype results. Glassmorphism, bento layouts, cards or hover are neither automatically banned nor automatically accepted.
2. **UX is product functionality.** High-frequency actions must be discoverable; active states and failure recovery must be obvious.
3. **Local-first.** No account, upload or internet connection is required for routine use. No default telemetry.
4. **Source data is read-only.** Removing or clearing a workspace never deletes acquisition data.
5. **Scientific changes are explicit.** No hidden centroiding, filtering, backend fallback or output overwrite.
6. **Progressive complexity.** Normal workflows use semantic settings and curated recipes; advanced details are available without dominating the default UI.
7. **Reuse mature backends.** Do not rebuild proprietary readers or mature algorithms merely to own the stack.
8. **Artifacts and lineage over disconnected dashboards.** Data, results, figures and runs share identity and provenance.
9. **One core, multiple surfaces.** GUI, future CLI, skills and MCP must ultimately reuse the same domain contracts.
10. **Evidence-driven development.** Major UI work requires task analysis, rendered validation and realistic states, not only a passing build.

---

## 6. Product layers and scope

### Layer 1 — Data foundation

Required for viewer, conversion and future analysis:

- Project and logical workspace;
- logical acquisition discovery, including directory datasets;
- Artifact, Run and Module domain concepts;
- linked selection state;
- cache and lazy-loading boundaries;
- typed settings and normalized errors.

### Layer 2 — Viewer, converter and figures

The primary product through the first public beta:

- data workspace;
- acquisition metadata;
- TIC/BPC and later XIC;
- profile and centroid spectrum views;
- virtualized scan table;
- linked selection and keyboard navigation;
- RAW to mzML/mzXML conversion;
- per-file queue, cancel, retry and output handling;
- PNG/SVG and underlying-data export.

### Layer 3 — Modular analysis

Deferred until the first workflows are dependable:

- QC summaries and reports;
- signal processing;
- feature detection, grouping, alignment and gap filling;
- spectral cleaning, similarity, clustering and library matching;
- statistical views such as PCA, clustering, missingness and batch effects;
- curated domain recipes.

### Layer 4 — Automation and ecosystem

After domain schemas stabilize:

- structured CLI;
- reproducible recipes and headless execution;
- Snakemake/Nextflow examples;
- Codex/user skills;
- narrow local MCP adapter;
- approved-plan execution and machine-readable reports.

---

## 7. Early product functionality

### 7.1 Environment and onboarding

P0 behavior:

- detect a user-installed ProteoWizard `msconvert`;
- display path and version;
- allow the executable to be located manually;
- provide an actionable self-test and installation guidance;
- distinguish missing executable, launch failure and unsupported input.

A user should not need a terminal to understand readiness.

### 7.2 Data workspace

P0 behavior:

- drag one or many files from Windows Explorer;
- drag a folder or use Add files / Add folder;
- recognize single-file and directory-formatted acquisition roots;
- avoid descending into a recognized dataset as if it were a generic folder;
- canonical duplicate prevention;
- familiar Ctrl/Shift selection and keyboard focus;
- Remove selected;
- visible Clear list;
- Convert selected and Convert all;
- display name, kind/vendor guess, size, path, readiness and run status.

`Clear list` while idle should be one operation and may offer Undo. During an active run it must ask whether to remove non-running rows, cancel and clear, or return. It never deletes source files.

P1/P2 additions may include search, sort, filters, grouping, saved projects, recent workspaces, watch folders and acquisition-in-progress detection.

### 7.3 Acquisition overview

Selecting an acquisition should progressively reveal, where available:

- format/vendor and canonical path;
- file/dataset size;
- acquisition time and instrument model;
- spectrum/chromatogram counts;
- MS-level distribution;
- retention-time range;
- polarity and profile/centroid representation;
- specific unsupported/read failure state.

The default summary remains concise; detailed vendor metadata belongs in a contextual inspector.

### 7.4 Chromatogram viewer

P0:

- TIC and BPC toggle;
- explicit RT and intensity axes/units;
- zoom, pan and reset;
- hover/focus coordinate preview;
- click to persistently select the nearest scan;
- visible selected-scan marker;
- MS-level filtering;
- loading, partial, empty and failure states;
- focus/full-plot mode.

P1/P2 may add XIC, RT range selection, overlays, multi-file comparison, 2D maps and richer annotation layers.

### 7.5 Spectrum viewer

P0:

- centroid spectra as stick plots;
- profile spectra as continuous lines;
- explicit m/z and intensity semantics;
- zoom, pan and reset;
- transient hover and persistent click/keyboard selection;
- previous/next scan and direct scan navigation;
- scan number, RT, MS level, polarity, precursor m/z, isolation/collision context when available;
- keyboard operation.

P1/P2 may add relative/absolute intensity, precursor/isolation markers, controlled peak labels, overlays, mirror plots and saved comparisons.

### 7.6 Scan table and linked selection

The table shows at least scan/native ID, RT, MS level, polarity and relevant precursor/base-peak context. Large acquisitions require virtualization.

Selection is shared domain state:

- selecting an RT selects the nearest scan;
- selecting a row updates the chromatogram marker, spectrum and inspector;
- moving to the next scan updates every linked view;
- update sources are tracked to prevent feedback loops.

High-frequency pointer movement must not cause broad React/global-state updates or repeated large-array copies.

### 7.7 Conversion settings

Normal mode provides semantic controls:

- output format: mzML default, mzXML marked legacy compatibility;
- output location: sibling/subfolder/custom, never inside a recognized vendor dataset root;
- no additional centroiding;
- explicit centroid MS2 or centroid MS1+MS2 presets, marked lossy;
- MS levels: all, MS1 only or MS2 only;
- zlib compression;
- output conflict policy: fail/skip/automatic rename; overwrite requires explicit confirmation.

Before execution, show a natural-language summary such as file count, format, centroiding behavior and output root. An advanced section may show the resolved backend and argv, but the frontend never constructs backend syntax.

### 7.8 Queue and recovery

P0:

- Ready, Queued, Running, Completed, Failed, Cancelled and Unsupported states;
- conservative single concurrency by default;
- overall and per-item progress where available;
- pause pending work and cancel the current run;
- failure isolation;
- retry failed or selected runs;
- clear completed items;
- open output or output folder;
- actionable cause and corrective action before expandable raw stderr;
- partial output never reported as successful.

Final output should use a transactional strategy: write to a temporary sibling path, require successful process exit and basic integrity checks, then atomically finalize where supported.

### 7.9 Scientific figure and data export

Figure export is a first-class product capability, not merely a screenshot command.

Two modes:

- **Copy screenshot** — fast plot-only representation for discussion;
- **Export figure** — export-specific render independent of app chrome and app theme.

Initial scope:

- current chromatogram or spectrum;
- linked chromatogram + selected spectrum layout;
- PNG and SVG;
- current visible range or full range;
- selected width/height and DPI for raster output;
- independent light/dark figure theme;
- optional title, legend, marker and metadata caption;
- CSV/TSV export of underlying data with units.

Future scope:

- PDF/TIFF where justified;
- overlays, mirror plots and structured annotations;
- multi-panel FigureSpec composition;
- shared axes, journal presets and batch export;
- saved/reproducible figure specifications.

Screen rendering and export must consume shared semantic `PlotSpec` / `FigureSpec` contracts rather than using UI screenshots as the only implementation.

---

## 8. Analysis strategy

Analysis is architecturally supported but not allowed to derail the first product.

### Candidate backends

- OpenMS command-line tools and pyOpenMS;
- matchms for MS/MS processing and similarity;
- NumPy, SciPy, scikit-learn and reviewed statistical/domain libraries;
- additional packages only after license, maintenance, packaging and scientific validation review.

### Module contract

A supported analysis module declares:

- stable ID and semantic version;
- scientific purpose and known limitations;
- compatible typed input artifacts;
- parameter schema, units, defaults and warnings;
- typed output artifacts;
- execution provider/version;
- progress and cancellation capability;
- validation and fixture coverage.

Package-specific APIs must not leak into normal UI. Common workflows appear first as curated recipes. A general workflow canvas is considered only after repeated user evidence shows a need to inspect or edit compositions.

### Worker boundary

Python and other large scientific environments run out of process. Rust owns supervision, parameter validation, paths, cancellation, resource limits, normalized events and artifact registration. Large results use file/Arrow/Parquet-style references where appropriate rather than unbounded JSON arrays.

---

## 9. Information architecture and design references

The product is an analytical workbench rather than a static dashboard.

Candidate shell:

```text
Top command bar
Left data/artifact context | Main evidence workspace | Contextual inspector
Bottom compact/expandable Runs panel
```

The first UX spike compares three structures:

1. workspace-first: data left, linked viewer center, inspector right, runs bottom;
2. viewer-first: maximum plot area with collapsible supporting panes;
3. mode-based: Data / Explore / Convert / Figures / Runs views.

The choice is based on representative tasks at 1366×768, not visual preference alone.

Product patterns to study:

- TradingView and financial terminals: chart-first evidence, linked cursor, watchlist, layers and saved layouts;
- Power BI: separating data/report/model mental tasks and exposing underlying data;
- Tableau: progressive construction and reconfigurable workspace;
- KNIME: typed operations, inspectable inputs/outputs and run states;
- MZmine: mass-spec linked views and task overview;
- TOPPView/OpenMS: layers and algorithm input/output comparison;
- Wireshark: dense master-detail and keyboard table navigation;
- HandBrake/Media Encoder: presets, queue, progress and failure isolation;
- VS Code: resizable workbench and contextual panels;
- Windows Explorer: familiar selection, drag/drop and batch operations.

References are pattern studies, never reasons to copy a complete visual system.

---

## 10. UX process and interaction budgets

Major workflows follow:

1. frame the user job, frequency, context, data scale and risk;
2. document the baseline tool path and recovery cost;
3. perform hierarchical task analysis;
4. define action, decision, navigation and hidden-state budgets;
5. generate three structurally different concepts;
6. compare evidence area, discoverability, constrained-window behavior, keyboard path and recovery;
7. prototype realistic empty/loading/error/running states;
8. conduct a cognitive walkthrough;
9. when possible, test with 3–5 representative users;
10. implement as a vertical slice and perform rendered QA;
11. persist accepted decisions in product/UX specifications.

Initial interaction targets include:

- add many files: one drop or one picker completion;
- clear idle workspace: one action, no restart;
- view TIC: one file activation;
- view a spectrum near an RT: one plot activation;
- adjacent scan: one key/action;
- convert selected: selection plus one primary action, with one review decision only when risk requires it;
- retry a failed run: one action;
- understand a common failure: no mandatory navigation into raw logs;
- export current plot: no more than two normal actions.

Fewer clicks do not automatically win when one explicit decision prevents overwrite or hidden scientific change.

---

## 11. Architecture

```text
React + TypeScript UI
  presentation, interaction, accessibility, transient view state
        │ narrow typed Tauri commands/events
        ▼
Rust/Tauri application core
  path and dataset authority
  project/artifact/run state
  linked selection and cache orchestration
  process queue, cancellation and output safety
        │
        ├── ProteoWizard adapter (`msaccess` / `msconvert`)
        ├── plot/figure/export services
        └── future isolated analysis workers
```

### Ownership rules

- React never receives unrestricted shell or filesystem permissions.
- Rust owns canonical paths, backend discovery, process state, queue state and output finalization.
- Domain crates do not depend on Tauri, React, MCP or a concrete package.
- Adapters translate typed intent to backend-specific argv and parse normalized events/failures.
- Commands are spawned directly with argv arrays, never through a concatenated shell string.
- Viewer caches and renderers own high-frequency/large numeric state; semantic selections are promoted to shared state at bounded rates.

### Initial crates

- `mscanvas-core` — domain types and invariants;
- `mscanvas-plot-spec` — renderer-independent plot semantics;
- `mscanvas-proteowizard` — typed command planning and later parsing;
- `mscanvas-desktop` — Tauri composition root.

Do not create a crate-per-noun architecture or a public generic plugin ABI during MVP work.

---

## 12. Toolkit

Initial choices:

- Rust stable, edition 2024;
- Tauri 2;
- React 19 + TypeScript + Vite;
- pnpm workspace;
- Tailwind CSS as a build utility plus project-owned semantic tokens/components;
- accessible primitives may use Radix/shadcn source components selectively;
- renderer selected after M0 performance/SVG/accessibility spikes rather than by popularity;
- Serde, thiserror and typed Rust domain models;
- Vitest + React Testing Library;
- Playwright for rendered E2E/visual interaction;
- GitHub Actions, with Windows Rust/Tauri checks as release gates.

Versions are pinned in manifests/toolchain files and updated intentionally through reviewed dependency changes.

---

## 13. Artifact, run and lineage model

MSCanvas must not treat every object as an undifferentiated file.

Candidate artifact kinds:

- Acquisition;
- OpenMsRun (mzML/mzXML);
- Chromatogram / SpectrumSelection;
- FeatureMap / FeatureTable / AlignedFeatureTable;
- SpectrumCollection / SpectralMatchTable;
- QcReport / StatisticalResult;
- Figure.

A derived artifact can answer:

- which input artifacts produced it;
- which module/backend/version ran;
- parameters, warnings and validation;
- producing run status and logs;
- compatible views and downstream modules.

Transient hover/cursor state is not automatically an artifact. It becomes persistent only when saved, pinned, exported or required as a stable module input.

---

## 14. Performance and large-data behavior

- Adding a file initially reads only bounded metadata.
- TIC/BPC and spectra load lazily and are cached with explicit limits.
- Large scan tables are virtualized.
- Plots use viewport clipping/downsampling where scientifically appropriate while preserving access to exact values.
- Pointer movement remains renderer-local or ref-based; React receives bounded semantic updates.
- XML parsing and large scientific operations do not block the UI thread.
- Cancellation, memory and disk behavior must be tested on realistic acquisitions, not only tiny fixtures.

---

## 15. Security, privacy and licensing

- Local-first; no default data upload or telemetry.
- Tauri capabilities remain minimal and audited.
- Frontend cannot execute arbitrary commands or access unrestricted paths.
- Source acquisitions are treated as read-only.
- Output roots are canonicalized and validated.
- Logs redact credentials and do not dump complete environments or raw data.
- ProteoWizard and vendor readers are installed/licensed separately by the user until an explicit distribution review.
- Future Python/OpenMS bundles require license, size, update and security review.
- Apache-2.0 applies to MSCanvas source; third-party components retain their licenses.

---

## 16. Testing and quality gates

### Unit and integration

- workspace and artifact invariants;
- path and directory-dataset discovery;
- semantic settings to deterministic argv mapping;
- command order and Unicode/space-containing paths;
- queue transitions, cancellation and output finalization;
- PlotSpec/FigureSpec serialization;
- worker/module contracts;
- open lawful scientific fixtures and mock backend events.

### Rendered UI

A build is not sufficient. Verify:

- the exact target interaction;
- page/app identity and non-blank state;
- console health and framework overlays;
- 1366×768, 1920×1080 and constrained 960×640 behavior where relevant;
- keyboard focus/order and pointer alternatives;
- empty/loading/partial/error/running states;
- linked-view synchronization;
- profile/centroid representation and units;
- screenshot/visual comparison for reference-driven work.

### Scientific and backend validation

Use public redistributable fixtures in CI and maintainer-controlled vendor RAW tests locally. Clearly distinguish structural validation from scientific suitability.

---

## 17. Development model

Use UX-first vertical slices and short-lived branches:

1. define a user-visible outcome and acceptance tests;
2. update domain types/invariants;
3. implement a deterministic provider/mock or backend adapter;
4. expose a narrow Tauri command/event;
5. implement React states and interactions;
6. run unit/integration and rendered QA;
7. update feature/workflow/design/ADR documents.

Do not add production dependencies, public schemas, generic registries or future navigation merely because they may be useful later.

---

## 18. Roadmap

### M0 — Feasibility and UX spikes

- ProteoWizard discovery/version;
- `msaccess` or alternative preview route for metadata, TIC/BPC and one spectrum;
- `msconvert` execution/progress/cancellation/partial output;
- compare three workspace structures;
- select plot/export renderer through measured spikes.

### M1 — Data workspace

Real pickers/drag-drop, discovery, duplicate prevention, multi-select, remove, clear, diagnostics.

### M2 — Linked viewer

Metadata, TIC/BPC, spectrum, virtualized scan table, linked selection, lazy cache.

### M3 — Conversion workflow

Typed mzML/mzXML settings, queue, cancellation, retry, failure isolation, transactional outputs.

### M4 — Figure/data export

Screenshot, PNG/SVG, current/full range, independent theme, CSV/TSV, linked two-panel figure.

### M5 — Public beta hardening

Windows packaging/signing plan, accessibility, diagnostics, lawful fixtures and layout/settings persistence.

### M6 — Artifact and QC foundation

Durable project/artifact/run lineage and first useful QC reports.

### M7 — First analysis recipes

Isolated worker and one or two reviewed, typed recipes backed by mature packages.

### M8 — Automation

Stable CLI and schemas, then skills and a narrow local MCP adapter.

---

## 19. Codex development constraints

- Read this proposal and the nearest `AGENTS.md` before non-trivial work.
- Use repo-local skills for UX workflow, product UI, spectrum viewer, vertical slices and UI QA.
- Treat generic UI/design skills as advisory; they cannot override accepted workflows, scientific semantics, accessibility, security or dependency policy.
- Do not add/update production dependencies without explicit approval and rationale.
- Do not expose raw shell execution, arbitrary backend arguments or unrestricted paths.
- Do not silently broaden the milestone.
- Report files changed, user-visible behavior, checks actually run, rendered evidence and unverified assumptions.
- Never claim real RAW/backend behavior was verified when only mocks were used.

The repository command policy additionally blocks destructive Git cleanup/reset and package publishing in agent workflows.

---

## 20. MVP exclusions and long-term exclusions

### Not required for the first public product

- XIC and multi-file overlays;
- feature detection/alignment/annotation;
- statistics and workflow canvas;
- persistent run database and full provenance manifests;
- stable CLI/MCP;
- Docker/Wine auto-configuration;
- macOS/Linux public packaging.

### Excluded by design unless a future decision reverses them

- proprietary RAW-reader reimplementation;
- redistribution of restricted vendor components without legal approval;
- arbitrary scripts/shell exposed as modules;
- hidden scientific transformation;
- silent backend fallback or overwrite;
- disconnected dashboards without artifacts, selection and lineage;
- reimplementation of mature algorithms without a demonstrated scientific/product reason.

---

## 21. Success criteria

The first useful release succeeds when a researcher can, without documentation:

1. drag in a realistic batch;
2. remove selected rows or clear the list without restarting or deleting data;
3. choose a file and inspect TIC/BPC and spectra through linked selection;
4. understand whether centroiding will occur;
5. convert selected/all files to mzML/mzXML;
6. continue after one file fails and retry only that item;
7. find outputs and understand failures;
8. export a clean scientific plot and its underlying data.

The product should feel materially easier than MSConvertGUI while remaining transparent about the mature backend doing the scientific I/O.

---

## 22. Focused source documents

- `docs/product/PRODUCT_MAP.md` — users, jobs, layers and priority meanings;
- `docs/product/FEATURE_CATALOG.md` — stable feature IDs and acceptance summaries;
- `docs/product/PRIMARY_WORKFLOWS.md` — end-to-end product contracts;
- `docs/product/INTERACTION_BUDGETS.md` — action/decision targets;
- `docs/product/SCREEN_MODEL.md` — workbench and selection model;
- `docs/product/PRODUCT_BENCHMARKS.md` — reference-product translation;
- `docs/product/ANALYSIS_CAPABILITY_MAP.md` — deferred analysis families and promotion gate;
- `docs/ux/UX_PROCESS.md` — required design method;
- `docs/ux/DESIGN_SYSTEM.md` — current visual/interaction foundation;
- `docs/ux/USABILITY_TEST_PLAN.md` — representative task validation;
- `docs/architecture/ARCHITECTURE.md` — ownership and boundaries;
- `docs/architecture/ARTIFACT_MODEL.md` — project/artifact/run/lineage;
- `docs/architecture/FIGURE_MODEL.md` — PlotSpec/FigureSpec and export;
- `docs/architecture/ANALYSIS_WORKERS.md` — isolated worker direction;
- `docs/architecture/MODULE_CONTRACT.md` — future module lifecycle;
- `ROADMAP.md` — milestone sequence;
- `BOOTSTRAP_STATUS.md` — verified and pending repository setup.

When a focused document conflicts with this proposal, stop and resolve the conflict explicitly rather than choosing whichever instruction is more convenient.
