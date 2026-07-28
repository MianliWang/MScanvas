# Primary workflows

Each workflow is a testable product contract, not a screen description.

## WF-001 — First launch and backend readiness

**Goal:** reach a usable workspace without opening a terminal.

1. Application checks the locations an installer writes. Nothing is read from
   saved configuration: a stored path would go on applying, in later sessions
   and without being asked again, to a folder MSCanvas has no way to vouch for.
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

1. Drop files/folders or use Add files/Add folder.
2. Discovery represents each logical acquisition once.
3. Rows progressively show format, size and readiness.
4. User selects/removes items or activates Clear list.

**Success:** the intended logical batch is visible.
**Invariant:** removal and clearing never delete source data.

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
