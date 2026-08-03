# ADR 0008 — Windows Explorer drag-and-drop ingestion

- Status: Accepted for regular mzML files and folders on Windows
- Date: 2026-08-02

## Context

MSCanvas already accepts explicitly selected regular mzML files and discovers
regular mzML files under one explicitly selected local folder. Windows Explorer
drag-and-drop adds a third authority source: one native gesture may supply files,
folders, or both, in an order chosen by the operating system.

That authority must remain in Rust. Native drag events contain filesystem paths,
while the React application is intentionally unable to receive paths or exercise
filesystem authority. A browser file-drop implementation, a frontend event
listener, or a frontend-supplied path would violate that boundary.

The locked runtime also has a version-specific routing detail. The application
uses Tauri 2.11.5 with `tauri-runtime-wry` 2.11.4. Its default main webview is a
`WindowContent` webview. Wry converts drag events from that webview into a
`SynthesizedWindowEvent`, which Tauri exposes as `WindowEvent::DragDrop`.
Registering only `Builder::on_webview_event` would therefore miss Explorer drops
for this application even though that builder API exists.

## Decision

### Native authority

The production adapter registers `Builder::on_window_event` and handles only
`WindowEvent::DragDrop` for the window labelled `main`. This is the exact native
event path delivered by the locked runtime for the main webview. The adapter:

- never formats, logs, serializes, or panics with a native event;
- ignores the native pointer position;
- turns Enter into a path-free top-level item count;
- ignores Over after the initial hover publication;
- turns Leave into a path-free hover reset;
- moves Drop paths directly into the private Rust ingestion boundary; and
- retains a wildcard branch because the event enums are non-exhaustive.

Native drag-drop remains enabled. The implementation does not use HTML5 drop,
`DataTransfer.files`, Tauri's JavaScript event API, an event plugin, a filesystem
scope, or a frontend-supplied path.

The event-loop callback performs only filtering, normalization, operation
reservation, and background-task dispatch. Filesystem classification, traversal,
acceptance, and commit never block the event-loop thread.

### One private ingestion model

The drop path adapts the existing M1.4 model instead of creating a second
registry or acceptance path. It reuses:

- Windows no-follow classification and filesystem identity;
- ADR 0007 folder discovery and containment;
- regular mzML acceptance and identity recheck;
- the workspace registry and collision-only relative context; and
- generation-guarded mutation commit.

A supported top-level root is either a regular file or an ordinary local
directory. Reparse roots, remote roots, inaccessible roots, unsupported object
kinds, virtual shell items, and directory-formatted acquisitions are not opened
as acquisitions. Root failures are aggregate-only and never disclose a root
name. An unsupported regular file may use the existing per-file rejected outcome
and final filename.

### Mixed-root ordering and budgets

Only the first `MAX_DROP_ROOTS = 1_024` roots are considered, in native event
order. At each position:

1. a direct regular file contributes one candidate at that position; or
2. an ordinary directory contributes its candidates in ADR 0007 discovery
   order at that position.

One ledger is shared by the whole drop for entries inspected, directories
entered, and candidates. Direct files consume candidate budget. Each folder
starts its depth calculation at zero, but it does not receive fresh entry,
directory, or candidate budgets. Successful and failed discovery roots both
debit the same batch ledger for work already performed. Windows enumeration or
parse failures therefore report path-free usage for entries already
materialized before the failure; a failing root cannot give the next root a
fresh allowance. Valid candidates already discovered remain available, while
the root error stays aggregate-only and path-free. Reaching any limit makes the
aggregate result incomplete and records only the path-free limit kind.

Identity is observed when a direct file is classified and when a folder
candidate is discovered. Acceptance reopens the candidate without following a
reparse point and compares the identity lease. A mismatch is rejected as
`drop_candidate_changed`; unrelated candidates continue.

### Concurrency and linearization

At most one native drop import is active. Accepting a Drop briefly acquires the
workspace-mutation gate, confirms that no drop is active, advances the checked
workspace generation, allocates a path-free operation ID, captures whether the
workspace is empty, and releases the gate before scanning.

A second Drop while that operation is active publishes a path-free
`drop_busy` rejection. It does not advance generation, inspect or retain its
paths, replace the active operation, or merge into it.

Add-files, add-folder, and reload mutations wait for an active drop to finish.
Remove-selected and Clear-list remain available. They advance generation and
therefore may supersede the active drop. Search, sort, selection, and preview
remain available. Drop ingestion never starts backend preview work itself.

The final commit reacquires the mutation gate and succeeds only if both the
operation ID and captured generation still own the decision. A stale operation
spends no dataset identifier and publishes no misleading completion result.

### Document lifetime

`PageLoadEvent::Started` for `main` is the authoritative document boundary. It:

- advances workspace generation and supersedes old ingestion;
- advances the native event ticket so queued Enter, Leave, and Drop dispatches
  reserved by the old document are stale before they execute;
- clears both the pending subscription reservation and current subscriber;
- clears replay and hover state; and
- prevents an old reservation, queued hover update, or background operation
  from claiming, committing, or publishing into the new document.

Reload does not rely on a roster IPC request for cancellation.

Tauri's main-frame document-created initialization script also gives each
JavaScript realm a fresh 128-bit opaque drop authority. It is neither a secret
nor filesystem authority. The value is non-enumerable, read-only, and sent only
as the private Tauri invoke header for this subscription command; it is not a
Channel field or DTO. A replaced realm therefore retains its old value even if
one of its invokes reaches Rust after the next PageLoad boundary.

### Path-free Channel

M1.5 adds exactly one command:

```text
subscribe_workspace_drop_updates
```

The registered production command count becomes 13. That one command implements
a two-phase, path-free subscription protocol:

```text
Begin -> current-document reservation
Claim { reservationId, channel } -> install subscriber and send current snapshot
```

Begin accepts no Channel. Before either phase, Rust rejects a non-main webview,
validates the bounded authority header, and uses Tauri's
`eval_with_callback` to challenge the currently loaded realm. Only an exact
match proceeds. Rust also captures the native document epoch before that
challenge and rechecks it under the drop-hub lock, closing a navigation between
challenge and commit. Missing, malformed, timed-out, realm-mismatched, or stale
authority fails closed without consuming a valid pending slot.

Within one verified document epoch, repeated unclaimed Begin requests
idempotently reuse one pending reservation. Claim must present the exact
Rust-issued reservation and a nested Channel in Tauri's typed
`JavaScriptChannelId` wire shape; it never accepts an arbitrary callback string.
A wrong, old, or replayed claim fails closed, does not install a Channel, and
does not consume the valid pending slot. Page load clears both slots. Rust
therefore retains at most one pending reservation and one current subscriber. A
successful Claim sends the current snapshot. A send failure does not fail or
roll back ingestion and removes the slot only if the failed Channel is still
current.

Every update has a monotonically increasing sequence number for the current
document. The state union is:

```text
idle
hovering { itemCount }
importing { operationId, itemCount }
completed { operationId, result }
failed { operationId, error }
rejected { reason }
```

The completed result contains the authoritative roster, existing per-file
outcomes, aggregate root/discovery/acceptance counts, completeness, limit kinds,
and a Rust-proven `workspaceWasEmpty` bit. It never contains a source path,
folder name, rejected root name, filesystem identity, native position, raw I/O
error, or traversal counter that is not part of the approved bounded summary.

Rust field spellings use snake_case internally and serialize to the explicitly
tested camelCase TypeScript contract.

### Frontend adoption and interaction

React depends on a small `WorkspaceDropTransport` interface. The production
implementation serializes the complete Begin, Channel construction, and Claim
sequence so a delayed older registration cannot replace a newer subscriber. It
captures the current realm's authority before queued registration work, passes
the same private invoke header to both phases, installs the Channel callback
before Claim, and never imports Tauri's built-in event API. Tests and the
rendered harness provide a fake implementation of the same path-free transport.

Each current-document subscription attempt settles before React reads the
authoritative roster. A successful Claim may deliver its current snapshot first;
a failed attempt still proceeds to the roster read so the workspace does not
remain in a permanent loading state. Retry repeats the subscription attempt and
then reads the roster again.

Sequence checks reject duplicate or stale updates. A completed drop adopts its
roster only if no newer frontend workspace mutation began after importing was
observed. Adoption preserves current query, sort, selection, active preview, and
collision context through the established roster reducer. It prunes selection
against the authoritative roster, unions every newly added handle, and sets both
roving focus and range anchor to the first newly added handle.

The application may auto-preview at most one newly added dataset, and only when
the Rust result proves that the pre-drop workspace was empty, at least one
dataset was added, the backend is usable, and no preview request is already in
flight. Drop ingestion itself never fans out backend work.

An ownerless terminal snapshot is recovery evidence, not proof that this React
document observed the import. It may trigger an authoritative roster read, but
an ownerless completion creates no drop notice and starts no preview; an
ownerless failure remains an operation error. Stale, unmounted, and StrictMode
subscription attempts cannot apply state or adopt a roster.

Hover and importing states use a non-modal visual overlay and a dedicated live
region. Enter and importing do not steal focus, and native Leave or Drop removes
hover hit-testing residue. The overlay never receives or traps focus. If a
keyboard-owned control becomes disabled or is removed by a Drop transition, the
UI records one focus debt. Settlement pays that debt to the durable Add action
only while focus is still on `body` and the user has not selected another real
destination. Pointer activation creates no keyboard debt. A focused keyboard
Dismiss or Retry hands focus to the durable Add action when it unmounts. Clear
remains visible and usable even when an empty workspace is waiting on a drop.

### Privacy and failure semantics

Paths may exist only in native event handling, private classification/discovery,
acceptance, and the private registry. They do not cross IPC, enter React state,
appear in logs, form public `Debug` output, or enter user-visible aggregate
messages.

Top-level failures are counted by bounded classification. Platform-unavailable
and internal coordination failures use typed, path-free reasons. A Channel send
failure affects observation only; it never changes the filesystem or workspace
result.

A subscription failure is presented separately as truthful “Explorer
drag-and-drop is unavailable” status with Retry. It never claims that dropped
items failed. Existing roster state and the Add files/folder pickers remain
usable, and a successful Retry is followed by an authoritative roster read.
Shared entry and directory limit text names the collective whole-drop ledger,
not an individual folder that may never have exceeded a limit by itself.

## Verification boundary

M1.5 is accepted with automated evidence for:

- the production native adapter and main-window filtering;
- real Windows temporary files, directories, hard links, and junctions;
- mixed-root ordering, shared budgets, identity rechecks, and generation races;
- failed-discovery usage debiting the shared batch ledger;
- actual Tauri Channel capture and subscriber replacement/failure behavior;
- old reservation, delayed Begin, wrong/replayed Claim, and PageLoad invalidation
  of queued old native events;
- per-document initialization authority, current-realm challenge, non-main
  rejection, and challenge-to-commit epoch recheck, bounded by locked
  Tauri/Wry source and initialization-order evidence plus deterministic source,
  epoch, and frontend-header tests;
- the production frontend through a fake path-free transport;
- rendered loading, empty, hover, importing, completed, incomplete, rejected,
  connecting, unavailable, Retry, keyboard ownership, focus handoff,
  live-region, and recovery states; and
- source, capability, command-count, dependency, lockfile, and privacy contracts.

Rendered evidence uses an ephemeral loopback-only Vite harness outside the
repository at 900×700, 960×640, 1366×768, and 1920×1080. It imports production
components and styles and is removed after capture.

A physical mouse gesture from Explorer is not required and is not claimed when
it was not performed. The final evidence states separately:

```text
native Explorer event adapter: automated
real filesystem ingestion: automated
path-free Channel bridge: automated
per-document authority challenge: locked-runtime/source and deterministic contract evidence
rendered drop states: automated
physical mouse drag from Explorer: not required / not performed
```

The mock WebView cannot execute `eval_with_callback`; this boundary does not
claim a native runtime execution of the current-realm challenge.

## Consequences

- React gains no filesystem or process authority.
- The workspace has one acceptance model across pickers and Explorer drop.
- The 13-command IPC surface remains narrow and capabilities remain empty.
- Native event delivery is intentionally pinned to the locked Wry
  `WindowContent` behavior; a runtime upgrade must revalidate that routing.
- Directory-formatted acquisitions remain unsupported pending separate evidence.
- A future conversion workflow may reuse accepted dataset handles, but M1.5 does
  not add conversion, persistence, analysis, or a generic plugin ABI.
