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
| WSP-002 | Add folder | P0 | Discover logical acquisition roots without descending inside recognized directory datasets. Partially implemented: regular `.mzML` files only. |
| WSP-003 | Explorer drag-and-drop | P0 | Files/folders dropped from Windows Explorer enter the same discovery path as pickers. |
| WSP-004 | Duplicate prevention | P0 | Re-adding the same canonical logical dataset does not create another row. |
| WSP-005 | Multi-selection | P0 | Pointer and keyboard selection follow familiar desktop list behavior. |
| WSP-006 | Remove selected | P0 | Removes logical rows only; never changes source files. |
| WSP-007 | Clear workspace | P0 | One visible action clears idle rows without app restart or disk deletion; active runs require an explicit choice. |
| WSP-008 | Convert selected/all | P0 | Scope is visible before execution and unrelated rows remain intact. |
| WSP-009 | Search/sort/filter | P1 | Handles large batches without obscuring selected/running items. |
| WSP-010 | Restore workspace | P1 | Restores logical state safely and marks missing files rather than deleting rows silently. |

Implementation notes for the two folder-bearing features follow. The acceptance
table remains the target, including the unsupported portions called out below:

- **WSP-002 — Partially implemented.** M1.4.0 built the private discovery foundation and M1.4.1 exposed `Add mzML folder…` over it ([ADR 0007](../architecture/adr/0007-logical-acquisition-discovery-and-folder-traversal.md)). What works today: one chosen local Windows folder is scanned recursively for regular `.mzML` files, in a deterministic order, under four named limits, without following any linked or special filesystem entry, and an incomplete scan says so. What is still absent from the acceptance above: directory-formatted acquisitions are not recognized, so there is nothing to stop descending inside. They remain evidence-gated — MSCanvas recognizes none of them today, and will only claim one once this repository can convert it.
- **WSP-008 — Partially implemented.** M3.2 converts the selection, in the order
  it is displayed, at up to 16 items per queue ([ADR 0013](../architecture/adr/0013-serial-conversion-queue.md)).
  The scope is visible before execution — the ordered list, the name each item
  would write, and how many selected rows are excluded for being mzML already —
  and unrelated rows are untouched, including when an item fails. What is absent
  from the acceptance above: "all" is not an option, because a queue is bounded
  at 16 and a workspace holds up to 1,024 rows; and only the two evidenced
  vendor families — Thermo Scientific RAW and Shimadzu LabSolutions LCD — can
  be queued, alone or mixed.
- **WSP-003 — Implemented for the current mzML surface.** M1.5 accepts one or
  many regular `.mzML` files, ordinary local folders containing regular `.mzML`
  files, or a mixture of both from Windows Explorer
  ([ADR 0008](../architecture/adr/0008-windows-explorer-drag-and-drop.md)).
  Direct files enter the same acceptance boundary as `Add files…`; folders enter
  the ADR 0007 discovery boundary under one root limit and a shared entries,
  directories and candidates ledger. Reparse, remote and virtual roots remain
  unsupported, and directory-formatted acquisitions remain evidence-gated
  rather than being treated as implemented.

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

**A serial conversion queue is reachable: one to sixteen selected vendor rows
— Thermo Scientific RAW and Shimadzu LabSolutions LCD, alone or mixed — to
mzML, one after another, each family on the exact ProteoWizard build evidenced
for it.** `Add files…` admits both families alongside mzML; selecting vendor
rows offers the ordered list that would run, which family each row is, the
names it would write, and one Fail/Skip choice; and one Rust-owned local
destination picker settles where all of them go. Items convert one at a time in
the order shown. One file's failure marks that file and the queue continues,
and `Retry N failed` reruns only the failures Rust marks retryable.

Reachable that far and no further. CNV-001 and CNV-008's fail/skip half are
reachable; CNV-009's batch summary is reachable as an item count, an ordered list
and the planned output names, but not as processing options it does not have.
CNV-003 exposes no location choice beyond the folder itself. CNV-007's zlib is
shown but not selectable. CNV-002 and CNV-004 to CNV-006 remain unreachable.

A terminal queue that has something to diagnose also offers **Export failure
diagnostics…**: one local JSON file, saved where the user chooses, holding
structured facts about each diagnosable attempt and bounded, redacted excerpts of
what the backend printed. Known filesystem paths and internal identifiers are
removed and an excerpt that still looks like it names one is withheld — but
backend text may still contain acquisition metadata, which the panel says beside
the action and the file repeats inside itself. Nothing is uploaded and nothing is
kept: the file is the user's, and replacing the queue drops this session's memory
of having written one. See
[ADR 0017](../architecture/adr/0017-redacted-conversion-diagnostics-export.md).

The named limits: at most **16** items per queue, two named vendor families,
regular files only, one folder, no overwrite, one queue-level stop and no per-item
cancellation, no percentage, no
parallelism, and no queue that survives closing the application. A diagnostics
export describes only the latest attempt of each item, holds at most 32 KiB per
stream and 2 MiB in total, never replaces an existing file, and does not survive
a restart. Retry is narrow
by construction — only a destination folder that exists but would not open, and
an acquisition that exists but could not be read, are classified retryable. See
[ADR 0013](../architecture/adr/0013-serial-conversion-queue.md) and
[ADR 0012](../architecture/adr/0012-first-visible-thermo-conversion.md).

Beneath it, the private Rust conversion boundary is unchanged and is covered by
tests: it plans mzML
only, derives the output name from the source, refuses or skips an existing
destination with no overwrite to select, stages the backend's output in a
directory MSCanvas owns and takes the final name only after the produced
document passes the integrity contract. CNV-002 stays unplannable. The only
processing decisions that boundary expresses are CNV-004's no-peak-picking rule
and zlib compression, which is unconditional rather than the explicit choice
CNV-007 asks for; CNV-005 and CNV-006 are not expressible at all, and CNV-003's
vendor-dataset-root rule is unreachable because no vendor acquisition is
recognized. See
[ADR 0009](../architecture/adr/0009-mzml-conversion-execution-boundary.md).

## Runs and recovery

| ID | Feature | Priority | Acceptance summary |
|---|---|---:|---|
| RUN-001 | Per-file queue | P0 | Ready/queued/running/completed/failed/cancelled/unsupported are distinct. |
| RUN-002 | Failure isolation | P0 | One failure does not stop independent queued items. |
| RUN-003 | Queue stop | P0 | Stops the whole queue: terminates the running process tree, begins no later item, retains completed outputs, and never reports a partial output as valid. An unconfirmed termination is reported as such and quarantines the backend. |
| RUN-004 | Retry failed | P0 | Retries only selected/failed items without rebuilding the workspace. |
| RUN-005 | Actionable error | P0 | User sees a plain-language cause/action before raw stderr. Raw stderr is never shown; a terminal queue's diagnosable attempts can instead be saved to one local redacted JSON file the user chooses. |
| RUN-006 | Transactional output | P0 | Final filename appears only after successful process exit and basic checks. |
| RUN-007 | Persistent run history | P2 | Runs and artifacts survive restart with interrupted states represented honestly. |
| RUN-009 | Export failure diagnostics | P0 | Explicit, per terminal queue: saves one local redacted JSON file describing the latest attempt of every diagnostic-worthy item — an ordinary failure, an unconfirmed stop, or a terminal item that left staging behind. Structured facts plus bounded, redacted backend excerpts; an excerpt that still looks like it names a path is withheld. No upload, no telemetry, no history, no overwrite. Backend text may still contain acquisition metadata and the interface says so. |
| RUN-008 | Adopt converted outputs | P0 | Explicit, per terminal queue: adds every finalized mzML output at once, in queue order. Admits one only when the final name still resolves to the exact finalized object and that object still holds the validated byte length and digest. Partial success; duplicates and refusals isolated; no auto-import, no auto-preview, no persistence. |

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
