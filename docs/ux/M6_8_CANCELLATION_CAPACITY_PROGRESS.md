# M6.8 cancellation, capacity, and truthful progress

Status: implemented and validated.
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
cannot have exited and its id cannot have been reused — and a process that has
executed nothing has exactly the one thread it was created with. Any other
count refuses rather than resumes, and `ResumeThread` returning a previous
suspend count of one is the confirmation that the thread really was the
suspended primary thread.

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
| Any of the above **with no stop in flight** | The same uncertainty, and the same consequence. The invariant is about the machine rather than about anything the user pressed, so the run is asked a typed question about its own failure and the queue ends on the quarantine that is then in force. Before this, quarantine fired only on the stop path and the queue went on to launch the next converter beside a process nothing could account for. The question covers `NotAwaited` as well as `NotTerminated`: a Job that would not empty and a supervision loop that lost its child leave the same uncertainty by different routes. |
| The thread snapshot the launch takes fails | Retried a bounded four times. It is documented to fail transiently while the system's thread list changes, and the process being asked about is suspended and cannot move under the retry. |
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

Evidence: `D:/tmp/mscanvas-m68-20260908/cancellation-evidence-0{1,2}.log`.
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

**The claim itself is carried by the compiler, not by a check over spellings.**
`OwnedTreeDisposition::ConfirmedGone` is `non_exhaustive`, so outside the crate
that decides it the affirmative member cannot be constructed *or* matched — by
production code, by a fixture, under an alias, through a braced import, or
under a renamed import. `OwnedTreeDisposition::of` is public for that reason: it
is the only way anyone obtains the member, and a caller that needs it must
present a run that earns it. Two independent reviewers each demonstrated
bypasses of the string-matching version that preceded this; none of them
compiles now.

`validate_the_cancellation_claim_has_one_origin` in `scripts/check_repo.py`
carries what a type cannot. It checks that the conjunction is defined once and
reads both halves; that the derivation exists exactly once, so both lifecycles
read one judgement; that the Rust identifiers and the TypeScript union are the
same set compared against *each other*; that the retired boolean does not
return in code; that neither claim-bearing member is named outside the two
files that own them — matched as bare identifiers, because a qualified path is
the one spelling an import removes; and that nothing describes itself as a
confirmed process tree unless that is all it means.

**The description rule is an allowlist of what may claim, not a list of sites to
inspect.** The version that listed sites passed while three other descriptions
asserted a confirmed tree, one of them a public API arm reached by a run that
launched nothing. Inverted, a description nobody thought about is an error by
default — and inverting it is what found that live defect.

**Prose is the fallible half and is written down as such.** A synonym nobody
listed still passes the description rule. That is why the member is
`non_exhaustive` rather than merely watched: the compiler carries the claim, and
the check carries the wording.

**The guard proves itself.** On every run it applies thirteen deliberate
bypasses to isolated copies and requires each to be detected, including all six
the two reviewers demonstrated: the alias import, the braced member import, the
braced ownership import, a production claim hidden behind a file-based test
module, the set-stop facts re-described, and a description synonym nobody
listed. The proofs also fail if the guard has stopped checking at all, and they
never edit the worktree.

An earlier version walked each file to skip `#[cfg(test)]` regions and read only
what was left. It twice turned out to be skipping production code instead —
first when an attribute inside a skipped region survived its closing brace, then
when an attribute on a brace-less item armed a skip the next item's brace
consumed — and the check written to catch the first was a tautology, searching
the same window with the same condition that had armed the skip. The walk is
gone. The member rule reads whole files, and the only places that may name a
member are the two that own them and files that are tests outright, both named
rather than inferred.

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

34 paths. Each is either the boundary that decides the claim, a direct consumer
of it, a surface that carries it, or the evidence for one.

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

**Queue, commands and wire** — `apps/desktop/src-tauri/src/preview/operation.rs`,
`service.rs`, `dto.rs`, `conversion.rs`, `backend.rs`, `diagnostics.rs`,
`diagnostics/payload.rs`, `lib.rs`, `e2e_seed.rs`, `preview/tests.rs`. The two
new operations, the new item state and count, the typed judgement replacing the
boolean, the bounded diagnostic facts, and the command registration.

**Interface** — `apps/desktop/src/features/mzml-preview/contracts.ts`, `api.ts`,
`useConversionOperation.ts`, `ConversionPanel.tsx`, plus the tests that pin
them: `conversionContract.test.ts`, `ConversionStop.test.tsx`,
`ConversionDiagnostics.test.tsx`, `conversionLaneAuthority.test.tsx`,
`usePreviewWorkspace.test.tsx`, `src/test/outputSetRendering.test.tsx`,
`src/test/previewFixtures.ts`.

**Guard** — `scripts/check_repo.py`.

**Rendered and native evidence** — `e2e/specs/m6.8-cancellation-controls.browser.e2e.ts`,
`e2e/specs/m6.8-cancellation-controls.tauri.e2e.ts`.

## Validation

Local gates: frontend lint, typecheck, 1652 tests across 69 files, build;
`cargo fmt --all --check`; `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`; `cargo test --locked --workspace --all-targets`
(1502 passed, 23 ignored); `python -B scripts/check_repo.py`; `git diff --check`;
E2E typecheck.

**Rendered QA**: 10/10 in `m6.8-cancellation-controls.browser`, including every
control reachable with no horizontal overflow at 1366x768, 1920x1080, 1200x800
and 960x640, plus M6.6 8/8 and M6.7 7/7 unchanged on the same head. Screenshots
and console records inspected; console empty.

Two independent reviews rejected the first candidate. Both were right, and every
finding was verified against the code before it was acted on: a skip landing
between the worker choosing an item and starting it wedged the queue; the guard
was blind to 650 lines of production `service.rs`; the item state and queue count
still described a confirmed tree for a state also reached by a run that launched
nothing; exit criterion 7's invariant fired only on the stop path; and two of the
three ownership tests did not discriminate what they were named for. Each repair
is proved by reverting it and watching a test report the defect.

**Native**, on the build attributable to the final candidate — binary SHA-256
`0a0cfd29129d48ee47f084de1cb3b366d62031b19c41e6a197911eabf1f90ea2`, WebView2 and
driver 152.0.4191.66. Rebuilt and rerun after the review repairs: no native
evidence is inherited across a changed process implementation.

| Scenario | Result |
| --- | --- |
| A stop while the provider is genuinely executing | Item 2, attempt 1, settled `ownedTree: confirmed_gone`, `processLaunched: true`, 34 ms from request to settle; queue `completed` with 7 finalized, 0 not run, session unquarantined |
| A waiting item settled without launching it | 0 attempts, keeps its place and its planned output name, counted apart, queue `completed` with 7 finalized |
| The whole queue stopped mid-execution | `stopped`, 1 attempted of 8, 1 cancelled, 0 unconfirmed, 7 not run |

The phase is observed, never assumed: the suite reads Rust's own authoritative
state until an item reports running, dispatches against that exact item and
attempt, and asks again if the queue moved on. A request Rust refused is not
counted as a stop.

Affected regressions on the same binary: **M6.6 native 5/5**, including the real
Escape cancellation through the exact foreground guard, and **M6.7 native 2/2**.

Evidence: `D:/tmp/mscanvas-m68-20260908/m68-native-UnWUBC/`,
`m66-native-SwVrmE/`, `m67-native-mwLPtY/`.

## Residuals

- **Two browser cases fail on this branch and on the published baseline alike**:
  `m4.1` "offers all three formats for a spectrum that loaded with no peaks" and
  `m5.2` "still reaches the plot by Tab where the range can move". Verified by
  running both specs at `735dfebac5d48db30b6d1802c208ccf05853b3d8` in a separate
  worktree, where they fail identically. Pre-existing and outside this slice.
  Owner: the spectrum-export and viewport owners respectively.
- Native output validation remains `output_only`, not full-source scientific
  fidelity. Owner: the scientific-fidelity owner, unchanged by this slice.
- The e2e runner's existing Tauri browser-mode and forced dev-server shutdown
  warnings. Pre-existing harness residual.
- Whether a *different* `msconvert` build spawns children is not established by
  this measurement, and the re-observation gate is what would catch a changed
  executable identity.
- **The suspended launch has no degradation path.** It refuses unless the child
  presents exactly the one thread a process that has executed nothing has, and
  unless `ResumeThread` reports it was suspended. A security product that
  injects a thread at process creation would meet that deterministically, and
  every conversion on that installation would fail — fail-closed and now
  retryable, but permanently. The honest degradation exists and is not taken:
  fall back to assigning after spawn and publish
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
