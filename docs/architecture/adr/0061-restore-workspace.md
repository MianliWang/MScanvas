# ADR 0061 — Restore workspace

Status: **Proposed** on 2026-10-30. The owner asked for every backend item that
can be done now to start in parallel and for open details to follow the
recommendations; this record states them. The Rust side is implemented on
branch `be/restore-workspace` (`apps/desktop/src-tauri/src/workspace_restore.rs`).
No interface calls it yet. The questions for the owner are listed
[at the end](#open-questions-for-the-owner).
Related: [0006](0006-multi-dataset-workspace-boundary.md) (the workspace
boundary and its *Persistence exclusion*),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md) (capacity
1,024), [0058](0058-user-saved-conversion-presets.md) (the nearest store);
the M7.5 preference store
([M7.5 record](../../ux/M7_5_PREFERENCES_FIRST_RUN_RECOVERY.md));
PRJ-001…PRJ-004 in the [feature catalog](../../product/FEATURE_CATALOG.md);
the [after-beta-1 plan, section 7.6](../../development/AFTER_BETA1_PLAN.md#76-refused-or-not-adopted).

## Context

WSP-010 (P1): "Restores logical state safely and marks missing files rather
than deleting rows silently." Today the workspace is session-only (ADR 0006,
*Persistence exclusion*): closing MSCanvas forgets every row, and that ADR
requires durable storage to arrive with its own schema and decision. This is
that decision.

A project reopen (PRJ-001…PRJ-004) is not this. A project is a document the
user chose and saved; reopening it restores no Workbench row, every reference
starts unchecked, and putting one in the Workbench is an explicit per-reference
action after a matched check that hashes the file. Workspace restore is the
application remembering its own Workbench between launches, with no document
the user manages, and it must be cheap enough to run at every start.

Section 7.6 of the plan keeps automatic adoption, preview, retry and relink
refused. Restore must not become a way around any of them.

## Decisions

### 1. What is restored

The acquisition rows, each with its locator (the canonical path of every
member, primary first), its family and the identity facts admission
established for every member: length, volume serial and the 128-bit file ID.
Also the groups (one level, named, plus Ungrouped), the order of groups and of
rows within them, and each row's checked state.

Never restored: an open preview, a viewed or highlighted row, a selection that
starts work, a conversion queue or its history, an adoption, a group's collapsed
state, search or sort, and a row's provenance (found under a folder, adopted
from a conversion). A restored row is a plain row.

*Recommendation, with the alternative:* the checked state is restored, because
it is the user's own logical arrangement and checking a row starts nothing:
Convert still shows its scope before it runs (WSP-008). The alternative is to
start every row unchecked, as a project reopen does. Collapsed state is not
restored, so a marked row never starts hidden.

### 2. Where it is stored

One document, `workspace-restore.json`, in the per-user application-local data
directory Tauri resolves, the directory the preference store uses. It is never
written next to user data, an acquisition, an output or the executable. It is
versioned (`schemaVersion` 1), closed (`deny_unknown_fields`), bounded (decision
5) and replaced whole through `local_document::publish_through_temporary`: a
private sibling is filled and given the name by handle, so the name always
holds the previous document or the new one. The writer replaces only this
file. A QA build (`e2e` feature) binds no directory at all, so a rendered
campaign never reads or writes the real profile's workspace.

### 3. When it is written

When the webview commits an arrangement (`save_workspace_restore`), which the
interface does after each roster answer and each organization change. Rust
composes the document from its own registry (locators and identity facts
never come from the webview, which has no paths) and from its own restored
rows (decision 4); the webview contributes only the groups, the order and the
checked handles. An arrangement must place every live and every restored row
exactly once, or the save is refused (`staleArrangement`,
`invalidArrangement`) and the stored document stays as it was. No save can
drop a row.

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

- `matching`: the same object at the same length. This is not a content claim;
  admission and the ordinary revalidation decide that when the row is used.
- `changed`: another object at the path, or the same object at another length.
- `missing`: nothing at the recorded path.
- `unreadable`: there, and its identity could not be established.
- `unsafe`: a link, a directory or a device.

A changed or missing file stays a marked row: it is never dropped, never
relinked, and its recorded facts are never replaced by what is there now.

*Recommendation for the interface slice:* matching rows are put back in the
Workbench at start through ordinary admission (`add_files`, the same rule,
duplicate check and capacity as Add files), in their restored groups and
checked state; nothing is previewed and no conversion starts. Marked rows are
shown in place with their state and a Remove action. Putting a marked row back
is the user adding the file again. This is not adoption in the sense of
[ADR 0016](0016-explicit-converted-output-adoption.md), which takes a
conversion's outputs into the Workbench and stays explicit: a restored row is
only ever the file the user had already added, at the path it had.
*Alternative:* one explicit "Restore workspace" action for the matching rows.

### 5. Bounds

- At most 1,024 rows (`MAX_WORKSPACE_DATASETS`, the session's own capacity).
  A save that would record more is refused (`tooManyRows`); the stored document
  stays.
- At most 1,024 named groups and exactly one Ungrouped; a group name follows the
  Workbench's own rule (not blank, at most 120 UTF-16 units).
- A path is absolute, has no NUL and is at most 32,767 UTF-16 units; a path
  that is not Unicode cannot be written as itself, so such a save is refused
  (`notStorable`).
- The document is at most 16 MiB, judged before parsing and read through a
  bounded read. Real documents are far smaller (1,024 ordinary rows are well
  under 1 MiB).

### 6. A corrupt, oversized or newer document

Refused whole. A document that is malformed, oversized, unreadable, of an
unsupported version, or from a newer build is kept aside under
`workspace-restore.set-aside-<seconds>-<pid>.json` (a hard link, which never
replaces an existing name), taken off the published name, and the session
starts empty and says so (`refused`, with `setAside`). Nothing is merged,
repaired or partly used. A name that is a link, a directory or a device is not
moved; it is left where it is, and nothing is written over it this session
(`storedDocumentKept`). A refused document that could not be kept aside is
treated the same way.

### 7. Privacy

Paths stay local. The document lives in the per-user directory and holds
absolute paths; no transfer object carries one. The webview receives handles,
display names (the final file name), family, checked state and row state. The
stored member's `Debug` output omits its path. The redacted diagnostics export
does not read this document.

### 8. The off switch

Restore is on by default. The switch is stored in the document itself
(`enabled`): turning restore off publishes an empty, disabled document, which
forgets every stored row and path; while off, a save writes nothing (`off`);
turning it on starts from an empty document. `clear_workspace_restore` forgets
every stored row and keeps the switch.

*Alternative:* a field in the M7.5 preference record. Rejected for now because
that record is closed and its schema is shared with the webview's preference
contract; the switch would then live in one file and the paths it governs in
another.

### 9. The Tauri boundary

Four commands, each bound to the calling document like the preference
commands, none taking or returning a path:

| Command | Does |
| --- | --- |
| `read_workspace_restore` | The start-up restore: restored rows in their groups, each re-checked now; or `off`, `refused`, `unavailable`. |
| `save_workspace_restore(arrangement)` | Records the session as arranged; refused unless every row is placed once. |
| `clear_workspace_restore` | Forgets every stored row; keeps the switch. |
| `set_workspace_restore_enabled(enabled)` | The off switch. |

They are registered ahead of their interface; the command-surface test lists
them in `AHEAD_OF_THEIR_INTERFACE` until a webview caller exists.

## Consequences

- A restart keeps the Workbench's rows, groups, order and checked state, and a
  file that moved or changed is visible as such rather than gone.
- The webview must save after every roster answer and organization change; a
  crash between a change and its save restores the previous arrangement. A
  row removed just before a crash can therefore come back as a restored row,
  never as a deletion.
- Two saves that arrive out of order can leave the older arrangement stored
  until the next save. Saves carry no revision; one can be added if that is
  ever observed.
- The re-check is one open per member. A recorded path on an offline network
  share waits for the operating system's own timeout; there is no per-row
  timeout.
- Restored rows are numbered by position (`restored-N`) and only ever forgotten
  together. Putting one back or removing one (the interface slice) needs stable
  per-row slots.

## Open questions for the owner

1. Put matching rows back automatically at start (recommended) or behind one
   explicit Restore action?
2. Restore on by default (recommended) or off until the user turns it on?
3. Restore the checked state (recommended) or start every row unchecked, as a
   project reopen does?
4. Keep the off switch in the restore document (recommended) or add it to the
   M7.5 preference record?
