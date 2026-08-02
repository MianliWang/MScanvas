# ADR 0006 — Multi-dataset workspace boundary

- Status: Accepted for the M1 workspace foundation, its first interface, the
  view projection over it and folder ingestion; drag-and-drop separately gated
- Date: 2026-07-30
- Amended: 2026-07-30 (M1.1.5) — identity lifetime. Every registered dataset now
  holds a live handle on its file, so a filesystem identity cannot be recycled
  while a row still names it. See *Identity lifetime* below; the paragraphs this
  replaces recorded the gap as an open M1.2 decision.
- Amended: 2026-07-30 (M1.2) — the roster is reachable. Four typed commands make
  the registry a list the user can see, add to, curate and empty; the session is
  bounded; and an open claims the same per-dataset request epoch a spectrum
  does. See *Session capacity*, *Frontend and Tauri boundary* and *Concurrency*
  below; the paragraphs this replaces recorded the roster as unreachable and the
  commit order of two opens as an open M1.2 decision.
- Amended: 2026-07-31 (M1.3) — the roster has a view. A search over the display
  filename and one of five orderings decide what is on screen, entirely on the
  frontend and at the cost of no command; the registry's order, contents and
  identity are untouched. See *Roster view projection* below; the paragraph this
  replaces recorded search and sort as work that belonged to M1.3.
- Amended: 2026-08-02 (M1.4.1) — a folder can be added. Two narrow commands
  reach the registry through a path-free begin/claim protocol, a row may say
  where it was found when another row shares its filename, and the mutation
  gate carries a generation so a scan holding no lock cannot commit into a
  workspace the user has moved on from. Native main-webview page-load start is
  the reload linearisation point; reading the roster is a pure, gate-linearised
  snapshot. See *Path and diagnostic privacy*, *Frontend and Tauri boundary*,
  *Active dataset* and *Concurrency* below; the paragraphs this replaces
  recorded folder ingestion as gated apart from this decision.

## Context

ADR 0005 drew the preview boundary around one file. Its consequence says so
plainly: "Exactly one file is open at a time and choosing another revokes the
previous handle, so the webview never accumulates a capability over paths the
user has moved on from." That was the intended cost of keeping the path in Rust.

M1 asks for the workspace the roadmap promises — several acquisitions in one
session, added by picker or folder, with duplicate prevention, removal and a
visible list. The question this raises is not how to draw a list. It is what a
dataset *is* once there are several of them: what makes two additions the same
acquisition, what a removal has to reach, and what happens to work that is
already running when the thing it was reading stops being part of the session.

M1.0 answered the first prerequisite. An accepted file is now bound to the
complete Windows filesystem identity rather than the truncated 64-bit index,
because that identity is about to stop being a recheck of one handle and start
being the key that decides whether two chosen files are one dataset.

This decision covers the boundary and the Rust ownership model. It does not
cover the interface.

## Decision

A session owns an ordered registry of accepted mzML datasets. Rust owns the
registry, the paths and every fact derived from them; the webview continues to
hold opaque handles and display names.

## Dataset identity

A dataset is named by a session-scoped `DatasetId`, allocated monotonically and
never reused within the process — not after removal, and not after the workspace
is cleared.

The identifier is opaque but it is not a secret. What keeps a handle from naming
a file the user did not choose is that Rust resolves it against the registry and
revalidates the file on every use, not that the number is hard to guess. Random
or UUID identifiers would add no defence against anything and would cost
legibility in logs and tests.

Identifiers are not stable across sessions and are never written to disk.

The boundary spelling stays `file-N` for now. The frontend still works on one
active file, and renaming the handles it holds would be a visible change with no
user behind it. The Rust type is `DatasetId`; the string is what the boundary
already speaks.

## Duplicate detection

Two additions are the same dataset when they resolve to the same filesystem
identity — the volume serial and the whole 128-bit file ID that M1.0 introduced.

- Two paths to one object are one dataset. Hard links and path aliases are one
  dataset.
- A byte-identical copy is a different object and therefore a different dataset.
  Two acquisitions that happen to be identical are two things the user added.
- The canonical path is kept for display and revalidation. It is not the key: it
  would treat one file reached two ways as two datasets, which is precisely the
  duplicate the roster exists to prevent.
- Content hashing is rejected as a routine key, for the reason the source
  generation already records: the representative acquisition is 208 MB and
  hashing it on every addition would cost more than the work being protected.
- A file whose identity cannot be established is refused, as it already is.
  There is no path fallback, because a fallback would silently make the weakest
  case the one that decides whether two acquisitions are the same.

An identity names an object only while that object exists. A filesystem is free
to hand a deleted file's ID to the next one it creates, so an index of
identities that nothing keeps alive would eventually answer for a file the user
never added. *Identity lifetime* below is how that is closed.

## Identity lifetime

Every registered dataset owns an identity lease: a live handle on the filesystem
object it names, taken when the file is accepted and held for exactly as long as
the registry row exists.

The lease keeps the object alive. An identity cannot be recycled while its
object is alive, so every key in the identity index is still its own row's, and
a file that arrives later necessarily has an identity of its own. The failure it
removes is precise: without it, a dataset that was added and then deleted could
have its identity handed to an unrelated acquisition, and the registry would
report that acquisition as a duplicate of a row naming something else — two
distinct acquisitions merged into one workspace row.

- On Windows the lease is the very handle the inspection read the identity
  through, so there is no interval between establishing an identity and holding
  the object that owns it. It is opened sharing read, write and delete, the
  posture accepted files already used. Renaming, deleting and replacing the path
  all remain permitted while MSCanvas lists the file. Listing a file is not a
  claim on it: a workspace row is a row, and removing one is the only thing that
  removes one.
- Because deletion is permitted, a replacement object at the same path is
  necessarily alive at the same moment as the object it replaced, and two
  objects alive at once cannot share an identity. The replacement is therefore
  added as a distinct dataset rather than matched to the row it displaced, which
  is what *Source mutation and replacement* already required and what the lease
  now makes true rather than likely.
- Revocation releases the lease with the row it removes, and clearing the
  workspace releases every one of them. The removed value must not be kept in an
  error, a snapshot or a reply: holding it would pin a file the workspace no
  longer lists, with no row left for the user to remove.
- A request that is already running is the one thing revocation cannot end
  early, and that is the existing rule rather than a new one: running work is
  not cancelled, and while it runs it holds the file itself, because it is
  reading it. The object is therefore let go when that request finishes rather
  than when the row goes. Nothing outlives the request, which is the property
  that matters — the file is never held by a session that has forgotten it.
- A duplicate addition was accepted like any other file and arrived holding a
  lease of its own — nothing can know it is a duplicate before it is inspected.
  The duplicate outcome drops it, so an object is held once, by the row that
  already named it, rather than once per time the user happened to add it.
- The lease is a lifetime and not a decision. It is not a cache, not the handle
  a read goes through, not a permanent lock, and not a reason to trust the
  remembered path: every use still canonicalises the path, reopens it, reruns
  acceptance and compares the canonical path, the identity and the source
  generation. A path that now names another object is refused exactly as before,
  and the dataset stays pinned to the object it was given until it is revoked.
- The picker takes the replacement's lease before it lets the previous
  selection's go. Revoking first would leave a window in which the old identity
  is free, and the file being accepted in that window could be given it.
- The lease is not persistence. It holds nothing across processes, is not
  written anywhere, and every handle is gone when the session ends.

The cost is a handle per registered dataset, which is what *Consequences* below
records. The cost the earlier draft feared — a file the user cannot delete from
Explorer while MSCanvas lists it — is not paid, because the share mode is the
permissive one.

One narrower cost is paid, and is named here rather than discovered later. The
lease asks for read access, and Windows will not grant a later open whose own
share mode refuses to share that read. Renaming, deleting, replacing, reading
and writing the file all still work — a writer that shares reads, which is what
an in-place edit does, is unaffected — but a program that opens the file
offering no sharing at all is refused for as long as a row names it, and the
user's remedy is to remove the row. That is the same rule the release coverage
uses to ask the operating system whether a lease is still held, so it is a
property this decision knows it has. Narrowing the lease to an access mask the
sharing rules exempt would remove it, at the price of no longer being the handle
the identity was read through; that is a separate decision with its own evidence
to gather. The roster now makes a session hold several of these at once, which is
what would make the evidence worth gathering; nothing in that slice changed the
lease, so none was gathered and the decision stands where it was.

On Windows this is the whole guarantee: `FILE_ID_INFO` names an object, and an
open handle keeps that object alive.

Elsewhere no hold is taken, and the decision is deliberate rather than pending.
That platform's inspection establishes posture and identity from the name rather
than through a handle, so it has none to hand over; opening the path a second
time to make one would be a second resolution — recording an identity a rename
could leave nothing keeping alive — and, worse, std offers no non-blocking open,
so a path replaced by a FIFO between the posture check and that open would leave
the selection blocked for as long as no writer arrives. Introducing a way to
hang, in order to pin an identity this decision does not claim to pin, is the
wrong trade. The lease type stays uniform so the registry never has to know
which platform it is on, and the guarantee, the coverage and the claim are all
Windows — which is the platform this application ships on and the only one its
CI builds. A non-Windows lease would need a non-blocking no-following open,
which needs a dependency this project has not taken, and it belongs with that
decision rather than with this one.

## Duplicate outcome

Adding a dataset that is already registered is an ordinary outcome, not an
error. The registry answers with the identifier it already has.

A duplicate addition creates no row, allocates no identifier, does not change
insertion order, does not touch preview state and launches no backend work. The
answer carries no path.

## Registry order

Insertion order belongs to the registry. Additions append. Removal deletes the
row and leaves the rest in order. Re-adding a file that was removed allocates a
new identifier and appends it: it is a new decision by the user, and the
identifier it had before is gone for good.

Search, sort and filtering are view work over the roster. The registry has one
order; M1.3 added a projection over it and did not touch it. See *Roster view
projection* below.

## Roster view projection

The registry's insertion order stays authoritative. What the user is looking at
is derived from it by a pure function on the frontend, and the derivation is not
a thing Rust is told about, asked for, or able to observe.

- **Search matches the display filename and nothing else.** Not the opaque
  handle, not the rendered byte size, not the row's state, and — because the
  frontend has never been given one — no path, parent directory or canonical
  form. A query is compared in NFKC, trimmed and lower-cased; the name that is
  displayed is what Rust said, character for character.
- **Sort is one of five orderings**: the registry's own order, name ascending or
  descending through a single `Intl.Collator` with `numeric: true` and
  `sensitivity: "base"`, and byte length ascending or descending. Every one of
  them is stable and falls back to the registry index, so `Added order` is the
  identity and no other order is ever authoritative.
- **A search does not hide the user's own work.** A row that is selected, the
  row whose preview is on screen and a row being read stay visible whether or
  not they match, listed once, each saying in words which of those it is. A row
  that is active with nothing on screen for it — a backend change discards what
  a row read while leaving it the row an explicit re-read acts on — stays too,
  and says it is kept for the viewer rather than that it is showing anything.
- **Counts describe the search, not the list.** The number reported is how many
  rows matched, out of everything the session holds; rows kept for another
  reason are counted separately and named as such.
- **Range selection and `Ctrl+A` follow the visible order.** A Shift range spans
  what is on screen, in the order it is on screen, and never reaches a row the
  query is hiding: a selection the user cannot see is one they cannot check
  before pressing `Remove selected`.
- **Focus is reconciled in the same transition that changes the view.** A
  focused row that the view no longer shows moves to the first visible row when
  the user narrowed the view themselves, and to the nearest surviving row in the
  order they were just looking at when a row went from under them. It never
  stays on a row that is not on screen, and DOM focus never lands on the
  document body: the row that took its place if there is one, the search box if
  there is not.
- **Neither is persisted.** The query and the sort are session interface state.
  A reload of the webview brings back the roster Rust holds and no query at all,
  and emptying the workspace forgets both, so the next batch of files cannot
  arrive behind a filter nobody can see.
- **No backend work is launched.** Typing, clearing, sorting, ranging and
  selecting issue no Tauri command and start no process. That is the whole
  reason this is view work rather than a roster query command: the answer is
  already on this side.

## Session capacity

A session holds at most `MAX_WORKSPACE_DATASETS` = 1,024 datasets.

The number is a resource contract, not a performance promise. Every Windows row
owns a live identity lease for as long as it exists, and every mutation answers
with the whole roster, so the session's cost in handles and in transfer size both
rise with the number of rows. A thousand is far above what a batch of
acquisitions looks like and far below where either of those becomes a question,
which is what a bound is for.

- Duplicates are decided before capacity. A file already in a full workspace is
  still in it: answering "full" would tell the user to remove rows to make room
  for something that needs none, and would report a row they already have as a
  file they failed to add.
- A valid, non-duplicate file the session cannot hold is refused per item with
  the stable kind `workspace_full`. It is not retryable: reading again without
  removing a row cannot succeed.
- Nothing the session refuses spends an identifier. The allocator advances for
  registered datasets only, so a full or rejected outcome leaves the sequence
  where it was.
- A batch is processed in picker order until the workspace is full, and the rest
  of its valid non-duplicates are refused. One refusal does not roll back the
  files that arrived before it.

## Batch addition

One picker operation is one batch, and a batch answers with the roster it
produced and one outcome per file the user chose, in the order they chose them.

- An outcome is `added`, `duplicate` or `rejected`. A duplicate names the row the
  user already has, described as it was registered rather than as it was just
  named. A rejection names the candidate by its final filename only — never a
  folder, never a path — and carries the typed error that refused it.
- A file that cannot be accepted is its own failure. The files accepted before it
  stay accepted: a batch is a list of files the user pointed at, not a
  transaction, and rolling them back would punish them for their company.
- A dismissed picker answers `null`, which is not the same as a batch that added
  nothing. Nothing was chosen, so nothing changed.
- Nothing in a batch reads an acquisition. Adding a file makes it something the
  user can see and remove; reading one is a thing they ask for.

Two batches cannot interleave their rows. A short-lived mutation gate serialises
add, remove and clear against each other; it is not the workspace lock and is
never held while a file is being accepted from the filesystem for longer than
that file needs, nor while any backend work runs.

## Revocation

Removing a dataset is an explicit operation with a reason, and it is atomic
across everything the session knows about that dataset: the row, the identity
index, its identity lease, its request epoch and its preview facts all go
together.

- The source acquisition is never deleted or modified. Removing a row removes a
  row, and releases the handle that row was holding.
- Work that is waiting for its turn on a revoked dataset never starts.
- Work already running is not cancelled. It may finish, and nothing it produces
  is recorded: a late reply cannot recreate registry or preview state, and
  cannot attach itself to another dataset. Identifiers never being reused is a
  second line of defence, not the mechanism.
- The caller is told. A request whose dataset has gone, or which a newer request
  for that dataset has replaced, answers with `selection_superseded` rather than
  with a result: the roster is what makes it something the user can cause, and a
  reply presented as current for a row the workspace no longer has is worse than
  a refusal it can act on.

## Source mutation and replacement

A dataset's row survives its file changing. What does not survive is anything a
backend derived from the earlier state.

- The same object with a new source generation keeps its row; the preview facts
  recorded for it stop being usable and the existing refusal applies.
- A different object behind the former name keeps its row too, and the roster
  shows it in a typed replaced state. The registry never rebinds the identifier
  to an object the user did not add: the file that arrives under a familiar name
  is a different acquisition, and adopting it silently would put measurements the
  user never chose under a name they recognise. Replacing it is a removal and an
  addition, made by the user.

A row's state is derived from what a read of it actually answered, and only from
the kinds that describe the file rather than the attempt:
`file_identity_changed` is *replaced* and `file_not_resolvable` is *missing*.
Everything else is a failure of that read. `not_a_regular_file`, for instance,
says the name now points at something this boundary never accepts, which is not
a claim that the acquisition was replaced by another one.

Nothing is rechecked on the user's behalf. A roster read returns stored facts, so
drawing a list of a thousand rows is not a thousand filesystem inspections; the
state of a row is established when it is read, where the user asked for it and
can see the answer.

## Per-dataset preview ownership

Each dataset owns its own runtime state: a request epoch, and either no preview
or a complete one. A complete preview owns the source generation it was read
under, the backend identity and generation that read it, and the table rows a
later selected spectrum is reconciled against.

The facts are committed together. Before this decision they lived in two
parallel maps written one after the other, which made two states representable
that must never occur: a recorded generation with no rows to reconcile against,
and rows with no record of which backend produced them.

The service does not store a selected spectrum. Which row is selected is
presentation state and stays where it is, in the frontend; a second copy in Rust
would be a second answer to the same question.

## Backend installation changes

Changing the installation leaves the roster and every source-derived fact
alone. What it invalidates is backend-derived: the preview facts of every
dataset stop matching the installation in use, and the existing checks refuse
them.

Nothing is reread automatically. A workspace of twenty datasets does not become
twenty queued backend jobs because the user pointed at another ProteoWizard;
rereading one is a thing the user asks for, one dataset at a time.

## Frontend and Tauri boundary

No command accepts a path from the webview, and the main window's capability set
stays empty.

Six commands within the twelve-command registered surface make the registry
reachable:

- `get_workspace_roster` — the ordered, path-free list the session holds;
- `choose_mzml_files` — show the native picker and add everything chosen;
- `begin_mzml_folder_import` — synchronously retain one current-generation
  baseline and return its path-free correlation identifier;
- `choose_mzml_folder` — consume and validate that exact identifier before
  showing the native folder picker, then add every mzML file found beneath the
  folder chosen (the two-command protocol was added by M1.4.1; see ADR 0007);
- `remove_workspace_datasets` — remove the rows these handles name;
- `clear_workspace` — empty the session.

For workspace contents the webview names a row by the handle it was given, or
names nothing at all. The folder handshake additionally echoes a
session-scoped, opaque-but-not-secret identifier issued by Rust. That identifier
is single-use correlation, not a path, filesystem capability, mutation
generation or internal token. Clearing takes no identifiers: it is one action
over everything the session holds, and a list of rows to clear would be a second
way to remove some of them. A handle the session no longer has is an ordinary
reconciliation outcome — the interface asked about rows it believed it had,
and the answer is the roster it actually has — rather than a refusal.

The single-file picker command is retired rather than kept beside its
replacement. Two registered pickers with opposite semantics, one that replaces
the workspace and one that adds to it, is a boundary nobody can reason about.
Its replacement behaviour survives as a `cfg(test)` helper because the focused
coverage written against it is worth keeping; no command reaches it.

## Active dataset

The roster and the viewer answer different questions, and the interface keeps
them apart:

- the **selection** is the set `Remove selected` acts on, and may be none, one or
  many rows;
- the **focused** row is the single row the keyboard acts on;
- the **active** row is the one whose preview is on screen or was explicitly
  asked for.

Only activation reads. Moving focus, changing the selection, adding files,
adding a folder, removing rows and emptying the list all launch nothing, so
walking a roster of a thousand rows costs nothing on the machine. Adding files
reads at most the first row of a session that had nothing in it — which keeps one
picker operation to one process while a first-run session still ends up looking
at something — and never reads a row added beside a preview that is already open.

Adding a folder follows the same rule for the same reason, and it is where the
rule earns its keep: a folder of a thousand files is one picker operation and
therefore at most one process. Whether the session was empty is decided from the
authoritative reply — every row in it being one this import added — rather than
from the list on screen, because a reloaded window can show nothing while Rust
still holds rows.

The service stores no active dataset. Which row is being shown is presentation
state and stays in the frontend; a second copy in Rust would be a second answer
to the same question.

## Path and diagnostic privacy

Every registry type that holds a path renders opaquely in debug output, as the
installation identity already does. A roster is many paths in one structure, and
one `{:?}` in a log or a panic message would be enough to put them all somewhere
they should not be. Typed outcomes and reasons carry no path, no filename and no
raw filesystem identity.

**Amended by M1.4.1: collision-only relative context.** One exception is now
made, and it is the narrowest one that solves a real problem. Recursive folder
ingestion can find `A\sample.mzML` and `B\sample.mzML`; both are different
acquisitions, both render as `sample.mzML`, and a user cannot choose between
them. A row may therefore carry a `relativeContext` — a fragment of where it sat
below the folder the user chose — under all of these conditions:

- only when two or more **live** rows share its exact final filename, decided
  over the whole roster every time one is built, so it appears when a colliding
  row arrives and goes when that row leaves;
- never a drive, never a UNC prefix, never absolute, never `..`, and never the
  chosen root's own name;
- bounded to 128 characters, truncated from the shallow end so what survives is
  the part nearest the file;
- `Added directly` for a picked file, because it has no place under a chosen
  folder to describe and inventing one would put it in a tree nobody named;
- disambiguated by the session's own row identifier when two rows would
  otherwise say the same words — that identifier is already the handle the
  webview holds;
- display only: never searched, never a sort key, never part of identity, never
  persisted, and its tooltip says exactly what the row already shows.

The registry's own origin record stays private and stays out of identity: two
names for one acquisition are one row whichever route each arrived by, and a
duplicate addition never rewrites where the existing row came from. Its debug
output reports a depth, never a component.

## Unsupported formats

The registry accepts what the boundary already accepts: mzML regular files. No
type in it may name a vendor format or a directory acquisition, including as an
unconstructed enum variant, because a variant that exists is a claim that the
data behind it is understood. Directory acquisitions and vendor formats need
their own evidence and their own decision.

## Persistence exclusion

The registry is session-only. Saved workspaces, recent files, identifiers that
outlive the process and session restoration are all outside this decision, and
`ARCHITECTURE.md` already requires durable storage to arrive with its own schema
and ADR.

## Concurrency

One backend process at a time remains the rule, enforced by one global gate;
adding datasets does not add execution lanes.

Supersession is per dataset and covers every request about one. A dataset has one
request epoch; an open claims it exactly as a selected spectrum does. A newer
request for a dataset makes an older one stale at both ends — an open still
waiting for the backend gate never launches, and one that had already started
records nothing and answers with the existing `selection_superseded` refusal
rather than returning a preview as though it were current. Work on one dataset
supersedes nothing in another, which under a single global ticket it would.

Beginning an open also drops whatever the previous open recorded for that
dataset. Those rows are what a later spectrum is reconciled against, and after a
reopen that fails nothing on screen came from them; left in place they would
outlive their own open and a spectrum would be compared against a reading the
user is no longer being shown.

No workspace lock is held while waiting for the backend gate, while a backend
process runs, or while its output is parsed. State is read under the lock,
released, and taken again to commit — and what the commit rechecks is that the
dataset is still registered *and* that this is still its newest request. The
commit order of two opens is not their request order, so without the second
check the later commit would win whether or not it ran last.

Nothing is reread on the user's behalf, ever. Changing the installation
invalidates what a backend produced and rereads none of it; a workspace of a
thousand datasets does not become a thousand queued jobs because the user pointed
at another ProteoWizard, and it does not become one because they walked the list.

**Amended by M1.4.1: the workspace mutation generation.** The gate that
serialises one workspace mutation against another now carries a monotonic
counter. Adding files, removing rows, emptying the list, a successful exact
folder claim, and native main-webview `PageLoadEvent::Started` advance it.
Folder scanning is the one operation long enough that the user can decide
something else while it runs: it carries the token created by its claim, scans
holding no lock at all, and commits only if that token still names the current
generation.

The two-command start is deliberately independent of IPC arrival order.
Synchronous `begin_mzml_folder_import` records the current generation only as a
baseline in one bounded `Option` slot and returns a path-free correlation ID. It
does not advance the generation. Another begin at the same generation
idempotently returns the same ID. `choose_mzml_folder` must claim that exact ID
before dispatching the picker: the claim consumes it, validates its baseline,
then atomically advances the generation and creates the Rust-only,
unclonable token. An exact stale claim is consumed and refused; an unknown,
replaced or replayed ID does not consume the live slot.

Reload authority comes from Tauri's native page-load-started hook, which runs
before the replacement document can issue IPC. It advances the generation and
therefore supersedes work owned by the previous document without assuming FIFO
delivery of commands. A delayed old begin has no generation side effect, and a
delayed old roster request is only a pure snapshot. `get_workspace_roster`
still takes the mutation gate so it observes a complete batch either before or
after its commit, but it does not advance the generation. See ADR 0007's
mutation-concurrency section for the complete state machine.

## Testing obligations

- identifiers are monotonic and never reused, including after clear;
- a handle the session never issued reaches no dataset, whatever it is spelled
  like;
- duplicates are decided by filesystem identity, proven with a hard link;
- a byte-identical copy is not a duplicate;
- duplicate addition changes nothing, and keeps no handle of its own;
- order survives removal, clear and re-addition;
- a registered dataset holds its file open and a revoked one does not, proven
  against the operating system's own sharing rules rather than by timing;
- emptying the workspace releases every lease, not the first row's;
- a file created where a registered one used to be is a second dataset, and the
  row it did not join reports the change on its next use;
- a file MSCanvas lists can still be renamed and deleted by its owner;
- a path the picker refuses leaves the selection, and its lease, exactly as they
  were;
- revocation reaches the row, the identity index, the lease, the epoch and the
  preview;
- a revoked dataset's waiting work never starts;
- a revoked dataset's running reply recreates nothing and attaches to nothing;
- work on one dataset never supersedes work on another;
- preview facts commit together or not at all;
- a backend change rereads nothing;
- registry operations never reach the provider, proven with one that panics;
- no path, filename, raw identity or raw handle appears in any debug output;
- a batch reports one outcome per chosen file, in picker order, and one item's
  failure leaves the rest added;
- a rejected candidate is named by its final filename and nothing else;
- duplicates are decided before capacity, and a duplicate in a full workspace is
  still a duplicate;
- no identifier is spent on a duplicate, a rejection or a full workspace;
- removal normalises a repeated handle and reports an unknown one;
- an open still waiting for its turn never launches once a newer one arrives;
- an open that had already started cannot commit after a newer one, proven by
  asking which acquisition's rows the session kept;
- beginning an open drops what the previous one recorded, so a failed reopen
  leaves nothing to reconcile against;
- the roster can be read and emptied while a backend process is running;
- the registered command surface is exactly the one the frontend calls, the
  retired picker is gone, and the capability set is still empty;
- relative context appears only for exact filename collisions and disappears
  when the row that caused it does, is never searched and is never a sort key,
  and a directly added row is told apart from a discovered one;
- folder begin is current-generation-idempotent in one bounded pending slot,
  exact claim is single-use and advances before the picker, and wrong or
  replayed claims do not consume the live slot;
- native page-load start, rather than a roster IPC request, supersedes work from
  the replaced document; delayed old begin and roster requests cannot cancel a
  newer import;
- a folder import commits only against the generation its successful claim
  created, and a superseded one accepts nothing and holds nothing.

## Consequences

The session gains an ownership model that can hold a workspace, and the defects
a roster would otherwise have shipped with — cross-dataset state mixing, a
global ticket cancelling unrelated work, late replies resurrecting removed rows
— are refused by construction and by test rather than found later in a rendered
check.

The session also holds one open file handle per registered dataset, for as long
as the row exists. That is the price of the identity being the file's own rather
than a number that used to be, and it is a small one: the handle is read-only,
shares deletion, and goes when the row does.

It is now reachable, and reachable on the terms this decision set: every dataset
the session holds is a row the user chose, can see, and can remove, and the
session is bounded. What the user gains is a workspace; what they do not gain is
a way for MSCanvas to spend their machine on their behalf, because the only thing
that reads an acquisition is asking for one to be read.

## Rejected alternatives

- **UUID or random identifiers.** No invariant improves. The capability is the
  registry lookup, not the entropy.
- **Canonical path as the duplicate key.** It reports one file reached two ways
  as two datasets, which is the duplicate the roster exists to prevent.
- **Content hashing as the duplicate key.** Rejected on measured cost, and it
  would also merge two acquisitions that are genuinely two.
- **Registering datasets in production before the roster exists.** It would give
  the webview capabilities over files the user cannot see or withdraw, which is
  exactly what ADR 0005 refused. The roster is what lifts that refusal.
- **Reading every file a picker returns.** One operation would then be one
  ProteoWizard process per file against acquisitions of a couple of hundred
  megabytes each, for results nobody asked to see, behind a gate that runs one at
  a time. At most the first row of an otherwise empty session is read.
- **An unbounded session.** Every Windows row holds a handle and every mutation
  answers with the whole roster, so "as many as fit" is a promise about a
  machine rather than about this application.
- **Rechecking every row whenever the roster is drawn.** A list is read on every
  mount and after every mutation; a thousand filesystem inspections each time
  would make drawing a list the most expensive thing the application does, to
  answer a question the next read of a row answers where the user can see it.
- **Rechecking a registered file instead of holding it open.** Asking again
  whether the recorded path still resolves to the recorded identity cannot tell
  a recycled ID from a hard link that outlived one of its names: both are a row
  whose path no longer resolves to it. Splitting on that doubt would put one
  acquisition on two rows, which is the duplicate the roster exists to prevent.
  A live handle answers the question by making it unaskable.
- **A lease that forbids deletion.** Sharing less would stop the user removing
  or replacing a file MSCanvas has listed, which is a claim on their data that
  nothing here has earned. It would also be a worse guarantee, not a better one:
  a replacement that cannot happen teaches nothing about a replacement that
  does.
- **An ADR without a compiling implementation.** The identity gap M1.0 repaired
  was found by reading the code, not the documents.
- **A format-neutral dataset kind.** A constructible variant for a vendor or
  directory acquisition advertises support that does not exist.

## Follow-up slices

- **M1.2** — done: the first user-visible roster, recorded in the amendments
  above.
- **M1.3** — done: search and sort as a view projection, recorded in the
  amendments above.
- **M1.4** — implementation complete; final M1.4.1 rendered QA pending: folder
  ingestion, with its own traversal boundary in
  [ADR 0007](0007-logical-acquisition-discovery-and-folder-traversal.md) and the
  amendment above. Directory-formatted acquisitions stay gated on evidence, as
  *Unsupported formats* requires.
- **M1.5** — Explorer drag-and-drop, whose security boundary differs from the
  folder picker's and is therefore separate.
