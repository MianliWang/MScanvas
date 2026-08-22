# ADR 0031 — The linked chromatogram, and one selected scan

Status: accepted
Date: 2026-08-22
Supersedes: nothing
Related: [0003](0003-msaccess-preview-spike.md), [0028](0028-figure-renderer-and-semantic-specification.md),
[0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0030](0030-png-copy-plot-and-figure-settings.md)

## Context

The viewer had a scan table and a selected spectrum. What it did not have was
the thing a reader looks at first: where in the run they are. VIEW-002, VIEW-005
and VIEW-006 are that surface — a chromatogram to locate a scan in, a selection
that means the same thing in all three views, and a way to move between scans
without a pointer.

The question this milestone had to answer before writing anything was where the
chromatogram's numbers come from.

## The traces are the spectrum table

**TIC is `SpectrumRow.totalIonCurrent`. BPC is `SpectrumRow.basePeakIntensity`.
The x axis is `SpectrumRow.retentionTime`.**

Every one of those already crossed the typed preview boundary when the file was
opened, and the scan table already shows two of them. The chromatogram is a
second reading of a table the user is looking at.

Three things it deliberately is not.

**Not the standalone `msaccess tic` query.** That capability is evidence-gated
in this repository: the representative PXD081190 acquisition returned exit 0
with no output for it. Nothing here adds `PreviewOperation::Tic` to
`open_operations()` or to `required_operations()`, and a test asserts this slice
never requests one. Backend availability is unchanged.

**Not a stored chromatogram record.** Nothing in the accepted contract
establishes that the source file contained one — the representative acquisition
reports no chromatograms at all — so nothing in the interface may say it did.
The panel says "Per-scan values from the loaded spectrum table … Not a stored
chromatogram record", and a rendered test reads that sentence back.

**Not recomputed from spectrum arrays.** Summing intensities per scan would need
one selected-spectrum read per row — tens of thousands of ProteoWizard processes
for the representative file — and would produce numbers that could disagree with
the table beside them. The typed table values are used exactly.

### There is no BPC backend query

There is no accepted `msaccess` query for a base peak chromatogram in the
current contract, and this milestone does not invent one. BPC here is the base
peak intensity series across scans, which is what the table reports.

## Completeness: a prefix is never drawn as a run

`SpectrumTable` carries `truncated`. When it is set, the loaded table is the
first N rows of a longer run, and drawing them as a chromatogram would be a
picture of a shorter experiment than the one that happened.

So `buildChromatogramModel` **fails closed**: a truncated table produces
`unavailable` with a reason the panel reads out, while the scan table's own
truncation notice stays where it was. A run with no spectra, a retention time
that is not a finite number, and an intensity that is not one each get their own
reason for the same purpose — the panel says what happened rather than that
something did.

This milestone does not add paging for truncated tables.

## Units are not named

The measured `msaccess` formatter emits no retention-time unit, so
`RetentionTimeDto.unit_known` is false and the axis says
"Retention time — unit not reported". The intensity contract establishes no
display unit either, so it says "Intensity — unit not reported".

Minutes is the obvious guess and it is still a guess. A chromatogram labelled
in minutes states something the file did not, and a figure that states what it
was not told is worse than one that admits the gap. The model only reports a
known unit when **every** row reported one.

## Order: two different questions

The scan table stays in the order the run produced. The chromatogram is drawn by
retention time. These are different questions, so a projection is sorted and the
table is not touched.

Ties are decided once, in the sort: equal retention times keep table order. That
is what makes every later question about "which of these two scans" answerable
without depending on iteration order.

## The full model, and the drawing

The model holds **one point per scan**. The drawing holds far fewer. Keeping
them apart is what lets a click name a real scan.

### Reduction is min/max, not the spectrum's rule

A joined trace cannot use the stick spectrum's per-sign extreme rule. That rule
keeps each column's greatest non-negative value and its deepest negative one,
which is right for sticks standing on a baseline and wrong for a line: the line
would be drawn through the column maxima and become an **upper envelope**, with
every trough between two peaks removed.

So each column keeps up to four of **its own scans** — its first, its lowest,
its highest and its last — emitted in retention-time order and de-duplicated.

- The extremes stop a tall peak being replaced by a shorter neighbour and a deep
  trough being filled in.
- The first and last keep the line entering and leaving each column where the
  data does.
- One scan of overhang past each edge of the viewport keeps a zoomed trace
  meeting the axis instead of starting inside it.
- **No value is computed.** Every vertex is a scan, which is why a vertex can
  name a row.

At 36,319 scans this draws under 2,000 vertices in one path per trace.

### Nearest scan comes from the model

A click resolves against the **full** model by binary search over retention
time, never against the drawn vertices. Resolving against the drawing would
select a neighbour of the scan the user pointed at — silently, and more often
the larger the run.

Two normalising steps make the answer deterministic:

- an equidistant tie takes the **lower table position**, then the lower spectrum
  index;
- a group of scans sharing one retention time always answers its **earliest
  table row**, rather than whichever side the probe approached from.

## Hover is transient; a click is not

Hover throttles to a frame, lives in the plot component, and never leaves it. It
selects nothing, reads nothing, scrolls nothing and changes no export authority.
The readout names the hovered scan — index, scan number, MS level, retention
time with its unit state, and both per-scan values — because those are facts
about the scan rather than about the trace that happens to be drawn.

A click commits a selection. Nothing else does.

## One selected scan

There is one logical selection, `selectedIndex` in the preview workspace, and
every source routes into the same `selectSpectrum`:

- a scan-table click, and Enter or Space on the focused row;
- a chromatogram click;
- Previous scan and Next scan.

The established request-generation behaviour is reused rather than
reimplemented: a later selection supersedes an earlier one, a stale answer
cannot overwrite it, and a repeat of the row already being read is dropped so a
double click is not two processes.

### The table's keyboard model is unchanged

Arrow, Page and Home/End move **focus** without selecting. Enter and Space
commit. This is load-bearing — selection-following-focus would launch one
ProteoWizard process per key press — and it is asserted in the unit suite and in
the browser.

### Reveal is not a focus move

A selection made in the plot or with Previous/Next has to make its row visible:
a marker pointing at a scan the table is not showing is a link the user cannot
follow. But taking DOM focus out of the control they are operating would send
their next key press somewhere they did not ask for.

So `SpectrumTable` reveals: it scrolls the row into view and moves the roving
tab stop, without calling `.focus()`. Only a keyboard move inside the table
still focuses.

Writing that split surfaced a defect that predates this milestone. The sticky
header scrolls **inside** the same box as the rows, so a row brought to exactly
its own offset arrives underneath it — focused, announced and invisible. The
reveal now stops a header's height sooner, which is what the opposite edge
already did.

### Previous and Next walk table order

Not `index ± 1`. The two are the same thing only if the table is a gapless
ascending run of indices, which nothing in the contract promises. A selected
index the table does not contain answers "no neighbour" and disables both
buttons rather than guessing one.

## The visible domain

A semantic retention-time interval, held at the preview-workspace level:

- `null` means the whole run — a state, not a range that happens to equal one;
- `{ low, high }` is a finite, forward subrange contained in the full domain.

M4.3 can therefore ask "full range or current range" without reverse-engineering
SVG coordinates.

**Gesture state stays in the renderer.** A wheel or a drag moves the plot's own
state and publishes a domain when it settles — a drag at its end, a wheel a
moment after the last event. Pointer coordinates never reach the workspace, so a
pan does not re-render the scan table once a frame.

### Clamping and the minimum span

Every domain is clamped finite, forward, and inside the run. A pan that would
leave the run stops at the edge rather than shortening, so panning to the end
and back does not slowly narrow the viewport.

The narrowest viewport is **one ten-thousandth of the full span**. Stated as a
fraction of the data rather than as an absolute time, because the unit is not
reported and an absolute floor would mean different things for a run of seconds
and a run of hours. A run whose scans all share one retention time has a
zero-width full span and therefore no subrange: zoom is inert there rather than
ill-defined.

### Lifecycle

The viewport persists while different scans are selected in the same preview,
and while a vendor row merely takes focus. It resets when the preview is
replaced, closed or cleared — a range chosen in one run means nothing in
another.

A selection that lands outside it **pans the least it can and keeps the span**.
Resetting the zoom would be the easy answer and the wrong one: the user chose
that span, and selecting a scan is not a request to stop looking at it.

Trace visibility is session UI state and is not written to disk. TIC alone is
the default: both at once is a comparison a reader asks for, not the first thing
they should have to disentangle.

## Pointer and keyboard

| | |
|---|---|
| Wheel | zooms about the pointer |
| Horizontal drag | pans, past a four-pixel threshold so a tremor is still a click |
| Click | selects the nearest scan |
| `+` / `=` | zoom in |
| `-` | zoom out |
| Left / Right | pan |
| Home / `0` | reset |

The keyboard set works when the plot itself has focus, so a text field being
edited is never intercepted. **Zoom in**, **Zoom out** and **Reset range** are
also visible buttons, so every pointer action has a keyboard route without a
global hotkey whose collisions nobody has reasoned about.

Traces are distinguished by dash pattern as well as colour, and the legend draws
the same dash. The selected scan is a rule and a glyph, not a colour change.

## Layout: three panels in a fixed-height shell

The viewer column is about 478px tall at a 768px window and now holds three
panels. Measuring rather than guessing found that a share of that left the
chromatogram 152px for content needing 230 — and because these panels clip, the
axis caption, the readout and the range were simply gone: present in the DOM,
invisible to anyone reading them.

The chromatogram is therefore a **locator strip**: one header line with three
short control groups, and under the plot the axis units, the visible range and
the source sentence. Each viewer row carries the floor its own chrome measures —
190px, 116px, 202px — and the stack owns a scrollbar when the window cannot meet
them. Giving each panel a share and letting the shortest clip hides controls
rather than moving them.

## No cache

ADR 0003 measured selected-spectrum navigation on the representative
acquisition at roughly 164–199 ms per backend invocation and found one process
per selection viable for that file. Nothing measured in this milestone changes
that: the work Viewer Closure adds is a model built once per preview and a
binary search per pointer move, neither of which touches the backend.

So **navigation remains lazy** — selected spectra are loaded on explicit
selection, and no bounded multi-spectrum cache exists. A cache is not a free
optimization: it changes memory retention, source invalidation, snapshot
lifetime, export authority and stale-data behaviour, and each of those is a
decision this milestone has no evidence to make. It remains an optimization to
revisit only if measured interaction evidence requires one.

## Scale, observed

One machine, one run, recorded as observations and not as thresholds or
promises. Synthetic table of 36,319 rows — the count ADR 0003 measured on the
representative acquisition — through the shipped frontend in Chrome:

| | |
|---|---|
| Row activation to three linked views | 343 ms |
| Table rows in the document | 22 |
| Plot vertices in the document | 1,922 |
| Four viewport actions | 310 ms |
| Backend calls during any viewport action | 0 |

Forty synthetic pointer moves took 4.4 s in total, which is WebDriver's
per-action round trip rather than anything the application spends; what the test
asserts about them is that none of them crossed the IPC boundary.

## Live backend evidence: NOT RUN

The pinned ProteoWizard fixture was verified but not read.

| | |
|---|---|
| Upstream commit | `a09eea91209131f6aa487f7316647fc536188c19` |
| Size | 25,072 bytes — **matched** |
| SHA-256 | `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83` — **matched** |

**Reason it was not run: this machine has no ProteoWizard installation.**
`msaccess` and `msconvert` are absent from `PATH` and from the usual install
locations, so there is nothing to read the fixture with. The fixture was fetched
into memory to verify its identity and never written to the repository or to
disk.

The implementation is grounded in the already accepted typed spectrum-table
contract rather than in this run.

## What this milestone does not implement

- No chromatogram export of any kind — no CSV, TSV, SVG or PNG, and no
  current-range export. That is M4.3.
- No linked chromatogram-plus-spectrum figure, and no FIG-006.
- No XIC (VIEW-007), no multi-layer comparison, no m/z or tolerance entry.
- No spectrum zoom or pan. The selected-spectrum plot remains full-range.
- No stored `FigureSpec`, no figure composer.
- No smoothing, baseline correction, peak picking, normalization or
  relative-intensity mode.
- No MS-level filtering UI.
- No vendor-format direct preview. The viewer remains mzML preview only, and a
  vendor row may hold focus while the loaded mzML preview stays visible.

VIEW-003 is unchanged: the selected-spectrum representation remains whatever the
backend actually establishes, and no profile-versus-centroid claim is made here.
