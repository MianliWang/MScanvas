# ADR 0006 — Multi-dataset workspace boundary

- Status: Accepted for the M1 workspace foundation; the roster interface and
  everything after it separately gated
- Date: 2026-07-30

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
index, its request epoch and its preview facts all go together.

- The source acquisition is never deleted or modified. Removing a row removes a
  row.
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
released, and rechecked under the lock again before anything is committed.

## Testing obligations

- identifiers are monotonic and never reused, including after clear;
- duplicates are decided by filesystem identity, proven with a hard link;
- a byte-identical copy is not a duplicate;
- duplicate addition changes nothing;
- order survives removal, clear and re-addition;
- revocation reaches the row, the identity index, the epoch and the preview;
- a revoked dataset's waiting work never starts;
- a revoked dataset's running reply recreates nothing and attaches to nothing;
- work on one dataset never supersedes work on another;
- preview facts commit together or not at all;
- a backend change rereads nothing;
- registry operations never reach the provider, proven with one that panics;
- no path, filename or raw identity appears in any debug output.

## Consequences

The session gains an ownership model that can hold a workspace, and the defects
a roster would otherwise have shipped with — cross-dataset state mixing, a
global ticket cancelling unrelated work, late replies resurrecting removed rows
— are refused by construction and by test rather than found later in a rendered
check.

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
