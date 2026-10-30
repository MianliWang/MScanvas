# Plot golden fixtures

Small deterministic chromatogram/spectrum arrays and approved renderer snapshots/specs belong here. Cover profile, centroid, empty, single-point, extreme dynamic range and linked-selection cases.

## The single-panel documents

`spectrum-full-source.svg`, `chromatogram-full-run.svg` and
`chromatogram-current-range.svg` are the exact bytes the two single-source
exports write, pinned by the tests in `preview/export.rs` and
`preview/chromatogram.rs`.

They exist because M4.4 factored `spectrum_panel` and `chromatogram_panel` out
of those two exports so the linked two-panel figure could reuse them. A
refactor that changed what a single-panel export writes would be a silent
regression in a document users have already saved, and no assertion about a
property of the figure would notice a difference in its bytes.

Each fixture is rendered from the inputs its own test names — `golden_spectrum()`
and `golden_chromatogram()` — through `svg_document`, at the default figure
settings. Regenerating one means rendering that call and writing the result;
there is no separate tool, because the test is the specification of what the
file holds.

The three were generated from canonical main (`c03974c`) before the refactor
and are byte-identical after it.

They were regenerated once since, deliberately, for the publication figure
(figure schema 4): round ticks with outside value labels and gridlines,
`(unit not reported)` in the axis titles, and text measured in the named face
rather than stretched. The data they draw is unchanged and every `<desc>` is
byte-identical to the earlier documents; only the axes and the text moved. See
`docs/architecture/FIGURE_MODEL.md`.

## The linked figure and a stored targeted result

`linked-full-run.svg` and `targeted-stored-result.svg` complete the set, so
every figure kind a user can save has its document pinned. They were rendered on
main (`01c23d9`) before ADR 0053 added `svg::render_with_text`, and the renderer
writes the same bytes after it.

- `linked-full-run.svg`: `golden_chromatogram()` over the full run with
  `selected(2)` below it, through `linked_figure_spec`, pinned in
  `preview/chromatogram.rs`.
- `targeted-stored-result.svg`: target 0 of `stored_three()` as an ambiguous
  detection, through `evidence_figure`, pinned in `targeted_ms1/tests.rs` by
  `pinned_figure()`. The test fixes the result and plan identifiers that a run
  would mint, because the caption names both.
