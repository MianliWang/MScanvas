# ADR 0007 — Logical acquisition discovery and folder traversal

- Status: Accepted for the private mzML folder-discovery foundation (M1.4.0) and
  for the visible `Add mzML folder…` workflow over it (M1.4.1);
  directory-formatted acquisitions remain separately gated
- Date: 2026-07-31
- Amended: 2026-08-01 (M1.4.1) — both folder choices use the Windows Common
  Item Dialog; the Rust-only path and cancellation boundaries are unchanged.
- Amended: 2026-08-02 (M1.4.1) — folder ingestion uses a path-free two-command
  begin/claim protocol, and native main-webview page-load start rather than a
  roster IPC request is the authoritative reload linearisation point.

## Context

The feature catalogue asks for folder ingestion — "discover logical acquisition
roots without descending inside recognized directory datasets" — while ADR 0006
says the registry accepts mzML regular files and that "no type in it may name a
vendor format or a directory acquisition, including as an unconstructed enum
variant". Both cannot be satisfied at once: recognising a directory acquisition
in order to stop at it is exactly the claim ADR 0006 refuses to let a type make
without evidence.

This ADR reconciles them by narrowing what M1.4 claims rather than by widening
what the registry believes. It also settles the part of folder ingestion that
has nothing to do with formats and everything to do with authority: a folder is
a boundary the user drew, and a traversal that leaves it has read data nobody
authorised.

Two facts drove the decisions below, and both were measured rather than assumed.
A directory junction can be created on Windows by an ordinary user with no
elevation. And a path that traverses one still begins with the chosen root, so a
canonical-path prefix test answers "inside" for a file that is not.

## Scope

M1.4.0 discovers regular `.mzML` files under one explicitly chosen local Windows
folder. It adds no command, no transfer object, no picker and no interface: the
engine is private to the preview module and nothing in the product can reach it.

M1.4.1 makes exactly that engine reachable, and nothing else: one native folder
picker, two narrow commands, a path-free reservation transfer followed by the
ingestion result, and one visible action. The traversal is unchanged — the same
budgets, the same ordering, the same refusal of every reparse entry — and what
M1.4.1 adds is the commit around it: whose decision the scan is still answering,
and what a candidate has to prove at acceptance.

Out of scope here, each for its own reason: vendor formats and
directory-formatted acquisitions (no evidence), Explorer drag-and-drop (a
different authority boundary), persistence (ADR 0006 excludes it), and any
backend work at all (discovery never asks ProteoWizard anything, and neither
does ingestion — a folder of a thousand files costs a thousand filesystem
inspections and no processes).

## Definition of a logical acquisition root

For M1.4.0 a supported logical acquisition root is still one regular mzML file.
A folder is a container of candidate roots; it is not itself an acquisition.

Discovery classifies what it meets — a supported file, an ordinary file, a
traversable directory, a reparse entry, an inaccessible entry — and that
classification is private to the traversal. It never enters the registry, never
becomes a dataset kind and is never serialised. The registry after this slice
accepts exactly what it accepted before.

## Directory acquisitions

Recognise none.

Suffix-only recognition is rejected outright, and not as a matter of taste. A
false positive skips an ordinary folder and hides every mzML file inside it; a
false negative descends into an acquisition and offers its internal files as
independent datasets. Both are silent, and both are scientific errors rather
than interface ones.

Before any family may be recognised, this repository requires: a representative
directory structure; a lawful source for it; whether the root is a directory on
Windows at all; marker evidence beyond the suffix; case behaviour; nested
behaviour; whether the same suffix can name an ordinary directory; whether
ProteoWizard accepts the root directly; whether preview and conversion support
it; how a directory's filesystem identity is captured; how an identity lease
would work on one; how change detection would work; and what a roster row's kind
and readiness could then truthfully say. The M0 spike recorded vendor RAW
coverage as not run, so none of this is available today.

## Root authority and containment

The chosen folder is an authority boundary. The user chose one root, not every
place a junction can point.

- A root that is itself a reparse point is refused before anything is
  enumerated.
- A root on a remote or mapped network drive is refused, because identity,
  leases and consistency on one are unverified here. Refused twice: once from
  the path, which catches every UNC, verbatim and device spelling before a
  network round trip is made, and once from the opened handle, which catches
  what the path cannot show -- an ordinary-looking local path that reaches a
  share through a linked directory somewhere along the way, or a relative path
  resolved against a mapped drive. The handle is asked with
  `FileRemoteProtocolInfo`, which Windows answers only for an object actually
  reached over a remote protocol — so the finding is that the call succeeds at
  all, and nothing reads its buffer. The declared length is then the whole
  check, because Windows validates it before it consults the object: a buffer
  one byte short is refused for its length on local and remote alike, and a
  check reading "did it answer" says "local" about everything. That failure is
  tested for directly, by telling the two refusal reasons apart on an ordinary
  local directory. Two further tests make the claims that one cannot: that a
  genuinely remote object answers, and that opening a root is what asks. Both
  need the local administrative share, which the SMB redirector serves as a
  remote object, and both are marked ignored rather than skipped silently,
  because a machine without the share must be told the claim went unchecked
  instead of shown a green run.
- A child entry carrying `FILE_ATTRIBUTE_REPARSE_POINT` is not followed, not
  descended into, not offered as a candidate, and counted.
- No link target is resolved at any point.

Containment is established by refusing reparse entries on the way down, not by
comparing canonical paths. A canonical-path prefix test is not containment
evidence: measured on this machine, a naive walk reached a file physically
outside the chosen folder through an unelevated junction while the path string
still began with that folder.

## Reparse points, links and junctions

Every reparse tag is unsupported in this slice. That deliberately includes cloud
placeholders and WOF- or deduplication-backed files, which are ordinary readable
regular files carrying the same attribute. No tag allowlist is introduced here,
because reading a tag correctly is its own evidence question and getting it
wrong silently admits a link.

The cost is real and must not be hidden: a folder synchronised by a cloud client
may yield few candidates or none. A discovery that skipped reparse entries is
therefore incomplete by construction, the count is kept, and the visible slice
must say the scan was incomplete rather than report an empty folder.

## Traversal order

Depth-first, with the files of a level before that level's subdirectories, each
group ordered by the UTF-16 code-unit ordinal of the entry name. The root is
depth 0.

The name alone is the whole key, and no tie-break follows it, because within one
directory no tie can occur: Windows will not hold two entries whose names differ
only in case, let alone two identical ones. A second key would be unreachable
code dressed up as a guarantee.

The ordering is deliberately ordinal rather than locale-aware, for the same
reason M1.3 compares search text with a locale-independent lower-casing: which
files a user gets, and in what order, must not depend on where the machine
thinks it is. It is not Explorer's order and does not try to be; it is a stable
application contract, and repeated scans of an unchanged tree return the same
sequence.

Filesystem enumeration order is not a contract and is not used. Measured on
NTFS, a directory whose entries were created in one order enumerated in another,
and the result was neither sorted nor ordinal.

This order becomes the candidate order the future folder batch presents to
acceptance, and therefore the registry insertion order of the rows it adds. The
sorting key never crosses the boundary.

## Traversal budgets

The workspace capacity of 1,024 datasets is not a traversal budget: a folder can
hold millions of entries before the thousandth candidate is found.

```text
MAX_DISCOVERY_DEPTH       = 32
MAX_DISCOVERY_ENTRIES     = 200_000
MAX_DISCOVERY_DIRECTORIES = 20_000
MAX_DISCOVERY_CANDIDATES  = 1_024
```

The root counts as one entered directory. Every immediate child an enumeration
returns counts as one inspected entry, counted before it is classified. A
candidate counts once its classification is complete.

Two of the four do not stop the scan. Reaching the depth limit skips the
subtree that would sit past it and lets eligible siblings continue. Reaching the
directory limit stops directories being *entered*, while the ones already
entered are still walked -- they were counted against this very budget, and
discarding their work would spend the allowance on nothing. Exhausting entries
or candidates ends the remaining traversal, because past either point nothing
further could be inspected or kept.

The entry limit is a bound on what a scan costs and not only on what it counts.
The walk asks its source for no more entries than it can still afford, one over
so that it can tell a directory that ended from one that was cut short, and the
source is required to stop there. A budget consulted only after a directory had
been read whole would leave the largest dimension of the walk unbounded at
precisely the moment it is most expensive.

Reaching any limit makes the result incomplete and is recorded as the specific
reason rather than a single boolean. It is not an error: the candidates already
found are kept and remain valid, because nothing has been accepted, leased or
given an identifier yet.

`MAX_DISCOVERY_DETAILS = 3` bounds how many per-item details the visible slice
will show, matching the existing notice cap. It belongs to M1.4.1.

## Hidden, system and inaccessible entries

An ordinary entry is never skipped for being hidden, carrying the System
attribute, beginning with a dot, or resembling a familiar cache or repository
name. The user chose this root explicitly, and skipping by name or by ordinary
attribute would silently omit data that may be exactly what they came for. The
budgets, not a name allowlist, are what bound the cost.

Posture, accessibility, reparse status, extension and the named limits are the
only things that decide traversal.

An inaccessible child or subtree is counted and traversal continues; one
unreadable folder does not discard everything else found. An inaccessible root
is a discovery error, because there is nothing to have found. No path appears in
either.

## Candidate acceptance

Discovery proposes paths. It does not accept them.

The future acceptance phase calls the existing complete `accept_mzml_file`,
unchanged, once per candidate in discovery order. Discovery must not duplicate
canonical acceptance, identity leasing, duplicate detection or capacity
decisions, and it holds no lease of its own. It does hold a handle on every
directory it has entered but not yet walked, because a child is opened -- and
its identity checked -- while its parent is still the object being described.
That is bounded by the directory budget rather than by the shape of the tree,
and the handles are opened for full sharing, so holding one prevents nobody from
renaming or deleting anything.

The extension test discovery uses is the same predicate acceptance uses,
extracted rather than reimplemented, so the two can never drift. It is only a
proposal; acceptance remains authoritative and re-decides everything.

Acceptance keeps its existing two-resolution shape — a no-follow handle
establishes posture, length, identity and the lease, and a second resolution
supplies the canonical path, the extension verdict and the display name. This
ADR does not change that and does not claim the window between them is closed.

**Identity recheck (M1.4.1).** A candidate carries the `FileIdentity` its parent
directory reported in the same enumeration record as its name, and ingestion
compares that against the identity acceptance resolves. A mismatch is refused
with `folder_candidate_changed` and the rest of the batch continues. This is what
carries the walk's containment proof across to the object being registered:
containment was established for the object discovery found, and between the walk
and acceptance a name can be made to mean a different file — one outside the
chosen folder, in the case worth worrying about. The refusal has a kind of its
own rather than reusing an acceptance failure, because the path resolved and the
file opened; it simply is not the file that was found.

This does not close the residual window the Consequences section records. It
converts it from "a file outside the folder can be registered" into "a file that
changed identity is refused", which is the strongest statement the documented
APIs support.

## Duplicate identity

Unchanged. Duplicates are decided by filesystem identity at acceptance, before
capacity, and no identifier is consumed by a duplicate, a rejection or a full
workspace. Discovery may propose the same file twice only if the filesystem
presents it twice under different names; acceptance answers that as it already
does.

## Same-name display and path privacy

Recursive discovery can find `A\sample.mzML` and `B\sample.mzML`. Both are
different acquisitions and both would render as `sample.mzML`, which is not
enough to choose between them.

The rule is collision-only, chosen-root-relative context: the relative location
is shown only for rows whose final filename collides with another row's. It is
based only on the folder the user chose, never contains a drive, a UNC root or
the chosen root's own name, never contains `..`, is bounded, and is not
persisted.

M1.4.0 retained the relative components privately so that rule remained
possible. M1.4.1 implements it and amends ADR 0006's path-privacy section
deliberately, as that section now records.

What M1.4.1 settled beyond the rule itself:

- The context is **derived over the whole live roster every time one is built**,
  not stored when a row arrives. Whether a name is ambiguous is a property of
  the list, and it changes as rows arrive and leave: adding a second
  `sample.mzML` gives both of them context, and removing one takes it away from
  the survivor. Deciding it at insertion would freeze an answer to a question
  that keeps being asked.
- A row's origin is private and is **not part of its identity**. Two names for
  one acquisition are one row whichever route each name arrived by, and a
  duplicate addition never rewrites where the existing row says it came from.
- A directly picked file says `Added directly` rather than a location. It has no
  place under a chosen folder to describe, and inventing one — `Top level`, say
  — would put it in a tree the user never named.
- Two rows that would say the same words (two folders each with a `data`
  subdirectory; two files picked from different folders) are told apart by
  appending the session's own identifier: `workspace item N`. That identifier is
  already the handle the webview holds, so it reveals nothing a caller does not
  have, and it is stable for as long as the row is.
- Bounded at 128 characters, truncated **from the shallow end** with a leading
  ellipsis. The deepest component is the one nearest the file and the one that
  actually disambiguates; truncating from the end would drop exactly that.
- Uniqueness is decided on the **bounded visible strings**, not on the raw
  descriptions. Two locations that differ only near the root are distinct
  descriptions and truncate onto one visible string, so a group checked before
  bounding looks settled, gains no tie-break, and renders one filename beside
  one identical context twice — which is the ambiguity the whole rule exists to
  remove. When a bounded string is shared, the tie-break is added and the base
  is re-bounded with the tie-break's own room kept back, so the half that
  actually tells the rows apart is the half that survives.
- Display only. It is never searched, never a sort key, never part of identity,
  and its `title` says exactly what the row already shows.

## Partial success and outcomes

The visible slice reports per-item outcomes for files only — added, duplicate,
rejected — reusing the shapes the file picker already produces. Directory-level
events are aggregate counts, because a per-item directory outcome is a per-item
directory name.

One inaccessible subdirectory does not roll back unrelated additions. A root
that cannot be inspected is a command-level failure that leaves the roster
untouched. A truncated scan is never described as complete, and a scan that
completed and found nothing is not described as a failure.

The summary that crosses the boundary is deliberately narrower than the private
one. It carries `complete`, the skipped-reparse count, the inaccessible-entry
count and which named limits were reached. It does **not** carry how many entries
were inspected or how many directories were entered: those describe the shape of
the user's tree, and pointing at a folder is not permission to report it.

`complete` is one field rather than three so that a caller cannot report a
partial scan as a whole one by checking the wrong thing. It is false whenever a
limit was reached, a linked entry was skipped, or a subtree could not be read.

The two sentences a partial scan must never merge are "no mzML files were found
in that folder" and "no files were added, and the scan was incomplete". The
first is a claim about the folder's contents and only a complete scan may make
it.

## Mutation concurrency

Implemented in M1.4.1 as recorded: the scan runs outside the workspace mutation
gate and the batch commits only while the generation created by its accepted
claim remains current. Otherwise the chooser returns typed
`import_superseded`, accepts nothing, leases nothing and spends no dataset
identifier.

**Begin records a baseline; exact claim creates the generation.** The
synchronous `begin_mzml_folder_import` command takes the mutation gate, records
the current generation as a baseline in one bounded pending `Option`, and
returns a session-scoped, path-free correlation ID. The ID is opaque but not a
secret: it conveys no path, filesystem authority, generation or internal token.
A second begin at the same generation is idempotent and returns the same ID. A
begin after another workspace decision replaces only the stale pending slot.
It never advances the generation itself.

The asynchronous `choose_mzml_folder(reservationId)` command claims before it
dispatches the native picker. Under the same gate it requires the exact live ID,
consumes it, checks that its baseline is still current, then atomically advances
the generation and creates the opaque, unclonable Rust-only
`FolderImportToken`. An exact stale claim is consumed and returns
`import_superseded`; an unknown, replaced or replayed ID returns
`invalid_folder_import_reservation` without consuming the live slot. The token
crosses neither IPC direction and is spent by at most one import. Cancellation
or a dialog failure drops the claimed token but does not roll its generation
back; generations are ordering facts and are never given back.

This split lets `Clear list` and `Remove selected` wait only until Rust has
stored the baseline. If either mutation reaches the gate before exact claim,
the baseline becomes stale and no picker opens. If claim reaches the gate first,
the mutation advances beyond the token and the later commit is refused. The
same gate makes both orders linear without holding it across either the modal
dialog or the recursive scan.

**Navigation, not roster IPC arrival, owns reload ordering.** Tauri's native
main-webview `PageLoadEvent::Started` hook advances the generation before the
replacement document can issue commands. Work claimed by the previous document
is therefore stale even when its async command is polled later. The protocol
does not assume FIFO fetch delivery: a delayed old begin cannot advance the
generation, replaces no live same-generation reservation, and cannot supersede
an already claimed import. A delayed old roster request is a pure snapshot and
has no mutation side effect.

`get_workspace_roster` still takes the mutation gate, so its stored-fact
snapshot is wholly before or wholly after a batch rather than partway through
one. It does not advance the generation. The window still waits for its
mount-time roster response before enabling `Add mzML folder…`, not because the
read owns reload ordering, but because this document must adopt an authoritative
list before importing into it. A failed read keeps folder ingestion unavailable
until the roster's own retry succeeds. Adding files has no unlocked scan window:
it is one gated batch.

What advances the generation is adding files, removing rows, emptying the list,
a successful exact folder claim, and native main-webview page-load start.
Reading a roster or preview, inspecting the backend and counting rows do not, so
a long scan cannot fail merely because an independently scheduled read arrived.

Holding the gate across a recursive scan is rejected. `Clear list` and
`Remove selected` queue on that same gate, so holding it for the walk would take
away both the reliable final-empty escape and ordinary management of the rows
already on screen — the exact condition this repository already refuses for
backend reads. Scanning outside the gate without a generation is rejected too:
a scan that began before a `Clear list` would otherwise repopulate the workspace
the user just emptied.

## Cancellation and progress

As recorded: no cancellation task model, no percentage, and a visible status
while an import is outstanding, with a permanently mounted live region carrying
the same claim. The budgets are what bound the worst case. A percentage without
a known total is a number the application would be inventing, and a
task/cancellation protocol overlaps the future conversion queue and needs its
own decision.

**The status names both phases rather than guessing which is running.** The
operation begins when the action is pressed, which is before the native dialog
opens — and at that moment no folder has been chosen. `Scanning folder…` was
therefore false for as long as the user spent navigating the dialog, and false
altogether if they cancelled. Telling the two phases apart would need the picker
to report closing, which is exactly the event protocol this section declines to
add; saying something true of both needs nothing:

```text
Folder import in progress. MSCanvas is waiting for a folder selection or
scanning the chosen folder. The duration is not known.
```

The action keeps one accessible name, `Add mzML folder…`, throughout. An
action's name is how a user finds it again, and a control that renames itself
mid-operation is a second control as far as assistive technology is concerned.
It carries `aria-busy` instead, as does the roster region the import is about to
change.

Because there is no cancellation, the scan deliberately does **not** make the
session unusable while it runs. Searching, sorting, selecting and reading a file
already in the workspace all stay live.

**`Remove selected` and `Clear list` stay live too, but make different
promises.** When `Clear list` succeeds, it is the reliable way out of a folder
chosen by mistake. If it reaches the gate before claim, the baseline becomes
stale and the picker does not open; if it follows claim but precedes commit, the
token becomes stale; if the import commits first, the clear removes every row it
added. When the command succeeds, the final workspace is empty in every
linearisation. `Remove selected` remains live so the user can manage rows
already on screen. The same pre-claim and pre-commit rules supersede the import,
but if the import commits first the removal acts only on the handles it was
given, so its authoritative roster can retain newly imported rows. It is row
management, not a cancellation guarantee.

What still waits is acquiring more — `Add files…` and a second
`Add mzML folder…` — because two batches in flight let an older reply's roster
overwrite a newer one's. Explicitly reading the list back waits as well, even
though it is now a pure, gate-linearised snapshot: during a scan it would add an
unnecessary loading state and a projection whose usefulness depends on whether
the scan committed before or after it. The folder result or an owed
reconciliation already supplies the authoritative way out. Three different
concurrency contracts, and therefore three answers rather than one flag.

One consequence belongs to the interface rather than to Rust. Rust settles which
of the two came first, but their *replies* need not arrive in that order, so a
folder reply landing after a mutation would install a list from before it. An
import that had a mutation begin after it therefore installs no roster at all,
whichever way Rust ordered them.

It says nothing either, and that is deliberate rather than an omission. The
later action is already the user's newer intent, so exposing the folder roster
while that action is unresolved would transiently put rows back and, over an
empty workspace, could launch a preview the user did not ask for. A successful
action supplies the authoritative roster that accounts for whichever operation
won the gate. A rejected action does not prove that Rust was unchanged, so the
folder reply remains suppressed and the webview reads the authoritative roster
after both operations settle. Any older roster reply is invalidated in the
frontend when the action begins, and any preview whose row is absent from the
reconciled roster is removed with it. The action's typed error stays visible.
When this window made the later mutation, both `import_superseded` and the
claim-stage `invalid_folder_import_reservation` caused by a delayed old begin
settle silently; an independent picker or discovery failure remains visible.

Two consequences are about the keyboard, both in the issue #25 class reached by
keeping `Clear list` live during an import.

Emptying the list during an import sends the keyboard back to `Add files…`,
which is disabled until that import settles — and focusing a disabled control
does nothing. The debt is held and paid on the commit that makes the control
usable, rather than leaving a keyboard user on `body` with no way back into the
workspace.

And `Clear list` itself can go out from under the keyboard. Over an empty list it
is offered only while an import is unresolved, because only then does it have
anything to do; during a first import from an empty workspace it is also the
only enabled control in the actions row, so it is exactly where a keyboard user
lands. Every way that import can settle with nothing added — a folder holding no
mzML, a failed scan, a superseded import, a dismissed picker — takes it away
again. Removing a focused element moves focus to the body, and WebView2 can
first report a `focusout` whose `relatedTarget` is null. That does not identify a
user-chosen destination, so it preserves the record that mints the same debt,
paid by the same rule. A real non-null destination clears the record instead.

## Tauri boundary

M1.4.0 adds no command. The engine is private to `preview::discovery`, mounted
privately, and reachable only from within that module.

M1.4.1 adds exactly two commands, bringing the registered surface to twelve.
Synchronous `begin_mzml_folder_import` records or reuses one current-generation
baseline and returns its path-free reservation DTO. Asynchronous
`choose_mzml_folder(reservationId)` consumes and validates that exact ID before
showing the native picker on the main thread, then answers with a roster, one
outcome per candidate and the scan summary — or `None` for a dismissed picker,
which is an ordinary outcome and deliberately not an empty result. The webview
supplies and receives no path or parent. The only additional value exchanged
with it is a session-scoped, opaque-but-not-secret, single-use reservation
correlation ID. Its monotonic
spelling may expose issuance order, but it is not used as the workspace ordering
authority; that remains the private generation. It grants no filesystem
capability, and the main window's Tauri capability set stays empty.

Both folder choices use the Rust-owned Windows Common Item Dialog through
`IFileDialog` with `FOS_PICKFOLDERS`. This is the Explorer-style folder surface,
so an absolute path can be pasted into its address bar without walking a legacy
tree. The dialog is owned by the main window, requires one existing filesystem
folder, leaves shell links unresolved and does not add the choice to Recent.
The selected path still exists only inside Rust: the correlation DTO carries
none of it, grants no webview capability, and cancellation remains `None`.

Every discovery refusal maps to a stable visible kind, one arm per kind and no
default, so a new traversal refusal fails to compile rather than arriving as one
of the old ones:

| Traversal refusal | Visible kind |
| --- | --- |
| `PlatformUnavailable` | `folder_discovery_unavailable` |
| `RootUnavailable` | `folder_not_readable` |
| `RootNotDirectory` | `folder_not_directory` |
| `RootReparsePoint` | `folder_link_unsupported` |
| `RemoteRootUnsupported` | `network_folder_unsupported` |
| `RootEnumerationFailed` | `folder_scan_unreadable` |
| `FilesystemInvariantFailed` | `folder_scan_failed` |

Three more kinds belong to the reservation/commit boundary rather than to the
walk: `folder_candidate_changed` for a candidate whose object changed,
`import_superseded` for a claim or scan the workspace moved past, and
`invalid_folder_import_reservation` for an unknown, replaced or replayed
correlation ID. None of them carries a path, a root name or an operating-system
message.

## Platform posture

Windows only. The traversal policy, its ordering, its budgets and its error
model are platform-independent and tested on any host through a fake adapter;
the filesystem adapter that reads real directories is `#[cfg(windows)]`, and on
other platforms the entry point compiles and returns a typed
platform-unavailable error.

This follows the identity lease decision in ADR 0006, which is Windows-only for
the same reason: the guarantee needs a no-following open that this project has
no dependency-free way to make elsewhere. No cross-platform traversal safety is
claimed without CI and evidence.

## Core artifact taxonomy

`crates/core::ArtifactKind::Acquisition` exists and the artifact model describes
it as a vendor RAW or directory dataset. It is a future artifact-domain
taxonomy. It is not a preview-registry dataset kind, not a directory-acquisition
recogniser and not evidence that any format is supported; the desktop
application imports only `BootstrapStatus` from that crate, and the registry
does not use it. It is untouched by this slice.

## Testing obligations

- Traversal policy is tested through a fake adapter, so ordering, budgets,
  cycles, malformed records and adapter failures are deterministic.
- A real Windows filesystem test creates a junction pointing outside the chosen
  root, places an mzML file behind it, and requires that the file is not
  returned and the junction is counted as skipped. It fails loudly if the
  junction cannot be created rather than skipping the claim.
- A junction used as the chosen root is refused.
- Every budget is tested one under, exactly at, and one past its limit, and the
  entry budget is additionally tested for what it is asked to spend rather than
  only for what it counts.
- Repeated scans of an unchanged tree return the same order, and a fake adapter
  returning its entries in different orders produces the same result.
- Formatting a candidate, a result, an entry or an error contains no drive, root
  name, child name, relative path or identity.
- A tree deeper than the configured budget neither overflows the stack nor stops
  its shallower siblings.

Added for M1.4.1, all of them deterministic and none of them timed:

- A candidate whose object is replaced between the walk and acceptance is
  refused with its own kind, and the rest of the batch still arrives.
- A scan that spans an emptying or removal of the list commits nothing, holds no
  lease and answers `import_superseded`; a scan that spans a pure roster
  snapshot still commits. The interleaving is driven by channels around a
  controlled walk rather than by sleeping.
- Native page-load start supersedes a claim owned by the previous document,
  while a delayed roster request from that document has no side effect.
- Folder reservations are exact and single-use; wrong and replayed IDs do not
  consume the live slot; same-generation begin is idempotent; stale begin state
  is replaced in one bounded `Option`; and delayed old begins before or after a
  new claim cannot cancel the new import.
- Both reload/commit orderings: a commit before page-load start is visible to
  the replacement snapshot, and page-load start before commit supersedes the
  old token.
- Collision context appears only for exact filename collisions, distinguishes a
  directly added row from a discovered one, falls back to the session
  identifier when two rows would say the same words, disappears when the row
  that made it necessary goes, and is truncated from the shallow end.
- An outcome's dataset is byte-for-byte the roster's copy of that dataset, which
  is what pins describing outcomes after the whole batch.
- Every discovery refusal maps to a kind of its own, asked through the boundary.
- A real junction under a real chosen folder yields no candidate from the other
  side, is counted, and makes the scan incomplete.
- Nothing a folder import transfers contains the chosen root's name, a drive, a
  separator, an identity, or either private counter.
- The command list is exactly twelve, in order, and the capability set is empty.

## Consequences

Folder discovery becomes possible without any of it being reachable, which is
the point: the traversal boundary is settled and tested before a button depends
on it. The cost is that M1.4.0 delivers nothing a user can see, and the feature
catalogue said so until M1.4.1 made it visible.

If a later workspace action reaches the mutation gate before claim, no picker
opens; if it follows claim but precedes commit, the scan is superseded, adds
nothing and says so. If the scan commits first, the later action's roster is
authoritative: a clear still leaves nothing, while a removal can retain imported
rows it was never asked to remove. The webview never applies an older folder
reply over that later roster or while that action is unresolved.
If the action rejects, a fresh roster read after both operations settle
reconciles the webview without assuming where the failure occurred. This
preserves the state Rust actually linearised without letting reply order rewrite
it.

A folder full of cloud placeholders yields little or nothing until a tag
decision is made. That is visible and counted rather than silent, and it is the
honest consequence of refusing every reparse tag rather than guessing at one.

The order a folder adds rows in is this ADR's order, not Explorer's, and users
who expect Explorer's will see a difference.

One consequence is worth stating on its own, because it is an obligation on the
next slice rather than a property of this one. Containment is proved for the
walk: every ancestor of a candidate was opened as a link-refusing handle and
identity-matched, so a file outside the chosen folder cannot become a candidate.
What leaves the walk is a path. If a verified subdirectory is replaced by a
junction after the walk ends, that path resolves through it, and acceptance
opens no-follow only on the final component. So a candidate is evidence that a
file was inside the chosen folder when it was found, and is not evidence that it
still is. The batch that consumes candidates must treat each one as a proposal
that acceptance re-decides, and must not report "discovery returned it" as
proof of where it lives.

## Rejected alternatives

- **Canonical path prefix comparison as containment.** It passes for a path
  that traverses a junction, which was measured rather than reasoned about, and
  it adds a second racy name lookup to prove something a posture check already
  proves.
- **Recursive `read_dir` without identity verification.** It follows junctions
  by default, has no cycle bound, and re-resolves the whole path at every level.
- **Undocumented `NtCreateFile` with a root directory handle.** It would close
  the residual name-replacement window, and it is not a documented API this
  project is willing to depend on.
- **A tag allowlist admitting cloud placeholders now.** Reading reparse tags
  correctly is its own evidence question, and being wrong admits a link.
- **Skipping dot-prefixed or hidden directories.** It is a guess about what the
  user meant that silently omits data they explicitly pointed at.
- **Suffix-based directory-acquisition recognition.** A false positive hides
  every file inside an ordinary folder.
- **Holding the workspace mutation gate across a scan.** It blocks the reliable
  final-empty escape and management of the rows already on screen.
- **Recursion through the call stack.** A deep or adversarial tree decides how
  much stack the application uses.
- **A `truncated: bool`.** Which limit stopped a scan is what tells a user
  whether to narrow the folder or raise nothing at all.

## Follow-up slices

- **M1.4.1 — done.** The visible `Add mzML folder…` workflow, Explorer-style
  picker, two-command reservation handshake, result transfer and interface all
  passed final rendered Windows QA at the reviewed exact head.
- **M1.5 — not started.** Explorer drag-and-drop over this same discovery
  boundary.
- **Later** — evidence-backed directory-acquisition families, behind the gate
  recorded above.
