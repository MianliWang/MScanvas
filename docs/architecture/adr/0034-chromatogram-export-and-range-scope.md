# ADR 0034 — Chromatogram export, and what a range means

Status: accepted
Date: 2026-08-24
Related: [0028](0028-figure-renderer-and-semantic-specification.md),
[0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0030](0030-png-copy-plot-and-figure-settings.md),
[0032](0032-viewer-interaction-and-viewport-state.md),
[0033](0033-visible-linked-tic-bpc-viewer.md)

## What this ADR is

The visible linked viewer draws a chromatogram from the spectrum table it was
given. This records how that run becomes a scientific document — a figure or a
data file — and what "the current range" means when it does.

[ADR 0029](0029-first-visible-spectrum-figure-and-data-export.md) settled the
export principle and it is not restated here: a token is checked and never
rebound, the snapshot is taken at begin, and save or copy consumes that frozen
intent. What is new is a second scientific source, a range, and two contract
extensions the figure needed before a current-range chromatogram could be honest.

## The source is Rust's retained facts

The complete per-scan facts this session already read when the preview was
opened. Nothing else is authority:

- **not** the rows the webview received — those are a bounded prefix;
- **not** the frontend's `ScanModel`, which is a projection of that prefix;
- **not** the screen's clipped or reduced polyline, or an SVG path's vertices,
  or any coordinate that has been through a browser.

Those are drawings of the science. The export writes the science.

`DatasetPreviewState` now holds its table rows in an `Arc`, so the preview and
an export are two readers of one allocation rather than two copies of a table
that runs to tens of thousands of rows. Nothing rereads the mzML file and
nothing launches a backend process: there is no `PreviewOperation::Tic`, no
backend TIC query, and none is wanted. A chromatogram here is **per-scan values
projected from the loaded spectrum table**, and every document says so in those
words.

### Why a frontend array could not be the source

Two reasons, and the second is the one that would have been missed. The transfer
is bounded, so a file built from it would silently be a file of part of the run.
And the screen's geometry is *supposed* to be lossy — it clips to a viewport and
reduces to columns — so an export drawn from it would be a picture of a screen
with a scientific file name.

### Visible-capability alignment

Rust holds every row the backend reported; the webview receives at most
`MAX_SPECTRUM_TABLE_ROWS`. A run whose table could not be transferred whole has
**no chromatogram on screen**, and issuing an export token for it would open a
door onto a capability the product does not otherwise have — VIEW-002 widened
through an export.

So a chromatogram export token is installed only for a run the visible model
would accept: a complete table under the current bound, non-empty, every
retention time and every intensity finite, and a retention-time unit posture
this build can name. The unit posture is now one function that the transferred
row and the export eligibility both read, rather than two hard-coded answers
free to drift apart.

**A truncated viewer has no chromatogram and no chromatogram export.**

## The snapshot, and its token

One retained `ChromatogramSnapshot` per session: an opaque token, the dataset
that owns it, the shared facts, the full retention-time domain and the scan
count. The token is a counter, it is a string on the wire, and it is meaningless
to anything that did not receive it here. It is not a path, not a dataset handle
and not an index.

Installed when a complete export-eligible preview is committed, and **revoked**
wherever the visible preview stops naming that source: another preview replaces
it, its dataset is removed, the workspace is cleared. Not revoked because focus
moved to a vendor row, because an unrelated row was added or removed, because a
different scan was selected, or because a figure setting changed — the viewer
keeps the loaded preview through all of those, and a slot that forgot anyway
would refuse the next export of a run still on screen.

A stale token is **refused**, never rebound. Exporting "whatever is loaded now"
under a token that named something else is the one failure a scientific export
must not have.

## One scientific export lane

Two visible export surfaces now exist. Rust holds **one** answer to "may another
scientific export begin now", and it is not a disabled button:

- two native save dialogs for one window is not a state this application can be
  in;
- a clipboard rasterization racing a file write is two claims on the same memory
  that nothing on screen would explain.

Each source keeps its own snapshot slot; the reservation, the claim and the
write state are shared. ADR 0029's semantics are unchanged and now hold across
kinds: a newer begin supersedes an **unclaimed** reservation — so a document that
asked and then reloaded leaves nothing behind — and nothing supersedes a
reservation that has been claimed, because claiming is what opens a dialog.

## Full run, or current range

Two scopes, and they differ in exactly two places: which scans the data document
keeps, and which window the figure declares.

**Full run** needs no range from the webview at all. Rust resolves it from the
snapshot.

**Current range** carries one authority and one only:
`ViewerInteractionState.committedDomain`. Not the rendered domain, which a
gesture in flight owns; not the SVG viewBox, not an axis tick, not a pointer
position.

A viewer that has committed nothing has no narrower range, so a current-range
request carries `null` and resolves to the whole run — while remaining a
current-range export, because that is what the user chose and the document says
so. No subrange is manufactured to make the option look different.

### A gesture in flight is not a decision

An export invoked while a wheel or a drag is still moving the viewport writes the
**last committed** range. The transient range is a drawing. Being exported over
neither settles the gesture nor cancels it, and the panel goes on offering the
committed range, so what is offered and what is written agree.

### Rust validates, and refuses rather than clamps

At begin, a current range with a domain must be finite, forward and inside the
snapshot's own retention-time domain. Zero width is valid. A range outside the
run is a **typed, path-free refusal** — not the nearest range that would fit.
Quietly exporting something else would answer a question nobody asked, in a file
that looks like the answer to the one they did.

## The data document, schema version 1

```text
#format,mscanvas_chromatogram_export
#schema_version,1
#source,per_scan_spectrum_table
#range_scope,full
#source_scan_count,3
#row_count,3
#full_range_low,1
#full_range_high,3
#export_range_low,1
#export_range_high,3
#retention_time_unit,unreported
#intensity_unit,unreported
#row_order,retention_time_then_table_position
spectrum_index,scan_number,ms_level,retention_time,total_ion_current,base_peak_intensity
0,1,1,1,123,42
1,,2,2,456,120
```

CSV and TSV are the same semantic document with different delimiters. An empty
`scan_number` means the run reported none — left empty rather than filled with a
sentinel, because every number that could stand for "none" is also a scan
number. No free text from the source reaches the file: no identifier string, no
path, no display name.

**No quoting rule exists because no field can need one.** Every preamble key is a
fixed identifier, every value is an integer, a finite `f64` or a fixed word, and
every record field is a number or empty. A test asserts that over whole
documents rather than trusting it. Numbers use Rust's shortest round-tripping
form — locale independent, `.` as the decimal point, no thousands separator — and
negative zero, subnormals and the largest finite double come back bit for bit.
Lines end with `\n`.

### Row order

Retention time, then the row's own position in the table — the same scientific
order the screen model uses. It is a projection: the retained table keeps the
order the run reported, because other readers depend on it.

### Only real scans

For a range, exactly the scans satisfying `low <= retentionTime <= high`, edges
included. **No interpolated boundary point, no reduction vertex, no SVG
geometry.** A boundary crossing is a line the source asserts between two of its
own samples; it is not a scan, and a row for it would put a measurement in a
file that the instrument never made.

So a range lying between two scans writes **zero records**, and that is a
successful export. The figure for the same range still draws the segment
crossing it. The two documents are siblings over one snapshot and one resolved
range — neither is read from the other — and this is the one place they
deliberately differ.

### Both measured columns, always

`total_ion_current` and `base_peak_intensity` are in every data document
whatever the screen is showing. Hiding a trace is a presentation choice about a
plot; it is not a decision to leave measured science out of a file. The builder
takes no trace set at all, which is the strongest form of that rule: there is
nothing to pass that could remove a column. The interface says so in words.

## The figure

`PlotKind::Chromatogram`, retention time against intensity, both axes
`UnitState::Unreported` because nothing crossing the backend boundary
establishes a unit. Every active series carries the **complete source** at
`DataScope::FullSource`, whatever range was asked for; a current-range figure
declares a window instead of dropping the points outside it.

- `full_domain` — the run's own retention-time range.
- `visible_domain` — the resolved range, unless that is the whole run, in which
  case it canonicalizes to `None`.
- `value_domain` — every value the active series carry, and zero.
- `visible_value_domain` — the value range actually displayed.

### The visible value domain, and why the contract needed it

The validator requires every source point to lie inside the panel's declared
domains, and rightly: a panel whose data leaves its own stated range is not a
rendering problem to be clamped away. So a figure carrying the complete series
must declare a `value_domain` that covers a nine-million peak at some other
retention time — and scaling the drawing to that peak flattens the range the
reader actually asked for into a line along the bottom of the panel.

None of the alternatives is honest: deleting the off-window points makes the
figure a picture of a screen, putting interpolated points into the source series
asserts measurements nobody made, and lying about `DataScope` or bypassing
`PointOutsideDomain` gives up the check that makes the rest trustworthy.

So `PanelSpec` gained an optional `visible_value_domain`: finite, forward,
contained in `value_domain`, and explicitly **not** a claim that the values
outside it do not exist. The renderer projects and labels through
`displayed_value_domain()`, and the accessible description says in words that
the axis is a window and how far the source reaches — otherwise a reader cannot
tell that this figure does not show the tallest thing in the run. A panel with
no window is unchanged, which is every figure that existed before this
milestone.

### How the window is computed

From the **clipped** active traces: the in-range scan values, the linearly
interpolated value where a segment crosses each edge, and zero. A source point
whose geometry lies entirely outside the window is excluded. This is ADR 0032's
screen rule, reached independently: no rendering code is shared between the
TypeScript viewer and the Rust renderer, and both are checked against the same
fixture — nine million at retention time 9 does not scale a figure of 10 to 13,
while a boundary crossing at 200 does set the top of a window holding no scans
at all.

### Two measured series

`StyleRole` distinguished a measurement from a baseline, and a panel refuses two
series of one role — correctly, since a role is what a renderer maps to a stroke
and a legend entry. A total ion current and a base peak intensity are two things
the instrument measured: neither is derived from the other, neither is a
reference the other is read against.

So there is a third role, `secondary_measurement`, drawn in its own palette
colour **and** dashed — colour alone is lost in a monochrome print and by readers
with a colour vision deficiency, and telling two measurements apart is the whole
reason the role exists. Base peak intensity keeps that role when it is the only
visible trace, so a figure of one trace and a figure of two agree about what that
trace is. That stability is what M4.4's linked figure will need.

A legend is drawn only where a panel holds two measured series, which is the
case the drawing genuinely cannot resolve. One measurement — alone or read
against a baseline — draws none, so every earlier figure is unchanged byte for
byte.

### Figure trace set

Figure outputs draw the traces visible at invocation, snapshotted at begin: SVG,
PNG and Copy plot. A later toggle does not alter an export already started. With
both traces hidden the figure outputs are **refused honestly** rather than
producing a zero-series panel, and the data exports stay available.

### No selected-scan marker

Deliberately not exported in this milestone. That annotation belongs to M4.4's
linked chromatogram-and-spectrum figure, and adding it here would implement half
of that milestone inside this one.

## The schema-version decision

`plot_spec::SCHEMA_VERSION` is **2**.

Every wire shape in the contract is `deny_unknown_fields` and every enum is
closed, so a build that knows only version 1 cannot decode a document carrying
`visible_value_domain` or a `secondary_measurement` series — and it would refuse
it as an unknown field or an unknown variant, which tells a reader nothing.
Leaving the version at 1 would have been exactly the documented contradiction
that policy exists to prevent.

Nothing is migrated, because nothing is persisted: no `FigureSpec` is stored, none
crosses into the webview, and the saved-figure feature that would create one
(FIG-007) is unimplemented. The cost was repository fixtures, paid deliberately.

## Saving, and copying

The accepted M4.1/M4.2 boundary, unchanged: Rust owns the path, the webview
names none and receives none. Dialog titles are `Export chromatogram figure` and
`Export chromatogram data`; the suggested names are
`mscanvas-chromatogram-{full|current}.{svg|png|csv|tsv}`, built from the request
alone — no part of a source path, a dataset name or a workspace handle. No
overwrite: an exclusive private sibling, write, force, handle-bound rename
without replacement, cleanup on failure, typed residue failure. A dismissed
picker is `cancelled` — nothing created, nothing written, the source mzML
untouched and read-only throughout.

Copy plot renders the same `FigureSpec` through the same SVG renderer and the
same rasterizer a PNG export uses. No screenshot, no DOM serialization, no
pixels crossing back: the clipboard is Rust write-only and the webview learns
what was copied rather than what it looks like. It shares the one lane, because
it commits immediately.

## Figure settings

Reused exactly from M4.2 — width, height, theme, PNG DPI, raster budget — with
the same rules about which output consumes which. The fields are now one
component with an identifier prefix, because both export surfaces can be on
screen at once and two elements sharing an `id`, or two radio groups sharing a
`name`, would leave a label pointing at the wrong control and one theme choice
silently changing the other. There is no second figure-settings authority.

## The interface

A disclosure in the chromatogram's own panel, **closed by default**, opened from
a control in the header row that already exists. The three-panel viewer column
has measured floors and its panels clip, so a disclosure that added a row to the
body would push a control out of a panel rather than make it taller.

It offers the range, the three figure outputs, the two data outputs and the
shared settings, and says the two things a reader would otherwise guess wrong in
opposite directions. Where the viewer has committed no narrower range it says the
current range is currently the whole run, rather than filling in the run's own
bounds — which would read as a choice somebody made.

Chromatogram export requires a ready chromatogram snapshot and **nothing else**:
no selected spectrum, no successful spectrum read, and no route through the
selected-spectrum token.

## What is not claimed

- **No linked two-panel figure.** M4.4 and FIG-006 are unimplemented.
- **No current-range selected-spectrum export.** That surface remains full
  source only, and no range control appears on it.
- **No XIC, no spectrum zoom or pan, no multi-layer comparison, no saved
  `FigureSpec`, no figure composer.**
- **No smoothing, baseline correction, normalization or peak picking.** Every
  number written is the one the backend reported.
- **No cache**, no export history, and no stored chromatogram-record ingestion.

The M5 deferrals are unchanged: viewer selection-availability affordance
consistency, and touch gestures over the chromatogram.

## Evidence

**Rust:** 1,186 tests. The chromatogram module's own thirty-one cover
eligibility, ordering, range resolution and refusal, the schema, number
round-tripping, real-scans-only, the zero-row range, the value window and the
9,000,000 regression, the trace set and the one-scan run. The export lane's
cover both directions of the cross-source refusal, supersession, claim identity,
token staleness and dataset-scoped revocation. The contract's own cover the two
new shapes and everything they must still refuse.

**Frontend:** 991 tests, eighteen of them at the shipped composition — the token
sent, the committed range rather than a transient one, the traces on screen, the
lane, the surface absent where there is no chromatogram, and a zero-scan range
reported as the success it is.

**Browser QA:** 15 rendered cases at 1366×768, 1920×1080 and 960×640 — the closed
disclosure costing the measured layout nothing, every control inside its panel,
and what actually crossed the boundary. Zero newly introduced console errors,
warnings, unhandled rejections or exceptions.

**Real Tauri QA:** 4 cases with `begin_chromatogram_export` and
`copy_chromatogram_plot` left real, against a seeded run installed through the
production parser and the ordinary eligibility.

**Fourteen mutations**, applied and restored byte-for-byte.

**Live ProteoWizard evidence: NOT RUN**, and not required: the export semantics
depend on retained facts rather than on a backend read.

## The M4.4 handoff

What M4.4 will need and now has: a stable role for a second measured series, a
panel that can declare a displayed value window, a chromatogram figure builder
that takes a resolved range, and a snapshot whose lifetime is already tied to
the visible preview. What it must add is the linked two-panel figure itself, and
the selected-scan annotation this milestone deliberately left out.
