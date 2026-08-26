# ADR 0036 — A linked figure is one operation over two retained sources

Status: accepted
Date: 2026-08-26
Related: [0028](0028-figure-renderer-and-semantic-specification.md),
[0029](0029-first-visible-spectrum-figure-and-data-export.md),
[0030](0030-png-copy-plot-and-figure-settings.md),
[0033](0033-visible-linked-tic-bpc-viewer.md),
[0034](0034-chromatogram-export-and-range-scope.md),
[0035](0035-export-filename-format-integrity.md)

## What this ADR is

FIG-006. The run on screen and the scan selected in it can now be exported as one
figure of two ordered panels: the chromatogram above, marked at the selected
scan, and that scan's complete spectrum below. SVG, PNG and `Copy plot`.

It adds no source. Both halves already existed as separately exportable
snapshots, and this is the decision about what it means to say they describe the
same thing.

## No third token

The webview holds two opaque names: a chromatogram export token, issued with the
preview, and a selected-spectrum export token, issued with the scan. A linked
figure takes both.

A third, separately installed "linked" identity was the obvious shape and is the
wrong one. It would be a fourth thing to keep in step with three others, and the
question it exists to answer — *are these two the same scan* — would then be
asked when the identity was installed rather than when the figure is drawn. Every
way the two halves can diverge afterwards would be a way for that identity to
outlive its own truth.

So what M4.4 adds is an **operation** snapshot: `LinkedPair`, bound at BEGIN,
never rebound, alive exactly as long as the operation is. It is not retained,
not named to the webview, and not something a later command can ask for.

## One acquisition, one moment

`ScientificExportSlots::linked_pair` reads both tokens, proves the same dataset
owns them, finds the exact retained row, resolves the range, checks the selected
scan is inside it, checks a trace is visible and checks the figure is tall enough
for two panels. All of it under the one `&mut ScientificExportSlots` its caller
holds.

Reading one token, releasing the slot, and reading the other would let the pair
describe two different instants — a preview replaced between the two lookups, a
selection superseded — which is the one thing a linked figure claims it does not
do.

**No test can catch that**, because it needs an install to land inside a window
of a few instructions, and anything claiming to catch it would be claiming
scheduling luck as evidence. What closes it is the shape of the API, and
`check_repo.py` pins that shape:

- `spectrum_for` and `chromatogram_for` are private to `export.rs`, so no call
  site outside the module can read one half on its own at all;
- `linked_pair` is private too, and the only functions calling it are the linked
  save and the linked copy, each under its own `&mut self`;
- `LinkedPair` is constructed in exactly one place.

The first two rules are deliberately not lists of forbidden callers. Any new way
to read one half alone has to call one of those two readers, whatever the caller
is named.

## Same dataset is necessary and not sufficient

Two snapshots of one dataset can still describe two different moments. A spectrum
read before a reload; a table replaced underneath it. So ownership is where the
check starts and not where it ends.

`ChromatogramSource::row_for_spectrum` takes the spectrum's zero-based index as a
table position — constant time, independent of scan count — and then **reconciles
the row's identity with the spectrum's**, which is the reconciliation the
selected-spectrum loader already performs against the row it read. A
disagreement answers `None`, and the export is refused rather than resolved in
favour of one of the two.

The position lookup alone would not be enough, and the case is ordinary rather
than contrived: a table whose reported indices are not a gapless ascending run
puts a different scan at every position after the gap, and nothing in the format
promises they are. A lookup that stopped at "is there a row here" would draw a
marker at a scan nobody selected.

## Retention time is a coordinate, not an identity

The marker's position is `row.retention_time()` — the matched retained row's own
number.

Nothing else may supply it. Not the spectrum's own reported retention time, which
is a second reading of the same quantity; not the viewer; not a pointer position;
not anything the webview sends, because the webview sends no retention time for
the selected scan at all. A marker drawn at a time the source does not have would
be the figure asserting a scan was acquired when it was not.

And retention time is not how the pair is found. **Scans may share one.** A run
with two scans at 20.4 is an ordinary run, and a lookup by time could not say
which of them was selected — it would find the first, and no assertion about the
marker's *position* could notice, because both are at the same position. What
tells them apart is the identity the pair reconciles.

The words follow from this. The figure's caption names the marked scan by its
**index**, never by its retention time, and the retention time appears only where
it belongs: as the coordinate the renderer says the marker was drawn at.

## Full run, or current range

The same choice the chromatogram already offers, and the same authority:
`ViewerInteractionState.committedDomain`, never a gesture in flight. The linked
surface reuses that control rather than adding one, because the range it needs is
the range the user already chose for the run.

**A selected scan outside the requested range is a refusal.** A user may select a
scan and then pan away from it, and that is an ordinary thing to do. What a
linked figure may not do is widen the range back, move the viewer, settle or
cancel a gesture, or draw a marker outside the panel that carries it and still
call the result linked. Edges count as inside; there is no epsilon.

The interface says so before a dialog could open — *"The selected scan is outside
the current chromatogram range. Choose Full run or move the current range to
include the selected scan."* — and that sentence is **guidance, not authority**.
Which scan the retained table holds at which time is Rust's fact; Rust decides it
again against the retained row and refuses with its own typed answer. What the
interface adds is being told in time, and being told which of the two fixes to
reach for.

A current-range request with no committed window is the whole run and stays a
current-range export, exactly as it does for the chromatogram alone.

## The selected spectrum is always its full source

The lower panel is the complete spectrum, whatever the top panel covers: full
source, no visible domain, no value window, every measured point.

A chromatogram range is a statement about *where the scan sits in the run*. It is
not a statement about which of that scan's peaks are real, so narrowing the
spectrum to it would answer a question nobody asked by discarding data nobody
asked to lose. There is still no current-range export of a selected spectrum, on
this surface or on its own.

## Two ordered panels, and no contract change

The renderer has carried a `Vec<PanelSpec>` since ADR 0028, and this is its first
real two-panel use. Order is the meaning: panels are placed top to bottom in the
sequence they are given, the renderer's own description numbers them, and the
caption says which is which — so a figure whose panels were swapped would lie
about both, in the drawing and in the words.

The two panels are built by the same two functions the single-source exports use.
`chromatogram_panel` and `spectrum_panel` were factored out of them for exactly
that: the linked figure draws the *same* science rather than a second
implementation of it, free to disagree with the first. The upper panel is the
chromatogram panel plus one marker; the lower panel is the spectrum panel,
unchanged.

`plot_spec::SCHEMA_VERSION` stays **2**. No layout enum, no panel weights, no
composer groundwork, no FigureSpec v3. The gate this milestone had to pass before
anything was built on it was whether ordered vertical bands are usable at the
contract's own minimum, and they are.

## The minimum height is 260, and it is arithmetic

`FigureSpec::validate` already required `MIN_FIGURE_CHROME_HEIGHT +
MIN_PANEL_HEIGHT × panels`, which is 100 + 80 × 2 for two panels. The export
boundary asks the same question before a reservation is issued, so a figure that
could not be built never opens a dialog:

> A two-panel linked figure needs a height of at least 260.

259 is refused and reserves nothing. **The single-panel minimum is unchanged**:
one panel is still drawable at 180, and both single-source exports still begin at
259 and at 180. A linked figure needing more room is not a reason for a spectrum
to need it.

## One lane, now three surfaces

`ClaimedExport::LinkedFigure` joins the two existing variants rather than adding
a lane. There is one place for a claim to live, and that is what makes two native
save dialogs, or a clipboard rasterization racing a file write, states this
application cannot be in.

Each save command names the kind it is for, and **the kind is checked before the
lane is marked claimed**. The three share one reservation counter, so a linked
reservation is a perfectly well-formed chromatogram reservation and a document
that reloaded and replayed a stored one reaches exactly this. Marking the lane
claimed on the way to refusing would leave it committed with no dialog, no writer
and nothing to cancel it, and every later scientific export of the session would
be refused as "already exporting" until the application was restarted.

All nine reservation/claim combinations are pinned. Each of the six wrong-kind
claims refuses, leaves the reservation claimable by its own command, and leaves a
later export able to begin.

The interface says the lane is one by closing all three surfaces' actions while
any of them owns it. Availability is what is shared; **results are not**. Each
surface keeps its own outcome, its own status message and its own token binding,
and no panel is hidden while another runs.

## `namesVisiblePair`

Lane occupancy and "does this result belong beside what is on screen" are
different questions, and the linked surface is the one where they come apart most
easily, because its operation is about a *pair*.

A running linked operation is bound to both tokens. Replacing either — selecting
another scan, opening another run — makes `namesVisiblePair` false. The lane stays
held, because Rust is still writing, and reporting it free would re-offer every
scientific export while a file is being written. What changes is what the surface
is allowed to *say*: the running label stops claiming this pair is the one being
exported, and when the operation settles its answer is discarded rather than
published beside a pair it is not about.

That holds for a success, a cancellation and a failure alike. A failure carries
the part of the answer a user has to act on — above all that the export could not
remove the temporary file it left in their folder — which is exactly what must
not appear beside a pair it is not about.

## No linked data document

The linked surface offers SVG, PNG and `Copy plot`, and no CSV or TSV.

A combined table would have to interleave two different measurements — one record
per scan and one record per point, in one file, under one header — or pick one of
them and drop the link. Neither is a document that says what it is. The two
single-source exports keep their own data documents, which are the honest place
for those numbers.

## Saving and copying

The same pipeline every other figure goes through. One `FigureSpec` in, one
document out: `svg::render` for the vector, the same rasterizer and PNG encoder
for the raster, and the same rasterizer again for the clipboard. No screenshot,
no DOM, and no pixels cross back into the webview.

A pair the *contract* refuses — a spectrum whose m/z array is not ordered, which
mzML does not require and nothing here sorts — is refused as a pair, with its own
answer rather than either panel's. The boundary knows the figure could not be
built and does not know which half refused it, and answering with the
chromatogram's would send a reader to change a range or a trace toggle that had
nothing to do with it.

A copy commits the lane immediately and has no reservation, because there is no
destination to choose and nothing to come back from. A save is two phases —
`begin` issues the reservation, `save` claims it and shows the dialog — and
everything the figure is about was decided at `begin`. Selecting another scan or
opening another run while the dialog is open cannot change what is written.

Filenames follow ADR 0035: `mscanvas-linked-spectrum-{index}-{scope}.{format}`,
built from the scan's position in the run and the range scope the user chose, and
from nothing that came out of a path, a workspace handle or a dataset's display
name. The destination is refused if its extension does not name the document it
would hold, refused if the name is already taken, and written through the same
private-sibling transaction that replaces nothing — with no `.mscanvas-export-*`
residue left by any refusal.

## The interface

One compact section at the bottom of the chromatogram's existing export
disclosure: `Linked chromatogram + spectrum`, offering `Export linked SVG…`,
`Export linked PNG…` and `Copy linked plot`.

It lives there rather than beside the selected spectrum because the two things it
needs are chosen there — how much of the run to cover, and which traces are on
screen — and it reuses that surface's range control and figure settings rather
than growing its own.

**Availability is a sentence, not a greyed control.** Each reason names the thing
the reader can change, in the order they would fix them: nothing to link to, a
spectrum still loading, no scan selected, no visible trace, a selected scan the
current range excludes, a figure setting that is not a size, and a height below
the two-panel minimum. The last rules split the way they already do elsewhere: a
resolution no PNG could record closes the linked PNG alone, because an SVG has no
pixels to give a physical size to and a clipboard image carries none at all.

The section shows **one sentence at a time** — what it draws when it can be used,
why not when it cannot. A reader who cannot act needs the reason; a reader who
can needs the description; neither is served by being shown the other's
underneath their own.

Measured, in the state where the three actions are live, as the height the open
export surface gains:

| | 1366×768 | 960×640 | 1920×1080 |
| --- | ---: | ---: | ---: |
| one sentence | **116px** | 116px | 96px |
| two stacked paragraphs | 163px | 163px | 122px |

Below 1920 the description wraps to a second line, which is why the two narrower
viewports cost the same and the widest costs less. At 1366×768 the difference
decides whether the plot's top edge is still inside the 614px viewer column with
the surface open.

Even so the plot ends up below its panel's fold, which is the trade ADR 0034
measured and accepted when the export surface got its own scroll owner. That is
recorded rather than glossed: at all three supported viewports the plot is still
revealed by the product's own scroll owner, still hit-testable where it is
painted, and still zooms on a real wheel over it.

Two live regions in one surface now carry two accessible names, and the linked
dismiss control says which message it clears. A reader listing the controls would
otherwise hear "Dismiss" twice with nothing to tell them apart.

## What is not claimed

- **No third source, and no new backend work.** Nothing rereads a file, launches
  a process, caches anything or adds a dependency.
- **No current-range export of a selected spectrum**, on this surface or its own.
- **No linked CSV or TSV.**
- **No saved `FigureSpec` (FIG-007) and no figure composer (FIG-008).** No layout
  schema, no panel weights, no `FigureSpec` v3.
- **No XIC (VIEW-007), no spectrum zoom or pan, no multi-layer comparison
  (VIEW-008).**
- **No smoothing, baseline correction, normalization or peak picking.** Every
  number written is the one the backend reported.

## Evidence

**Rust: 1,262 tests**, up from 1,220. The pair matrix — different owners, a row
whose identity does not reconcile, a spectrum beyond the retained table,
duplicate retention times paired by identity, and a marker taken from the matched
row rather than from the spectrum's own reading of the same quantity. The range
matrix — Full, `Current` with no window, and the selected scan at the low edge,
at the high edge, inside, below and above, with the accepted window carried
exactly as asked. The nine reservation/claim combinations. 259 and 260, and the
single-panel minimum unchanged at both. The artifact — panel order, a lower panel
that is the complete spectrum under every scope, exactly one marker above and
none below, words that name the scan by index, the M4.3 off-window fixture
carried in, a one-scan run over both scopes, schema version 2, and no path or
handle in either panel.

**Zero delta.** The single-panel SVGs are pinned as bytes in
`fixtures/plot-golden`. The three fixtures were generated on canonical main,
before `spectrum_panel` and `chromatogram_panel` were factored out, and are
byte-identical after it.

**Frontend: 1,050 tests**, up from 1,007. The rendered matrix covers the section
present, no spectrum, a spectrum loading, a spectrum ready, TIC alone, BPC alone,
both, neither, Full, a current range holding the scan, a current range excluding
it, 259 and 260, an unusable width, an unusable resolution, all three surfaces
holding the lane against the other two, success, cancel, a typed refusal, a
failure carrying a residue detail, and a copy. Every unavailable case presses the
control anyway and proves the recorder is empty. Four operation lifetimes: a
selection replaced mid-operation, a preview replaced mid-operation, a stale
failure carrying a detail, and an unmoved pair.

**Browser QA: 126 cases** across all six spec files, at 1366×768, 960×640 and
1920×1080. Every one of the eight export actions — five old, three linked —
inside everything that clips, inside the viewport, and the thing
`elementFromPoint` hands a click to; a real click dispatching the operation it
names; the three views in their own bands with nothing painted over the scan
table; the plot still reachable and still operable. No console error, warning,
unhandled rejection or uncaught exception.

**Real-Tauri QA: 12 cases**, eleven executed and one skipped where the session
has no usable clipboard. The marker's coordinate is a number
only Rust has — the document is given six rows running to 0.0625 and no retention
time for the scan it selects, Rust's run begins at 0.10, and the accepted and
refused ranges differ exactly there. Both stale tokens, a current range excluding
the selection, a range the run does not have, 259 and 260, no visible trace, a
linked begin taking the lane a chromatogram reservation was holding, and a linked
reservation handed to the wrong save without wedging the lane.

**Fifteen mutations**, applied one at a time and restored byte-for-byte: frontend
arrays in the payload, a same-owner pair accepted without reconciling the row, a
selected scan outside the range accepted, the range silently widened, the pair's
readers made reachable outside the module, the interface's own retention time
made the marker's authority, the panels swapped, the lower panel narrowed with
the chromatogram, the marker omitted, both traces hidden accepted, 259 accepted,
a lane of the linked surface's own, a running operation cleared on a token
change, a stale settle that never releases, and a wrong-kind claim that wedges
the lane. Each failed the check it was aimed at.

The first of those found a real gap rather than confirming a guard: adding two
array fields to the `invoke` payload passed the whole unit suite, because every
test above that layer substitutes the `PreviewApi` and records what the *hook*
sent. The payload is now pinned at the adapter that produces it.

**Native save dialog: NOT RUN — environment residual.** The dialog does not
appear inside the automated WebView2 session on this machine, and all five
pre-existing M4.2 native cases fail there in the same way. Product code was not
changed to automate it. What the dialog would add is proved at the Rust boundary
instead, deterministically: the dialog's own facts, a path-free suggested name,
an SVG refused under `.png` and a PNG under `.svg`, `.PNG` accepted, a name
already taken refused with the existing file untouched, and no residue left by
any refusal.

**Live ProteoWizard evidence: NOT RUN.** No installation is present, and the
seeded rendered path exists precisely because of that.

Two limits of the rendered evidence, recorded rather than glossed. **Different
owners and a non-reconciling row are proved at the Rust boundary only**: the
seeded session holds one dataset and one spectrum, and reaching a second of
either needs a real backend. And **`Copy plot`'s finished outcome is not read
back on this machine**, because the Windows session's clipboard cannot be opened
by any process; that case skips loudly and prints why.

## The seed's two halves

Found while building this: the rendered seed's table numbered its scans from one
while its spectrum called itself nineteen. Both halves worked perfectly alone,
and nothing had ever asked them to be the same scan — so no linked figure could
have been made from the seeded session at all. The table's first row is now the
spectrum's own row, and `install` asserts the two reconcile before either is
installed, so a later edit to either fails the application's own startup rather
than one distant test.

## The M5 handoff

M4 is complete. FIG-001 through FIG-006 are implemented; FIG-007 and FIG-008 are
not, and neither is XIC, spectrum zoom and pan, multi-layer comparison, or
current-range export of a selected spectrum.

The next planning priority is viewer completion first, conversion completion
second, and then broader UI/UX and product hardening.
