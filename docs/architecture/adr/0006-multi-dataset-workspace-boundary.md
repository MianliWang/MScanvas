# ADR 0006 — Multi-dataset workspace boundary

- Status: Accepted for the M1 workspace foundation; the roster interface and
  everything after it separately gated
- Date: 2026-07-30
- Amended: 2026-07-30 (M1.1.5) — identity lifetime. Every registered dataset now
  holds a live handle on its file, so a filesystem identity cannot be recycled
  while a row still names it. See *Identity lifetime* below; the paragraphs this
  replaces recorded the gap as an open M1.2 decision.

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
to gather, and M1.2 is where a roster of several held files makes it worth
gathering.

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

Search, sort and filtering are view work over the roster and belong to M1.3.
The registry has one order.

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
- Whether the caller is also *told* that its reply is stale is a roster
  question, not this one. Until the roster exists the picker replaces the
  selection, the webview has already let go of the handle it asked under, and
  refusing an answer nobody is looking at would be a boundary change with no
  user behind it.

## Source mutation and replacement

A dataset's row survives its file changing. What does not survive is anything a
backend derived from the earlier state.

- The same object with a new source generation keeps its row; the preview facts
  recorded for it stop being usable and the existing refusal applies.
- A different object behind the former name keeps its row too, and the roster
  will show it in a typed replaced state. The registry never rebinds the
  identifier to an object the user did not add: the file that arrives under a
  familiar name is a different acquisition, and adopting it silently would put
  measurements the user never chose under a name they recognise. Replacing it is
  a removal and an addition, made by the user.

The typed replaced state is a roster concept. This slice records the decision
and keeps the current frontend-visible failure exactly as it is.

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
stays empty. This slice adds no command, changes no command signature and
changes no transfer object.

The current picker keeps its replacement semantics until the roster interface
exists: choosing a file revokes the previous dataset and registers the new one,
so the session holds exactly one dataset and the webview sees exactly one
handle. Registering datasets the user cannot see or remove would be a capability
they did not ask for and could not withdraw.

## Path and diagnostic privacy

Every registry type that holds a path renders opaquely in debug output, as the
installation identity already does. A roster is many paths in one structure, and
one `{:?}` in a log or a panic message would be enough to put them all somewhere
they should not be. Typed outcomes and reasons carry no path, no filename and no
raw filesystem identity.

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

Supersession becomes per dataset. A newer request for a dataset supersedes an
older one still waiting for it; work on one dataset does not supersede work on
another, which under a single global ticket it would.

No workspace lock is held while waiting for the backend gate, while a backend
process runs, or while its output is parsed. State is read under the lock,
released, and taken again to commit — and what the commit rechecks is that the
dataset is still registered, which is what stops a late reply recreating state.
It does not check that this is still the newest read of that dataset: two opens
of one dataset are serialised at the backend gate but not at the commit, so the
later commit wins whether or not it ran last. The cost is a preview stamped with
the earlier generation and a spurious refusal on the next spectrum, never mixed
data, and the fix is an epoch for opens as well — M1.2, where a roster makes
concurrent opens something a user can actually cause.

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
- no path, filename, raw identity or raw handle appears in any debug output.

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

The deliberate cost is that none of it is reachable yet. Until the roster
interface lands, production still registers one dataset at a time, and the
multi-dataset paths are exercised only by tests. That is the safer half of the
trade: an invisible workspace the user cannot see, curate or clear would be
worse than no workspace.

## Rejected alternatives

- **UUID or random identifiers.** No invariant improves. The capability is the
  registry lookup, not the entropy.
- **Canonical path as the duplicate key.** It reports one file reached two ways
  as two datasets, which is the duplicate the roster exists to prevent.
- **Content hashing as the duplicate key.** Rejected on measured cost, and it
  would also merge two acquisitions that are genuinely two.
- **Registering datasets in production before the roster exists.** It would give
  the webview capabilities over files the user cannot see or withdraw, which is
  exactly what ADR 0005 refused.
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

- **M1.2** — the first user-visible roster: add several files, ordered list,
  deterministic duplicate feedback, focus a dataset, remove and clear.
- **M1.3** — search and sort over the roster.
- **M1.4** — folder ingestion, with its own traversal boundary.
- **M1.5** — Explorer drag-and-drop, whose security boundary differs from the
  folder picker's and is therefore separate.
