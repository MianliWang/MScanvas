# ADR 0061 — Restore workspace

Status: **Proposed** on 2026-10-30. The owner asked for every backend item that
can be done now to start in parallel and for open details to follow the
recommendations; this record states them. The Rust side is implemented on
branch `be/restore-workspace` (`apps/desktop/src-tauri/src/workspace_restore.rs`).
No interface calls it yet, and the interface slice has prerequisites
(decision 4). The questions for the owner are listed
[at the end](#open-questions-for-the-owner).
Related: [0006](0006-multi-dataset-workspace-boundary.md) (the workspace
boundary, its *Persistence exclusion* and its collision-only relative context),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md) (capacity
1,024), [0058](0058-user-saved-conversion-presets.md) (the nearest store),
[0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md)
(the application is not single-instance);
the M7.5 preference store
([M7.5 record](../../ux/M7_5_PREFERENCES_FIRST_RUN_RECOVERY.md));
PRJ-001…PRJ-004 in the [feature catalog](../../product/FEATURE_CATALOG.md) and
the [M8.1 record](../../product/M8_1_FIRST_CLOSED_LOOP.md);
the [after-beta-1 plan, section 7.6](../../development/AFTER_BETA1_PLAN.md#76-refused-or-not-adopted).

## Context

WSP-010 (P1): "Restores logical state safely and marks missing files rather
than deleting rows silently." Today the workspace is session-only (ADR 0006,
*Persistence exclusion*): closing MSCanvas forgets every row, and that ADR
requires durable storage to arrive with its own schema and decision. This is
that decision.

A project reopen (PRJ-001…PRJ-004) is not this. A project is a document the
user chose and saved; reopening it restores no Workbench row and no conversion
membership, every reference starts with its linked-file check not yet run, and
putting one in the Workbench is an explicit per-reference action after a
matched check that hashes the file. Workspace restore is the application
remembering its own Workbench between launches, with no document the user
manages. Recording and re-checking must be cheap enough to run at every start.

Section 7.6 of the plan keeps automatic adoption, preview, retry and relink
refused. Restore must not become a way around any of them.

## Decisions

### 1. What is restored

The acquisition rows, each with its locator (the canonical path of every
member, primary first), its family and the identity facts admission
established for every member: length, volume serial and the 128-bit file ID.
Also the groups (one level, named, plus Ungrouped), the order of groups and of
rows within them, and each row's checked state.

The checked state is the row's **conversion membership**: the checkbox that
makes up Convert's "Checked rows" scope (WSP-005, WSP-008). It is the one
restored fact that feeds an action.

Never restored: an open preview, a viewed or highlighted row, a conversion
queue or its history, an adoption, a group's collapsed state, search or sort,
and a row's provenance (found under a folder, adopted from a conversion). A
restored row is a plain row.

*Recommendation, with the alternative:* conversion membership is restored,
because it is part of the arrangement the user built, and checking a row starts
nothing: Convert still shows its scope before it runs (WSP-008). The
alternative follows the two existing precedents: M8.1 restores "no conversion
membership or queue authority" when a project opens, and the M7.5 preference
record keeps "no highlighted or conversion selection". Under it every restored
row starts unchecked. Collapsed state is not restored, so a marked row never
starts hidden.

### 2. Where it is stored

One document, `workspace-restore.json`, in the per-user application-local data
directory Tauri resolves, the directory the preference store uses. It is never
written next to user data, an acquisition, an output or the executable. It is
versioned (`schemaVersion` 1), closed (`deny_unknown_fields`), bounded (decision
5) and replaced whole through `local_document::publish_through_temporary`: a
private sibling is filled and given the name by handle, so the name always
holds the previous document or the new one. The writer replaces only this
file.

A QA build (`e2e` feature) binds no directory for now, so a rendered campaign
never reads or writes the real profile's workspace, and the commands answer
`unavailable`. Once the preference store exposes the directory it is bound to
(`UiPreferenceStore::sibling_directory`, which the conversion preset store adds
on its own branch), the restore store binds that instead, so a QA build uses its
own QA root. That change must land before the interface slice's rendered QA.

### 3. When it is written

When the webview commits an arrangement (`save_workspace_restore`), which the
interface does after each roster answer and each organization change. Rust
composes the document from its own registry (locators and identity facts
never come from the webview, which has no paths) and from its own restored
rows (decision 4); the webview contributes only the groups, the order and the
checked handles. An arrangement must place every live and every restored row
of this process exactly once, or the save is refused (`staleArrangement`,
`invalidArrangement`) and the stored document stays as it was. A restored row
whose objects (volume serial and file ID of every member) are a live row's is
that row recorded twice: it is placed like any other and written once, as the
live row.

The application is not single-instance (ADR 0060). A save is refused
(`changedElsewhere`) when the document's name no longer holds the object this
process last read or wrote there, so a second window never writes over the
first one's record. Turning restore on is refused the same way. Once refused,
the process records nothing more until it restarts, and none of its own later
writes lifts that. Off and clear (decision 8) are not refused: they are the
user forgetting. Off writes off. Clear keeps the switch only while the name
still holds what this process last saw; otherwise it cannot know which switch
the other window left, so it writes off and this process is refused from then
on. A clear therefore never undoes another window's off, and a refused window
cannot record its paths again over it. The check and the replacement are two
steps, so a write landing between them is still lost; a lock beside the
document can close that if it is ever observed. A volume that has no file ID is
not guarded.

*Alternatives rejected:* Rust writing after each of its own roster mutations
cannot see the groups or the checked state, which only the webview holds, and
would add a write to every mutation path; writing only at exit loses the
session on a crash.

### 4. The start-up restore and the cheap re-check

The document is read once, when the store opens at start. A usable document's
rows become the session's *restored rows*: they are not Workbench rows, they
carry `restored-N` handles distinct from live `file-N` handles, and they are
carried into every save until they are put back or forgotten.

Each read (`read_workspace_restore`) re-checks every restored row: each member
is opened for reading only, sharing read, write and delete, without following a
link at the name, and its file ID, volume serial and length are compared with
the record. No byte is read and nothing is hashed, so a RAW file is never read
whole. The answer per row is one of:

- `matching`: the same file ID and volume serial, at the same length. This is
  not a content claim: a same-length rewrite in place matches, and so does a
  file ID the filesystem gave to a new file after the recorded one was deleted.
  Admission and the ordinary revalidation decide that when the row is used.
- `changed`: another object at the path, or the same object at another length.
- `missing`: nothing at the recorded path.
- `unreadable`: there, and its identity could not be established.
- `unsafe`: a link, a directory or a device.

A changed or missing file stays a marked row: it is never dropped, never
relinked, and its recorded facts are never replaced by what is there now.

*Recommendation for the interface slice:* one explicit **Restore workspace**
action puts the matching rows back, through ordinary admission (the same rule,
duplicate check and capacity as Add files), in their restored groups and
checked state; nothing is previewed and no conversion starts. Marked rows are
shown in place with their state and a Remove action. Putting a marked row back
is the user adding the file again. This is not adoption in the sense of
[ADR 0016](0016-explicit-converted-output-adoption.md), which takes a
conversion's outputs into the Workbench and stays explicit: a restored row is
only ever the file the user had already added, at the path it had.

*Alternative:* put matching rows back automatically at every start. Rejected
as the recommendation because of what admission costs, which the re-check above
does not:

- every Thermo RAW, Shimadzu LCD and SCIEX WIFF (both members) is read whole
  and SHA-256 hashed through a deny-write handle (`admit_signed_object` and the
  bundle admission in `mscanvas-proteowizard`), up to 1,024 acquisitions of
  several GB each, at every start;
- the workspace mutation gate is held for the whole batch, so no other
  workspace change can happen meanwhile;
- every row put back holds its file-identity lease, so a program that opens one
  of those files without sharing is refused, on files the user did not touch
  this session;
- a second window would put the same rows back again;
- it departs from the M7.5 stance that no roster or membership is remembered
  for the user.

Prerequisites of the interface slice, whichever the owner chooses:

- **Stable per-row slots.** Restored rows are numbered by position and only
  ever forgotten together (clear, off). Putting one back or dismissing one
  needs a slot that survives the others leaving.
- **A put-back command.** `add_files` is a Rust service method, not a webview
  command; the only webview command that admits files is the picker. Putting a
  restored row back needs a command that resolves the stored paths inside
  Rust, admits them and retires their restored slots under one lock.
- **A dismiss command**, so one marked row can be removed without clearing
  every other.
- **A context for same-named rows.** A restored row carries only its final
  file name, so two `QC_01.raw` rows from different folders read alike. The
  live roster's collision-only relative context (ADR 0006, amended by M1.4.1)
  is a fragment below the folder the user chose and is never persisted; a
  restored row has no chosen folder. Showing anything more needs an amendment
  of ADR 0006 (open question 7).

### 5. Bounds

- At most 1,024 rows (`MAX_WORKSPACE_DATASETS`, the session's own capacity),
  live and restored together. A save that would record more is refused
  (`tooManyRows`); the stored document stays. Admission counts only live rows,
  so this refusal is reachable once restored rows wait beside a full
  Workbench; the remedy is dismissing marked rows (decision 4).
- At most 1,024 named groups and exactly one Ungrouped; a group name follows the
  Workbench's own rule (not blank as the webview's `trim()` judges it, at most
  120 UTF-16 units).
- A path is absolute, has no NUL and is at most 32,767 UTF-16 units; a path
  that is not Unicode cannot be written as itself, so such a save is refused
  (`notStorable`).
- The document is at most 16 MiB, judged before parsing and read through a
  bounded read. Real documents are far smaller (1,024 ordinary rows are well
  under 1 MiB).

### 6. A corrupt, oversized, unreadable or newer document

Refused whole and **left exactly as found**: nothing is merged, repaired, partly
used, moved or written at start. The session starts empty with restore **off**
and says so (`refused`, with the problem). Off is the fail-closed answer: a
document this build cannot read may be one the user had switched off, and
recording paths again would undo that choice. A restart reads it again and
refuses it again, so it stays off across restarts too.

From there the user decides:

- *Turning restore on* first keeps the refused document aside under
  `workspace-restore.set-aside-<seconds>-<pid>.json` (a hard link, which never
  replaces an existing name), then publishes an empty, enabled document. If it
  cannot be kept aside, nothing replaces it (`storedDocumentKept`). A retry
  after a failed publish reuses the copy already kept. A newer build's document
  therefore survives a downgrade.
- *Off or clear* is the user forgetting: it publishes an empty document over
  the refused one and keeps no copy.

An `unreadable` document may be unreadable only for now (a lock or an I/O
error says nothing about its content), and an `unsafeTarget` (a link, a
directory or a device at the name) is not this application's file to move.
Neither is replaced this session, by any write (`storedDocumentKept`); the next
start reads the name again.

### 7. Privacy

Paths stay local. The document lives in the per-user directory and holds
absolute paths; no transfer object carries one. The webview receives handles,
display names (the final file name), family, checked state and row state. The
stored member's `Debug` output omits its path. The redacted diagnostics export
does not read this document.

Other files in the same directory can also hold paths: a document kept aside
when restore was turned on over a refused one (decision 6, at most one per
session), a private sibling a failed write could not remove (reported as
`temporaryLeftBehind`), and a private sibling
(`.mscanvas-workspace-restore-<pid>-<n>.tmp`) left by a crash or a power loss
during a write, which nothing reports. Off and clear remove none of them.

### 8. The off switch

Restore is on by default. The switch is stored in the document itself
(`enabled`): turning restore off publishes an empty, disabled document, which
forgets every row and path that document stored, and does so even when restore
is already off, so it also forgets a refused document. While off, a save writes
nothing (`off`). Turning it on starts from an empty document; turning on what is
already on writes nothing. `clear_workspace_restore` forgets every stored row
and keeps the switch, except after another window's write, when it writes off
(decision 3). A refused document turns restore off (decision 6).

*Alternatives:* a field in the M7.5 preference record, rejected for now
because that record is closed and its schema is shared with the webview's
preference contract, so the switch would live in one file and the paths it
governs in another; with the fail-closed rule above, a refused document no
longer loses an off choice. Off and clear could also remove the kept-aside
copies and leftover siblings (open question 5); they do not, because removing a
kept copy cannot be undone and a kept copy is what protects a newer build's
document from a downgrade.

### 9. The Tauri boundary

Four commands, each bound to the calling document like the preference
commands, none taking or returning a path:

| Command | Does |
| --- | --- |
| `read_workspace_restore` | The start-up restore: restored rows in their groups, each re-checked now; or `off`, `refused` (restore is off until turned on), `unavailable`. |
| `save_workspace_restore(arrangement)` | Records the session as arranged; refused unless every row is placed once, and refused `changedElsewhere` over another process's write. |
| `clear_workspace_restore` | Forgets every stored row; keeps the switch, or writes off after another process's write. |
| `set_workspace_restore_enabled(enabled)` | The off switch; on is refused `changedElsewhere` over another process's write. |

They are registered ahead of their interface; the command-surface test lists
them in `AHEAD_OF_THEIR_INTERFACE` until a webview caller exists.

## Consequences

- A restart keeps the Workbench's rows, groups, order and checked state, and a
  file that moved or changed is visible as such rather than gone.
- The webview must save after every roster answer and organization change; a
  crash between a change and its save restores the previous arrangement. A
  row removed just before a crash can therefore come back as a restored row,
  never as a deletion.
- Two saves of one process that arrive out of order can leave the older
  arrangement stored until the next save. Saves carry no revision; one can be
  added if that is ever observed.
- With two windows open, the first to write keeps recording and the other is
  refused (`changedElsewhere`) until it restarts; its session is not recorded,
  and it is told so rather than writing over the first. A clear in either
  window after the other one wrote turns restore off for both.
- A document this build cannot use keeps restore off until the user turns it on.
  A user whose document was damaged has to turn restore on again.
- The re-check is one open per member. A recorded path on an offline network
  share waits for the operating system's own timeout; there is no per-row
  timeout.
- The interface slice cannot start before stable per-row slots and the
  put-back and dismiss commands exist (decision 4).

## Open questions for the owner

1. Put matching rows back with one explicit Restore workspace action
   (recommended), or automatically at every start, at the costs listed in
   decision 4?
2. Restore on by default (recommended), or off until the user turns it on? On
   by default records the paths of every acquisition the user adds, which the
   M7.5 preference record deliberately does not.
3. Restore each row's conversion membership (recommended), or start every row
   unchecked as M8.1 and M7.5 do?
4. Keep the off switch in the restore document (recommended), or add it to the
   M7.5 preference record?
5. Should off and clear also remove kept-aside copies and leftover siblings,
   including one a crash left unreported? Recommended: no, as implemented; the
   interface says a kept copy exists when it offers off.
6. With two windows, refuse the later writer (recommended, as implemented), or
   make the application single-instance, or let the last writer win?
7. For same-named restored rows, amend ADR 0006 to show the folders above the
   file, without drive, share or root, bounded from the shallow end and only on
   a collision (recommended), or show only a `restored item N` tie-break as the
   live roster does for rows added directly?
