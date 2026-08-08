# ADR 0013 — The serial Thermo RAW conversion queue

- Status: Accepted for a bounded, serial, session-scoped queue of evidenced
  Thermo RAW regular-file workspace datasets, on one evidenced provider build,
  into one local folder, under one conflict policy; cancellation, parallelism,
  persistence and every other family separately gated
- Date: 2026-08-08

## Context

[ADR 0012](0012-first-visible-thermo-conversion.md) made one conversion visible
and said plainly what it was not: *"One slot, and it is not a queue."* Its open
gate named this work — *"the next conversion work is a serial multi-file queue
with per-file failure isolation and retry, and cancellation stays out of it
until there is evidence that a `msconvert` process tree can be terminated
cleanly."*

This ADR is that queue, at exactly that scope. Cancellation is still out.

## The exact claim

> A user can queue a bounded set of selected, evidenced Thermo RAW regular-file
> workspace datasets for serial conversion to mzML, using one local destination
> folder and one Fail-or-Skip conflict policy. One file's failure does not stop
> later files. Retry reruns only failures Rust explicitly marks retryable.

Not: arbitrary vendor RAW queues, directory-format acquisitions, parallel
conversion, cancellation, resumable jobs that survive an app restart, source
fidelity verification, automatic import of the outputs, automatic preview of the
outputs, or overwrite.

## Decision

### The queue replaces the slot rather than sitting beside it

`ConversionSlot` still holds at most one thing, and that thing is now a
`ConversionQueue`. A single-dataset conversion is a queue of one.

Two protocols would have been two sets of transitions, two reload paths and two
places to get the busy rules right. The old `completed` and `failed` states are
gone; there is one `terminal`, and what happened is read from the queue's items
and its counts. `WorkspaceConversionState` is `idle | awaitingDestination |
running | terminal`, and every non-idle member carries `queue`, singular.

Starting a queue replaces the previous one. There is no member holding a list of
queues and no per-item member holding a list of attempts: an item carries its
latest report or its latest refusal, plus the number of attempts it has had. An
unbounded history is the one thing a session-scoped slot must not accumulate.

### The bound is sixteen, and it is a stated number

`MAX_CONVERSION_QUEUE_ITEMS = 16`, enforced in Rust, reported to the interface
as the plan's `capacity`, and refused with `queue_too_large`.

The reasoning, because a bound chosen silently is a bound nobody can argue with:

- The queue is **serial** and **cannot be cancelled**. Whatever a user starts,
  they wait out. That is the constraint that decides the number — not memory,
  not the registry, not any limit of the boundary beneath.
- The M3.0.3 fixture converts in about half a second, but it is a derived
  single-scan file. A real acquisition is minutes. At one to three minutes each,
  sixteen is roughly sixteen to fifty minutes of unstoppable work — long, and
  still a decision a person can make deliberately.
- It is far below the 1,024-row workspace capacity, so "select everything and
  convert" is refused by a rule rather than accepted into an hours-long run.
- It is small enough to state in a sentence, show as a list without scrolling
  being the point, and test exhaustively.

Raising it is a decision about how long a user may be committed for, and it does
not become a different decision until cancellation exists.

### The order is the caller's, and it is the visible order

The frontend sends an ordered list of opaque handles. Rust runs that list, in
that order, and does not re-derive it. The list the frontend builds is the
roster's *visible* order — after the user's search and sort — because that is
the order they are looking at when they press the button.

Re-sorting or re-selecting after the queue is bound changes what is on screen
and not what will run. That is the same rule ADR 0012 set for the single
conversion, applied to a list.

### Two items that would write one name are refused

Not resolved, and not settled by the conflict policy. The policy answers "what
if something is already there", which is a question about the folder; two items
of one queue fighting over one output name is a question about the queue, and
letting its order pick the winner would make the result depend on a sort the
user can change.

`queue_output_name_collision` is raised during planning — before a picker opens,
before a reservation exists, before anything is created — and it names the
colliding output names so the interface can say which rows to fix. The same rule
refuses a list naming one row twice, which would collide with itself.

Names are compared the way the destination will resolve them, not the way Rust
compares strings. The folder is a local Windows directory by admission, and an
ordinary one answers `Sample.mzML` and `sample.mzML` with the same file — so a
case-sensitive comparison would call that pair distinct and then discover the
conflict after the picker, as the second item failing or being skipped. The fold
used is Unicode simple lowercasing rather than the uppercase table a volume
actually applies; where the two disagree this refuses a pair the volume might
have kept apart, which is the safe direction for a rule whose whole purpose is to
refuse.

### One destination and one policy for the whole queue

One folder, chosen once, admitted once, under ADR 0012's rules unchanged: local,
a real directory, not a link, not UNC, not a mapped or otherwise remote volume.

The queue retains that folder for its whole life, including across a retry, so
the user is not asked again. It retains it as an **object**, not as a name: the
volume serial number and the 128-bit file ID are read from the handle admission
already holds, and the name is re-admitted and refused unless it reaches the same
object. A platform that will not answer with an identity is read as a refusal,
because there is no weaker comparison worth falling back to.

That proof is repeated before **every item**, not once for the queue. Admission
holds the directory only while it is judging it, so between one item and the next
the name could come to mean a different directory — and that item's plan would
take the substitute as its baseline and write into it. The crate's own root lock
covers the run itself; this covers the gap in front of it.

### One backend binding and one lane, for the whole queue

The provider is bound once and the evidence question is asked once, before the
first item creates anything. Binding per item would let one batch span two
installations, and the evidence a conversion is gated on is a statement about one
exact build.

The backend gate is taken once and held until the queue is terminal. The busy
slot already refuses previews and workspace mutations; what the gate adds is the
callers the slot does not refuse — a backend recheck is not a workspace mutation,
and its process would otherwise slip between two items of a batch the user is
watching.

One installation, and a retry is not an exception. The queue records the
installation its first pass resolved to and every later pass must find the same
one, or the queue is refused with `queue_installation_changed`. Without that, a
user who switched ProteoWizard between a run and its retry would get some of one
queue's files from one build and the rest from another, which is not a batch
anybody can compare — and the interface would present it as one result.

A refusal that lands on a retry puts back what the retry moved. `begin_retry`
returns retryable failures to pending, so a refusal after that point would leave
them neither failed nor run: counted nowhere, no longer retryable, and lost to a
user whose retry was refused for a reason they could have fixed.

No workspace lock, no mutation gate and no slot lock is held while a process
runs. Each is taken briefly to read a row or commit a transition and released
before the next item starts.

### A failure belongs to its item

Each item is converted through the same boundary a single conversion used, with
everything re-established rather than remembered: the row is revalidated under
the family it was queued as, held against replacement, and re-admitted as a
conversion source whose object identity must match the one the session holds.

Whatever that produces — a report or a refusal — is recorded against that item,
and the queue moves to the next one. Nothing is rolled back: a file already
finalized stays finalized, because deleting a user's converted data because a
later, unrelated acquisition failed would be the queue destroying work it was
asked to do.

A run that finalized nothing names no output file, exactly as ADR 0012 requires.

### Retry is a classification, not a button

`Retry` reruns only the items Rust marks retryable, in their original places,
against the same folder and the same policy. Successes, skips and non-retryable
failures keep their results and are not run again. The attempt count goes up for
what actually ran.

The classifier is **total over the boundary's failure types**, matched by type
rather than by identifier string. Both parts matter. Matching on types means the
compiler refuses to build when the crate gains a failure variant, so a new
failure cannot arrive silently classified. Matching on identifiers would also
have been wrong on its own terms: `source_not_rehashed` is emitted by two
different variants at two different phases, so the strings are not a partition.

What it actually says is narrow, and deliberately:

| Answer | Retryable | Why |
| --- | --- | --- |
| Finalized, or skipped by policy | No | Not a failure. |
| `DestinationRootNotOpened` other than `NotFound` | Yes | The folder is there and could not be opened *now*. |
| `DestinationRootNotOpened { NotFound }` | No | A folder that is not there has nothing to succeed at. |
| Every other run failure | No | Nothing in this repository has measured them as transient. |
| Refusal `file_unreadable` or `source_in_use` | Yes | The acquisition is there and could not be read *now*. |
| Every other refusal | No | It says what the row or the request *is*, and rerunning cannot change that. |

The two refusal identifiers are one physical condition seen through two opens.
Measured on this path: when another program holds the acquisition open for
writing, the crate's source admission refuses first and refuses with
`file_unreadable`; the replacement lock, which reports the same condition as
`source_in_use`, is never reached because revalidating the row runs first. Both
are listed, because which open loses the race is an ordering detail inside one
file and not a different thing happening to the user's acquisition.

Nothing that the M0 spike's `Retryability` contract calls `Retryable` is
inherited here. That contract classifies only `ProcessError` and `ProcessOutput`,
it is used by the spike alone, and where it speaks to this path at all it says
`AfterCorrection` — never `Retryable`. Its three `Retryable` arms reach that
verdict through an unmeasured catch-all. Reusing it would have been borrowing
confidence that was never measured.

Residue blocks a retry whatever else was wrong: a staging directory is named
deterministically from the plan, so the next attempt at the same plan would find
it and refuse with `staging_target_exists`, and reclaiming a directory this run
did not prove it owns is not something this workflow offers.

### The interface shows items, not a percentage

Progress is `Converting item N of M`. Nothing measures a fraction of an
`msconvert` run, and this workflow still cannot stop one — so there is no
percentage and no Cancel, and the panel says so while it runs.

Each item shows its position, its source name, its planned output name, its
state in words, its attempt count once it exceeds one, its failure sentence if it
has one, and — where it produced a file — that file's size, spectrum and
chromatogram counts and elapsed time. The last of those is what separates a real
conversion from a file with the right name and nothing in it, and a queue that
said only `Converted` would have taken it away. A staging residue is said too,
because what was left behind is in the folder the user chose.

The output-only disclosure appears only where something was actually judged. A
queue whose items were all skipped validated nothing, and a skipped item's
existing file was explicitly not inspected — claiming output-only validation over
it would claim a check nobody ran.

A retry is one command that does not answer until the whole rerun is over, and it
has no reservation half to announce that it began. The interface therefore treats
its own dispatched-and-unanswered retry as busy: it stops offering Retry, Add and
Clear for the length of the rerun rather than for its first moment. That is not
an invented conversion state — it reports that this document asked and is
waiting, which is what `pickerBusy` and `folderBusy` already report elsewhere.

Every member of a live queue stays visible outside a search, and the row being
converted says so above the rest. `Retry N failed` states its scope in an
`aria-describedby` sentence: which items it reruns, and that converted and
skipped files are left as they are.

### The boundary carries handles and a policy, and nothing else

`describe_workspace_conversion_queue(handles)` and
`begin_workspace_conversion_queue(handles, conflictPolicy)` are the only new
inputs, and they accept an ordered list of opaque, session-scoped handles and one
closed policy member. No path crosses in either direction. The destination is
still chosen by a Rust-owned native picker behind ADR 0012's two-phase
reservation, with the same per-document authority proof.

`retry_workspace_conversion_queue` takes nothing at all, and proves the calling
document anyway. It opens no dialog, but it launches processes and writes files
this application creates, and authority over that is not weaker because the
folder was chosen a minute earlier. What it proves is that the caller is the
*current* document rather than the one that built the queue — a reloaded document
recovered the queue and is entitled to retry it, which is the same reason the
slot is read rather than pushed.

Nothing on the wire carries a source path, a destination root, a staging path, an
absolute output path, a raw handle, a filesystem identity, an internal epoch, a
backend token, process output, or a raw OS error.

## Consequences

The registered command surface grows from 17 to 18: `begin_workspace_conversion`
becomes `begin_workspace_conversion_queue`, the plan description becomes
`describe_workspace_conversion_queue`, and `retry_workspace_conversion_queue` is
new. None accepts a path.

`ConversionPlanSummary` and its DTO are gone rather than kept beside the queue
plan. A declared wire shape that nothing sends is a false statement about the
boundary.

`WorkspaceConversionStateDto::{Completed, Failed}` are gone. Reading what
happened now means reading the queue, which is the same operation for one item
and for sixteen.

## Evidence

### Deterministic coverage

Rust: 380 tests, none needing an installation. Frontend: 493, none needing a
WebView. Between them they cover queue planning and every one of its refusals,
the visible order surviving a sort, serial execution observed while parked at the
first item, one binding and one lane, failure isolation with a later item still
running, the absence of rollback, the retry classifier in both halves, the
destination-identity check, reload recovery, the exact serialized member sets,
and the layout rules the queue list rests on.

### Real conversion, on a real installation

Run on the implementation head, through the product path — `add_files`, then the
reservation the destination picker claims — against the evidenced build.

| Fact | Value |
| --- | --- |
| Installed build | release `3.0.26013`, revision `47b13cf`, `msconvert.exe` SHA-256 `9BB6F5D5…D590BD`, verified before the run |
| Acquisition | `FT-HCD-MSX.raw`, upstream commit `8f945db3`, `78,309` bytes, SHA-256 `B3D97B38…DD7B` |
| Copies | three distinct objects — `alpha.raw`, `bravo.raw`, `charlie.raw` — each with its own filesystem identity |
| Admitted as | `file-0`, `file-1`, `file-2`, all `thermo_raw`, through `add_files` |
| Queued order | `charlie`, `alpha`, `bravo` — deliberately not the order the workspace holds |
| Plan | mzML, `zlib`, output-only, capacity `16` |
| Outcome | `3` finalized, `0` skipped, `0` failed, `1` attempt each |
| Output order | `charlie.mzML`, `alpha.mzML`, `bravo.mzML` — the queue's order, not the registry's |
| Outputs | `28,652` / `28,646` / `28,646` bytes; 1 spectrum and 1 chromatogram each; distinct SHA-256 per file |
| Concurrency | peak `1` concurrent `msconvert.exe`, sampled 4 times during the run |
| Concurrency, independently | wall `2,057 ms` against `1,614 ms` of summed backend time — three processes beside each other could not |
| Destination | exactly three files; no sidecars; no staging residue on any item |
| Validation | `OutputOnly` on every item; 9 verified, 0 unverified, 11 inapplicable; none fully verified |
| Wire | the serialized update names no path — checked against the acquisitions' and the destination's own strings |

And failure isolation, on the same build and fixture, with a file placed where
the middle item's output would go:

| Fact | Value |
| --- | --- |
| Queued | `one.raw`, `two.raw`, `three.raw`, policy `Fail` |
| Outcome | `one.mzML` finalized, `two` failed `destination_exists`, `three.mzML` finalized |
| The failed item | no backend process, no output file name, no residue, not retryable |
| The occupying file | byte-for-byte unchanged |
| Destination | the two outputs and the occupying file, and nothing else |

The acquisition, the copies and the outputs were deleted afterwards. No vendor
data is committed.

### What the mutation set found

Thirteen focused mutations, each a single faithful expression of one thing the
queue must not do. Eleven were killed by the suite as written. Two survived and
are worth recording, because a survivor is a gap in the tests and not a curiosity:

- **Sorting the queue back into registry insertion order survived**, because the
  order test added its acquisitions in the same order it queued them. It now adds
  them in one order and queues them in another, and the mutation dies.
- **Releasing the backend lane between items survived**, because every
  interleaving the concurrency test attempted was already refused by the busy
  slot. It now watches the one caller the slot does not refuse — a backend
  recheck — and finds it waiting for the lane.

### What the rules ended up making unreachable

- **The residue guard on retry.** Nothing this repository classifies as
  retryable happens after a staging directory exists: the one retryable run
  failure is the destination root failing to open, which is before staging. The
  guard is kept, because a later classification would need it, and it is tested
  directly rather than left looking load-bearing.
- **`source_in_use` on the conversion path.** Measured above: revalidation
  refuses the same condition first, with `file_unreadable`. The identifier stays
  in the classifier because it is the same condition and because the preview path
  does reach it.
- **The per-item destination recheck, as a scheduled event.** The rule it applies
  is pinned directly; the window it runs in is not something these fakes can
  schedule. Releasing a parked item and racing the next item's recheck to swap a
  directory between them is a coin toss, and a test that loses it would fail for
  a reason the product is not wrong about. What is tested is the comparison the
  recheck is built on, including the two cases where it must refuse although the
  name still resolves.
- **The retry's second destination check.** Admitting a directory is filesystem
  work, so proving the folder is still the same object cannot be done while
  holding the slot lock. That leaves a window in which another document could run
  a whole further queue and make *its* destination the terminal one, so the retry
  re-reads the terminal destination under the slot lock and refuses unless it is
  the one just proved. Reaching that window needs a second document to complete
  an entire queue between one thread's two statements; the deterministic suite
  cannot schedule it, and it is recorded here as defence in depth rather than
  left looking like a live guard.

## Open gates

- **One acquisition, one build, one family.** Unchanged from ADR 0010 and 0012.
  Widening any of them is a measurement.
- **No cancellation.** A queue of sixteen is up to roughly an hour a user cannot
  stop. The next conversion work is a real ProteoWizard cancellation and
  partial-output evidence slice, and no cancellation UI may be added before it
  passes: a control that only stopped watching would be a lie about what it does,
  and terminating a process tree mid-write without knowing what it leaves behind
  is worse than not offering to.
- **No parallelism.** One lane, deliberately. Two `msconvert` processes on one
  machine is a measurement nobody here has taken.
- **No persistence.** A queue survives a WebView reload because its state is in
  Rust. It does not survive an app restart, and the converted files are the
  durable artefact.
- **Retryability is narrow by construction.** Two conditions are classified
  retryable because two were measured. Everything else answers "no", and a
  failure that another attempt genuinely would fix is currently a failure the
  user reruns by queueing the row again.
- **The bound is a judgement, not a measurement.** Sixteen comes from an
  estimate of per-acquisition conversion time, not from timing sixteen real
  acquisitions on this build.
