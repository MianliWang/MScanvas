# ADR 0016: explicit converted-output adoption

- **Status:** Accepted. A terminal queue's finalized outputs enter the workspace
  when the user asks, and never otherwise.
- **Date:** 2026-08-09
- **Builds on:** [ADR 0006](0006-multi-dataset-workspace-boundary.md) (the
  workspace registry and its identity leases),
  [ADR 0009](0009-mzml-conversion-execution-boundary.md) (finalization),
  [ADR 0013](0013-serial-conversion-queue.md) (the serial queue) and
  [ADR 0015](0015-user-visible-queue-stop.md) (the queue-level stop).

## Context

A conversion writes an mzML file into a folder the user chose, and then the
workflow stops. Reaching that file meant going back to `Add files…` and finding
it again — which works, and which is a strange thing to ask of someone who just
watched MSCanvas make it.

The obvious fix, adding outputs when a queue finishes, is the one thing this
must not do. The workspace is a list the user curates; filling it from a
background process decides what they are working on. ADR 0013 recorded that
outputs are deliberately not adopted, and left the explicit action open.

What makes an explicit action more than a shortcut for `Add files…` is that
MSCanvas knows something about these files that admission cannot: it made them,
it measured them, and it can keep hold of the objects. Between finalization and
the moment the user asks, the final name is an ordinary name in a writable
folder — it can be given to a different object, and the object it named can be
deleted and its file id reissued.

## Decision

### Adoption is explicit, and takes a whole queue

One action on a terminal queue: **Add converted outputs to workspace**, singular
when one output is eligible. It adopts every finalized output of that queue, in
the queue's own order.

Not a roster selection and not a subset the interface chose. The queue on screen
is what the user is looking at when they press it, and the list the panel drew is
the list they are asking about. Only `finalized` items are eligible: `skipped`,
`failed`, `cancelled`, `notRun`, `cancellationFailed`, `pending` and `running`
produced no output of this queue's to offer.

Nothing is previewed. Reading a file is a separate thing to ask for, and a
workflow that opened one would be deciding what the user is looking at — the
same objection that makes adoption explicit in the first place.

### The invariant: the exact object, and the exact bytes

An output enters the workspace only when both hold:

1. the final name still resolves to the exact filesystem object this queue
   finalized;
2. that object still holds the byte length and SHA-256 the validation measured.

Neither implies the other. Identity alone admits a file rewritten in place;
a digest alone admits any copy, including one MSCanvas was never told about.
Path equality and filename equality establish neither.

The object those questions are asked of is **the object the registry is about to
hold** — the accepted file's own lease — rather than a second opening of the same
name. That closes the gap between the proof and the thing proved. A
writer-excluding hold spans the check, so the answer cannot go stale between
being given and being acted on.

### What is retained, and what it costs the user

Finalization used to release the object it had just renamed. It now reopens that
object *from its own handle* — `ReOpenFile` names an object rather than a path,
so this is the same object by construction — with the same fully permissive
sharing the workspace's own leases use, and releases the renaming handle
immediately.

The renaming handle withholds write sharing, and keeping it would have forbidden
the user from writing to their own finished file for as long as the result stayed
on screen. Three existing finalization tests caught exactly that, which is why
the retention is a reopen rather than a hold.

So the retention buys exactly one thing: the object cannot cease to exist while
it is held, and its identity cannot be reissued to something else. It
deliberately buys nothing else — writing, renaming and deleting the output all
remain ordinary things to do — which is precisely why the byte comparison is
load-bearing rather than belt-and-braces.

### The ticket

Each finalized item retains one private adoption ticket binding the queue
operation, the source row and its display name, the output basename, the
admitted destination identity, and the retained object with its validated length
and digest.

Private, unserialized, opaque in `Debug`, with no raw-handle accessor and no path
in routine formatting. Bounded by the queue's existing sixteen items. Created
only from a finalization that happened, and never reconstructed later from a name
and a report — reconstructing one would be exactly the path-trusting this exists
to avoid. Dropped when the queue is replaced or the process exits, and dropping
one closes a handle and nothing else.

### Partial success, in queue order

One output that is missing, replaced, modified, unreadable or no longer valid
does not stop the others. Outcomes are closed, path-free and in queue order:
`added`, `alreadyInWorkspace`, or `refused` carrying one of `output_missing`,
`output_changed`, `output_unreadable`, `output_not_mzml`, `workspace_full`.

A replaced object and a rewritten one are both `output_changed`: they are one
answer to the user — that is not the file we made — and separating them would ask
them to care about a distinction they cannot act on.

Registry semantics are the existing ones, unchanged. Duplicates are decided
before capacity; a duplicate returns the existing row and keeps its original
origin; and no identifier is consumed by a duplicate, a refusal or a full
workspace.

Command-level errors remain for the questions that are about the request rather
than about a file: a stale document, an operation that is not the current
terminal queue, an adoption already under way, and a workspace that moved.

### Linearization

Adoption hashes files, so it cannot hold the workspace-mutation gate across the
part that reads them. It uses the existing generation pattern in three parts:

1. under the gate — prove the document, prove the terminal queue, reserve a
   generation, take the tickets;
2. outside every lock — check and accept each output;
3. under the gate again — require the generation and the queue to still be
   current, then commit contiguously in queue order.

A mutation that wins in between means **nothing** is added: not a partial commit
against a workspace this run never saw. `adoption_superseded` says so and is
retryable, because the outputs are still there and the queue is still terminal.

A reload participates in the same order. Either the adoption commits first and
the replacement document's roster read includes it, or the replacement reads
first and the old adoption is superseded. An abandoned document cannot add rows
the replacement never learns about.

While an adoption is between its halves, Rust refuses every workspace mutation,
a new queue and a retry. Roster reads, search, sort, focus, selection and an
already-open preview stay available. Disabled controls are a projection of those
rules, never the rules.

### Source kind and origin

Every adopted output is `DatasetSourceKind::Mzml`. There is no second family.

A private, session-only origin records the source row, its display name and the
queue operation. It exists so a converted file is not described as `Added
directly`, which would be the one thing about it that is false. It is not
identity, not a path, not searched, not sorted by, and not consulted for
duplicates. Where identical filenames need disambiguating it renders as
`Converted from <source basename>`, falling back to the existing workspace-item
tie-break. Destination folders and former source paths are never exposed.

### Stopped, stop-failed and quarantined

A stopped queue and a stop-failed queue both retain any outputs they finalized
before the stop, and both remain adoptable. Backend quarantine does not block
adoption, because adoption launches no process; adoption does not clear
quarantine either. An adopted row may enter a quarantined session's workspace,
and previewing it stays refused under the existing policy.

### No persistence

Tickets are session-scoped and do not survive a restart. After one, the outputs
are ordinary mzML files and `Add files…` is the way to them. That fallback is
stated in the panel before it is needed rather than left to be discovered.

### One ordering the interface approximates

Rust's own commit order is authoritative and total: the mutation generation
orders every workspace decision, and an adoption commits under that gate after
anything that preceded it. The interface orders replies by a counter it advances
when a request is *dispatched*, which matches that order in every case except
one — a native drop that has already claimed Rust but whose first update has not
yet reached the document. There the adoption is recorded first while Rust in fact
serialised it second, and the adoption's reply can decide it was superseded and
install nothing.

The consequence is bounded and is not loss: Rust committed the rows, the roster
it answered with is correct, and the next authoritative read shows them. What is
missed is the immediate update.

Closing it properly means carrying the committed workspace generation on the
adoption result and ordering on that rather than on a locally counted
approximation — a wire change, and one that belongs with the same treatment for
the folder and drop replies rather than for adoption alone. It is recorded here
rather than half-done.

## Consequences

- `ConversionRunOutcome::Finalized` now carries the object rather than only what
  was read out of it, which is what makes recognition possible at all.
- The workspace gains a third origin and a fourth admission entry point, all
  sharing one insertion, one duplicate rule and one capacity rule.
- Adoption is the first workspace mutation that does slow filesystem work
  outside the gate it commits under, so it is also the first that can be
  superseded and answer that it did nothing.
- A converted output can be adopted, removed, and adopted again while the queue
  survives, because the ticket is about the object rather than about whether the
  session once held it.

## Alternatives considered

**Adding outputs when the queue finishes.** Rejected, and it is the decision this
ADR exists to make. It fills a curated list from a background process.

**Adopting a subset the user ticks.** Rejected for this slice. It is a second
selection model beside the roster's, for a set that is already on screen and
already ordered.

**Trusting the filename and the recorded digest.** Rejected. A digest without
identity admits any copy, and re-hashing a name says nothing about which object
answered to it.

**Keeping the renaming handle.** Rejected on evidence: it withholds write
sharing, so it would have silently forbidden the user from writing to their own
output. The reopen costs one call and takes nothing away.

**Re-running conversion-integrity comparison at adoption.** Rejected. It answers
a different question — whether the conversion was faithful — which was already
answered when the file was made, and it would not establish which object is being
admitted.
