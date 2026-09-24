# M9.2 record — durable targeted MS1 result reuse and scientific export

Status: **M9.2 LOCAL RESULT REUSE COMPLETE — DURABLE TARGETED-MS1 EVIDENCE AND
SCIENTIFIC EXPORT.** Date: 2026-09-23. Branch
`feat/m9.2-targeted-ms1-result-reuse-export`, from the M9.1 endpoint
`96f2d8caa66e8228aa7a899de5634b8f9a4ec7d5`. Decision:
[ADR 0048](../architecture/adr/0048-stored-targeted-result-reuse-and-export.md).
Evidence: [M9.2 evidence](../spikes/M9_2_TARGETED_MS1_RESULT_REUSE_EVIDENCE.md).
Builds on the [M9.1 record](M9_1_TARGETED_MS1_HANDOFF.md#m91-record).

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.3
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · ROUTE B NOT AUTHORIZED / NOT EXECUTED · PUBLIC BETA NOT
RELEASED; M10 NOT STARTED

## Scope

M9.2 turns a targeted MS1 result M9.1 already produced into a durable
scientific result: reopened without running anything, drawn by the canonical
figure renderer, exported as SVG or PNG, and tabulated as CSV or TSV, all from
the stored payload. Not in scope and not done: any algorithm change, runtime
packaging or release work, payload retention or garbage collection,
cross-volume sources, clipboard copy of a stored result, PDF, and M9.3.

## What a user can do

In a saved project that holds a targeted MS1 result, including one reopened in
a later session:

1. **Inspect** the result from the project history. The report opens with
   three facts, in words:
   - **Stored result** — whole (read from the results folder beside the
     project), missing from that folder, or damaged (does not match the
     recorded digests);
   - **Original source** — the source's state as the last check left it
     (`Not checked`, `Matches the recorded content`, `Content has changed`,
     `Not found where it was recorded`, …);
   - **New runs** — available in this build, not available (no targeted MS1
     runtime), or not available until MSCanvas is restarted.

   A whole result also says that showing and exporting it read only what was
   stored with it, and need neither the original file nor the runtime.
2. **Choose a target.** Its stored evidence is drawn by the shared renderer:
   the M and M+1 points, each marked and joined only to its neighbours, the
   retention-time window, the feature's band and apex (or the shared feature's),
   and every other candidate. The points table beneath lists every value, and
   the image's text alternative names the outcome and what is drawn.
3. **Export this figure** (a disclosure under the figure): width, height, PNG
   DPI and theme, then **Export SVG…** or **Export PNG…**. The figure above is
   drawn at those settings, so it is the file that will be written.
4. **Export the results table** (a disclosure under the rows): **Export CSV…**
   or **Export TSV…** writes every target in plan order with the result's
   provenance above the header.

Every export asks for a destination in the native save dialog, never replaces
a file, and reports what it wrote by file name only.

### The five states

| State | What the report shows | What is offered |
| --- | --- | --- |
| Payload whole | `Stored result: Whole…`; rows, figure, exports | everything |
| Payload missing | `Stored result: Missing…` and how to recover (put the folder back and reopen) | nothing is read or drawn; no export |
| Payload damaged | `Stored result: Damaged…` | nothing is read or drawn; no export |
| Source unavailable | `Original source: Not found where it was recorded` (after a check) | everything, unchanged: nothing reads the source |
| Runtime unavailable | `New runs: Not available: this build has no targeted MS1 runtime` | everything, unchanged: nothing needs the runtime |

The project records whether the payload was whole when the document was
opened. A later read, drawing or export that finds it missing or damaged
overrides that for the session: the rows, figure and exports go, the state
line says what was found, the sentence is announced, and focus moves to the
report's heading if the control that was pressed went with them. Nothing is
regenerated, re-run or replaced.

### Recovery

| Answer | Sentence | Recovery |
| --- | --- | --- |
| Destination exists | A file of that name already exists; nothing was replaced | choose another name |
| Wrong extension | The file name must end in `.svg`/`.png`/`.csv`/`.tsv` | choose a name of that kind |
| TSV field | A value holds a tab or a line break, which TSV cannot carry | export CSV |
| Export in progress | Another export of a stored result is in progress | wait, then retry |
| Figure not drawable | The stored evidence cannot be drawn without changing it | read the points table |
| Too large to show | The figure is too large to show here | export it as SVG or PNG |
| PNG resolution | PNG DPI must be 72–1200; SVG remains available | change the DPI |
| Settings refused | the existing figure-size, DPI and raster-budget sentences | change the setting |
| Cancelled | Export cancelled. Nothing was saved | — |

## Contracts

- **Commands** (all by identifier; none takes a path):
  `preview_targeted_ms1_figure(artifactId, targetId, settings)`,
  `export_targeted_ms1_figure(artifactId, targetId, format, settings)`,
  `export_targeted_ms1_table(artifactId, format)`, `get_targeted_ms1_runtime()`.
- **Figure**: plot-spec schema 3 — see [FIGURE_MODEL](../architecture/FIGURE_MODEL.md#stored-targeted-evidence--m92-schema-3).
- **Table**: `mscanvas_targeted_ms1_results` v1 — the preamble, the 40 columns
  and the formatting rules are in ADR 0048, section 5.
- **Provenance on screen**: Details now also names the plan's target-list
  SHA-256 and the stored result's manifest SHA-256, beside the plan digest,
  recipe version, engine profile, source bytes and digest, engine report,
  adapter, runtime manifest and interpreter digests M9.1 already showed.
- **Unchanged**: the payload format, the project schema (4), the recipe, the
  200-target limit and every tolerance.

## What changed from M9.1

- The report's own SVG plot (`EvidencePlot`) is gone; the figure is the
  renderer's SVG in an image. The M9.1 browser spec's plot selector moved from
  `svg` to `img` for that reason, and the M9.2 browser scenarios were appended
  to the same spec file.
- `targetedPlotCaption` describes the new drawing (filled dots M, open dots
  M+1, dotted window ends, a shaded feature band, dashed candidate outlines).

## Known limits

- **No clipboard copy for a stored result.** The native clipboard harness has
  no project fixture holding a stored result, so the copy could not be
  exercised; it was removed rather than claimed.
- The native save dialog is not exercised for these commands. The write is
  exercised in Rust (`write_named`: named as its format, never over a file),
  and the dialog in the browser suite is a mocked answer.
- A spreadsheet may interpret a field (for example a label starting with `=`)
  as a formula; values are written as stored and not neutralized. There is no
  BOM, so a spreadsheet that assumes a legacy code page can misread non-ASCII
  labels.
- A target whose stored values are all zero is drawn on a single-valued
  intensity axis, labelled `0.000000` at both ends by the renderer's existing
  rule; the title says the outcome.
- Whether the source is unavailable is known after a check (**Check links**);
  after reopen it reads `Not checked`.
- The Save As pre-copy refusal that M9.1 added has no dedicated test.
- The figure is re-requested as a valid size is typed; there is no debounce.
- The window's ends are dotted rules; an end at the edge of the plot lies on
  the axis and is not separately visible. The caption says so.
- Interval roles are drawn but not labelled in the image or its legend; their
  names are in the SVG's description, and the caption explains each.
- The whole table is built in memory, bounded by the 200-target limit.
