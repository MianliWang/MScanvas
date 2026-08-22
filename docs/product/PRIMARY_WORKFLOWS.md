# Primary workflows

Each workflow is a testable product contract, not a screen description.

## WF-001 — First launch and backend readiness

**Goal:** reach a usable workspace without opening a terminal.

1. Application checks `PATH` and the locations an installer writes, in that
   order. Nothing is read from saved configuration: a stored path would go on
   applying, in later sessions and without being asked again, to a folder
   MSCanvas has no way to vouch for. `PATH` is searched because a user who put
   ProteoWizard there meant it to be found; a folder chosen through the picker
   is narrower than that, not wider, because it applies to one session only.
2. If available, it reports the ProteoWizard release and build and enters the
   workspace. The report states which installation it describes.
3. If unavailable, it offers installation guidance, retry, and `Choose folder…`
   for an installation somewhere it does not search. That choice lasts for the
   session only and names a folder, never an executable: naming one binary
   invites the other coming from somewhere else, which is already a failure.
4. A self-test produces a specific launch/configuration result.

**Success:** the user knows whether conversion is ready and what remains to fix.
**Recovery:** returning to automatic discovery is offered from every state,
including the one where the check itself failed — that state is precisely the
one that cannot say which installation is in use, so it must not strand a
chosen folder in place. Changing the installation discards what the replaced
one read, because those readings are not comparable with the new one's, but not
the selected file: it stays one click from being reopened.

## WF-002 — Add and curate a batch

1. Use `Add files…` to choose one or many mzML files, use `Add mzML folder…` to take every `.mzML` file found beneath one folder, or drop regular files, ordinary local folders, or a mixture of both from Windows Explorer.
2. Discovery represents each logical acquisition once.
3. Rows progressively show format, size and readiness.
4. User searches, sorts, selects/removes items or activates Clear workspace.

**Success:** the intended logical batch is visible.
**Invariant:** removal and clearing never delete source data.

**Adding a folder**, as of M1.4.1 and bounded by [ADR 0007](../architecture/adr/0007-logical-acquisition-discovery-and-folder-traversal.md):

- The scan is recursive over one folder the user chose in a native picker, and finds regular `.mzML` files only. Nothing else is offered, and no ProteoWizard process is launched for any of them.
- Linked and special filesystem entries — junctions, symbolic links, mount points, cloud placeholders — are never followed, so the scan cannot leave the folder the user pointed at. They are counted and reported.
- A scan that stopped at one of its four named limits, skipped a linked entry, or could not read a subtree says so. "No mzML files were found in that folder" is said only by a scan that described the whole folder.
- Starting the picker is a path-free two-command handshake. Rust first records or reuses one current-generation baseline and returns a session-scoped, opaque-but-not-secret correlation ID. The chooser must consume and validate that exact ID before the picker opens; only that successful claim advances the generation and creates the internal import token.
- The list stays usable throughout: searching, sorting, selecting and reading a file already in the session all keep working, and a selection made while a scan runs survives it.
- **Getting out stays available.** A scan cannot be cancelled, so `Clear list` is deliberately *not* disabled while one runs and is offered even when the list is empty. Clear and Remove wait only for the short begin response that proves Rust retained the baseline; after that they remain available throughout the picker and scan. When the Clear command succeeds, it is the reliable way out of a folder chosen by mistake and the final workspace is empty. `Remove selected` also stays available to manage rows already on screen, but it does not promise to cancel the import.
- What waits is acquiring more — `Add files…` and a second `Add mzML folder…` — and explicitly reading the list back. The roster command is a pure, mutation-gate-linearised snapshot and cannot supersede an import. It still waits during a scan because another loading state and a snapshot whose usefulness depends on commit order add no recovery path; the folder result or an owed reconciliation already supplies the authoritative answer.
- Rust linearises an import against a later workspace action at both claim and commit. If Clear or Remove reaches the gate before claim, the baseline is stale and the picker does not open. If claim comes first, the later action advances beyond its token and prevents its eventual commit. If the import commits first, the later action's roster is authoritative: `Clear list` still empties every row, while `Remove selected` removes only the handles it was given and can therefore retain newly imported rows. In no order may a late folder reply overwrite that later action.
- A workspace action that fails while the import is unresolved does not make the older folder reply safe to display: the failure may have happened after Rust changed state. Once both operations settle, MSCanvas reads the authoritative roster again, removes any preview whose row is no longer present, and keeps the typed action error visible.
- Main-webview native page-load start, not roster-request arrival, supersedes work owned by a replaced document. A delayed old begin cannot advance the generation or cancel a newer claimed import, and a delayed old roster request is only a snapshot. When this window made a later Clear or Remove, its resulting `import_superseded` or claim-stage `invalid_folder_import_reservation` settles silently; independent picker and discovery failures remain actionable.
- Two rows that end up sharing a filename show where each was found, and only for as long as they collide.

**Dropping from Windows Explorer**, as of M1.5 and bounded by
[ADR 0008](../architecture/adr/0008-windows-explorer-drag-and-drop.md):

- One native gesture may contain regular `.mzML` files, ordinary local folders,
  or both. MSCanvas preserves that gesture's top-level event order; each folder
  expands in ADR 0007's deterministic order at its position.
- Direct files use the same acceptance boundary as `Add files…`, while folders
  use the same recursive discovery and containment boundary as `Add mzML
  folder…`. One root limit and one shared entries, directories and candidates
  ledger apply to the whole drop, and direct files consume candidate allowance;
  traversal depth restarts at zero for each folder root.
- A drop that reaches a limit, refuses a linked entry, or cannot inspect part of
  its input reports the operation as incomplete while retaining valid candidates
  already found. Reparse, remote and virtual roots are not traversed, and a root
  failure does not disclose the root's name.
- Native paths remain in Rust. React receives ordered, typed, path-free updates
  and no Tauri event or filesystem capability; drop ingestion does not start one
  backend read per accepted row.
- The current document completes its path-free Begin/Claim subscription attempt
  before reading the authoritative roster. Each document gets a fresh opaque
  authority at creation; Rust challenges that exact current realm and rechecks
  the captured native epoch before either phase can change subscriber state.
  Subscription unavailability is a separate, truthful and retryable state
  rather than an ingestion failure. A failed subscription still permits roster
  adoption and leaves both Add actions usable; a successful Retry reads the
  authoritative roster again.
- Hover and import feedback are non-modal and do not take focus. Native Leave or
  Drop clears hover, and the overlay never captures focus. Search, sort,
  selection, preview, Remove and Clear remain usable; Add actions and roster
  reload wait for the active drop, and a second drop is rejected as busy rather
  than replacing it.
- If Drop disables a keyboard-focused Add action, completion restores focus only
  when the user has not chosen another destination. Pointer activation never
  creates that keyboard debt, while a focused keyboard Dismiss or Retry hands
  focus to the durable Add action when the transient control disappears.
- Remove, Clear and main-document reload supersede a drop that has not committed,
  so a late completion cannot reinstall an older roster or notice. At most one
  preview may start after a successful drop, and only when Rust proves the
  workspace was empty before it.
- A current Drop result prunes the live selection against Rust's roster, unions
  the new handles, and sets roster focus and range anchor to the first newly
  added row while preserving query, sort, surviving row state and active
  preview.

**Planned follow-up:** directory-formatted acquisition discovery remains gated
until this repository can convert one.

## WF-003 — Inspect an acquisition

1. Select a row.
2. Metadata and chromatogram enter visible loading states.
3. TIC/BPC renders, or a specific unsupported/error state appears.
4. Click an RT or select a scan row.
5. Spectrum, marker, row and inspector synchronize.

**Success:** user can confirm identity and inspect a relevant scan without changing modes.

**Built for mzML.** Steps 1 to 5 are reachable for a loaded mzML preview whose
spectrum table arrived complete. The chromatogram is drawn from the per-scan
values the table already carries, so no additional backend process runs for it,
and the traces are not presented as a stored chromatogram record. Clicking the
plot resolves the nearest scan out of the whole run rather than out of the
reduced drawing, and commits the same selection the table commits. Selecting a
scan does not disturb the range the user zoomed to; a selection outside it pans
the least it can.

What is still missing: a chromatogram for a vendor row without converting it
first, XIC, and any export of the chromatogram itself. A preview whose spectrum
table was truncated shows why TIC/BPC are unavailable rather than drawing the
rows that did arrive. See
[ADR 0031](../architecture/adr/0031-linked-chromatogram-and-selection.md).

## WF-004 — Convert a batch

1. Choose selected/all scope.
2. Review semantic settings, output root, conflict policy and natural-language summary.
3. Start conversion.
4. Queue advances independently per file.
5. Completed outputs expose Open file/folder; failed items expose action + details + retry.

**Success:** valid outputs are easy to locate and failures do not require rebuilding the batch.

**Partly built.** Steps 4 and 5 are reachable for one vendor family, as WF-004a
below. Step 1's "all" is not: a queue holds at most 16 items. Steps 2's semantic
settings, its output-root choice and "Open file/folder" remain unreachable. See
[ADR 0009](../architecture/adr/0009-mzml-conversion-execution-boundary.md) and
[ADR 0013](../architecture/adr/0013-serial-conversion-queue.md).

## WF-004a — Convert a queue of vendor acquisitions

1. `Add files…` and choose acquisitions. mzML, evidenced Thermo Scientific RAW,
   evidenced Shimadzu LabSolutions LCD and evidenced SCIEX WIFF are all
   admitted; a folder or a drop still admits mzML only.

   A SCIEX acquisition is two files. Choose the `.wiff`; MSCanvas admits it with
   the required `.wiff.scan` beside it as **one** row. If that companion is
   missing, is not a file, or is not the companion MSCanvas expects, the
   acquisition is refused with a sentence saying which file to put beside it —
   and choosing the `.wiff.scan` on its own says to choose the `.wiff` instead.
2. Select the vendor rows to convert, or focus one. The three families may be
   mixed in one selection. Vendor rows cannot be previewed, and say so.
3. Review the plan: the ordered list of what will run, which family each row
   is, what each item will write, how many selected rows are excluded for
   being mzML already, and the
   output-only validation disclosure. Two rows that would write one name are
   refused here, before anything is chosen or created.

   A row whose outputs the backend names itself says so — *1–24 mzML outputs,
   filenames determined during conversion* — rather than naming a file MSCanvas
   would be inventing.
4. Choose Fail or Skip if a file of that name already exists. There is no
   overwrite. The choice applies to the whole queue.
5. `Convert N selected…` opens a Rust-owned picker for one local folder, which
   every item of the queue writes into.
6. Items convert one at a time, in the order shown, and the panel says which item
   of how many is running. `Stop queue` ends the whole queue: it asks the current
   conversion to stop and begins none of the items after it, and the panel says
   so before it is pressed. Adding, clearing and previewing are unavailable until
   it ends; searching, sorting and reading the list are not, and every queued row
   stays visible through a search.
7. Each item reports its own outcome: the output's name, size and record counts;
   or that a name was already taken and left alone; or why nothing was written.
   The queue reports how many converted, were skipped, and failed — always as
   counts of acquisitions, never of output files.

   An item that produced a set of outputs reports how many were finalized, and
   — where the run established it — that every sample identified by the SCIEX
   reader produced its output. That is narrower than "every sample in the
   acquisition" and is deliberately worded as such.

   Publishing several files is sequential and is not a transaction. An item that
   stopped partway says how many were finalized and how many were not, states
   that the finalized files remain in the destination folder, and states that
   MSCanvas will not present them as the acquisition's complete output set. It
   is not offered a retry, and it is never described as though nothing had been
   converted.
8. `Retry N failed` reruns only the failures another attempt could change, in
   their original places, into the same folder under the same policy. Converted
   and skipped files are left exactly as they are. A queue that was stopped is
   over instead: it reports how many converted, were skipped, failed, were
   cancelled and were never run, and converting those rows again is a new queue.
9. A stop is not instantaneous and is not a promise about the item under way. A
   conversion that finished before the request was accepted keeps its ordinary
   result rather than being called cancelled. If MSCanvas cannot confirm that the
   converter process ended, it says so and refuses further backend work until the
   application is restarted.

10. `Add converted outputs to workspace` adds every finalized output of that
    queue — in queue order, and then in publication order within one item's own
    set — and only when it is pressed. The count offered is a count of output
    **files**: one finalized Thermo item offers one, and one finalized
    ten-sample SCIEX acquisition offers ten. An acquisition that finalized only
    part of its output set offers none, and is explained separately rather than
    silently omitted. Nothing is adopted
    because a conversion finished and nothing is previewed as a result. Before
    admitting one, MSCanvas re-establishes that the final name still refers to
    the exact object it finalized and that the object still holds the byte
    length and digest it validated; an output that is missing, replaced,
    modified or no longer readable is reported as such and does not stop the
    others, and one already in the workspace returns the row that is already
    there. A stopped or stop-failed queue keeps whatever it finalized and can
    still be adopted, and so can a session that has stopped trusting the
    backend, because adding a file launches no process. Replace the queue or
    restart, and the outputs are ordinary mzML files `Add files…` still reaches.

11. `Export failure diagnostics…` appears for a terminal queue that has
    something to diagnose: an item that failed, one whose stop could not be
    confirmed, one that converted and left staging behind, or a queue whose own
    stop failed. It saves one local JSON file where the user chooses, holding
    structured facts about the latest attempt of each of those items and
    bounded excerpts of what the backend printed. Known filesystem paths and
    internal identifiers are removed, and an excerpt that still looks like it
    names one is withheld rather than saved — but backend text may still contain
    acquisition metadata, and the panel says so before the action is pressed.
    MSCanvas reports only the file name, its size, its SHA-256 and how many
    items it describes; nothing is uploaded, nothing is opened, and an existing
    file of that name is never replaced. A queue that simply worked offers
    nothing here at all.

**Success:** a set of acquisitions becomes a set of mzML files the user can
find, add to the session on purpose, and read -- one file's failure costs only
that file, and the interface never claims more about any of them than
output-only validation established.

**Not included:** more than 16 items in one queue, any other vendor family,
cancelling one item while the rest carry on, resuming a stopped queue, retrying
one, a progress percentage, parallel conversion, a queue that survives closing
the application, overwrite, adopting a subset of a queue's outputs, adopting
them automatically, previewing them automatically, any record of where an
adopted file came from that survives the session, diagnostics for an attempt
earlier than the latest one, complete raw backend logs, a diagnostics history,
uploading a diagnostics file anywhere, and any claim that an exported file is
anonymous or safe to share unreviewed.
Retry is offered only where Rust classifies the failure as retryable, which today
means a destination folder that exists but would not open and an acquisition that
exists but could not be read. See
[ADR 0013](../architecture/adr/0013-serial-conversion-queue.md) and
[ADR 0015](../architecture/adr/0015-user-visible-queue-stop.md) and
[ADR 0016](../architecture/adr/0016-explicit-converted-output-adoption.md) and
[ADR 0017](../architecture/adr/0017-redacted-conversion-diagnostics-export.md).

## WF-005 — Clear the workspace

**Idle:** `Clear list` → workspace becomes empty → optional Undo.
**Active run:** `Clear list` → choose remove non-running / cancel and clear / return.

**Success:** no restart and no source-file deletion.

## WF-006 — Export a scientific figure

1. Establish the relevant current view/selection.
2. Choose quick copy/PNG or open `Export figure`.
3. Select current/full range, dimensions, figure theme and optional metadata.
4. Preview the export-specific render.
5. Export image and optionally underlying data.

**Implemented today (M4.2):** step 2's quick-copy half as `Copy plot`, step 3's
dimensions and theme, and step 5, both halves -- for the selected spectrum only. The `Selected spectrum` panel offers `Export SVG…`,
`Export PNG…`, `Copy plot`, `Export CSV…` and `Export TSV…` once a spectrum has
loaded, beside a width, a height, a PNG DPI and a Light/Dark figure theme — including one that
loaded with no peaks, which exports an honest empty figure. Each writes one file
through a Rust-owned save dialog that replaces nothing; a dismissed dialog is an
ordinary outcome and leaves the spectrum exactly as it was. What is written is
the complete spectrum Rust read, not the bounded arrays the interface drew from.

What is still missing from steps 2 to 4: PNG is a save rather than a quick copy
target, there is no range chooser because there is no zoom or pan to choose a
range from, and step 4's export-specific preview does not exist -- the figure is
described by its settings rather than shown before it is written. Neither a
chromatogram export nor a current-range export exists -- though the range
itself now does, as the chromatogram's committed visible domain. See
[ADR 0029](../architecture/adr/0029-first-visible-spectrum-figure-and-data-export.md)
and [ADR 0031](../architecture/adr/0031-linked-chromatogram-and-selection.md).

**Success:** output is independent of app chrome/theme and corresponds to a defined PlotSpec/FigureSpec.

## WF-007 — Run a future analysis recipe

1. Select compatible artifacts.
2. Choose a reviewed recipe.
3. Configure typed, explained parameters.
4. Preview expected outputs and resource needs.
5. Run in an isolated worker.
6. Result artifacts appear with lineage and suitable views.

**Success:** no package-specific command/API knowledge is required, and results remain inspectable.
