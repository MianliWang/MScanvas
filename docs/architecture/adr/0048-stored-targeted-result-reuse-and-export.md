# ADR 0048 — Stored targeted MS1 result reuse and export

Status: **accepted locally for M9.2; unpublished.** Date: 2026-09-23.
Builds on the [M9.1 record](../../product/M9_1_TARGETED_MS1_HANDOFF.md#m91-record),
[ADR 0028](0028-figure-renderer-and-semantic-specification.md) (the renderer and
the semantic specification), [ADR 0030](0030-png-copy-plot-and-figure-settings.md)
(PNG, `Copy plot` and figure settings) and
[ADR 0035](0035-export-filename-format-integrity.md) (export names).
Record: [M9.2 result reuse](../../product/M9_2_TARGETED_MS1_RESULT_REUSE.md).

## Context

M9.1 stores a targeted MS1 result beside the project: `rows.jsonl`,
`evidence.jsonl` and `evidence.index.json`, named by a manifest whose digest the
schema-4 document records. The report read that payload in bounded pages and
drew one target's points with a plot of its own, in TypeScript. Nothing could
leave the application: no figure file and no table.

M9.2 makes the stored result a durable scientific result. It must stay
inspectable, drawable and exportable after reopen, with the runtime unavailable
and with the original mzML unreadable, as long as the payload is whole.

## Decisions

### 1. Inspection is not re-execution

Every M9.2 operation names a result and, for a figure, one of its targets, by
identifier and nothing else. Each is answered from the open document and the
digest-verified payload reads M9.1 already had: the rows file whole against its
recorded length and SHA-256, each evidence line against its indexed digest.
None takes an executor, a job, a source handle or a path. None changes the
document, its dirty state, a plan, a run or an artifact.

Before a table or a figure is built, the stored rows must still be the plan's:
one row per plan target, in plan order, each with the fields its outcome
requires. A payload that fails that is `payloadCorrupt`; one whose files are
gone is `payloadMissing`. Neither is regenerated, re-run or replaced.

Whether a *new* run could start is a separate, informational read
(`get_targeted_ms1_runtime`): `available`, `runtimeUnavailable` or
`quarantined`. In a release build it is always `runtimeUnavailable`; in a
development build it checks that the pinned runtime manifest and interpreter
are present, without starting anything. No stored-result operation consults it.

### 2. The payload and the document keep their shapes

No payload format version and no project schema change. Every datum the figure
and the table need is already stored. The one derived fact, which candidate is
the selected feature, is one shared rule (`is_selected_candidate`): the
candidate whose bounds are bit-for-bit the feature's, as M9.1's page already
decided it.

### 3. The canonical renderer draws the evidence: plot-spec schema 3

The M9.1 page plot is replaced by the shared `FigureSpec` → deterministic SVG →
`resvg` PNG path. Two additions to the specification were needed, and they are
the whole of schema 3:

- **Domain-axis intervals** (`IntervalSpec`): a closed `[low, high]` on a
  panel's x axis with a role. `Window` draws its in-view ends as dotted lines;
  `Selected` is a translucent band; `Considered` is a dashed outline. An
  interval must lie inside the panel's full domain, so a bound the data cannot
  hold is refused rather than clipped silently.
- **Sample marks** on a joined series: every real sample inside the window is
  marked (filled, open or square by role) as well as joined, so a reader sees
  where the measurements are and that the line between them is only a join.

Neither changes a figure that does not use it: the three golden SVGs are
byte-identical, and schema-2 figures only differ by the number they carry.
Nothing in the application persists or reads back a `FigureSpec`, so the bump
refuses no stored document.

The page shows the SVG as an image, so the SVG's own title and description
do not reach assistive technology. The image's text alternative is built from
the row instead: the target, its outcome in words, and what is drawn — the
feature's bounds and apex only where there is a feature, other candidates only
where there are some.

The evidence figure is one chromatogram panel: x is retention time, unit `s`
(known), y is intensity with the unit **unreported**. M and M+1 are the two
series; the plan's RT window, the feature (or the shared feature) and every
other candidate are intervals; the apex is a marker. The domains are the hull
of what is drawn, and the value range includes zero. The title is the target's
label and its outcome; the caption names the formula, what the outcome means,
and the result and plan it came from. Every string that came from the user is
bounded and has characters XML cannot carry replaced. No mass error, quality
score or fitted curve is drawn.

### 4. Exports reuse the preview output machinery

`preview::scientific_output` is a narrow facade over the existing primitives:
the figure settings and their refusals, the raster budget asked before any
pixel is allocated, the rasterizer and PNG encoder, the export extension rule,
destination admission and the no-overwrite local write. The stored-result
commands never see a preview token or snapshot. One output runs at a time, on
a lane of the project store (`exportInProgress` otherwise).

Every refusal that does not need the user is decided before the native save
dialog opens: the format, the settings, the PNG resolution and budget, and the
figure or table itself. Suggested names carry the result's short identifier and
the target's plan position, never a label:
`mscanvas-targeted-ms1-<artifact8>-target-<n>.svg|png` and
`mscanvas-targeted-ms1-<artifact8>-results.csv|tsv`.

**No clipboard copy for a stored result.** The clipboard write could not be
exercised natively for this command in M9.2 (the native harness has no project
fixture with a stored result), and a capability that has not been exercised is
not offered.

### 5. The results table, v1

`mscanvas_targeted_ms1_results`, schema 1. UTF-8 without a BOM, `\n` line
endings, one row per plan target in plan order.

A preamble of `#key<delimiter>value` lines comes first, in this order:
`format`, `schema_version`, `recipe`, `recipe_version`, `artifact_id`,
`run_id`, `plan_sha256`, `target_list_sha256`, `mz_half_width_ppm`,
`expected_peak_width_s`, `source_byte_length`, `source_sha256`,
`adapter_sha256`, `engine_profile_sha256`, `runtime_manifest_sha256`,
`engine_pyopenms`, `engine_openms`, `engine_openms_revision`,
`payload_manifest_sha256`, `target_count`, `row_order` (`plan`),
`retention_time_unit` (`s`), `intensity_unit` (`unreported`). No path, file
name, log, process or scratch detail.

Then the header and the rows, 40 columns:

`target_id`, `target_position`, `label`, `formula`, `neutral_mass`,
`planned_rt_s`, `planned_rt_half_width_s`, `outcome`, `failure_reason`,
`adduct`, `mz_theoretical_m`, `mz_theoretical_m1`, `mz_window_m_low`,
`mz_window_m_high`, `mz_window_m1_low`, `mz_window_m1_high`,
`rt_window_low_s`, `rt_window_high_s`, `extracted_points`,
`any_nonzero_point`, `signal_sum_m`, `signal_sum_m1`, `signal_max_m`,
`signal_max_m1`, `edge_trace_count`, `candidate_count`, `feature_apex_rt_s`,
`feature_left_s`, `feature_right_s`, `raw_area`, `model_status`, `model_area`,
`model_fwhm_s`, `engine_intensity`, `engine_intensity_source`, `shared_with`,
`suppressed_by`, `overlap_removed`, `overlap_winner`,
`recovered_from_empty_selection`.

Rules:

- Outcome and failure words are the payload's own (`DETECTED`,
  `NOT_DETECTED`, `FAILED`, `WINDOW_WITHOUT_MS1_PEAKS`, …), never translated.
- A value the result does not have is an **empty cell**, never `0`. A target
  that was never extracted has empty measurement cells, and its
  `edge_trace_count` and `candidate_count` are empty too, because nothing was
  counted. A window that held no spectrum (`WINDOW_WITHOUT_MS1_PEAKS`) writes
  `extracted_points` `0`, a count, and **empty** sums and maxima: the payload's
  zeros there are the adapter's empty defaults, not measurements. A failed
  target has no feature, so its feature cells are empty.
- `engine_intensity_source` keeps measured (`modelArea`) and imputed apart.
- Plan values (`neutral_mass`, `planned_rt_s`, `planned_rt_half_width_s`, the
  two parameters) are written as the plan stores them, digit for digit.
- Numbers are `f64` `Display`, the shortest form that reads back as the same
  value, with no locale.
- Related targets are listed by identifier, separated by `;`.
- CSV quotes a field holding a delimiter, a quotation mark, a line break or an
  edge space, doubling its quotation marks (RFC 4180). TSV has no quoting, so a
  field holding a tab or a line break refuses the whole TSV
  (`targeted_table_field_not_representable`) rather than altering it.
- `target_id` is the first column, so no record line starts with `#`.

Values are written as stored. A spreadsheet may still interpret a field such as
a label beginning with `=` as a formula; neutralizing it would alter the data,
so it is not done, and the export's help says values may be reinterpreted.

### 6. The interface says what the result depends on

The report states three facts in words: whether the stored result is whole,
missing or damaged; the original source's state as the last check left it; and
whether new runs are available. The exports and the figure are offered only for
a whole result. A later read, drawing or export that finds the payload missing
or damaged demotes the report for the session: the rows, figure and exports go,
the state line says why, the sentence is announced as an alert, and focus
moves to the report's heading if it was on a control that went. An export's
control stays focusable while its native dialog is open; the others are
disabled. A figure export's outcome is said under the target it was for. The
figure is drawn at the last settings that were a size while a size is typed.
A surface-specific sentence replaces two shared ones that name controls this
surface does not have (a PNG resolution refusal's `Copy plot`, and the
preview-size limit's "preview a smaller range"). An SVG over the 8 MiB screen
bound is `figure_preview_too_large`, as on every other preview: too large to
show is not too large to export.

## Consequences

- A stored result is a scientific document in its own right: drawn, saved as
  SVG or PNG and tabulated with neither the runtime nor the source.
- The page no longer draws any evidence itself; screen and export are one
  drawing at one size.
- No clipboard copy for stored results until a native harness can exercise it.
- The whole table is built in memory; the 200-target limit bounds it.
