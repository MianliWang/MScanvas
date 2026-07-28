# Feature catalog

This catalog is the concise feature index. Detailed semantics remain in [`PROJECT_PROPOSAL.md`](../../PROJECT_PROPOSAL.md). Every implemented feature must have a stable ID, acceptance tests and a documented interaction/error path.

## Environment and onboarding

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| ENV-001 | Detect ProteoWizard | P0 | Report the release, the build and which installation the verdict describes, or an actionable missing state. No backend path reaches the interface. |
| ENV-002 | Choose the backend installation | P0 | User can choose the installation folder for the session only; it is never stored, invalid choices explain why in terms of the actions the application has, and returning to automatic discovery is always offered. |
| ENV-003 | Backend self-test | P0 | A read-only test distinguishes launch failure from format support. |
| ENV-004 | Copy diagnostics | P1 | Produces a redacted, shareable environment summary. |

## Data workspace

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| WSP-001 | Add files | P0 | Add one or many supported candidate paths in one operation. |
| WSP-002 | Add folder | P0 | Discover logical acquisition roots without descending inside recognized directory datasets. |
| WSP-003 | Explorer drag-and-drop | P0 | Files/folders dropped from Windows Explorer enter the same discovery path as pickers. |
| WSP-004 | Duplicate prevention | P0 | Re-adding the same canonical logical dataset does not create another row. |
| WSP-005 | Multi-selection | P0 | Pointer and keyboard selection follow familiar desktop list behavior. |
| WSP-006 | Remove selected | P0 | Removes logical rows only; never changes source files. |
| WSP-007 | Clear workspace | P0 | One visible action clears idle rows without app restart or disk deletion; active runs require an explicit choice. |
| WSP-008 | Convert selected/all | P0 | Scope is visible before execution and unrelated rows remain intact. |
| WSP-009 | Search/sort/filter | P1 | Handles large batches without obscuring selected/running items. |
| WSP-010 | Restore workspace | P1 | Restores logical state safely and marks missing files rather than deleting rows silently. |

## Acquisition overview and viewer

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| VIEW-001 | Metadata summary | P0 | Shows format/vendor, size, scan counts, MS levels, RT range and available instrument metadata. |
| VIEW-002 | TIC/BPC | P0 | Toggle traces, zoom/pan/reset, inspect coordinates and select nearest scan. |
| VIEW-003 | Spectrum view | P0 | Profile uses a line; centroid uses sticks; axes and units remain explicit. |
| VIEW-004 | Scan table | P0 | Virtualized rows with scan, RT, MS level and precursor context. |
| VIEW-005 | Linked selection | P0 | Selection synchronizes chromatogram marker, table row, spectrum and inspector in both directions. |
| VIEW-006 | Keyboard scan navigation | P0 | Previous/next and table navigation work without pointer-only access. |
| VIEW-007 | XIC | P1 | Typed m/z and tolerance produce a trace with explicit units/settings. |
| VIEW-008 | Multi-layer comparison | P2 | Visibility, style and provenance remain inspectable per layer. |

## Conversion

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| CNV-001 | mzML output | P0 | Default open format with typed backend mapping. |
| CNV-002 | mzXML output | P1 | Disabled until representative multi-source source/output spectrum counts pass; if enabled later, clearly labels legacy chromatogram/metadata limits. |
| CNV-003 | Output location | P0 | Source sibling/subfolder/custom choices never write inside recognized vendor dataset roots. |
| CNV-004 | No additional centroiding | P0 | No peak-picking filter is inserted by this option. |
| CNV-005 | Explicit centroid presets | P0 | MS2 or MS1+MS2 changes are visibly marked as lossy. |
| CNV-006 | MS-level filter | P0 | All/MS1/MS2 intent maps predictably to the backend. |
| CNV-007 | Compression | P0 | zlib on/off is explicit and reflected in the command summary. |
| CNV-008 | Conflict policy | P0 | Default is fail/skip; overwrite requires explicit confirmation. |
| CNV-009 | Natural-language summary | P0 | Before running, state file count, format, processing and output root. |

## Runs and recovery

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| RUN-001 | Per-file queue | P0 | Ready/queued/running/completed/failed/cancelled/unsupported are distinct. |
| RUN-002 | Failure isolation | P0 | One failure does not stop independent queued items. |
| RUN-003 | Cancellation | P0 | Cancels the process tree; partial output is never reported as valid. |
| RUN-004 | Retry failed | P0 | Retries only selected/failed items without rebuilding the workspace. |
| RUN-005 | Actionable error | P0 | User sees a plain-language cause/action before raw stderr. |
| RUN-006 | Transactional output | P0 | Final filename appears only after successful process exit and basic checks. |
| RUN-007 | Persistent run history | P2 | Runs and artifacts survive restart with interrupted states represented honestly. |

## Figure and data export

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| FIG-001 | Copy screenshot | P0.5 | Copies the current plot without application chrome. |
| FIG-002 | PNG export | P0.5 | Exports current/full range at selected dimensions and DPI. |
| FIG-003 | SVG export | P0.5 | Vector output preserves labels, axes and plot semantics. |
| FIG-004 | Underlying data export | P0.5 | Chromatogram/spectrum data can be exported as CSV/TSV with units. |
| FIG-005 | Independent figure theme | P0.5 | Light publication output is possible while the app remains dark. |
| FIG-006 | Linked two-panel figure | P1 | Chromatogram + selected spectrum share a reproducible figure specification. |
| FIG-007 | Saved FigureSpec | P1 | Reopening a spec regenerates the same semantic figure from referenced artifacts. |
| FIG-008 | Figure composer | P2 | Multi-panel layout is constrained, aligned and provenance-aware rather than a generic slide editor. |

## Analysis and automation

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| ANA-001 | Artifact/run lineage | P1/P2 | Every derived result identifies inputs, module, parameters and producing run. |
| ANA-002 | QC recipe | P2 | First reviewed recipe runs in an isolated worker with typed parameters/results. |
| ANA-003 | Analysis module contract | P2 | Packages are wrapped behind schemas; package-specific APIs do not leak into normal UI. |
| AUT-001 | Headless CLI | Later | Reuses the same domain plans and returns structured output/exit codes. |
| AUT-002 | Repo/user skill | Later | Guides inspect → plan → approve → run → validate without bypassing contracts. |
| AUT-003 | Local MCP adapter | Later | Exposes narrow typed tools and executes only approved plans/roots. |
