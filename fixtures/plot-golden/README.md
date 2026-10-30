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
