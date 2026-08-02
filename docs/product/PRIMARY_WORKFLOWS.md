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

1. Use `Add files…` to choose one or many mzML files, or `Add mzML folder…` to take every `.mzML` file found beneath one folder.
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

**Planned follow-ups**, neither of which the application does yet: Explorer drag-and-drop (M1.5), and directory-formatted acquisition discovery, which stays gated until this repository can convert one.

## WF-003 — Inspect an acquisition

1. Select a row.
2. Metadata and chromatogram enter visible loading states.
3. TIC/BPC renders, or a specific unsupported/error state appears.
4. Click an RT or select a scan row.
5. Spectrum, marker, row and inspector synchronize.

**Success:** user can confirm identity and inspect a relevant scan without changing modes.

## WF-004 — Convert a batch

1. Choose selected/all scope.
2. Review semantic settings, output root, conflict policy and natural-language summary.
3. Start conversion.
4. Queue advances independently per file.
5. Completed outputs expose Open file/folder; failed items expose action + details + retry.

**Success:** valid outputs are easy to locate and failures do not require rebuilding the batch.

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

**Success:** output is independent of app chrome/theme and corresponds to a defined PlotSpec/FigureSpec.

## WF-007 — Run a future analysis recipe

1. Select compatible artifacts.
2. Choose a reviewed recipe.
3. Configure typed, explained parameters.
4. Preview expected outputs and resource needs.
5. Run in an isolated worker.
6. Result artifacts appear with lineage and suitable views.

**Success:** no package-specific command/API knowledge is required, and results remain inspectable.
