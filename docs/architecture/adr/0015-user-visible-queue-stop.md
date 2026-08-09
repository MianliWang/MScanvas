# ADR 0015: a user-visible queue stop

- **Status:** Accepted. One queue-level Stop is reachable from the product;
  per-item cancellation, resume and retry-after-stop are not.
- **Date:** 2026-08-08
- **Builds on:** [ADR 0013](0013-serial-conversion-queue.md) (the serial queue)
  and [ADR 0014](0014-proteowizard-cancellation-evidence.md) (the private
  cancellation primitive and the measured race rule).

## Context

ADR 0013 shipped a queue of up to sixteen conversions that says out loud it
cannot be stopped, and recorded that as its largest open gate: sixteen items is
up to roughly an hour a user cannot interrupt. It refused to add a control
before two things were measured — that a real `msconvert` process tree can be
terminated, and what the partial document it leaves behind does.

ADR 0014 measured both, on the evidenced build, through the production process
boundary. The tree terminates and the Job Object confirms it; the partial output
is written in place under the planned name, so private staging is what keeps it
out of the user's folder; identity-bound cleanup removes it with no residue.
That closed the mechanical objections and left the product question, which this
ADR answers.

## Decision

### One action, and it is about the queue

The action is **Stop queue**. It requests cancellation of the attempt under way,
begins no item after it, keeps every finalized output exactly where it is, and
reaches one terminal state.

It is deliberately not called *Cancel*. Cancel suggests undoing, and the one
thing this must never be read as is a rollback: files that finished are in the
user's folder and are theirs. The copy says both halves before the action is
pressed, because a control whose consequences are only discovered afterwards is
not a control anyone can use deliberately:

> Stops the current conversion and prevents remaining items from starting.
> Outputs already completed stay in place.

There is no confirmation dialog. The sentence above is the confirmation, and it
is on screen before the press rather than after it. A generic confirm framework
would be a second decision surface for a workflow that has exactly one.

There is **no cancel-current-and-continue**, no pause, no resume and no per-item
cancellation. Each is a different promise about work already begun, and none of
them has been asked for by anything measured.

### The race rule is ADR 0014's, unchanged

Observation order inside the supervision loop decides the current item. A
completion already observed keeps its ordinary result — finalized, skipped or
failed — and is **not** relabelled because the user pressed Stop near its end. A
request observed while the process is still running makes confirmed Job
termination decisive.

Nothing predicts which. While a stop is in flight the interface says only that
no further item will start and that the current conversion may still finish on
its own, because a prediction here is a claim the next read could contradict.

The real product-path run found both halves. In one, the request reached a
running `msconvert` and the item was cancelled; in another it landed after the
first item had finalized, and that output stayed.

### What the states mean

| Queue | Meaning |
| --- | --- |
| `running` | Items are converting in order |
| `stopping` | A stop was accepted; no further item will start |
| `terminal` + `completed` | Every item reached an outcome of its own |
| `terminal` + `stopped` | The user stopped it, and no converter process survives |
| `terminal` + `stopFailed` | The user stopped it, and termination could not be confirmed |

| Item | Meaning |
| --- | --- |
| `cancelled` | Stopped while running, owned tree confirmed gone, nothing finalized |
| `notRun` | The stopped queue never began it — no process, nothing created |
| `cancellationFailed` | Stopped while running, termination not confirmed |

`stopping` is a state rather than a flag beside `running`, so nothing can read
"running" and conclude another item may start. The terminal reason is carried
rather than inferred, because a completed queue of nothing but failures and a
queue stopped after one success are indistinguishable from item counts alone.

A cancelled item is **not** a failure and a not-run item is **not** an attempt.
They are counted apart, and the summary names every count including the zeroes,
because the number a user most needs to trust is how many files are in the
folder.

### One request handle, one exact attempt

The queue slot holds a monotonic stop flag for the life of one operation, plus
at most one request-only handle bound to an exact `(operation, item, attempt)`.
The handle is released when that exact attempt settles, so a handle left over
from an earlier item or an earlier retry round cannot be mistaken for the live
one. Nothing generic is introduced: there is no task registry, no identifier
scheme and no job framework, and the private cancellation object never crosses
the transfer boundary.

The stop command records the request and moves the state under the slot lock,
and asks for cancellation **outside** it. Termination is not instantaneous, and
holding the lock every reader needs across it would stop the interface answering
for as long as it took — including the read that tells the user their stop was
accepted.

The worker asks whether a stop was requested after it takes the backend gate,
before every item, and after every item settles; and `start_item` refuses
outright once the flag is set, so a request landing between the check and the
transition still cannot begin an item.

### Authority is the retry model, reused

The command takes the operation identifier the caller is looking at and proof of
being the current document — the same per-document authority a retry already
proves. No path, item, process identifier, job handle or cancellation object
crosses.

A reload may stop the queue it recovered; a document that has been replaced may
not stop its replacement's work. A stale operation identifier, an idle slot, a
picker still open and a queue already over all answer with one refusal, because
telling them apart would describe session state to a caller that by construction
is not the one running it.

Repeating a stop for the same queue is idempotent and is answered with the
authoritative state rather than a refusal: a user pressing twice is asking for
what is already happening.

### An unconfirmed stop is not a stop

ADR 0014's `CancellationFailed` proves nothing about survivors — it exists
precisely for the two cases where the boundary cannot say the owned tree is gone.
So a queue that reaches it becomes `stopFailed`, never `stopped`, and the
session enters **backend quarantine**:

- new preview, spectrum load, conversion, retry and installation change are all
  refused, because every one of them launches a process;
- roster reads, search, sort, selection and focus stay usable;
- the interface says, without any process detail, to restart MSCanvas.

The flag is set once and never cleared. Nothing in the session can establish
that the process it lost track of has ended, so there is no observation a reset
could be conditioned on, and a flag that cleared itself would be telling the
user something MSCanvas does not know. No process recheck is invented: the
boundary exposes no identifier that would make one meaningful.

The backend gate is held across the whole attempt, so it is released only after
the process ended naturally, cancellation was confirmed, or the boundary
returned that distinct failure. The gate itself is not held forever — that would
wedge the application — and quarantine, not the gate, is what refuses the next
operation.

Application exit still kills the owned Job Object through
`KILL_ON_JOB_CLOSE`. That is not a substitute for an in-session confirmation and
is not offered as one.

### A stopped queue is terminal

It is not retried in place, whatever it holds. A cancelled item has nothing to
correct, a not-run item never ran, and a queue whose stop could not be confirmed
must launch nothing at all — and even a genuinely retryable failure recorded
before the stop does not reopen it, because the user asked for the whole batch
to stop rather than for part of it to be rerun.

Converting those rows again is a new queue, made from the roster through the
selection workflow that was always there. `Retry failed` is unchanged for a
queue that ran to its own end.

### While running or stopping

Rust refuses Add files, Add mzML folder, Explorer drop, Clear list, a new
preview, a selected-spectrum load, a new queue, Retry failed and the removal of
any row the queue holds. Roster reads, search, sort, focus movement, selection
changes, removal of unrelated rows and an already-loaded preview all stay
available. A stopping queue protects its rows exactly as a running one does: the
attempt has not settled, so the row may still be being read.

Disabled controls in the interface are a projection of those rules, never the
rules.

### What a stop does not interrupt

A stop is asked for at four points: after the backend gate, before the backend
is resolved, before every item, and after every item settles. Between those
points it is observed rather than acted on, and the largest such interval is
backend resolution, which runs each installed tool's help with its own timeout.
A stop landing inside that is honoured the moment it returns, so nothing further
is launched and no item begins — but the interface can say it is stopping for as
long as the probing takes.

That is accepted rather than fixed here. Making it interruptible means threading
a cancellation request through discovery so a probe can be terminated mid-flight,
which is a change to the process boundary rather than to this queue, and it buys
latency in one window rather than correctness anywhere. The bound is a
resolution's own timeouts; nothing is created, nothing is converted, and the
queue that follows is `stopped` with every item `notRun`.

### Reload

A reload does not cancel anything. The replacement document reads the slot and
recovers the running or stopping state, the stop request, the current item, every
per-item result, the terminal reason and the quarantine. It does not re-issue a
stop, does not create a second worker, does not restart the current item and is
not offered a Stop control for a queue that is already over. It may issue Stop
against the queue it recovered.

### Not in this slice

No percentage — nothing measures a fraction of one item, which ADR 0013 already
records. No app-restart persistence. No output rollback. No parallelism. No
output auto-import or auto-preview.

## Consequences

- The queue's largest recorded gate is closed. A user who queued sixteen files
  can stop them.
- `ConversionQueueItemStateDto` gains three members and the terminal state gains
  a reason, so every exhaustive match over them had to be answered for. That is
  the intent: the states are closed on both sides of the wire and pinned by
  contract tests.
- Quarantine is a session-ending state for backend work, and it is reachable
  only from an unconfirmed stop. It is the first state in this product a user
  can enter that a restart is the only way out of, and it says so.
- The item DTO still carries the planned output name for every item, including
  a cancelled one. That is the name the plan derived and the queue displays
  throughout; the claim that a file *was produced* lives in the report, and a
  cancelled item has none.
- Because a cancelled item has no report, anything a report would normally carry
  has to be read from its cancellation facts instead. Staging residue is the one
  that matters to the user: what cleanup failed to remove is in the folder they
  chose, so it is said for a cancelled item exactly as it is for a finalized one.
- A queue whose stop could not be confirmed is never headed "Queue stopped". The
  heading someone skims is the one place the unqualified claim must not be made
  and then walked back by the warning below it, so both the panel and the live
  region say the stop could not be confirmed.

## Alternatives considered

**Cancel current, continue with the rest.** Rejected for this slice. It is a
second promise with its own failure modes — what happens to the item after a
cancelled one, whether the queue is still a batch — and nothing measured asks
for it. Stop queue is the action a user who wants their machine back is
reaching for.

**A confirmation dialog.** Rejected. The consequences fit in two sentences, and
those sentences are more useful before the press than in a modal after it.

**Calling an unconfirmed stop `stopped` and carrying on.** Rejected outright. It
would let MSCanvas launch a second converter beside one it has lost track of,
over the same folder, and report both as ordinary work.

**Clearing quarantine on the next successful operation.** Rejected. The next
operation succeeding says nothing about the process that was never confirmed
gone, and the clearing would be exactly the false reassurance the state exists
to avoid.

**Offering Retry failed on a stopped queue.** Rejected. Rerunning part of a
batch the user stopped answers a question they did not ask, and the roster
already offers the honest way to convert those rows again.
