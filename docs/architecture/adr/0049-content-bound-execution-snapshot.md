# ADR 0049 — Content-bound execution snapshots and attempt-scratch ownership

Status: **accepted locally for M9.3; unpublished.** Date: 2026-09-23.
Builds on the [M9.1 record](../../product/M9_1_TARGETED_MS1_HANDOFF.md#m91-record)
(the execution view, the supervisor and the quarantine) and
[ADR 0048](0048-stored-targeted-result-reuse-and-export.md) (stored results are
read without running anything). Record:
[M9.3 execution snapshots](../../product/M9_3_TARGETED_MS1_EXECUTION_SNAPSHOT.md).

## Context

The targeted MS1 engine cannot open a path with non-ASCII characters, so M9.1
never hands it the source's own name. It holds the source read-only for the
whole attempt, hashes it through that handle, and gives the engine an ASCII
hard link in the repository-owned work area `.tmp/m91-jobs/attempts/<uuid>/`,
shown to be the held object. A hard link cannot cross a volume, so a source on
any other drive was refused before a run existed (`sourceOnAnotherVolume`).
M9.0 recorded "never silently copied" as a condition of the route.

On an ordinary Windows machine the work area and the user's data are often on
different drives. M9.3 removes the restriction without weakening what M9.1
guarantees about the bytes a run consumed.

M9.1 also left a gap: a process that died mid-attempt left its attempt
directory, and nothing reclaimed it. With copies, such a directory can hold a
whole mzML.

## Decisions

### 1. Two execution views, chosen from the held handle

The source is opened once, with read sharing only (write and delete sharing
withheld), before any byte is read. Which view the engine gets is decided from
that handle's volume, never from the name:

| Held object | View | Recorded `attempt.sourceView` |
| --- | --- | --- |
| On the work area's volume, and a hard link can be made | M9.1's view, unchanged: hash through the handle, compare with the plan, link, show the link is the held object | `hardLinkInWorkArea` |
| On another volume, on a volume that gives no identity, or where `CreateHardLink` fails | A verified copy in the attempt directory (below) | `verifiedSnapshotInWorkArea` |
| A link was made and is **not** the held object | Refused: `executionViewUnavailable`. Never replaced by a copy — something other than the attempt put it there | the run fails before a worker |

A source that can be linked is never copied.

### 2. A copy is bound to content in one read through the held handle

`OpenedMember::copy_into` (`project/observe.rs`) reads the held object once.
Each chunk (64 KiB, the digest's own buffer) is written to the copy and then
given to the SHA-256, so the digest is of exactly the bytes the copy was
handed, and they came out of the held object. A copy whose length is not the
held object's length at the open is refused. Then, in the supervisor:

1. the copy's length and digest are compared with the plan's expected content;
   a difference is `sourceChanged`, with what was read recorded as consumed;
2. the copy's write handle is closed (it was opened sharing nothing, so no
   other program could write, rename or remove it meanwhile), and the source
   is released;
3. the copy is opened read-only with the same stable share mode, hashed again
   through that handle, and must again be the plan's length and digest; that
   handle is held until the worker has exited;
4. only then is the worker given the copy's ASCII name.

Nothing is flushed to the device. No claim is made that the copy survives a
crash; it is scratch, and a copy is never reused.

**What is protected, and what is detected.** While the source is held,
another program cannot open it for writing, and cannot rename or delete the
name it was opened by (Windows share modes; measured mid-copy). M9.1 measured
that another hard-linked name of a held file can still be deleted; that
removes a name, not the bytes being copied. While the copy is written it is
shared with nobody; while it is held for the worker it cannot be opened for
writing, renamed or deleted. Detected rather than prevented: a change made
through a mechanism that bypasses share modes (a writer that already had the
file mapped, raw volume access, a kernel component), a change to the copy
between its write handle closing and its read handle opening, and a change the
worker sees while it reads (the adapter re-hashes, as in M9.1). Each fails the
attempt; none can make the worker read bytes other than the plan's, because the
copy's own bytes are checked against the plan's digest immediately before the
worker is given them. Not claimed: that Windows provides an immutable
snapshot, that the source stays unchanged after the copy was made, or any
boundary against a hostile local administrator.

### 3. The run is bound to the bytes, not to where they were read

`consumedContent` is the source's length and SHA-256 as the copy read them —
the same fact M9.1 records from its hash. `attempt.sourceView` says how the
engine was given them. No path, drive, volume serial, file identity or scratch
name is persisted or shown. Once the copy is verified, the original source may
move or disappear without changing what the running attempt consumes. A source
that no longer matches its plan is `sourceChanged`; a new run from changed
content is a new plan the user asks for.

### 4. Schema 4 gains two words; it does not advance

`SourceView::VerifiedSnapshotInWorkArea` and
`FailureCode::InsufficientWorkAreaSpace` are added to the closed schema-4
vocabularies. A bump to schema 5 would, by this repository's rule that an older
schema is refused and nothing migrates, make every M9.1/M9.2 project
unreadable — including every stored result M9.2 made durable. The cost of not
bumping is stated plainly: an M9.1 or M9.2 build refuses a document that
records a copied view or that failure code, as it refuses any unknown word.
That is acceptable only because schema 4 is unpublished. An unknown view is
still refused by this build.

### 5. Capacity: one observation, one rule, and the write's own answer

Before a run exists, where the source is proven to be on another volume than
the work area, the work area's `GetDiskFreeSpaceExW` "available to caller"
must be at least the plan's byte length — the copy's size, with nothing added
for what the worker writes, which is not the copy's. Otherwise the review is
blocked and the run refused with `insufficientWorkAreaSpace` (retryable);
nothing is recorded. Where the space or either volume cannot be established,
nothing is refused and the attempt's own read or write says why. The
observation is not a reservation: a copy that runs out of room during the
attempt fails the run with `insufficientWorkAreaSpace` at the `source` stage —
a failed run, never a scientific negative — and the partial copy goes with its
directory. No percentage, multiple or margin is invented.

### 6. Cancellation during the copy

The copy checks the operation's cancellation between chunks, the same
granularity every stable read has. A cancelled copy starts no worker, records a
cancelled run with no consumed content and no attempt facts, and its partial
copy goes with its attempt directory. Idle and stale cancels keep M9.1's
behaviour: a cancel names the accepted operation, and an identifier from an
operation that has ended names nothing.

### 7. Attempt directories are marked, and only proven-abandoned scratch is swept

Every attempt directory gets `owner.json` before anything else is put in it:
its schema (`mscanvas.targetedMs1.attemptScratch/1`), the attempt's UUID (the
directory's name), and the owner process's id and creation time. No path,
source name, output or message. Nothing in an attempt directory is ever
published: results are staged in the project's own store beside the document,
so the marker carries no publication state.

At the start of each attempt, before its own directory is made, the
supervisor sweeps the attempts root. A directory is removed only when it is a
plain directory named by a canonical UUID, its marker reads and names that
UUID, the marker's process is gone (`OpenProcess` finds no process with the
id, or the process with the id was created at another time), and its
`source.mzML`, if any, is a hard link whose bytes still have another name.
Removal empties the directory first, removes the marker last and the directory
after it; a removal that cannot finish keeps the marker for the next sweep.
Everything else is left as found: directories with no marker (every M9.1-era
one), unreadable or mismatched markers, non-UUID names, files, links, a live
owner — this process included — and an owner that cannot be asked about.

Why a gone owner is enough: the worker runs in a Job its owner created with
kill-on-close and no inheritable handle
(`crates/proteowizard/src/process.rs`, `assign_with`), so the owner's exit
closes the Job's last handle and Windows terminates every process in it.

A crash-left **link** can be the last name of a user's bytes if the user
deleted their original while MSCanvas was not running; such a directory is
never removed. In a running attempt, the link's name is now removed while the
source is still held, so the source's other name cannot have gone first.

No sweep lifts a quarantine. A session that could not observe its worker's end
keeps refusing runs until MSCanvas exits, whatever happens to a directory; the
quarantined attempt's directory is live scratch for as long as that session
runs, and the first sweep of a later session may remove it.

The sweep's outcome (removed / live / unowned / uncertain) is typed and tested;
it is not shown in the interface.

## Alternatives rejected

- **Keep refusing another volume.** It fails the milestone's user goal.
- **Always copy.** The link is M9.1's tested path and costs nothing; a copy is
  made only where a link cannot be.
- **Hash the name, close, reopen, copy.** Two opens by name: the bytes copied
  need not be the bytes hashed.
- **Hash, then copy, through the same handle.** As strong, and two full reads
  of what may be the slowest drive on the machine.
- **A copy in `%TEMP%`, `%LOCALAPPDATA%` or a global cache.** New host storage;
  the attempt directory already exists, is ASCII and is owned.
- **Record nothing about the view.** A copied run would then persist the false
  fact `hardLinkInWorkArea`.
- **Schema 5.** See decision 4.
- **Sweep on startup or project open, a background cleaner, or general
  garbage collection.** Wider than the scratch this decision can prove its own.
- **Decide liveness from the marker, the directory's age or the absence of a
  lock.** None of them says whether a process still owns the directory.

## Consequences

- A targeted MS1 run works from any local volume the source can be read on,
  with the same plan, recipe, runtime, adapter and result contract.
- A run over a copy costs one extra full read of the copy and the space of one
  source-sized file in the work area while it runs.
- The execution view is session-only machinery; historical results (M9.2) are
  read from the payload store and never open, copy or inspect a source.
- The payload store's own `.staging/` left by a crash is still not reclaimed:
  it is beside the user's document, not in the work area, and outside this
  decision.
