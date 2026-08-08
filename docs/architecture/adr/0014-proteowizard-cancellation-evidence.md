# ADR 0014: private ProteoWizard conversion cancellation

- **Status:** Accepted for the private boundary. No user-visible cancellation
  exists, and none may be added on this ADR alone.
- **Date:** 2026-08-08
- **Supersedes:** the *Cancellation* section of
  [ADR 0009](0009-mzml-conversion-execution-boundary.md), which put it out of
  scope because it was unmeasured.
- **Evidence:** [M3.3 cancellation evidence record](../../spikes/M3_CANCELLATION_EVIDENCE.md)

## Context

Everything cancellation needs was already built and none of it was reachable.

The process boundary creates each backend child, assigns it to an owned Windows
Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, starts stdout and stderr
capture threads, and supervises the wait. It has carried a `CancellationToken`
and `TerminateJobObject` since M0, and the M0 spike proved process-tree
termination against a controlled parent-and-grandchild tree.

But `ProcessRunner` had one entry point, `SystemProcessRunner::run` always
handed `execute` a token nobody held, and `run_conversion` could not request
anything. ADR 0009 rated real cancellation and partial-output behaviour **D**
and named it as required "before a queue can offer cancellation";
[ADR 0013](0013-serial-conversion-queue.md) shipped a queue that says out loud
it cannot be cancelled, and named this slice as the next conversion work.

Two questions had never been asked of a real backend. Can `msconvert` be stopped
on request, and what does it leave behind when it is?

## Decision

### One request, one attempt

`ConversionCancellation` is created per conversion attempt and taken by value.
It is not `Clone`. That is the whole enforcement: a run consumes it, so there is
no second run it could be given to, no reset, and no reuse. `CancellationRequest`
is the clonable handle a caller keeps and moves to whichever thread decides to
cancel; it can make the request and read whether it was made, and nothing else —
no path, no handle, no process identifier, no callback.

The request moves once, from not requested to requested, and never back. A
request cannot be withdrawn because the process it stops cannot be
un-terminated, and a withdrawable request would invite callers to pretend
otherwise.

Both types render an opaque `Debug` and neither serializes. A cancellation
object is not evidence about a run, and printing its state would invite it to be
read as one.

This is not a task framework. There is no registry, no identifier, no group and
no application-wide cancellation model. ADR 0007 defers the task/cancellation
protocol, and this does not pre-empt it.

### One runner, one new entry point

`ProcessRunner` gains a single defaulted method, `run_cancellable`. There is no
second subprocess implementation and there must not be: `SystemProcessRunner`
remains the authority for child creation, the environment, Job assignment,
stream capture, the wait and process-tree teardown, and it overrides the method
with the reviewed `execute_cancellable`.

The default matters as much as the override. It keeps the one guarantee a
substituted runner can keep without owning supervision — a request already made
launches nothing — and then delegates to `run`. It does **not** report a mid-run
cancellation, because it did not perform one. A caller cannot tell a real
termination from a claimed one from the outside, and a queue that believed it
could stop a running conversion that it cannot stop is worse than one that
admits it cannot.

### A confirmed cancellation is the only cancellation

`run_conversion_cancellable` returns `Cancelled` only when the owned Job Object
reported no surviving process. Everything else is something else:

| Situation | Result |
| --- | --- |
| Request preceded the attempt | `Cancelled`, observation `BeforeRun`: nothing inspected, created, planned or launched |
| Request arrived before the launch decision | `Cancelled`, observation `DuringRun`, no backend facts, no staging area |
| Request confirmed, owned tree empty | `Cancelled`, observation `DuringRun`, with bounded backend facts |
| Request made, termination or wait failed | `CancellationFailed`, carrying the process boundary's own typed reason |
| Request made, runner claims cancelled with surviving owned processes | `CancellationFailed(NotTerminated)` |
| Process exited on its own, request pending | `Completed` — finalized, rejected or failed on its own merits |
| Launch or capture failure coinciding with a request | `Completed(Failed(Backend(…)))`, keeping the reason true of it |
| No cancellation object supplied | exactly what `run_conversion` always returned |

"The tree is gone" and "the tree may still be running" are different facts about
the user's machine. Collapsing the second into the first would let a caller
report a stopped conversion that is still writing, which is why
`CancellationFailed` is a variant rather than a flag, and why a termination
failure still runs cleanup and reports its residue separately from the primary
failure.

### The ordering rule

**One rule, decided by observation order inside the supervision loop.**

Each poll consults `try_wait` before it consults the cancellation flag. So:

- a completion already observed makes the run an ordinary exit, and a request
  that arrives afterwards changes nothing — the document it produced is judged
  and finalized exactly as it would have been;
- a request observed while the process is still running makes successful owned
  Job termination decisive, **whatever exit status the racing process then
  reports**.

The second half has a measured consequence worth stating plainly. A run
cancelled 1,604 ms into a 1,598 ms conversion reported `Cancelled` with an exit
code of `0`: the process finished its work in the window between `try_wait`
returning "still running" and `TerminateJobObject` landing. Nothing was
finalized and the destination root stayed empty. That is the conservative
direction and it is the one this boundary takes: a request the boundary acted on
never yields an output.

Both halves are proved against the real backend. The completed half is proved
deterministically, by a runner that issues the request only after it has seen
the real process exit normally; the cancelled half is proved by three scenarios
in which Job termination was accepted first.

Only one of the two is ever reported. There is no state that is both.

### Cleanup authority is unchanged

Identity-bound teardown runs for a cancelled attempt exactly as for a completed
one, and it decides what to remove from the objects it holds and the identities
it proves. Nothing about cancellation correctness depends on observing the
staging tree.

The evidence harness does poll that tree while the backend runs, and what it
records is evidence and only evidence: entry count, ordinary file versus
directory, whether non-zero bytes were seen, whether growth was seen. A poll
that misses, races, or reads a directory mid-write costs a line of the record
and changes no outcome. The same is true of the `StagedContentObservation` the
run itself takes: a failure to read it produces `None` rather than an error,
because a run that has already confirmed its process tree is gone does not
become a different outcome because an observation for the record could not be
taken.

### Privacy

`CancellationReport` and `CancellationFailure` are path-free by construction.
They carry when the request was observed, whether a backend ran, bounded process
facts already published by `BackendRunFacts`, the count of surviving owned
processes, the bounded staging shape and the cleanup residue identifier. They
carry no source, staging or destination path, no output name, no process
identifier, no job handle, no raw stdout or stderr and no operating-system error
text.

A process identifier cannot leak here even by mistake: `ProcessOutput` has never
carried one, so there is nothing to copy.

## What the evidence established

On release `3.0.26013`, revision `47b13cf`, `msconvert.exe` SHA-256
`9BB6F5D5…D590BD` — the same installation ADR 0010 admitted a vendor family on,
and the only one the harness will run against.

- **Early cancellation.** Requested when the staged output file first appeared:
  the owned tree terminated with `STATUS_CANCELLED`, the Job reported zero
  surviving processes, the staging area was removed, the destination root stayed
  empty and there was no residue. Request to return: 94 ms.
- **Mid-write cancellation.** Requested after the staged file was observed
  growing, at 107,323 bytes of a 12,283,969-byte finished output. Same result:
  tree gone, partial document removed, destination empty, no residue. Request to
  return: 80 ms.
- **Partial-output shape.** This build writes its output **directly under the
  planned name and grows it in place**. No `.part`, `.partial` or `.tmp`
  suffix appeared in any observation, so a partial output is indistinguishable
  from a finished one by name. Private staging, not a suffix convention, is what
  keeps it out of the user's folder — and this measurement is what turns that
  from a design preference into a requirement.
- **Nothing else is written.** Every observation of the staging tree, including
  observations taken while a terminated backend was mid-write, held exactly one
  entry. No sidecar, index, log or scratch file, which is consistent with what
  ADR 0009's exactly-one-entry rule already depended on for completed runs and
  extends it to interrupted ones.
- **Thermo route.** The evidenced vendor reader was terminated too: requested as
  soon as the staging area existed, the process ran 119 ms, exited
  `STATUS_CANCELLED`, left zero surviving processes and had written nothing at
  all. Cancellation of the vendor path is therefore established; a *mid-write*
  observation of it is not, because the one lawful fixture is 78,309 bytes.
- **Streams.** No capture was truncated and no capture deadlocked, on a cancelled
  run or on a completed one. A separate controlled test drives more than 512 KiB
  through both pipes — comfortably past a pipe buffer — and cancels while the
  child is still attached, confirming the capture threads keep draining because
  they start before the wait rather than after it.

## Consequences

- The queue is still uncancellable and still says so. No `Cancel` button, no
  Tauri command, no transfer object, no queue state and no frontend change is
  part of this.
- `ConversionRunOutcome` is deliberately not widened. The queue and the desktop
  boundary match it exhaustively, and a cancellation state added to it would
  become a state they must classify before any product decision about
  cancellation has been made. `ConversionAttempt` is a separate result for the
  separate entry point.
- A cancelled attempt is not classified as retryable or not retryable anywhere,
  because nothing reaches a classifier. Whether a user-cancelled item may be
  retried is a product question, not a mechanical one.
- The private primitive is reachable from Rust only, and today its only caller
  outside tests is the evidence harness.
- The cost the boundary already charged is unchanged: while a run holds an
  acquisition, the user cannot modify, rename or delete it. Cancellation ends
  that hold sooner, which is a benefit, not a new cost.

## Open questions for a product cancellation

None of these is answered here, and none may be assumed.

- **Cancel one item and stop the queue, cancel one and continue, or cancel the
  whole queue.** Three different promises. ADR 0013 chose a queue with no
  cancellation precisely so this would be decided with evidence.
- **Retry after a user cancellation.** A cancelled item has no failure to
  correct. Offering the same retry affordance as a failed item would say
  something untrue about why it stopped.
- **What the user is told while termination is in flight.** Confirmation took
  51–133 ms in every measurement here, on one machine with one backend. That is
  not a budget and no threshold derives from it.
- **A queue-wide request.** This primitive is per-attempt. A queue-level request
  is a different object with a different lifetime, and building it as "a set of
  these" is a decision, not a detail.
- **What a cancelled item leaves in the roster.** Nothing here creates, removes
  or annotates a workspace row.

## Alternatives considered

**Widen `ConversionRunOutcome` with a `Cancelled` variant.** Rejected. Every
exhaustive match on it — the queue, the desktop boundary, the transfer-object
projection — would have to classify a state no product decision has been made
about, and the cheapest way to make them compile is to fold it into an existing
failure, which is exactly the collapse this ADR exists to prevent.

**A defaulted `run_cancellable` that ignores the request and delegates.**
Rejected. It compiles, it is shorter, and it makes every fake runner silently
uncancellable while presenting a cancellable interface. The default refuses to
launch after a request and refuses to claim anything more.

**Report `Cancelled` whenever a request was made and the runner returned.**
Rejected. It cannot distinguish a terminated tree from one still writing, which
is the single fact a cancellation feature exists to guarantee.

**Decide cancellation from the staged file rather than from the Job.** Rejected.
Polling a directory is a race by construction, and the Job's active-process
count is the kernel's own answer about the tree this run owns.

**Make the boundary re-check the request after the process returns.** Rejected.
It would let a request that arrived after a successful conversion discard a
finished, validated document — a user pressing Cancel a moment too late would
lose work that already exists, and the ordering rule would depend on where in
the sequence the check happened to sit rather than on what was observed.

**Add a dependency for the Windows Job Object or cancellation primitives.**
Rejected and unnecessary. The locked stack expresses all of it: `Arc<AtomicBool>`
for the request, and the `kernel32` declarations this crate has carried since M0
for the Job.
