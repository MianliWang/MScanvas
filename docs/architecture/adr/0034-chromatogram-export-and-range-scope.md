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

## Which preview open owns the chromatogram

There is one chromatogram the user is looking at, so which completed read may
install one has to be decided by a single order across **every** open. The
per-dataset request epoch is not that order, and cannot be made into it: it
answers *may these facts commit for this dataset*, and two opens of two
different files are each the newest request for their own dataset at the same
time — correctly. Left to decide the shared slot, the winner would be whichever
read happened to finish last, which is the older open whenever the newer file is
the faster read.

So the two questions are answered by two mechanisms, and they are not
interchangeable:

| | question | scope |
| --- | --- | --- |
| dataset request epoch | which read may commit facts for *one* dataset? | per dataset |
| preview-open ticket | which committed preview may own the *session's* chromatogram? | global |

Every mzML preview open takes a `PreviewOpenTicket` at its **beginning**, before
the backend work. The ticket is session-scoped, monotonic, and never crosses to
the webview: it is not a dataset id, not a backend generation and not a path.

Taking one revokes the previous chromatogram **immediately**, rather than when
the new read succeeds. That is the semantic the visible preview already has: the
webview raises its own counter before it calls, the replaced preview leaves the
screen at that moment, and a newer open that *fails* shows its failure rather
than restoring what it replaced. Rust matches it — a failed newer open leaves no
chromatogram at all — because offering an export of a run nothing is showing is
the same defect as a stale token.

### The ticket is taken at intent, not at success

**A real mzML preview attempt revokes the previous chromatogram authority before
any refusal that is about the moment rather than about the target.** This closes
M4.3's second final-observation finding.

The order that matters is exactly this, and each step is load-bearing:

1. resolve the handle;
2. prove the dataset exists;
3. prove its source kind is the mzML preview surface;
4. **take the `PreviewOpenTicket`** — which revokes the current chromatogram at
   that moment;
5. only now the conditions that are about *this moment*: is the backend still
   trusted, is a conversion holding the slot, will the process gate admit this;
6. the existing per-dataset epoch and backend read;
7. on success, commit the dataset's preview facts and reconcile the chromatogram
   with the ticket taken in step 4;
8. on any failure after step 4, restore nothing.

Steps 1–3 are about the *target* and answer the same way however often they are
asked. Step 5 can refuse for a reason that did not exist a moment ago — and by
then `loadPreview` has already raised its counter, taken the old preview off the
screen and shown the refusal in its place. A read refused at step 5 without
having taken the ticket would leave Rust still naming a run nothing is showing,
and a delayed or replayed command could export it.

The distinction between the two halves is the whole rule, and it is not "every
failed command revokes":

| request | revokes the current chromatogram? |
| --- | --- |
| malformed handle | no |
| dataset the session does not have | no |
| vendor row / non-previewable source | no |
| **real mzML row, refused because the backend became unusable** | **yes** |
| **real mzML row, refused because a conversion started** | **yes** |
| real mzML row, read succeeds | yes, and it installs its own |

One consequence is deliberate and worth naming: opening a *vendor* row while the
backend is quarantined now answers `dataset_not_previewable` rather than
`backend_quarantined`. An open has to establish what it names before it can
supersede what is on screen, so the target is what it reports on — and that is
the truer answer anyway, because no backend repair would make that row
previewable. The frontend never reaches either case: it refuses vendor
activation before it calls.

The ownership test and the installation are **one critical section** of the
export slot. Compare, unlock, install later is the same race with an extra step
in it: a newer open begins in the gap and the older completion still wins. The
slot therefore offers no way to ask the question on its own — it answers "may
this open install", never "is this open current", and the installer is private —
so the two halves cannot be taken apart at a call site.

Three outcomes, and the last two are what the rule turns on:

- **stale** — nothing is touched. An older completion may not install, and may
  not *revoke* either: the chromatogram it would take away belongs to the
  preview on screen.
- **current, with an eligible source** — it becomes the one a new export names.
- **current, ineligible** — truncated, empty, or unusable retention times: the
  session has none. Install *or* revoke, never neither.

Two things are deliberately outside this order. Focusing a vendor row is not a
preview open — nothing is opened, the loaded preview stays on screen, and its
token stays valid. And an export already **claimed** finishes from the snapshot
it was begun on: opening another run moves what a *new* export would name, and
does not cancel a file the user is choosing a destination for.

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

Because the lane is one, the interface says so once. `scientificExportBusy` is a
**derived projection** — either surface running — and not a third stored state:
the two source-specific export states stay separate, because their result, their
status message and their token binding are facts about a surface rather than
about the lane, and a stored third could only disagree with them. Both surfaces'
callbacks read the projection and both panels render it, so while either is
running the other's figure, data and copy controls are unavailable rather than
visibly live and refused on arrival.

What is shared is **availability and nothing else**. Neither panel shows the
other's status message or the other's result, and neither is hidden while the
other runs — a control that vanished mid-write would move everything below it
for a user who has not navigated anywhere. The settings rules are unchanged and
apply on top: an unusable width still closes only the figures, an unusable
resolution still closes only the raster, and neither surface's settings reach
the other's exports.

Rust remains the safety boundary. This is what makes the interface truthful, not
what makes it safe.

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

## A data document has no figure settings

**CSV and TSV are not figures, so the figure contract is never asked about
one.** Width, height, theme, PNG DPI and the raster budget are not validation
inputs to a chromatogram data export, and a reservation for one carries no
`FigureRenderSettings` at all.

This closes M4.3's first final-observation finding, and the case was reachable
through the ordinary interface with no race and no replayed command. The panel's
own rule is *a whole number of at least 1*, deliberately — the panel is not the
authority on what MSCanvas can draw — so a width of 20,001 leaves every action
live and is forwarded as typed. Rust validated the whole `FigureSettingsDto`
before it had looked at the format, so `Export CSV…` came back
`figure_settings_refused`: *"That is not a figure size MSCanvas can draw"*, about
a document with no width in it.

The rule is now the same on both sides of the boundary, which is what makes the
affordance honest rather than lucky:

| | closes | leaves open |
| --- | --- | --- |
| unusable width/height | SVG, PNG, Copy plot | CSV, TSV |
| unusable PNG DPI | PNG | SVG, Copy plot, CSV, TSV |

The format is read **first**, and nothing is validated before it is known. A
data export still answers for everything that does belong to it — the token, the
one scientific lane, the range request, the source snapshot, the format itself
and the write transaction — and the figure formats keep every check they had, in
the order they had it: an unusable size is refused before a resolution is read,
and a resolution before the pixel budget.

The wire shape is unchanged. The frontend still forwards one
`FigureSettingsDto`, because narrowing the wire per format would be scope this
slice does not need; what changed is that the data path ignores the fields that
are not about it. The selected-spectrum export already had this posture and is
untouched — the chromatogram was brought to it, not the other way round.

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

**Rust:** 1,211 tests. The chromatogram module's own thirty-one cover
eligibility, ordering, range resolution and refusal, the schema, number
round-tripping, real-scans-only, the zero-row range, the value window and the
9,000,000 regression, the trace set and the one-scan run. The export lane's
cover both directions of the cross-source refusal, supersession, claim identity,
token staleness and dataset-scoped revocation.

Nineteen of them cover preview-open ownership: the older open that cannot
install over a newer one, the older open finishing first while the newer one is
still reading, the newer open that fails leaving nothing rather than the run it
replaced, current-and-ineligible revoking against stale-and-anything mutating
nothing, a claimed export finishing from its begin-time snapshot across a
replacement, revocation at begin rather than at completion, a vendor row that is
not a preview open, two opens of one dataset still decided by the request epoch,
Remove and Clear during a read, and one concurrent case at the real command
boundary.

M4.3.1 adds the intent boundary to that set: a backend that became unusable and
a conversion that started each refusing a real mzML open while still taking the
chromatogram away, an unknown handle and a vendor row each leaving the visible
run exportable, an older completion landing after a newer attempt failed early
and installing nothing, and a claimed export finishing across a replacement that
never succeeded. Four more cover the data/figure split at the service boundary:
CSV and TSV beginning at every size the panel accepts and the figure contract
refuses, at an unknown theme and an unusable resolution, the figure formats
still answering for all of it in the accepted order, and the selected spectrum
answering exactly as it always did. The contract's own cover the two new shapes
and everything they must still refuse.

**Frontend:** 999 tests, nineteen of them at the shipped composition — the token
sent, the committed range rather than a transient one, the traces on screen, the
lane, the surface absent where there is no chromatogram, and a zero-scan range
reported as the success it is. Seven cover the shared lane in both directions:
four on the callbacks, where a refusal means no operation is dispatched at all,
and three on the rendered panels, where it means a control the user meets is
closed rather than live and refused on arrival. One more walks the reachable
case of the data/figure split end to end: a width of 20,001 typed into the
panel, `Export CSV…` still live, clicked, and the request crossing with that
width forwarded as typed.

**Browser QA:** 15 rendered cases at 1366×768, 1920×1080 and 960×640 — the closed
disclosure costing the measured layout nothing, every control inside its panel,
and what actually crossed the boundary. Zero newly introduced console errors,
warnings, unhandled rejections or exceptions.

**Real Tauri QA:** 5 spec files and 25 cases on WebView2, including the 4
chromatogram cases
with `begin_chromatogram_export` and `copy_chromatogram_plot` left real, against
a seeded run installed through the production parser and the ordinary
eligibility — and now through the ordinary preview-open ticket as well, because
the seed reconciles rather than installing directly.

**Thirty-two mutations**, applied and restored byte-for-byte. The nine for
export ownership cover both directions of the shared lane in the callbacks and
in each panel, the absent ticket check, a stale completion allowed to revoke, a
begin that does not revoke, the ticket standing in for the per-dataset epoch,
and a begin that cancels a claimed export.

The nine for M4.3.1's closure cover the unconditional settings validation
restored ahead of the format branch, the CSV control made to depend on figure
validity instead, the ticket taken after the backend gate, after the conversion
gate, and before the target is known at all, an older completion allowed to
install after a newer attempt failed early, a begin that cancels a claimed
export, and both halves of the API-surface rule below.

One of them — check-then-act split across two acquisitions of the export slot —
is **still not killed by a behavioural test**, and that has not changed: the
window a split would open is narrower than a thread wake, so a test claiming to
catch it would be claiming scheduling luck as evidence. It is closed by the API
surface instead, and M4.3.1 makes that structural claim *checkable* rather than
merely argued. `check_repo.py` now pins two facts about `preview/export.rs`:

- `install_chromatogram` is private, and nothing outside the module calls it;
- the only functions naming `latest_preview_open` are the one that advances it
  and the one that compares **and** mutates under the same `&mut self`.

The second is deliberately not a list of forbidden names: any new way to ask
"is this ticket current" on its own has to read that field, whatever it is
called. Adding a query-only `is_current_preview_open`, or making the installer
`pub(super)`, fails the check. So the classification is now:

**NOT KILLED BY TIMING TEST; CLOSED BY API/TYPE SURFACE, AND THAT SURFACE IS
CHECKED.**

The behavioural race tests are retained as supporting evidence and are not the
proof.

**Live ProteoWizard evidence: NOT RUN**, and not required: the export semantics
depend on retained facts rather than on a backend read.

## The M4.4 handoff

What M4.4 will need and now has: a stable role for a second measured series, a
panel that can declare a displayed value window, a chromatogram figure builder
that takes a resolved range, and a snapshot whose lifetime is already tied to
the visible preview. What it must add is the linked two-panel figure itself, and
the selected-scan annotation this milestone deliberately left out.
