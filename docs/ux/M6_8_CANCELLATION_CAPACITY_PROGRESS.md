# M6.8 cancellation, capacity, and truthful progress

Status: implemented and validated. Local gates, rendered QA, the provider
measurement and all three native suites pass on the build attributable to this
head. See *Validation* below.
Baseline: `735dfebac5d48db30b6d1802c208ccf05853b3d8` (published M6.7).

This is the single owning record for M6.8. It states the terminal route
outcome, the provider measurement behind it, the disposition of each control,
the capacity decision, and where the evidence is. It does not restate the
specification that [ADR 0043](../architecture/adr/0043-conversion-completion-route.md)
already carries.

## Route outcome: `OWNERSHIP_STRUCTURALLY_CLOSED`

Provider execution cannot create an uncaptured descendant before ownership
exists.

The published boundary spawned a running child and assigned it to the owned
Windows Job afterwards. A descendant created in that interval belonged to no
Job, so it was outside `TerminateJobObject` *and* outside the accounting that
reports the tree gone — and no number of representative runs closes that,
because the hole is in what is being counted.

The root is now created suspended. Ownership is established while the process
has executed no instruction of its own, and only then is its primary thread
resumed, so every process the backend can create is created inside the Job.
`CommandExt::creation_flags` is stable on the pinned 1.97.1 toolchain: no
nightly, no toolchain change, no new dependency, no privileged helper, and no
second process runner beside the one production launch authority.

The primary thread is identified by asking which threads belong to the child's
process id. That is sound rather than a lookup that could hit a stranger,
because the caller still holds the child's process handle — so the process
cannot have exited and its id cannot have been reused. Every thread it reports
is resumed. A process created suspended has one thread of its own, but a second
one need not be a stranger's process — it can be one another product injected,
which endpoint security software does routinely — and this boundary is the one
conversion, discovery and preview all use, so refusing on the count would have
failed every lane on such a machine over something that is not about ownership.
What the count stood in for is checked directly instead: `ResumeThread` must
report a previous suspend count of one for some thread, which is the primary
thread as created and before it ran, and every thread must have been reachable —
a thread this run cannot open is one it cannot say anything about, so the launch
fails closed with the operating system's reason rather than proceeding on a
thread it did not identify.

Breakaway stays refused: the Job sets neither `JOB_OBJECT_LIMIT_BREAKAWAY_OK`
nor its silent variant, so ownership established before execution cannot be
given up after it. Nested Jobs are what make this safe inside another Job — the
child joins both, and terminating this one still terminates it.

**The scope of the claim, stated and not exceeded.** It covers the provider's
own process tree: the root and its descendants. Work a provider brokers to a
service or COM server that was already running is not a descendant, was never
this Job's, and is not covered. This is a process-ownership boundary for one
backend, not a sandbox.

**What proves it, and what does not.** No behavioural test of a descendant can
prove the interval is gone: it is instructions wide, and no child can be made to
create a descendant reliably inside it. What proves it is observable directly —
at the moment ownership is taken the root has written nothing, has not exited,
and is already in the Job, and resuming it is what makes that absence mean
suspension rather than a fixture that never worked. Removing suspended creation
makes that test report the escape.

Two further tests carry the other half, which the structural one does not reach:
a descendant created as early as the operating system allows is inside the Job's
accounting and termination, and a root that exits the instant it has spawned
leaves the run waiting on the Job rather than on the handle it holds. Neither
discriminates the interval, and both say so.

### What runtime failures retain

| Failure | What is known, and what follows |
| --- | --- |
| Job creation or assignment fails | The root has executed nothing, so it has no descendants. Terminating the direct child is complete here rather than a degradation, and it is complete *because of how the child was created*. |
| Resume fails, teardown reclaimed the root | The owned root ran nothing and is gone. `BackendExecutionFailure::RootNotStarted`, an ordinary backend failure. |
| Resume fails, teardown could not reclaim it | An owned process whose disappearance cannot be stated. Classified as `NotTerminated`, which is what that already means, so a stop reaching it settles `CancellationFailed` and quarantines. |
| Job accounting unavailable | `None`, never zero. Unknown surviving-process state is not zero, and the claim is unreachable without a bounded count. |
| Emptiness times out | The Job would not empty. `NotTerminated`. |
| Any of the above **with no stop in flight** | The same uncertainty, and the same consequence. The invariant is about the machine rather than about anything the user pressed, so the run is asked a typed question about its own failure and the queue ends on the quarantine that is then in force. Before this, quarantine fired only on the stop path and the queue went on to launch the next converter beside a process nothing could account for. |
| Any of the above **on a lane that is not the queue** | The same again, on all three. A preview is a process and so is a discovery help probe, and the sentence the quarantine shows had always named preview and conversion both while only the queue could raise it — so a preview that lost track of a process left the session trusting the backend and the next conversion started a converter beside it. Every lane now asks `ProcessError::leaves_an_owned_process_unaccounted`, which is *derived from* the queue's own classification rather than restated beside it, so they cannot answer differently. Discovery needed one more step: its typed error was reduced to an `io::ErrorKind` and a string, so the question could not be asked of it at all. The typed error is kept as the `io::Error`'s source, `DiscoveryResult` answers the question, and the provider latches it — a probe is not an operation anyone asked for, so there is no attempt for it to report through. |
| A wait that failed after its owned teardown succeeded | `NotAwaited`, and **not** a quarantine. This run cannot report how its process ended, and it *did* observe the owned Job empty afterwards — `failure_after_teardown` reads the count on every failure path and promotes anything not observed empty to `OwnedJobNotEmptied` before it is classified, so a failure still carrying `NotAwaited` is one the kernel said held nothing of this run's. Quarantining here would refuse every later operation, for the rest of a session, on a fact that is not true — and a Job that would not empty is already classified `NotTerminated` at the boundary rather than folded into this. |
| The thread snapshot the launch takes fails | Retried a bounded four times. It is documented to fail transiently while the system's thread list changes, and the process being asked about is suspended and cannot move under the retry. |
| The suspended root reports more than one thread | Every one of them is resumed, and the launch continues. A process created suspended has one thread of its own, but a second can be one another product injected — which endpoint security software does routinely — and refusing there would have failed conversion, discovery and preview alike on such a machine over something that is not about ownership. Ownership comes from the suspended creation and the Job assignment that precede the resume. What is still required is checked directly: some thread must report a previous suspend count of one, which is the primary thread as created and before it ran. |
| Capture or launch failure coinciding with a request | Keeps the reason that is true of it. An execution error does not erase an ownership uncertainty, and only the two failures that describe one are reclassified. |

## The measurement

Against the exact installed build, which is the one
[ADR 0010](../architecture/adr/0010-first-vendor-raw-source-admission.md)
admitted a vendor family on:

- release `3.0.26013`, revision `47b13cf`
- `msconvert.exe` SHA-256 `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`
- 12,687,872 bytes, last written 2026-01-13T19:44:36Z
- byte size and digest **re-observed unchanged after** the measurement set

Approved Thermo fixture SHA-256
`B3D97B3856DD1E8DD6846D21C58B1B1824C309480908FE4C2DFABE152BD6DD7B`, unchanged.

**Three quantities, kept apart.** `sampledMaxActiveProcesses` is polled, so it
is a floor on the real peak: a process that began and ended between two
observations was never sampled. `totalOwnedProcesses` is the kernel's own
cumulative count of every process the Job ever held and has no such interval.
The final active count is neither. `null` means no bounded accounting was
available, never a count of zero.

| Case | Sampled max active | Cumulative total | Final active | Disposition |
| --- | --- | --- | --- | --- |
| Requested before the run | — | — | absent | `none_launched` |
| mzML workload, staged output appeared | 1 | 1 | 0 | `confirmed_gone` |
| mzML workload, staged output growing | 1 | 1 | 0 | `confirmed_gone` |
| Racing its own natural exit | 1 | 1 | 0 | `confirmed_gone` |
| Requested after the process was observed to exit | 1 | 1 | — | completed, not cancelled |
| Lawful Thermo acquisition, reader had staged an output | 1 | 1 | 0 | `confirmed_gone` |

**What this establishes and what it does not.** For this build and these
inputs, the run creates exactly one process — and because the cumulative count
is kernel-counted there is no sampling gap in which another could have lived.
It is *not* a claim that this provider never spawns children, nothing was
arranged to produce a peak above one, and no synthetic descendant was added to
a vendor run to obtain one. The synthetic parent-and-grandchild fixture proves
the mechanism owns a tree; it is not vendor evidence, and the two are reported
separately.

**Re-taken at the final head**, on the same rule the suites are held to: this
measurement is produced through the launch path, so a changed launch path makes
an older run describe a different boundary. Run 05, taken at head `1fd44df`,
reproduces runs 01 to 04 exactly — `provider.executable_sha256` still
`9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`, a kernel
cumulative `total_owned_processes` of 1 in every scenario,
`tree_ownership=established_before_execution` throughout,
`owned_tree=confirmed_gone` for every launched run and `none_launched` for the
request observed before the launch. It is a console harness rather than an
interface one, so it does not need an unlocked interactive session.

Evidence: `D:/tmp/mscanvas-m68-20260908/cancellation-evidence-0{1,2,3,4,5}.log`; run 05 is the one taken at this head.
The harness removed its own scratch directories; verified empty.

## The claim guard

One typed origin. `ProcessOutput::owned_tree_confirmed_gone` is the conjunction
of an empty owned Job *and* ownership that preceded execution; nothing else
decides it. `OwnedTreeDisposition` is the vocabulary that carries the judgement
through both conversion lifecycles, the queue, the transfer object, the
diagnostics payload and the interface, and it has three members because a
boolean collapsed two facts that are not the same:

```text
none_launched   no process was created, so there was no tree
confirmed_gone  a tree existed, this run owned it before it could grow,
                and the owned Job reported itself empty
unconfirmed     a tree existed and its disappearance could not be established
```

The retired boolean `tree_termination_confirmed` said `true` for the first two
alike, so it asserted a terminated process tree for a run that never started
one. That conflation is exactly what the route named as one the reconciliation
must undo.

**And the state a wrong description would have named is not expressible.**
`ItemOutcome::Stopped` used to carry the item state, so a caller could pair a
confirmed-sounding state with an unconfirmed disposition — rendering an
unconfirmed stop as a success and skipping the quarantine that keeps the next
conversion from starting. The state is derived from the disposition where the
item settles, and the quarantine reads the disposition rather than a rendering
of it.

### Three guarantees, and what enforces each

| Guarantee | Enforced by |
| --- | --- |
| This attempt's process tree was owned before the image executed, and its disappearance was observed | The runtime: `CREATE_SUSPENDED` → `AssignProcessToJobObject` → resume, breakaway refused, and a kernel process count read after teardown. Nothing textual is involved. |
| Who may **call the derivation**, and who may name the affirmative member | Rust privacy. `ConfirmedGone` is `non_exhaustive`, so no consumer can name it; `OwnedTreeDisposition::of` is `pub(crate)`, so no consumer can call it. Measured downstream, not asserted — see *The downstream probe*. **Narrower than "who may obtain the judgement"**; the difference is *The trust seam*. |
| Names, wire/schema agreement, and descriptive copy | `check_repo.py`. **Policy over spellings, not a theorem.** It recognises the shapes it has been shown; it does not cover every Rust expansion or every synonym in prose, and this record does not claim it does. |

**The claim's *name* is carried by the compiler, and since this closure so is
the *derivation*. What is not, and is written down because this record
overstated it once, is everything downstream of the judgement once it is a
string.**

`OwnedTreeDisposition::ConfirmedGone` is `non_exhaustive`, so outside the crate
that decides it the affirmative member cannot be **constructed** — not by
production code, not by a fixture, not under an alias, a braced import or a
renamed import. Two independent reviewers each demonstrated bypasses of the
string-matching version that preceded this, and none of them compiles now.

It cannot be *named* either, in the form anyone would write:
`Disposition::ConfirmedGone` is rejected in an expression and in a pattern
alike. What is still permitted is the struct pattern `ConfirmedGone { .. }`,
which matches — measured against a two-crate probe rather than assumed. This
record said "constructed *or* matched"; the second half was wrong, and it is
not the half that carries anything, because a consumer able to branch on the
member is still unable to make one.

What that does **not** do is put the judgement out of reach.
`OwnedTreeDisposition::of` is public, and its input is a `ProcessOutput` — the
report a `ProcessRunner` returns, which every consumer that substitutes a runner
must be able to build. A consumer could build a run that did not happen, hand it
to the derivation and receive the affirmative member back without ever naming
it. No type distinguishes a fabricated report from a supervised one, and none is
claimed to.

So the *asking* is contained instead — and it is contained by Rust, not by a
repository check. `OwnedTreeDisposition::of` is `pub(crate)`. The scope is the
crate rather than one file because two lifecycles inside it each supervise a
real run; what privacy refuses is a consumer minting the judgement for itself.
This was a `check_repo.py` rule until the closure, and a repository check is
policy rather than privacy: the rule is still there, as a second reader, but it
is no longer what holds the door.

The one cross-crate caller that remains is a desktop **test** fixture, and it
reaches `of_supervised_run_for_test`, which exists only under the `test-support`
feature. That feature is off by default, arrives in the desktop crate solely as
a dev-dependency, and makes an *optimized* build fail to compile at the crate
root. `cargo tree --edges features` shows the shipped edge is `default` alone;
`cargo build --release --features test-support` refuses. That is what
establishes it is absent from the configuration users receive — a filename or
`debug_assertions` would not have.

And once the judgement leaves the type it is a string — on the wire and in the
diagnostics payload — which no compiler refuses, so the identifier itself is
watched by the guard.

### The downstream probe

Measured rather than argued, against a crate that links this one the way any
consumer does, on the pinned toolchain, with a control that builds so a refusal
cannot be a missing dependency:

| Probe | Result |
| --- | --- |
| Reads a returned judgement (`stable_id`, `no_owned_process_survives`) | builds |
| Names `OwnedTreeDisposition::ConfirmedGone` | `error[E0603]: unit variant ConfirmedGone is private` |
| Calls `OwnedTreeDisposition::of` on a fabricated `ProcessOutput` | `error[E0624]: associated function of is private` |

Evidence: `D:/tmp/mscanvas-m68-20260908/claim-boundary-probe.log` and
`shipped-configuration.log`. The consumer half is also a permanent integration
test — `crates/proteowizard/tests/claim_boundary.rs` compiles as a downstream
crate, so closing those two doors cannot quietly close the read-only API with
them.

### The trust seam, stated rather than dissolved

`ProcessRunner` is public and `run_conversion*` take `&dyn ProcessRunner`, so
whoever chooses the runner chooses what a `ProcessOutput` says. In the shipped
application that is one place — `backend.rs` passes `&SystemProcessRunner` — and
substitution exists for tests.

**Privacy is narrower than it first reads, and the difference is the seam.** It
stops a consumer *calling* the derivation on a report it wrote. It does not stop
a consumer implementing `ProcessRunner`, calling the public
`run_conversion_cancellable`, returning a `ProcessOutput` it composed — every
field is public — and receiving back a `CancellationReport` whose `owned_tree()`
is the affirmative member. The crate derived it, from input the caller supplied.
That path is not new and this closure did not narrow it; what would be new is
claiming otherwise, so this record does not.

What is trusted, therefore, is the first-party code that selects the runner: one
call site in the desktop crate. This is a boundary between MSCanvas's own layers,
not a sandbox against hostile code with authority to edit the provider crate or
its callers. The same is true of the discovery help probes and the preview lane —
they run through the same supervised boundary and the same one runner.

`validate_the_cancellation_claim_has_one_origin` in `scripts/check_repo.py`
carries what a type cannot. It checks that the conjunction is defined once and
reads both halves; that the derivation exists exactly once, so both lifecycles
read one judgement; that the Rust identifiers and the TypeScript union are the
same set compared against *each other*; that the retired boolean does not
return in code; that neither claim-bearing member is named outside the two files
that own them — matched as bare identifiers, because a qualified path is the one
spelling an import removes; that the derivation is called only inside the crate
that supervises a run, and the claim's identifier written as a string nowhere at
all; and that nothing describes itself as a confirmed process tree unless that
is all it means.

A test may name what production may not, and what makes a file a test is the
declaration that compiles it as one — `#[cfg(test)] mod <name>;` for a file
module, a `#[cfg(test)]` block at the left margin for an inline one. Two simpler
rules were both wrong. Reading it off the path exempted anything under a
directory called `tests`; reading the file for `#[cfg(test)]` exempted nearly
every production module in the repository, including the three this guard exists
to check, and eight of its own bypass proofs stopped being detected. The bypass
suite is what said so.

**The description rule is an allowlist of what may claim, not a list of sites to
inspect.** The version that listed sites passed while three other descriptions
asserted a confirmed tree, one of them a public API arm reached by a run that
launched nothing. Inverted, a description nobody thought about is an error by
default — and inverting it is what found that live defect.

It reads documents as well as code, and in a document it reads the **state
tables** rather than the prose. That found a fourth live defect: ADR 0015's
shipping definition of `cancelled` still said "owned tree confirmed gone", which
asserts a process tree for a state a run that launched nothing also reaches — the
identical defect round 2 had found and repaired in `dto.rs`, `operation.rs` and
`contracts.ts`, and not here. Prose is left alone deliberately. The first version
read every line and reported eleven hits, of which ten were prose doing what
prose is for: an amendment quoting the sentence it supersedes, ADR 0043's
contract *forbidding* the claim, and ADR 0020's record of one measured run that
did launch a process. A rule that can only be satisfied by rewording honest
sentences teaches the writer to dodge it.

**Prose is the fallible half, and nothing here fixes that.** A synonym nobody
listed still passes the description rule, because prose is not typed and no
check over words can be exhaustive over words. What the `non_exhaustive` member
buys is narrower and worth stating exactly: a wrong *description* cannot become
a wrong *claim in code*. The words can drift; the member cannot be written by
the code that reads them.

**The guard proves itself.** On every run it applies thirty-five deliberate bypasses
to isolated copies and requires each to be detected, including all six the two
reviewers demonstrated: the alias import, the braced member import, the braced
ownership import, a production claim hidden behind a file-based test module, the
set-stop facts re-described, and a state description narrowed to a confirmed
tree.

That last one is written in words the rule already lists. It proves the rule
fires; it does **not** prove an unlisted synonym would be caught, and this record
previously called it a synonym proof — which contradicted the paragraph above it.
Two came from the third review — a consumer deriving the disposition for
itself, and the claim written out as a string. Four came from the fourth, two of
them edits a reviewer demonstrated rather than defects imagined for the guard: a
braced `#[cfg(test)]` import arming a skip region over 158 lines of production
`service.rs`, and a module declaration written inside a raw string literal that
made all 8,303 lines of it a test source. The other two of those four prove the
document rule, which until then no proof exercised at all — the pristine copy
held no markdown, so deleting that rule outright would have left the suite green.

**Four more came from the fifth, and two of those were the same two attacks
again in shapes the repairs had not covered.** A comment containing a brace,
placed between the attribute and the item it sits on, opened a 160-line region
over production code — the brace counter read raw text, so a `{` in a comment
was a body. And `mod r#service;` is the same module `service.rs` under a raw
identifier, which the plain-declaration subtraction did not match. Both are
answered at the root: comments, strings, chars and raw strings are scrubbed out
before anything is counted or matched, and the region now ends where its own
depth returns to zero rather than at the first left-margin `}`.

Three more came from the sixth, one for each of the bypasses above; three from
the eighth, one of which needs a file the tree does not have, so a proof may
create one; and four from the seventh: a *nested* block comment, which Rust allows and the scanner
closed at the first `*/`, so commented-out text read as live source; an ordinary
string literal continued across a line break, which forged the attribute and the
declaration at once, aimed at a module no other proof anchors in; the
qualified-type spelling `<Path::Type>::of(x)`, which is not a substring of the
unqualified one; and a narrow symbol named in passing on a line, which exempted
the description above it.

The other two of the fifth's proofs are for rules that could not fail at all.
Neutralising the conjunction's one-definition count, or the comparison of the
Rust vocabulary against the identifiers this repository fixed, left every
existing proof green: the first because the only duplicate anyone had written
also failed a different rule, the second because both sides were filtered
through the same constant, so a fourth disposition Rust invented alone could not
show up and a rename carried out in step showed up as somebody else's problem.
The wire union is now read as a union, the two comparisons ask different
questions, and each is proved by an edit only it refuses. The proofs also fail
if the guard has stopped checking at all, and they never edit the worktree.

An earlier version walked each file to skip `#[cfg(test)]` regions and read only
what was left. It twice turned out to be skipping production code instead —
first when an attribute inside a skipped region survived its closing brace, then
when an attribute on a brace-less item armed a skip the next item's brace
consumed — and the check written to catch the first was a tautology, searching
the same window with the same condition that had armed the skip.

**A region walk exists again, and this time it is proved rather than argued.**
Removing it entirely would have meant either exempting nothing — which flags
every fixture that builds a supervised `ProcessOutput` — or exempting whole
files, which is the naming hole the same review found. What decides a region is
the first *terminator*, not the first brace: `#[cfg(test)] use a::{B, C};` is a
statement that closes its own braces, and reading the brace first made that
one-line edit — what rustfmt writes the moment a second name is imported — hide
158 lines of production `service.rs` from three rules at once. A reviewer
demonstrated it, and it is now one of the guard's own bypass proofs, as is the
module declaration written inside a raw string literal that made all 8,303
lines of `service.rs` a test source. A module the product declares stays
production whatever else declares it, which is what answers the second.

## The four operations under CNV-D7

| Operation | Decision | Basis |
| --- | --- | --- |
| Stop queue | Unchanged | Exists since ADR 0015; under structural closure it now settles honestly. |
| Cancel the current item and continue | **Admitted** | Both conditions the route set, together: structural ownership and a representative measurement of the exact build. |
| Skip a queued item | **Admitted** | Admissible under CNV-D7, with its own terminal state. |
| Remove a queued item | **Refused** | A membership change. Membership is bound at BEGIN, and removal deletes the question along with the answer. |

Cancel-current is admitted on the merits rather than to raise a feature count.
Without it the only way to drop one wrong row is to end the whole queue and
rebuild it, which makes the user pay for the entire batch to correct one item.

**Identity and races.** Both commands name the exact identity they mean — the
operation, the item's index, and for a cancel that item's attempt number — and
Rust checks all of it under the same lock that records the request. A caller
holding an identity from a moment ago is refused rather than redirected, so a
late press cannot reach the next item and a per-attempt token cannot be reused
for the one after it. A queue stop takes precedence over both and is not undone
by either. A skip that raced a start is refused rather than becoming a
cancellation the user did not ask for. Repeating a per-item stop for the same
attempt is idempotent; repeating a skip for a settled item is refused.

**A third state that says no process ran.** `skippedByRequest` is not
`skipped`, which is the conflict policy leaving an existing file alone, and it
is not `notRun`, which is a stopped queue never reaching the item. It
deliberately does **not** claim that nothing was created: a destination folder
the queue prepared belongs to the queue and to the queue's own reclamation rule,
which is unchanged.

**Retry is not widened.** A retry still moves only retryable failures back to
pending. A user-skipped or user-cancelled item has no failure to correct, so it
keeps its answer through a rerun of the queue it belongs to.

**And a skip during a rerun is not a skip of the failure underneath it.** A
retry moves retryable failures back to `pending` while their error, attempt
count and diagnostic ticket stay in place, so a `pending` row in the second pass
may be one that ran in the first. Settling it as "you chose not to convert this"
would delete a failure the user has already seen, take it out of the failure
count and drop its diagnostics from the export, so such a row keeps the result
it earned — and the control is not offered on it at all, because a `Skip` that
turned "Waiting" into "Failed" would be doing something other than what its
label says. `Skip` is offered on rows with no attempt behind them, which is
where it means what it reads.

## Capacity under CNV-D6

`MAX_CONVERSION_QUEUE_ITEMS = 16` **stays, with a rationale that is true.**

The doc comment defended it on the queue having "no cancellation"; a
queue-level stop has existed since ADR 0015, and this slice adds ending the file
being converted and settling a waiting item. What that changes is the cost of
getting the size wrong, not the size: items still run serially, so sixteen is
still something like half an hour a user commits to, but a wrong decision no
longer has to be waited out.

It remains a judgement about how long a person should be asked to commit to and
not a fact about the machine. Nothing in this repository measures memory,
throughput or scaling against queue length, and deriving a number from the
largest fixture that happened to pass would be the same invention wearing a
measurement's clothes. Rust stays the only authority: enforced before
commitment, delivered as `ConversionQueuePlanDto.capacity`, never restated as a
frontend constant.

## Progress under CNV-D8

Item N of M, per-state counts and the current item's state. No percentage, no
estimate, no fraction of an item, and nothing named about the backend's internal
progress.

Two truthfulness defects are closed here.

A completed queue reported three counts, which was complete while a cancelled
item could only arrive through a queue stop. Now that a user can end one file
and settle another without running it, a queue that completed can hold either,
and three counts left two of three items unaccounted for. The completed summary
names them when they happened; unlike the stopped summary it does not print
zeroes for actions nobody took, because an ordinary completion has no audit to
answer.

The retry display told the truth about the lane and not about the queue. The
claim is lowered only by the retry command's own outcome — correctly, because a
claim an arriving read could clear would let a second dispatch through — but
that command answers once, when the whole rerun is over, while the document
polls throughout. A read could install the finished rerun before the reply and
leave "Retrying the failures…" over a queue that was done. What the interface
says is now a separate projection of the claim, keyed on the retry round: a
rerun keeps its queue's name and is terminal at both ends of the window, and
only the round separates the pass that was on screen when the control was
pressed from the pass that answers it.

## Changed-path closure

56 paths: 41 of code and evidence, and 15 documents. Each of the 39 is either
the boundary that decides the claim, a direct consumer of it, a surface that
carries it, or the evidence for one; the documents are listed at the end, so the
closure is the whole diff against the baseline rather than the part of it that
compiles.

This section was wrong once and it is worth saying why: it was written at a
head, five paths were added by a later round of repairs, and the count was not
re-derived. A reviewer found it by running the command this section names. It is
re-derived at every head now.

**Process boundary and the claim's origin** — `crates/proteowizard/src/process.rs`,
`conversion_run.rs`, `conversion_run/output_set.rs`, `conversion_run/tests.rs`,
`lib.rs`. Suspended creation, the typed conjunction, the three-member
disposition read by both lifecycles, and their tests.

**Direct consumers of the process result** — `crates/proteowizard/src/diagnostics.rs`,
`failure.rs`, `preview.rs`, `examples/m0_proteowizard_spike.rs`. Each
constructs a `ProcessOutput` and must state the ownership it is modelling
rather than inherit a default; a fixture that could omit the field would let a
later one claim a confirmed tree by forgetting to say otherwise.

**Evidence harness** — `crates/proteowizard/examples/conversion_cancellation_evidence.rs`.
The three process quantities and the disposition.

**The claim boundary, measured downstream** —
`crates/proteowizard/tests/claim_boundary.rs`. An integration test compiles as a
separate crate that links this one the way any consumer does, so what it can
reach is what a consumer can reach. It pins the read-only half; the refused half
is measured by the probe described above, because a downstream crate that names
the affirmative member does not compile and so cannot be a test in a suite that
must.

**Discovery** — `crates/proteowizard/src/discovery.rs`. The third lane that
starts backend processes. Its typed error was reduced to an `io::ErrorKind` and
a string, so the one question about an unaccounted process could not be asked of
it; the error is kept as the `io::Error`'s source, the probe failure carries the
answer, and `DiscoveryResult` reports it.

**Queue, commands and wire** — `apps/desktop/src-tauri/src/preview/operation.rs`,
`service.rs`, `dto.rs`, `conversion.rs`, `backend.rs`, `diagnostics.rs`,
`diagnostics/payload.rs`, `lib.rs`, `e2e_seed.rs`, `preview/tests.rs`. The two
new operations, the new item state and count, the typed judgement replacing the
boolean, the bounded diagnostic facts, and the command registration.

**Interface** — `apps/desktop/src/features/mzml-preview/contracts.ts`, `api.ts`,
`useConversionOperation.ts`, `ConversionPanel.tsx`, `PreviewWorkspace.tsx` — the
live region, which had to account for items a user decided about rather than
only for items that ran — plus the tests that pin them:
`conversionContract.test.ts`, `ConversionStop.test.tsx`,
`ConversionDiagnostics.test.tsx`, `conversionLaneAuthority.test.tsx`,
`usePreviewWorkspace.test.tsx`, `src/test/outputSetRendering.test.tsx`,
`src/test/previewFixtures.ts`, and `src/app/App.test.tsx`, which asserts the
banner's quarantine sentence. Plus the two places the quarantine sentence is
written for a user — `conversionAvailability.ts` and
`conversionNoticeRegistry.ts` — which said a *converter* had not been confirmed
to have *stopped*, when this state is now reached by a preview, a spectrum read
and a discovery probe as well, and by a failure with no stop in flight; and
`rosterView.ts`, which told a reader the only action they have is stopping the
queue.

**Guard** — `scripts/check_repo.py`.

**Rendered and native evidence** — `e2e/specs/m6.8-cancellation-controls.browser.e2e.ts`,
`e2e/specs/m6.8-cancellation-controls.tauri.e2e.ts`.

**Documents** — `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `BOOTSTRAP_STATUS.md`,
`docs/product/FEATURE_CATALOG.md`, `docs/product/PRIMARY_WORKFLOWS.md`,
`docs/architecture/adr/0043-conversion-completion-route.md` (the route
decisions), `0013` (the capacity premise and the "no Cancel" paragraph), `0014`
(the interval it left open), `0015` (the decision this milestone amends), `0016`
(the adoption-eligibility enumeration), `0017` (the diagnostics schema version)
and `0020` (one measured sentence made unambiguous), plus
`docs/spikes/M0_PROTEOWIZARD_SPIKE.md` (the spawn-to-assignment race it left
open) and this record. Fifteen, and the count is checkable: `git diff
--name-only` against the baseline reports 56 paths, 15 of them documents.

## Validation

Local gates: frontend lint, typecheck, 1659 tests across 69 files, build;
`cargo fmt --all --check`; `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`; `cargo test --locked --workspace --all-targets`
(1519 passed, 23 ignored); `python -B scripts/check_repo.py`; `git diff --check`;
E2E typecheck.

**Rendered QA**: 10/10 in `m6.8-cancellation-controls.browser`, including every
control reachable with no horizontal overflow at 1366x768, 1920x1080, 1200x800
and 960x640, plus M6.6 8/8 and M6.7 7/7 on the same head. Screenshots and console
records inspected; console empty.

**Run at this head**, not carried — the frontend inputs have not changed since,
and the diff to the published head touches no compiled frontend file. The fourth review's repairs changed the
rendered product — the completed summary names two more counts, the per-item
stop says something different while it is in flight and no longer predicts an
outcome, the plan-time disclosure names all three scopes, and the stop-failed
live region carries the counts — so the earlier run describes a different
bundle and is not inherited. The bundle these cases exercised is
`index-BkiQRL25.js`, SHA-256 prefix `8f72cf930388c953`, beside
`index-BGNQ9ajg.css` (`d6f6a6c32034f882`) and `index.html`
(`1b8b8abf76b163ae`).

The suite is headless, so it does not need an unlocked session — which is why
it could be re-run at this head when the native suites could not.

**Eight rounds of two independent reviews rejected eight candidates, and every
finding was verified against the code before it was acted on.** Each repair is
proved by reverting it and watching a test, or the guard's own bypass suite,
report the defect. Reviewers demonstrated working bypasses of the claim guard in
five separate rounds; each of those edits is now one of its proofs.

Round 1: a skip landing between the worker choosing an item and starting it
wedged the queue; the guard was blind to 650 lines of production `service.rs`;
the item state and queue count still described a confirmed tree for a state also
reached by a run that launched nothing; exit criterion 7's invariant fired only
on the stop path; and two of the three ownership tests did not discriminate what
they were named for.

Round 2: both reviewers demonstrated working bypasses of the guard rather than
arguing about it — an alias import, a braced import, a production claim behind a
file-based test module. The answer was to stop matching spellings for the
member's name and make the compiler refuse it, which is where `non_exhaustive`
came from, and to invert the description rule into an allowlist — which
immediately found a live defect on a public API arm.

Round 3: the guard's own test-source exemption could be won by naming a
directory; the assign-failure path could strand an owned root without saying so;
`NotAwaited` had been widened into the quarantine and would have refused a whole
session on a fact that was not true; the launch refused any process reporting
more than one thread, which would have failed every lane on a machine that
injects one; the quarantine was raised by the conversion lane alone while its
sentence named preview too; the skip single-flight test passed with its guard
removed; ADR 0015's shipping definition of `cancelled` still asserted a confirmed
tree; the diagnostics schema had moved from 1 to 2 with nothing recording it; and
this document overstated what the compiler carries and contradicted itself about
what the bypass proofs prove. All are repaired above.

Round 4: two more demonstrated bypasses, both compiling — a braced
`#[cfg(test)]` import arming a skip region over 158 lines of production
`service.rs`, and a module declaration written inside a raw string literal that
made all 8,303 lines of it a test source. The document rule had no proof at all,
because the pristine copy the suite builds held no markdown. One row's honest
qualification exempted its neighbours, so two rows beside `cancelled` could be
rewritten into confirmed-tree claims undetected. The resume could be moved above
the Job assignment and the two tests watching that interval would have stayed
green. `NotAwaited` quarantined a session only when a stop was in flight.
Discovery, the third lane that starts processes, could never quarantine. A skip
during a rerun erased a failure the user had already seen. A queue this
milestone's own refusal ends held rows the completed summary named nowhere. The
per-item stop promised an outcome the race can falsify and said the control was
available while it was in flight. And `non_exhaustive` was documented as
refusing matching, which a two-crate probe disproved.

Round 5: a comment containing a brace opened a skip region over production code
and a raw-identifier module declaration exempted a whole production file — the
same two attacks as round 4, in shapes the repairs had not covered, and both now
answered by scrubbing comments and literals before anything is counted; two
guard rules could not fail at all; a resume could start the root and *then*
refuse, and the refusal was classified as a root that never started, which is
retryable and raises no quarantine; and a skip during a rerun was still offered
on a row that had already run, which Rust settled correctly and the interface
then labelled as a failure with no mention of a skip.

Round 6 defeated the guard three more times, each with something that
compiles. A `#[cfg(test)]` written inside a block comment armed a region: the
brace counter had been scrubbed a round earlier and the line that *arms* a
region was left raw, so the same attack worked one line further up. A
declaration split across two lines was invisible to the plain-declaration
subtraction, because `\s+` cannot cross a newline in a per-line match. And the
derivation was reached through `use ... as Disposition`, which is the one
spelling a qualified-path check cannot see — the lesson rule 6 already carried
about members, arriving a round late at rule 7. The attribute is read as code
now, declarations are matched over the file as one text, and the derivation is
matched under every name the type can be reached by in that file.

Round 8: three more demonstrated bypasses, one of them smaller than any proof
the guard held — a single existing line changed. A `#[cfg(test)]` region is
line-granular and a Rust item ends at a *column*, so anything written after the
closing brace on the same line was production code the guard never read. A
module compiled under `#[path = "..."]` is one `files_for` cannot resolve by
name, so the plain-declaration subtraction saw nothing and a `#[cfg(test)] mod`
beside it exempted the file the product actually builds. And the claim's
identifier was compared as raw text, so `"confirmed_gon\u{65}"` and a literal
split by a line continuation are the same `&str` the compiler sees and not the
one the rule looked for.

**Two things about the process boundary in the same round, and they are the
more serious half.** A coincident capture failure *replaced* the primary error's
kind, so a Job that had positively said it still held processes became a plain
`Wait` — classified `NotAwaited`, retryable, no quarantine — because a stdout
pipe happened to break at the same moment. And the emptiness observation this
milestone added was computed and thrown away on every failure path but one: the
general path kept the success of the teardown *request* and discarded the Job's
own count, which is the reasoning `force_owned_cleanup`'s own docstring exists
to refuse. Both are repaired, and both now have tests over the decision rather
than over a hand-built value.

Round 7: four more demonstrated bypasses, listed above, and one substantive
overclaim. `RootNotStarted` — an ordinary, retryable failure that raises no
quarantine — was concluded from the *success of teardown*, which is
`TerminateJobObject` plus a kill and a wait: a request, not an observation. The
boundary refuses that reasoning everywhere else and relied on it here. The Job's
own process count is now read after the request, and only `Some(0)` earns the
ordinary classification. Round 7 also found ADR 0015's `notRun` and `completed`
rows still describing a stopped queue, this record's review history saying three
rounds while listing six, and a test whose stated premise was a queue state Rust
cannot emit.

Round 6, on the product side: the screen-reader region returned the refusal
*instead of* the counts
in exactly the state this milestone added — a session that loses track of a
process refuses the rest of the queue, which settles `completed` with rows marked
not-run and an error, and the region short-circuited on the error; the test meant
to catch it built its queue from a fixture that hard-coded no error, a state Rust
never emits there. The backend banner still carried the pre-M6.8 quarantine
sentence that names a converter and a stop. The preview lane still read
`owned_root_reclaimed` alone — the exact half round 5 had repaired on the
conversion side — so it told a user the program "could not be started" about an
image that may have been running, and offered a retry. `BOOTSTRAP_STATUS.md`
still cited a 34-path closure, and `ROADMAP.md` said a stop of a launched
conversion now settles as a successful cancellation, which is the claim the whole
`stopFailed` surface exists because it cannot make.

**The provider measurement was re-taken at this head**, for the reason below —
it is produced through this same launch path, so a changed launch path makes an
older run describe a different boundary. It reproduces exactly; see
*The measurement*.

**Native, on the build attributable to this head.** One build, and all three
suites on that one binary — no rebuild between them.

- Built at head `1fd44df`; binary `target/e2e/release/mscanvas-desktop.exe`,
  SHA-256 `9da84ae53aa16d5777ea67f1cc44df3de28dd25d3f2819a2dba004f4e3ee3f54`,
  16,044,032 bytes. Everything committed after `1fd44df` is markdown — the
  diff to the published head is two `.md` files and no compiled input — so the
  binary above is the one this head builds.
- WebView2 and msedgedriver 152.0.4191.66; approved Thermo fixture SHA-256
  `b3d97b38…2bd6dd7b`, as recorded in each run's own identity entry.

| Scenario | Result |
| --- | --- |
| A stop while the provider is genuinely executing | `ownedTree: confirmed_gone`, `processLaunched: true`, `termination: cancelled`, 31 ms from request to settle, no partial output and no staging residue; the queue carried on to `completed` with 7 finalized, 1 cancelled, 0 not run |
| A waiting item settled without launching it | index 7, 0 attempts, counted as 1 skipped by request, queue `completed` with 7 finalized |
| The whole queue stopped mid-execution | `stopped`, 1 attempted of 8, 0 finalized, 1 cancelled, **0** whose stop could not be confirmed, 7 not run |

The phase is observed, never assumed: the suite reads Rust's own authoritative
state until an item reports running, dispatches against that exact item and
attempt, and asks again if the queue moved on. A request Rust refused is not
counted as a stop.

**Affected regressions on the same binary: M6.6 native 5/5 and M6.7 native
2/2.** M6.6's fifth scenario is the one that was blocked for the whole of this
milestone's review: it presses a real Escape at the exact owned folder picker,
and the guard in `e2e/native/choose-workspace-files.ps1` refuses to send a key
unless that exact dialog holds the foreground. It passes here on an unlocked
session — *"preserves editable drafts and keyboard focus after Escape cancels the
real custom picker"*. Nothing was weakened to reach it at any point: no guard
relaxed, no Cancel substituted for Escape, no focus scripted after cancellation,
and no browser result counted as native evidence.

Evidence: `D:/tmp/mscanvas-m68-20260908/m68-native-VDU6PR/`,
`m66-native-XtIpn5/`, `m67-native-aoZYSD/`, and `final-binary-identity.log`.
Each run's own identity entry records the binary digest above and the approved
Thermo fixture `b3d97b38…2bd6dd7b`.

An earlier pass of the same three suites at head `d0da14d`, on binary
`a7e0cdb0…`, also passed 3/3, 5/5 and 2/2. It is not this candidate's evidence —
the delta review's repairs landed after it — and is recorded here only so the
count of native runs in this milestone is not silently one fewer than it was.

**What the earlier runs were.** They are kept as history and belong to the heads
they were taken on, not to this one: M6.8 3/3, M6.7 2/2 and M6.6 4/5 at head
`4104680` on binary `6db46373…62414e17`, and M6.6 5/5 at head `9279f19` on
binary `0a0cfd29…`. The process and classification boundary changed after both,
and no native evidence is inherited across that.

## Residuals

- **Two browser cases fail on this branch and on the published baseline alike**:
  `m4.1` "offers all three formats for a spectrum that loaded with no peaks" and
  `m5.2` "still reaches the plot by Tab where the range can move". Verified by
  running both specs at `735dfebac5d48db30b6d1802c208ccf05853b3d8` in a separate
  worktree, where they fail identically. Pre-existing and outside this slice.
  Owner: the spectrum-export and viewport owners respectively.
- **A rule can only be proved where a proof is written, and the proofs' *files*
  are not the guard's coverage.** The eighth round's first bypass changed one
  existing line in a file with no proof anchored on it, and no rule read what
  followed the brace on it. Two proofs now target unanchored files deliberately;
  the residual is that the next hole will be found the same way this one was.
- **Three call sites are covered only by the functions extracted out of them.**
  `execute_bound`'s question about a failed preview process, `probe_tool`'s about
  a failed help probe, and the resume loop's collection of suspend counts each
  call a function that is tested directly; nothing drives the site itself,
  because doing so needs a real process failure rather than a substituted
  provider. Replacing any of the three call expressions with a constant would
  keep the suite green. Extracting them was still worth doing — the decision was
  untestable before — but the wiring is asserted by reading, not by a test.
  Owner: the process boundary, whenever a fault-injecting `ProcessRunner` exists.
- **The guard's bypass suite defends the files its anchors sit in.** Thirty
  proofs cover the rules; the *files* they edit are the handful the claim lives
  in. A reviewer showed that the same attack aimed at a module no anchor touches
  is stopped by no rule but by the coincidence that twelve proofs edit
  `service.rs` and two more touch it. Two of the thirty now deliberately target unanchored files for
  that reason, and the residual is that a rule can only be proved where a proof
  is written. Owner: this guard, on every rule it gains.
- Native output validation remains `output_only`, not full-source scientific
  fidelity. Owner: the scientific-fidelity owner, unchanged by this slice.
- The e2e runner's existing Tauri browser-mode and forced dev-server shutdown
  warnings. Pre-existing harness residual.
- Whether a *different* `msconvert` build spawns children is not established by
  this measurement, and the re-observation gate is what would catch a changed
  executable identity.
- **The suspended launch still has no degradation path, on a much narrower
  condition than this entry used to state.** It said the launch refuses unless
  the child presents exactly one thread — which was true of the first candidate
  and was removed in round three, precisely because an injected thread would
  then have failed every conversion on that installation. Every thread is
  resumed now. What remains fail-closed is a thread that cannot be *opened* or
  resumed, and a root none of whose threads reports the suspend count it was
  created with. The honest degradation exists and is not taken: fall back to
  assigning after spawn and publish
  `TreeOwnership::NotEstablishedBeforeExecution`, which downgrades the *claim*
  rather than the *function* and is exactly what the disposition vocabulary was
  built to express. Not attempted here because it restructures the launch path,
  which is the most safety-critical function in this slice, and no such
  environment has been observed. Owner: the process boundary, on the first
  report of an installation this refuses.
- **A queue-level refusal the session can recover from still leaves later items
  `Pending` in a terminal queue**, where they render as "Waiting" and are
  counted nowhere. Corrected for the refusal this slice adds, where the backend
  is quarantined and nothing can run; left alone for the inherited shape, where
  a retry may still reach those items and stranding them would change what a
  rerun converts. Owner: whichever slice next owns retry semantics.
